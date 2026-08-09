#!/bin/bash
# 147 (attempt 2) — bring up a virtual X session + session bus + kwalletd6.
#
# The attempt-1 blocker was wallet creation: kwalletd raises a GUI dialog and
# Chrome will not wait on it. Attempt 1 tried to bypass the dialog via
# pam_kwallet and did not finish the environment framing. This attempt does the
# opposite: give the daemon a real (virtual) display and ANSWER the dialog.
#
# Idempotent: safe to re-run.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect
export XDG_DATA_HOME=$HOME/.local/share
export XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
export DISPLAY=:99

WALLET_NAME="${WALLET_NAME:-kdewallet}"

mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"
chmod 700 "$XDG_RUNTIME_DIR"

pgrep -x Xvfb >/dev/null || { setsid nohup Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pgrep -x fluxbox >/dev/null || { setsid nohup fluxbox >/tmp/fluxbox.log 2>&1 & sleep 2; }

if [ ! -s /tmp/bus147 ]; then
  eval "$(dbus-launch --sh-syntax)"
  echo "$DBUS_SESSION_BUS_ADDRESS" > /tmp/bus147
fi
export DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bus147)

# First Use=false suppresses the multi-page setup WIZARD, leaving the single
# "create a password for this wallet" dialog, which is far easier to drive.
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

if ! pgrep -x kwalletd6 >/dev/null; then
  setsid nohup kwalletd6 >/tmp/kwalletd6.log 2>&1 &
  sleep 3
fi

echo "DISPLAY=$DISPLAY  bus=$DBUS_SESSION_BUS_ADDRESS"
echo "xvfb=$(pgrep -x Xvfb | tr '\n' ' ') fluxbox=$(pgrep -x fluxbox | tr '\n' ' ') kwalletd6=$(pgrep -x kwalletd6 | tr '\n' ' ')"
echo "on bus: $(dbus-send --session --dest=org.freedesktop.DBus --print-reply \
  /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -c kwalletd6)"
echo "wallet files: $(find "$XDG_DATA_HOME/kwalletd" -type f 2>/dev/null | tr '\n' ' ')"
