# 147 — Offline Chrome OSCrypt `v11` recovery from a copied KWallet

**Ticket:** [Experiment: offline Chrome OSCrypt recovery from a copied KWallet](https://github.com/ChmaraX/forensix/issues/147)

**Question:** can ForensiX recover a real OSCrypt `v11` key and decrypt known Chrome data using only copied KWallet evidence and an authorized wallet credential?

**Answer: NOT ESTABLISHED — the experiment is blocked upstream of the recovery step, and the ticket stays open.** Branded Chrome M151 could not be made to write a single KWallet-backed `v11` row on either tested KWallet major version, so no KWallet-encrypted Source exists to recover from. The blocker is precisely located, reproducible on two distros, and stated below as a boundary rather than a capability claim.

This is a **negative result about the acquisition rig, not about ForensiX's recovery capability.** It does not show that copied-KWallet recovery is impossible. It shows that the constructed-ground-truth Source #147 requires could not be produced by the route attempted, and names what would be needed to produce it.

**Evidence legend** (as in `research/144-offline-oscrypt-key-recovery.md`): **LOCALLY-DEMONSTRATED** = run end-to-end here; **SOURCE-CONFIRMED** = cited first-party source; **INFERRED** = consequence, not result; **UNTESTED** = not exercised.

---

## 1. Headline: Chrome reaches KWallet, then falls back to `v10` because no wallet exists to open

### LOCALLY-DEMONSTRATED ✅

```
OSCrypt.FreedesktopSecretKeyProvider.InitStatus              → 12
OSCrypt.FreedesktopSecretKeyProvider.KWalletNoService.ErrorDetail → 0
OSCrypt.EncryptorKeyCount 3 / .Available 1 / .PermanentlyUnavailable 1
cookie prefixes                                              → ['v10']  (5/5 rows)
```

And, from the KWallet daemon's own log at the same moment:

```
kf.wallet.kwalletd: Application "Google Chrome" using kwallet without parent window!
```

Those two facts together are the finding. Chrome **does** reach the KWallet integration — kwalletd logs the incoming client by name. But the wallet does not yet exist, so kwalletd raises its *wallet-creation wizard*, a GUI dialog. Chrome does not wait on a dialog: it records `KWalletNoService`, falls through to `PosixKeyProvider`, and writes `v10` rows with the hardcoded `peanuts` key.

The `v10` outcome is therefore **not** evidence that the KWallet provider is unreachable. It is evidence that *provider initialisation cannot complete without a pre-existing, unlocked wallet*, and that creating that wallet is the actual blocker.

### Reproduced on both KWallet major versions

| Distro | KWallet | Chrome | Result |
|---|---|---|---|
| Ubuntu 24.04.4 LTS arm64 | `kwalletd5` 5.115.0-0ubuntu3 | 151.0.7922.108-1 arm64 | `KWalletNoService`, `v10` |
| Debian 13 trixie arm64 | `kwallet6` 6.13.0-1 | 151.0.7922.108-1 arm64 | `KWalletNoService`, `v10` |

Neither is a one-off. The same histogram set and the same `['v10']` prefix appear on both.

---

## 2. Accepted `--password-store` tokens, established by running the binary

### LOCALLY-DEMONSTRATED ✅

Method per the #149 lesson: pass a deliberately bogus value and read the rejection.

```
--password-store=NONSENSE-TOKEN-XYZ
  → components/os_crypt/async/browser/freedesktop_secret_key_provider.cc:292]
    Unknown password store: NONSENSE-TOKEN-XYZ
```

Testing each candidate against that error:

| Token | Accepted by M151? |
|---|---|
| `kwallet` | yes |
| `kwallet5` | yes |
| `kwallet6` | yes |
| `gnome-libsecret` | yes |
| `basic` | yes |
| **`detect`** | **REJECTED — "Unknown password store"** |

The `detect` result is worth recording but is **not** a correction to #144. #144 says M151 recognises "`gnome-libsecret`, `kwallet`, `kwallet5`, `kwallet6` **and desktop auto-selection**" — it never claims `detect` is an accepted flag value. This run confirms the distinction empirically: auto-selection is the behaviour when the flag is *absent*, and `detect` is not a value the flag accepts.

Note also that KWallet handling now lives inside **`FreedesktopSecretKeyProvider`**, not a separate `KWalletKeyProvider` class — the rejection, the `KWalletNoService` sub-histogram and the token validation all come from that one file. #144's provider-stack description should be re-checked against M151 on that point.

Binary-string evidence again proved misleading, exactly as #149 warned: `grep` of `/opt/google/chrome/chrome` finds the token `kwallet` (×6) but **not** `kwallet5` or `kwallet6`, yet all three are accepted. It does contain all three D-Bus names — `org.kde.kwalletd`, `org.kde.kwalletd5`, `org.kde.kwalletd6`.

---

## 3. Why no wallet could be created headlessly

### LOCALLY-DEMONSTRATED ✅

The first #147 attempt stalled here (exit 124 on `org.kde.KWallet.open`). The cause is now precisely identified, and it is deeper than "a dialog appears".

`pam_kwallet5` exists exactly for headless session unlock, so it was the obvious route. Reconstructing its protocol from the shipped binaries and then from KDE's `kwallet-pam/pam_kwallet.c`:

1. **`--pam-login` is gated behind an environment variable.** Without `PAM_KWALLET5_LOGIN` set, kwalletd never registers the option and Qt rejects it: `kwalletd5: Unknown option 'pam-login'`. This is true of **both** `kwalletd5` 5.115.0 and `kwalletd6` 6.13.0 — the string is present in both binaries, but the option is unavailable unless the variable is set. A pure string check would have concluded the opposite.
2. **It takes two file descriptors:** `kwalletd --pam-login <pipe_fd> <envsocket_fd>`. Omitting them yields `Invalid arguments (less than needed)`. From `pam_kwallet.c`: `args[] = { kwalletd, "--pam-login", pipeInt, sockIn, NULL }` — `pipeInt` is the **read end of a pipe** carrying the key, `sockIn` is a **listening UNIX socket** kwalletd `accept()`s for the session environment.
3. **What travels the pipe is not the password.** It is a 56-byte derived key. Sending the raw password yields `Hash or environment not received`. The derivation, SOURCE-CONFIRMED from `pam_kwallet.c`:

   ```
   KWALLET_PAM_KEYSIZE    56
   KWALLET_PAM_SALTSIZE   56
   KWALLET_PAM_ITERATIONS 50000
   gcry_kdf_derive(passphrase, GCRY_KDF_PBKDF2, GCRY_MD_SHA512,
                   salt, 56, 50000, 56, key)
   ```
   The salt is the raw contents of `$XDG_DATA_HOME/kwalletd/<wallet>.salt`, 56 random bytes created on first use. The key is written with **no length prefix**.

Implementing all three (`research/_raw/147/kwallet-pam-start.sh`) got as far as `key_sent=True env_sent=True`, kwalletd alive, and **the salt file correctly created** — but kwalletd still reported `Couldn't accept incoming connection` / `Hash or environment not received`, and **no `.kwl` was ever produced**. The remaining gap is the exact framing/ordering of the environment block on the accept socket, which pam_kwallet writes from inside a real PAM session.

Being unable to complete this by hand is a limitation of this run, **not** proof that it cannot be done.

### GPG-backed wallet (route c)

Prepared and **not** completed: a dedicated GPG key was generated unattended with loopback pinentry (`research/_raw/147/make-gpg-wallet.sh`), and `kwalletd` is confirmed linked against `libgpgmepp`/`libgpgme`/`libassuan`, so the variant is genuinely supported by the build. But a GPG wallet must still be *created* first, and creation runs through the same wizard that blocks. Recorded as `unavailable(reason): kwallet-wallet-creation-requires-gui-dialog`.

---

## 4. What this means for the ticket's question

The ticket asks whether a **copied wallet** can be opened offline and its Chrome secret recovered. That question is **untouched by this run**, because no wallet was ever created and therefore none could be copied.

What is now known, and was not before:

- Chrome M151 accepts all three KWallet tokens and does contact kwalletd (**LOCALLY-DEMONSTRATED**).
- With no pre-existing wallet, provider init fails to `v10` rather than blocking (**LOCALLY-DEMONSTRATED**).
- The headless creation path is `pam_kwallet`'s, and its protocol is now documented to the byte, including the exact KDF (**SOURCE-CONFIRMED**), with a working partial implementation.
- The `.kwl` container format, its cipher/hash variants, and the `Chrome Keys` / `Chrome Safe Storage` selector inside a wallet remain **UNTESTED**.

---

## 5. Controls

The ticket's control list is written for a run that reaches recovery. Since recovery was never reached, **no control in that list was exercised**, and none may be reported as passing. Recording them honestly:

| Control | State | Typed reason |
|---|---|---|
| correct / incorrect wallet password | **not run** | `unavailable(reason): no-wallet-created` |
| correct / incorrect wallet selection | **not run** | `unavailable(reason): no-wallet-created` |
| missing / multiple wallet files | **not run** | `unavailable(reason): no-wallet-created` |
| folder + key selector mismatch | **not run** | `unavailable(reason): no-wallet-created` |
| GPG key absent / wrong / locked agent / wrong passphrase | **not run** | `unavailable(reason): no-wallet-created` |
| unsupported cipher/hash, migration states | **not run** | `unavailable(reason): no-wallet-created` |
| mutated wallet / ciphertext | **not run** | `unavailable(reason): no-wallet-created` |
| no live/analyst wallet queried | **n/a** | no wallet was opened at all, by any party |

There is no Manifest, no Working Copy and no Evidence Set Digest for this ticket, because there is no Source. Producing those against an empty wallet directory would be theatre.

---

## 6. Findings vs Candidates

No Chrome value was decrypted, so this ticket yields **no Finding and no Candidate** about wallet contents.

The `v10`/`KWalletNoService` observations are Findings *about Chrome's behaviour under these conditions*, with provenance in the histogram output and the kwalletd log — not about any suspect artifact.

---

## 7. What was NOT tested

| Variant | Status | Reason |
|---|---|---|
| KWallet4 direct integration | **UNTESTED** | `unavailable(reason): variant-unobtainable-on-current-arm64-distro` — owner-approved scope cut; absent from both Ubuntu 24.04 and Debian trixie |
| Password-protected `.kwl` recovery | **UNTESTED** | `unavailable(reason): no-wallet-created` |
| GPG-backed wallet recovery | **UNTESTED** | `unavailable(reason): kwallet-wallet-creation-requires-gui-dialog` |
| KWallet5 `.kwl` on a real KDE desktop | **UNTESTED** | no Plasma session available in a container |
| Secret-Service migration / proxy behaviour | **UNTESTED** | requires a working wallet first |
| `Chrome Keys` / `Chrome Safe Storage` selector | **UNTESTED** | never written, because no wallet existed |
| 32-byte plaintext prefix (#149 finding) | **UNTESTED for KWallet** | no `v11` row obtained |
| percent-encoding of non-ASCII (#149 finding) | **UNTESTED for KWallet** | no `v11` row obtained |

Per the ticket's own instruction, **nothing here is generalised from one wallet variant to another.**

---

## 8. What would unblock this

In increasing cost:

1. **Finish the `pam_kwallet` environment-block framing.** Everything else is solved; the salt file is created, the KDF is confirmed, the key is accepted. This is the cheapest route by far.
2. **Pre-create the wallet with KDE's own backend library** (`libkwalletbackend5`/`6`) instead of the daemon, then let kwalletd adopt the existing `.kwl`. Avoids the wizard entirely.
3. **A real Plasma desktop session** — a VM or a native KDE install, where the creation wizard can simply be answered. This is what #116 reserves Cua VMs for.

Route 1 or 2 should be tried before any VM spend.

## 9. Consequences for other tickets

- **[#144](https://github.com/ChmaraX/forensix/issues/144)** — one correction and one confirmation. **Correction:** KWallet is handled inside `FreedesktopSecretKeyProvider` on M151, not a distinct `KWalletKeyProvider` — token validation, the `KWalletNoService` sub-histogram and the rejection message all come from `freedesktop_secret_key_provider.cc`. **Confirmation:** its accepted-token list (`gnome-libsecret`, `kwallet`, `kwallet5`, `kwallet6`, plus auto-selection when the flag is absent) is exactly right, now empirically rather than from source. The KWallet rows in its matrix stay `experimental` / INFERRED-UNTESTED; nothing here promotes them.
- **[#149](https://github.com/ChmaraX/forensix/issues/149)** — its two parser findings could not be checked against KWallet and remain GNOME-only.
- **[#127](https://github.com/ChmaraX/forensix/issues/127)** — a KWallet fixture cannot currently be recorded by this harness. The `pam_kwallet` KDF above is the missing piece.

## 10. Reproduction

`research/_raw/147/`: `Dockerfile.gate` (Ubuntu/KWallet5), `Dockerfile.kw6` (Debian/KWallet6), `gate-kwallet-reachability.sh`, `gate-nobus-control.sh`, `gate-kw6-confirm.sh`, `kwallet-pam-start.sh`, `kw6-session.sh`, `make-gpg-wallet.sh`. Evidence: `research/_raw/147-evidence/`.
