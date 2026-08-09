#!/bin/bash
# 149 — Step 5/6: acquire the Source set, build a SHA-256 Manifest, derive a
# second-generation Working Copy. Mirrors the #125 integrity model:
# originals are never written; analysis runs on the Working Copy.
set -euo pipefail
SRC_HOME=/home/suspect
ACQ=/out/source_set        # generation 1 — immutable Source set
WC=/out/working_copy       # generation 2 — Working Copy
mkdir -p "$ACQ" "$WC"

echo "=== acquire: browser User Data dir ==="
mkdir -p "$ACQ/user_data"
cp -a "$SRC_HOME/chrome-udd/." "$ACQ/user_data/" 2>/dev/null || true

echo "=== acquire: XDG data (keyring store) ==="
mkdir -p "$ACQ/xdg_data"
cp -a "$SRC_HOME/.local/share/keyrings" "$ACQ/xdg_data/" 2>/dev/null || true

echo "=== acquire: legacy GNOME store (expected absent -> Field State 'absent') ==="
if [ -d "$SRC_HOME/.gnome2/keyrings" ]; then
  mkdir -p "$ACQ/legacy_gnome2"
  cp -a "$SRC_HOME/.gnome2/keyrings" "$ACQ/legacy_gnome2/"
else
  echo "absent: ~/.gnome2/keyrings does not exist on this Source" > "$ACQ/legacy_gnome2.ABSENT.txt"
fi

echo "=== acquire: XDG config ==="
mkdir -p "$ACQ/xdg_config"
cp -a "$SRC_HOME/.config/." "$ACQ/xdg_config/" 2>/dev/null || true

echo "=== acquire: provider identity/versions ==="
cp /out/provider_versions.txt /out/chrome_version.txt "$ACQ/" 2>/dev/null || true

echo "=== MANIFEST (generation 1, SHA-256 per file) ==="
( cd "$ACQ" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > /out/MANIFEST.sha256
wc -l < /out/MANIFEST.sha256 | xargs echo "manifest entries:"

echo "=== Evidence Set Digest (derived, reproducible with standard tools) ==="
sha256sum /out/MANIFEST.sha256 | awk '{print $1}' > /out/EVIDENCE_SET_DIGEST.txt
cat /out/EVIDENCE_SET_DIGEST.txt

echo "=== Working Copy (generation 2) ==="
cp -a "$ACQ/." "$WC/"
( cd "$WC" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > /out/MANIFEST_WORKING_COPY.sha256

echo "=== verify Working Copy == Source set ==="
if diff <(awk '{print $1}' /out/MANIFEST.sha256) <(awk '{print $1}' /out/MANIFEST_WORKING_COPY.sha256) >/dev/null; then
  echo "WORKING_COPY_HASHES_MATCH=yes" | tee /out/working_copy_verification.txt
else
  echo "WORKING_COPY_HASHES_MATCH=no" | tee /out/working_copy_verification.txt
  diff <(awk '{print $1}' /out/MANIFEST.sha256) <(awk '{print $1}' /out/MANIFEST_WORKING_COPY.sha256) | head
fi

echo "=== key store hashes (pre-analysis, for the write-trace control) ==="
sha256sum "$ACQ"/xdg_data/keyrings/* 2>/dev/null | tee /out/keyring_hashes_pre.txt || true
