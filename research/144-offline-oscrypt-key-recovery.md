# Research: offline OSCrypt key recovery from real evidence (ChmaraX/forensix#144)

> **Issue:** [#144](https://github.com/ChmaraX/forensix/issues/144)  
> **Research/access date:** 2026-08-08 UTC  
> **Repository state:** written at local commit `99c64dbfe00db25bc01bea8999e7fba9a7ccccf6`.  
> **Pinned browser sources:** Chromium M113 tag `113.0.5672.0` / `0aa944b38c653da13d97a6e90f313c36be6c8422`; M127 tag `127.0.6533.0` / `4e87798573995adec11a5688a5544d7a14e60aa4`; M130 tag `130.0.6723.0` / `ed44bc873f9ef776a2ef1ccb90252a6de5666cd6`; M133 tag `133.0.6943.0` / `0155b8edb17ab54ddbc7f4b79a160632275fbbd5`; and M151 Stable revision `28a7a6c409e03c701d3474ef9e3b1f0be6249039` (Stable `151.0.7922.109` in the first-party feed) [S1–S6].
>
> **Evidence legend:** **SOURCE-CONFIRMED** = stated or implemented by a cited first-party source; **UPSTREAM-TESTED** = behavior asserted only by an upstream test/fixture; **LOCALLY-DEMONSTRATED** = a disposable known-plaintext Source + Manifest + Working Copy experiment actually run for this brief; **INFERRED** = a consequence or proposed composition of cited sources, not an end-to-end result; **UNKNOWN/UNSUPPORTED** = public primary evidence, a supported variant, or a genuine reproduction is absent. **VERSION-SPECIFIC** restricts any of those labels to the named revision. No label implies that ForensiX currently implements the path.

## Executive answer

**No, not as one general capability.** `PROFILE_DIR` or `USER_DATA_DIR` alone does not recover a real macOS Safe Storage secret, a Linux Secret Service/GNOME Keyring/KWallet secret, or a Windows user-DPAPI key. The provider store and its unlocking material live outside the browser profile. The only profile-only exception is Linux `--password-store=basic`, whose `v10` key is compiled and deterministic; it is not recovery of a secret from evidence [S7–S13].

A narrower capability is technically defensible:

* **macOS — SOURCE-CONFIRMED construction; offline recovery INFERRED/UNTESTED.** Chrome stores a random generic-password item named `Chrome Safe Storage`/account `Chrome` (Chromium branding uses `Chromium Safe Storage`/`Chromium`), then derives the 16-byte `v10` AES-CBC key with PBKDF2-HMAC-SHA1, salt `saltysalt`, 1003 iterations. Apple's first-party `security` tool accepts an explicit keychain path, can unlock it with `-p`, and can find a generic password by service/account [S7, S14]. A copied login keychain plus its independent keychain password therefore provides a plausible Working-Copy-only chain, but no copied real keychain was exercised here and current ACL/keychain-format edge cases remain unproved.
* **Linux Secret Service / GNOME Keyring — SOURCE-CONFIRMED construction; offline recovery INFERRED/UNTESTED.** Chrome stores a random 16-byte value encoded as Base64 under application `chrome`/`chromium`; that stored text is PBKDF2-HMAC-SHA1-derived with one iteration and `saltysalt` into the 16-byte `v11` AES-CBC key. Secret Service specifies an unlock-and-GetSecrets interface but intentionally does not define provider persistence. With GNOME Keyring, the first-party daemon source selects `$XDG_DATA_HOME/keyrings` (or legacy `~/.gnome2/keyrings`) and reads `*.keyring`; its login integration uses the supplied login master password [S8, S15–S18]. Preserve the backend, not merely the D-Bus interface.
* **Linux KWallet — SOURCE-CONFIRMED construction; offline recovery INFERRED/UNTESTED.** Chrome's direct KWallet variants read `Chrome Keys/Chrome Safe Storage` (Chromium equivalents) from the selected network wallet and derive the same `v11` key. KDE's backend stores `*.kwl` below the Qt generic-data location `kwalletd`, and can open by wallet password or, for a GPG wallet, by GPG key [S8, S19–S20]. The wallet file plus the correct wallet credential (or GPG private-key environment and passphrase) is required.
* **Linux basic — SOURCE-CONFIRMED and profile-only, but not real-secret recovery.** `v10` uses the fixed PBKDF2 result for `peanuts`/`saltysalt`, one iteration [S9].
* **legacy Windows `v10` — SOURCE-CONFIRMED construction; file-only DPAPI recovery UNKNOWN/UNTESTED.** `User Data/Local State` contains Base64(`DPAPI` + a current-user DPAPI blob) whose plaintext is a random 32-byte AES-256-GCM row key. Chromium passes no optional entropy and does not request `CRYPTPROTECT_LOCAL_MACHINE` [S10–S11]. Microsoft documents same-logon-credential and usually same-computer requirements, integrity checking, and domain backup-key recovery, but the requested public “MS-DPAPI” local master-key/offline-file specification could not be located or fetched. Consequently, the exact minimal on-disk recipe and a ForensiX offline unwrap are not source-established here [S21–S24]. Preserve the full user DPAPI material and system context now; do not promise recovery.

**Decision:** ForensiX v2 may declare deterministic Linux-basic derivation and may accept an explicitly supplied, case-authorized provider secret or raw row key. It should declare copied-provider-store key recovery **experimental/unsupported until constructed-ground-truth tickets pass**, and legacy Windows offline DPAPI unwrap **unsupported** today. Current Windows App-Bound `v20` remains owned by #141 and is not weakened by this conclusion.

## Scope and version boundaries

This brief covers Chrome/Chromium OSCrypt rows and providers at the five exact pinned revisions above. It does **not** assert all intervening vendor patch builds are byte-identical. The pinned M113, M127, M130 and M133 sync backends contain the same macOS `v10`, Linux `v10`/`v11`, and Windows Local-State/DPAPI constructions; M151 contains their async successors [S2–S11]. An acquired executable/version and per-row prefix must select the variant; milestone guessing is not acceptable.

| Variant | Exact source coverage | Boundary/result |
|---|---|---|
| macOS Safe Storage `v10` | Tags `113.0.5672.0`, `127.0.6533.0`, `130.0.6723.0`, `133.0.6943.0`; M151 `28a7…` | Same service/account split, 1003-iteration PBKDF2 and AES-128-CBC at the inspected revisions [S2–S7]. `--use-mock-keychain` is test/portable behavior and is excluded from the recovery claim.
| Linux basic `v10` | Same pinned tags; M151 `28a7…` | Fixed key; no provider evidence needed [S2–S6, S9]. It can occur in real evidence when explicitly selected, but demonstrates no provider-store recovery.
| Linux GNOME Keyring/libsecret/Secret Service `v11` | Direct GNOME Keyring, libsecret and KWallet source pinned at M113; sync `os_crypt_linux.cc` pinned through M133; async M151 | M113 recognizes `GNOME_KEYRING`, `GNOME_LIBSECRET`, KWallet/KWallet5 and basic; current M151 recognizes `gnome-libsecret`, `kwallet`, `kwallet5`, `kwallet6` and desktop auto-selection [S8, S12–S13]. Treat legacy direct GNOME API and Secret-Service-backed GNOME as distinct acquisition variants even though both may use GNOME Keyring files.
| Linux Secret Portal `v12` | M151 only | Detected boundary, **out of issue scope**. It retrieves an application-specific portal secret and derives AES-256-GCM with HKDF-SHA256; do not send `v12` to a `v11` parser [S25].
| Windows non-App-Bound `v10` | Same five pinned revisions | Base64 `DPAPI` wrapper → 32-byte AES-256-GCM key [S10–S11]. This brief excludes older per-row raw-DPAPI/no-prefix formats because no pinned old revision was researched.
| Windows App-Bound `v20` | Excluded | #141 owns it. Mixed `v10`/`v20` databases must still dispatch per row; a `v10` row does not become App-Bound because another row is `v20` [S11, S26].

M151's public encryptor defines AES-128-CBC with a fixed 16-space IV for macOS/Linux and AES-256-GCM with a 12-byte nonce and empty associated data for Windows; CBC decryption provides padding success but no cryptographic authentication, whereas GCM opening authenticates the row [S26].

## Per-platform/provider support matrix

“Offline” below means no query to a live suspect key store and no execution of the evidentiary browser/profile; only immutable Source artifacts copied into a case Working Copy may be consumed.

| Platform/provider | `PROFILE_DIR` sufficient? | `USER_DATA_DIR` sufficient? | Extra preserved Source | Unlock input | Working-Copy-only feasibility | Proposed v2 status |
|---|---:|---:|---|---|---|---|
| macOS Chrome/Chromium Safe Storage | No | No | Entire user `~/Library/Keychains/`; keychain search-list/preferences; conservatively `/Library/Keychains/`; exact browser binary/version | Keychain password (not assumed equal to current login password), or separately supplied Safe Storage secret | **INFERRED/UNTESTED:** Apple's CLI can target a named copied keychain, unlock it, and search generic passwords [S14] | `experimental-provider-recovery`; supplied secret is supportable
| Linux basic | **Yes**, for the encrypted DB/sidecars | Yes | Browser/version evidence to establish basic selection; no key-store file | None | **SOURCE-CONFIRMED** deterministic derivation [S9] | `supported-deterministic-basic`, clearly not secret recovery
| Secret Service interface, backend unknown | No | No | Entire `$XDG_DATA_HOME`, `$XDG_CONFIG_HOME`, legacy key-store locations, provider packages/config/version, D-Bus/provider identity | Backend-specific credential | **UNKNOWN/UNSUPPORTED** until backend is identified; Secret Service defines methods, not storage [S15] | metadata only
| GNOME Keyring via libsecret/Secret Service | No | No | `$XDG_DATA_HOME/keyrings/*.keyring`; legacy `~/.gnome2/keyrings`; all files/links in both directories; desktop/PAM/provider config | Keyring master password; login password is only a candidate where acquisition proves login-keyring coupling | **INFERRED/UNTESTED:** first-party source exposes directory and file format, but no isolated copied-store test was run [S16–S18] | experimental
| legacy direct GNOME Keyring API | No | No | Same GNOME store plus exact legacy libraries/provider configuration | Keyring master password | **INFERRED/UNTESTED** [S12, S16–S18] | experimental, legacy variant
| KWallet/KWallet5/KWallet6 direct | No | No | `$XDG_DATA_HOME/kwalletd/*.kwl`, configuration selecting network wallet; legacy KDE data/config locations; all wallet files | Wallet password; or GPG secret keys, agent configuration and passphrase for GPG wallet | **INFERRED/UNTESTED:** KDE backend supports path-based read-only opening, password and GPG-key overloads; no evidence experiment was run [S19–S20] | experimental
| Windows user-DPAPI `v10` | No (missing `Local State`) | No | `Local State`; whole affected user profile including DPAPI Protect/CREDHIST candidates; user SID/account/domain context; full registry hives and Windows volume conservatively | Correct user credential/history-derived material, or authorized domain DPAPI backup key; alternatively supplied unwrapped 32-byte key | **UNKNOWN/UNSUPPORTED** for file-only unwrap. Native `CryptUnprotectData` in the original logon/computer context is source-supported but is not this offline model [S10–S11, S21–S24] | unsupported recovery; supplied key supportable

A full `FILESYSTEM_ROOT`, `IMAGE_CONTAINER`, or `ACQUISITION_BUNDLE` can contain these prerequisites; its label does not prove they are present. Input validation must enumerate actual paths, hashes and credentials rather than infer completeness from source kind.

## Detailed key and recovery chains

### macOS Safe Storage

```text
copied user keychain
  generic-password(service="Chrome Safe Storage", account="Chrome")
  or Chromium equivalents
       │ unlock/search with keychain password
       ▼
Safe Storage password (Chrome creates Base64(random 16 bytes))
       │ PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16 bytes)
       ▼
AES-128-CBC key
       │ row = "v10" || AES-CBC(fixed 16-space IV, padded plaintext)
       ▼
Working-Copy Cookie/Login plaintext candidate
```

**SOURCE-CONFIRMED:** Chrome first searches the named generic password; if absent, it creates a Base64-encoded random 16-byte password. M151 derives 16 bytes using PBKDF2-HMAC-SHA1/1003 and tags the AES-CBC key `v10` [S7]. Apple's `security unlock-keychain -p password keychain` and `find-generic-password -a account -s service [-w] keychain...` expose a first-party path to an explicitly named keychain [S14].

**INFERRED/UNTESTED:** perform that operation only on a copied keychain in an isolated macOS analysis account, never on the original mounted keychain. Whether every acquired macOS generation's ACL, login-keychain database version, Secure Enclave/iCloud state, or damaged companion state permits this is not established. No source found makes `~/Library/Keychains/login.keychain-db` alone a universal minimum, so acquisition must preserve the whole directory rather than cherry-pick that familiar filename.

The operating-system login password and keychain password can diverge; ForensiX must request a `macos-keychain-password` secret identifier, not silently relabel a supplied account password. A directly supplied Safe Storage item value bypasses keychain recovery but must retain its own acquisition provenance.

### Linux Secret Service and GNOME Keyring

```text
copied provider persistence (GNOME example: $XDG_DATA_HOME/keyrings/*.keyring)
       │ unlock collection with keyring master credential
       ▼
Secret Service default collection
       │ SearchItems application="chrome" (or "chromium")
       │ GetSecrets(first matching item)
       ▼
stored random text = Base64(random 16 bytes)
       │ PBKDF2-HMAC-SHA1(text, "saltysalt", 1, 16 bytes)
       ▼
AES-128-CBC key tagged "v11"
       ▼
Working-Copy row plaintext candidate
```

The Secret Service specification defines collections/items, locked state, `Unlock`, sessions and `GetSecrets`; it does not standardize a disk directory or encryption format [S15]. Chrome M151 searches the default collection for application `chrome`/`chromium`, creates a random Base64 secret if missing, and derives the `v11` key using PBKDF2-HMAC-SHA1 with one iteration and `saltysalt` [S8]. M113 libsecret uses schema `chrome_libsecret_os_crypt_password_v2`, attribute `application`, `SECRET_SEARCH_UNLOCK | SECRET_SEARCH_LOAD_SECRETS`, and the same random-password behavior; the legacy GNOME API searches the generic-secret schema by the same application attribute [S12–S13].

For GNOME's implementation, source chooses `$XDG_DATA_HOME/keyrings`, falls back to `~/.gnome2/keyrings` only when the new directory does not exist and the old one does, tracks `*.keyring`, and documents the `GnomeKeyring` header, salt and iteration-bearing format [S16–S17]. The login daemon accepts a supplied `master` to unlock/create the `login` collection, which supports treating the user login password as a candidate—but does not prove every keyring uses that password [S18].

**Safety constraint:** replaying Chrome against an evidence copy is prohibited. Its “item absent” branch creates and stores a new secret [S8, S12–S13], which can replace an unavailable condition with misleading new state. An offline extractor must search read-only and must never invoke provider creation paths.

### Linux KWallet

```text
copied selected network-wallet .kwl (+ config establishing wallet name)
       │ wallet password, OR GPG private key + passphrase for GPG wallet
       ▼
folder "Chrome Keys" / key "Chrome Safe Storage"
(or Chromium equivalents)
       ▼
stored random Base64 text
       │ PBKDF2-HMAC-SHA1(text, "saltysalt", 1, 16 bytes)
       ▼
AES-128-CBC "v11" key → Working-Copy rows
```

M151 directly supports D-Bus services `org.kde.kwalletd`, `kwalletd5`, and `kwalletd6`; it asks for the network wallet and reads the branded folder/key pair. M113 has the same conceptual KWallet chain for KDE4/5 [S8, S13]. KDE's pinned backend forms `<GenericDataLocation>/kwalletd/<encoded-name>.kwl`, checks `KWALLET` magic, opens the file read-only, and offers `open(password)` and `open(GpgME::Key)` [S19–S20]. Preserve wallet-selection configuration because the filename cannot safely be guessed from the browser profile.

**Variant caveat:** current KDE's own README says `kwalletd` may proxy to a Secret Service provider and `ksecretd` provides that API [S20]. In such a deployment, finding no `.kwl` is not proof of basic mode or no secret; return provider-unidentified unless acquisition establishes the actual persistence backend.

### Linux basic

```text
"peanuts" + "saltysalt" + PBKDF2-HMAC-SHA1(iterations=1, dkLen=16)
       ▼
fd621fe5a2b402539dfa147ca9272778
       ▼
"v10" AES-128-CBC rows
```

This is **SOURCE-CONFIRMED** at M151 and matches the inspected sync revisions [S9]. It requires only the database/sidecars and exact variant identification. It is allowed as a real-evidence classification but must be reported as `deterministic-basic`, never “key recovered from keyring.”

### Windows legacy user DPAPI (`v10`, not App-Bound)

```text
User Data/Local State
 os_crypt.encrypted_key = Base64("DPAPI" || dpapi_blob)
       │ current-user CryptUnprotectData, optional entropy = NULL
       ▼
32 random bytes
       │ AES-256-GCM key
       ▼
row = "v10" || nonce[12] || ciphertext || tag
       ▼
authenticated Working-Copy plaintext
```

Chromium creates 32 random bytes, calls `CryptProtectData` with no optional entropy and `CRYPTPROTECT_AUDIT` (not `CRYPTPROTECT_LOCAL_MACHINE`), prepends `DPAPI`, and stores Base64 in `Local State`; the provider checks the prefix, unwraps with `CryptUnprotectData`, requires exactly 32 bytes and assigns tag `v10` [S10–S11]. Microsoft says the same logon credential normally decrypts, encryption/decryption usually must occur on the same computer, and machine scope would have required `CRYPTPROTECT_LOCAL_MACHINE` [S21]. A domain DPAPI backup key can decrypt any domain user's DPAPI data even after password change, but does not make absent Chrome `Local State` or row data reappear [S23–S24].

**UNKNOWN/UNSUPPORTED:** an official, current Microsoft “MS-DPAPI” document specifying local Protect master-key files and a complete offline password/history derivation was not found at a working Learn/Open Specifications URL on 2026-08-08. Guessed legacy Blob Storage URLs returned HTTP 409/404. The Win32 API documentation describes supported runtime semantics, not a forensic parser [S21–S24]. Thus `%APPDATA%\Microsoft\Protect\<SID>`, `CREDHIST`, `SYSTEM`/`SECURITY`/`SAM`, and registry/profile paths below are a conservative **INFERRED acquisition set**, not an asserted minimal Microsoft recipe. A user password alone must not be advertised as sufficient.

## Required Source/acquisition contents

Always acquire the database plus present SQLite `-wal`, `-shm` and rollback-journal companions atomically, hash before parsing, and work from a derived copy. SQLite's first-party WAL documentation warns that separating a WAL from its database can lose committed transactions or corrupt the database [S27].

| Source class | Preserve | Requirement/provenance |
|---|---|---|
| All | Source/container identity; acquisition tool/version/operator/time; original path; filesystem metadata; SHA-256; exact Chrome/Chromium executable and version; DB and sidecars | Required to choose a pinned variant and prove the Working Copy. Source version is not inferable from ciphertext prefix alone [S2–S11, S26].
| macOS | Whole affected user's `Library/Keychains` tree, symlinks and metadata; keychain preference/search-list evidence; conservatively `/Library/Keychains`; account UID/home mapping | Required/precautionary. Apple supports explicit keychain operands but no first-party source found here defines one universally sufficient copied filename [S14].
| Linux generic | Whole `$XDG_DATA_HOME`, `$XDG_CONFIG_HOME`, relevant home dot-directories, package/provider/version and desktop-session/PAM configuration | Required until provider is identified; Secret Service does not define persistence [S15].
| GNOME | `$XDG_DATA_HOME/keyrings/**`; `~/.gnome2/keyrings/**`; exact GNOME Keyring/libsecret build/config | Required for GNOME candidate. Both source-selected locations and `*.keyring` tracking are source-confirmed [S16].
| KWallet | `$XDG_DATA_HOME/kwalletd/**`, legacy KDE wallet/config trees, network-wallet selection, all `.kwl`; for GPG wallets the complete authorized GnuPG home/agent configuration and secret-key material | Required/conditional. File placement and password/GPG open variants are source-confirmed; exact Qt default expansion and migrated Secret-Service persistence remain environment-dependent [S19–S20].
| Windows Chrome | Exact `User Data/Local State`, each profile DB/sidecars and Preferences | `Local State` is required for the `DPAPI` wrapper; `PROFILE_DIR` omits it [S10–S11].
| Windows DPAPI | Whole affected user profile; SID/account/domain metadata; all `Microsoft\Protect` and credential-history candidates; full registry hives with transaction logs; OS build; preferably the complete Windows volume/image | Conservative **INFERRED** preservation because the official API does not document an offline minimum [S21–S22]. Do not discard data based on this unresolved minimum.
| Domain recovery | Authorized domain DPAPI backup keys or a protected DC/AD backup containing them, plus domain/SID mapping | Conditional alternative for domain users; extremely sensitive. Microsoft's page establishes scope [S23].

`ACQUISITION_BUNDLE` manifests should represent provider stores and secrets as separate artifacts with independent hashes/access controls. Secrets should be referenced by sealed secret IDs; raw keyring passwords, DPAPI backup keys and derived OSCrypt keys must not be embedded in routine reports.

## Credentials and supplied-secret contract

| Secret type | What it can establish | What it cannot establish |
|---|---|---|
| `macos-keychain-password` | Unlock the copied keychain candidate | That the Chrome item exists, that ACL permits extraction, or that a different keychain is unnecessary [S14] |
| `macos-safe-storage-secret` | Direct input to the documented PBKDF2 chain | Source keychain provenance unless separately recorded [S7] |
| `linux-keyring-master-password` | Candidate unlock for a copied GNOME collection | Equality to OS login password, backend identity, or correct Chrome item [S15–S18] |
| `kwallet-password` | Open password-based `.kwl` | A GPG wallet or migrated Secret Service backend [S19–S20] |
| `kwallet-gpg-secret-key` + passphrase | Candidate GPG-wallet open | Password-based wallet or missing wallet-selection evidence [S19–S20] |
| `linux-oscrypt-provider-secret` | Direct `v11` KDF input | Which backend/item produced it unless provenance is supplied [S8, S12–S13] |
| `windows-user-credential` / history material | Runtime DPAPI association; candidate offline input | The same-computer/offline master-key requirement, Local State, or domain backup [S21–S22] |
| `domain-dpapi-backup-key` | Domain-user DPAPI recovery, including after password change | Local-user data, missing wrapper/database, or App-Bound `v20` [S23–S24] |
| raw 16-byte CBC key / raw 32-byte GCM key | Row decryption for the matching provider/tag | Provider recovery, historical-key identity, or cross-profile use [S26] |

Supplied secrets are a valid v2 input mode, but the Finding must say `key_origin=supplied`, not `recovered`, and record the sealed-secret identifier, authorizing actor, receipt time, validation method and derivation steps.

## Offline-only feasibility and safety

| Method | Assessment |
|---|---|
| Parse provider files directly on a forensic workstation | Desired design. **INFERRED/UNTESTED** for copied macOS/GNOME/KWallet stores; **UNKNOWN/UNSUPPORTED** for Windows DPAPI. It must use only Working Copy paths and documented/sandboxed libraries.
| Run an analysis-side provider daemon against copied Linux files | Potential experiment mechanism, not yet a product capability. Isolate `HOME`, `XDG_*`, D-Bus and network; verify it cannot see analyst/suspect live stores; hash before/after and reject mutation.
| Use macOS `security` with an explicit copied keychain path | First-party command surface exists [S14], but forensic non-mutation and all ACL variants are untested. Use a disposable second-generation copy and compare hashes.
| Call `CryptUnprotectData` on another Windows workstation | Not a portable recovery recipe: Microsoft says same credentials and usually same computer [S21–S22]. A successful call in a booted clone is an active reconstruction, not file-only parsing.
| Boot the evidence image or launch Chrome/provider against it | Prohibited for normal recovery. Chrome/provider missing-item paths can generate and store a new secret [S7–S8, S12–S13]. A booted clone is a separately authorized destructive experiment and never the immutable Source.
| Query the live suspect Keychain/Secret Service/KWallet/DPAPI context | Outside issue scope. Report `live-key-store-access-disallowed`; do not silently escalate from offline unavailability.

## Typed failure/unavailable taxonomy

These exact reason strings are suitable for ForensiX. They describe the first failed prerequisite/stage; no failure may be represented as an empty plaintext.

| Exact reason | When returned |
|---|---|
| `missing-browser-profile-artifact` | Required database/profile artifact is absent from the Working Copy.
| `missing-browser-version-evidence` | Exact product/build/provider cannot be established from acquired metadata/binary; prefix alone is insufficient.
| `unsupported-unidentified-oscrypt-variant` | Browser build is known but its provider variant is outside pinned coverage or remains ambiguous.
| `unsupported-row-prefix` | Row is not a supported `v10`/`v11` form; route `v12` to its owner and Windows `v20` to #141.
| `incomplete-sqlite-snapshot` | A present/required WAL/journal set is missing or inconsistent [S27].
| `missing-provider-configuration` | Provider selection/search-list/network-wallet configuration required to identify a copied store is absent.
| `supplied-secret-provenance-incomplete` | A raw/provider secret was supplied without the required authorization, sealed identifier or origin record; do not consume it.
| `missing-macos-keychain-store` | Neither a copied keychain store nor supplied Safe Storage secret exists.
| `macos-keychain-search-set-unresolved` | Keychain files exist but search-list/account-home evidence cannot identify the candidate set.
| `macos-keychain-credential-unavailable` | Copied store exists but no authorized keychain credential is supplied.
| `macos-safe-storage-item-not-found` | Unlocked copied search set has no exact branded service/account item; never create one [S7, S14].
| `macos-keychain-item-access-denied` | Store unlocks but item ACL/access denies value retrieval.
| `unsupported-macos-keychain-format` | Copied keychain generation cannot be parsed by the validated recovery implementation.
| `linux-secret-store-provider-unidentified` | Secret Service use is indicated but persistence backend/config cannot be established [S15].
| `missing-linux-secret-store` | Identified non-basic provider store is absent.
| `linux-keyring-credential-unavailable` | GNOME/Secret Service collection is locked and no authorized backend credential exists.
| `linux-oscrypt-item-not-found` | Unlocked provider contains no exact application/branded OSCrypt item; never create one [S8, S12–S13].
| `kwallet-network-wallet-unresolved` | KWallet is established but configuration does not identify the selected network wallet.
| `missing-kwallet-store` | KWallet selected but selected network-wallet persistence is absent.
| `kwallet-credential-unavailable` | Password wallet exists without authorized wallet password.
| `kwallet-gpg-prerequisite-unavailable` | GPG wallet lacks secret key, agent state needed by the validated method, or passphrase.
| `unsupported-kwallet-format` | Wallet cipher/hash/revision/provider migration is outside validated coverage [S19–S20].
| `missing-windows-local-state` | Windows profile supplied without its exact User Data `Local State` [S10–S11].
| `invalid-oscrypt-encrypted-key-wrapper` | Base64 fails, decoded bytes lack `DPAPI`, or wrapper is too short [S10–S11].
| `missing-dpapi-master-key-material` | Required offline DPAPI material is absent; do not call this a wrong password.
| `windows-user-credential-unavailable` | Local/domain user unlock input and valid alternatives are absent.
| `missing-domain-identity-mapping` | Domain backup material exists but acquired SID/domain identity cannot map the affected user to it.
| `domain-dpapi-recovery-key-unavailable` | Domain recovery was selected/required but no authorized backup key exists [S23–S24].
| `unsupported-offline-user-dpapi` | Inputs may be complete but no validated file-only DPAPI implementation covers the acquired Windows build; current default.
| `dpapi-unprotect-failed` | A validated unwrap was attempted and DPAPI integrity/credential processing failed [S22].
| `invalid-oscrypt-key-length` | Derived/recovered CBC key is not 16 bytes or Windows GCM key is not 32 bytes [S7–S11, S26].
| `cbc-plaintext-not-authenticated` | CBC padding/decoding succeeds but policy requires independent authenticity; emit no “authenticated” assertion [S26].
| `row-authentication-failed` | Windows AES-GCM open rejects nonce/ciphertext/tag; emit no plaintext [S26].
| `row-decryption-failed` | CBC padding/decode fails or another supported row operation fails.
| `provider-key-mismatch-or-historical-key-lost` | Item/key is valid but does not decrypt rows, consistent with wrong profile/provider or overwritten historical secret; do not try arbitrary keys as success.
| `live-key-store-access-disallowed` | Requested path would query a live suspect provider rather than Working Copy evidence.
| `provider-recovery-not-locally-validated` | A copied-store path is source-plausible but has not passed its constructed-ground-truth ticket.

## Plaintext Finding and provenance policy

Plaintext **may** become a Finding only after the applicable variant and prerequisites are established and the result passes the strongest available validation. Windows `v10` GCM results must authenticate; a failed tag yields no plaintext [S26]. macOS/Linux `v10`/`v11` CBC has no AEAD authentication in Chromium's construction, so successful padding/UTF decoding is only a **derived plaintext candidate**. It may be a Finding when corroborated by row schema/encoding and, where applicable, Chrome's payload-level validation, but must carry `cryptographic_authentication=false` and must never be described as authenticated [S26].

Each plaintext Finding must record:

1. Source ID, acquisition/container type, original absolute path, profile identity, database/table/primary key (and SQLite page/WAL frame when available), source and Working Copy hashes.
2. Exact browser product/version/revision evidence, row prefix, provider classification, cipher/KDF parameters and implementation/tool build hash [S2–S11, S26].
3. Provider-store artifact paths/hashes, item selector (service/account or application/folder/key), key-store format/provider version, and whether extraction used direct parsing, isolated provider replay, or `key_origin=supplied`.
4. Credential **identifier and type only**, authorization/receipt provenance, never the raw password/key; every derivation stage and derived-key fingerprint (case-scoped HMAC or other non-reversible identifier, not raw key).
5. Authentication status: GCM success; or CBC unauthenticated plus independent validation/corroboration performed. Preserve the ciphertext hash and error details.
6. Operator/time, command/API, sandbox/no-live-store assertion, pre/post Working Copy hashes, and zeroization/retention disposition for provider secrets and plaintext.

Do not write plaintext back into source databases. Reports should minimize/redact credentials by default and store sensitive derived Findings encrypted with case access controls.

## Demonstrated versus untested paths

| Path | Classification | Result |
|---|---|---|
| Pinned Chromium/Apple/GNOME/KDE/Microsoft source retrieval | **SOURCE-CONFIRMED / VERSION-SPECIFIC** | Establishes the constructions and supported command/backend surfaces cited above.
| Chromium provider unit tests | **UPSTREAM-TESTED** only | Tests exist for M151 key providers, but they use injected/fake secrets/services and do not recover a real copied suspect store [S28].
| macOS copied user keychain → Safe Storage → real Chrome row | **UNKNOWN/UNTESTED** | Not run.
| GNOME copied `*.keyring` → Secret Service item → real Chrome `v11` row | **UNKNOWN/UNTESTED** | Not run.
| copied `.kwl`/GPG wallet → Chrome entry → real Chrome `v11` row | **UNKNOWN/UNTESTED** | Not run.
| Windows copied Local State + offline DPAPI files/credential → real `v10` row | **UNKNOWN/UNSUPPORTED** | Not run; exact public Microsoft offline recipe unresolved.
| Linux basic constructed fixture | **SOURCE-CONFIRMED, not LOCALLY-DEMONSTRATED here** | No experiment was performed because #144 concerns real provider evidence and the portable path is already pinned by #127.

**No LOCALLY-DEMONSTRATED claim is made in this brief.** No disposable Source + Manifest + Working Copy known-plaintext experiment was performed.

## Final ForensiX v2 capability declaration

Use the following resolution text:

> **ForensiX v2 does not currently support general offline recovery of Chrome OSCrypt provider keys from real copied macOS Keychain, Linux Secret Service/GNOME Keyring/KWallet, or Windows user-DPAPI evidence.** It supports classifying the pinned provider variants, preserving and reporting their prerequisites, deterministic Linux-basic `v10` derivation, and row decryption when an authorized provider secret/raw key is explicitly supplied. Copied-store macOS/GNOME/KWallet recovery is experimental pending constructed-ground-truth validation. Legacy Windows `os_crypt.encrypted_key` file-only DPAPI recovery is unsupported pending a primary-source-compatible implementation and Windows ground truth. All work occurs on a Working Copy; ForensiX never queries a live suspect key store or launches the evidentiary browser. Windows App-Bound `v20` remains unsupported here and owned by #141.

This is intentionally narrower than “the crypto is known.” Known PBKDF2/AES parameters do not supply the provider secret; known DPAPI API semantics do not constitute a validated offline master-key parser.

## Recommended follow-up experiment tickets

1. **macOS copied-login-keychain ground truth.** On pinned Chrome M113 and M151 lab VMs, save known ASCII/non-ASCII credentials, acquire user Keychains plus browser profile, power off Source, make a manifest and Working Copy, and recover via explicit copied keychain path. Controls: wrong keychain password, missing item, Chromium/Chrome selector swap, ACL denial, moved copy, corrupt keychain, altered ciphertext. Verify no analyst/live keychain is queried and record pre/post hashes.
2. **GNOME Keyring/libsecret ground truth.** Pin distro, GNOME Keyring/libsecret and Chrome M113/M151. Acquire both XDG and legacy directories plus provider config. Recover known `v11` rows offline with correct/wrong login and independent keyring passwords; test locked collection, multiple matching items, missing item and mutated `.keyring`. Never allow Chrome/provider to create an item.
3. **KWallet matrix ground truth.** Cover KWallet4/5/6 direct D-Bus, password `.kwl`, GPG `.kwl`, and current ksecretd/Secret-Service migration. Record network-wallet selection and XDG expansion. Controls: wrong wallet, password, GPG key/passphrase, missing config, unsupported cipher/hash and provider migration.
4. **Legacy Windows user-DPAPI constructed ground truth.** On local and domain users for pinned M113/M127/M133/M151 non-App-Bound `v10`, preserve Local State, complete user/system evidence and known password/history; export an authorized lab domain backup key. Power off Source and attempt file-only recovery on a separate workstation. Controls: profile-only, User-Data-only, wrong password/history, missing master-key material, cross-machine, wrapper/row tamper, domain recovery, key-length failure. Pass only if known plaintext authenticates and no original/booted clone API context is used.
5. **CBC Finding confidence.** Construct macOS/Linux rows with known plaintext, wrong keys that occasionally pass padding, tampering and cookie/login payload variants; define independent validation thresholds and prove the UI cannot label CBC output “authenticated.”
6. **Provider/version detector.** Build a corpus of acquisition metadata and provider stores across the exact pinned releases; require deterministic selection or `unsupported-unidentified-oscrypt-variant`, never prefix-only inference.

Each ticket must create a disposable known-plaintext Source, immutable hashed acquisition, manifest, second-generation Working Copy, exact secrets outside the image, positive and negative controls, and a no-live-store network/filesystem trace. Success from an existing forensic tool is not ground truth.

## Limitations and unresolved primary-evidence gaps

1. No real provider-store experiment was run; all copied-store feasibility statements are explicitly inferred/untested.
2. Apple's public CLI and open-source man page establish named-keychain operations, not a universal offline database format or all modern ACL/iCloud/Secure-Enclave cases [S14]. The exact minimal macOS companion-file set remains unknown; whole-directory acquisition is conservative.
3. Secret Service is backend-neutral. GNOME/KDE paths do not cover KeePassXC or every distribution patch/provider [S15, S20].
4. KDE now spans direct KWallet, GPG/password formats, ksecretd and proxy/migration behavior. No single `.kwl` rule is universal [S19–S20].
5. The public Microsoft pages fetched here document runtime DPAPI and domain backup semantics, not the exact local master-key file format/offline derivation requested. An official `MS-DPAPI` Open Specifications page was not accessible/found; this gap is recorded rather than filled from forensic-tool literature [S21–S24].
6. Scope begins at the exact M113 tag and excludes older raw-DPAPI Windows rows and Linux/macOS historical changes before that tag.
7. Chrome/Chromium derivatives can change branding selectors, provider wiring or crypto. Unsupported derivatives require their own pinned first-party source.
8. M151 Stable feed results were volatile and concurrently contained multiple patch builds; always prefer acquired binary evidence [S1].

## Numbered primary-source bibliography

All pages/files were requested with redirects followed on 2026-08-08 UTC unless an inability is stated. Chromium links are immutable Gitiles revisions; GitHub raw/mirror links cited for Apple, GNOME and KDE are their first-party project organizations and pinned commits.

1. **[S1] Google ChromiumDash**, Linux/Windows Stable release feeds (volatile; M151 `151.0.7922.109`, revision `28a7…` recorded): <https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&num=20>, <https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux&num=200>.
2. **[S2] Chromium tag 113.0.5672.0 (`0aa944…`)**, macOS/Linux/Windows sync OSCrypt: <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/os_crypt_mac.mm>, <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/os_crypt_linux.cc>, <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/os_crypt_win.cc>.
3. **[S3] Chromium tag 127.0.6533.0 (`4e8779…`)**, same platform sync files: <https://chromium.googlesource.com/chromium/src/+/4e87798573995adec11a5688a5544d7a14e60aa4/components/os_crypt/sync/>.
4. **[S4] Chromium tag 130.0.6723.0 (`ed44bc…`)**, same platform sync files: <https://chromium.googlesource.com/chromium/src/+/ed44bc873f9ef776a2ef1ccb90252a6de5666cd6/components/os_crypt/sync/>.
5. **[S5] Chromium tag 133.0.6943.0 (`0155b8…`)**, same platform sync files: <https://chromium.googlesource.com/chromium/src/+/0155b8edb17ab54ddbc7f4b79a160632275fbbd5/components/os_crypt/sync/>.
6. **[S6] Chromium M151 (`28a7…`)**, browser provider registration/precedence: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/browser_process_impl.cc#1550>.
7. **[S7] Chromium M151 (`28a7…`)**, macOS provider constants/KDF and Safe Storage service/account/random item: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/keychain_key_provider.mm#25>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/common/keychain_password_mac.mm#32>.
8. **[S8] Chromium M151 (`28a7…`)**, Freedesktop Secret/KWallet provider: constants, selector, item lookup/create, KWallet services and one-iteration KDF: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/freedesktop_secret_key_provider.h#107>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc#44>.
9. **[S9] Chromium M151 (`28a7…`)**, POSIX/basic compiled key and exact PBKDF2 comment: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/posix_key_provider.cc#14>.
10. **[S10] Chromium M151 (`28a7…`)**, Windows key generation, DPAPI flags/no entropy and Local State wrapper: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/os_crypt_win.cc#28>.
11. **[S11] Chromium M151 (`28a7…`)**, DPAPI provider `v10`, `DPAPI` header, unwrap and 32-byte length: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/dpapi_key_provider.cc#24>.
12. **[S12] Chromium M113 (`0aa944…`)**, libsecret and direct GNOME Keyring selectors/items: <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/key_storage_libsecret.cc>, <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/key_storage_keyring.cc>.
13. **[S13] Chromium M113 (`0aa944…`)**, Linux backend selection/branding and KWallet read/create: <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/key_storage_linux.cc>, <https://chromium.googlesource.com/chromium/src/+/0aa944b38c653da13d97a6e90f313c36be6c8422/components/os_crypt/sync/key_storage_kwallet.cc>.
14. **[S14] Apple OSS Security commit `db15ac…`**, `security(1)` commands `list-keychains`, `unlock-keychain`, and `find-generic-password` with explicit keychain operands: <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L221-L248>, <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L312-L320>, <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L550-L558>. Apple Developer Keychain Services landing page: <https://developer.apple.com/documentation/security/keychain-services>.
15. **[S15] freedesktop.org**, Secret Service API 0.2, especially “Collections and Items,” “Sessions,” “Locking and Unlocking,” and D-Bus `Service.GetSecrets`: <https://specifications.freedesktop.org/secret-service-spec/latest/>, <https://specifications.freedesktop.org/secret-service-spec/latest/unlocking.html>, <https://specifications.freedesktop.org/secret-service-spec/latest/org.freedesktop.Secret.Service.html>.
16. **[S16] GNOME Keyring commit `947a85…`**, keyring directory selection and `*.keyring` tracking: <https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/947a85a29db0684546ceca95e7d539d5a9e15616/pkcs11/gkm/gkm-util.c#L140-152>, <https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/947a85a29db0684546ceca95e7d539d5a9e15616/pkcs11/secret-store/gkm-secret-module.c#L398-408>.
17. **[S17] GNOME Keyring commit `947a85…`**, first-party legacy keyring file-format description: <https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/947a85a29db0684546ceca95e7d539d5a9e15616/pkcs11/secret-store/file-format.txt>.
18. **[S18] GNOME Keyring commit `947a85…`**, login keyring lookup and supplied-master unlock/create path: <https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/947a85a29db0684546ceca95e7d539d5a9e15616/daemon/login/gkd-login.c#L115-164>, <https://gitlab.gnome.org/GNOME/gnome-keyring/-/blob/947a85a29db0684546ceca95e7d539d5a9e15616/daemon/login/gkd-login.c#L191-240>.
19. **[S19] KDE KWallet commit `191bc1…`**, `.kwl` path/magic/read-only open, password/GPG opens and KDF constants: <https://github.com/KDE/kwallet/blob/191bc1c0a55c0fb705868a60543a1f30f7981aa1/src/runtime/kwalletbackend/kwalletbackend.cc#L110-L175>, <https://github.com/KDE/kwallet/blob/191bc1c0a55c0fb705868a60543a1f30f7981aa1/src/runtime/kwalletbackend/kwalletbackend.cc#L316-L407>, <https://github.com/KDE/kwallet/blob/191bc1c0a55c0fb705868a60543a1f30f7981aa1/src/runtime/kwalletbackend/kwalletbackend.h#L22-L24>.
20. **[S20] KDE KWallet commit `191bc1…`**, KWallet/Secret-Service architecture and migration: <https://github.com/KDE/kwallet/blob/191bc1c0a55c0fb705868a60543a1f30f7981aa1/README.md#L1-L35>. XDG Base Directory specification (default data/config locations): <https://specifications.freedesktop.org/basedir-spec/latest/>.
21. **[S21] Microsoft Learn**, `CryptProtectData` (same credential/computer, local-machine flag, MAC): <https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata>.
22. **[S22] Microsoft Learn**, `CryptUnprotectData` (credential/computer, optional entropy and integrity behavior): <https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata>.
23. **[S23] Microsoft Learn**, DPAPI backup keys on Active Directory domain controllers: <https://learn.microsoft.com/en-us/windows/win32/seccng/cng-dpapi-backup-keys-on-ad-domain-controllers>.
24. **[S24] Microsoft Open Specifications**, MS-BKRP overview/domain backup-key remote protocol (not a local master-key file specification): <https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-bkrp/b9074a95-88d6-4667-a54e-92e417f71378>.
25. **[S25] Chromium M151 (`28a7…`)**, Secret Portal `v12`, RetrieveSecret and HKDF-SHA256 construction: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/secret_portal_key_provider.h#40>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/secret_portal_key_provider.cc#38>.
26. **[S26] Chromium M151 (`28a7…`)**, encryptor algorithms, fixed CBC IV, GCM nonce/empty AD and prefix dispatch: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/common/encryptor.cc#35>.
27. **[S27] SQLite**, first-party WAL documentation and warning to keep database/WAL together: <https://sqlite.org/wal.html>.
28. **[S28] Chromium M151 (`28a7…`)**, provider tests/fixtures (upstream-test evidence only): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/keychain_key_provider_unittest.mm>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/freedesktop_secret_key_provider_unittest.cc>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/dpapi_key_provider_unittest.cc>.
