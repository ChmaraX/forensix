"""Issue #148 Source-side inspection: prove the rows are legacy `v10`, not `v20`.

Runs on the Windows Source after Chrome has exited. Reads the Cookies DB read-only
and records the per-row prefix and ciphertext, plus the Local State wrapper shape.
No decryption happens here - the Source must never demonstrate the answer.
"""
import base64
import json
import os
import shutil
import sqlite3
import sys
import tempfile

udd = sys.argv[1]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)

report = {"udd": udd}

# --- Local State wrapper -------------------------------------------------
ls_path = os.path.join(udd, "Local State")
if os.path.exists(ls_path):
    with open(ls_path, "r", encoding="utf-8", errors="replace") as fh:
        ls = json.load(fh)
    oc = ls.get("os_crypt", {})
    report["os_crypt_keys"] = sorted(oc.keys())
    ek = oc.get("encrypted_key")
    if ek:
        raw = base64.b64decode(ek)
        report["encrypted_key_b64_len"] = len(ek)
        report["encrypted_key_raw_len"] = len(raw)
        report["encrypted_key_prefix"] = raw[:5].decode("latin-1")
        report["dpapi_blob_len"] = len(raw) - 5
    abk = oc.get("app_bound_encrypted_key")
    report["app_bound_encrypted_key_present"] = abk is not None
    if abk:
        report["app_bound_prefix"] = base64.b64decode(abk)[:4].decode("latin-1")
else:
    report["local_state"] = "ABSENT"

# --- Cookie rows ---------------------------------------------------------
cookies_db = None
for cand in ("Default/Network/Cookies", "Default/Cookies"):
    p = os.path.join(udd, cand.replace("/", os.sep))
    if os.path.exists(p):
        cookies_db = p
        break
report["cookies_db"] = cookies_db

rows = []
if cookies_db:
    tmp = tempfile.mkdtemp()
    copy = os.path.join(tmp, "Cookies")
    shutil.copy2(cookies_db, copy)
    for side in ("-wal", "-shm"):
        if os.path.exists(cookies_db + side):
            shutil.copy2(cookies_db + side, copy + side)
    con = sqlite3.connect(copy)
    for name, host, val in con.execute(
        "SELECT name, host_key, encrypted_value FROM cookies ORDER BY name"
    ):
        rows.append(
            {
                "name": name,
                "host_key": host,
                "prefix": val[:3].decode("latin-1", "replace"),
                "len": len(val),
                "hex": val.hex(),
            }
        )
    con.close()

report["rows"] = rows
report["distinct_prefixes"] = sorted({r["prefix"] for r in rows})

with open(os.path.join(out, "source_rows.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))
print("DISTINCT PREFIXES:", report["distinct_prefixes"])
