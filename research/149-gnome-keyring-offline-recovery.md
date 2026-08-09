# 149 — Offline Chrome OSCrypt `v11` recovery from a copied GNOME Keyring

**Ticket:** [Experiment: offline Chrome OSCrypt recovery from a copied GNOME Keyring](https://github.com/ChmaraX/forensix/issues/149)

**Question:** can ForensiX recover a real OSCrypt `v11` key and decrypt known Chrome data using only copied GNOME Keyring/libsecret evidence and an authorized keyring credential?

**Answer: YES for the tested variant.** 5 of 5 known-plaintext rows recovered from a copied store, in a clean analysis container that has no key store of its own, with the copied store unmodified. Untested variants are enumerated in §7 and remain unproven.

**Evidence legend** (as in `research/144-offline-oscrypt-key-recovery.md`): **LOCALLY-DEMONSTRATED** = run end-to-end here against a disposable known-plaintext Source; **SOURCE-CONFIRMED** = cited first-party source; **INFERRED** = consequence, not result; **UNTESTED** = not exercised.

---

## 1. Headline: branded Chrome M151 produced `v11`, where every prior attempt produced `v10`

### LOCALLY-DEMONSTRATED ✅

```
cookie_prefixes.txt   → DISTINCT PREFIXES: ['v11']        (5/5 rows)
chrome_version.txt    → Google Chrome 151.0.7922.108-1 arm64  (branded, Google apt repo)
OSCrypt.FreedesktopSecretKeyProvider.InitStatus → 0       (success)
OSCrypt.SecretPortalKeyProvider.InitStatus      → 1
OSCrypt.EncryptorKeyCount 3 / .Available 2 / .TemporarilyUnavailable 1 / .PermanentlyUnavailable 0
```

This is the first `v11` evidence in the project. [#135](https://github.com/ChmaraX/forensix/issues/135) and [#153](https://github.com/ChmaraX/forensix/issues/153) both obtained only the `v10` `PosixKeyProvider` fallback.

Two differences from #153, which used Chrome for Testing and relied on desktop auto-detection:

1. **Branded Chrome**, installed from Google's own apt repository.
2. **`--password-store=gnome-libsecret` passed explicitly.** The token is accepted by the branded M151 binary.

Which of the two is decisive is **not** separated by this run — see §7.

### Platform note (corrects the experiment brief, not the map)

**Branded Google Chrome ships a Linux arm64 build at M151.** Verified: the Source image installs `google-chrome-stable` from `deb [arch=arm64] http://dl.google.com/linux/chrome/deb/ stable main`, and the installed binary reports `151.0.7922.108`.

This contradicted the brief given to this experiment, which wrongly asserted that no such build exists and instructed the use of Chromium. It does **not** correct the #116 map, which makes no such claim — and [#152](https://github.com/ChmaraX/forensix/issues/152) had already run branded Chrome on a native ARM64 Linux desktop session. The error was local to this experiment's instructions.

### Note on binary-string evidence

`grep` of `/opt/google/chrome/chrome` finds the token `kwallet` but **not** `gnome-libsecret`, `kwallet5` or `kwallet6`, and finds no `libsecret-1.so`. The `gnome-libsecret` token nevertheless works. **String absence is not token absence** — the accepted set must be established by running the binary, never by inspecting it. `libsecret-1.so` absence does appear genuine: Chrome links `libdbus-1.so.3` and speaks `org.freedesktop.secrets` directly.

---

## 2. Source construction (constructed ground truth)

### LOCALLY-DEMONSTRATED ✅

| Property | Value |
|---|---|
| Platform | Ubuntu 24.04.4 LTS, aarch64, container |
| Browser | Google Chrome 151.0.7922.108-1 arm64 (branded) |
| Provider | `gnome-keyring-daemon` 46.1-2ubuntu0.2, `libsecret` 0.21.4-1build3 |
| Provider forced | `--password-store=gnome-libsecret` |
| OS user | dedicated `suspect` |
| Login password | `login-pw-CORRECT` |
| Keyring password | `keyring-pw-DIFFERENT` — **deliberately not equal to the login password** |
| Preflight | `secret-tool store` rc=0, `secret-tool lookup` rc=0 — the store answered before Chrome launched |
| Shutdown | Chrome stopped, then Source stopped. `source_state.txt` → `SOURCE COLD` |

Known plaintext, 5 cookies: ASCII; non-ASCII (`ForensiX-ÁÉÍÓÚ-áéí-řšč-日本語-🔐`); an exact 16-byte block; a 200-character value; a 1-character value.

**Key store as found** — `$XDG_DATA_HOME/keyrings/`:

| File | Size | Magic |
|---|---|---|
| `login.keyring` | 582 B | `GnomeKeyring\n\r\0\n` (legacy format) |
| `user.keystore` | 207 B | `Gnome Keyring Store 2`, AES / SHA256, iterations `0x42a` (1066), 8-byte salt |

`~/.gnome2/keyrings` is **absent** — recorded as `legacy_gnome2.ABSENT.txt`, not silently omitted.

---

## 3. Integrity

### LOCALLY-DEMONSTRATED ✅

| Artifact | Value |
|---|---|
| Manifest | `MANIFEST.sha256`, per-file SHA-256 |
| Evidence Set Digest | `ed878a914bf6da503ca0b691d283e50d14e7d217327be34873a6fac5f7f12894` |
| Working Copy | second generation; `WORKING_COPY_HASHES_MATCH=yes` |
| `login.keyring` | `9c90614bc60dd907f621d6b6c0d40bab6c57b4925c2800ec2a7cae2ea1c9d958` |
| `user.keystore` | `a3031eef14e4185851cc348931d3962cd159bcd691f41d6763fb943b92a3d51a` |

Both hashes were re-verified after export from the container to the host, and again after the full analysis run. **Identical throughout.**

---

## 4. Recovery result

### LOCALLY-DEMONSTRATED ✅ — route A (replay)

A private `gnome-keyring-daemon` was started in a **separate clean analysis container**, with `XDG_DATA_HOME` pointed by explicit path at the Working Copy, and unlocked with the authorized keyring credential.

```
secret_len            = 24         (Base64 of 16 random bytes — matches #144's construction)
derived_key_sha256    = aeaf9992085ebc33…
status                = ok
matched               = 5   /   mismatched = 0
```

Derivation confirmed exactly as #144 states: `PBKDF2-HMAC-SHA1(secret_text, "saltysalt", iterations=1, dklen=16)`, AES-128-CBC, IV = 16 spaces, ciphertext = `row[3:]`.

**Two parser-relevant observations, both new:**

1. **Every decrypted value carries a 32-byte prefix before the plaintext.** All 5 rows decoded only under the `domain-prefixed` interpretation. A `v11` parser that returns `plaintext[0:]` returns 32 bytes of hash, not the cookie value.
2. **Non-ASCII values are stored percent-encoded.** `fx_nonascii` decrypts to `ForensiX-%C3%81…%F0%9F%94%90` and requires percent-decoding to recover `ForensiX-ÁÉÍÓÚ-áéí-řšč-日本語-🔐`. Recorded as `match_form: percent-decoded`, distinct from `stored-verbatim`.

### Write trace

Store hashes before and after the complete analysis, including every control: **identical**. No new files appeared in the copied store directory. The replayed provider read; it never created or modified an item.

### Isolation

The analysis container has no `~/.local/share/keyrings` and no `~/.gnome2/keyrings`. `/run/user` does not exist and `DBUS_SESSION_BUS_ADDRESS` is unset before the private bus starts. Every `*.keyring` file visible inside it belongs to the case copy or to a control copy. It is a different container from the Source and shares no D-Bus socket. No live Source key store and no analyst key store was queried.

---

## 5. Negative controls

### LOCALLY-DEMONSTRATED ✅

| # | Control | Result | Typed reason |
|---|---|---|---|
| C1 | correct keyring password | `ok`, matched 5 | — |
| C2 | incorrect keyring password | `unavailable` | `linux-keyring-credential-unavailable` |
| C3 | login password used as keyring password | `unavailable` | `linux-keyring-credential-unavailable` |
| C4 | wrong application selector (`chromium`) | `unavailable` | `linux-keyring-item-absent` |
| C5 | store absent entirely | `unavailable` | `linux-keyring-store-absent` |
| C6 | mutated `login.keyring` (1 byte flipped) | `unavailable` | `linux-keyring-credential-unavailable` |
| C7 | wrong derived key, correct format | `failed`, matched 0 / mismatched 5 | per-row `unavailable` |
| C8 | mutated ciphertext, correct key | `partial` | `cbc-padding-invalid` |
| C9 | store at legacy `~/.gnome2/keyrings` layout | `ok`, matched 5 | — |
| C10b | two matching items planted in a copy | `unavailable` | `linux-keyring-item-ambiguous:2-matching-items` |

**C3 is the load-bearing one.** The keyring password was set different from the login password by construction, so the login password cannot succeed by accident. #144's caution — that the login password is only a *Candidate* for the keyring password — holds.

**C10b:** ambiguity is never silently resolved. Two items matching one selector yields a typed failure, not a guess at the first.

**C6 is a limitation, not a clean pass.** A mutated store is **indistinguishable** from a wrong credential: both return `linux-keyring-credential-unavailable`. The provider decrypts the store with the password and reports only that it failed. ForensiX cannot report `store-damaged` separately on this route. A direct parser could, by validating structure before decryption.

---

## 6. Findings vs Candidates

CBC provides no authentication. A successful decryption proves correct padding only.

- A `v11` value that decrypts **and matches recorded known plaintext** is a **Finding**, with provenance: manifest file id → `Cookies` → `cookies` → rowid.
- A `v11` value that merely decrypts with valid padding in real casework, where no known plaintext exists, is a **Candidate**. The 32-byte prefix (§4) is a useful structural check but is a heuristic discriminator, so it does not promote a Candidate to a Finding.

---

## 7. What was NOT tested

Each is recorded as `unavailable(reason)`, not as a pass.

| Variant | Status | Reason |
|---|---|---|
| Route B — direct `.keyring` file parser, no daemon | **UNTESTED** | `direct-parser-unavailable` — the parser was not written. Route A alone answers the ticket, but route B would be stronger: it never runs the provider, and it could distinguish C6's damaged store from a wrong credential. |
| Chromium (as opposed to branded Chrome) | **UNTESTED** | selector `Chromium Safe Storage` not exercised |
| Legacy direct GNOME Keyring API (not libsecret) | **UNTESTED** | #144 treats this as a distinct acquisition variant |
| Branded-vs-CfT as the decisive variable | **UNTESTED** | this run changed **two** variables at once (branded build *and* explicit `--password-store`). A CfT run with the explicit flag would separate them. |
| Other distros, keyring versions, PAM couplings | **UNTESTED** | one distro, one version pair |
| Locked-collection-with-correct-password | **UNTESTED** | C2/C3 cover wrong credential only |
| Missing provider config files | **UNTESTED** | not exercised |

---

## 8. Consequences for other tickets

- **[#153](https://github.com/ChmaraX/forensix/issues/153)** — its hypothesis 1 ("Chrome for Testing may lack the secret-service path") now has supporting evidence: branded Chrome reaches `FreedesktopSecretKeyProvider` on effectively the same rig. Not conclusive, because this run also added the explicit flag. #153 is **not** closed by this ticket.
- **[#144](https://github.com/ChmaraX/forensix/issues/144)** — the GNOME Keyring row moves from `experimental` / INFERRED-UNTESTED to **LOCALLY-DEMONSTRATED for the libsecret/Secret-Service variant on this platform pair**. The KWallet and macOS rows are untouched.
- **[#127](https://github.com/ChmaraX/forensix/issues/127)** — the 32-byte plaintext prefix and percent-encoding of non-ASCII values are fixture-relevant and belong in the parser specification.
- **[#116](https://github.com/ChmaraX/forensix/issues/116)** — no correction. An earlier draft of this write-up claimed the map assumed branded Chrome has no Linux arm64 build. It does not, and #152 had already used one. That claim was withdrawn.

## 9. Reproduction

`research/_raw/149-source.Dockerfile`, `149-make-source.sh`, `149-cookie-writer.py`, `149-acquire.sh`, `149-prefix-probe.py`, `149-recover.py`, `149-controls.sh`. Evidence set: `research/_raw/149-evidence/` (large Chrome stderr logs omitted).
