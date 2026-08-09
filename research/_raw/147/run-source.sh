#!/bin/bash
# 147 (attempt 2) — build the disposable known-plaintext Source.
#
# Steps 1-4 of the ticket's ground-truth recipe: dedicated user, known cookies
# saved while KWallet is the selected backend, v11 confirmed, Chrome stopped,
# then the Source stopped. Acquisition (steps 5-7) is a separate script run
# after this one, against a cold Source.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect DISPLAY=:99
export XDG_DATA_HOME=$HOME/.local/share XDG_CONFIG_HOME=$HOME/.config
export XDG_RUNTIME_DIR=/tmp/rt147
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true KDE_SESSION_VERSION=6

WALLET_NAME="${WALLET_NAME:-kdewallet}"
WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"
TOKEN="${TOKEN:-kwallet6}"
KWD="${KWD:-kwalletd6}"
BUSFILE="${BUSFILE:-/tmp/bus147}"
PKG="${PKG:-kwallet6}"
OUT=/out
UDD=$HOME/chrome-udd
mkdir -p "$OUT"

echo "=== 1. reset to a clean Source state ==="
pkill -x "$KWD" 2>/dev/null
pkill -x google-chrome 2>/dev/null
sleep 1
rm -rf "$XDG_DATA_HOME/kwalletd" "$UDD" "$XDG_CONFIG_HOME/kwalletrc"

export DBUS_SESSION_BUS_ADDRESS=$(cat "$BUSFILE")

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

echo "=== 2. provider identity ==="
{
  echo "distro: $(. /etc/os-release; echo "$PRETTY_NAME") $(uname -m)"
  echo "$PKG: $(dpkg-query -W -f='${Version}' $PKG)"
  echo "kwalletd binary: $KWD"
  echo "kwalletd path: $(readlink -f "$(which $KWD)")"
  echo "chrome: $(google-chrome --version)"
  echo "password-store token: $TOKEN"
  echo "wallet name: $WALLET_NAME"
} | tee "$OUT/provider_versions.txt"

echo "=== 3. create the wallet (wizard answered on the virtual display) ==="
WALLET_NAME="$WALLET_NAME" WALLET_PASSWORD="$WALLET_PASSWORD" WALLET_KIND="${WALLET_KIND:-classic}" KWD="$KWD" BUSFILE="$BUSFILE" \
  SHOTDIR="$OUT" bash /work/create-wallet-x.sh 2>&1 | tee "$OUT/wallet_creation.txt"

if [ ! -s "$XDG_DATA_HOME/kwalletd/$WALLET_NAME.kwl" ]; then
  echo "FAIL: no .kwl produced — Source cannot be built"; exit 1
fi
sha256sum "$XDG_DATA_HOME/kwalletd/"* | tee "$OUT/wallet_hashes_at_creation.txt"

echo "=== 4. write known plaintext cookies through Chrome ==="
python3 /work/147-cookie-writer.py "$UDD" "$OUT" "$TOKEN" 2>&1 | tee "$OUT/cookie_write_log.txt"

echo "=== 5. provider selection evidence ==="
grep -aE "OSCrypt" "$OUT/cookie_write_stderr.txt" | sed 's/^.*\] //' | sort -u \
  | tee "$OUT/chrome_provider_selection.txt" | head -12

echo "=== 6. cookie prefixes (before any shutdown) ==="
python3 - "$UDD/Default/Cookies" > "$OUT/cookie_prefixes.txt" <<'PY'
import sqlite3, sys, collections
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
rows = con.execute("SELECT name, encrypted_value FROM cookies ORDER BY name").fetchall()
pfx = collections.Counter(bytes(v)[:3].decode('ascii','replace') for _, v in rows)
print("ROWS:", len(rows))
for n, v in rows:
    print(f"  {n:16s} prefix={bytes(v)[:3]!r} len={len(bytes(v))}")
print("DISTINCT PREFIXES:", sorted(pfx))
PY
cat "$OUT/cookie_prefixes.txt"

echo "=== 7. wallet contents, as the Source sees them (ground truth) ==="
H=$(dbus-send --session --dest=org.kde.$KWD --print-reply /modules/$KWD \
      org.kde.KWallet.open string:"$WALLET_NAME" int64:0 string:fx147-truth 2>/dev/null \
      | awk '/int32/{print $2}')
{
  echo "handle=$H"
  echo "-- folderList:"
  dbus-send --session --dest=org.kde.$KWD --print-reply /modules/$KWD \
    org.kde.KWallet.folderList int32:"$H" string:fx147-truth 2>&1 | tail -n +2
  echo "-- entryList(Chrome Keys):"
  dbus-send --session --dest=org.kde.$KWD --print-reply /modules/$KWD \
    org.kde.KWallet.entryList int32:"$H" string:"Chrome Keys" string:fx147-truth 2>&1 | tail -n +2
  echo "-- readPassword(Chrome Keys/Chrome Safe Storage):"
  dbus-send --session --dest=org.kde.$KWD --print-reply /modules/$KWD \
    org.kde.KWallet.readPassword int32:"$H" string:"Chrome Keys" \
    string:"Chrome Safe Storage" string:fx147-truth 2>&1 | tail -n +2
} | tee "$OUT/wallet_ground_truth.txt"

echo "=== 8. Chrome down, then close the wallet so it syncs to disk ==="
pkill -x google-chrome 2>/dev/null; sleep 2
dbus-send --session --dest=org.kde.$KWD --print-reply /modules/$KWD \
  org.kde.KWallet.close string:"$WALLET_NAME" boolean:true 2>&1 | tail -2 \
  | tee "$OUT/wallet_close.txt"
sleep 2

echo "=== 9. Source shutdown (kwalletd stopped, nothing live to query) ==="
pkill -x "$KWD" 2>/dev/null; sleep 2
{
  echo "$KWD live (non-zombie): $(ps -eo stat,comm | awk -v c=\"$KWD\" '$1 !~ /Z/ && $2==c' | wc -l)"
  echo "chrome running:    $(pgrep -c -f 'google-chrome' || true)"
  echo "on session bus:    $(dbus-send --session --dest=org.freedesktop.DBus --print-reply \
     /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -c "$KWD")"
  echo "SOURCE COLD"
} | tee "$OUT/source_state.txt"

echo "=== 10. wallet on disk after sync ==="
ls -l "$XDG_DATA_HOME/kwalletd/" | tee "$OUT/wallet_files_final.txt"
sha256sum "$XDG_DATA_HOME/kwalletd/"* | tee "$OUT/wallet_hashes_final.txt"
xxd "$XDG_DATA_HOME/kwalletd/$WALLET_NAME.kwl" | head -4 | tee "$OUT/wallet_header_hexdump.txt"
