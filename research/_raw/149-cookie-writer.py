#!/usr/bin/env python3
"""149 — write KNOWN ASCII + non-ASCII cookie plaintext through BRANDED Chrome.

Drives Chrome over the DevTools protocol so the cookie rows are encrypted by
Chrome's own selected key provider. We never encrypt anything ourselves; doing so
would prove nothing about the provider.

No network egress and no case data: cookies are set on a localhost origin served
by a throwaway in-process HTTP server.

The known plaintext is written to <out>/known_plaintext.json BEFORE acquisition,
so the later decryption comparison is against a pre-recorded expectation.
"""
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request

# Known plaintext under test. Deliberately includes non-ASCII (the ticket requires
# both), a long value that will span >1 AES block, and an exact-block-boundary value
# so CBC padding behaviour is exercised.
KNOWN = [
    ("fx_ascii",       "ForensiX-ASCII-149-KNOWN"),
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
            # Cookie values are percent-encoded on the wire; Chrome stores the
            # decoded form. We record the decoded form as the expectation.
            from urllib.parse import quote
            self.send_header(
                "Set-Cookie",
                f"{name}={quote(value)}; Path=/; Max-Age=31536000; SameSite=Lax",
            )
        self.end_headers()
        self.wfile.write(b"<html><body>fx149</body></html>")

    def log_message(self, *a):
        pass


def main():
    udd, out = sys.argv[1], sys.argv[2]
    port = free_port()
    srv = http.server.HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    # Record the expectation BEFORE Chrome runs.
    from urllib.parse import quote, unquote
    expect = {name: value for name, value in KNOWN}
    with open(os.path.join(out, "known_plaintext.json"), "w") as f:
        json.dump(expect, f, ensure_ascii=False, indent=2)
    print(f"recorded {len(expect)} known plaintext cookies")

    # Launch Chrome against the local origin with the provider still forced.
    proc = subprocess.Popen(
        [
            "google-chrome", "--no-sandbox",
            "--password-store=gnome-libsecret",
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
        so, se = proc.communicate(timeout=90)
    except subprocess.TimeoutExpired:
        proc.kill()
        so, se = proc.communicate()
    with open(os.path.join(out, "cookie_write_stderr.txt"), "wb") as f:
        f.write(se)
    print("chrome exited rc=", proc.returncode)
    print("dom:", (so or b"")[:200])

    # Give Chrome time to flush the cookie DB, then let the caller stop it.
    time.sleep(3)
    srv.shutdown()


if __name__ == "__main__":
    main()
