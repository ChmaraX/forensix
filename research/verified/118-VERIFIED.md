# VERIFICATION REPORT — ForensiX v2 renewal (GitHub issue ChmaraX/forensix#118)

Companion to `/tmp/forensix-research/118-chrome-artifacts-today.md`. **Read alongside it, not
instead of it.** This document only records what was actually fetched and what it settles.

- **Method:** every claim below is backed by a URL that was fetched in this session and the
  specific code/text that settles it. Nothing here is recalled from memory.
- **Primary source:** the `chromium/chromium` GitHub mirror, fetched as plain text from
  `https://raw.githubusercontent.com/chromium/chromium/<ref>/<path>`.
  `<ref>` = `main` (HEAD) or a release tag (e.g. `130.0.6723.119`).
- **Milestone→version mapping** came from
  `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&milestone=<M>&num=1`.
  Tags used: M120 `120.0.6099.227`, M122 `122.0.6261.131`, M124 `124.0.6367.210`,
  M125 `125.0.6422.176`, M126 `126.0.6478.185`, M127 `127.0.6533.122`, M128 `128.0.6613.139`,
  M129 `129.0.6668.103`, M130 `130.0.6723.119`, M131 `131.0.6778.267`, M132 `132.0.6834.197`,
  M133 `133.0.6943.142`, M134 `134.0.6998.179`, M135 `135.0.7049.116`, M136 `136.0.7103.116`,
  M137 `137.0.7151.122`, M138 `138.0.7204.185`, M139 `139.0.7258.155`, M140 `140.0.7339.210`,
  M142 `142.0.7444.177`, M143 `143.0.7499.170`, M144 `144.0.7559.171`, M145 `145.0.7632.162`,
  M148 `148.0.7778.218`, M150 `150.0.7871.188`.
- **Range sanity check:** the mirror carries `153.0.7986.x` tags, so the brief's stated
  M120–M153 support window is consistent with what upstream currently has. CONFIRMED.

---

## VERDICT SUMMARY

| ID | Claim under test | Verdict |
|----|------------------|---------|
| V1 | Cookies vs Login Data moved to App-Bound on different milestones | **CORRECTED** — different milestones *and* Finch-staged. Cookies default v20 @ **M130**, Login Data default v20 @ **M133** |
| V2 | Windows HTTP cache is Simple Cache | **REFUTED** — Windows is **blockfile** across the whole range |
| V3 | Autofill address cutover is a single boundary | **CORRECTED** — three generations; the *current* cutover is WebDB v134 (M130), not the contact_info one |
| V4a | `sync.birthday` still a top-level pref | **CORRECTED** — top-level pref gone as of M138; value now nested in `sync.transport_data_per_account` |
| V4b | `sync.demographics.birth_year` is noised on disk | **REFUTED** — on-disk value is the **raw** server value; noise is applied only at UMA-report time. Offset pref lives in **Local State**, not profile Preferences |
| V5 | Cookie plaintext carries a domain binding | **CONFIRMED** — 32-byte raw SHA-256 of `host_key`, from cookie DB **v24** (M130) |
| V6 | `keywords` timestamps are Chrome µs | **CONFIRMED** |
| V7 | macOS uses per-credential Keychain items via `keychain_identifier` | **REFUTED** — that path is **iOS-only**; macOS `password_value` remains fully usable |
| V8 | Simple Cache hash byte order / `_dk_` grammar | **CONFIRMED** (little-endian) + grammar **CORRECTED** in detail |
| V9 | History Clusters tables may be dropped late in range | **CONFIRMED present** at HEAD; no drop migration exists |
| V10 | Per-milestone `meta.version` values | **CONFIRMED** with a full table (one brief value **CORRECTED**: Favicons) |
| V11 | `Shortcuts` has `swap_contents_and_description` | **REFUTED** — column does not exist |
| V12 | `card_number_encrypted` plaintext is UTF-16LE | **CONFIRMED** (+ now routed through OSCryptAsync) |

---

## V1 — App-Bound Encryption: Cookies vs Login Data

**Verdict: CORRECTED. Both of the brief's key instincts were right, and the exact numbers are now
pinned.**

### The mechanism (facts, not inference)

There is exactly **one** `OSCryptAsync` instance per browser process, and every consumer
(cookies, passwords, payments) draws its `Encryptor` from it.

`https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/browser_process_impl.cc`
(`PreMainMessageLoopRun`, ~L1542–1611):

```cpp
  std::vector<std::pair<size_t, std::unique_ptr<os_crypt_async::KeyProvider>>>
      providers;
#if BUILDFLAG(IS_WIN)
  providers.emplace_back(std::make_pair(
      /*precedence=*/10u,
      std::make_unique<os_crypt_async::DPAPIKeyProvider>(local_state())));

  providers.emplace_back(std::make_pair(
      // Note: 15 is chosen to be higher than the 10 precedence above for
      // DPAPI. ...
      /*precedence=*/15u,
      std::make_unique<os_crypt_async::AppBoundEncryptionProviderWin>(
          local_state(), /*force_protection_level=*/std::nullopt)));
#endif  // BUILDFLAG(IS_WIN)
  os_crypt_async_ =
      std::make_unique<os_crypt_async::OSCryptAsync>(std::move(providers));
```

Provider selection (`.../main/components/os_crypt/async/browser/os_crypt_async.cc`, L86–107):
the highest-precedence provider whose `UseForEncryption()` returns true becomes
`provider_for_encryption_`; **all** provider keys stay in the key ring for decryption.
This is exactly the "registry of prefix → provider" design the brief recommends — CONFIRMED as
the right model.

Tags:
- `.../main/chrome/browser/os_crypt/app_bound_encryption_provider_win.h` L50:
  `inline constexpr char kAppBoundDataPrefix[] = "v20";` — **"v20" CONFIRMED**.
- `.../main/components/os_crypt/async/browser/dpapi_key_provider.cc` L33:
  `constexpr char kKeyTag[] = "v10";`, L37
  `constexpr uint8_t kDPAPIKeyPrefix[] = {'D','A','P','I'...}` → literally
  `{'D', 'P', 'A', 'P', 'I'}`, read from the `Local State` pref
  `os_crypt.encrypted_key` (L29 `kOsCryptEncryptedKeyPrefName`). **"v10" CONFIRMED.**

Cookie wiring:
- `.../main/chrome/browser/net/system_network_context_manager.cc` L927–937:
  `AddCookieEncryptionManagerToNetworkContextParams` builds
  `CookieEncryptionProviderImpl(g_browser_process->os_crypt_async())`.
- `.../main/services/network/network_context.cc` L3395–3409: if
  `params_->cookie_encryption_provider` is set, the cookie store gets a
  `CookieOSCryptAsyncDelegate`.
- `.../main/services/network/public/cpp/cookie_encryption_provider_impl.cc` L17–24 calls
  `os_crypt_async_->GetInstance(...)` with **no** `Option`, i.e. **not**
  `kEncryptSyncCompat` → cookies get the default (app-bound-capable) encryptor.
  (`Option::kEncryptSyncCompat` exists — `.../130.0.6723.119/components/os_crypt/async/common/encryptor.h`
  L93–102 — but nothing in the cookie or password path requests it.)

### Cookies: when does "v20" become the default?

The app-bound provider is only *used for encryption* when a feature says so.

`chrome/browser/browser_features.cc`, `kUseAppBoundEncryptionProviderForEncryption`:

| Milestone | tag | default |
|---|---|---|
| M125 / M126 | — | feature does not exist; only `kRegisterAppBoundEncryptionProvider` (`FEATURE_DISABLED_BY_DEFAULT`), and the provider's encrypt path was `g_enable_encryption_for_testing` only (`.../125.0.6422.176/chrome/browser/os_crypt/app_bound_encryption_provider_win.cc` L39–42) |
| M127 | `127.0.6533.122` | `base::FEATURE_DISABLED_BY_DEFAULT` |
| M128 | `128.0.6613.139` | `base::FEATURE_DISABLED_BY_DEFAULT` |
| M129 | `129.0.6668.103` | `base::FEATURE_DISABLED_BY_DEFAULT` |
| **M130** | `130.0.6723.119` | **`base::FEATURE_ENABLED_BY_DEFAULT`** |
| M132 | `132.0.6834.197` | `base::FEATURE_ENABLED_BY_DEFAULT` |
| M134+ | — | feature removed; `browser_process_impl.cc` constructs the provider unconditionally |

At HEAD the only gate left is capability, not policy —
`.../main/chrome/browser/os_crypt/app_bound_encryption_provider_win.cc` L259–262:

```cpp
bool AppBoundEncryptionProviderWin::UseForEncryption() {
  return support_level_ == os_crypt::SupportLevel::kSupported;
}
```

`⇒ cookies_v20_from = 130` **as a code default**. M127–M129 were Finch-only.

Corroboration that M127 was the *rollout* start, not the code default:
`https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html`
— "In Chrome 127 we are introducing a new protection on Windows…", "We will be migrating each
type of secret to this new system **starting with cookies in Chrome 127**", and "In future
releases we intend to expand this protection to **passwords, payment data**, and other persistent
authentication tokens."

### Login Data: when does "v20" become the default?

Windows password encryption lives in a platform file, not `login_database.cc`.
`components/password_manager/core/browser/password_store/login_database_win.cc`
(path before ~M127: `components/password_manager/core/browser/login_database_win.cc`):

- **M120, M124, M127** — pure sync OSCrypt:
  ```cpp
  if (OSCrypt::EncryptString16(plain_text, cipher_text)) {
  ```
- **M128 → M142** — async encryptor *if supplied*, else sync fallback:
  ```cpp
  bool result = encryptor_
                    ? encryptor_->EncryptString16(plain_text, cipher_text)
                    : OSCrypt::EncryptString16(plain_text, cipher_text);
  ```
- **M145, HEAD** — sync fallback removed:
  ```cpp
  encryptor_ && encryptor_->EncryptString16(plain_text, cipher_text);
  ```

Whether `encryptor_` is non-null is a feature decision.
`.../130.0.6723.119/chrome/browser/password_manager/profile_password_store_factory.cc` L66–74:

```cpp
  os_crypt_async::OSCryptAsync* os_crypt_async =
      base::FeatureList::IsEnabled(
          password_manager::features::kUseAsyncOsCryptInLoginDatabase)
          ? g_browser_process->os_crypt_async()
          : nullptr;
```

`components/password_manager/core/browser/features/password_features.cc`,
`kUseAsyncOsCryptInLoginDatabase`:

| Milestone | default |
|---|---|
| M128, M130, M132 | `base::FEATURE_DISABLED_BY_DEFAULT` |
| **M133, M134, M135, M136** | **`base::FEATURE_ENABLED_BY_DEFAULT`** |
| M138, M140+ | flag removed from the file (always async) |

`⇒ logins_v20_from = 133` **as a code default**. M128–M132 were Finch-only.

### What this means for ForensiX v2 / issue #124

1. **The two artefacts did move on different milestones.** Cookies M130, Login Data M133 by
   default — a ~3-milestone band (M130, M131, M132) in which a Windows profile normally holds
   **v20 cookies and v10 passwords simultaneously**. Credential decryption in that band needs only
   the plain user-DPAPI path.
2. **The brief's third shape is the correct one.** In M127–M129 (cookies) and M128–M132 (logins)
   the behaviour was Finch-controlled, so **no version number predicts the prefix** in those bands.
   Even at HEAD it is capability-gated (`SupportLevel::kSupported`), so a non-system-level install
   or a broken elevation service still writes `v10`. **Per-row prefix dispatch with no version
   gating is the only correct implementation.** Use milestones for fixture labelling only.
3. **New, not in the brief:** payments went the same way. `Web Data`
   `credit_cards.card_number_encrypted` is now encrypted through `os_crypt_async::Encryptor`
   (`.../main/components/autofill/core/browser/webdata/payments/payments_autofill_table.cc`
   L255–272), so **card numbers are also `v20`-capable** on Windows and belong in the same
   decryptor registry.
4. Also new at HEAD: `BASE_FEATURE(kEncryptWithIsolatedState, base::FEATURE_ENABLED_BY_DEFAULT)`
   selects `PROTECTION_PATH_VALIDATION_WITH_ISOLATION` over `PROTECTION_PATH_VALIDATION`
   (same file, L60–70). This changes the elevation-service unwrap requirements for the newest
   profiles.

**STILL-UNKNOWN:** the actual Finch rollout percentages and dates per milestone. Not expressible
in source; would need variations config, which is not public. Treat M127–M132 as "mixed" and
detect per row.

**STILL-UNKNOWN:** whether existing `v10` rows are proactively re-encrypted to `v20`. A feature
named `kEncryptAllPasswordsWithOSCryptAsync` exists at M136
(`.../136.0.7103.116/components/password_manager/core/browser/features/password_features.cc` L174)
but its default and its migration behaviour were not read. Assume mixed-tag profiles either way —
that assumption is safe in both directions.

---

## V2 — Windows HTTP cache backend

**Verdict: REFUTED. Windows is blockfile, not Simple Cache, for the entire 120→153 range.
This is the largest correction in this report.**

The HTTP cache backend is chosen by `network_session_configurator::ChooseCacheType()`.

`.../120.0.6099.227/components/network_session_configurator/browser/network_session_configurator.cc`
(tail of `ChooseCacheType`, L796–809):

```cpp
#if BUILDFLAG(IS_ANDROID) || BUILDFLAG(IS_LINUX) || BUILDFLAG(IS_CHROMEOS) || \
    BUILDFLAG(IS_MAC)
  return net::URLRequestContextBuilder::HttpCacheParams::DISK_SIMPLE;
#else
  return net::URLRequestContextBuilder::HttpCacheParams::DISK_BLOCKFILE;
#endif
```

`.../main/net/disk_cache/backend_experiment.h`:

```cpp
constexpr bool IsSimpleBackendEnabledByDefaultPlatform() {
  return BUILDFLAG(IS_ANDROID) || BUILDFLAG(IS_LINUX) ||
         BUILDFLAG(IS_CHROMEOS) || BUILDFLAG(IS_MAC);
}
```

`.../main/components/network_session_configurator/browser/network_session_configurator.cc` L865–867:

```cpp
  return disk_cache::IsSimpleBackendEnabledByDefaultPlatform()
             ? net::URLRequestContextBuilder::HttpCacheParams::DISK_SIMPLE
             : net::URLRequestContextBuilder::HttpCacheParams::DISK_BLOCKFILE;
```

`BUILDFLAG(IS_WIN)` is absent from that list at **every** ref checked: M120, M124, M127, M130
(older `#if` form) and M134, M138, M142, M145, M150, `main` (helper form). The identical helper
body was read at each of those tags.

The only escape hatches, both off by default:
- `.../main/net/base/features.cc` L494:
  `BASE_FEATURE(kDiskCacheBackendExperiment, base::FEATURE_DISABLED_BY_DEFAULT);` with a
  `backend` param of `default|simple|blockfile`.
- Pre-M134 there was a legacy `SimpleCacheTrial` field trial (`"Disable"` / `"ExperimentYes"`
  prefixes) read at the top of M120's `ChooseCacheType`.

Secondary confirmation from `.../main/net/disk_cache/disk_cache.cc` L158–162 — when a caller
passes `CACHE_BACKEND_DEFAULT`, Simple is only the default on Android/Fuchsia:

```cpp
#if BUILDFLAG(IS_ANDROID) || BUILDFLAG(IS_FUCHSIA)
  static const bool kSimpleBackendIsDefault = true;
#else
  static const bool kSimpleBackendIsDefault = false;
#endif
```

### Consequences for v2 — these are expensive

- **§4 of the brief (Simple Cache on-disk format) does not apply to Windows**, the most common
  evidence platform. A Windows `Cache_Data` directory will contain `data_0`–`data_3` +
  `f_######` files, not `<16-hex>_0`.
- v2 needs **two** cache readers: blockfile (Windows) and Simple (macOS, Linux, ChromeOS,
  Android). This is a distinct, sizeable work item that the brief costed at zero.
- The empirical check the brief proposed remains the right runtime discriminator: detect by
  directory listing shape, not by platform string.
- **Third backend on the horizon:** a SQL backend exists behind
  `BUILDFLAG(ENABLE_DISK_CACHE_SQL_BACKEND)` with `DiskCacheBackend::kSql`
  (`.../main/net/base/features.cc` L500–511, `.../main/net/disk_cache/backend_experiment.h`).
  It is buildflag-gated, so not present in release builds today, but v2's cache-format detector
  should fail loudly rather than silently on an unrecognised layout.

**STILL-UNKNOWN:** the blockfile on-disk format details (index header, rankings, allocation
bitmap, `f_` external files). Not researched here — the brief contains no blockfile section and
one is now required.

---

## V3 — Autofill address storage

**Verdict: CORRECTED. There are three generations, and the brief targeted the wrong boundary.**

`.../main/components/autofill/core/browser/webdata/addresses/address_autofill_table.cc`,
`MigrateToVersion` dispatch (L591–651) — the full address-relevant migration list:

```
 88 AddNewNameColumns
 90 AddNewStructuredAddressColumns
 91 AddMoreStructuredAddressColumns
 92 AddNewPrefixedNameColumn
 93 AddAutofillProfileLabelColumn
 96 AddAutofillProfileDisallowConfirmableMergesColumn
 99 RemoveAutofillProfilesTrashTable
100 RemoveProfileValidityBitfieldColumn
102 AddAutofillBirthdatesTable
107 AddContactInfoTables
110 AddInitialCreatorIdAndLastModifierId
113 MigrateLocalAddressProfilesToNewTable
114 DropLegacyAddressTables
117 AddProfileObservationColumn
121 DropServerAddressTables
132 AddAdditionalLastUseDateColumns
134 UnifyLocalAndAccountAddressStorage
145 DropMultipleUseDates
```

Table-name constants in the same file:

```cpp
constexpr std::string_view kAddressesTable = "addresses";              // L50
constexpr std::string_view kAddressTypeTokensTable = "address_type_tokens"; // L60

// Before the `kAddressesTable` and `kAddressTypeTokensTable` tables, local and
// account addresses were stored separately.
constexpr std::string_view kContactInfoTable = "contact_info";              // L69
constexpr std::string_view kLocalAddressesTable = "local_addresses";        // L70
constexpr std::string_view kContactInfoTypeTokensTable = "contact_info_type_tokens";
constexpr std::string_view kLocalAddressesTypeTokensTable = "local_addresses_type_tokens";

// Historically, a different schema was used and addresses were stored in a set
// of tables named autofill_profiles*. These tables are no longer used in
// production and only referenced in the migration logic. Do not add to them.
constexpr std::string_view kAutofillProfilesTable = "autofill_profiles";    // L80
```

`addresses` columns (L50–58): `guid`, `record_type`, `use_count`, `use_date`, `date_modified`,
`language_code`, `label`, `initial_creator_id`.
`address_type_tokens` columns (L60–65): `guid`, `type`, `value`, `verification_status`,
`observations`.

### Mapping WebDB versions to milestones

`WebDatabase::kCurrentVersionNumber` (in `web_database.cc` up to M122, then `web_database.h`):

| Milestone | WebDB version |
|---|---|
| M120 | 120 |
| M122 | 123 |
| M124 | 127 |
| M126 | 128 |
| M128 | 130 |
| **M130** | **134** |
| M132 | 135 |
| M134 | 137 |
| M136 | 138 |
| M138 | 141 |
| M140 | 141 |
| M142 | 145 |
| M145 | 147 |
| M148 | 151 |
| M150 | 152 |
| HEAD | 153 |

Therefore, for the supported range:

- **Legacy `autofill_profiles` + `autofill_profile_{names,emails,phones,addresses,birthdates}`
  are already gone.** They were dropped at WebDB v114, and M120 already ships v114+ (v120).
  So within 120→153 you will **never** see them in a live-migrated profile. The brief's
  "read both and merge" recovery idea only applies to profiles that were abandoned before
  M~118 and never opened since. Keep it as best-effort recovery, not a primary path.
- **M120 → M129: `contact_info` + `local_addresses` (+ `*_type_tokens`).**
- **M130 → M153: `addresses` + `address_type_tokens`** (single unified table, WebDB v134).

The brief's "detect by table presence, not version" advice is **CONFIRMED as correct** and is now
strictly necessary — there are three shapes, not two.

`.../main/components/webdata/common/web_database.h`: `kCurrentVersionNumber = 153`,
`kDeprecatedVersionNumber = 82`; `.../main/components/webdata/common/web_database.cc` L60:
`kCompatibleVersionNumber = 151`.

---

## V4a — `sync.birthday`

**Verdict: CORRECTED.**

`components/sync/service/glue/sync_transport_data_prefs.cc` (note: the path is
`.../service/glue/...`, not `.../service/...`).

At **M120** (`.../120.0.6099.227/...`) it is a **top-level string pref**:

```cpp
const char kSyncCacheGuid[] = "sync.cache_guid";
const char kSyncBirthday[] = "sync.birthday";
const char kSyncBagOfChips[] = "sync.bag_of_chips";
...
  registry->RegisterStringPref(kSyncBirthday, std::string());
```

At **HEAD** the same string is a **key inside a per-account dictionary**:

```cpp
// Keys for the `kSyncTransportDataPerAccount` dictionary pref:
const char kSyncCacheGuid[] = "sync.cache_guid";
const char kSyncBirthday[] = "sync.birthday";
const char kSyncBagOfChips[] = "sync.bag_of_chips";
// 64-bit integer serialization of the base::Time when the last sync occurred.
const char kSyncLastSyncedTime[] = "sync.last_synced_time";
// 64-bit integer serialization of the base::Time of the last sync poll.
const char kSyncLastPollTime[] = "sync.last_poll_time";
```

with accessors keyed by a gaia-ID hash:

```cpp
std::string SyncTransportDataPrefs::GetBirthday() const {
  const base::Value* value = GetAccountKeyedPrefDictEntry(
      pref_service_, prefs::internal::kSyncTransportDataPerAccount,
      gaia_id_hash_, kSyncBirthday);
```

The container pref is declared in `.../main/components/sync/base/pref_names.h`:

```cpp
// Dict specifying the sync transport data (e.g. cache GUID, birthday, etc) per
// account.
inline constexpr char kSyncTransportDataPerAccount[] =
    "sync.transport_data_per_account";
```

Transition, measured by presence of `RegisterStringPref(kSyncBirthday`:

| Milestone | top-level `sync.birthday` pref | `sync.transport_data_per_account` present |
|---|---|---|
| M120, M124 | yes | no |
| M128, M132, M136, **M137** | yes | yes |
| **M138**, M139, M140, M145, M150, HEAD | **no** | yes |

`present_in_preferences = true` for **M120–M137** (flat key `sync.birthday`), and
`false` for **M138+**, where the value must be read from
`sync.transport_data_per_account.<gaia-id-hash>["sync.birthday"]`.
It did **not** move into a LevelDB store, contrary to the brief's alternative hypothesis.

The brief's warning is CONFIRMED by the surrounding code: this is the **sync store birthday**
(an opaque server-issued token used for datatype-change detection), set via
`SyncTransportDataPrefs::SetBirthday(const std::string& birthday)`. It is **not** a date of birth.
v2 must not label it as one.

---

## V4b — `sync.demographics`

**Verdict: REFUTED on the point that mattered most — but in the direction that makes the field
*more* sensitive, not less.**

`.../main/components/metrics/demographics/user_demographics.h`:

```cpp
#if !BUILDFLAG(IS_CHROMEOS)
inline constexpr char kSyncDemographicsPrefName[] = "sync.demographics";
#else
inline constexpr char kSyncOsDemographicsPrefName[] = "sync.os_demographics";
inline constexpr char kSyncDemographicsPrefName[] = "sync.demographics";
#endif

// Stores a "secret" offset that is used to randomize the birth year for metrics
// reporting. This value should not be logged to UMA directly; instead, it
// should be summed with the kSyncDemographicsBirthYear. ...
inline constexpr char kUserDemographicsBirthYearOffsetPrefName[] =
    "demographics_birth_year_offset";
// TODO(crbug.com/40240008): Delete after 2023/09
inline constexpr char kDeprecatedDemographicsBirthYearOffsetPrefName[] =
    "sync.demographics_birth_year_offset";

// These are not prefs, they are paths inside of kSyncDemographics.
inline constexpr char kSyncDemographicsBirthYearPath[] = "birth_year";
inline constexpr char kSyncDemographicsGenderPath[] = "gender";
```

Constants (same file): `kUserDemographicsBirthYearNoiseOffsetRange = 2` (offsets −2..+2),
`kUserDemographicsBirthYearNoiseOffsetDefaultValue = 100` (sentinel for "not yet generated"),
`kUserDemographicsMinAgeInYears = 20`, `kUserDemographicsMaxAgeInYears = 85`,
gender encoded as `UserDemographicsProto_Gender`.

**`present = true`.** Both `sync.demographics` (dict with `birth_year`, `gender`) and — on
ChromeOS only — `sync.os_demographics` exist at HEAD.

### The correction that matters

`.../main/components/metrics/demographics/user_demographics.cc`, L52–64 and L205–255:

```cpp
int GetBirthYearOffset(PrefService* local_state) {
  int offset =
      local_state->GetInteger(kUserDemographicsBirthYearOffsetPrefName);
  ...
}
...
UserDemographicsResult GetUserNoisedBirthYearAndGenderFromPrefs(
    base::Time now, PrefService* local_state, PrefService* profile_prefs) {
  const base::DictValue& demographics = GetDemographicsDict(profile_prefs);
  std::optional<int> birth_year = GetUserBirthYear(demographics);
  ...
  profile_prefs->ClearPref(kDeprecatedDemographicsBirthYearOffsetPrefName);
  int offset = GetBirthYearOffset(local_state);
  ...
  user_demographics.birth_year = *birth_year + offset;
```

Two things follow, both contradicting the brief:

1. **The on-disk `sync.demographics.birth_year` is the RAW, un-noised value** supplied by the
   sync server (the header comment says it "stores the self-reported birth year of the syncing
   user, as provided by the sync server"). Noise is added **only** in the UMA reporting call, into
   an in-memory struct. **Reading the dict yields the user's true self-reported birth year.**
   The brief's stated correctness landmine ("reading the dict alone yields a wrong year") is
   **REFUTED** — the risk is inverted. This is a *privacy* consideration for ForensiX, not an
   accuracy one. v2 should still label the provenance ("self-reported to Google, synced") and
   should default to redaction on the same footing as credentials.
2. **The offset pref is NOT a sibling key in the profile's `Preferences`.** It is
   `demographics_birth_year_offset` in **`Local State`** (user-data-dir level, `local_state`
   `PrefService`). The sibling key the brief expected — `sync.demographics_birth_year_offset` —
   is the *deprecated* one, and HEAD actively calls `ClearPref` on it (comment: "ClearPref() call
   added 2025/12"), so it will be absent from freshly-touched profiles.

The brief's implementation recommendation (optional, best-effort, never a required field) stands
and is still the right call.

---

## V5 — Cookie plaintext domain binding

**Verdict: CONFIRMED — shape (ii), `sha256-32bytes`. Version pinned.**

`.../main/net/extras/sqlite/sqlite_persistent_cookie_store.cc`.

Schema comment, L213:

```
// Version 24 adds a SHA256 hash of the domain value to front of the the
// encrypted_value.
```

Write path (`AddCookieToBatch`-side, L1350–1352):

```cpp
            if (!crypto_->EncryptString(
                    base::StrCat({crypto::SHA256HashString(po->cc().Domain()),
```

Read path (L1036–1049):

```cpp
      bool decrypt_ok = crypto_->DecryptString(encrypted_value, &value);
      ...
      std::string correct_hash = crypto::SHA256HashString(domain);
      if (!base::StartsWith(value, correct_hash,
                            base::CompareCase::SENSITIVE)) {
        RecordCookieLoadProblem(CookieLoadProblem::kHashFailed);
        ok = false;
        continue;
      }
      value = value.substr(correct_hash.length());
```

Migration path (v23→v24, the `if (cur_version == 23)` block at L1124, re-encrypt loop L1171–1174)
does the same `StrCat({crypto::SHA256HashString(domain), decrypted_value})`.

**Answers:**
- `prefix_kind = "sha256-32bytes"` — the **raw 32-byte binary digest** of the `host_key` column
  value (`crypto::SHA256HashString`, not hex), prepended to the plaintext **before** encryption.
- It is a property of the **plaintext layer**, sitting *inside* whatever `v10`/`v20` envelope the
  crypto delegate produces. It therefore applies to **both** `v10` and `v20` values, and the
  discriminator is the **cookie DB `meta.version`, not the value prefix**.
- Cookie DB `kCurrentVersionNumber` by milestone: M120=**19**, M124=**21**, M127=**23**,
  M128=**23**, M129=**23**, **M130=24**, and 24 at M132/134/136/138/142/148 and HEAD.
  `⇒ strip the 32-byte prefix iff cookies meta.version >= 24, i.e. M130+.`
- Note the coincidence worth writing into the fixture matrix: **M130 is simultaneously the
  cookies-v20 default flip, the cookie DB v24 domain-binding, and the Web Data v134 address
  unification.** M130 is the single most important fixture boundary in the range.

Also captured while here (`.../main/.../sqlite_persistent_cookie_store.cc` L1019–1029): a row with
**both** `value` and `encrypted_value` non-empty is treated as corrupt
(`kValuesExistInBothEncryptedAndPlaintext`) and skipped by Chrome. A forensic tool should surface
both rather than skip. An empty `encrypted_value` with a non-empty `value` is a legitimate
legacy-plaintext row — the brief's "absent tag means plaintext" is consistent with this.

---

## V6 — `keywords` timestamp epoch

**Verdict: CONFIRMED — Chrome microseconds since the Windows epoch (1601-01-01).**

`.../main/components/search_engines/keyword_table.cc` binds and reads these columns with the
typed `base::Time` helpers, not raw ints:

```
L633:  data.date_created = s.ColumnTime(7);
L634:  data.last_modified = s.ColumnTime(13);
L659:  data.last_visited = s.ColumnTime(21);
L748:  s->BindTime(starting_column + 6, data.date_created);
L755:  s->BindTime(starting_column + 12, data.last_modified);
L763:  s->BindTime(starting_column + 20, data.last_visited);
```

`.../main/sql/statement.cc` L529–535 settles the encoding:

```cpp
base::Time Statement::ColumnTime(int column_index) {
  ...
  int64_t int_value = sqlite3_column_int64(ref_->stmt(), column_index);
  return base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(int_value));
}
```

(`BindTime` at L300–316 is the symmetric `TimeToSqlValue(val)` → `sqlite3_bind_int64`.)

So: 17-digit values in the `13...` range, decoded as `1601-01-01 + microseconds`. **Not** Unix
seconds. The brief's lean was right.

---

## V7 — macOS `logins.keychain_identifier`

**Verdict: REFUTED. The per-credential Keychain path is iOS-only. macOS credential recovery is
NOT blocked.**

`.../main/components/password_manager/core/browser/password_store/login_database.cc`:

Column origin (L568–575) — note the stated reason:

```cpp
  // Version 39.
  // Adding keychain identifier where the password is stored. It's the same as
  // password_value column before this version. This column is needed to support
  // Credential Provider on iOS.
  builders.logins->AddColumn("keychain_identifier", "BLOB");
  SealVersion(builders, /*expected_version=*/39u);
```

All Keychain-item machinery is inside `#if BUILDFLAG(IS_IOS)`:

- L729 `#if BUILDFLAG(IS_IOS)` opens the block containing `DeletePassword`, `UpdatePassword`
  and `MigrateToOSCrypt` (which calls `GetTextFromKeychainIdentifier`).
- L894 `#if BUILDFLAG(IS_IOS)` guards the `current_version < 39` migration
  (`UPDATE logins SET keychain_identifier = password_value`, then `MigrateToOSCrypt`).
- `AddLogin` (L1354–1381):
  ```cpp
  #if BUILDFLAG(IS_IOS)
    bool has_encrypted_password =
        !cred.keychain_identifier.empty() && cred.password_value.empty();
    ...
  #else
    CHECK(cred.keychain_identifier.empty());
  #endif  // BUILDFLAG(IS_IOS)
  ```

And macOS's own encryption file,
`.../main/components/password_manager/core/browser/password_store/login_database_mac.cc`,
is the whole file — nothing but OSCryptAsync:

```cpp
EncryptionResult LoginDatabase::EncryptedString(
    const std::u16string& plain_text,
    std::string* cipher_text) const {
  return encryptor_ && encryptor_->EncryptString16(plain_text, cipher_text)
             ? EncryptionResult::kSuccess
             : EncryptionResult::kServiceFailure;
}
```

**Answer: `password_value_still_usable = true` on macOS.** The `keychain_identifier` **column**
exists in the schema on every platform from login DB v39 onward (it is a generic
`SQLTableBuilder` column), but on macOS it is asserted empty. A non-empty `keychain_identifier`
in evidence therefore indicates an **iOS** `Login Data` file, which is a useful platform
discriminator for v2.

macOS credential recovery still needs the `Chrome Safe Storage` Keychain password to derive the
OSCrypt key — that part of the brief (§3.3) was **not** re-verified in this session and remains
as the brief states it. See "Not verified" below.

---

## V8 — Simple Cache hash byte order and cache-key grammar

**Verdict: CONFIRMED (byte order exactly as predicted); grammar CORRECTED in detail.**

`.../main/net/disk_cache/simple/simple_util.cc`:

```cpp
uint64_t GetEntryHashKey(const std::string& key) {
  base::SHA1Digest sha_hash = base::SHA1Hash(base::as_byte_span(key));
  return base::U64FromLittleEndian(base::span(sha_hash).first<8u>());
}

std::string ConvertEntryHashKeyToHexString(uint64_t hash_key) {
  std::string hash_key_str = base::StringPrintf("%016" PRIx64, hash_key);
  ...
}

std::string GetFilenameFromEntryFileKeyAndFileIndex(
    const SimpleFileTracker::EntryFileKey& key, int file_index) {
  if (key.doom_generation == 0)
    return base::StringPrintf("%016" PRIx64 "_%1d", key.entry_hash, file_index);
  else
    return base::StringPrintf("todelete_%016" PRIx64 "_%1d_%" PRIu64,
                              key.entry_hash, file_index, key.doom_generation);
}

std::string GetSparseFilenameFromEntryFileKey(...) {
  ... "%016" PRIx64 "_s" ... / "todelete_%016" PRIx64 "_s_%" PRIu64 ...
}
```

- **Byte order: little-endian load of the first 8 SHA-1 bytes**, then printed big-endian by
  `%016PRIx64`. So the 16-hex filename is the **reverse** of the first 8 raw SHA-1 bytes.
  Exactly as the brief predicted. **CONFIRMED.**
- Filename forms to expect in evidence: `<16hex>_0`, `<16hex>_1`, `<16hex>_s` (sparse), and
  doomed-but-not-yet-deleted `todelete_<16hex>_<index>_<generation>`. The `todelete_` form is
  **not in the brief** and is forensically valuable (recently-doomed entries).
- Reverse direction exists too: `GetEntryHashKeyFromHexString` uses
  `base::HexStringToUInt64`, so a filename → hash check is exact.

### Cache key grammar — CORRECTED

`.../main/net/http/http_cache.cc`:

```cpp
const char HttpCache::kDoubleKeyPrefix[] = "_dk_";                    // L115
const char HttpCache::kDoubleKeySeparator[] = " ";                    // L116
const char HttpCache::kSubframeDocumentResourcePrefix[] = "s_";       // L117
const char HttpCache::kCrossSiteMainFrameNavigationPrefix[] = "cn_";  // L118
```

`HttpCache::GenerateCacheKey` (L833–893):

```cpp
  const char credential_key = (base::FeatureList::IsEnabled(
                                   features::kSplitCacheByIncludeCredentials) &&
                               (load_flags & LOAD_DO_NOT_SAVE_COOKIES))
                                  ? '0'
                                  : '1';
  ...
    isolation_key = base::StrCat(
        {kDoubleKeyPrefix, subframe_document_resource_prefix,
         is_cross_site_main_frame_navigation_prefix,
         *network_isolation_key.ToCacheKeyString(), kDoubleKeySeparator});
  ...
  // The key format is:
  // credential_key/upload_data_identifier/[isolation_key]url
  return base::StringPrintf(
      "%c/%" PRId64 "/%s%s", credential_key, upload_data_identifier,
      isolation_key.c_str(),
      include_url ? HttpUtil::SpecForRequest(url).c_str() : "");
```

So the full grammar is:

```
<credential_char> "/" <upload_data_identifier> "/"
  [ "_dk_" [ "s_" ] [ "cn_" ] <NIK cache key string> " " ]
  <url>
```

- `credential_char` is `'1'` normally, `'0'` only when `SplitCacheByIncludeCredentials` is on and
  the request carries `LOAD_DO_NOT_SAVE_COOKIES`. The brief's guessed `"1/0/"` prefix is really
  `<credential_char>/<upload_data_identifier>/`, which is `1/0/` in the overwhelmingly common
  case (no upload body). **CORRECTED but practically compatible.**
- `s_` (subframe document resource) and `cn_` (cross-site main-frame navigation) are additional
  prefixes the brief did not have.
- The separator is a single **space**, and parsing uses `rfind` because two spaces can occur
  (`.../main/net/http/http_cache.cc` L802–818).

The brief's practical mitigation — **read the key out of the `_0` file's stream-0 footer rather
than synthesising it** — is still the right implementation, and is now the *only* robust one
given `cn_`/`s_` and the credential character.

---

## V9 — History Clusters / Journeys table lifecycle

**Verdict: CONFIRMED present. `tables_present_at_M153 = true`.**

`.../main/components/history/core/browser/visit_annotations_database.cc` creates, at HEAD:
`content_annotations` (L196), `context_annotations` (L215), `cluster_keywords` (L243),
`cluster_visit_duplicates` (L261), plus `clusters` and `clusters_and_visits` (referenced by the
insert statements at L555–564 and by the drop helper).

A drop helper exists but is a full-teardown utility, not a migration:

```cpp
bool VisitAnnotationsDatabase::DropVisitAnnotationsTables() {
  // Dropping the tables will implicitly delete the indices.
  return GetDB().Execute("DROP TABLE content_annotations") &&
         GetDB().Execute("DROP TABLE context_annotations") &&
         GetDB().Execute("DROP TABLE clusters") &&
         GetDB().Execute("DROP TABLE clusters_and_visits") &&
         GetDB().Execute("DROP TABLE cluster_keywords") &&
         GetDB().Execute("DROP TABLE cluster_visit_duplicates");
}
```

`.../main/components/history/core/browser/history_database.cc` migration chain ends at:

```cpp
  if (cur_version == 69) {
    // The android_urls table's stopped being read in 91.0.4438.0. Delete it if
    // it still exists.
#if BUILDFLAG(IS_ANDROID)
    if (!DropAndroidUrlsTable()) {
```

i.e. the last migration (69→70) drops `android_urls` on Android; **no `Drop...Clusters...`
migration exists**. Treat the cluster tables as present-but-possibly-empty across the range, as
the brief already advises.

---

## V10 — `meta.version` per milestone

All values below were read from the named constant at the named tag.

### History (`components/history/core/browser/history_database.cc`, `kCurrentVersionNumber`)

| M120 | M122 | M124 | M126 | M128 | M130 | M132 | M134 | M136 | M138 | M140 | M142 | M145 | M148 | M150 | HEAD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 68 | 69 | 69 | 69 | 69 | 69 | 69 | 69 | **70** | 70 | 70 | 70 | 70 | 70 | 70 | 70 |

`kCompatibleVersionNumber = 16` (HEAD, L43). Brief expected 55–75 — **CONFIRMED in range**.

### Web Data (`components/webdata/common/web_database.{cc,h}`)

| M120 | M122 | M124 | M126 | M128 | M130 | M132 | M134 | M136 | M138 | M140 | M142 | M145 | M148 | M150 | HEAD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 120 | 123 | 127 | 128 | 130 | **134** | 135 | 137 | 138 | 141 | 141 | 145 | 147 | 151 | 152 | 153 |

HEAD: `kCompatibleVersionNumber = 151`, `kDeprecatedVersionNumber = 82`.
Brief expected 105–140 — **CORRECTED**, the real top of the range is **153**, above the brief's
guess.

### Login Data (`.../password_store/login_database.cc`, `kCurrentVersionNumber`)

| M120–M138 | M140 | M142–HEAD |
|---|---|---|
| 41 | 42 | **43** |

HEAD L80–83: `kCurrentVersionNumber = 43`, `kCompatibleVersionNumber = 40`.
Newest columns: v41 `sender_profile_image_url`, v42 `date_last_filled`, v43
`actor_login_approved` (HEAD L580–596). Brief expected 35–45 — **CONFIRMED**.

### Cookies (`net/extras/sqlite/sqlite_persistent_cookie_store.cc`)

| M120 | M124 | M127 | M128 | M129 | M130 → HEAD |
|---|---|---|---|---|---|
| 19 | 21 | 23 | 23 | 23 | **24** |

HEAD L316–317: `kCurrentVersionNumber = 24`, `kCompatibleVersionNumber = 24`.
Brief expected 20–26 — **CONFIRMED**.

### Favicons — **CORRECTED on two counts**

- **File path:** the brief calls it the "thumbnail DB". The source file is
  `components/favicon/core/favicon_database.cc`. `components/history/core/browser/thumbnail_database.cc`
  returned **404 at M120 and at M130** — it does not exist anywhere in the supported range.
- **Version:** `kCurrentVersionNumber` = **8 at M120**, **9 at M136 and HEAD**
  (`kCompatibleVersionNumber = 9` at HEAD). The brief's "v8, stable across the range" is
  **CORRECTED** — it changed inside the range.

### Top Sites

`.../main/components/history/core/browser/top_sites_database.cc` L58:
`static const int kVersionNumber = 5;` — **CONFIRMED** (brief said v5).

### Shortcuts

`.../main/components/omnibox/browser/shortcuts_database.cc` L30–31:
`kCurrentVersionNumber = 2`, `kCompatibleVersionNumber = 1`.

**Standing recommendation unchanged:** branch on **column/table presence**, not on version.
These numbers are for fixture naming and sanity assertions only.

---

## V11 — `Shortcuts` `swap_contents_and_description`

**Verdict: REFUTED. The column does not exist.**

`.../main/components/omnibox/browser/shortcuts_database.cc` L357–363, verbatim DDL:

```sql
CREATE TABLE omni_box_shortcuts(id VARCHAR PRIMARY KEY,
text VARCHAR,fill_into_edit VARCHAR,url VARCHAR,
document_type INTEGER,contents VARCHAR,
contents_class VARCHAR,description VARCHAR,
description_class VARCHAR,transition INTEGER,type INTEGER,
keyword VARCHAR,last_access_time INTEGER,
number_of_hits INTEGER)
```

14 columns: `id`, `text`, `fill_into_edit`, `url`, `document_type`, `contents`, `contents_class`,
`description`, `description_class`, `transition`, `type`, `keyword`, `last_access_time`,
`number_of_hits`. No `swap_contents_and_description`.

The brief's high-value observation about `text` (the literal omnibox input) stands — it is the
second column and is stored verbatim.

---

## V12 — `credit_cards.card_number_encrypted` plaintext encoding

**Verdict: CONFIRMED — UTF-16 (`EncryptString16`). Plus a correction on the crypto path.**

`.../main/components/autofill/core/browser/webdata/payments/payments_autofill_table.cc`:

```cpp
constexpr std::string_view kCardNumberEncrypted = "card_number_encrypted";  // L69

void BindEncryptedStringToColumn(sql::Statement* s, int column_index,
                                 const std::string& value,
                                 const os_crypt_async::Encryptor& encryptor) {
  std::string encrypted_data;
  std::ignore = encryptor.EncryptString(value, &encrypted_data);      // L260
  s->BindBlob(column_index, std::move(encrypted_data));
}

void BindEncryptedU16StringToColumn(sql::Statement* s, int column_index,
                                    const std::u16string& value,
                                    const os_crypt_async::Encryptor& encryptor) {
  std::string encrypted_data;
  std::ignore = encryptor.EncryptString16(value, &encrypted_data);    // L270
  s->BindBlob(column_index, std::move(encrypted_data));
}

std::u16string DecryptU16StringFromColumn(...) {
  ...
  std::ignore = encryptor.DecryptString16(encrypted_value, &value);   // L408
```

- Card number goes through the **`String16`** helper → decrypted plaintext is **UTF-16**
  (little-endian on all supported platforms). **CONFIRMED.**
- **Correction:** it is no longer sync `OSCrypt::EncryptString16` but
  `os_crypt_async::Encryptor::EncryptString16`. That means Web Data card numbers share the
  **same `v10`/`v20` provider registry as cookies and passwords** on Windows — see V1(3).
- A separate 8-bit helper (`BindEncryptedStringToColumn` /
  `kSerializedValueEncrypted`) is used for other payment blobs; do not assume UTF-16 for
  every encrypted payments column.

---

## Additional schema confirmations (requested outside the V-queue)

### `visits` (`.../main/components/history/core/browser/visit_database.cc` L146–205, verbatim)

```
id INTEGER PRIMARY KEY AUTOINCREMENT,
url INTEGER NOT NULL,
visit_time INTEGER NOT NULL,
from_visit INTEGER,
external_referrer_url TEXT,
transition INTEGER DEFAULT 0 NOT NULL,
segment_id INTEGER,
visit_duration INTEGER DEFAULT 0 NOT NULL,
incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
opener_visit INTEGER,
originator_cache_guid TEXT,
originator_visit_id INTEGER,
originator_from_visit INTEGER,
originator_opener_visit INTEGER,
is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
visited_link_id INTEGER DEFAULT 0 NOT NULL,
... (app_id / package-name column follows, Android-oriented)
```

- `visited_link_id` **CONFIRMED present** at HEAD (`DEFAULT 0 NOT NULL`, with the in-source note
  that non-`LINK`/`MANUAL_SUBFRAME` transitions write `0` = `kInvalidVisitedLinkID`).
- `external_referrer_url` and `originator_*` are present — the local-vs-synced-visit distinction
  the brief calls out is real and is encoded in `originator_cache_guid` /
  `originator_visit_id` / `is_known_to_sync`. The source comments explicitly warn that old
  migrated databases can hold `NULL` in the `originator_*` columns while new local visits write
  empty string / 0. **A v2 parser must treat NULL and ''/0 as equivalent "local visit".**
- `id` is `AUTOINCREMENT` specifically so Sync can rely on IDs not being reused — meaning a gap
  in `visits.id` is meaningful evidence of deletion. Worth surfacing.

### `favicons` DB (`.../main/components/favicon/core/favicon_database.cc` L122–156, verbatim)

```sql
CREATE TABLE IF NOT EXISTS icon_mapping
(id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL, icon_id INTEGER,
 page_url_type INTEGER DEFAULT 0)

CREATE TABLE IF NOT EXISTS favicons
(id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL, icon_type INTEGER DEFAULT 1)

CREATE TABLE IF NOT EXISTS favicon_bitmaps
(id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL, last_updated INTEGER DEFAULT 0,
 image_data BLOB, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
 last_requested INTEGER DEFAULT 0)
```

The brief's characterisation of the favicon triple-join is CONFIRMED; only the DB version (9, not
8) and the source file path were wrong.

### `top_sites` (`.../main/components/history/core/browser/top_sites_database.cc` L66)

`CREATE TABLE IF NOT EXISTS top_sites(...)` with `url`, `url_rank`, `title` (confirmed by the
migration statements at L177–197 and the read query at L297:
`SELECT ... FROM top_sites ORDER BY url_rank`). Version 5.

### `urls`

`URLDatabase::CreateURLTable` (`.../main/components/history/core/browser/url_database.cc` L709+)
builds the DDL with `base::StrCat` and `AUTOINCREMENT` (same Sync-ID rationale as `visits`).
The **full column list was not printed** in this session — see "Not verified".

---

## NOT VERIFIED IN THIS SESSION (explicit STILL-UNKNOWN list)

These are brief claims that were **not** re-checked here. They are neither confirmed nor refuted;
do not treat this report as endorsing them.

1. **Blockfile cache on-disk format** — now a required work item because of V2, and the brief has
   no section on it. Highest-value follow-up.
2. **macOS OSCrypt key derivation** (`Chrome Safe Storage` Keychain service/account names,
   PBKDF2 iteration count 1003, AES-128-CBC) — brief §3.3, not re-fetched.
   `keychain_password_mac.mm` was not read.
3. **Linux OSCrypt** (`v11` keyring path, `v10` hardcoded `peanuts` password, iterations = 1) —
   brief §3.4, not re-fetched.
4. **Windows `v10` value layout** (`"v10" || 12-byte nonce || ciphertext || 16-byte GCM tag`) —
   not re-read from `encryptor.cc`. The provider tags themselves were verified; the byte layout
   was not.
5. **`Preferences` / `Secure Preferences` MAC structure**, `protection.macs`, seed/branding —
   brief §5, not re-fetched.
6. **On-disk profile layout** (brief §1), including the claim that OSCrypt key material lives at
   user-data-dir level rather than profile level. Strongly implied by
   `browser_process_impl.cc` passing `local_state()` to both key providers (which is
   `<user data dir>/Local State`), but not confirmed by reading the path constants.
7. **Full `urls` table column list** — only the creation function and its AUTOINCREMENT rationale
   were read.
8. **Login Data / Web Data full DDL** beyond the columns quoted above.
9. **Finch rollout percentages and dates** for `UseAppBoundEncryptionProviderForEncryption` and
   `UseAsyncOsCryptInLoginDatabase` — not public in source.
10. **`kEncryptAllPasswordsWithOSCryptAsync`** default and behaviour (does Chrome bulk re-encrypt
    existing `v10` password rows to `v20`?). Feature name observed at M136 only.

---

## ACTION LIST FOR v2 (ranked by what changed)

1. **Build a blockfile cache reader for Windows.** V2 refuted the Simple-Cache-everywhere
   assumption. Budget this as a first-class work item; detect backend by directory shape.
2. **Do not version-gate decryption. Dispatch per row on the 3-byte prefix** (`v10` / `v20` /
   absent = plaintext), with a provider registry. V1 shows Finch-staged rollout in M127–M132 and
   capability-gating even at HEAD.
3. **Unblock issue #124 partially today.** In M130–M132 (and, per-client, anywhere in M128–M132)
   Login Data is normally still `v10` and decryptable with plain user DPAPI. Do not refuse to
   decrypt passwords just because cookies are `v20`.
4. **Add Web Data card numbers to the same decryptor registry** — they are `v20`-capable too.
5. **Strip the 32-byte SHA-256(host_key) prefix from cookie plaintext iff cookies
   `meta.version >= 24`.** Verify the digest and report a mismatch as tampering/corruption rather
   than silently emitting a garbage value.
6. **Address reader: three shapes.** `addresses`+`address_type_tokens` (WebDB ≥134, M130+),
   `contact_info`+`local_addresses` (M120–M129), legacy `autofill_profiles*` (recovery only —
   dropped at WebDB v114, below the whole supported range).
7. **`sync.birthday`: two locations.** Flat pref `sync.birthday` for M120–M137; nested under
   `sync.transport_data_per_account.<gaia-hash>` for M138+. Label it as an opaque **sync store
   birthday**, never as a date of birth.
8. **`sync.demographics.birth_year` is the true, un-noised year.** Redact by default. The noise
   offset lives in `Local State` under `demographics_birth_year_offset` and is *not* applied to
   the stored value — do not add it.
9. **macOS credential support is not blocked.** `keychain_identifier` is iOS-only; a non-empty
   value is a reliable "this is an iOS Login Data file" signal.
10. **Drop `swap_contents_and_description`** from the `Shortcuts` model.
11. **Fixture matrix pivot points:** M127 (ABE Finch begins), **M130** (cookies v20 default +
    cookie DB v24 domain binding + WebDB v134 address unification — the single most important
    boundary), **M133** (Login Data v20 default), M136 (Favicons v9, History v70), M138
    (`sync.birthday` flat pref removed), M145 (Login Data sync-OSCrypt fallback removed).
