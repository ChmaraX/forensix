#!/bin/bash
# 146 PHASE 1 — prove the ENTIRE recovery chain against a SYNTHETIC standalone
# keychain that this script creates itself, before any real Source exists.
#
# No sudo. No GUI. No human. Touches ONLY paths under $LAB.
#
# SAFETY: every `security` invocation below carries an EXPLICIT keychain path
# operand. None of them can reach the analyst's login keychain, and none of
# them modifies the search list. The caller captures `security list-keychains`
# before and after as the isolation trace.
set -uo pipefail

LAB="${LAB:?LAB must be set to a scratch dir under the worktree}"
OUT="${OUT:?OUT must be set to the evidence dir}"
KC="$LAB/synthetic.keychain-db"
KC_PW="synthetic-kc-pw-PHASE1"
SERVICE="Chrome Safe Storage"
ACCOUNT="Chrome"
# Chrome's real item value is Base64(random 16 bytes); mimic that shape exactly.
SECRET="c3ludGhldGljLXNlY3JldC0xNg=="

mkdir -p "$LAB" "$OUT"
rm -f "$KC"

echo "=== [1] create a standalone keychain at an explicit path ==="
security create-keychain -p "$KC_PW" "$KC" && echo "create-keychain rc=0"

echo "=== [2] confirm the search list was NOT touched by creation ==="
security list-keychains

echo "=== [3] plant a Safe Storage item shaped like Chrome's ==="
security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$SECRET" "$KC" \
  && echo "add-generic-password rc=0"

echo "=== [4] lock it, so recovery must genuinely unlock ==="
security lock-keychain "$KC" && echo "lock-keychain rc=0"

echo "=== [5] RECOVER by explicit path: unlock + find-generic-password ==="
security unlock-keychain -p "$KC_PW" "$KC" && echo "unlock rc=0"
GOT=$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$KC" 2>&1)
echo "recovered_secret=$GOT"
[ "$GOT" = "$SECRET" ] && echo "SECRET_MATCH=yes" || echo "SECRET_MATCH=no"

echo "=== [6] search list AFTER all operations ==="
security list-keychains
