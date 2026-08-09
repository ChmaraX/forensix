#!/bin/bash
# 147 — start kwalletd with a KNOWN wallet password and NO GUI dialog.
#
# KWallet's daemon normally prompts for the wallet password through a KDE
# dialog. That is why the first #147 attempt stalled (exit 124 on
# org.kde.KWallet.open) — a wallet did not yet exist, so kwalletd raised the
# creation wizard and blocked.
#
# The headless path is the one pam_kwallet5 uses. Establishing it by reading the
# shipped binaries and then the upstream source (per the #149 method lesson —
# never conclude from strings alone):
#
#   1. pam_kwallet5.so execs kwalletd and sets PAM_KWALLET5_LOGIN=<socket path>.
#      Without that variable kwalletd does not even register the --pam-login
#      option, and Qt rejects it as "Unknown option 'pam-login'".
#   2. kwalletd is invoked as: kwalletd --pam-login <pipe_fd> <envsocket_fd>.
#      From pam_kwallet.c:
#          args[] = { kwalletd, "--pam-login", pipeInt, sockIn, NULL }
#      where pipeInt is the READ end of a plain pipe carrying the key, and
#      sockIn is a LISTENING unix socket kwalletd accept()s on to receive the
#      session environment. Omitting them gives
#      "Invalid arguments (less than needed)".
#   3. What is written to the PIPE is NOT the password. It is a 56-byte derived
#      key. Sending the raw password gives "Hash or environment not received".
#
# Key derivation, from kwallet-pam/pam_kwallet.c (KDE, master):
#      KWALLET_PAM_KEYSIZE    56
#      KWALLET_PAM_SALTSIZE   56
#      KWALLET_PAM_ITERATIONS 50000
#      gcry_kdf_derive(passphrase, GCRY_KDF_PBKDF2, GCRY_MD_SHA512,
#                      salt, 56, 50000, 56, key)
# The salt is the raw contents of <XDG_DATA_HOME>/kwalletd/<wallet>.salt, which
# pam_kwallet creates with 56 random bytes if absent. The 56-byte key is written
# to the socket with NO length prefix.
#
# Wallet password is a case credential and is recorded OUTSIDE the Source set.
set -u
WALLET_PASSWORD="${WALLET_PASSWORD:-FX147walletpw}"
KWALLETD="${KWALLETD:-kwalletd6}"
WALLET_NAME="${WALLET_NAME:-kdewallet}"
LOG="${LOG:-/tmp/kwalletd.log}"
SOCK="${SOCK:-/tmp/pam-kwallet-$$.sock}"
SALT_FILE="${SALT_FILE:-$XDG_DATA_HOME/kwalletd/$WALLET_NAME.salt}"

python3 - "$WALLET_PASSWORD" "$KWALLETD" "$LOG" "$SOCK" "$SALT_FILE" <<'PY'
import hashlib, os, socket, subprocess, sys, time

password, kwalletd, log, sockpath, saltfile = sys.argv[1:6]

KEYSIZE = 56
SALTSIZE = 56
ITERATIONS = 50000

# The salt file is created by pam_kwallet when absent. Create it the same way so
# the derived key is reproducible and the wallet can be re-opened later.
os.makedirs(os.path.dirname(saltfile), exist_ok=True)
if not os.path.exists(saltfile):
    with open(saltfile, "wb") as f:
        f.write(os.urandom(SALTSIZE))
    os.chmod(saltfile, 0o600)
salt = open(saltfile, "rb").read()
assert len(salt) == SALTSIZE, f"salt is {len(salt)} bytes, expected {SALTSIZE}"

# PBKDF2-HMAC-SHA512, exactly as pam_kwallet.c derives it.
key = hashlib.pbkdf2_hmac("sha512", password.encode(), salt, ITERATIONS, KEYSIZE)

try:
    os.unlink(sockpath)
except FileNotFoundError:
    pass

srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(sockpath)
srv.listen(1)
os.chmod(sockpath, 0o600)

# fd 3 = read end of a pipe carrying the 56-byte key.
# fd 4 = the LISTENING socket kwalletd accept()s for the environment block.
key_r, key_w = os.pipe()

def preexec():
    os.dup2(key_r, 3)
    os.dup2(srv.fileno(), 4)

env = dict(os.environ)
env["PAM_KWALLET5_LOGIN"] = sockpath
env.setdefault("QT_QPA_PLATFORM", "offscreen")

logf = open(log, "wb")
proc = subprocess.Popen([kwalletd, "--pam-login", "3", "4"], env=env,
                        preexec_fn=preexec, stdout=logf, stderr=logf,
                        close_fds=False)

sent = {"ok": False, "err": None}
try:
    os.write(key_w, key)           # raw 56 bytes on the pipe, no length prefix
    os.close(key_w)
    os.close(key_r)
    sent["ok"] = True
except Exception as e:  # noqa: BLE001
    sent["err"] = repr(e)

# kwalletd accepts on fd 4 and expects the environment as NUL-separated
# KEY=VALUE pairs, the same shape as /proc/<pid>/environ.
env_sent = {"ok": False, "err": None}
blob = b"".join(f"{k}={v}".encode() + b"\0" for k, v in os.environ.items())
for attempt in range(20):
    try:
        cli = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        cli.connect(sockpath)
        cli.sendall(blob)
        time.sleep(0.5)
        cli.close()
        env_sent["ok"] = True
        break
    except Exception as e:  # noqa: BLE001
        env_sent["err"] = repr(e)
        time.sleep(0.5)

time.sleep(6)
alive = proc.poll() is None
print(f"kwalletd pid={proc.pid} alive={alive} key_sent={sent['ok']} "
      f"env_sent={env_sent['ok']} key_sha256={hashlib.sha256(key).hexdigest()[:16]} "
      f"err={sent['err']} enverr={env_sent['err']}")
if not alive:
    print("EXITED rc=", proc.returncode)
PY
