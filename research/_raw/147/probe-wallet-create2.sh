#!/bin/bash
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect
export XDG_DATA_HOME="$HOME/.local/share" XDG_CONFIG_HOME="$HOME/.config"
export XDG_RUNTIME_DIR=/tmp/rt; mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"; chmod 700 "$XDG_RUNTIME_DIR"
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
export DISPLAY=:99
Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 &
sleep 2
fluxbox >/tmp/fb.log 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"

cat > "$XDG_CONFIG_HOME/kwalletrc" <<CFG
[Wallet]
First Use=false
Enabled=true
Use One Wallet=true
Default Wallet=kdewallet
Prompt on Open=false
Leave Open=true
CFG

kwalletd6 >/tmp/kw.log 2>&1 &
sleep 4
echo "=== open with GUI available, drive dialog with xdotool ==="
( timeout 40 qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.open kdewallet 0 forensix > /tmp/open.out 2>&1; echo "open_exit=$?" >> /tmp/open.out ) &
sleep 6
echo "--- windows present ---"
xdotool search --name "." getwindowname %@ 2>/dev/null | head -20
echo "--- typing password ---"
# KWallet's "create wallet" wizard: type password twice
xdotool type --delay 80 "FX147walletpw"
sleep 1; xdotool key Tab; sleep 1
xdotool type --delay 80 "FX147walletpw"
sleep 1; xdotool key Return
sleep 8
echo "--- windows after ---"
xdotool search --name "." getwindowname %@ 2>/dev/null | head -20
wait 2>/dev/null
echo "=== open result ==="; cat /tmp/open.out 2>/dev/null
echo "=== wallets ==="; qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.wallets 2>&1
echo "=== data dir ==="; find "$XDG_DATA_HOME" -type f 2>/dev/null | head
echo "=== kwalletd log ==="; grep -v "^qt\." /tmp/kw.log | head -20
