#!/usr/bin/env python3
"""Positive control for issue #152: prove the driven Chrome session actually
browsed something, by counting rows in its own History database. A run with
zero rows here is VOID — it says nothing about the cache backend, because
Chrome never did any browsing to populate a cache with.

Usage: 152-history-check.py <user-data-dir>
"""
import sqlite3
import sys
import os
import shutil
import tempfile
import json

def main():
    udd = sys.argv[1]
    history_path = os.path.join(udd, "Default", "History")
    result = {"history_path": history_path, "exists": os.path.exists(history_path)}

    if not result["exists"]:
        result["urls_count"] = None
        result["visits_count"] = None
        result["verdict"] = "VOID — History database does not exist at all"
        print(json.dumps(result, indent=2))
        return

    # Chrome is expected to be fully closed by this point (graceful shutdown
    # already awaited by the driver). Copy to avoid any residual lock, and to
    # avoid mutating the evidence in place.
    tmp = tempfile.mkdtemp()
    copy_path = os.path.join(tmp, "History")
    shutil.copy2(history_path, copy_path)
    # WAL sidecar, if present, holds the most recent rows.
    for suffix in ("-wal", "-shm", "-journal"):
        side = history_path + suffix
        if os.path.exists(side):
            shutil.copy2(side, copy_path + suffix)
            result[f"sidecar{suffix}_present"] = True

    con = sqlite3.connect(copy_path)
    try:
        cur = con.cursor()
        cur.execute("SELECT COUNT(*) FROM urls")
        result["urls_count"] = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM visits")
        result["visits_count"] = cur.fetchone()[0]
        cur.execute("SELECT url FROM urls ORDER BY id DESC LIMIT 10")
        result["sample_urls"] = [r[0] for r in cur.fetchall()]
    finally:
        con.close()

    if result["urls_count"] == 0 or result["visits_count"] == 0:
        result["verdict"] = "VOID — History has zero rows; Chrome did not browse"
    else:
        result["verdict"] = f"LIVE — {result['urls_count']} urls, {result['visits_count']} visits recorded"

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
