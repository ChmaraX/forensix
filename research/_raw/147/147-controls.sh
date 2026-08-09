#!/bin/bash
# 147 — negative controls, run in the CLEAN analysis container.
#
# Every control must produce a DISTINCT typed unavailable(reason) or a distinct
# wrong result. A control set where every failure yields the same string proves
# nothing, so the reasons are printed verbatim and compared at the end.
#
# Mutations are made on scratch copies under /tmp. The Working Copy is hashed
# before and after the whole run and must be byte-identical.
set -u
WC=/evidence/working_copy
STORE=$WC/xdg_data/kwalletd
COOKIES=$WC/user_data/Default/Cookies
KNOWN=/evidence/known_plaintext.json
PW=FX147walletpw
R="python3 /work/147-recover.py --known $KNOWN --cookies $COOKIES"

echo "########## WRITE TRACE: hashes before ##########"
sha256sum "$STORE"/* "$COOKIES"

run() { echo; echo "########## $1 ##########"; shift; "$@" 2>&1 | grep -E '"(label|status|reason|matched|mismatched|secret_matches_source_ground_truth)"'; }

run "C0  positive control — correct password, correct selectors" \
  $R --store-dir "$STORE" --wallet kdewallet --password "$PW" \
     --expect-secret '44LWBxnVnQ76ZRCYpQ/HfA==' --label C0-positive

run "C1  INCORRECT wallet password" \
  $R --store-dir "$STORE" --wallet kdewallet --password "WRONG-$PW" --label C1-wrong-password

run "C2  correct password, WRONG folder selector (Chromium, not Chrome)" \
  $R --store-dir "$STORE" --wallet kdewallet --password "$PW" \
     --folder "Chromium Keys" --label C2-wrong-folder

run "C3  correct password, WRONG entry-key selector" \
  $R --store-dir "$STORE" --wallet kdewallet --password "$PW" \
     --key "Chromium Safe Storage" --label C3-wrong-key-selector

run "C4  WRONG wallet name (configuration mismatch)" \
  $R --store-dir "$STORE" --wallet notmywallet --password "$PW" --label C4-wrong-wallet-name

# --- missing / empty / multiple stores -------------------------------------
rm -rf /tmp/c5 /tmp/c6 /tmp/c7 /tmp/c8 /tmp/c9 /tmp/c10
mkdir -p /tmp/c6 /tmp/c7 /tmp/c8 /tmp/c9 /tmp/c10

run "C5  MISSING store directory" \
  $R --store-dir /tmp/c5 --password "$PW" --label C5-store-absent

run "C6  EMPTY store directory (no .kwl at all)" \
  $R --store-dir /tmp/c6 --password "$PW" --label C6-store-empty

cp "$STORE"/kdewallet.kwl /tmp/c7/; cp "$STORE"/kdewallet.salt /tmp/c7/
cp "$STORE"/kdewallet.kwl /tmp/c7/second.kwl; cp "$STORE"/kdewallet.salt /tmp/c7/second.salt
run "C7  MULTIPLE wallet files, no wallet named" \
  $R --store-dir /tmp/c7 --password "$PW" --label C7-multiple-wallets

run "C7b MULTIPLE wallet files, wallet named explicitly (must still work)" \
  $R --store-dir /tmp/c7 --wallet kdewallet --password "$PW" --label C7b-multiple-disambiguated

cp "$STORE"/kdewallet.kwl /tmp/c8/
run "C8  SALT FILE MISSING (PBKDF2 wallet cannot be keyed)" \
  $R --store-dir /tmp/c8 --wallet kdewallet --password "$PW" --label C8-salt-absent

# --- mutation --------------------------------------------------------------
cp "$STORE"/kdewallet.kwl "$STORE"/kdewallet.salt /tmp/c9/
python3 - <<'PY'
p='/tmp/c9/kdewallet.kwl'; b=bytearray(open(p,'rb').read())
b[-1] ^= 0x01                      # flip one bit of the last ciphertext byte
open(p,'wb').write(bytes(b))
PY
run "C9  MUTATED wallet (one bit flipped in the ciphertext)" \
  $R --store-dir /tmp/c9 --wallet kdewallet --password "$PW" --label C9-mutated-wallet

# --- unsupported cipher / hash --------------------------------------------
cp "$STORE"/kdewallet.salt /tmp/c10/
python3 - <<'PY'
src='/evidence/working_copy/xdg_data/kwalletd/kdewallet.kwl'
b=bytearray(open(src,'rb').read())
g=bytearray(b); g[14]=2; g[15]=0        # cipher=GPG
open('/tmp/c10/kdewallet.kwl','wb').write(bytes(g))
e=bytearray(b); e[14]=0                 # cipher=BLOWFISH_ECB (legacy)
open('/tmp/c10/ecbwallet.kwl','wb').write(bytes(e))
h=bytearray(b); h[15]=0                 # hash=SHA1 (legacy pre-4.13)
open('/tmp/c10/oldhash.kwl','wb').write(bytes(h))
t=bytearray(b); t[14]=1                 # cipher=3DES_CBC (never supported)
open('/tmp/c10/des.kwl','wb').write(bytes(t))
m=bytearray(b); m[3]=0x58               # corrupt the magic
open('/tmp/c10/badmagic.kwl','wb').write(bytes(m))
PY
cp /tmp/c10/kdewallet.salt /tmp/c10/ecbwallet.salt 2>/dev/null
cp /tmp/c10/kdewallet.salt /tmp/c10/oldhash.salt
cp /tmp/c10/kdewallet.salt /tmp/c10/des.salt
cp /tmp/c10/kdewallet.salt /tmp/c10/badmagic.salt

for w in kdewallet ecbwallet oldhash des badmagic; do
  run "C10-$w  unsupported cipher/hash header variant" \
    $R --store-dir /tmp/c10 --wallet $w --password "$PW" --label C10-$w
done

# --- wrong key, and mutated row ciphertext ---------------------------------
run "C11 WRONG key material (correct wallet bypassed, bogus secret forced)" \
  $R --store-dir "$STORE" --wallet kdewallet --password "$PW" \
     --force-secret 'AAAAAAAAAAAAAAAAAAAAAA==' --label C11-wrong-key

cp "$COOKIES" /tmp/cookies-mutated.db
python3 - <<'PY'
import sqlite3
con=sqlite3.connect('/tmp/cookies-mutated.db')
n,ev=con.execute("SELECT name,encrypted_value FROM cookies ORDER BY name LIMIT 1").fetchone()
b=bytearray(ev); b[-1]^=0x01           # flip a bit in the LAST ciphertext block
con.execute("UPDATE cookies SET encrypted_value=? WHERE name=?", (bytes(b), n)); con.commit()
print("mutated row:", n)
PY
echo; echo "########## C12 MUTATED row ciphertext (one bit) ##########"
python3 /work/147-recover.py --known $KNOWN --cookies /tmp/cookies-mutated.db \
  --store-dir "$STORE" --wallet kdewallet --password "$PW" --label C12-mutated-ciphertext \
  2>&1 | grep -E '"(label|status|matched|mismatched|unavailable)"|unavailable'

echo
echo "########## WRITE TRACE: hashes after ##########"
sha256sum "$STORE"/* "$COOKIES"

echo
echo "########## ISOLATION TRACE ##########"
echo "kwallet packages installed : $(dpkg -l | grep -c kwallet)"
echo "chrome packages installed  : $(dpkg -l | grep -ci chrome)"
echo "gnome-keyring/libsecret    : $(dpkg -l | grep -cE '(gnome-keyring|libsecret)')"
echo "dbus daemon processes      : $(pgrep -c dbus-daemon || echo 0)"
echo "DBUS_SESSION_BUS_ADDRESS   : '${DBUS_SESSION_BUS_ADDRESS:-<unset>}'"
echo "any kwalletd binary        : $(command -v kwalletd kwalletd5 kwalletd6 || echo none)"
echo "network interfaces         : $(ls /sys/class/net | grep -v '^lo$' | tr '\n' ' ' || true)"
echo "sockets open               : $(ls -l /proc/net/unix >/dev/null 2>&1 && grep -c . /proc/net/unix || echo n/a)"
