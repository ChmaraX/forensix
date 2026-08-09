#!/bin/bash
# 147 — gate control: Chrome's KWallet behaviour with NO kwalletd on the bus.
#
# Purpose. Run A of the gate showed Chrome producing ZERO OSCrypt histograms
# while kwalletd5 was live, and KWalletNoService when it was not reachable.
# This control separates the two states cleanly and records, for each token,
# whether Chrome completes provider initialisation at all.
#
# Must be run as a FILE (not an inline docker exec heredoc): killing kwalletd5
# from inside an exec session also kills the session that started it.
set -u
export DISPLAY=:99
export HOME=/home/suspect
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=5
export DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bus147 2>/dev/null)

pkill -9 -f kwalletd5 2>/dev/null
sleep 3

echo "kwalletd5 processes alive : $(ps aux | grep -c '[k]walletd5')"
echo "kwalletd5 names on bus    : $(dbus-send --session --dest=org.freedesktop.DBus \
    --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
    | grep -c kwalletd5)"
echo

for TOK in kwallet5 kwallet6 kwallet; do
  rm -rf /tmp/nb-$TOK
  timeout 120 google-chrome --no-sandbox --password-store="$TOK" \
    --user-data-dir=/tmp/nb-$TOK --no-first-run --no-default-browser-check \
    --headless=new --enable-logging=stderr --v=1 --virtual-time-budget=5000 \
    --dump-dom "file:///dev/null" >/dev/null 2>/tmp/nb-$TOK.log
  rc=$?
  echo "### token=$TOK chrome_rc=$rc oscrypt_lines=$(grep -acE 'OSCrypt' /tmp/nb-$TOK.log)"
  grep -aE "OSCrypt" /tmp/nb-$TOK.log | sed 's/^.*\] //' | sort -u | head -8
  echo
done
