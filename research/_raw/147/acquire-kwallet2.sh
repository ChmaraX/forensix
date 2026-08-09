#!/bin/bash
# 147 — Steps 5/6: acquire the Source set from a COLD Source, build a SHA-256
# Manifest, derive a second-generation Working Copy. Mirrors #125: originals are
# never written; analysis runs on the Working Copy only.
set -euo pipefail
SRC_HOME=/home/suspect
ACQ=/out/source_set        # generation 1 — immutable Source set
WC=/out/working_copy       # generation 2 — Working Copy
rm -rf "$ACQ" "$WC"
mkdir -p "$ACQ" "$WC"

echo "=== precondition: Source must be cold ==="
LIVE=$(ps -eo stat,comm | awk '$1 !~ /Z/ && $2=="kwalletd6"' | wc -l)
echo "live (non-zombie) kwalletd6 processes: $LIVE" | tee /out/acquisition_precondition.txt
if [ "$LIVE" -ne 0 ]; then echo "ABORT: Source not cold"; exit 1; fi

echo "=== acquire: browser User Data dir ==="
mkdir -p "$ACQ/user_data"
cp -a "$SRC_HOME/chrome-udd/." "$ACQ/user_data/" 2>/dev/null || true

echo "=== acquire: KWallet store ==="
mkdir -p "$ACQ/xdg_data"
cp -a "$SRC_HOME/.local/share/kwalletd" "$ACQ/xdg_data/" 2>/dev/null || true

echo "=== acquire: legacy KWallet4 store (expected absent -> Field State 'absent') ==="
if [ -d "$SRC_HOME/.kde/share/apps/kwallet" ]; then
  mkdir -p "$ACQ/legacy_kde4"; cp -a "$SRC_HOME/.kde/share/apps/kwallet" "$ACQ/legacy_kde4/"
else
  echo "absent: ~/.kde/share/apps/kwallet does not exist on this Source" > "$ACQ/legacy_kde4.ABSENT.txt"
fi

echo "=== acquire: XDG/KDE configuration ==="
mkdir -p "$ACQ/xdg_config"
cp -a "$SRC_HOME/.config/." "$ACQ/xdg_config/" 2>/dev/null || true

echo "=== acquire: provider identity/versions ==="
cp /out/provider_versions.txt "$ACQ/" 2>/dev/null || true

echo "=== MANIFEST (generation 1, SHA-256 per file) ==="
( cd "$ACQ" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > /out/MANIFEST.sha256
wc -l < /out/MANIFEST.sha256 | xargs echo "manifest entries:"

echo "=== Evidence Set Digest (derived, reproducible with sort + sha256sum) ==="
sha256sum /out/MANIFEST.sha256 | awk '{print $1}' > /out/EVIDENCE_SET_DIGEST.txt
cat /out/EVIDENCE_SET_DIGEST.txt

echo "=== Working Copy (generation 2) ==="
cp -a "$ACQ/." "$WC/"
( cd "$WC" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > /out/MANIFEST_WORKING_COPY.sha256

if diff <(awk '{print $1}' /out/MANIFEST.sha256) <(awk '{print $1}' /out/MANIFEST_WORKING_COPY.sha256) >/dev/null; then
  echo "WORKING_COPY_HASHES_MATCH=yes" | tee /out/working_copy_verification.txt
else
  echo "WORKING_COPY_HASHES_MATCH=no" | tee /out/working_copy_verification.txt
fi

echo "=== wallet hashes, pre-analysis (write-trace control baseline) ==="
sha256sum "$ACQ"/xdg_data/kwalletd/* "$WC"/xdg_data/kwalletd/* | tee /out/wallet_hashes_pre.txt
