#!/bin/bash
# 147 — confirm the gate verdict on the KWallet6 build too.
#
# The Ubuntu 24.04 gate (kwalletd5 5.115.0) produced KWalletNoService and v10.
# This repeats the decisive measurement on Debian trixie with kwalletd6 6.13.0,
# so the verdict is not an artefact of one KWallet major version.
#
# Two states are measured for each token:
#   RUNNING  — kwalletd6 live and registered on the session bus
#   STOPPED  — no kwalletd on the bus at all
set -u
export DISPLAY=:99
export HOME=/home/suspect
export XDG_DATA_HOME=$HOME/.local/share
export XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
export DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bus147 2>/dev/null)

probe() {
  local label=$1 tok=$2
  rm -rf /tmp/k6-$label-$tok
  timeout 120 google-chrome --no-sandbox --password-store="$tok" \
    --user-data-dir=/tmp/k6-$label-$tok --no-first-run --no-default-browser-check \
    --headless=new --enable-logging=stderr --v=1 --virtual-time-budget=5000 \
    --dump-dom "file:///dev/null" >/dev/null 2>/tmp/k6-$label-$tok.log
  echo "### $label token=$tok rc=$? oscrypt_lines=$(grep -acE 'OSCrypt' /tmp/k6-$label-$tok.log)"
  grep -aE "OSCrypt" /tmp/k6-$label-$tok.log | sed 's/^.*\] //' | sort -u \
    | grep -E "InitStatus|KWallet|Available" | head -5
}

echo "=== kwalletd6 on bus: $(dbus-send --session --dest=org.freedesktop.DBus \
  --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
  | grep -c kwalletd6) ==="
echo "=== chrome: $(google-chrome --version) ==="
echo "=== kwallet6: $(dpkg-query -W -f='${Version}' kwallet6 2>/dev/null) ==="
echo

for TOK in kwallet kwallet5 kwallet6; do
  probe RUNNING "$TOK"
done

pkill -9 -f kwalletd6 2>/dev/null
sleep 3
echo
echo "=== kwalletd6 killed; on bus now: $(dbus-send --session --dest=org.freedesktop.DBus \
  --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
  | grep -c kwalletd6) ==="
echo

for TOK in kwallet6; do
  probe STOPPED "$TOK"
done
