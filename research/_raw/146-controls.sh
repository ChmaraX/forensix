#!/bin/bash
# 146 — negative controls. Every control must yield a typed unavailable(reason)
# or a demonstrable failure to match known plaintext.
#
# Every `security` call inside 146-recover.py carries an explicit keychain path.
# The search list is captured before and after as the isolation trace.
set -u

LAB="${LAB:?}"
KC="${KC:-$LAB/synthetic.keychain-db}"
COOK="${COOK:-$LAB/Cookies}"
KNOWN="${KNOWN:-$LAB/known.json}"
PW="${PW:-synthetic-kc-pw-PHASE1}"
R="python3 ${R_PY:-research/_raw/146-recover.py}"

j() { python3 -c 'import json,sys
d=json.load(sys.stdin)
print("status="+d["status"], "matched="+str(d.get("matched","-")), "reason="+str(d.get("reason",""))[:90])'; }

line() { echo; echo "##### $1"; }

line "C0 isolation trace BEFORE"
security list-keychains

line "C1 correct keychain password (positive reference)"
security lock-keychain "$KC"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C1 | j

line "C2 INCORRECT keychain password"
security lock-keychain "$KC"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "wrong-pw-XXXX" --label C2 | j

line "C3 MISSING Safe Storage item (correct keychain, no such item)"
EMPTY="$LAB/empty.keychain-db"; rm -f "$EMPTY"
security create-keychain -p "$PW" "$EMPTY" >/dev/null 2>&1
$R --keychain "$EMPTY" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C3 | j

line "C4 SELECTOR MISMATCH (Chromium service/account against a Chrome keychain)"
security lock-keychain "$KC"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" \
   --service "Chromium Safe Storage" --account "Chromium" --label C4 | j

line "C5 MISSING keychain store entirely"
$R --keychain "$LAB/does-not-exist.keychain-db" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C5 | j

line "C6 COPIED KEYCHAIN MOVED to a different path (must still work)"
MOVED="$LAB/moved/relocated.keychain-db"; mkdir -p "$LAB/moved"; cp "$KC" "$MOVED"
security lock-keychain "$MOVED" 2>/dev/null
$R --keychain "$MOVED" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C6 | j

line "C7 DAMAGED keychain (header bytes destroyed)"
DMG="$LAB/damaged.keychain-db"; cp "$KC" "$DMG"
python3 - "$DMG" <<'PY'
import sys
p=sys.argv[1]; b=bytearray(open(p,'rb').read())
b[0:16]=b'\x00'*16          # destroy the magic/header
open(p,'wb').write(bytes(b)); print("   destroyed header of", p)
PY
$R --keychain "$DMG" --cookies "$COOK" --known "$KNOWN" --password "$PW" --label C7 | j

line "C8 WRONG DERIVED KEY (correct format, wrong secret)"
security lock-keychain "$KC"
$R --keychain "$KC" --cookies "$COOK" --known "$KNOWN" --password "$PW" \
   --force-secret "AAAAAAAAAAAAAAAAAAAAAA==" --label C8 | j

line "C9 MUTATED CIPHERTEXT (byte flipped in the final AES block, correct key)"
MUT="$LAB/Cookies.mutated"; cp "$COOK" "$MUT"
python3 - "$MUT" <<'PY'
import sqlite3,sys
con=sqlite3.connect(sys.argv[1])
n,ev=con.execute("SELECT name,encrypted_value FROM cookies WHERE name='fx_ascii'").fetchone()
b=bytearray(ev); b[-5]^=0xFF     # corrupt the FINAL block => must break CBC padding
con.execute("UPDATE cookies SET encrypted_value=? WHERE name=?", (bytes(b),n)); con.commit()
print("   mutated ciphertext for", n)
PY
security lock-keychain "$KC"
$R --keychain "$KC" --cookies "$MUT" --known "$KNOWN" --password "$PW" --label C9 \
 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"fx_ascii="+json.dumps(d["rows"].get("fx_ascii",{}),ensure_ascii=False)[:120])'

line "C10 isolation trace AFTER"
security list-keychains
