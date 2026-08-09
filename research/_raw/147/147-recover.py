#!/usr/bin/env python3
"""147 — offline OSCrypt v11 recovery from a COPIED KWallet.

Runs in a SEPARATE clean container that has never run the evidentiary browser,
has no KWallet installed, and has no key store of its own. The copied wallet is
read by EXPLICIT PATH only, read-only, with no D-Bus and no daemon of any kind.

Route "direct-parse" is the only route offered here, deliberately: shipping a
kwalletd inside a forensic tool would mean executing the suspect's provider, and
#125's working-copy rule plus #144's no-live-key-store rule both point the other
way. The parser is validated against ground truth recorded at Source time.

Derivation under test (SOURCE-CONFIRMED in research/144, verified here):
    key = PBKDF2-HMAC-SHA1(secret_text, b"saltysalt", iterations=1, dklen=16)
    AES-128-CBC, IV = b" " * 16, ciphertext = row[3:]
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kwl_parse  # noqa: E402

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes  # noqa: E402

SALT = b"saltysalt"
IV = b" " * 16
ITERATIONS = 1
KEYLEN = 16


def derive(secret_text: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha1", secret_text, SALT, ITERATIONS, KEYLEN)


def decrypt_v11(enc: bytes, key: bytes):
    """Return (ok, result). CBC has no AEAD: padding success only, never proof."""
    if enc[:3] != b"v11":
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
    for off, label in ((0, "raw"), (32, "domain-prefixed")):
        try:
            s = out[off:].decode("utf-8")
        except UnicodeDecodeError:
            continue
        if s.isprintable() or off:
            return True, (s, label)
    return False, "utf8-decode-failed"


def read_secret_direct(store_dir, wallet, password, folder, key):
    """Parse the copied <wallet>.kwl with no daemon and no D-Bus.

    Returns (secret, None) or (None, typed_reason). Reasons must DISTINGUISH the
    failure modes; collapsing them into one string would make every negative
    control look identical.
    """
    if not os.path.isdir(store_dir):
        return None, "kwallet-store-absent"
    kwls = sorted(f for f in os.listdir(store_dir) if f.endswith(".kwl"))
    if not kwls:
        return None, "kwallet-store-empty"

    if wallet:
        target = f"{wallet}.kwl"
        if target not in kwls:
            return None, f"kwallet-named-wallet-absent:{wallet}"
    elif len(kwls) > 1:
        # Never guess which wallet is the right one.
        return None, f"kwallet-multiple-wallets-ambiguous:{len(kwls)}:{','.join(kwls)}"
    else:
        target = kwls[0]

    kwl_path = os.path.join(store_dir, target)
    salt_path = kwl_path[:-4] + ".salt"
    blob = open(kwl_path, "rb").read()

    try:
        hdr = kwl_parse.read_header(blob)
    except kwl_parse.KwlError as e:
        return None, e.reason

    if hdr["hash"] == kwl_parse.HASH_PBKDF2_SHA512:
        if not os.path.exists(salt_path):
            return None, "kwallet-salt-file-absent"
        salt = open(salt_path, "rb").read()
    else:
        salt = b""

    try:
        parsed = kwl_parse.parse(blob, salt, password.encode())
    except kwl_parse.KwlError as e:
        return None, e.reason

    folders = parsed["folders"]
    if folder not in folders:
        return None, f"kwallet-folder-absent:{folder}|present:{sorted(folders)}"
    entries = folders[folder]
    if key not in entries:
        return None, f"kwallet-entry-absent:{key}|present:{sorted(entries)}"
    ent = entries[key]
    if ent["type_name"] != "Password":
        return None, f"kwallet-entry-wrong-type:{ent['type_name']}"
    return kwl_parse.password_entry_text(ent["raw"]), None


def read_secret_gpg(store_dir, wallet, gpg_home, passphrase, folder, key):
    """GPG-backed wallet: decrypt the OpenPGP envelope with the ACQUIRED private
    key environment, then parse the plaintext.

    gpg is invoked with an explicit GNUPGHOME pointing at the copied key
    material, so nothing on the analyst's machine can satisfy the decryption.
    """
    import subprocess
    if not os.path.isdir(store_dir):
        return None, "kwallet-store-absent"
    kwl_path = os.path.join(store_dir, f"{wallet}.kwl")
    if not os.path.exists(kwl_path):
        return None, f"kwallet-named-wallet-absent:{wallet}"
    blob = open(kwl_path, "rb").read()
    try:
        hdr = kwl_parse.read_header(blob)
    except kwl_parse.KwlError as e:
        return None, e.reason
    if hdr["cipher"] != kwl_parse.CIPHER_GPG:
        return None, f"kwallet-not-a-gpg-wallet:{hdr['cipher_name']}"
    if not os.path.isdir(gpg_home):
        return None, "kwallet-gpg-keyring-absent"

    env = dict(os.environ, GNUPGHOME=gpg_home)
    cmd = ["gpg", "--batch", "--yes", "--quiet", "--pinentry-mode", "loopback"]
    if passphrase is not None:
        cmd += ["--passphrase", passphrase]
    cmd += ["--decrypt"]
    p = subprocess.run(cmd, input=kwl_parse.gpg_ciphertext(blob),
                       capture_output=True, env=env, timeout=120)
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace").lower()
        # Distinguish the four GPG failure modes the ticket names.
        if "no secret key" in err or "decryption failed" in err and "secret key" in err:
            return None, "kwallet-gpg-private-key-absent"
        if "bad passphrase" in err or "bad password" in err:
            return None, "kwallet-gpg-wrong-passphrase"
        if "agent" in err and ("not available" in err or "no agent" in err or "ipc" in err):
            return None, "kwallet-gpg-agent-unavailable"
        if "cancel" in err or "no pinentry" in err:
            return None, "kwallet-gpg-credential-unavailable"
        return None, f"kwallet-gpg-decrypt-failed:{err.strip().splitlines()[-1][:90] if err.strip() else 'rc=' + str(p.returncode)}"

    try:
        parsed = kwl_parse.parse_gpg_plaintext(p.stdout)
    except kwl_parse.KwlError as e:
        return None, e.reason
    folders = parsed["folders"]
    if folder not in folders:
        return None, f"kwallet-folder-absent:{folder}|present:{sorted(folders)}"
    if key not in folders[folder]:
        return None, f"kwallet-entry-absent:{key}|present:{sorted(folders[folder])}"
    return kwl_parse.password_entry_text(folders[folder][key]["raw"]), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store-dir", required=True)
    ap.add_argument("--wallet", default=None, help="wallet name without .kwl")
    ap.add_argument("--cookies", required=True)
    ap.add_argument("--known", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--folder", default="Chrome Keys")
    ap.add_argument("--key", default="Chrome Safe Storage")
    ap.add_argument("--force-secret", default=None,
                    help="skip the wallet and use this secret (wrong-key control)")
    ap.add_argument("--expect-secret", default=None,
                    help="ground truth recorded at Source time, for cross-check")
    ap.add_argument("--label", default="")
    ap.add_argument("--gpg-home", default=None,
                    help="acquired GNUPGHOME; selects the GPG-wallet route")
    ap.add_argument("--gpg-passphrase", default=None)
    a = ap.parse_args()

    result = {"label": a.label,
              "route": "gpg-envelope" if a.gpg_home else "direct-parse",
              "selector": {"folder": a.folder, "key": a.key}}

    if a.force_secret is not None:
        secret, err = a.force_secret, None
        result["secret_source"] = "forced (control)"
    elif a.gpg_home:
        secret, err = read_secret_gpg(a.store_dir, a.wallet or "kdewallet", a.gpg_home,
                                      a.gpg_passphrase, a.folder, a.key)
        result["secret_source"] = f"gpg:{a.store_dir}"
    else:
        secret, err = read_secret_direct(a.store_dir, a.wallet, a.password, a.folder, a.key)
        result["secret_source"] = f"direct:{a.store_dir}"

    if secret is None:
        result["status"] = "unavailable"
        result["reason"] = err
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    key = derive(secret.encode())
    result["secret_len"] = len(secret)
    result["derived_key_sha256"] = hashlib.sha256(key).hexdigest()[:16]
    if a.expect_secret is not None:
        result["secret_matches_source_ground_truth"] = (secret == a.expect_secret)

    known = json.load(open(a.known))
    con = sqlite3.connect(f"file:{a.cookies}?mode=ro", uri=True)
    rows = con.execute("SELECT name, encrypted_value FROM cookies ORDER BY name").fetchall()
    con.close()

    decrypted, match, mismatch = {}, 0, 0
    for name, ev in rows:
        ok, res = decrypt_v11(bytes(ev), key)
        if ok:
            text, mode = res
            rec = {"interp": mode}
            exp = known.get(name)
            if exp is not None and exp == text:
                rec.update(matches_known=True, match_form="stored-verbatim")
                match += 1
            elif exp is not None and exp == unquote(text):
                rec.update(matches_known=True, match_form="percent-decoded")
                match += 1
            else:
                rec.update(matches_known=False, got=text[:80], expected=exp)
                mismatch += 1
            decrypted[name] = rec
        else:
            decrypted[name] = {"unavailable": res}
            mismatch += 1

    result["status"] = "ok" if match and not mismatch else "partial" if match else "failed"
    result["matched"] = match
    result["mismatched"] = mismatch
    result["rows"] = decrypted
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
