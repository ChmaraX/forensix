#!/bin/bash
# 147 — KWallet6 Source session: create a PASSWORD-PROTECTED wallet with no GUI
# dialog, then let Chrome use it.
#
# kwalletd6 6.13.0 accepts --pam-login (kwalletd5 5.115.0 does not), so the
# wallet can be created and unlocked from a socket with a known password.
# Wallet password is recorded OUTSIDE the Source set; it is a case credential.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect
export XDG_DATA_HOME=$HOME/.local/share
export XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
export DISPLAY=:99
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
chmod 700 "$XDG_RUNTIME_DIR"

WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"
WALLET_NAME="${WALLET_NAME:-kdewallet}"

pgrep Xvfb >/dev/null || { Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pgrep fluxbox >/dev/null || { fluxbox >/tmp/fluxbox.log 2>&1 & sleep 1; }

pkill -9 -f kwalletd6 2>/dev/null
sleep 1
rm -rf "$XDG_DATA_HOME/kwalletd"

eval "$(dbus-launch --sh-syntax)"
echo "$DBUS_SESSION_BUS_ADDRESS" > /tmp/bus147
echo "bus=$DBUS_SESSION_BUS_ADDRESS"

cat > "$XDG_CONFIG_HOME/kwalletrc" <<CFG
[Wallet]
First Use=false
Enabled=true
Use One Wallet=true
Default Wallet=$WALLET_NAME
Prompt on Open=false
Close on Screensaver=false
Close When Idle=false
Leave Open=true
CFG

echo "--- starting kwalletd6 via --pam-login (headless) ---"
WALLET_PASSWORD="$WALLET_PASSWORD" KWALLETD=kwalletd6 LOG=/tmp/kwalletd6.log \
  bash /work/kwallet-pam-start.sh
sleep 3

echo "--- wallet files after pam-login ---"
find "$XDG_DATA_HOME/kwalletd" -type f 2>/dev/null || echo "(none)"
echo "--- wallets over D-Bus ---"
dbus-send --session --dest=org.kde.kwalletd6 --print-reply /modules/kwalletd6 \
  org.kde.KWallet.wallets 2>&1 | tail -3
echo "--- networkWallet ---"
dbus-send --session --dest=org.kde.kwalletd6 --print-reply /modules/kwalletd6 \
  org.kde.KWallet.networkWallet 2>&1 | tail -1
echo "--- kwalletd6 log ---"
grep -avE "QSocketNotifier|^qt\." /tmp/kwalletd6.log 2>/dev/null | head -6
