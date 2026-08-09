#!/usr/bin/env python3
"""147 — write KNOWN ASCII + non-ASCII cookie plaintext through BRANDED Chrome,
with KWallet as the selected OSCrypt provider.

Same known-plaintext set as #149, deliberately: the two experiments then differ
only in the provider, so a KWallet result can be compared against the GNOME
Keyring result row for row.

Chrome does its own encryption with its own selected provider. We never encrypt
anything ourselves; doing so would prove nothing about the provider.

No network egress and no case data: cookies are set on a localhost origin served
by a throwaway in-process HTTP server.
"""
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import quote

KNOWN = [
    ("fx_ascii",       "ForensiX-ASCII-147-KNOWN"),
    ("fx_nonascii",    "ForensiX-ÁÉÍÓÚ-\u00e1\u00e9\u00ed-\u0159\u0161\u010d-\u65e5\u672c\u8a9e-\U0001f510"),
    ("fx_block16",     "0123456789abcdef"),          # exactly one AES block
    ("fx_long",        "L" * 200),
    ("fx_empty_ish",   "x"),
]


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        for name, value in KNOWN:
            self.send_header(
                "Set-Cookie",
                f"{name}={quote(value)}; Path=/; Max-Age=31536000; SameSite=Lax",
            )
        self.end_headers()
        self.wfile.write(b"<html><body>fx147</body></html>")

    def log_message(self, *a):
        pass


def main():
    udd, out = sys.argv[1], sys.argv[2]
    token = sys.argv[3] if len(sys.argv) > 3 else "kwallet6"
    port = free_port()
    srv = http.server.HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    # Record the expectation BEFORE Chrome runs.
    with open(os.path.join(out, "known_plaintext.json"), "w") as f:
        json.dump({n: v for n, v in KNOWN}, f, ensure_ascii=False, indent=2)
    print(f"recorded {len(KNOWN)} known plaintext cookies")

    proc = subprocess.Popen(
        [
            "google-chrome", "--no-sandbox",
            f"--password-store={token}",
            f"--user-data-dir={udd}",
            "--no-first-run", "--no-default-browser-check",
            "--headless=new",
            "--enable-logging=stderr", "--v=1",
            "--virtual-time-budget=8000",
            "--dump-dom", f"http://127.0.0.1:{port}/",
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        so, se = proc.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        proc.kill()
        so, se = proc.communicate()
    with open(os.path.join(out, "cookie_write_stderr.txt"), "wb") as f:
        f.write(se)
    print("chrome exited rc=", proc.returncode)
    print("dom:", (so or b"")[:120])
    time.sleep(3)
    srv.shutdown()


if __name__ == "__main__":
    main()
