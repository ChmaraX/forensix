#!/bin/bash
# 147 (attempt 2) — create a KWallet by ANSWERING the creation wizard on a
# virtual X display. This is the step attempt 1 could not complete.
#
# WALLET_KIND=classic → "Classic, blowfish encrypted file"  (password-protected .kwl)
# WALLET_KIND=gpg     → "Use GPG encryption, for better protection"
#
# The wallet password is a CASE CREDENTIAL: recorded here, kept outside the
# Source set, never copied into evidence.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect DISPLAY=:99
export XDG_DATA_HOME=$HOME/.local/share XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
export DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bus147)

WALLET_NAME="${WALLET_NAME:-kdewallet}"
WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"
WALLET_KIND="${WALLET_KIND:-classic}"
APPID="${APPID:-fx147-setup}"

shot() { import -window root "/tmp/cw-$1.png" 2>/dev/null; }

# Long reply timeout: the wizard is slower than dbus-send's 25s default, and a
# caller that gives up mid-dialog aborts the transaction.
( dbus-send --session --reply-timeout=600000 --dest=org.kde.kwalletd6 --print-reply \
    /modules/kwalletd6 org.kde.KWallet.open \
    string:"$WALLET_NAME" int64:0 string:"$APPID" > /tmp/open-$WALLET_KIND.out 2>&1 ) &
OPEN_PID=$!

# Wait for the wizard
for i in $(seq 1 30); do
  W=$(xdotool search --onlyvisible --name "^KDE Wallet Service$" 2>/dev/null | tail -1)
  [ -n "${W:-}" ] && break
  sleep 1
done
[ -z "${W:-}" ] && { echo "FAIL: no wizard window"; exit 1; }
echo "wizard window=$W"
xdotool windowactivate "$W" 2>/dev/null; sleep 1
shot 1-wizard

# Page 1: wallet type. Radios sit at a fixed offset inside the 500x360 dialog.
eval "$(xdotool getwindowgeometry --shell "$W")"
if [ "$WALLET_KIND" = classic ]; then
  xdotool mousemove $((X + 133)) $((Y + 139)) click 1     # Classic, blowfish
else
  xdotool mousemove $((X + 133)) $((Y + 168)) click 1     # Use GPG encryption
fi
sleep 1; shot 2-type-chosen
xdotool mousemove $((X + 362)) $((Y + 317)) click 1       # Finish
sleep 3; shot 3-after-finish

if [ "$WALLET_KIND" = classic ]; then
  # Page 2 is a separate password dialog. Keyboard-only: a second mouse click
  # does NOT move focus between the fields (attempt: both strings landed in
  # "Password" and the dialog answered "Passwords do not match").
  for i in $(seq 1 20); do
    P=$(xdotool search --onlyvisible --name "^KDE Wallet Service$" 2>/dev/null | tail -1)
    [ -n "${P:-}" ] && break
    sleep 1
  done
  xdotool windowactivate "$P" 2>/dev/null; sleep 1
  eval "$(xdotool getwindowgeometry --shell "$P")"
  xdotool mousemove $((X + 167)) $((Y + 168)) click 1     # Password field
  sleep 1
  xdotool key ctrl+a; xdotool key Delete
  xdotool type --delay 60 "$WALLET_PASSWORD"
  xdotool key Tab; sleep 1
  xdotool type --delay 60 "$WALLET_PASSWORD"
  sleep 1; shot 4-password-typed
  xdotool key Return
  sleep 4; shot 5-after-ok
fi

wait $OPEN_PID 2>/dev/null
echo "--- open reply:"; tail -2 "/tmp/open-$WALLET_KIND.out"
echo "--- wallet files:"; find "$XDG_DATA_HOME/kwalletd" -type f -exec ls -l {} \; 2>/dev/null
echo "--- kwalletd log:"; grep -avE "QSocketNotifier|^qt\.|kf.i18n" /tmp/kwalletd6.log | tail -5
