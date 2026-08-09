# 149 — disposable Linux lab Source for offline GNOME Keyring OSCrypt recovery.
#
# Base is the pre-existing local image carrying BRANDED Google Chrome for
# linux arm64 (google-chrome-stable 151.0.7922.108-1 arm64) plus Xvfb/fluxbox/dbus-x11.
# This layer only adds the GNOME Keyring provider stack and the acquisition/analysis tools.
#
# Deliberately NOT installed: any Chromium build. Branded Chrome is the Source
# under supervisor ruling (C).
FROM forensix-chrome-desktop:latest

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      gnome-keyring \
      libsecret-tools \
      libsecret-1-0 \
      python3 \
      python3-cryptography \
      sqlite3 \
      coreutils \
    && rm -rf /var/lib/apt/lists/*

# Dedicated non-root Source user. Login password is recorded separately from the
# Source set (it is a case credential, never evidence).
RUN useradd -m -s /bin/bash suspect \
    && echo 'suspect:login-pw-CORRECT' | chpasswd

WORKDIR /work
CMD ["sleep", "infinity"]
