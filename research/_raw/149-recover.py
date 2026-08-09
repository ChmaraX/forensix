#!/usr/bin/env python3
"""149 — offline OSCrypt v11 recovery from a COPIED GNOME Keyring.

Runs in a SEPARATE clean container that has never run the evidentiary browser and
has no key store of its own. Reads the copied store by EXPLICIT PATH only.

Two recovery routes are exercised, because #144 treats them as distinct variants:

  route A "replay"      : start a private gnome-keyring-daemon whose XDG_DATA_HOME is
                          pointed at the Working Copy, unlock with the authorized
                          keyring credential, read the item over Secret Service.
  route B "direct-parse": parse the copied login.keyring file format directly, with
                          no daemon and no D-Bus at all.

Derivation under test (SOURCE-CONFIRMED in research/144, verified here):
    key = PBKDF2-HMAC-SHA1(secret_text, b"saltysalt", iterations=1, dklen=16)
    AES-128-CBC, IV = b" " * 16, ciphertext = row[3:]
"""
import argparse
import binascii
import hashlib
import json
import os
import sqlite3
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

SALT = b"saltysalt"
IV = b" " * 16
ITERATIONS = 1
KEYLEN = 16


def derive(secret_text: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha1", secret_text, SALT, ITERATIONS, KEYLEN)


def decrypt_v11(enc: bytes, key: bytes):
    """Return (ok, plaintext_or_reason). CBC has no AEAD: padding success only."""
    if not enc[:3] == b"v11":
        return False, f"unsupported-row-prefix:{enc[:3]!r}"
    body = enc[3:]
    if len(body) % 16 or not body:
        return False, "ciphertext-not-block-aligned"
    dec = Cipher(algorithms.AES(key), modes.CBC(IV)).decryptor()
    raw = dec.update(body) + dec.finalize()
    pad = raw[-1]
    if pad < 1 or pad > 16 or raw[-pad:] != bytes([pad]) * pad:
        return False, "cbc-padding-invalid"
    out = raw[:-pad]
    # Chrome M151 prefixes the plaintext with a 32-bit SHA256 domain hash on some
    # builds; try both raw and offset-32 interpretations.
    for off, label in ((0, "raw"), (32, "domain-prefixed")):
        try:
            s = out[off:].decode("utf-8")
        except UnicodeDecodeError:
            continue
        if s.isprintable() or off:
            return True, (s, label)
    return False, "utf8-decode-failed"


def read_secret_replay(store_dir, password, app):
    """Route A — private daemon over the copied store, explicit path.

    Returns (secret, None) or (None, typed_reason). The reason strings are the
    typed unavailable(reason) values the ticket asks us to enumerate, and they
    must DISTINGUISH the failure modes rather than collapse into one.
    """
    kr = os.path.join(store_dir, "keyrings")
    # Distinguish store-absent from item-absent from credential-wrong BEFORE
    # blaming the lookup, otherwise every control yields the same string.
    if not os.path.isdir(kr):
        return None, "linux-keyring-store-absent"
    files = [f for f in os.listdir(kr) if f.endswith(".keyring")]
    if not files:
        return None, "linux-keyring-store-empty"

    env = dict(os.environ)
    env["XDG_DATA_HOME"] = store_dir
    env["HOME"] = os.path.dirname(store_dir)
    # secret-tool writes its diagnostic to the inherited stderr, so it must be
    # folded into stdout with 2>&1 at the call site; a `2>file` redirect inside
    # the script does NOT capture it.
    script = (
        'eval "$(dbus-launch --sh-syntax)"; '
        f'printf %s "{password}" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1; '
        'sleep 1; '
        f'OUT=$(secret-tool lookup application {app} 2>&1); RC=$?; '
        'echo "RC=$RC"; echo "OUT<<<$OUT>>>"; '
        # `lookup` returns empty for BOTH a locked item and an absent item.
        # `search --all` distinguishes them: a locked item still enumerates and
        # reports "Cannot get secret of a locked object".
        f'SEARCH=$(secret-tool search --all application {app} 2>&1); '
        'echo "SEARCH<<<$SEARCH>>>"; '
        f'echo "COUNT=$(printf %s "$SEARCH" | grep -c \'^secret = \')"'
    )
    p = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=90)
    out = p.stdout
    body = out.split("OUT<<<", 1)[1].split(">>>", 1)[0] if "OUT<<<" in out else ""
    count = 0
    if "COUNT=" in out:
        try:
            count = int(out.split("COUNT=", 1)[1].strip().splitlines()[0])
        except ValueError:
            count = 0

    if out.startswith("RC=0") or "\nRC=0" in out:
        secret = body.strip()
        if count > 1:
            # Ambiguity is never silently resolved: more than one matching item
            # means the selector did not identify a unique secret.
            return None, f"linux-keyring-item-ambiguous:{count}-matching-items"
        return secret, None

    search = out.split("SEARCH<<<", 1)[1].split(">>>", 1)[0] if "SEARCH<<<" in out else ""
    low = (body + "\n" + search).lower()
    if "locked" in low:
        # The item exists; the collection did not unlock with the supplied credential.
        return None, "linux-keyring-credential-unavailable"
    if "attribute." in low or "schema = " in low:
        # Items enumerate but none carries the requested selector.
        return None, "linux-keyring-item-absent"
    if not body.strip() and not search.strip():
        return None, "linux-keyring-item-absent"
    return None, f"linux-keyring-lookup-failed:{body.strip()[:80]}"


def read_secret_direct(keyring_file, password, app):
    """Route B — parse the copied *.keyring file with no daemon/D-Bus."""
    try:
        from keyring_parse import parse_keyring  # local helper
    except Exception as e:  # noqa: BLE001
        return None, f"direct-parser-unavailable:{e}"
    return parse_keyring(keyring_file, password, app)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store-dir", required=True)
    ap.add_argument("--cookies", required=True)
    ap.add_argument("--known", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--app", default="chrome")
    ap.add_argument("--route", choices=["replay", "direct"], default="replay")
    ap.add_argument("--force-secret", default=None,
                    help="skip store read and use this secret (wrong-key control)")
    ap.add_argument("--label", default="")
    a = ap.parse_args()

    result = {"label": a.label, "route": a.route, "app": a.app}

    if a.force_secret is not None:
        secret, err = a.force_secret, None
        result["secret_source"] = "forced (control)"
    elif a.route == "replay":
        secret, err = read_secret_replay(a.store_dir, a.password, a.app)
        result["secret_source"] = f"replay:{a.store_dir}"
    else:
        secret, err = read_secret_direct(a.store_dir, a.password, a.app)
        result["secret_source"] = f"direct:{a.store_dir}"

    if secret is None:
        result["status"] = "unavailable"
        result["reason"] = err
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    key = derive(secret.encode())
    result["secret_len"] = len(secret)
    result["derived_key_sha256"] = hashlib.sha256(key).hexdigest()[:16]

    known = json.load(open(a.known))
    con = sqlite3.connect(f"file:{a.cookies}?mode=ro", uri=True)
    rows = con.execute("SELECT name, encrypted_value FROM cookies ORDER BY name").fetchall()
    con.close()

    decrypted, match, mismatch = {}, 0, 0
    for name, ev in rows:
        ok, res = decrypt_v11(bytes(ev), key)
        if ok:
            text, mode = res
            decrypted[name] = {"plaintext": text, "interp": mode}
            # Chrome stores the cookie value in its WIRE form (percent-encoded).
            # Compare both the stored form and its percent-decoded form; record
            # which one matched so the encoding step is explicit, never hidden.
            from urllib.parse import unquote
            exp = known.get(name)
            if exp is not None and exp == text:
                decrypted[name].update(matches_known=True, match_form="stored-verbatim")
                match += 1
            elif exp is not None and exp == unquote(text):
                decrypted[name].update(matches_known=True,
                                       match_form="percent-decoded",
                                       decoded_plaintext=unquote(text))
                match += 1
            else:
                decrypted[name]["matches_known"] = False
                decrypted[name]["expected"] = exp
                mismatch += 1
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
