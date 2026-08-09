#!/usr/bin/env python3
"""Offline Windows DPAPI -> Chrome OSCrypt -> authenticated v10 recovery (#148).

This research parser runs only against a second-generation Working Copy. It never calls
Windows APIs and is intentionally not production code. DPAPI parsing and cryptography come
from Impacket 0.13.1's public implementation; Chrome row opening uses PyCryptodome AES-GCM.

Usage:
  python 148-recover.py WORKING_COPY --password '...' --out results.json
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import platform
import sqlite3
import sys
import tempfile
from pathlib import Path

from Cryptodome.Cipher import AES
from impacket.dpapi import DPAPI_BLOB, MasterKey, MasterKeyFile, deriveKeysFromUser
from impacket.uuid import bin_to_string


class Unavailable(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_manifest(root: Path, manifest: Path) -> dict:
    checked = 0
    mismatches = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        digest, rel = line.split("  ", 1)
        path = root / rel
        actual = sha256(path.read_bytes()) if path.is_file() else None
        checked += 1
        if actual != digest:
            mismatches.append({"path": rel, "expected": digest, "actual": actual})
    return {"checked": checked, "mismatches": mismatches, "ok": not mismatches}


def load_context(root: Path) -> tuple[str, dict]:
    path = root / "context/source_context.json"
    if not path.is_file():
        raise Unavailable("windows-sid-account-metadata-unavailable")
    context = json.loads(path.read_text(encoding="utf-8-sig"))
    sid = context.get("sid")
    if not sid:
        raise Unavailable("windows-sid-account-metadata-unavailable")
    return sid, context


def load_wrapper(root: Path) -> tuple[bytes, DPAPI_BLOB, str]:
    path = root / "chrome/udd/Local State"
    if not path.is_file():
        raise Unavailable("missing-windows-local-state")
    try:
        local_state = json.loads(path.read_text(encoding="utf-8-sig"))
        wrapped = base64.b64decode(local_state["os_crypt"]["encrypted_key"], validate=True)
    except Exception as exc:
        raise Unavailable("invalid-oscrypt-encrypted-key-wrapper") from exc
    if len(wrapped) <= 5 or wrapped[:5] != b"DPAPI":
        raise Unavailable("invalid-oscrypt-encrypted-key-wrapper")
    try:
        blob = DPAPI_BLOB(wrapped[5:])
        guid = bin_to_string(blob["GuidMasterKey"]).lower()
    except Exception as exc:
        raise Unavailable("invalid-oscrypt-encrypted-key-wrapper") from exc
    return wrapped[5:], blob, guid


def load_masterkey(root: Path, sid: str, guid: str) -> tuple[MasterKeyFile, MasterKey]:
    path = root / "dpapi/user-roaming-protect" / sid / guid
    if not path.is_file():
        raise Unavailable("missing-dpapi-master-key-material")
    try:
        raw = path.read_bytes()
        mkfile = MasterKeyFile(raw)
        if not mkfile["MasterKeyLen"]:
            raise ValueError("master key section absent")
        off = len(mkfile)
        masterkey = MasterKey(raw[off : off + mkfile["MasterKeyLen"]])
        return mkfile, masterkey
    except Exception as exc:
        raise Unavailable("invalid-dpapi-master-key-material") from exc


def decrypt_masterkey(masterkey: MasterKey, sid: str, password: str) -> tuple[bytes, str]:
    variants = ("sha1", "ntlm", "protected-user")
    for variant, user_key in zip(variants, deriveKeysFromUser(sid, password)):
        decrypted = masterkey.decrypt(user_key)
        if decrypted is not None:
            return decrypted, variant
    raise Unavailable("windows-user-credential-invalid")


def unwrap_oscrypt(blob: DPAPI_BLOB, masterkey: bytes) -> bytes:
    try:
        clear = blob.decrypt(masterkey)
    except Exception as exc:
        raise Unavailable("dpapi-unprotect-failed") from exc
    if clear is None:
        raise Unavailable("dpapi-unprotect-failed")
    if len(clear) != 32:
        raise Unavailable("invalid-oscrypt-key-length")
    return clear


def decrypt_cookie_row(key: bytes, host: str, encrypted: bytes) -> bytes:
    if len(key) != 32:
        raise Unavailable("invalid-oscrypt-key-length")
    if encrypted[:3] != b"v10" or len(encrypted) < 3 + 12 + 16:
        raise Unavailable("unsupported-row-prefix")
    try:
        cipher = AES.new(key, AES.MODE_GCM, nonce=encrypted[3:15])
        clear = cipher.decrypt_and_verify(encrypted[15:-16], encrypted[-16:])
    except Exception as exc:
        raise Unavailable("row-authentication-failed") from exc
    # Chrome DB version >=24 prepends SHA-256(host_key) to the encrypted cookie value.
    host_hash = hashlib.sha256(host.encode("utf-8")).digest()
    if not clear.startswith(host_hash):
        raise Unavailable("cookie-host-binding-failed")
    return clear[32:]


def recover(root: Path, password: str) -> dict:
    sid, context = load_context(root)
    _, blob, guid = load_wrapper(root)
    mkfile, mk = load_masterkey(root, sid, guid)
    masterkey, password_variant = decrypt_masterkey(mk, sid, password)
    row_key = unwrap_oscrypt(blob, masterkey)

    db = root / "chrome/udd/Default/Network/Cookies"
    if not db.is_file():
        raise Unavailable("cookies-database-unavailable")
    expected_path = root / "context/source_out/known_plaintext.json"
    expected = {}
    if expected_path.is_file():
        expected = {x["name"]: x["value"] for x in json.loads(expected_path.read_text())["cookies"]}

    con = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    meta_version = int(con.execute("select value from meta where key='version'").fetchone()[0])
    rows = []
    for rowid, name, host, encrypted in con.execute(
        "select rowid,name,host_key,encrypted_value from cookies where name like 'fx_%' order by name"
    ):
        clear = decrypt_cookie_row(row_key, host, encrypted)
        text = clear.decode("utf-8")
        rows.append(
            {
                "name": name,
                "plaintext": text,
                "known_plaintext_match": expected.get(name) == text,
                "authenticated": True,
                "provenance": {
                    "manifest_path": "chrome/udd/Default/Network/Cookies",
                    "database": "Cookies",
                    "table": "cookies",
                    "rowid": rowid,
                },
            }
        )
    con.close()
    if not rows or not all(r["known_plaintext_match"] for r in rows):
        raise Unavailable("known-plaintext-mismatch")
    return {
        "status": "ok",
        "source": {
            "arm": context.get("arm"),
            "os": context.get("os"),
            "sid": sid,
            "chrome_version": (root / "context/source_out/chrome_version.txt").read_text().strip(),
            "source_state": (root / "context/source_state.txt").read_text().strip(),
        },
        "dpapi": {
            "masterkey_guid": guid,
            "masterkey_file_version": mkfile["Version"],
            "password_derivation_variant": password_variant,
            "recovered_key_length": len(row_key),
            "recovered_key_sha256": sha256(row_key),
        },
        "cookies_meta_version": meta_version,
        "rows": rows,
    }


def outcome(fn) -> dict:
    try:
        value = fn()
        return value if isinstance(value, dict) else {"status": "ok", "value": value}
    except Unavailable as exc:
        return {"status": "unavailable", "reason": exc.reason}
    except Exception as exc:
        return {"status": "error", "reason": type(exc).__name__, "detail": str(exc)}


def sparse_root(source: Path, include: tuple[str, ...]) -> tempfile.TemporaryDirectory:
    """Create a temporary evidence shape with only named top-level components."""
    tmp = tempfile.TemporaryDirectory(prefix="fx148-control-")
    dst = Path(tmp.name)
    for name in include:
        (dst / name).symlink_to(source / name, target_is_directory=True)
    return tmp


def summary(result: dict) -> dict:
    if result.get("status") != "ok":
        return result
    return {"status": "ok", "matched_rows": len(result.get("rows", []))}


def controls(root: Path, password: str, baseline: dict) -> list[dict]:
    sid, _ = load_context(root)
    raw_blob, blob, guid = load_wrapper(root)
    _, mk = load_masterkey(root, sid, guid)
    masterkey, _ = decrypt_masterkey(mk, sid, password)
    row_key = unwrap_oscrypt(blob, masterkey)
    db = sqlite3.connect(f"file:{root / 'chrome/udd/Default/Network/Cookies'}?immutable=1", uri=True)
    name, host, encrypted = db.execute(
        "select name,host_key,encrypted_value from cookies where name='fx_ascii'"
    ).fetchone()
    db.close()

    wrong_pw = outcome(lambda: decrypt_masterkey(mk, sid, "WRONG-password-148"))
    mutated_wrapper = bytearray(raw_blob); mutated_wrapper[-20] ^= 1
    wrapper_out = outcome(lambda: unwrap_oscrypt(DPAPI_BLOB(bytes(mutated_wrapper)), masterkey))
    mutated_row = bytearray(encrypted); mutated_row[-17] ^= 1
    row_out = outcome(lambda: decrypt_cookie_row(row_key, host, bytes(mutated_row)))
    wrong_key = bytes([row_key[0] ^ 1]) + row_key[1:]
    wrong_key_out = outcome(lambda: decrypt_cookie_row(wrong_key, host, encrypted))
    length_out = outcome(lambda: decrypt_cookie_row(row_key[:-1], host, encrypted))

    # Execute acquisition-shape controls against sparse copies. No result below is hand-authored.
    with sparse_root(root, ("context", "chrome")) as t:
        udd_only = summary(outcome(lambda: recover(Path(t), password)))
    with sparse_root(root, ("context", "chrome", "dpapi")) as t:
        no_registry = summary(outcome(lambda: recover(Path(t), password)))
    with tempfile.TemporaryDirectory(prefix="fx148-profile-only-") as t:
        p = Path(t); (p / "chrome/udd/Default").mkdir(parents=True)
        profile_only = outcome(lambda: load_wrapper(p))
    with tempfile.TemporaryDirectory(prefix="fx148-no-mk-") as t:
        p = Path(t)
        (p / "context").symlink_to(root / "context", target_is_directory=True)
        (p / "chrome").symlink_to(root / "chrome", target_is_directory=True)
        (p / "dpapi/user-roaming-protect" / sid).mkdir(parents=True)
        missing_mk = summary(outcome(lambda: recover(p, password)))
    with tempfile.TemporaryDirectory(prefix="fx148-no-sid-") as t:
        p = Path(t); (p / "context").mkdir()
        (p / "context/source_context.json").write_text("{}")
        missing_sid = outcome(lambda: load_context(p))

    return [
        {"control": "correct-supplied-password", "result": summary(baseline)},
        {"control": "incorrect-supplied-password", "result": wrong_pw},
        {"control": "profile-directory-only", "result": profile_only},
        {"control": "user-data-directory-only", "result": udd_only},
        {"control": "missing-master-key-material", "result": missing_mk},
        {"control": "missing-sid-account-metadata", "result": missing_sid},
        {"control": "missing-registry-context", "result": no_registry},
        {"control": "cross-machine-non-Windows-analysis", "result": {"status": baseline["status"], "analysis_platform": platform.platform()}},
        {"control": "mutated-dpapi-wrapper", "result": wrapper_out},
        {"control": "mutated-v10-row", "result": row_out},
        {"control": "wrong-recovered-key", "result": wrong_key_out},
        {"control": "recovered-key-length-31", "result": length_out},
        {"control": "domain-backup-key-recovery", "result": {"status": "unavailable", "reason": "domain-lab-evidence-unavailable"}},
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("working_copy", type=Path)
    ap.add_argument("--password", required=True)
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    baseline = outcome(lambda: recover(args.working_copy, args.password))
    report = {
        "ticket": "https://github.com/ChmaraX/forensix/issues/148",
        "analysis_platform": platform.platform(),
        "analysis_python": sys.version,
        "parser": "Impacket 0.13.1 DPAPI structures + PyCryptodome AES-GCM",
        "working_copy": str(args.working_copy),
        "manifest_verification": verify_manifest(args.working_copy, args.manifest) if args.manifest else None,
        "recovery": baseline,
        "controls": controls(args.working_copy, args.password, baseline) if baseline.get("status") == "ok" else [],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if baseline.get("status") == "ok" and (not report["manifest_verification"] or report["manifest_verification"]["ok"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
