#!/bin/bash
set -u
export LC_ALL=C.UTF-8 QT_QPA_PLATFORM=offscreen
export HOME=/home/suspect
export XDG_DATA_HOME="$HOME/.local/share" XDG_CONFIG_HOME="$HOME/.config"
export XDG_RUNTIME_DIR=/tmp/rt; mkdir -p "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"; chmod 700 "$XDG_RUNTIME_DIR"
export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma KDE_FULL_SESSION=true KDE_SESSION_VERSION=6
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
echo "=== kwalletd6 running? ==="; pgrep -a kwalletd6 || echo NO
echo "=== dbus names ==="; qdbus6 2>/dev/null | grep -i wallet
echo "=== isEnabled ==="; qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.isEnabled 2>&1
echo "=== networkWallet ==="; qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.networkWallet 2>&1
echo "=== wallets ==="; qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.wallets 2>&1
echo "=== try open (will it prompt?) ==="
timeout 20 qdbus6 org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.open kdewallet 0 forensix 2>&1
echo "exit=$?"
echo "=== data dir ==="; find "$XDG_DATA_HOME" -type f 2>/dev/null | head -20
echo "=== kwalletd log ==="; grep -v "^qt\." /tmp/kw.log | head -20
