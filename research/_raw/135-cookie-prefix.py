import sqlite3
import glob
import binascii

for path in glob.glob('udd/Default/Cookies') + glob.glob('udd/*/Cookies'):
    try:
        con = sqlite3.connect(path)
        cur = con.cursor()
        cur.execute("select host_key, name, encrypted_value from cookies")
        for host, name, blob in cur.fetchall():
            blob = bytes(blob) if blob else b''
            prefix = blob[:3]
            print(path, host, name, prefix, binascii.hexlify(blob[:16]))
    except Exception as e:
        print('ERR', path, e)
