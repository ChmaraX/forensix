#!/usr/bin/env python3
"""149 — report the OSCrypt row prefix for every encrypted cookie value.

The prefix is the evidence of which key provider Chrome actually used:
  v10 = PosixKeyProvider fallback (hardcoded "peanuts")
  v11 = Secret Service / GNOME Keyring provider
  v12 = Secret Portal (out of scope, see #144)
Reads the Cookies DB read-only; never writes.
"""
import glob
import os
import sqlite3
import sys


def probe(udd):
    hits = []
    for db in glob.glob(os.path.join(udd, "**", "Cookies"), recursive=True):
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            rows = con.execute(
                "SELECT name, encrypted_value, length(encrypted_value) FROM cookies"
            ).fetchall()
            con.close()
        except Exception as e:  # noqa: BLE001
            print(f"{db}: UNREADABLE {e}")
            continue
        print(f"--- {db} ({len(rows)} rows) ---")
        for name, ev, ln in rows:
            prefix = bytes(ev[:3]) if ev else b""
            hits.append(prefix)
            print(f"  {name:16s} prefix={prefix!r} len={ln}")
    if hits:
        uniq = sorted({p.decode('ascii', 'replace') for p in hits})
        print(f"DISTINCT PREFIXES: {uniq}")
    else:
        print("NO COOKIE ROWS FOUND")


if __name__ == "__main__":
    probe(sys.argv[1])
