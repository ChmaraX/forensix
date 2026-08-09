#!/bin/bash
# 147 STEP 1 — REACHABILITY GATE.
#
# Answers, before any Source is built:
#   (a) which --password-store tokens does branded Chrome M151 ACCEPT?
#   (b) does Chrome actually REACH KWalletKeyProvider under Xvfb with a live
#       kwalletd5 on the session bus?
#
# Method lesson carried from #149: NEVER conclude from strings in the binary.
# Accepted tokens are established by running the binary with a bogus value and
# reading the rejection; provider selection is confirmed from the
# OSCrypt.*KeyProvider.InitStatus histograms under --enable-logging=stderr --v=1.
set -u
export LC_ALL=C.UTF-8
export HOME=/home/suspect
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_RUNTIME_DIR=/tmp/xdgrt-gate
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" /out
chmod 700 "$XDG_RUNTIME_DIR"

# KDE session signals — kwallet provider selection is desktop-conditional.
export XDG_CURRENT_DESKTOP=KDE
export DESKTOP_SESSION=plasma
export KDE_FULL_SESSION=true
export KDE_SESSION_VERSION=5
export DISPLAY=:99

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

########## display + session bus ##########
pgrep Xvfb >/dev/null || { Xvfb :99 -screen 0 1280x1024x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pgrep fluxbox >/dev/null || { fluxbox >/tmp/fluxbox.log 2>&1 & sleep 1; }
eval "$(dbus-launch --sh-syntax)"
log "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"

########## kwalletd5 with a KNOWN password, no GUI dialog ##########
# Route (a) from the plan: blank/known password via the PAM hook, so no dialog.
cat > "$XDG_CONFIG_HOME/kwalletrc" <<CFG
[Wallet]
First Use=false
Enabled=true
Use One Wallet=true
Default Wallet=kdewallet
Prompt on Open=false
Close on Screensaver=false
Close When Idle=false
Leave Open=true
CFG

WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"

# kwalletd5 --pam-login <socket_fd> <env_fd> reads the wallet password from the
# given fd and creates/opens the wallet with NO GUI prompt.
PAMSOCK=/tmp/kwallet-pam.sock
rm -f "$PAMSOCK"
python3 - "$PAMSOCK" "$WALLET_PASSWORD" <<'PY' &
import socket, sys, os, time
path, pw = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.bind(path); s.listen(1)
os.chmod(path, 0o600)
conn, _ = s.accept()
b = pw.encode()
conn.sendall(len(b).to_bytes(4, 'little') + b)
time.sleep(2)
conn.close()
PY
sleep 1

log "starting kwalletd5 via --pam-login (headless, no dialog)"
kwalletd5 --pam-login 3 4 3<>"$PAMSOCK" 4</dev/null >/tmp/kwalletd.log 2>&1 &
KWPID=$!
sleep 5

if ! kill -0 $KWPID 2>/dev/null; then
  log "pam-login failed; falling back to plain daemon start"
  sed -i 's/^qt\..*$//' /tmp/kwalletd.log 2>/dev/null || true
  head -20 /tmp/kwalletd.log
  kwalletd5 >/tmp/kwalletd.log 2>&1 &
  KWPID=$!
  sleep 5
fi
log "kwalletd5 pid=$KWPID alive=$(kill -0 $KWPID 2>/dev/null && echo yes || echo no)"

echo "=== D-Bus names registered ===" | tee /out/gate_dbus_names.txt
dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply \
  /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
  | grep -oE '"org\.kde\.[^"]*"' | sort -u | tee -a /out/gate_dbus_names.txt

echo "=== wallets / networkWallet ===" | tee /out/gate_wallet_state.txt
for Q in wallets networkWallet isEnabled; do
  R=$(dbus-send --session --dest=org.kde.kwalletd5 --type=method_call --print-reply \
      /modules/kwalletd5 org.kde.KWallet.$Q 2>&1 | tail -2 | tr -d '\n')
  echo "$Q => $R" | tee -a /out/gate_wallet_state.txt
done

########## the gate: does Chrome REACH KWalletKeyProvider? ##########
for TOK in kwallet kwallet5 kwallet6; do
  log "--- launching Chrome with --password-store=$TOK ---"
  rm -rf /tmp/gate-udd-$TOK
  timeout 45 google-chrome \
    --password-store=$TOK \
    --user-data-dir=/tmp/gate-udd-$TOK \
    --no-first-run --no-default-browser-check --disable-gpu --no-sandbox \
    --enable-logging=stderr --v=1 \
    about:blank >/tmp/chrome-$TOK.log 2>&1
  {
    echo "########## token=$TOK"
    grep -iE "Unknown password store" /tmp/chrome-$TOK.log | head -3
    grep -iE "OSCrypt\.[A-Za-z]*KeyProvider|OSCrypt\.EncryptorKeyCount|OSCrypt\.AsyncInitialization" /tmp/chrome-$TOK.log | head -20
    grep -iE "kwallet|KWalletKeyProvider|key_storage_kwallet" /tmp/chrome-$TOK.log | head -20
  } | tee -a /out/gate_provider_selection.txt
  echo | tee -a /out/gate_provider_selection.txt
done

log "gate complete; results in /out/"
