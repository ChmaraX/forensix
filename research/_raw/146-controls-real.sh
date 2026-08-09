#!/bin/bash
# 146 PHASE 3 — negative controls against the REAL acquired keychain.
#
# Phase 1 ran these against a keychain this experiment created with
# `security create-keychain`. That proves the harness, NOT the real thing:
# a real macOS login keychain differs in ACL structure and format, so the
# Phase 1 results are not carried forward. Every control is re-run here and
# any divergence from Phase 1 is reported rather than smoothed over.
#
# All work is on the WORKING COPY. The Source set is never touched.
set -uo pipefail

WC="${WC:?WC must be the working_copy dir}"
OUT="${OUT:?OUT must be set}"
KC="${KC:-$WC/Keychains/login.keychain-db}"
COOK="${COOK:-$WC/fx146-udd/Default/Cookies}"
KNOWN="${KNOWN:?KNOWN must be the known-plaintext json}"
PW="${PW:-fx-kc-pw-DIFFERENT}"
LOGIN_PW="${LOGIN_PW:-fx-src-pw-146}"
R="python3 ${R_PY:-research/_raw/146-recover.py}"
LAB="${LAB:-$OUT/controls-scratch}"
mkdir -p "$LAB"

j() { python3 -c 'import json,sys
d=json.load(sys.stdin)
print("status="+d["status"], "matched="+str(d.get("matched","-")), "reason="+str(d.get("reason",""))[:90])'; }

line() { echo; echo "##### $1"; }

line "C0 isolation trace BEFORE (analyst search list)"
security list-keychains

line "C1 correct keychain password (positive reference)"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C1 | j

line "C2 INCORRECT keychain password"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "wrong-pw-XXXX" --label C2 | j

line "C3 LOGIN password used as the keychain password (they were decoupled)"
# Load-bearing: step 3 deliberately set the keychain password different from the
# login password, so this must FAIL. If it succeeds, the decoupling did not take
# effect and #144's caution about the two credentials is unproven here.
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$LOGIN_PW" --label C3 | j

line "C4 SELECTOR MISMATCH (Chromium service/account against a Chrome keychain)"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" \
   --service "Chromium Safe Storage" --account "Chromium" --label C4 | j

line "C5 MISSING keychain store entirely"
$R --keychain "$LAB/does-not-exist.keychain-db" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C5 | j

line "C6 COPIED KEYCHAIN MOVED to a different path"
MOVED="$LAB/moved/relocated.keychain-db"; mkdir -p "$LAB/moved"; cp "$KC" "$MOVED"
$R --keychain "$MOVED" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C6 | j

line "C7 DAMAGED keychain (header destroyed)"
DMG="$LAB/damaged.keychain-db"; cp "$KC" "$DMG"
python3 - "$DMG" <<'PY'
import sys
p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[0:16]=b'\x00'*16
open(p,'wb').write(bytes(b)); print("   destroyed header")
PY
$R --keychain "$DMG" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C7 | j

line "C8 MISSING COMPANION FILES (keychain alone, siblings removed)"
# #144: no first-party source makes login.keychain-db alone universally
# sufficient. This measures whether it actually is, on this generation.
SOLO="$LAB/solo"; rm -rf "$SOLO"; mkdir -p "$SOLO"
cp "$KC" "$SOLO/login.keychain-db"
$R --keychain "$SOLO/login.keychain-db" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C8 | j

line "C9 WRONG DERIVED KEY (correct format, wrong secret)"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" \
   --force-secret "AAAAAAAAAAAAAAAAAAAAAA==" --label C9 | j

line "C10 MUTATED CIPHERTEXT (final AES block corrupted, correct key)"
MUT="$LAB/Cookies.mutated"; cp "$COOK" "$MUT"
python3 - "$MUT" <<'PY'
import sqlite3,sys
con=sqlite3.connect(sys.argv[1])
row=con.execute("SELECT name,encrypted_value FROM cookies WHERE name='fx_ascii'").fetchone()
if row:
    n,ev=row; b=bytearray(ev); b[-5]^=0xFF
    con.execute("UPDATE cookies SET encrypted_value=? WHERE name=?", (bytes(b),n)); con.commit()
    print("   mutated ciphertext for", n)
else:
    print("   fx_ascii not present")
PY
$R --keychain "$KC" --cookies "$MUT" --known "$KNOWN" --password "$PW" --label C10 \
 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"fx_ascii="+json.dumps(d["rows"].get("fx_ascii",{}),ensure_ascii=False)[:120])'

line "C11 isolation trace AFTER (must equal C0)"
security list-keychains

line "C12 WRITE TRACE: keychain hashes after all controls"
find "$WC/Keychains" -type f -exec shasum -a 256 {} \;
