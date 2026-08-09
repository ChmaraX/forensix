#!/bin/bash
# 146 PHASE 3 — acquire the fxsuspect Source, build the Manifest and a
# second-generation Working Copy.
#
# Runs as the ANALYST (adamchmara), reading the fxsuspect home directory.
# Requires sudo ONLY to read another user's files; it never writes there.
# The Source is treated as immutable: this script copies out and hashes,
# and never modifies anything under /Users/fxsuspect.
set -uo pipefail

SRC_HOME="${SRC_HOME:-/Users/fxsuspect}"
OUT="${OUT:?OUT must be set}"
SUDO="${SUDO:-sudo}"

mkdir -p "$OUT/source_set" "$OUT/working_copy"

echo "=== [0] Source liveness: is anything still running as fxsuspect? ==="
# Cookies are memory-resident until Chrome exits cleanly (#117, and measured in
# phase 1). A live Chrome here would mean the Source is not COLD.
pgrep -fl "fx146-udd" 2>/dev/null | head -5 || echo "  no fx146 Chrome process"
if pgrep -f "fx146-udd" >/dev/null 2>&1; then
  echo "SOURCE_STATE=HOT  <-- STOP. Chrome still running; rows may be unflushed."
  exit 2
fi
echo "SOURCE_STATE=COLD" | tee "$OUT/source_state.txt"

echo "=== [1] acquire the complete Keychains directory (never cherry-picked) ==="
# #144: no first-party source makes login.keychain-db alone universally
# sufficient, so the whole directory is taken, including symlinks and metadata.
$SUDO ditto "$SRC_HOME/Library/Keychains" "$OUT/source_set/Keychains" \
  && echo "  keychains acquired"
$SUDO chown -R "$(id -un)" "$OUT/source_set/Keychains"

echo "=== [2] acquire the Chrome User Data dir ==="
$SUDO ditto "$SRC_HOME/fx146-udd" "$OUT/source_set/fx146-udd" \
  && echo "  user data dir acquired"
$SUDO chown -R "$(id -un)" "$OUT/source_set/fx146-udd"

echo "=== [2b] acquire keychain SEARCH LIST and PREFERENCES state ==="
# #144 names the search-list/preference evidence as required Source alongside
# the keychain files themselves. This state is UNRECOVERABLE once the fxsuspect
# account is deleted, so it must be captured in the same pass as the keychains.
mkdir -p "$OUT/source_set/Preferences"
# Take EVERY com.apple.security* preference that exists rather than guessing
# filenames: on this host the canonical `com.apple.security.plist` is absent and
# the real state lives in differently-named siblings. Guessing one name would
# have silently captured nothing.
FOUND=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  $SUDO ditto "$f" "$OUT/source_set/Preferences/$(basename "$f")" 2>/dev/null \
    && { echo "  acquired Preferences/$(basename "$f")"; FOUND=$((FOUND+1)); }
done < <($SUDO find "$SRC_HOME/Library/Preferences" -maxdepth 1 \
           -name 'com.apple.security*' -type f 2>/dev/null)
echo "  security preference files acquired: $FOUND"
if [ "$FOUND" -eq 0 ]; then
  # Absence is recorded as absence, never silently skipped (Field State rule).
  echo "no com.apple.security* preference files present in the Source home" \
    > "$OUT/source_set/Preferences/ABSENT.txt"
  echo "  ABSENT (recorded, not skipped): no com.apple.security* files"
fi

# The live search list as the SOURCE user saw it cannot be read after logout,
# so record the analyst-side view for contrast and note the limitation.
security list-keychains > "$OUT/analyst_list_keychains_at_acquisition.txt" 2>&1
$SUDO chown -R "$(id -un)" "$OUT/source_set/Preferences"

# DELIBERATE EXCLUSION, recorded so the omission is a decision and not an
# oversight: #144 mentions conservatively acquiring /Library/Keychains too.
# It is NOT taken here. On this host that is the ANALYST's real System keychain,
# not Source material -- it belongs to the acquisition machine, and copying it
# would pull genuine host secrets into a case set for no evidentiary gain.
cat > "$OUT/source_set/EXCLUSIONS.txt" <<'EOF'
/Library/Keychains (host System keychain) — DELIBERATELY NOT ACQUIRED.
Reason: the Source is a disposable ACCOUNT on the analyst's own machine, so
/Library/Keychains is the analyst's real host material rather than Source
material. Chrome's Safe Storage item lives in the user login keychain, which IS
acquired in full. Copying the host System keychain would import real analyst
secrets into a case set with no evidentiary gain.
This exclusion is a property of the same-host Source deviation. A disposable-VM
Source would have its own System keychain, which could then be acquired.
EOF
echo "  recorded deliberate exclusion of /Library/Keychains"

echo "=== [3] record Source context ==="
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version \
  > "$OUT/chrome_version.txt" 2>&1
sw_vers > "$OUT/os_version.txt" 2>&1
$SUDO ls -la "$SRC_HOME/Library/Keychains/" > "$OUT/keychains_listing.txt" 2>&1
cat "$OUT/keychains_listing.txt"

echo "=== [4] SHA-256 Manifest over the immutable Source set ==="
( cd "$OUT/source_set" && find . -type f -print0 \
    | sort -z | xargs -0 shasum -a 256 ) > "$OUT/MANIFEST.sha256"
echo "  manifest entries: $(wc -l < "$OUT/MANIFEST.sha256")"

echo "=== [5] Evidence Set Digest (derived, reproducible with stock tools) ==="
shasum -a 256 "$OUT/MANIFEST.sha256" | awk '{print $1}' \
  > "$OUT/EVIDENCE_SET_DIGEST.txt"
cat "$OUT/EVIDENCE_SET_DIGEST.txt"

echo "=== [6] second-generation Working Copy ==="
ditto "$OUT/source_set" "$OUT/working_copy"
( cd "$OUT/working_copy" && find . -type f -print0 \
    | sort -z | xargs -0 shasum -a 256 ) > "$OUT/MANIFEST_WORKING_COPY.sha256"

if diff -q "$OUT/MANIFEST.sha256" "$OUT/MANIFEST_WORKING_COPY.sha256" >/dev/null; then
  echo "WORKING_COPY_HASHES_MATCH=yes" | tee "$OUT/working_copy_verification.txt"
else
  echo "WORKING_COPY_HASHES_MATCH=no" | tee "$OUT/working_copy_verification.txt"
  diff "$OUT/MANIFEST.sha256" "$OUT/MANIFEST_WORKING_COPY.sha256" | head -20
fi

echo "=== [7] pre-analysis hashes of the keychain files specifically ==="
find "$OUT/source_set/Keychains" -type f -exec shasum -a 256 {} \; \
  | tee "$OUT/keychain_hashes_pre.txt"

echo "=== [8] row prefixes as acquired ==="
python3 - "$OUT/working_copy/fx146-udd/Default/Cookies" <<'PY' \
  | tee "$OUT/cookie_prefixes.txt"
import sqlite3, sys
p = sys.argv[1]
con = sqlite3.connect(f"file:{p}?immutable=1", uri=True)
rows = con.execute("SELECT name, host_key, encrypted_value FROM cookies").fetchall()
print(f"--- {p} ({len(rows)} rows) ---")
for n, h, e in rows:
    print(f"  {n:14s} host={h:12s} prefix={bytes(e)[:3]!r} len={len(e)}")
if rows:
    print("DISTINCT PREFIXES:", sorted({bytes(e)[:3].decode() for _, _, e in rows}))
PY
