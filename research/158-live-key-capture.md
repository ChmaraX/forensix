# Research: live key material capture, per platform (ChmaraX/forensix#158)

> **Issue:** [#158](https://github.com/ChmaraX/forensix/issues/158)
> **Research/access date:** 2026-08-08 UTC
> **Repository state:** written against local commit `92ae2c935806d6e16c5f9c999b7fb1dc514c6879`.
> **Pinned browser sources actually read:** Chromium M151 Stable revision `28a7a6c409e03c701d3474ef9e3b1f0be6249039`, specifically the macOS Keychain, Linux Freedesktop Secret, Windows DPAPI, and Windows App-Bound provider/interfaces named below [S1–S5]. Earlier construction boundaries are inherited only where explicitly attributed to #144; v1 is intent only and is not a behavioral reference.
>
> **Evidence legend (exactly #144's decision vocabulary):** **SOURCE-CONFIRMED** = stated or implemented by a cited first-party source; **UPSTREAM-TESTED** = behavior asserted only by an upstream test/fixture; **INFERRED** = a consequence or proposed collector composition of cited sources, not an end-to-end result; **UNKNOWN-UNSUPPORTED** = public primary evidence, a supported variant, or a genuine reproduction is absent; **VERSION-SPECIFIC** restricts any label to the named revision. No label means ForensiX implements the path.

## Executive answer

An authorized live collector should, where the platform exposes a supported read surface and the written authorization covers the resulting secret, preserve **both** (a) the derived browser row key in a separately sealed, access-controlled secret envelope and (b) narrowly scoped provider evidence sufficient to identify and later challenge/repeat the acquisition. **INFERRED.** The derived key enables immediate off-host row decryption without replaying a live store; provider artifacts and item metadata preserve provenance, permit later copied-store research, and cover a failed or disputed derivation. They are not interchangeable.

The custody cost is high. A raw derived key directly unlocks all rows protected by that key; a copied Keychain/keyring/wallet or Windows DPAPI environment may expose many unrelated secrets. Store copies therefore require a separate manifest class, encryption, least-privilege access, retention/return/destruction policy, and reports that contain only a case-scoped non-reversible key identifier—not raw key bytes. If authorization permits only the browser item, preserve the derived key plus exact item/provider metadata and hashes; do **not** silently broaden acquisition to an entire multi-application store. **INFERRED.** Where a relevant backing artifact cannot be isolated or is out of scope, record `not-copied-scope-restricted`, not “absent.”

Supported live access is clear only for ordinary macOS/Linux provider secrets and Windows legacy user-DPAPI `v10`: Apple Keychain search/read, Secret Service `Unlock`/`GetSecrets`, KWallet open/read, and `CryptUnprotectData` are first-party surfaces [S6–S15]. Their complete non-mutation and audit behavior is not documented. Windows DPAPI is the one documented audit exception: because Chromium protects its wrapper with `CRYPTPROTECT_AUDIT` and a non-empty description, an unprotect attempt can generate Security event 4695 when the DPAPI audit subcategory is enabled [S3, S13–S14].

Live capture makes copied-store tickets #146/#147/#149 **secondary, not unnecessary**. They still own old images, third-party acquisition bundles, failed/declined live prompts, unavailable user sessions, historical provider state, validation of store copies, and independent repeatability. Windows App-Bound `v20` is unchanged: no public first-party Chromium or Microsoft interface was found that documents an authorized external collector exporting the 32-byte row key or asking the App-Bound service to unwrap it on the collector's behalf. Chromium's source-visible App-Bound functions are browser-internal and path/user-bound, and the provider can re-encrypt and rewrite Local State; they are not an external forensic API [S4–S5, S15–S17]. Third-party claims cannot change this conclusion.

## Scope and version boundaries

This is defensive product planning for an opt-in Collector operating on a live machine under recorded written authorization. It covers only documented platform/browser access surfaces, prerequisites, evidence preservation, custody, and measurement planning. It does **not** cover process memory, credential extraction from other processes, bypasses, exploitation, evasion, or any method for defeating an OS/app access decision.

* **VERSION-SPECIFIC / SOURCE-CONFIRMED:** browser construction and provider behavior cited directly here are pinned to Chromium M151 revision `28a7…` [S1–S5].
* **VERSION-SPECIFIC / INFERRED:** Chrome/Chromium branding selectors and KDF chains are as pinned in #144 at the same revision. Derivation is a collector-side calculation only after an authorized first-party store read; the collector must never invoke Chromium's “missing item” creation branch [S1–S2].
* Linux `v12` Secret Portal, vendor derivatives, iCloud-only/data-protection Keychain variants, non-GNOME Secret Service providers, KWallet migration configurations, and Windows builds outside pinned coverage require separate classification. **UNKNOWN-UNSUPPORTED** unless a cited first-party variant and Cua measurement cover them.
* A row prefix selects a crypto variant; browser milestone alone does not. Mixed `v10`/`v20` Windows data must dispatch per row.
* No live machine or desktop store was exercised for this brief. There are no local behavioral claims.

## Per-platform decision matrix

| Platform/provider | Preserve derived key? | Preserve relevant store evidence? | What each enables | Supported live prerequisite | Side effects established by first party | Product decision |
|---|---|---|---|---|---|---|
| macOS Chrome/Chromium Safe Storage | **Yes**, sealed 16-byte derived AES-CBC key plus derivation record | **Yes**, exact item attributes/ACL result and, only if separately authorized, relevant Keychain files/search-list evidence | Key decrypts matching `v10` rows off-host; store evidence proves selector/origin and supports copied-store retry | Item in accessible keychain; keychain already unlocked or correct keychain password/UI unlock; calling collector trusted by ACL or user chooses one-time Allow [S6–S10] | Read API is described as copy/search. UI may occur. “Always Allow” changes ACL; collector must prohibit it. Other store/log/audit mutation is **UNKNOWN-UNSUPPORTED** | **INFERRED:** offer consent-gated targeted live read; fail closed on denial; never add/update item |
| Linux Secret Service / GNOME Keyring | **Yes**, sealed derived `v11` key (or provider secret plus explicit KDF policy; prefer derived key for least retained raw provider material) | **Yes**, target item attributes/object path, provider identity/version/locked state; copy backing files only within authorization | Key decrypts matching rows; provider evidence supports provenance/backend-specific copied-store work | Correct user's graphical/login D-Bus session; running service; open Secret Service session; collection/item unlocked or service prompt completed; master password is entered into provider UI, not passed through libsecret's modern unlock API [S11–S12] | Unlock changes live lock state and can apply collection-wide or per-client; spec does not define persistence/audit mutation. D-Bus traffic may be cached by OS [S11] | **INFERRED:** read exact existing item only; never call store/create; record pre/post `Locked` state and do not force relock without explicit policy/measurement |
| Linux KWallet password wallet | **Yes** | **Yes**, selected wallet/folder/key identity, KWallet/provider version/config and authorized `.kwl`/backend evidence | Same split as Secret Service | Correct desktop session/D-Bus; selected network wallet; wallet already open or user approves application and may supply wallet password; then exact folder/key read [S2, S15] | KDE documents that `openWallet` can prompt and that wallet close automatically syncs the wallet file; whether a read-only open/close changes bytes is **UNKNOWN-UNSUPPORTED** [S15] | **INFERRED:** targeted read only, with Cua non-mutation gate before product support |
| Linux KWallet GPG wallet | **Yes**, if first-party open succeeds | **Yes**, wallet configuration and authorized wallet/GnuPG provenance; never acquire unrelated private keys by default | Derived key permits row decrypt; artifacts support later characterization | Running KWallet plus usable selected GPG secret key and GPG agent/pinentry state; whether an already-cached agent, passphrase prompt, or hardware token is required is version/config dependent and **UNKNOWN-UNSUPPORTED** [S15–S16] | Store, agent-cache, audit and close/sync side effects are **UNKNOWN-UNSUPPORTED** | No release claim before Cua matrix |
| Windows legacy user-DPAPI `v10` | **Yes**, sealed 32-byte row key | **Yes**, exact `Local State` wrapper/hash and conservatively scoped DPAPI/user-context artifacts when authorized | Key decrypts/authenticates matching AES-256-GCM rows; wrapper/artifacts preserve provenance and offline fallback | Correct user's loaded profile and current-user logon context on the originating computer; username equality is insufficient. No separate password prompt is normally used by Chromium's wrapper [S3, S13] | `CryptUnprotectData` is read-like and documents output allocation/zeroing, not store mutation. Event 4695 may be generated for auditable data if policy enables DPAPI auditing [S13–S14] | **SOURCE-CONFIRMED** API surface, **INFERRED** collector composition; measure success, audit, and file changes in Cua cloud |
| Windows App-Bound `v20` | **No supported capture path found** | **Yes**, Local State `APPB` wrapper, browser/service/version/policy evidence and encrypted rows; do not claim row key | Artifacts preserve unsupported state and future reproducibility; they do not enable current external unwrap | Browser-internal provider requires supported system install and same-user/same-application-path validation [S4–S5, S17] | Provider may re-encrypt and write the encrypted pref during retrieval; other service/audit effects are not fully documented [S4] | **UNKNOWN-UNSUPPORTED** for an external collector; #141 conclusion unchanged |

### Evidence common to every successful live capture

Preserve: written authorization identifier and scope; operator; UTC start/end; host and affected account identity; OS build; exact browser product/version and executable hash; profile/User Data Dir paths; provider and selector; pre/post hashes/metadata for every copied artifact; raw ciphertext hashes and row prefix counts; API/tool version and result code; every prompt shown and operator/user response; lock state observed before/after; whether browser/provider was already running; sealed-secret identifier; derivation parameters; case-scoped key fingerprint; positive GCM validation or CBC's explicit unauthenticated status; and key zeroization/retention disposition. **INFERRED.** Do not place passwords, provider secrets, raw derived keys, or plaintext credentials in routine logs or reports.

## Detailed platform chains

### macOS: supported targeted read, ACL and prompt boundaries

```text
live affected user's Keychain search set
  exact generic-password service/account selector
     -> Keychain unlocked already, explicit password, or OS unlock UI
     -> ACL: trusted caller OR user chooses Allow Once
     -> Safe Storage item value
     -> pinned PBKDF2 derivation
     -> sealed derived browser key + provenance
```

**SOURCE-CONFIRMED / VERSION-SPECIFIC:** Chromium reads the exact branded generic-password item and derives its browser key; its not-found branch creates a random password, so the collector must use Apple read/search APIs directly and must not run Chromium's provider as a retrieval mechanism [S1]. Apple exposes `SecItemCopyMatching`, named search lists, `SecKeychainUnlock`, and `security find-generic-password`/`unlock-keychain` [S6–S9]. A locked keychain can be unlocked with a supplied keychain password or OS dialog. The login keychain is normally unlocked at login, but account and keychain passwords can diverge [S8–S9].

**SOURCE-CONFIRMED:** macOS ACLs can trust named applications or prompt the user. The UI offers Deny, Allow Once, and Always Allow; Always Allow adds trust and therefore mutates ACL state [S7, S10]. Collector policy must accept only a pre-existing trusted grant or **Allow Once**, record it, and abort on Deny/cancel. It must not request or instruct “Always Allow.” Logged-in/unlocked desktop state is the safest supported operator envelope; whether every file-based keychain can be read from a non-GUI session with an explicit password is **UNKNOWN-UNSUPPORTED** for the product until measured.

**UNKNOWN-UNSUPPORTED:** Apple does not publicly promise that a successful read/unlock leaves every Keychain database, preference, unified-log, authorization cache, or access timestamp unchanged, nor did a first-party Keychain audit-event contract surface. This belongs to Cua measurement. Preserve the targeted item's service/account, keychain identity, ACL/prompt outcome and timestamps as observed; broad Keychain copies require separate authorization because they contain unrelated secrets.

### Linux: Secret Service, GNOME Keyring, KWallet, and GPG state

```text
affected user's active desktop session + session D-Bus
   -> establish Secret Service/KWallet client session
   -> identify existing exact Chrome/Chromium item
   -> if locked, provider-owned prompt/authorized unlock
   -> GetSecret/GetSecrets or KWallet readPassword
   -> provider secret
   -> pinned derivation
   -> sealed derived browser key + provider provenance
```

**SOURCE-CONFIRMED:** Secret Service sessions are bound to the caller's D-Bus connection; locked secrets cannot be read. `Unlock` may immediately unlock objects or return a provider-owned Prompt, and an implementation can unlock a whole collection or only for one client. `GetSecrets` returns secrets through the negotiated session [S11]. Modern libsecret explicitly does not accept the keyring password as an API argument; it handles the provider prompt [S12]. Thus a headless root shell or merely knowing the login password is not a supported substitute for the affected user's running session and UI.

For GNOME Keyring, a login password may already have unlocked the login collection through PAM, but equality between account password and collection password is not universal. **SOURCE-CONFIRMED** that login integration exists; **INFERRED** that “logged in” commonly yields an unlocked login collection; actual collection/backend state must be queried and recorded [S12]. Unlocking is live state mutation even if no bytes change. The Secret Service specification does not standardize backing files, store-write behavior, or audit events, so each provider's persistence and logs are **UNKNOWN-UNSUPPORTED** until Cua measurement.

**SOURCE-CONFIRMED:** KDE's public KWallet API offers `openWallet`, `setFolder`, and `readPassword`; opening can prompt for application permission and a wallet password. KDE also documents that closing can automatically sync the wallet [S15]. Current KDE can proxy KWallet to Secret Service or migrate providers, so `.kwl` must not be assumed from API branding alone [S16]. For GPG wallets, first-party source establishes GPG-backed support, but a universal prerequisite contract for cached `gpg-agent`, pinentry, passphrase, hardware token, or desktop session was not found: **UNKNOWN-UNSUPPORTED**.

Collector policy: identify the running provider and existing exact item before reading; do not create a collection/item; do not launch Chrome; do not assume an empty search means Linux basic; do not relock a collection or wallet automatically because that itself changes state for other applications. Record pre/post state and leave restoration policy to a measured, explicit product decision.

### Windows legacy DPAPI `v10`: current-user context and auditable read

```text
exact live User Data/Local State DPAPI wrapper
   -> affected user's loaded profile + current-user logon context
   -> CryptUnprotectData(no optional entropy)
   -> 32-byte browser row key
   -> sealed key + wrapper/provenance + event/file observations
```

**SOURCE-CONFIRMED / VERSION-SPECIFIC:** Chromium's DPAPI provider reads the Base64 `DPAPI` wrapper and calls `CryptUnprotectData`; the key must be 32 bytes [S3]. Microsoft documents that ordinarily only the user with the same logon credentials can decrypt and decryption normally occurs on the same computer. The .NET wrapper additionally warns that impersonation without loading the user's profile can fail [S13]. Product prerequisites are therefore an interactive or service execution genuinely in the affected user's loaded current-user context on the originating live machine—not a supplied password in an arbitrary administrator context.

**SOURCE-CONFIRMED:** Chromium originally uses `CRYPTPROTECT_AUDIT` with a non-empty product description. Microsoft says auditable unprotect attempts can produce event 4695 when the Audit DPAPI Activity subcategory is enabled [S3, S14]. This is an evidence-relevant side effect, not evasion guidance: record whether policy/log access was available and preserve the event or explicitly state it was unavailable. Microsoft documents no normal password/UI prompt for this wrapper. `CryptUnprotectData` itself does not document mutation of DPAPI master-key files, but absence of documentation is not proof of no file/registry/cache changes; this remains **UNKNOWN-UNSUPPORTED** pending Cua measurement.

### Windows App-Bound `v20`: no documented collector/export surface

**SOURCE-CONFIRMED / VERSION-SPECIFIC:** Chromium contains internal `DecryptAppBoundString` and an `AppBoundEncryptionProviderWin::GetKey`. The provider reads `os_crypt.app_bound_encrypted_key`, calls the browser's App-Bound service, and can persist re-encrypted wrapper data when service/key rotation requests it [S4–S5]. Chromium documents user and calling-application-path validation for App-Bound protection [S17]. Unit/browser tests exercise these internal paths, but that is **UPSTREAM-TESTED**, not a supported third-party API [S18].

No Chromium or Microsoft first-party documentation found an authorized external API that (1) exports the `v20` 32-byte row key or (2) accepts the browser wrapper and unwraps it for a separate forensic collector. **UNKNOWN-UNSUPPORTED.** Source visibility of internal C++/COM calls is not a public support contract, and this brief does not recommend imitating the browser identity/path or invoking internal service interfaces. Microsoft Edge's first-party policy can disable future App-Bound use for compatibility after restart, but it does not export an existing key or make existing `v20` rows portable [S19]. Third-party tools may claim live success; those claims are unverified here and cannot support product planning.

## Operator and custody costs

| Cost | Required control |
|---|---|
| Derived browser key is a compact decryption capability | Separate sealed secret object; envelope encryption; dual-control or case-role ACL; no report/log inclusion; case-scoped fingerprint; retention/destruction event |
| Provider secret can derive the key and may be reusable across profiles/rows | Prefer retaining only the derived key after verified derivation unless authorization/evidentiary need specifically covers provider secret; zero provider-secret buffers |
| Whole Keychain/keyring/wallet/DPAPI evidence contains unrelated secrets | Separate scope approval; exhaustive manifest and encryption; restricted reviewers; never attach to ordinary export; allow “not copied—scope restricted” |
| Live prompts alter user-visible/session state | Record prompt text/result and pre/post lock state; never choose persistent grants; abort on cancel/deny |
| Audit/log side effects | Preserve known DPAPI 4695 evidence when available; label all other platform/provider audit claims **UNKNOWN-UNSUPPORTED** |
| CBC output on macOS/Linux is not authenticated | Store `cryptographic_authentication=false`; validate/corroborate as specified by #144; never label successful padding as authenticated |
| Windows `v10` GCM rows authenticate | Record tag success/failure and ciphertext provenance; no plaintext on failure |
| Live store can change concurrently | Snapshot/hash relevant artifacts as close to read as permitted; record browser/provider process state and acquisition interval; do not promise atomicity without measurement |

## Copied-store conclusion (#146/#147/#149)

Live capture changes priority, not necessity.

1. **New live machine with cooperative user and successful supported read:** copied-store recovery becomes a secondary fallback and independent provenance path. The sealed derived key can make analysis immediately portable. **INFERRED.** Still preserve authorized relevant artifacts because key validation can fail, selectors/providers can be misclassified, and later review may challenge acquisition.
2. **Old image or powered-off source:** no live session exists; copied-store research remains the only store-based path. Live capture contributes nothing retroactively.
3. **Third-party acquisition bundle:** it may contain a supplied key, provider secret, store files, or none. Validate manifest/provenance and classify each independently; a third-party “key recovered” assertion is not first-party proof.
4. **Failed, declined, or unavailable unlock:** preserve failure stage/result, lock state, provider identity and authorized artifacts; copied-store tickets remain necessary. Do not escalate to unsupported access.
5. **Historical or rotated state:** a live current item may not decrypt old rows. Copied stores/backups may preserve older evidence; live success does not prove historical completeness.

Accordingly, #146 (macOS Keychain), #147 (KWallet), and #149 (GNOME Keyring) should remain scheduled but can be sequenced after targeted live capture characterization. Their exact file names were not present in this worktree and are referenced by issue number only.

## Windows v20 conclusion relative to #141

#141's local brief was not present in this worktree, so its conclusion is addressed from the issue statement and pinned primary sources rather than quoted. The result is unchanged:

* **Public first-party support:** Chromium documents an internal browser App-Bound interface with user/application-path binding; Microsoft documents Edge policy, not key export [S4–S5, S17, S19].
* **External authorized collector API:** none found. **UNKNOWN-UNSUPPORTED.** There is no documented export of the 32-byte `v20` row key and no documented “unwrap for this external collector” service call.
* **Known row key:** if an independently supplied, authorized, provenance-complete 32-byte key is already known, ordinary AES-256-GCM row decryption is established context. That does not validate how the key was acquired and does not create a live capture path.
* **Third-party claims:** explicitly unverified and excluded from recommendations.
* **Mutation warning:** invoking Chromium's internal provider is not a read-only collector design; the provider can re-encrypt and rewrite its Local State pref [S4].

## Needs a Cua VM measurement ticket

Use fixture/characterization data only, never case data. macOS and Linux use local Apple-Silicon Cua VMs; Windows uses Cua cloud. Every ticket records OS/provider/browser versions, disposable known plaintext, full pre/post filesystem/registry/log snapshots, prompt video/text, API return codes, lock state, sealed fixture key, positive and negative controls, and a falsifier. No ticket may test process memory or bypass behavior.

1. **macOS targeted Safe Storage read and ACL.** Measurement: with M151 Chrome and Chromium, test already-unlocked versus locked login keychain; correct explicit keychain password versus OS UI; trusted caller, Allow Once, Deny/cancel; account/keychain password divergence. Diff Keychain files, preferences, unified logs and ACL before/after. **Falsifier:** any successful supported read requires persistent ACL modification, browser launch, item creation, or undocumented privilege; then live support remains `UNKNOWN-UNSUPPORTED` for that variant.
2. **macOS keychain read side effects and session boundary.** Measurement: repeat exact `SecItemCopyMatching`/first-party `security` reads in logged-in GUI and authorized non-GUI sessions, measuring file metadata/content and logs. **Falsifier:** reproducible unexplained store mutation or success only through an interface outside public documentation.
3. **GNOME Secret Service/GNOME Keyring.** Measurement: real GNOME desktop, locked/unlocked login and non-login collections, PAM auto-unlock, independent collection password, provider prompt, exact existing item lookup, D-Bus session teardown. Diff keyring files/logs and record whether unlock is global, collection-wide, or client-local. **Falsifier:** lookup creates/updates an item, requires Chrome execution, cannot bind to affected user's session without unsupported mechanism, or silently changes persistent store.
4. **Secret Service provider variance.** Measurement: GNOME Keyring plus at least one KDE Secret Service bridge; establish provider identity, item selector, locked state and backing artifacts. **Falsifier:** collector cannot deterministically identify backend/item or an exact read resolves different matching items across runs.
5. **KWallet password wallet.** Measurement: KWallet5/6 direct and current Secret Service bridge, already-open/closed wallet, application consent, correct/wrong password, exact folder/key; snapshot `.kwl`, config and logs before open/read/close. **Falsifier:** read-only lifecycle triggers content mutation, migration, ambiguous provider selection, or cannot avoid automatic sync effects.
6. **KWallet GPG wallet/agent.** Measurement: cold and warm `gpg-agent`, pinentry, correct/wrong passphrase, software and lab hardware-backed key where available; record which first-party UI appears and whether wallet closes cleanly. **Falsifier:** prerequisites cannot be stated deterministically, read requires acquiring unrelated GPG private material, or state/cache mutation cannot be bounded.
7. **Windows DPAPI `v10` live capture.** Measurement in Cua cloud: local and domain users, loaded/unloaded profile, direct current-user run and documented service/impersonation variants, correct-origin versus copied machine. Enable/disable Audit DPAPI Activity and preserve event 4695; diff user DPAPI files, registry, Local State and event logs. **Falsifier:** correct current-user/origin context cannot reliably unwrap, key length/row GCM validation fails, or a necessary undocumented context cannot be productized.
8. **Windows DPAPI collection atomicity.** Measurement: browser closed/running while copying Local State and databases before/after successful unwrap; characterize locks and race evidence without modifying browser data. **Falsifier:** collector cannot obtain a coherent, hashed wrapper/database set through supported file APIs and documented snapshot facilities.
9. **Windows App-Bound public-surface watch ticket (not an unwrap experiment).** Measurement: review pinned Chromium/Edge public docs and exported SDK/type-library documentation at each supported release; observe only documented browser behavior and Local State mutation in a disposable VM. **Falsifier of current conclusion:** Chromium or Microsoft publishes a supported external authorized key-export/unwrap API with an explicit third-party caller contract. Internal source symbols, tests, or third-party success do not falsify it.
10. **Custody/zeroization characterization.** Measurement on all platforms: verify secret envelope creation, no raw key in stdout/stderr/crash/telemetry/swap artifacts within the test boundary, case-scoped fingerprints, retention and destruction audit. **Falsifier:** raw key or provider secret appears outside the sealed secret channel.

## Limitations and residual risks

1. No live Cua desktop measurement was run. Prompt behavior, non-mutation, exact session constraints, race behavior and store-version variance remain unproved.
2. Apple and Linux first-party APIs document retrieval and prompting but not a complete forensic audit/non-mutation contract. Those claims remain **UNKNOWN-UNSUPPORTED**.
3. KWallet is in active architectural transition toward Secret Service; API name does not establish persistence backend [S16].
4. A currently recovered key may not cover historical rows after provider secret loss/rotation.
5. Whole-store preservation can exceed authorization and capture unrelated credentials. The product must support narrower evidence plus an explicit scope-restricted result.
6. DPAPI event 4695 depends on auditable input and audit policy; absence of an event is not proof no call occurred [S14].
7. The requested #141, #146, #147 and #149 research files were not present under the stated names in this worktree. Conclusions were therefore not silently filled from unavailable prose.
8. No public first-party App-Bound external collector/export contract was found. Future vendor documentation could change this; until then `v20` live capture remains **UNKNOWN-UNSUPPORTED**.

## Numbered sources

1. **[S1] Chromium M151 `28a7…`, macOS Keychain provider**, `components/os_crypt/async/browser/keychain_key_provider.mm` and `components/os_crypt/common/keychain_password_mac.mm` (symbols `KeychainKeyProvider::GetKey`, `KeychainPassword::GetPassword`; exact branding selectors/KDF): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/keychain_key_provider.mm>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/common/keychain_password_mac.mm>.
2. **[S2] Chromium M151 `28a7…`, Linux provider**, `components/os_crypt/async/browser/freedesktop_secret_key_provider.cc` (symbols `FreedesktopSecretKeyProvider`, Secret Service/KWallet read/create paths and KDF): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc>.
3. **[S3] Chromium M151 `28a7…`, Windows DPAPI**, `components/os_crypt/async/browser/dpapi_key_provider.cc` and `components/os_crypt/async/browser/os_crypt_win.cc` (symbols `DPAPIKeyProvider::GetKey`, `CryptUnprotectData`, `CryptProtectData`; `DPAPI` wrapper, audit flag, key length): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/dpapi_key_provider.cc>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/os_crypt_win.cc>.
4. **[S4] Chromium M151 `28a7…`, App-Bound provider**, `chrome/browser/os_crypt/app_bound_encryption_provider_win.cc` (symbols `AppBoundEncryptionProviderWin::GetKey`, `HandleEncryptedKey`, `StoreKey`; retrieve/decrypt/re-encrypt/pref-write behavior): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/os_crypt/app_bound_encryption_provider_win.cc>.
5. **[S5] Chromium M151 `28a7…`, App-Bound interface**, `chrome/browser/os_crypt/app_bound_encryption_win.h` (symbols `EncryptAppBoundString`, `DecryptAppBoundString`, test override): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/os_crypt/app_bound_encryption_win.h>.
6. **[S6] Apple Developer**, `SecItemCopyMatching` (search/copy and `kSecMatchSearchList`): <https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)>.
7. **[S7] Apple Developer**, macOS Keychain ACL behavior: untrusted application prompt and persistent trust change: <https://developer.apple.com/documentation/security/access-control-lists>.
8. **[S8] Apple Developer**, `SecKeychainUnlock` (password or Unlock Keychain dialog; cancellation/authentication/interaction results): <https://developer.apple.com/documentation/security/seckeychainunlock(_:_:_:_:)>.
9. **[S9] Apple OSS Security commit `db15acbe6a7f257a859ad9a3bb86097bfe0679d9`**, `SecurityTool/macOS/security.1`, `list-keychains`, `unlock-keychain`, `find-generic-password`: <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L221-L248>, <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L312-L320>, <https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/SecurityTool/macOS/security.1#L550-L558>.
10. **[S10] Apple Support**, “Allow apps to access your keychain” (Deny, Allow Once, Always Allow and access-control change): <https://support.apple.com/guide/mac-help/allow-apps-to-access-your-keychain-kychn002/mac>.
11. **[S11] freedesktop.org Secret Service API 0.2/latest**, sessions, locking/unlocking, prompts, `Unlock`, `GetSecrets`, and transfer/cache warning: <https://specifications.freedesktop.org/secret-service-spec/latest/>, <https://specifications.freedesktop.org/secret-service-spec/latest/org.freedesktop.Secret.Service.html>, <https://specifications.freedesktop.org/secret-service-spec/latest/unlocking.html>, <https://specifications.freedesktop.org/secret-service-spec/latest/prompts.html>, <https://specifications.freedesktop.org/secret-service-spec/latest/sessions.html>.
12. **[S12] GNOME libsecret first-party docs**, `secret_service_unlock_sync` and migration from libgnome-keyring (provider prompt; no password argument in modern unlock): <https://gnome.pages.gitlab.gnome.org/libsecret/method.Service.unlock_sync.html>, <https://gnome.pages.gitlab.gnome.org/libsecret/migrating-libgnome-keyring.html>.
13. **[S13] Microsoft Learn**, `CryptUnprotectData` and `ProtectedData.Unprotect` (same user/origin computer, current-user context/profile loading, integrity and zeroing): <https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata>, <https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.unprotect>.
14. **[S14] Microsoft Learn**, Audit DPAPI Activity and event 4695 (auditable unprotect attempt): <https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/auditing/audit-dpapi-activity>, <https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-10/security/threat-protection/auditing/event-4695>.
15. **[S15] KDE API**, `KWallet::Wallet` (symbols `openWallet`, `isOpen`, `setFolder`, `readPassword`, `sync`; prompts and automatic close sync): <https://api.kde.org/kwallet-wallet.html>.
16. **[S16] KDE KWallet first-party repository**, Secret Service bridge/migration architecture, commit `abf970c067fa465ae9b7b970600de08f035d00e2`, and KWallet PAM integration: <https://invent.kde.org/frameworks/kwallet/-/commit/abf970c067fa465ae9b7b970600de08f035d00e2>, <https://invent.kde.org/plasma/kwallet-pam>.
17. **[S17] Chromium App-Bound README**, user/application-path validation and protection-level contract: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/os_crypt/README.md>.
18. **[S18] Chromium M151 `28a7…` App-Bound tests**, internal provider/browser behavior only (**UPSTREAM-TESTED**): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/os_crypt/app_bound_encryption_provider_win_unittest.cc>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/chrome/browser/os_crypt/app_bound_encryption_win_browsertest.cc>.
19. **[S19] Microsoft Edge policy**, `ApplicationBoundEncryptionEnabled` (compatibility policy, restart required; no key export): <https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/applicationboundencryptionenabled>.
