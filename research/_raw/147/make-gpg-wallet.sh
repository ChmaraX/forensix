#!/bin/bash
# 147 — route (c): create a GPG-BACKED KWallet with no GUI dialog.
#
# Why this route. kwalletd5 on Ubuntu 24.04 (5.115.0) does NOT accept the
# --pam-login option (verified: "kwalletd5: Unknown option 'pam-login'"), so the
# documented headless password-unlock hook is unavailable in this build. A
# password wallet therefore always needs the KDE dialog.
#
# A GPG-backed wallet has no password dialog at all: kwalletd asks gpg-agent to
# decrypt the wallet, and gpg-agent can be driven non-interactively with
# loopback pinentry. GPG-backed wallet is itself a NAMED VARIANT in #147.
#
# The wallet file is <XDG_DATA_HOME>/kwalletd/<name>.kwl and, for a GPG wallet,
# is an OpenPGP message rather than the KWallet blowfish container.
set -u
export LC_ALL=C.UTF-8
GPG_PASSPHRASE="${GPG_PASSPHRASE:-FX147gpgpass}"
WALLET_NAME="${WALLET_NAME:-kdewallet}"
export GNUPGHOME="${GNUPGHOME:-$HOME/.gnupg}"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

########## 1. gpg-agent configured for NON-INTERACTIVE use ##########
cat > "$GNUPGHOME/gpg-agent.conf" <<CFG
allow-loopback-pinentry
default-cache-ttl 34560000
max-cache-ttl 34560000
CFG
cat > "$GNUPGHOME/gpg.conf" <<CFG
pinentry-mode loopback
batch
CFG
gpgconf --kill gpg-agent 2>/dev/null || true
sleep 1

########## 2. a dedicated case key, generated unattended ##########
if ! gpg --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec'; then
  log "generating GPG key (unattended)"
  cat > /tmp/keyparams <<PARAMS
%echo generating
Key-Type: RSA
Key-Length: 3072
Subkey-Type: RSA
Subkey-Length: 3072
Name-Real: ForensiX 147 Suspect
Name-Email: suspect147@forensix.invalid
Expire-Date: 0
Passphrase: $GPG_PASSPHRASE
%commit
%echo done
PARAMS
  gpg --batch --pinentry-mode loopback --gen-key /tmp/keyparams 2>&1 | tail -3
  shred -u /tmp/keyparams 2>/dev/null || rm -f /tmp/keyparams
fi

KEYID=$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^sec/{print $5; exit}')
KEYFPR=$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print $10; exit}')
log "GPG key id=$KEYID fpr=$KEYFPR"
echo "$KEYID" > /tmp/gpg_keyid
echo "$KEYFPR" > /tmp/gpg_keyfpr

########## 3. tell kwalletd to use a GPG wallet ##########
mkdir -p "$XDG_CONFIG_HOME"
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

log "gpg environment ready; wallet name=$WALLET_NAME"
gpg --list-secret-keys 2>/dev/null | head -6
