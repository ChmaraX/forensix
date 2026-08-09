#!/bin/bash
# 149 — Step 1-4: build a disposable known-plaintext Source, then shut it down.
#
# Runs INSIDE the Source container as user `suspect`.
# Writes known ASCII + non-ASCII cookies through BRANDED Google Chrome with the
# GNOME Keyring provider FORCED via --password-store=gnome-libsecret (token proven
# accepted empirically in step 0, see 149-step0-token-probe.txt).
#
# Credential semantics under test:
#   login password  : login-pw-CORRECT      (OS user password)
#   keyring password: keyring-pw-DIFFERENT  (deliberately NOT equal to the login
#                     password, so the "login != keyring" control is the DEFAULT
#                     case and login-password-as-keyring-password cannot succeed
#                     by coincidence)
set -euo pipefail

KEYRING_PW="${KEYRING_PW:-keyring-pw-DIFFERENT}"
OUT=/out
export HOME=/home/suspect
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_RUNTIME_DIR=/run/user/$(id -u)
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$OUT"
chmod 700 "$XDG_RUNTIME_DIR"

echo "=== [0] provider + version evidence ==="
google-chrome --version | tee "$OUT/chrome_version.txt"
dpkg -l google-chrome-stable | tail -1 | tee -a "$OUT/chrome_version.txt"
{
  echo "gnome-keyring-daemon: $(dpkg-query -W -f='${Version}' gnome-keyring 2>/dev/null)"
  echo "libsecret-1-0:        $(dpkg-query -W -f='${Version}' libsecret-1-0 2>/dev/null)"
  echo "libsecret-tools:      $(dpkg-query -W -f='${Version}' libsecret-tools 2>/dev/null)"
  echo "distro:               $(. /etc/os-release; echo "$PRETTY_NAME")"
  echo "kernel:               $(uname -m)"
} | tee "$OUT/provider_versions.txt"

echo "=== [1] start X + D-Bus session ==="
Xvfb :99 -screen 0 1280x1024x24 >/dev/null 2>&1 &
sleep 2
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS" | tee "$OUT/dbus_address.txt"

echo "=== [2] start gnome-keyring-daemon with a KNOWN keyring password ==="
# --unlock reads the master password on stdin and unlocks/creates the login keyring.
printf '%s' "$KEYRING_PW" | gnome-keyring-daemon --unlock --components=secrets,pkcs11 >"$OUT/gkd_unlock.txt" 2>&1 || true
sleep 2
# Re-export whatever the daemon published (control socket etc).
printf '%s' "$KEYRING_PW" | gnome-keyring-daemon --start --components=secrets,pkcs11 >"$OUT/gkd_start.txt" 2>&1 || true
sleep 1
ps aux | grep -E "[g]nome-keyring|[d]bus-daemon|[X]vfb" | tee "$OUT/process_list.txt"

echo "=== [3] PROVE the secret service answers BEFORE launching Chrome ==="
# This is the precondition #153 verified and still got v10; we verify it too so a
# v10 result here cannot be blamed on a dead keyring.
set +e
secret-tool store --label=preflight fx-preflight yes <<<"preflight-secret"
echo "secret-tool store rc=$?" | tee "$OUT/secret_service_preflight.txt"
secret-tool lookup fx-preflight yes | tee -a "$OUT/secret_service_preflight.txt"
echo "secret-tool lookup rc=$?" | tee -a "$OUT/secret_service_preflight.txt"
busctl --user list 2>/dev/null | grep -i secret | tee -a "$OUT/secret_service_preflight.txt"
set -e

echo "=== [4] launch BRANDED Chrome with the provider FORCED ==="
UDD="$HOME/chrome-udd"
rm -rf "$UDD"
google-chrome \
  --no-sandbox \
  --password-store=gnome-libsecret \
  --user-data-dir="$UDD" \
  --enable-logging=stderr --v=1 \
  --disable-features=DialMediaRouteProvider \
  --no-first-run --no-default-browser-check \
  --headless=new \
  --dump-dom "file:///dev/null" >"$OUT/chrome_launch_dom.txt" 2>"$OUT/chrome_stderr.txt" || true

grep -iE "password store|key.?provider|os_crypt|OSCrypt|secret|keyring|Unknown password" "$OUT/chrome_stderr.txt" \
  | head -40 | tee "$OUT/chrome_provider_selection.txt" || true

echo "=== [5] write KNOWN ASCII + non-ASCII plaintext via Chrome's own cookie store ==="
# Driving real cookie writes through Chrome guarantees the rows are encrypted by
# Chrome's selected provider, not by us. Uses a local data: origin only — no network,
# no case data. Cookie values are the recorded known plaintext.
python3 /work/149-cookie-writer.py "$UDD" "$OUT" 2>&1 | tee "$OUT/cookie_write_log.txt"

echo "=== [6] shut Chrome down, THEN the keyring ==="
pkill -f "google-chrome" 2>/dev/null || true
sleep 3
pkill -f "chrome" 2>/dev/null || true
sleep 2
ps aux | grep -E "[c]hrome" | tee "$OUT/post_shutdown_processes.txt" || echo "(no chrome processes)" | tee "$OUT/post_shutdown_processes.txt"

echo "=== [7] record row prefixes (evidence of provider actually used) ==="
python3 /work/149-prefix-probe.py "$UDD" | tee "$OUT/cookie_prefixes.txt"

echo "=== [8] keyring store on disk ==="
ls -la "$XDG_DATA_HOME/keyrings/" 2>&1 | tee "$OUT/keyrings_listing.txt" || true
ls -la "$HOME/.gnome2/keyrings/" 2>&1 | tee -a "$OUT/keyrings_listing.txt" || echo "(no legacy ~/.gnome2/keyrings)" | tee -a "$OUT/keyrings_listing.txt"

echo "=== [9] shut the keyring daemon down (Source goes cold) ==="
pkill -f gnome-keyring-daemon 2>/dev/null || true
sleep 1
echo "SOURCE COLD" | tee "$OUT/source_state.txt"
