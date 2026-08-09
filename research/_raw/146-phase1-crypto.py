#!/usr/bin/env python3
"""146 PHASE 1 — prove the v10 derivation and decryption before any real Source.

Builds a synthetic Cookies DB whose rows are encrypted with the key derived
from the SYNTHETIC keychain's secret, using exactly the construction #144
attributes to Chrome on macOS. Then hands it to the real recovery tool.

If this fails, the chain is wrong and no human time should be spent.
"""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

LAB = os.environ["LAB"]
KC = os.path.join(LAB, "synthetic.keychain-db")
KC_PW = "synthetic-kc-pw-PHASE1"
SERVICE, ACCOUNT = "Chrome Safe Storage", "Chrome"

KNOWN = {
    "fx_ascii": "ForensiX-ASCII-146-KNOWN",
    "fx_nonascii": "ForensiX-ÁÉÍÓÚ-áéí-řšč-日本語-🔐",
    "fx_block16": "0123456789abcdef",
    "fx_long": "L" * 200,
    "fx_empty_ish": "x",
}


def main():
    # Recover the secret exactly as the real run will: explicit path only.
    subprocess.run(["security", "unlock-keychain", "-p", KC_PW, KC], check=True,
                   capture_output=True)
    secret = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", KC],
        check=True, capture_output=True, text=True).stdout.strip()

    key = hashlib.pbkdf2_hmac("sha1", secret.encode(), b"saltysalt", 1003, 16)
    print(f"secret={secret}")
    print(f"derived_key_sha256={hashlib.sha256(key).hexdigest()[:16]}")

    # Encrypt with the SAME construction Chrome uses, so decryption is a real test.
    db = os.path.join(LAB, "Cookies")
    if os.path.exists(db):
        os.remove(db)
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
    for name, val in KNOWN.items():
        pt = val.encode()
        padlen = 16 - (len(pt) % 16)
        padded = pt + bytes([padlen]) * padlen
        enc = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).encryptor()
        con.execute("INSERT INTO cookies VALUES (?,?)",
                    (name, b"v10" + enc.update(padded) + enc.finalize()))
    con.commit()
    con.close()

    kp = os.path.join(LAB, "known.json")
    json.dump(KNOWN, open(kp, "w"), ensure_ascii=False, indent=2)
    print(f"built {db} with {len(KNOWN)} known rows")


if __name__ == "__main__":
    main()
