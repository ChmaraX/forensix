#!/bin/bash
# 149 — negative controls. Every control must yield a typed unavailable(reason)
# or a demonstrable failure to match known plaintext. Run in the ANALYSIS container.
set -u
export HOME=/home/analyst
R="python3 /work/149-recover.py"
WC=/tmp/wc
COOK=$WC/user_data/Default/Cookies
KNOWN=/tmp/known.json
PW=keyring-pw-DIFFERENT
line() { echo; echo "##### $1"; }

line "C1 correct keyring password (positive reference)"
$R --store-dir $WC/xdg_data --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --label C1 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"matched="+str(d.get("matched")),d.get("reason",""))'

line "C2 INCORRECT keyring password"
$R --store-dir $WC/xdg_data --cookies $COOK --known $KNOWN --password "wrong-pw-XXXX" --app chrome --route replay --label C2 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:150])'

line "C3 login password used as keyring password (login != keyring)"
$R --store-dir $WC/xdg_data --cookies $COOK --known $KNOWN --password "login-pw-CORRECT" --app chrome --route replay --label C3 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:150])'

line "C4 MISSING item (wrong application selector)"
$R --store-dir $WC/xdg_data --cookies $COOK --known $KNOWN --password "$PW" --app chromium --route replay --label C4 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:150])'

line "C5 MISSING store entirely (no keyrings dir at all)"
rm -rf /tmp/empty && mkdir -p /tmp/empty
$R --store-dir /tmp/empty --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --label C5 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:150])'

line "C6 MUTATED *.keyring (single byte flipped in the encrypted blob)"
rm -rf /tmp/mut && cp -a $WC/xdg_data /tmp/mut
python3 - <<'PY'
p="/tmp/mut/keyrings/login.keyring"
b=bytearray(open(p,'rb').read())
b[len(b)//2] ^= 0xFF
open(p,'wb').write(bytes(b))
print("flipped byte at offset", len(b)//2)
PY
$R --store-dir /tmp/mut --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --label C6 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:150])'

line "C7 WRONG derived key (correct format, wrong secret)"
$R --store-dir $WC/xdg_data --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --force-secret "AAAAAAAAAAAAAAAAAAAAAA==" --label C7 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"matched="+str(d.get("matched")),"mismatched="+str(d.get("mismatched")));[print("   ",k,list(v.keys())) for k,v in list(d.get("rows",{}).items())[:2]]'

line "C8 MUTATED ciphertext (byte flipped INSIDE the final AES block, correct key)"
rm -rf /tmp/mutdb && mkdir -p /tmp/mutdb && cp $COOK /tmp/mutdb/Cookies
python3 - <<'PY'
import sqlite3
con=sqlite3.connect("/tmp/mutdb/Cookies")
n,ev=con.execute("SELECT name,encrypted_value FROM cookies WHERE name='fx_ascii'").fetchone()
b=bytearray(ev); b[-5]^=0xFF          # corrupt the FINAL AES block => must break CBC padding
con.execute("UPDATE cookies SET encrypted_value=? WHERE name=?", (bytes(b),n)); con.commit()
print("mutated ciphertext for", n)
PY
$R --store-dir $WC/xdg_data --cookies /tmp/mutdb/Cookies --known $KNOWN --password "$PW" --app chrome --route replay --label C8 | python3 -c 'import json,sys;d=json.load(sys.stdin);r=d["rows"].get("fx_ascii",{});print("status="+d["status"],"fx_ascii=",json.dumps(r,ensure_ascii=False)[:180])'

line "C9 LEGACY location ~/.gnome2/keyrings (store moved to legacy path)"
rm -rf /tmp/legacy && mkdir -p /tmp/legacy && cp -a $WC/xdg_data/keyrings /tmp/legacy/
ls /tmp/legacy/keyrings >/dev/null && echo "legacy layout prepared"
$R --store-dir /tmp/legacy --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --label C9 | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"matched="+str(d.get("matched")),"reason="+str(d.get("reason"))[:120])'


line "C10b MULTIPLE matching items (second application=chrome item planted in a COPY)"
rm -rf /tmp/multi && cp -a $WC/xdg_data /tmp/multi
( export XDG_DATA_HOME=/tmp/multi; export HOME=/tmp/multi
  eval "$(dbus-launch --sh-syntax)"
  printf %s "$PW" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1
  sleep 1
  # plant a DECOY item with the same selector, into the COPY only
  printf %s "ZZZZdecoyZZZZdecoyZZZ==" | secret-tool store --label="Chrome Safe Storage DECOY" application chrome decoy yes
  echo "planted decoy rc=$?"
  printf %s "YYYYdecoy2YYYYdecoy2YY==" | secret-tool store --label="Chrome Safe Storage DECOY2" application chrome
  echo "planted decoy2 rc=$?"
  echo "items now: $(secret-tool search --all application chrome 2>/dev/null | grep -c '^secret = ')"
) 2>&1 | sed 's/^/    /'
$R --store-dir /tmp/multi --cookies $COOK --known $KNOWN --password "$PW" --app chrome --route replay --label C10b | python3 -c 'import json,sys;d=json.load(sys.stdin);print("status="+d["status"],"reason="+str(d.get("reason"))[:120])'
