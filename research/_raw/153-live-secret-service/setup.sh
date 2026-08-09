#!/usr/bin/env bash
# 153 — reproduction recipe: real XFCE desktop + real gnome-keyring Secret Service
# + branded Google Chrome, run locally via Cua on Apple Silicon (Docker container
# runtime, trycua/cua-xfce image, linux/amd64 emulated).
#
# This is a transcript of the commands actually used, not a turnkey script —
# each stage was verified independently before moving to the next (see the
# write-up in ../../153-linux-oscrypt-live-secret-service.md, section 2).

set -euxo pipefail

# ── 1. Pull and run the Cua XFCE container (no arm64 image exists; runs under
#      Docker Desktop's amd64 emulation) ────────────────────────────────────
docker pull --platform linux/amd64 trycua/cua-xfce:latest
docker run -d --name forensix153 --platform linux/amd64 \
  -p 18000:8000 -p 16901:6901 trycua/cua-xfce:latest
# Container boots Xtigervnc on :1, noVNC, and computer-server (cua's own
# control API) via supervisord. The image's own xstartup.sh backgrounds
# `startxfce4` but in practice the session manager needs a manual nudge —
# xfwm4/panel/xfdesktop/xfsettingsd/xfce4-session were confirmed running
# only after re-invoking `startxfce4` as the `cua` user with DISPLAY=:1 set.

# ── 2. Identify the real XFCE session's D-Bus bus (there were TWO session
#      buses at this point — the container's original xinitrc one, and the
#      one startxfce4 created; xfwm4/panel/xfdesktop live on the latter) ────
docker exec forensix153 bash -c "cat /proc/net/unix | grep dbus"
# /tmp/dbus-L9NS0yRGnB had ~20 live connections (the real XFCE session).

cat > session-env.sh <<'EOF'
export DISPLAY=:1
export DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/dbus-L9NS0yRGnB
export XDG_CURRENT_DESKTOP=XFCE
export DESKTOP_SESSION=xfce
export XDG_SESSION_TYPE=x11
export HOME=/home/cua
EOF

# ── 3. Install gnome-keyring + libsecret client tools ───────────────────────
docker exec forensix153 apt-get update
docker exec forensix153 bash -c \
  "DEBIAN_FRONTEND=noninteractive apt-get install -y gnome-keyring libsecret-tools dbus-x11 python3-dbus scrot"

# ── 4. Seed a genuine, unencrypted-master-password "login" keyring + default
#      alias BEFORE starting the daemon. This is the well-known headless/CI
#      recipe for gnome-keyring: manually invoking `--login` or `--unlock`
#      without a pre-existing keyring file does NOT create one (confirmed —
#      see write-up §2.2 for the failed attempts that established this).
#      D-Bus service-activation (`/usr/share/dbus-1/services/org.freedesktop.secrets.service`
#      → `gnome-keyring-daemon --start --foreground --components=secrets`)
#      fires the instant anything probes org.freedesktop.secrets, and that
#      auto-started daemon only ever produces the transient "session"
#      collection with no default alias — this is the likely real-world
#      cause of #135's and the first #153 attempt's v10 fallback.
docker exec --user cua forensix153 bash -c '
  mkdir -p /home/cua/.local/share/keyrings
  NOW=$(date +%s)
  cat > /home/cua/.local/share/keyrings/login.keyring <<KEOF
[keyring]
display-name=login
ctime=$NOW
mtime=$NOW
lock-on-idle=false
lock-after=false
KEOF
  printf "login\n" > /home/cua/.local/share/keyrings/default
'

# ── 5. Start the daemon, then unlock (auto-creates the D-Bus "login" and
#      "default" collection objects from the seeded file) ──────────────────
docker exec --user cua forensix153 bash -c '
  source /home/cua/session-env.sh
  gnome-keyring-daemon --start --components=secrets,pkcs11,ssh
  echo -n "" | gnome-keyring-daemon --unlock
'

# ── 6. Verify from OUTSIDE Chrome before touching the browser at all ───────
docker exec --user cua forensix153 bash -c '
  source /home/cua/session-env.sh
  # default alias resolves to a real collection:
  dbus-send --session --print-reply --dest=org.freedesktop.secrets \
    /org/freedesktop/secrets/aliases/default org.freedesktop.DBus.Properties.Get \
    string:org.freedesktop.Secret.Collection string:Label
  # and is unlocked:
  dbus-send --session --print-reply --dest=org.freedesktop.secrets \
    /org/freedesktop/secrets/collection/login org.freedesktop.DBus.Properties.Get \
    string:org.freedesktop.Secret.Collection string:Locked
  # round-trip a secret:
  echo -n "hunter2" | secret-tool store --label="forensix153 test" service forensix153-test account tester
  secret-tool lookup service forensix153-test account tester
'
# See keyring-pre-verification.txt for the captured output of this step.

# ── 7. Install branded Google Chrome (official .deb, not Chrome for Testing) ─
docker exec forensix153 bash -c \
  "cd /tmp && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
docker exec forensix153 bash -c \
  "DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/google-chrome-stable_current_amd64.deb"
docker exec forensix153 google-chrome --version
# Google Chrome 151.0.7922.108

# ── 8. Local cookie-setting page (no third-party/case data; httpbin.org
#      turned out to be flaky (503s) mid-session, so a two-line stdlib
#      http.server on 127.0.0.1:8899 replaced it) ───────────────────────────
docker exec --user cua forensix153 bash -c 'nohup /usr/bin/python3 /home/cua/cookie_server.py &'
# see cookie_server.py

# ── 9. Launch Chrome non-headless against the real X display, with the
#      verified Secret Service on the bus, plus --enable-logging=stderr
#      --v=1 as instrumentation (not the "cheap CI logging rerun" this
#      ticket explicitly rejected — this is a live desktop acquisition with
#      logging attached, run locally). --no-sandbox/--disable-gpu/
#      --in-process-gpu/--disable-gpu-sandbox were required only because
#      Chrome's zygote fork() and GPU process both fail under QEMU's
#      user-mode amd64-on-arm64 emulation (`clone: Invalid argument`,
#      `GPU process launch failed: error_code=1002`) — neither affects the
#      OSCrypt code path under test, which runs in the browser process. ────
docker exec --user cua forensix153 bash -c '
  source /home/cua/session-env.sh
  google-chrome \
    --user-data-dir=/home/cua/chrome-profile-153 \
    --no-first-run --no-default-browser-check \
    --no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage \
    --in-process-gpu --disable-gpu-sandbox \
    --enable-logging=stderr --v=1 \
    "http://127.0.0.1:8899/" \
    > chrome153.log 2>&1 &
'

# ── 10. Wait for the navigation + cookie write to land in Chrome's in-memory
#       CookieMonster (confirmed via CDP /json that the tab had navigated),
#       THEN send SIGTERM to the browser process for a graceful shutdown —
#       #117 already established cookies set mid-session are invisible on
#       disk in any form until Chrome actually quits. ───────────────────────
docker exec forensix153 bash -c 'kill -TERM <browser-pid>'

# ── 11. Read the result ──────────────────────────────────────────────────
docker exec forensix153 sqlite3 /home/cua/chrome-profile-153/Default/Cookies \
  "SELECT host_key,name,path,hex(encrypted_value) FROM cookies;"
# 127.0.0.1|forensix153|/|763131A5...  →  0x76 0x31 0x31 = "v11"
