#!/bin/bash
# 147 — Source acquisition: force Chrome's KWallet provider, write known plaintext,
# then shut down cleanly and export the Source set.
# Runs INSIDE the disposable Source container as the dedicated user.
set -u

VARIANT="${VARIANT:-kwallet6}"          # kwallet6 | kwallet5
KWALLETD="${KWALLETD:-kwalletd6}"
WALLET_NAME="${WALLET_NAME:-kdewallet}"
WALLET_PASSWORD="${WALLET_PASSWORD:-}"  # supplied by the harness, recorded OUTSIDE the Source
OUT=/out
export HOME=/home/suspect
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_RUNTIME_DIR=/tmp/xdgrt-$$
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$OUT"
chmod 700 "$XDG_RUNTIME_DIR"

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

########## 1. desktop session ##########
export XDG_CURRENT_DESKTOP=KDE
export DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true
export KDE_SESSION_VERSION="${KDE_SESSION_VERSION:-6}"
export DISPLAY=:99

Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 &
sleep 2
fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 1

eval "$(dbus-launch --sh-syntax)"
log "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"

########## 2. kwalletd with a NON-INTERACTIVE known password ##########
# KWallet's own daemon always prompts. To create the wallet with a known password
# without a GUI prompt, pre-create it with the KDE backend library semantics via
# kwalletd's D-Bus API is not possible headless. Instead we drive kwalletd with
# its PAM-style stdin unlock hook (--pam-login) which accepts the password on an fd.
mkdir -p "$XDG_CONFIG_HOME"
cat > "$XDG_CONFIG_HOME/kwalletrc" <<EOF
[Wallet]
First Use=false
Enabled=true
Use One Wallet=true
Default Wallet=$WALLET_NAME
Prompt on Open=false
Close on Screensaver=false
Close When Idle=false
Leave Open=true
EOF

# PAM hook: kwalletd<N> --pam-login <fd_socket> <fd_env>
# It reads the wallet password from the given socket and creates/opens the wallet
# with NO GUI prompt. This is the documented headless unlock path.
PAMSOCK=/tmp/kwallet-pam.sock
rm -f "$PAMSOCK"

python3 - "$PAMSOCK" "$WALLET_PASSWORD" <<'PY' &
import socket, sys, os, time
path, pw = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.bind(path); s.listen(1)
os.chmod(path, 0o600)
conn, _ = s.accept()
# kwalletd pam protocol: 4-byte little-endian length, then the password bytes
b = pw.encode()
conn.sendall(len(b).to_bytes(4, 'little') + b)
time.sleep(1)
conn.close()
PY
PAMPID=$!
sleep 1

log "starting $KWALLETD (pam-login headless unlock)"
$KWALLETD --pam-login 3 4 3<>"$PAMSOCK" 4</dev/null >/tmp/kwalletd.log 2>&1 &
KWPID=$!
sleep 4

if ! kill -0 $KWPID 2>/dev/null; then
  log "pam-login mode failed, falling back to plain daemon start"
  cat /tmp/kwalletd.log
  $KWALLETD >/tmp/kwalletd.log 2>&1 &
  KWPID=$!
  sleep 4
fi
log "kwalletd pid=$KWPID"
ps aux | grep -E "kwalletd" | grep -v grep > "$OUT/process_list_kwalletd.txt"

# Prove the wallet is reachable and record which wallets exist
qdbus6 org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.wallets \
  > "$OUT/kwallet_wallets_before.txt" 2>&1 || \
  qdbus org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.wallets \
  > "$OUT/kwallet_wallets_before.txt" 2>&1 || echo "qdbus query failed" > "$OUT/kwallet_wallets_before.txt"
cat "$OUT/kwallet_wallets_before.txt"

# Also record the networkWallet selection Chrome will ask for
qdbus6 org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.networkWallet \
  > "$OUT/kwallet_network_wallet.txt" 2>&1 || \
  qdbus org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.networkWallet \
  > "$OUT/kwallet_network_wallet.txt" 2>&1 || echo "unavailable" > "$OUT/kwallet_network_wallet.txt"
log "networkWallet=$(cat "$OUT/kwallet_network_wallet.txt")"

########## 3. Chrome with the provider FORCED ##########
USER_DATA_DIR="$HOME/chrome-user-data"
rm -rf "$USER_DATA_DIR"
log "launching Chrome with --password-store=$VARIANT (EXPLICIT, not auto-detect)"

google-chrome \
  --password-store="$VARIANT" \
  --user-data-dir="$USER_DATA_DIR" \
  --no-first-run --no-default-browser-check --disable-gpu \
  --disable-features=DialMediaRouteProvider \
  --enable-logging=stderr --v=1 \
  --no-sandbox \
  "about:blank" >/tmp/chrome.log 2>&1 &
CHPID=$!
sleep 12

grep -iE "oscrypt|key_?provider|kwallet|libsecret|password.?store|KeyStorage" /tmp/chrome.log \
  | head -100 > "$OUT/chrome_keyprovider_log.txt" || true
log "--- chrome key provider log ---"; cat "$OUT/chrome_keyprovider_log.txt"

########## 4. known plaintext ##########
# Cookies are written by Chrome itself through the network stack, so they carry
# the real provider prefix. ASCII and non-ASCII values.
cat > /tmp/setcookies.py <<'PY'
import json, urllib.request, subprocess, time, sys
# Use Chrome's own devtools to set cookies on a real origin.
PY
# Simpler and more faithful: drive via DevTools protocol over the debugging port.
google-chrome --password-store="$VARIANT" --user-data-dir="$USER_DATA_DIR" \
  --no-first-run --no-default-browser-check --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 "about:blank" >/tmp/chrome2.log 2>&1 &
sleep 8

python3 - "$OUT" <<'PY'
import json, urllib.request, socket, base64, sys, time
out = sys.argv[1]
def http(path):
    return json.load(urllib.request.urlopen("http://127.0.0.1:9222"+path, timeout=10))
try:
    tabs = http("/json/list")
except Exception as e:
    print("devtools unreachable:", e); sys.exit(0)
ws = [t for t in tabs if t.get("type")=="page"]
if not ws:
    print("no page target"); sys.exit(0)
url = ws[0]["webSocketDebuggerUrl"]
try:
    from websocket import create_connection
except ImportError:
    print("no websocket module; using HTTP-only fallback"); sys.exit(0)
PY

########## 5. known plaintext via Chrome's own cookie store ##########
# Navigate to a data: page then set cookies through DevTools HTTP endpoint is not
# available; instead use a local origin served by python and Set-Cookie headers,
# which forces Chrome to persist through its real encryption path.
python3 - <<'PY' &
import http.server, socketserver
COOKIES = [
    ("fx_ascii",   "FORENSIX-KNOWN-ASCII-147"),
    ("fx_nonascii","FORENSIX-\u00e9\u00e8\u00fc-\u4e2d\u6587-\U0001f510-147"),
    ("fx_long",    "X"*180),
]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        for n,v in COOKIES:
            from urllib.parse import quote
            self.send_header("Set-Cookie", f"{n}={quote(v)}; Path=/; Max-Age=99999999")
        self.send_header("Content-Type","text/html")
        self.end_headers()
        self.wfile.write(b"<html><body>forensix 147</body></html>")
    def log_message(self,*a): pass
with socketserver.TCPServer(("127.0.0.1",8147), H) as s:
    s.serve_forever()
PY
SRVPID=$!
sleep 2

# Record the expected plaintext OUTSIDE the Source
python3 - "$OUT" <<'PY'
import json,sys
COOKIES = [
    ("fx_ascii",   "FORENSIX-KNOWN-ASCII-147"),
    ("fx_nonascii","FORENSIX-\u00e9\u00e8\u00fc-\u4e2d\u6587-\U0001f510-147"),
    ("fx_long",    "X"*180),
]
json.dump({n:v for n,v in COOKIES}, open(sys.argv[1]+"/expected_plaintext.json","w"),
          ensure_ascii=False, indent=2)
PY

google-chrome --password-store="$VARIANT" --user-data-dir="$USER_DATA_DIR" \
  --no-first-run --no-default-browser-check --disable-gpu --no-sandbox \
  --headless=new --virtual-time-budget=8000 --dump-dom \
  "http://127.0.0.1:8147/" >/tmp/chrome-visit.log 2>&1
sleep 3

########## 6. shut Chrome down, THEN the services ##########
log "shutting Chrome down gracefully"
pkill -TERM -f "user-data-dir=$USER_DATA_DIR" 2>/dev/null
sleep 6
pkill -KILL -f "user-data-dir=$USER_DATA_DIR" 2>/dev/null
sleep 2
kill $SRVPID 2>/dev/null

########## 7. record the prefix BEFORE shutting the wallet ##########
python3 - "$USER_DATA_DIR" "$OUT" <<'PY'
import sqlite3, sys, json, os
udd, out = sys.argv[1], sys.argv[2]
db = os.path.join(udd, "Default", "Cookies")
res = {"db": db, "exists": os.path.exists(db), "rows": []}
if res["exists"]:
    c = sqlite3.connect(f"file:{db}?immutable=1", uri=True)
    for name, ev, host in c.execute(
            "SELECT name, encrypted_value, host_key FROM cookies"):
        res["rows"].append({
            "name": name, "host": host,
            "prefix": ev[:3].decode("ascii","replace") if ev else None,
            "len": len(ev) if ev else 0,
            "hex_head": ev[:32].hex() if ev else None,
        })
    c.close()
json.dump(res, open(out+"/cookie_prefixes.json","w"), indent=2)
pref = sorted({r["prefix"] for r in res["rows"] if r["prefix"]})
print("PREFIXES:", pref)
open(out+"/PREFIX_VERDICT.txt","w").write(",".join(pref) or "NO_ROWS")
PY
log "--- prefix verdict: $(cat "$OUT/PREFIX_VERDICT.txt" 2>/dev/null) ---"

# What did Chrome actually store in the wallet?
qdbus6 org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.wallets > "$OUT/kwallet_wallets_after.txt" 2>&1 || \
  qdbus org.kde.$KWALLETD /modules/$KWALLETD org.kde.KWallet.wallets > "$OUT/kwallet_wallets_after.txt" 2>&1 || true

########## 8. stop the wallet daemon, then export the Source set ##########
log "stopping kwalletd (flush wallet to disk)"
kill -TERM $KWPID 2>/dev/null
sleep 5
kill -KILL $KWPID 2>/dev/null || true
sleep 1

log "=== Source export ==="
mkdir -p "$OUT/source"
# browser User Data dir
[ -d "$USER_DATA_DIR" ] && cp -a "$USER_DATA_DIR" "$OUT/source/chrome-user-data"
# ALL wallet files + XDG/KDE configuration
mkdir -p "$OUT/source/xdg-data" "$OUT/source/xdg-config"
[ -d "$XDG_DATA_HOME/kwalletd" ] && cp -a "$XDG_DATA_HOME/kwalletd" "$OUT/source/xdg-data/kwalletd"
[ -d "$HOME/.kde/share/apps/kwallet" ] && cp -a "$HOME/.kde/share/apps/kwallet" "$OUT/source/xdg-data/kwallet-legacy"
[ -d "$HOME/.local/share/kwalletd" ] && cp -a "$HOME/.local/share/kwalletd" "$OUT/source/xdg-data/kwalletd-explicit" 2>/dev/null
for f in kwalletrc; do
  [ -f "$XDG_CONFIG_HOME/$f" ] && cp -a "$XDG_CONFIG_HOME/$f" "$OUT/source/xdg-config/$f"
done

find "$OUT/source" -type f | sed "s|$OUT/source/||" | sort > "$OUT/source_file_list.txt"
log "wallet files found:"; find "$OUT/source" -name "*.kwl" -o -name "*.salt" | tee "$OUT/wallet_files.txt"

########## 9. provider/version evidence ##########
{
  echo "=== variant forced ==="; echo "$VARIANT"
  echo "=== chrome ==="; google-chrome --version
  echo "=== kwalletd ==="; $KWALLETD --version 2>&1 | head -3
  echo "=== packages ==="; dpkg -l | grep -iE "kwallet|chrome" | awk '{print $2, $3}'
  echo "=== os ==="; cat /etc/os-release | head -3
  echo "=== arch ==="; dpkg --print-architecture
} > "$OUT/provider_versions.txt" 2>&1
cat "$OUT/provider_versions.txt"

cp /tmp/chrome.log "$OUT/chrome_full.log" 2>/dev/null || true
cp /tmp/kwalletd.log "$OUT/kwalletd.log" 2>/dev/null || true
log "DONE"
