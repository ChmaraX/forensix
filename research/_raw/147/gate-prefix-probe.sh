#!/bin/bash
# 147 STEP 1b — the decisive half of the reachability gate.
#
# Histograms tell us which provider Chrome SELECTED. They do not tell us what
# Chrome actually WROTE. This probe writes a real cookie through Chrome's own
# network stack for each KWallet token and reads back the row prefix.
#
#   v11 => a KWallet-derived key was used  => gate PASSES, build the Source
#   v10 => PosixKeyProvider fallback       => gate FAILS for that token
#
# Uses the same DevTools approach as #149 so the value is encrypted by Chrome,
# not synthesised by us.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect
export DISPLAY=:99
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=5

PID=$(pgrep -f kwalletd5 | head -1)
if [ -n "$PID" ]; then
  export DBUS_SESSION_BUS_ADDRESS=$(tr '\0' '\n' < /proc/$PID/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p')
fi
echo "kwalletd5 pid=${PID:-NONE} bus=${DBUS_SESSION_BUS_ADDRESS:-NONE}"

for TOK in "$@"; do
  UDD=/tmp/probe-$TOK
  rm -rf "$UDD"
  echo "########## token=$TOK"

  google-chrome --no-sandbox --password-store="$TOK" --user-data-dir="$UDD" \
    --no-first-run --no-default-browser-check --disable-gpu \
    --enable-logging=stderr --v=1 \
    --remote-debugging-port=9333 --headless=new about:blank >/dev/null 2>/tmp/probe-$TOK.log &
  sleep 10

  python3 - "$TOK" <<'PY'
import json, sys, urllib.request
try:
    from websockets.sync.client import connect  # noqa
except Exception:
    pass
tok = sys.argv[1]
try:
    tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json/list", timeout=10))
except Exception as e:
    print("devtools unreachable:", e); sys.exit(0)
page = [t for t in tabs if t.get("type") == "page"]
print("targets:", len(tabs), "page:", len(page))
PY

  # Set a cookie via the DevTools HTTP+WS endpoint using a minimal raw WS client.
  python3 /work/ws-setcookie.py 9333 "$TOK" 2>&1 | tail -3

  pkill -f "user-data-dir=$UDD" 2>/dev/null; sleep 4
  pkill -9 -f "user-data-dir=$UDD" 2>/dev/null; sleep 1

  echo "--- OSCrypt histograms ---"
  grep -aE "OSCrypt\." /tmp/probe-$TOK.log | sed 's/^.*\] //' | sort -u | head -10
  echo "--- cookie row prefixes ---"
  python3 /work/prefix-probe.py "$UDD" 2>&1 | tail -8
  echo
done
