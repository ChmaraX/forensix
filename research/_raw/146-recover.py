#!/usr/bin/env python3
"""146 — offline OSCrypt v10 recovery from a COPIED macOS Keychain.

Reads the copied keychain by EXPLICIT PATH only, via Apple's first-party
`security` tool. Never touches the analyst's login keychain and never alters
the keychain search list.

Derivation under test (SOURCE-CONFIRMED in research/144 §macOS, verified here):
    key = PBKDF2-HMAC-SHA1(secret_text, b"saltysalt", iterations=1003, dklen=16)
    AES-128-CBC, IV = b" " * 16, ciphertext = row[3:] after the b"v10" prefix

Note the iteration count: macOS uses 1003, Linux uses 1. Using Linux's value
here silently produces a wrong key that still yields valid CBC padding roughly
1 time in 256, which is exactly the failure mode #144 warns about.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import urllib.parse

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

SALT = b"saltysalt"
IV = b" " * 16
ITERATIONS = 1003          # macOS-specific; Linux is 1
KEYLEN = 16
PREFIX = b"v10"


def derive(secret_text: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha1", secret_text, SALT, ITERATIONS, KEYLEN)


def read_secret(keychain_path, password, service, account):
    """Recover the Safe Storage item from a copied keychain by explicit path.

    Returns (secret, None) or (None, typed_reason). Reasons must DISTINGUISH
    failure modes; collapsing them into one string would make the negative
    controls worthless.
    """
    if not os.path.exists(keychain_path):
        return None, "missing-macos-keychain-store"

    # Unlock is a separate step from lookup so the two failures stay distinct:
    # a wrong password must not be reported as a missing item.
    u = subprocess.run(
        ["security", "unlock-keychain", "-p", password, keychain_path],
        capture_output=True, text=True, timeout=60,
    )
    if u.returncode != 0:
        err = (u.stderr or "").strip()
        if "The user name or passphrase you entered is not correct" in err or "-25293" in err:
            return None, "macos-keychain-credential-unavailable"
        if "-25294" in err or "Invalid keychain" in err or "not a valid keychain" in err.lower():
            return None, "macos-keychain-store-damaged"
        return None, f"macos-keychain-unlock-failed:{err[:80]}"

    f = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account,
         "-w", keychain_path],
        capture_output=True, text=True, timeout=60,
    )
    if f.returncode != 0:
        err = (f.stderr or "").strip()
        if "could not be found" in err or "-25300" in err:
            return None, "macos-safe-storage-item-absent"
        return None, f"macos-keychain-lookup-failed:{err[:80]}"

    secret = (f.stdout or "").strip()
    if not secret:
        return None, "macos-safe-storage-item-empty"
    return secret, None


def decrypt_v10(enc: bytes, key: bytes):
    """Return (ok, payload). CBC has no AEAD: padding success only, never proof."""
    if enc[:3] != PREFIX:
        return False, f"unsupported-row-prefix:{enc[:3]!r}"
    body = enc[3:]
    if not body or len(body) % 16:
        return False, "ciphertext-not-block-aligned"
    dec = Cipher(algorithms.AES(key), modes.CBC(IV)).decryptor()
    raw = dec.update(body) + dec.finalize()
    pad = raw[-1]
    if pad < 1 or pad > 16 or raw[-pad:] != bytes([pad]) * pad:
        return False, "cbc-padding-invalid"
    out = raw[:-pad]
    # #149 found a 32-byte SHA-256 domain prefix ahead of the plaintext on
    # Linux M151. Try raw first, then the 32-byte-offset interpretation.
    for off, label in ((0, "raw"), (32, "domain-prefixed")):
        if len(out) < off:
            continue
        try:
            s = out[off:].decode("utf-8")
        except UnicodeDecodeError:
            continue
        if off or s.isprintable():
            return True, (s, label)
    return False, "utf8-decode-failed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keychain", required=True)
    ap.add_argument("--cookies", required=True)
    ap.add_argument("--known", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--service", default="Chrome Safe Storage")
    ap.add_argument("--account", default="Chrome")
    ap.add_argument("--force-secret", default=None,
                    help="bypass the keychain; used by the wrong-key control")
    ap.add_argument("--label", default="run")
    a = ap.parse_args()

    res = {"label": a.label, "keychain": a.keychain,
           "selector": f"{a.service}/{a.account}"}

    if a.force_secret is not None:
        secret, reason = a.force_secret, None
        res["secret_source"] = "forced"
    else:
        secret, reason = read_secret(a.keychain, a.password, a.service, a.account)
        res["secret_source"] = f"keychain:{a.keychain}"

    if reason:
        res.update(status="unavailable", reason=reason)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    key = derive(secret.encode())
    res["secret_len"] = len(secret)
    res["derived_key_sha256"] = hashlib.sha256(key).hexdigest()[:16]

    known = json.load(open(a.known))
    con = sqlite3.connect(f"file:{a.cookies}?immutable=1", uri=True)
    rows = con.execute("SELECT name, encrypted_value FROM cookies").fetchall()
    con.close()

    out, matched, mismatched = {}, 0, 0
    for name, enc in rows:
        if name not in known:
            continue
        ok, payload = decrypt_v10(bytes(enc), key)
        if not ok:
            out[name] = {"unavailable": payload}
            mismatched += 1
            continue
        text, interp = payload
        entry = {"plaintext": text, "interp": interp}
        exp = known[name]
        if text == exp:
            entry.update(matches_known=True, match_form="stored-verbatim")
            matched += 1
        else:
            dec = urllib.parse.unquote(text)
            if dec == exp:
                entry.update(matches_known=True, match_form="percent-decoded",
                             decoded_plaintext=dec)
                matched += 1
            else:
                entry.update(matches_known=False, expected=exp)
                mismatched += 1
        out[name] = entry

    res.update(status=("ok" if matched and not mismatched
                       else "partial" if matched else "failed"),
               matched=matched, mismatched=mismatched, rows=out)
    print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
