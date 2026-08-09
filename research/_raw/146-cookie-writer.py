#!/usr/bin/env python3
"""146 — write known-plaintext cookies through Chrome's own cookie store.

STDLIB ONLY. Runs under /usr/bin/python3 (Command Line Tools) with a bare PATH,
because it executes inside a fresh `fxsuspect` GUI session that has none of the
analyst's shell setup. Do not add third-party imports: a Source must not have
packages installed into it.

Minimal RFC6455 client: HTTP GET /json to find a target, Upgrade handshake on a
raw socket, then masked text frames. Continuation frames, compression and ping
handling are deliberately omitted -- the frames here are small and few. The
2-byte header plus the 126-length extension IS handled, because a CDP reply can
exceed 125 bytes.

Cookies are set via Network.setCookie so the rows are encrypted by Chrome
itself. Authoring rows directly would defeat the point of the experiment.

THREE behaviours were established empirically on this host before the Source was
built. All are load-bearing, and the third overturned the original approach:

1. `Network.setCookie` returns success:true even when the cookie is REJECTED.
   Passing a bare `domain` for a non-navigated origin silently stores nothing.
   The return value is worthless as a check -- read the store back instead.
2. Cookies live in memory until Chrome shuts down cleanly. SIGTERM/SIGKILL lose
   them entirely; the on-disk `Cookies` table stays empty and the journal is 0
   bytes. This reproduces #117's live-acquisition finding.
3. DECISIVE: cookies injected over CDP `Network.setCookie` NEVER reach disk,
   even when `Network.getAllCookies` reports them present with session=False
   and a far-future expiry, and even after a clean `Browser.close`. Measured
   across 7 configurations (headless and headed, 127.0.0.1 and localhost).
   A cookie set by the PAGE via `document.cookie` persists normally and lands
   with a `v10` prefix. So known plaintext MUST be written by the page, not
   injected. CDP is used only to read the store back and to close cleanly.
"""
import base64
import json
import os
import socket
import struct
import sys
import urllib.parse
import urllib.request

KNOWN = {
    "fx_ascii": "ForensiX-ASCII-146-KNOWN",
    "fx_nonascii": "ForensiX-ÁÉÍÓÚ-áéí-řšč-日本語-🔐",
    "fx_block16": "0123456789abcdef",
    "fx_long": "L" * 200,
    "fx_empty_ish": "x",
}
PORT = int(os.environ.get("FX_PORT", "9222"))


def site_html():
    """The page that sets the known cookies itself. See docstring note 3."""
    lines = []
    for name, value in KNOWN.items():
        # encodeURIComponent matches how Chrome stores non-ASCII values, and is
        # why #149 saw percent-encoded plaintext after decryption.
        js_val = json.dumps(value)
        lines.append(
            f'document.cookie = {json.dumps(name)} + "=" + '
            f'encodeURIComponent({js_val}) + "; path=/; max-age=31536000";'
        )
    body = "\n".join(lines)
    return ("<html><body><h1>fx146</h1><script>\n"
            f"{body}\ndocument.title = 'fx146-cookies-set';\n"
            "</script></body></html>\n")


def ws_connect(url):
    _, rest = url.split("://", 1)
    hostport, path = rest.split("/", 1)
    host, port = hostport.split(":")
    s = socket.create_connection((host, int(port)), timeout=15)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((
        f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("handshake closed early")
        buf += chunk
    if b"101" not in buf.split(b"\r\n", 1)[0]:
        raise RuntimeError(f"handshake failed: {buf.split(chr(13).encode())[0]!r}")
    return s


def ws_send(s, text):
    payload = text.encode()
    mask = os.urandom(4)
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", 0x81, 0x80 | n)
    elif n < 65536:
        header = struct.pack("!BBH", 0x81, 0x80 | 126, n)
    else:
        header = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    s.sendall(header + mask + masked)


def _recv_exactly(s, n):
    out = b""
    while len(out) < n:
        chunk = s.recv(n - len(out))
        if not chunk:
            raise RuntimeError("socket closed mid-frame")
        out += chunk
    return out


def ws_recv(s):
    b0, b1 = _recv_exactly(s, 2)
    n = b1 & 0x7F
    if n == 126:
        n = struct.unpack("!H", _recv_exactly(s, 2))[0]
    elif n == 127:
        n = struct.unpack("!Q", _recv_exactly(s, 8))[0]
    if b1 & 0x80:                       # server frames are normally unmasked
        mask = _recv_exactly(s, 4)
        data = _recv_exactly(s, n)
        data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
    else:
        data = _recv_exactly(s, n)
    return data.decode("utf-8", "replace")


def main():
    # `--emit-site DIR` writes the cookie-setting page and exits. The caller
    # serves DIR and points Chrome at it, so the PAGE sets the cookies.
    if len(sys.argv) >= 3 and sys.argv[1] == "--emit-site":
        d = sys.argv[2]
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w") as fh:
            fh.write(site_html())
        with open(os.path.join(d, "known.json"), "w") as fh:
            json.dump(KNOWN, fh, ensure_ascii=False, indent=2)
        print(f"wrote {d}/index.html and {d}/known.json")
        return

    # Use the BROWSER endpoint, not a page target. A page session's
    # Network.getAllCookies reports an empty store here, which previously
    # produced a false NOT-STORED verdict while the rows were in fact fine.
    ver = json.load(urllib.request.urlopen(
        f"http://127.0.0.1:{PORT}/json/version", timeout=15))
    ws_url = ver.get("webSocketDebuggerUrl")
    if not ws_url:
        print("FX146_RESULT=FAIL no browser websocket on port", PORT)
        sys.exit(1)

    s = ws_connect(ws_url)

    # The page has already set the cookies via document.cookie by the time we
    # connect. Read the store back -- that is the only trustworthy check.
    # On the browser endpoint the method is Storage.getCookies;
    # Network.getAllCookies is a page-session method and errors here.
    ws_send(s, json.dumps({"id": 900, "method": "Storage.getCookies"}))
    reply = json.loads(ws_recv(s))
    if "result" not in reply:
        print(f"FX146_RESULT=FAIL Storage.getCookies error: {str(reply)[:160]}")
        s.close()
        sys.exit(1)
    got = reply["result"]["cookies"]
    present = {c["name"]: c["value"] for c in got}
    ok = 0
    for name, value in KNOWN.items():
        # The page percent-encodes, so compare against the encoded form.
        want = urllib.parse.quote(value, safe="")
        good = present.get(name) in (value, want)
        ok += good
        print(f"  {name}: {'STORED' if good else 'NOT-STORED'}")

    if ok != len(KNOWN):
        # Do not close the browser on a bad read: closing would destroy the
        # only chance to diagnose, and a partial Source is worse than none.
        print(f"FX146_RESULT=FAIL {ok}/{len(KNOWN)} in store; "
              f"seen={sorted(present)}")
        s.close()
        sys.exit(1)

    # Flush to disk. Cookies are memory-resident until a clean shutdown (#117).
    ws_send(s, json.dumps({"id": 999, "method": "Browser.close"}))
    try:
        ws_recv(s)
    except Exception:
        pass
    s.close()

    # Fail loudly. A silent partial write would poison the whole experiment.
    print(f"FX146_RESULT={'OK' if ok == len(KNOWN) else 'FAIL'} {ok}/{len(KNOWN)} cookies verified in store")
    sys.exit(0 if ok == len(KNOWN) else 1)


if __name__ == "__main__":
    main()
