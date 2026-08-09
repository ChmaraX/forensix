#!/usr/bin/env python3
"""147 — read-only parser for a KWallet `.kwl` container.

Format is SOURCE-CONFIRMED against the exact shipped sources of the Source's own
provider, kwallet 6.13.0 (`apt-get source kwallet6` on Debian trixie):

  src/runtime/kwalletd/backend/kwalletbackend.cc          magic, KDF constants
  src/runtime/kwalletd/backend/backendpersisthandler.cpp  BlowfishPersistHandler
  src/runtime/kwalletd/backend/cbc.cc                     CipherBlockChain
  src/runtime/kwalletd/backend/kwalletbackend.h           PBKDF2_* constants

Layout:

  0                     12   KWMAGIC = "KWALLET\\n\\r\\0\\r\\n"
  12                     4   version[4] = {major, minor, cipher, hash}
  16                     …   PLAINTEXT hash index (folder/entry MD5s) — see below
  …                      …   Blowfish-CBC ciphertext, zero IV, to EOF

Hash index (plaintext, QDataStream, big-endian):
  quint32 folderCount
  per folder: 16-byte MD5(folder name UTF-8), quint32 entryCount,
              entryCount × 16-byte MD5(entry key UTF-8)

Plaintext of the ciphertext:
  blksz(8) random ‖ 4-byte BE payload size ‖ payload ‖ random padding ‖ SHA1(payload)[20]

Key:  cipher 3 + hash 2 → PBKDF2-HMAC-SHA512(password, salt, 50000, 56),
      salt = the 56 raw bytes of the sibling `<wallet>.salt` file.

This module NEVER writes. It takes bytes in and returns structures out, so the
copied wallet can be hashed before and after and shown to be untouched.
"""
import hashlib
import struct

KWMAGIC = b"KWALLET\n\r\x00\r\n"
KWMAGIC_LEN = 12

CIPHER_BLOWFISH_ECB = 0
CIPHER_3DES_CBC = 1
CIPHER_GPG = 2
CIPHER_BLOWFISH_CBC = 3

HASH_SHA1 = 0
HASH_MD5 = 1
HASH_PBKDF2_SHA512 = 2

PBKDF2_SHA512_KEYSIZE = 56
PBKDF2_SHA512_SALTSIZE = 56
PBKDF2_SHA512_ITERATIONS = 50000

ENTRY_TYPES = {0: "Unknown", 1: "Password", 2: "Stream", 3: "Map"}

CIPHER_NAMES = {0: "BLOWFISH_ECB", 1: "3DES_CBC(unsupported)", 2: "GPG", 3: "BLOWFISH_CBC"}
HASH_NAMES = {0: "SHA1", 1: "MD5(unsupported)", 2: "PBKDF2_SHA512"}


class KwlError(Exception):
    """Carries a typed reason string, never a bare message."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class _Stream:
    """Minimal QDataStream reader (big-endian, Qt default)."""

    def __init__(self, buf):
        self.b = buf
        self.i = 0

    def at_end(self):
        return self.i >= len(self.b)

    def raw(self, n):
        if self.i + n > len(self.b):
            raise KwlError("kwl-truncated-stream")
        out = self.b[self.i:self.i + n]
        self.i += n
        return out

    def u32(self):
        return struct.unpack(">I", self.raw(4))[0]

    def i32(self):
        return struct.unpack(">i", self.raw(4))[0]

    def qstring(self):
        n = self.u32()
        if n == 0xFFFFFFFF:
            return None
        return self.raw(n).decode("utf-16-be")

    def qbytearray(self):
        n = self.u32()
        if n == 0xFFFFFFFF:
            return None
        return self.raw(n)


def read_header(blob):
    if len(blob) < KWMAGIC_LEN + 4:
        raise KwlError("kwl-file-too-short")
    if blob[:KWMAGIC_LEN] != KWMAGIC:
        raise KwlError("kwl-bad-magic")
    major, minor, cipher, hsh = blob[12], blob[13], blob[14], blob[15]
    return {
        "version_major": major,
        "version_minor": minor,
        "cipher": cipher,
        "cipher_name": CIPHER_NAMES.get(cipher, f"unknown({cipher})"),
        "hash": hsh,
        "hash_name": HASH_NAMES.get(hsh, f"unknown({hsh})"),
    }


def read_index(blob):
    """Parse the PLAINTEXT hash index and return (index, offset_of_ciphertext).

    Forensically interesting on its own: folder and entry names are MD5-hashed
    here, in the clear, with no password at all. A known-name dictionary test is
    possible against a wallet that can never be decrypted.
    """
    s = _Stream(blob)
    s.i = KWMAGIC_LEN + 4
    n = s.u32()
    if n > 0xFFFF:
        raise KwlError("kwl-index-sanity-check-failed")
    folders = []
    for _ in range(n):
        fmd5 = s.raw(16)
        fsz = s.u32()
        entries = [s.raw(16) for _ in range(fsz)]
        folders.append({"folder_md5": fmd5.hex(), "entry_md5s": [e.hex() for e in entries]})
    return {"folder_count": n, "folders": folders}, s.i


def derive_passhash(password: bytes, salt: bytes, hash_kind: int) -> bytes:
    if hash_kind == HASH_PBKDF2_SHA512:
        if len(salt) != PBKDF2_SHA512_SALTSIZE:
            raise KwlError(f"kwl-salt-wrong-size:{len(salt)}")
        return hashlib.pbkdf2_hmac(
            "sha512", password, salt, PBKDF2_SHA512_ITERATIONS, PBKDF2_SHA512_KEYSIZE
        )
    if hash_kind == HASH_SHA1:
        # Legacy pre-4.13 wallets. Implemented for completeness; the Source under
        # test does not use it, so it is UNTESTED and reported as such.
        raise KwlError("kwl-legacy-sha1-hash-untested")
    raise KwlError(f"kwl-unsupported-hash:{hash_kind}")


def _blowfish_cbc_decrypt(key: bytes, data: bytes) -> bytes:
    """Standard Blowfish-CBC, zero IV.

    `blowfish.cc` looks non-standard — it casts the block to `uint32_t*` and only
    byte-swaps `#if Q_BYTE_ORDER == Q_BIG_ENDIAN`. But line 27 of that same file
    **hardcodes** `#define Q_BYTE_ORDER Q_BIG_ENDIAN` on every platform, so the
    swap always happens, and on a little-endian host it converts the LE word load
    back to big-endian. Net effect: ordinary Blowfish. Confirmed empirically.

    `cbc.cc` does the chaining bytewise and `initRegister()` zeroes the register,
    so the IV is eight zero bytes.
    """
    try:
        from cryptography.hazmat.decrepit.ciphers.algorithms import Blowfish
    except ImportError:  # older cryptography
        from cryptography.hazmat.primitives.ciphers.algorithms import Blowfish
    from cryptography.hazmat.primitives.ciphers import Cipher, modes

    dec = Cipher(Blowfish(key), modes.CBC(b"\x00" * 8)).decryptor()
    return dec.update(data) + dec.finalize()


def kwallet_sha1(data: bytes) -> bytes:
    """KWallet's SHA1 — which is NOT standard SHA-1 on a little-endian host.

    `sha1.cc` carries the same hardcoded `#define Q_BYTE_ORDER Q_BIG_ENDIAN`
    (line 20, under the comment "DO NOT INCLUDE THIS. IT BREAKS KWALLET."), but
    here the big-endian branch is the one that does NO conversion:

        load  : `memcpy(x, _data, 64)`      → words load in HOST order (LE)
        store : `*(uint32_t *)p = _h##a`    → digest words store in HOST order

    So on a little-endian Source the message words and the digest words are both
    byte-swapped relative to real SHA-1. Padding is byte-level and standard, and
    the compression function is standard SHA-1 (rol-1 expansion).

    Consequence: the same wallet password produces a DIFFERENT integrity trailer
    depending on the endianness of the machine that wrote it. A parser that uses
    stock SHA-1 rejects a perfectly good little-endian wallet with what looks
    exactly like a wrong-password error. Verified on aarch64 (LE).
    """
    h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]
    msg = data + b"\x80"
    while len(msg) % 64 != 56:
        msg += b"\x00"
    msg += struct.pack(">Q", len(data) * 8)

    mask = 0xFFFFFFFF
    def rol(x, n):
        return ((x << n) | (x >> (32 - n))) & mask

    for off in range(0, len(msg), 64):
        w = list(struct.unpack("<16I", msg[off:off + 64]))   # LE load: the quirk
        for t in range(16, 80):
            w.append(rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1))
        a, b, c, d, e = h
        for t in range(80):
            if t < 20:
                f, k = d ^ (b & (c ^ d)), 0x5A827999
            elif t < 40:
                f, k = b ^ c ^ d, 0x6ED9EBA1
            elif t < 60:
                f, k = (b & c) | (d & (b | c)), 0x8F1BBCDC
            else:
                f, k = b ^ c ^ d, 0xCA62C1D6
            a, b, c, d, e = (rol(a, 5) + f + e + k + w[t]) & mask, a, rol(b, 30), c, d
        h = [(x + y) & mask for x, y in zip(h, (a, b, c, d, e))]

    return b"".join(struct.pack("<I", x) for x in h)          # LE store: the quirk


def parse(kwl_bytes: bytes, salt_bytes: bytes, password: bytes):
    """Return a dict of folders → entries. Raises KwlError with a typed reason."""
    hdr = read_header(kwl_bytes)
    if hdr["cipher"] == CIPHER_GPG:
        raise KwlError("kwl-gpg-wallet-needs-private-key")
    if hdr["cipher"] not in (CIPHER_BLOWFISH_ECB, CIPHER_BLOWFISH_CBC):
        raise KwlError(f"kwl-unsupported-cipher:{hdr['cipher']}")
    if hdr["cipher"] == CIPHER_BLOWFISH_ECB:
        raise KwlError("kwl-legacy-ecb-wallet-untested")

    index, off = read_index(kwl_bytes)
    enc = kwl_bytes[off:]
    blksz = 8
    if not enc or len(enc) % blksz:
        raise KwlError("kwl-ciphertext-not-block-aligned")

    key = derive_passhash(password, salt_bytes, hdr["hash"])
    plain = _blowfish_cbc_decrypt(key, enc)

    fsize = struct.unpack(">i", plain[blksz:blksz + 4])[0]
    if fsize < 0 or fsize > len(plain) - blksz - 4:
        # The overwhelmingly likely cause is a wrong password: the size field is
        # simply garbage. Reported as a credential failure, not a format failure.
        raise KwlError("kwl-wrong-password-or-corrupt (size field out of range)")

    payload = plain[blksz + 4: blksz + 4 + fsize]
    want = plain[-20:]
    got = kwallet_sha1(payload)
    if got != want:
        # KWallet's own integrity check. This is what makes a wrong password
        # detectable rather than silently producing junk.
        raise KwlError("kwl-payload-sha1-mismatch (wrong password or mutated file)")

    s = _Stream(payload)
    folders = {}
    while not s.at_end():
        folder = s.qstring()
        n = s.u32()
        entries = {}
        for _ in range(n):
            k = s.qstring()
            t = s.i32()
            v = s.qbytearray()
            if t not in ENTRY_TYPES or t == 0:
                continue
            entries[k] = {"type": t, "type_name": ENTRY_TYPES[t], "raw": v}
        folders[folder] = entries

    return {"header": hdr, "index": index, "folders": folders,
            "verified_payload_sha1": got.hex()}


def _parse_entry_stream(payload: bytes):
    s = _Stream(payload)
    folders = {}
    while not s.at_end():
        folder = s.qstring()
        n = s.u32()
        entries = {}
        for _ in range(n):
            k = s.qstring()
            t = s.i32()
            v = s.qbytearray()
            if t not in ENTRY_TYPES or t == 0:
                continue
            entries[k] = {"type": t, "type_name": ENTRY_TYPES[t], "raw": v}
        folders[folder] = entries
    return folders


def parse_gpg_plaintext(decrypted: bytes):
    """Parse the plaintext of a GPG-backed wallet.

    `GpgPersistHandler::read` reads three QDataStream fields from the decrypted
    blob: `QString keyID`, `QByteArray hashes`, `QByteArray values`. Only
    `values` carries the entries; `hashes` is the same MD5 index the blowfish
    handler writes in the CLEAR, so a GPG wallet leaks strictly less than a
    blowfish one — folder and entry names are inside the encryption envelope.
    """
    s = _Stream(decrypted)
    key_id = s.qstring()
    _hashes = s.qbytearray()
    values = s.qbytearray()
    return {"gpg_key_id": key_id, "folders": _parse_entry_stream(values or b"")}


def gpg_ciphertext(kwl_bytes: bytes) -> bytes:
    """The OpenPGP message of a GPG wallet: everything after magic+version.

    Note there is NO plaintext hash index in this variant — the OpenPGP packet
    starts at byte 16.
    """
    return kwl_bytes[KWMAGIC_LEN + 4:]


def password_entry_text(raw: bytes) -> str:
    """A Password entry's value is a QDataStream-serialised QString.

    Entry::setValue(const QString&) writes `ds << value`, so the stored bytes are
    quint32 byte-length + UTF-16BE — NOT the bare UTF-8 text.
    """
    s = _Stream(raw)
    return s.qstring()
