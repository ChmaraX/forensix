#!/bin/bash
# 147 (attempt 2) — create a KWallet by ANSWERING the creation wizard on a
# virtual X display. This is the step attempt 1 could not complete.
#
# Attempt 1 tried to bypass the dialog headlessly via pam_kwallet and never
# finished the environment framing. This does the opposite: give kwalletd a
# real (virtual) display and drive the dialog.
#
#   WALLET_KIND=classic → "Classic, blowfish encrypted file" (password .kwl)
#   WALLET_KIND=gpg     → "Use GPG encryption, for better protection"
#
# The wallet password is a CASE CREDENTIAL: it is recorded outside the Source
# set and never copied into evidence.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect DISPLAY=:99
export XDG_DATA_HOME=$HOME/.local/share XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
KWD="${KWD:-kwalletd6}"
BUSFILE="${BUSFILE:-/tmp/bus147}"
export DBUS_SESSION_BUS_ADDRESS=$(cat "$BUSFILE")

WALLET_NAME="${WALLET_NAME:-kdewallet}"
WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"
WALLET_KIND="${WALLET_KIND:-classic}"
APPID="${APPID:-fx147-setup}"
SHOTDIR="${SHOTDIR:-/tmp}"

shot() { import -window root "$SHOTDIR/cw-$WALLET_KIND-$1.png" 2>/dev/null; }

# xdotool's --onlyvisible search intermittently misses the dialog; xwininfo's
# tree does not. Resolve the id there, then use xdotool for geometry/input.
find_win() {
  xwininfo -root -tree 2>/dev/null \
    | grep "\"KDE Wallet Service\": (\"$KWD\"" \
    | awk '{print $1}' | tail -1
}
wait_win() {
  local prev="${1:-}" i w
  for i in $(seq 1 "${2:-60}"); do
    w=$(find_win)
    if [ -n "$w" ] && [ "$w" != "$prev" ]; then echo "$w"; return 0; fi
    sleep 1
  done
  return 1
}

# Long reply timeout: dbus-send's 25s default expires mid-dialog, and a caller
# that gives up aborts the transaction before the wallet is written.
( dbus-send --session --reply-timeout=900000 --dest=org.kde.$KWD --print-reply \
    /modules/$KWD org.kde.KWallet.open \
    string:"$WALLET_NAME" int64:0 string:"$APPID" > "/tmp/open-$WALLET_KIND.out" 2>&1 ) &
OPEN_PID=$!

W=$(wait_win "" 90) || { echo "FAIL: wizard never appeared"; exit 1; }
echo "wizard window=$W"
xdotool windowactivate "$W" 2>/dev/null; sleep 1
shot 1-wizard
eval "$(xdotool getwindowgeometry --shell "$W")"

# Page 1 — wallet type. Offsets are inside the 500x360 dialog.
if [ "$WALLET_KIND" = classic ]; then
  xdotool mousemove $((X + 133)) $((Y + 139)) click 1     # Classic, blowfish
else
  xdotool mousemove $((X + 133)) $((Y + 168)) click 1     # Use GPG encryption
fi
sleep 1; shot 2-type-chosen
xdotool mousemove $((X + 362)) $((Y + 317)) click 1       # Finish
sleep 2

if [ "$WALLET_KIND" = classic ]; then
  # Page 2 is a SEPARATE window (new id), not a new page in the wizard.
  P=$(wait_win "$W" 60) || { echo "FAIL: password dialog never appeared"; exit 1; }
  echo "password window=$P"
  xdotool windowactivate "$P" 2>/dev/null; sleep 1
  eval "$(xdotool getwindowgeometry --shell "$P")"
  xdotool mousemove $((X + 167)) $((Y + 138)) click 1     # Password field
  sleep 1
  xdotool key ctrl+a; xdotool key Delete
  xdotool type --delay 60 "$WALLET_PASSWORD"
  # Keyboard Tab, NOT a second click: a click does not move focus between the
  # fields, and both strings land in "Password" ("Passwords do not match").
  xdotool key Tab; sleep 1
  xdotool type --delay 60 "$WALLET_PASSWORD"
  sleep 1; shot 3-password-typed
  xdotool key Return
  sleep 5; shot 4-after-ok
fi

wait $OPEN_PID 2>/dev/null
echo "--- open reply:"; tail -2 "/tmp/open-$WALLET_KIND.out"
echo "--- wallet files:"; find "$XDG_DATA_HOME/kwalletd" -type f -exec ls -l {} \; 2>/dev/null
