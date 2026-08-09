# 147 — Offline Chrome OSCrypt `v11` recovery from a copied KWallet

**Ticket:** [Experiment: offline Chrome OSCrypt recovery from a copied KWallet](https://github.com/ChmaraX/forensix/issues/147)

**Question:** can ForensiX recover a real OSCrypt `v11` key and decrypt known Chrome data using only copied KWallet evidence and an authorized wallet credential?

**Answer: YES, for three tested variants.** 5 of 5 known-plaintext rows recovered on each of **KWallet6 (blowfish `.kwl`)**, **KWallet5 (blowfish `.kwl`)** and a **GPG-backed wallet** — each from a copied store, in a clean analysis container with no KWallet, no D-Bus and no network, with the copied store byte-identical afterwards. Untested variants are enumerated in §8 and remain unproven.

This supersedes the first attempt's `NOT ESTABLISHED` verdict, which was **blocked upstream**: no wallet could be created headlessly, so nothing could be copied. That blocker is now broken, and §2 records how.

**Evidence legend** (as in `research/144-offline-oscrypt-key-recovery.md`): **LOCALLY-DEMONSTRATED** = run end-to-end here against a disposable known-plaintext Source; **SOURCE-CONFIRMED** = cited first-party source; **INFERRED** = consequence, not result; **UNTESTED** = not exercised.

---

## 1. Headline

### LOCALLY-DEMONSTRATED ✅

| Variant | Provider | Source secret (ground truth) | Rows recovered | Secret matched |
|---|---|---|---|---|
| Blowfish `.kwl` | kwallet6 6.13.0, Debian trixie arm64 | `44LWBxnVnQ76ZRCYpQ/HfA==` | **5/5** | yes |
| Blowfish `.kwl` | kwalletd5 5.115.0, Ubuntu 24.04 arm64 | `LjdelK4IBGonJkCcDSyvxA==` | **5/5** | yes |
| GPG-backed | kwallet6 6.13.0 + GnuPG (RSA-2048) | `bnMNN9YHMSBAYJ96TtjLcA==` | **5/5** | yes |

Every row is `v11`, written by branded Google Chrome 151.0.7922.108 arm64 with the KWallet provider actually selected:

```
OSCrypt.FreedesktopSecretKeyProvider.InitStatus  → 0     (success)
OSCrypt.EncryptorKeyCount 3 / .Available 2 / .PermanentlyUnavailable 0
cookie prefixes                                  → ['v11']   (5/5 rows)
wallet folders                                   → "Chrome Keys", "Form Data", "Passwords"
wallet entry                                     → "Chrome Keys" / "Chrome Safe Storage"
```

Attempt 1 recorded `InitStatus → 12` (`KWalletNoService`) and `v10` on both distros. The *only* thing that changed is that a wallet now exists to open. **The provider was never unreachable; it had nothing to open.**

---

## 2. What unblocked it: answer the dialog, don't bypass it

### LOCALLY-DEMONSTRATED ✅

Attempt 1 tried the headless `pam_kwallet` route and got as far as `key_sent=True env_sent=True` without ever producing a `.kwl`. It listed three ways forward and ranked a real desktop session **last**, as "VM spend".

That ranking was wrong, and the reason is worth recording: **a virtual X display is not a VM.** `Xvfb` + `fluxbox` + `xdotool` — already installed in the attempt-1 image — give kwalletd a display it will draw on and a way to answer it. Wallet creation took three clicks and one typed password:

1. `kwalletrc` with `First Use=false` (suppresses the multi-page setup wizard).
2. `org.kde.KWallet.open` over D-Bus raises the creation dialog. **`dbus-send --reply-timeout` must be raised** — the 25s default expires mid-dialog and the abandoned call aborts the transaction, which is what "the dialog appears and nothing happens" looked like.
3. Choose the wallet type, click Finish, then type the password **into the second field via `Tab`**. A second mouse click does *not* move focus; both strings land in "Password" and the dialog answers `Passwords do not match`.

Same three clicks work unchanged on kwalletd5 and kwalletd6, and the same dialog offers the **GPG** variant on page 1 (page 2 then lists trusted keys). Screenshots: `research/_raw/147-evidence2/screenshots/`.

**Consequence for #127:** a KWallet fixture *is* recordable by an automated harness. It needs a virtual display and a dialog driver, not a desktop VM and not `pam_kwallet`.

### The secret is not on disk until the wallet is closed

After Chrome wrote its key, the `.kwl` on disk was still the 148-byte empty wallet. It only grew to 320 bytes when the wallet was **closed** (`org.kde.KWallet.close`), which is when kwalletd syncs.

This is #117's in-memory-cookie finding again, in a new place: **a live-machine copy of a KWallet store can be missing the very key the analyst is copying it for.** A collector that copies wallet files while the desktop session is running gets whatever was last synced, not what Chrome is using. Recorded here as a Finding about acquisition, and it strengthens [#158](https://github.com/ChmaraX/forensix/issues/158)'s preference for capturing derived key material live.

---

## 3. The `.kwl` format, source-confirmed

Parsed by `research/_raw/147/kwl_parse.py`, written against the **exact shipped sources of the Source's own provider** — `apt-get source kwallet6` → `kwallet-6.13.0`, not upstream `master`:

```
 0   12   KWMAGIC = "KWALLET\n\r\0\r\n"
12    4   version[4] = {major, minor, cipher, hash}
16    …   PLAINTEXT hash index: quint32 folderCount,
          per folder { MD5(folder)[16], quint32 entryCount, MD5(entry)[16] × n }
 …    …   Blowfish-CBC ciphertext, zero IV, to EOF

plaintext = random[8] ‖ payload_size[4 BE] ‖ payload ‖ random_pad ‖ SHA1(payload)[20]
payload   = QDataStream: QString folder, quint32 n, { QString key, qint32 type, QByteArray value } × n
key       = PBKDF2-HMAC-SHA512(password_utf8, salt, 50000, 56), salt = <wallet>.salt (56 raw bytes)
```

Observed header on every wallet built here: `00 01 03 02` = v0.1, cipher `3` (`KWALLET_CIPHER_BLOWFISH_CBC`), hash `2` (`KWALLET_HASH_PBKDF2_SHA512`).

A `Password` entry's value is **not** the bare UTF-8 text: `Entry::setValue(const QString&)` does `ds << value`, so it is a QDataStream-serialised QString (quint32 byte length + UTF-16BE).

### Two endianness traps, in opposite directions

Both `blowfish.cc` and `sha1.cc` open with the same hardcoded line — above the comment *"DO NOT INCLUDE THIS. IT BREAKS KWALLET."*:

```c
#define Q_BIG_ENDIAN 1
#define Q_BYTE_ORDER Q_BIG_ENDIAN
```

The two files then use that constant for **opposite** purposes, so on a little-endian Source:

- **`blowfish.cc`** takes the branch that *does* byte-swap, which cancels the little-endian `uint32_t*` load → **ordinary, standard Blowfish**.
- **`sha1.cc`** takes the branch that does *nothing* (`memcpy(x, _data, 64)` in, `*(uint32_t *)p = _h##a` out) → **not standard SHA-1**: message words load little-endian and the digest is emitted little-endian.

I got this backwards first, "fixed" Blowfish, and produced a clean SHA1 mismatch that is **indistinguishable from a wrong password**. Recorded because it is a live trap for the implementation: a parser that reaches for `hashlib.sha1` rejects a perfectly good wallet and blames the analyst's credential.

**Forensically load-bearing:** the integrity trailer depends on the endianness of the machine that *wrote* the wallet, so an acquisition must record the Source's architecture, and a big-endian Source needs the mirror-image treatment (standard SHA-1, byte-swapped Blowfish). Verified on aarch64 (LE) only; big-endian is **UNTESTED**.

### The blowfish variant leaks folder and entry names; the GPG variant does not

The MD5 hash index at offset 16 is **outside the encryption**. Folder and entry names are recoverable by dictionary — `MD5("Chrome Keys")`, `MD5("Chrome Safe Storage")` — from a wallet whose password is unknown and may never be recovered.

That yields a **Candidate**, never a Finding: it evidences *"a Chrome safe-storage entry existed in this wallet"* without decrypting anything. The GPG wallet writes no such index — its OpenPGP packet starts at byte 16 — so the same inference is unavailable there.

### GPG-backed wallets

Header `00 01 02 00` (cipher `2` = `KWALLET_CIPHER_GPG`, hash `0`), then a raw OpenPGP message. Decrypted plaintext is `QString keyID ‖ QByteArray hashes ‖ QByteArray values`, where `values` is the same entry stream as above.

---

## 4. Recovery, and the derivation under test

### LOCALLY-DEMONSTRATED ✅

```
secret = wallet["Chrome Keys"]["Chrome Safe Storage"]      (24-char base64, all three variants)
key    = PBKDF2-HMAC-SHA1(secret, b"saltysalt", iterations=1, dklen=16)
plain  = AES-128-CBC(key, IV = b" " * 16).decrypt(row.encrypted_value[3:])
```

Confirms #144's Linux `v11` derivation on real KWallet-sourced key material, and confirms two #149 findings now hold for **KWallet** as well as GNOME Keyring — they were GNOME-only before:

- a **32-byte domain-hash prefix** precedes the plaintext (`interp: domain-prefixed` on all 5 rows);
- cookie values are stored **percent-encoded**, so the non-ASCII row matches only after `unquote` (`match_form: percent-decoded`).

**CBC has no AEAD.** A successful decrypt is padding-plausibility plus a UTF-8 decode, never proof. The only reason these are Findings rather than Candidates is the pre-recorded known plaintext, and the ground-truth secret read from the Source before shutdown. In casework neither exists, so a decrypted `v11` row is a **Finding about bytes** and its correctness rests on the key's provenance, not on the row.

---

## 5. Isolation and integrity

| Property | Value |
|---|---|
| Analysis container | `debian:trixie-slim` + python3/cryptography/sqlite3 only, `--network none` |
| KWallet packages | **0** — no `kwalletd`, no `kwalletd5/6`, no `libkwalletbackend` |
| Chrome packages | **0** |
| gnome-keyring / libsecret | **0** |
| D-Bus daemons running | **0**; `DBUS_SESSION_BUS_ADDRESS` unset |
| Source container | **stopped** for the whole controls run |
| Route used | direct file parse — no daemon, no D-Bus, no replay |
| Working Copy hashes, before vs after | **identical** (`sha256` on `.kwl`, `.salt`, `Cookies`) |

Manifest / Evidence Set Digest / Working Copy per #125, one set per variant:

| Variant | Manifest entries | Evidence Set Digest | Working Copy |
|---|---|---|---|
| KWallet6 | 158 | `c79a7ee8d388919d…` | hashes match |
| KWallet5 | 158 | `ad25af7cfb3a876c…` | hashes match |
| GPG | 163 | `1f8f9dc7404df678…` | hashes match |

**No live Source key store was queried, and the analyst's machine has none.** Deliberately, only a **direct-parse** route is offered: shipping a `kwalletd` inside ForensiX would mean executing the suspect's provider. The parser is instead validated against the ground-truth secret recorded at Source time — a stronger check than agreeing with a daemon.

---

## 6. Controls

Full transcript: `research/_raw/147-evidence2/controls.txt`. Every control produces a **distinct** typed `unavailable(reason)`; a set that collapsed to one string would prove nothing.

| # | Control | Result |
|---|---|---|
| C0 | correct password, correct selectors | `ok`, 5/5, secret matches ground truth |
| C1 | **incorrect** wallet password | `kwl-wrong-password-or-corrupt (size field out of range)` |
| C2 | wrong folder selector (`Chromium Keys`) | `kwallet-folder-absent:…\|present:[…]` |
| C3 | wrong entry-key selector | `kwallet-entry-absent:…\|present:[…]` |
| C4 | wrong wallet name (config mismatch) | `kwallet-named-wallet-absent:notmywallet` |
| C5 | store directory missing | `kwallet-store-absent` |
| C6 | store directory empty | `kwallet-store-empty` |
| C7 | **multiple** wallet files, none named | `kwallet-multiple-wallets-ambiguous:2:…` — never guesses |
| C7b | multiple wallets, named explicitly | `ok`, 5/5 |
| C8 | `.salt` missing (PBKDF2 wallet) | `kwallet-salt-file-absent` |
| C9 | **mutated wallet** (1 bit in ciphertext) | `kwl-payload-sha1-mismatch` |
| C10 | cipher/hash header variants | `kwl-gpg-wallet-needs-private-key`, `kwl-legacy-ecb-wallet-untested`, `kwl-legacy-sha1-hash-untested`, `kwl-unsupported-cipher:1`, `kwl-bad-magic` |
| C11 | wrong key material (bogus secret) | `failed`, 0/5 — every row rejected |
| C12 | **mutated row ciphertext** (1 bit) | `partial`, 4/5, mutated row → `cbc-padding-invalid` |
| G1 | GPG private key absent | `kwallet-gpg-private-key-absent` |
| G2 | GPG keyring directory missing | `kwallet-gpg-keyring-absent` |
| G3b | GPG **wrong passphrase** | `kwallet-gpg-wrong-passphrase` |
| G3c | correct passphrase, same fresh copy | `ok`, 5/5 — proves G3b is the passphrase, not the copy |
| G4 | GPG **wrong key** (valid, unrelated) | `kwallet-gpg-private-key-absent` |
| G5 | GPG agent unavailable, no passphrase | `kwallet-gpg-decrypt-failed:…batchmode - can't get input` |
| G6 | blowfish route against a GPG wallet | `kwl-gpg-wallet-needs-private-key` |

### One control failed the first time, and that is a finding

**G3 (wrong passphrase) initially returned `ok`, 5/5.** The acquired `~/.gnupg` carried `allow-preset-passphrase`, and a `gpg-agent` started inside the analysis container from the copied home had the passphrase **cached from the earlier successful run** — `gpg-connect-agent "keyinfo --list"` shows the key as `P` (passphrase cached). GPG never checked the wrong passphrase because it never needed it.

So: **a copied GPG environment can decrypt without the credential the analyst thinks is authorising it.** Any GPG-wallet procedure must kill the agent and work from a fresh copy of the keyring per attempt, or an unauthorised decryption will look authorised, and a wrong-credential control will silently pass. C3b/C3c re-run under those conditions and behave correctly.

---

## 7. Consequences for other tickets

- **[#144](https://github.com/ChmaraX/forensix/issues/144)** — its KWallet rows can move from `experimental` / INFERRED-UNTESTED to **demonstrated** for the three variants in §1. Its Linux `v11` derivation is confirmed against real KWallet key material. Attempt 1's correction stands: KWallet is handled inside `FreedesktopSecretKeyProvider` on M151, not a distinct `KWalletKeyProvider`.
- **[#149](https://github.com/ChmaraX/forensix/issues/149)** — its two parser findings (32-byte domain prefix, percent-encoded values) are **no longer GNOME-only**; they reproduce on KWallet, so they are OSCrypt-level, not provider-level.
- **[#127](https://github.com/ChmaraX/forensix/issues/127)** — a KWallet fixture is recordable by the harness: virtual display + dialog driver, no VM, no `pam_kwallet`. `.kwl` fixtures must be pinned with the **Source architecture**, because the integrity trailer is endianness-dependent.
- **[#158](https://github.com/ChmaraX/forensix/issues/158)** — reinforced from a new direction: an unsynced wallet means a file-copy of a live KWallet store can lack the key entirely.
- **[#125](https://github.com/ChmaraX/forensix/issues/125)** — the plaintext MD5 index gives a new **Candidate** class: "a Chrome safe-storage entry existed in this wallet", available with no credential at all.

## 8. What was NOT tested

| Variant | Status | Reason |
|---|---|---|
| KWallet4 direct integration | **UNTESTED** | `unavailable(reason): variant-unobtainable-on-current-arm64-distro` — absent from Ubuntu 24.04 and Debian trixie |
| Legacy ECB wallet (`cipher=0`) | **UNTESTED** | typed reason implemented and exercised on a synthetic header only; no genuine ECB wallet produced |
| Legacy SHA1 hash (`hash=0`, pre-4.13) | **UNTESTED** | same — synthetic header only |
| Big-endian Source | **UNTESTED** | the endianness analysis in §3 predicts the mirror image; not run |
| Secret-Service migration / proxy behaviour | **UNTESTED** | kwalletd's `org.freedesktop.secrets` proxy was never exercised |
| Password-less wallet | **UNTESTED** | not produced |
| Smartcard-backed GPG key | **UNTESTED** | only a software RSA-2048 key was used |
| `Passwords` / `Form Data` folders | **UNTESTED** | Chrome created them but left them empty, as in #117 |

Per the ticket's own instruction, **nothing here is generalised from one wallet variant to another.** Three variants pass; the rest are open.

## 9. Reproduction

`research/_raw/147/`: `Dockerfile.kw6` (Debian/KWallet6), `Dockerfile.gate` (Ubuntu/KWallet5), `Dockerfile.analysis` (clean analysis image), `x-session.sh`, `create-wallet-x.sh`, `run-source.sh`, `147-cookie-writer.py`, `acquire-kwallet2.sh`, `kwl_parse.py`, `147-recover.py`, `147-controls.sh`. Evidence: `research/_raw/147-evidence2/`.
