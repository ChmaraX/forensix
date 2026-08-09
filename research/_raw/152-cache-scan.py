#!/usr/bin/env python3
"""Signature scanner for issue #152: does NOT assume a cache path. Walks one or
more roots recursively and reports every file matching any of the three known
Chrome HTTP cache backend signatures:

  - SQL backend:        the ASCII string "SQLCache3Sql" anywhere in the file
  - Simple Cache:       the 8-byte magic 30 5c 72 a7 1b 6d fb fc
                         (little-endian 0xfcfb6d1ba7725c30) at the start of a
                         file, plus the 16-hex-char filename convention
  - blockfile backend:  filenames matching data_0..data_3 or f_XXXXXX (6 hex)

Usage: 152-cache-scan.py <root1> [root2 ...]
"""
import os
import re
import sys
import json

SQL_MAGIC = b"SQLCache3Sql"
SIMPLE_MAGIC = bytes.fromhex("305c72a71b6dfbfc")  # little-endian 0xfcfb6d1ba7725c30
SIMPLE_NAME_RE = re.compile(r"^[0-9a-f]{16}_[0-9s]$")
BLOCKFILE_DATA_RE = re.compile(r"^data_[0-3]$")
BLOCKFILE_F_RE = re.compile(r"^f_[0-9a-f]{6}$")

MAX_READ_BYTES = 8 * 1024 * 1024  # 8MB cap per file — generous for cache entries


def scan_root(root):
    findings = {
        "root": root,
        "root_exists": os.path.isdir(root),
        "sql_magic_files": [],
        "simple_magic_files": [],
        "simple_cache_named_files": [],
        "blockfile_data_files": [],
        "blockfile_f_files": [],
        "files_scanned": 0,
        "bytes_scanned": 0,
    }
    if not findings["root_exists"]:
        return findings

    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            if SIMPLE_NAME_RE.match(name):
                findings["simple_cache_named_files"].append(full)
            if BLOCKFILE_DATA_RE.match(name):
                findings["blockfile_data_files"].append(full)
            if BLOCKFILE_F_RE.match(name):
                findings["blockfile_f_files"].append(full)
            try:
                size = os.path.getsize(full)
                with open(full, "rb") as fh:
                    data = fh.read(MAX_READ_BYTES)
                findings["files_scanned"] += 1
                findings["bytes_scanned"] += len(data)
                if SQL_MAGIC in data:
                    findings["sql_magic_files"].append(full)
                if data[:8] == SIMPLE_MAGIC:
                    findings["simple_magic_files"].append(full)
            except (PermissionError, OSError) as e:
                findings.setdefault("unreadable_files", []).append(f"{full}: {e}")
    return findings


def main():
    roots = sys.argv[1:]
    report = {"roots": [scan_root(r) for r in roots]}
    total = {
        "sql_magic_total": sum(len(r["sql_magic_files"]) for r in report["roots"]),
        "simple_magic_total": sum(len(r["simple_magic_files"]) for r in report["roots"]),
        "simple_cache_named_total": sum(len(r["simple_cache_named_files"]) for r in report["roots"]),
        "blockfile_data_total": sum(len(r["blockfile_data_files"]) for r in report["roots"]),
        "blockfile_f_total": sum(len(r["blockfile_f_files"]) for r in report["roots"]),
    }
    report["totals"] = total
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
