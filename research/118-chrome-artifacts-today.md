# Research: Chrome profile artifacts in currently-supported Chrome (M120 – M153)

> **Method note.** This run had **no web search / fetch tool available** (tools exposed: Read, Write,
> intercom). The brief is assembled from working knowledge of the Chromium tree. Per parent
> instruction, confidence is **not** hedged uniformly. Three tiers only:
>
> - **`VK` — VERIFIED-BY-KNOWLEDGE.** Long-lived, structurally stable Chromium behaviour. Encode it.
>   I would be surprised to be wrong and would treat a contradiction as a finding about the profile,
>   not about the brief.
> - **`L` — LIKELY.** Shape is right; a detail (exact column order, exact milestone, one enum value)
>   may be off. Safe to design against, worth a cheap confirmation.
> - **`U` — UNVERIFIED.** Do not encode without checking. Every `U` appears in the **ranked
>   verification queue** below with a URL, a symbol to grep, and the expected answer shape.
>
> Citation base URL: `https://source.chromium.org/chromium/chromium/src/+/main:<path>`.
> To pin a milestone, swap `main` for `refs/branch-heads/<N>` (e.g. `refs/branch-heads/6099` style —
> the numeric branch head, not the milestone number; `https://chromiumdash.appspot.com/branches`
> maps milestone → branch head).

---

## Summary

Chrome's on-disk model in M120–M153 is: a **user-data dir** holding `Local State` (JSON,
browser-global, holds the OS-encrypted profile key) plus one directory per profile (`Default`,
`Profile 1`, …), each containing SQLite artifact DBs (`History`, `Web Data`, `Login Data`,
`Favicons`, `Top Sites`, `Shortcuts`), JSON prefs (`Preferences`, `Secure Preferences`,
`Bookmarks`), a `Network/` subdir (`Cookies`), LevelDB stores, and a Simple-Cache-format HTTP cache
that on macOS/Linux lives **outside** the profile dir. Almost all timestamps are Chrome/WebKit epoch
(µs since 1601-01-01 UTC); the notable exception is `Web Data.autofill.date_created/date_last_used`,
which is Unix seconds.

Three things force a v2 parser to branch across 120→153: **(1) App-Bound Encryption** (Windows,
M127+, `v20` ciphertext prefix) which breaks naive offline decryption — and which **rolled out to
Cookies before Login Data**, a split that decides what is even buildable for issue #124;
**(2) the Autofill address-storage rewrite** (`autofill_profiles` + satellites → `local_addresses` /
`local_addresses_type_tokens`); and **(3)** steady additive column growth in `History.visits`,
`History.downloads`, `Cookies.cookies`, and `logins`. Everything else is additive and is handled by
*selecting named columns defensively rather than `SELECT *`*.

### Summary table

| Artifact | Path (relative to profile dir) | Format | Key tables/keys | Timestamp epoch | Varies 120→153? |
|---|---|---|---|---|---|
| Browser-global state | `../Local State` | JSON | `os_crypt.encrypted_key`, `os_crypt.app_bound_encrypted_key`, `profile.info_cache`, `profile.profiles_order` | Chrome µs (as strings) | **Yes** — ABE key added M127+ |
| History | `History` | SQLite | `urls`, `visits`, `visit_source`, `downloads`, `downloads_url_chains`, `downloads_slices`, `keyword_search_terms`, `segments`, `segment_usage`, `visited_links`, cluster tables | Chrome µs | **Yes** — added columns/tables |
| Cookies | `Network/Cookies` | SQLite | `cookies` | Chrome µs | **Yes** — `source_type`, `has_cross_site_ancestor`; `v20` values |
| Passwords | `Login Data`, `Login Data For Account` | SQLite | `logins`, `stats`, `insecure_credentials`, `password_notes` | Chrome µs | **Yes** — `keychain_identifier`, sharing cols, later ABE |
| Autofill/payments/search engines | `Web Data`, `Account Web Data` | SQLite | `autofill`, `credit_cards`, `keywords`, `local_addresses*`/`autofill_profiles*`, `contact_info*`, `token_service` | **mixed** — see §6 | **Yes** — address rewrite |
| Favicons | `Favicons` | SQLite | `favicons`, `favicon_bitmaps`, `icon_mapping` | Chrome µs | No |
| Most-visited | `Top Sites` | SQLite | `top_sites` | n/a | No (may be absent) |
| Omnibox shortcuts | `Shortcuts` | SQLite | `omni_box_shortcuts` | Chrome µs | No |
| Prefs | `Preferences` | JSON | `account_info`, `profile.*`, `sessions.event_log`, content settings | Chrome µs (string) | Minor |
| Tamper-protected prefs | `Secure Preferences` | JSON + HMAC | `extensions.settings`, `protection.macs`, `protection.super_mac` | Chrome µs (string) | Minor |
| Bookmarks | `Bookmarks`, `Bookmarks.bak` | JSON | `roots.*`, `date_added` | Chrome µs (string) | No |
| Sessions/tabs | `Sessions/Session_*`, `Sessions/Tabs_*` | SNSS | pickled commands | Chrome µs | Low |
| HTTP cache | `Cache/Cache_Data` (Win) / out-of-profile (mac, Linux) | Simple Cache | `<hash>_0`, `_1`, `_s`, `index-dir/the-real-index` | Chrome µs in headers pickle | Low |
| Web storage | `Local Storage/leveldb`, `Session Storage`, `IndexedDB/`, `Service Worker/` | LevelDB | `META:<origin>`, `_<origin>\x00\x01<key>` | Chrome µs | No |

---

## RANKED VERIFICATION QUEUE (spend effort top-down)

Ranked by **blast radius**: how much a wrong answer damages downstream decisions.
Legend: **(a)** changes what a parser must branch on · **(b)** changes whether a feature is buildable
at all · **(c)** changes correctness of emitted values only.

---

### V1 — Did Cookies move to App-Bound Encryption on a DIFFERENT milestone than Login Data?
**Blast radius: (b) + (a). Highest. Directly decides issue #124.**

**Why it dominates.** If Cookies went `v20` at M127 but Login Data stayed `v10` until materially
later (my belief: ~M131–M132), then across a wide, common band of Chrome versions **credentials
remain decryptable with the plain DPAPI path while cookies already do not**. That means:
- issue #124's credential decryption is **buildable today for a large share of real evidence** and
  should not be gated behind the full SYSTEM-DPAPI/elevation-service unwrap;
- v2 must **not** treat "profile is M127+" as "everything is app-bound" — that single wrong
  inference would make the tool refuse to decrypt passwords it could actually read;
- conversely, if both moved at M127, credential support requires the SYSTEM-DPAPI chain from day
  one and issue #124's scope roughly triples.

There is also a third possible shape worth explicitly testing for: the rollout was **staged by
Finch**, not by a hard milestone, in which case *there is no version number that predicts the
prefix* and the only correct implementation is per-row prefix dispatch with no version gating at
all. That outcome is the most likely one in my estimation and is also the safest to build for.

**Where to look**
1. `https://source.chromium.org/chromium/chromium/src/+/main:components/os_crypt/async/browser/app_bound_encryption_provider_win.cc`
   — symbol: the provider's tag/prefix constant (expect a `kAppBoundDataPrefix` / tag string).
   **Expected shape:** a 3-char ASCII string, expect `"v20"`.
2. `https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/net/profile_network_context_service.cc`
   and `https://source.chromium.org/chromium/chromium/src/+/main:services/network/network_service.cc`
   — where the cookie store is handed an `os_crypt_async::OSCryptAsync` with the app-bound provider
   in its provider list. **Expected shape:** a provider-list construction; note whether the
   app-bound provider is included unconditionally or behind a feature flag.
3. `https://source.chromium.org/chromium/chromium/src/+/main:components/password_manager/core/browser/password_store/login_database.cc`
   — symbol: `EncryptedString` / `DecryptedString` call sites and whether they route through
   `OSCryptAsync` or legacy sync `OSCrypt`. **Expected shape:** if Login Data still calls sync
   `OSCrypt::EncryptString`, it is **not** app-bound; if it takes an `os_crypt_async::Encryptor`,
   it is.
4. Feature flags: grep `kUseAppBoundEncryptionProviderForCookies`,
   `kAppBoundEncryptionForPasswords`, or similar in
   `https://source.chromium.org/chromium/chromium/src/+/main:components/os_crypt/async/common/`
   and `chrome/common/chrome_features.cc`. **Expected shape:** `BASE_FEATURE(...,
   base::FEATURE_ENABLED_BY_DEFAULT)` with a comment naming the milestone.

**Answer shapes I need back:** two milestone integers (or "Finch-staged, no fixed milestone") —
`cookies_v20_from = <int, expect 127>`, `logins_v20_from = <int, expect 128–134 or null>`.

---

### V2 — Is the Windows HTTP cache Simple Cache (not blockfile) across 120–153?
**Blast radius: (b). Determines whether the cache parser is one implementation or two.**

If Windows is still blockfile, v2 needs an entirely separate `data_0..data_3` + `f_######` reader
with rankings/allocation-bitmap logic — a large, distinct work item, and §4 of this brief would not
apply on the most common evidence platform.

**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/disk_cache.cc`
— symbol: `CreateCacheBackendImpl` / the `CACHE_BACKEND_DEFAULT` resolution, plus
`https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/backend_experiment.h`.
**Expected shape:** a platform `#if` block or a feature check selecting
`net::CACHE_BACKEND_SIMPLE` vs `CACHE_BACKEND_BLOCKFILE`. Expect Simple for
`BUILDFLAG(IS_ANDROID) || IS_CHROMEOS || IS_LINUX || IS_MAC` and the open question is Windows.
**Empirical shortcut:** any real Windows `Cache_Data` listing settles it — 16-hex-char `_0` files =
Simple; `data_0`/`data_1`/`f_000001` = blockfile.

---

### V3 — Autofill address-storage cutover: milestone and final column lists
**Blast radius: (a). Forces a dual-reader; getting the boundary wrong silently drops all addresses.**

**Where:**
`https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/webdata/addresses/address_autofill_table.cc`
— symbols: `kLocalAddressesTable`, `kLocalAddressesTypeTokensTable`, `kContactInfoTable`,
`kContactInfoTypeTokensTable`, and the `InitLocalAddressesTable` / `MigrateToVersionNN...` functions.
Cross-check the migration list in
`https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/webdata/autofill_table.cc`.
**Expected shape:** a `MigrateToVersion<NN>AddNewLocalAddressesTables`-style function name with
`NN` an int, expect **120–135**; plus two `CREATE TABLE` column lists. Also confirm whether the
legacy `autofill_profiles` + `autofill_profile_{names,emails,phones,addresses}` tables are
**dropped** at migration or left behind as orphans (if left behind, v2 can read both and merge —
materially better recovery).

**Note:** regardless of the answer, v2 should detect by **table presence**, not version. The
milestone matters for *fixture selection*, not for runtime logic.

---

### V4 — Do `sync.birthday` and `sync.demographics` still exist in `Preferences`?
**Blast radius: (b) for two v1 features + (c) correctness risk of actively wrong output.**

v1 reads both. Two distinct questions:

**V4a — `sync.birthday`.** This is the sync **store birthday** (a server-issued opaque token), *not*
a date of birth. Some tooling has historically mislabelled it; v2 must not repeat that.
**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:components/sync/base/pref_names.h`
— symbol: `kSyncBirthday` (also `kSyncCacheGuid`, `kSyncBagOfChips`). Cross-check
`https://source.chromium.org/chromium/chromium/src/+/main:components/sync/service/sync_transport_data_prefs.cc`.
**Expected shape:** a `constexpr char kSyncBirthday[] = "sync.birthday";` — or **absence**, meaning
it moved into the sync `DataTypeStore` LevelDB under `Sync Data/`. Answer needed:
`present_in_preferences = true|false`.

**V4b — `sync.demographics`.** UMA demographics: a dict with `birth_year` and `gender`, paired with
a **per-client noise offset**. The reported year is `birth_year + offset`, so reading the dict alone
yields a wrong year with false confidence — this is a correctness landmine, not just a missing field.
**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:components/metrics/demographics/user_demographics.cc`
— symbols: `kSyncDemographicsPrefName`, `kSyncDemographicsBirthYearOffsetPrefName`,
`kSyncDemographicsBirthYearPath`, `kSyncDemographicsGenderPath`.
**Expected shape:** string constants `"sync.demographics"` and
`"sync.demographics_birth_year_offset"`, plus a min/max birth-year clamp and a gender enum
(expect `UserDemographicsProto::Gender`, values like `GENDER_MALE=1`, `GENDER_FEMALE=2`).
Answer needed: `present = true|false`, and whether the offset pref is a sibling key in `Preferences`.

**v2 recommendation regardless of outcome:** implement both as *optional, best-effort* extractors
that emit nothing when absent; never required fields. If birth year is surfaced at all, surface the
offset alongside it and label the value as noised.

---

### V5 — Cookie plaintext domain-prefix binding: exact form and applicable versions
**Blast radius: (c), but on every single cookie value — a 100%-wrong-output bug.**

Newer Chrome binds the cookie's domain into the encrypted plaintext, so a decryptor that does not
strip it emits every cookie value with a garbage prefix.
**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:net/extras/sqlite/sqlite_persistent_cookie_store.cc`
— symbols: the `EncryptedValue`/`DecryptAndSetValue` helpers; look for a `crypto::hash`/`SHA256` of
`host_key` being prepended before `Encrypt`, and the matching verify-and-strip on read.
**Expected shape:** either (i) `host_key` string prepended verbatim then compared, or (ii) a
**32-byte** SHA-256 digest of `host_key` prepended then compared. I lean (ii). Answer needed:
`prefix_kind = "none" | "hostkey-string" | "sha256-32bytes"`, plus whether it applies to `v10` too or
only `v20`.

---

### V6 — `keywords` timestamp epoch
**Blast radius: (c). Classic trap: Chrome-µs vs Unix-seconds differ by ~400 years.**

**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:components/search_engines/keyword_table.cc`
— symbols: the `BindURLToStatement` / `GetKeywordDataFromStatement` helpers; look at how
`date_created`, `last_modified`, `last_visited` are bound.
**Expected shape:** either `.ToInternalValue()` / `.ToDeltaSinceWindowsEpoch().InMicroseconds()`
(⇒ Chrome µs, 17-digit values ~`13...`) or `.ToTimeT()` (⇒ Unix seconds, 10-digit ~`17...`).
I lean Chrome µs. Answer needed: one of those two.

---

### V7 — macOS `logins.keychain_identifier`: dual-path decryption semantics
**Blast radius: (b) for macOS credential support specifically.**

If newer macOS Chrome stores each password under a per-credential Keychain item referenced by this
column (rather than one `Chrome Safe Storage` OSCrypt blob), then offline macOS password recovery
needs the **Keychain file plus the login password**, and `password_value` alone may be empty or a
placeholder.
**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:components/password_manager/core/browser/password_store/login_database.cc`
— symbol: `keychain_identifier`; and
`https://source.chromium.org/chromium/chromium/src/+/main:components/os_crypt/sync/keychain_password_mac.mm`.
**Expected shape:** a migration function name with an int version, plus whether `password_value` is
still populated when `keychain_identifier` is non-empty. Answer needed:
`password_value_still_usable = true|false`.

---

### V8 — Simple Cache entry-hash hex byte order and `_dk_` cache-key grammar
**Blast radius: (c) + limits URL→file verification.**

**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/simple/simple_util.cc`
— symbols: `GetEntryHashKey`, `GetFilenameFromEntryFileKeyAndFileIndex`.
**Expected shape:** `base::StringPrintf("%016" PRIx64, hash)` over a uint64 loaded from the first
8 SHA-1 bytes — confirm the load is little-endian, which makes the printed hex the **reverse** of
the raw SHA-1 byte order. For the key grammar:
`https://source.chromium.org/chromium/chromium/src/+/main:net/http/http_cache.cc` — symbol
`HttpCache::GenerateCacheKey` / `GenerateCacheKeyForRequest`.
**Expected shape:** a prefix like `_dk_<top_frame_site>%20<frame_site>%20` and possibly `1/0/`.
**Practical mitigation regardless:** read the key out of the `_0` file rather than synthesising it.

---

### V9 — History Clusters / Journeys table lifecycle late in the range
**Blast radius: (a), but only for an optional feature.**
**Where:** `https://source.chromium.org/chromium/chromium/src/+/main:components/history/core/browser/history_database.cc`
— look for a `MigrateToVersion<NN>Drop...Clusters...` in the migration list.
**Expected shape:** either no drop migration (tables persist, possibly empty) or a named drop.
Answer needed: `tables_present_at_M153 = true|false`.

---

### V10 — Per-milestone `meta.version` values for History / Web Data / Login Data / Cookies
**Blast radius: (c) / fixture labelling only** — the parser should branch on column presence, not
version. Useful for naming fixtures and for a sanity assertion.
**Where:** `kCurrentVersionNumber` in
`.../components/history/core/browser/history_database.cc`,
`.../components/webdata/common/web_database.cc`,
`.../components/password_manager/core/browser/password_store/login_database.cc`,
`.../net/extras/sqlite/sqlite_persistent_cookie_store.cc`.
**Expected shapes:** History `int, expect 55–75`; Web Data `int, expect 105–140`;
Login Data `int, expect 35–45`; Cookies `int, expect 20–26`.

---

### V11 — `Shortcuts` `swap_contents_and_description` column presence
**Blast radius: (c), one column.** `https://source.chromium.org/chromium/chromium/src/+/main:components/omnibox/browser/shortcuts_database.cc`
— read the `CREATE TABLE omni_box_shortcuts` string. **Expected shape:** the literal DDL.

---

### V12 — `credit_cards.card_number_encrypted` plaintext text encoding
**Blast radius: (c), one field.** Historically UTF-16LE on Windows via `OSCrypt::EncryptString16`.
`https://source.chromium.org/chromium/chromium/src/+/main:components/autofill/core/browser/webdata/payments/payments_autofill_table.cc`
— symbol: `EncryptString16` vs `EncryptString`. **Expected shape:** one of those two call names.

---

## Findings

### 1. On-disk profile layout

**1.1 `VK` User-data-dir roots.**
- Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`
- macOS: `~/Library/Application Support/Google/Chrome`
- Linux: `~/.config/google-chrome` (Chromium: `~/.config/chromium`)
Source: `chrome/common/chrome_paths_win.cc`, `_mac.mm`, `_linux.cc`.

**1.2 `VK` `Local State` lives at the user-data-dir root — a *sibling of* the profile directories,
not inside them.** A v2 parser must accept an acquired **user data dir** as root, not a single
profile, or the encryption key is unreachable. If only a profile dir is supplied, all `v10`/`v11`/
`v20` values are undecryptable and the tool must say so rather than emitting garbage.

**1.3 `VK` Profile directory naming.** `Default` for the first profile; then `Profile 1`,
`Profile 2`, … Numbers are **not reused**, so gaps indicate deleted profiles. Also at this level:
`Guest Profile`, `System Profile`. Enumerate from `Local State` → `profile.info_cache` (dict keyed by
directory name) rather than by globbing — it also yields display name, `gaia_id`, `user_name`
(email), `hosted_domain`, `is_ephemeral`, `is_consented_primary_account`, `avatar_icon`,
`background_apps`, `active_time`. `L` `profile.profiles_order`, `profile.last_used`, and
`profile.last_active_profiles` are also present across this range.
Source: `chrome/browser/profiles/profile_attributes_entry.cc`, `profile_attributes_storage.cc`.

**1.4 `VK` (core) / `L` (tail) Files and dirs inside a profile:**

```
Preferences                     JSON, plaintext prefs
Secure Preferences              JSON, HMAC-protected prefs (extensions live here)
Bookmarks / Bookmarks.bak       JSON
History / History-journal|-wal  SQLite
Favicons                        SQLite
Top Sites                       SQLite
Shortcuts                       SQLite (omnibox)
Web Data                        SQLite (autofill, cards, keywords)
Account Web Data                SQLite (account-scoped autofill)
Login Data                      SQLite (profile-scoped passwords)
Login Data For Account          SQLite (Google-account-scoped passwords)
Affiliation Database            SQLite (password affiliations)
Network/Cookies                 SQLite
Network/Network Persistent State   JSON (HTTP/QUIC server properties — visited hosts!)
Network/TransportSecurity       JSON (HSTS/pinning — hashed hostnames)
Network/Trust Tokens            SQLite
Network/Reporting and NEL       SQLite
Sessions/Session_<13-digit>     SNSS current/previous session
Sessions/Tabs_<13-digit>        SNSS tab restore
Local Storage/leveldb/          LevelDB
Session Storage/                LevelDB
IndexedDB/<origin>.indexeddb.leveldb/
Service Worker/{Database,ScriptCache,CacheStorage}/
Extensions/<id>/<version>/      unpacked extension payloads
Extension State/, Extension Rules/, Extension Scripts/, Local Extension Settings/<id>/  LevelDB
Sync Data/LevelDB/              LevelDB (sync metadata/entities)
Web Applications/               PWA icons + manifest resources
DIPS                            SQLite (Bounce Tracking Mitigations: site interaction times)
Site Characteristics Database/  LevelDB
Segmentation Platform/          LevelDB
optimization_guide_*            SQLite/LevelDB
heavy_ad_intervention_opt_out.db  SQLite
Shared Dictionary/              SQLite + files
GPUCache/, Code Cache/js/, Code Cache/wasm/, DawnCache*/   Simple Cache format
```
The tail (DIPS, Segmentation Platform, Shared Dictionary, Dawn caches) is version-dependent — treat
presence as optional.

**1.5 `VK` The HTTP cache is not in the profile dir on all platforms.**
- Windows: `<user data>\<Profile>\Cache\Cache_Data`
- macOS: `~/Library/Caches/Google/Chrome/<Profile>/Cache/Cache_Data`
- Linux: `~/.cache/google-chrome/<Profile>/Cache/Cache_Data`
An acquisition that only grabs the user data dir on macOS/Linux **contains no cache**. v2 should
accept an optional separate cache root and warn when it is missing rather than reporting "0 cache
entries".

---

### 2. SQLite schemas

Verification pointers (each file holds the authoritative `CREATE TABLE` text and the
`kCurrentVersionNumber` / `kCompatibleVersionNumber` constants):

| DB | Primary source |
|---|---|
| History | `components/history/core/browser/history_database.cc`, `url_database.cc`, `visit_database.cc`, `download_database.cc`, `visitsegment_database.cc` |
| Favicons | `components/history/core/browser/thumbnail_database.cc` |
| Top Sites | `components/history/core/browser/top_sites_database.cc` |
| Shortcuts | `components/omnibox/browser/shortcuts_database.cc` |
| Login Data | `components/password_manager/core/browser/password_store/login_database.cc` |
| Web Data | `components/webdata/common/web_database.cc`, `components/autofill/core/browser/webdata/autofill_table.cc` (+ `addresses/address_autofill_table.cc`, `payments/payments_autofill_table.cc`), `components/search_engines/keyword_table.cc` |
| Cookies | `net/extras/sqlite/sqlite_persistent_cookie_store.cc` |

`VK` Every DB has `meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)` holding
`version` and `last_compatible_version`. Read it — but **branch on column presence, not on it** (V10).

#### 2.1 History

`VK` `urls`:
```sql
CREATE TABLE urls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           LONGVARCHAR,
  title         LONGVARCHAR,
  visit_count   INTEGER DEFAULT 0 NOT NULL,
  typed_count   INTEGER DEFAULT 0 NOT NULL,
  last_visit_time INTEGER NOT NULL,   -- Chrome epoch µs
  hidden        INTEGER DEFAULT 0 NOT NULL
);
```
Stable across the whole range. `typed_count > 0` = user typed it in the omnibox (strong intent
evidence). `hidden = 1` = subframe-only / never surfaced in the History UI.

`L` `visits` — highest-value table, and where columns accreted:
```sql
CREATE TABLE visits (
  id            INTEGER PRIMARY KEY,
  url           INTEGER NOT NULL,          -- FK urls.id
  visit_time    INTEGER NOT NULL,          -- Chrome epoch µs
  from_visit    INTEGER,                   -- referring visit id (chain)
  transition    INTEGER DEFAULT 0 NOT NULL,-- ui::PageTransition bitfield
  segment_id    INTEGER,
  visit_duration INTEGER DEFAULT 0 NOT NULL, -- DURATION in µs, not a timestamp
  incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
  opener_visit  INTEGER,                   -- visit that opened this tab
  originator_cache_guid TEXT,              -- sync: originating device
  originator_visit_id   INTEGER,
  originator_from_visit INTEGER,
  originator_opener_visit INTEGER,
  is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
  consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
  external_referrer_url TEXT,              -- referrer from outside the browser
  visited_link_id INTEGER DEFAULT 0 NOT NULL,
  app_id        TEXT                       -- Android/PWA app that generated the visit
);
```
The exact milestone for each of `external_referrer_url`, `visited_link_id`, `app_id` is `U` (low
blast radius — see V10), but all are present by the top of the range and at least `visited_link_id`
lands inside it. **Parser rule: never `SELECT *`; probe `PRAGMA table_info(visits)`.**

`VK` `transition` decoding: low byte = core type (0 LINK, 1 TYPED, 2 AUTO_BOOKMARK, 3 AUTO_SUBFRAME,
4 MANUAL_SUBFRAME, 5 GENERATED, 6 AUTO_TOPLEVEL, 7 FORM_SUBMIT, 8 RELOAD, 9 KEYWORD,
10 KEYWORD_GENERATED); qualifier bits `0x00800000` FORWARD_BACK, `0x01000000` FROM_ADDRESS_BAR,
`0x02000000` HOME_PAGE, `0x04000000` FROM_API, `0x10000000` CHAIN_START, `0x20000000` CHAIN_END,
`0x40000000` CLIENT_REDIRECT, `0x80000000` SERVER_REDIRECT.
Source: `ui/base/page_transition_types.h`.

`VK` `visit_source(id INTEGER PRIMARY KEY, source INTEGER NOT NULL)` — `id` joins `visits.id`; rows
exist only for non-local visits. Enum: 0 SYNCED, 1 BROWSED, 2 EXTENSION, 3 FIREFOX_IMPORTED,
4 IE_IMPORTED, 5 SAFARI_IMPORTED. **`source = 0` means the visit happened on another device** —
one of the most consequential distinctions in the whole dataset and one v1-era tools routinely miss.

`L` `downloads`:
```sql
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY, guid VARCHAR NOT NULL,
  current_path LONGVARCHAR NOT NULL, target_path LONGVARCHAR NOT NULL,
  start_time INTEGER NOT NULL,            -- Chrome epoch µs
  received_bytes INTEGER NOT NULL, total_bytes INTEGER NOT NULL,
  state INTEGER NOT NULL, danger_type INTEGER NOT NULL, interrupt_reason INTEGER NOT NULL,
  hash BLOB NOT NULL,                     -- RAW SHA-256 (32 bytes), may be empty
  end_time INTEGER NOT NULL, opened INTEGER NOT NULL,
  last_access_time INTEGER NOT NULL, transient INTEGER NOT NULL,
  referrer VARCHAR NOT NULL, site_url VARCHAR NOT NULL,
  embedder_download_data VARCHAR NOT NULL,
  tab_url VARCHAR NOT NULL, tab_referrer_url VARCHAR NOT NULL,
  http_method VARCHAR NOT NULL,
  by_ext_id VARCHAR NOT NULL, by_ext_name VARCHAR NOT NULL, by_web_app_id VARCHAR NOT NULL,
  etag VARCHAR NOT NULL, last_modified VARCHAR NOT NULL,
  mime_type VARCHAR(255) NOT NULL, original_mime_type VARCHAR(255) NOT NULL
);
CREATE TABLE downloads_url_chains (
  id INTEGER NOT NULL, chain_index INTEGER NOT NULL, url LONGVARCHAR NOT NULL,
  PRIMARY KEY (id, chain_index));
CREATE TABLE downloads_slices (
  download_id INTEGER NOT NULL, offset INTEGER NOT NULL, received_bytes INTEGER NOT NULL,
  finished INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (download_id, offset));
```
`VK` `downloads_url_chains` gives the full redirect chain: `chain_index = 0` is the originally
clicked URL, `MAX` the final one. `state`: 0 IN_PROGRESS, 1 COMPLETE, 2 CANCELLED, 3 (legacy),
4 INTERRUPTED `L`. `hash` is a **raw BLOB, not hex** — a common parser bug.
Enums: `components/download/public/common/download_danger_type.h`,
`download_interrupt_reason_values.h`.

`VK` `keyword_search_terms(keyword_id INTEGER NOT NULL, url_id INTEGER NOT NULL, term LONGVARCHAR
NOT NULL, …)` — the lowercase/normalised column is `normalized_term` in this range (`L`). Join
`url_id → urls.id` and `keyword_id → Web Data.keywords.id` to attribute a query to a search engine.
Single best "what did they search for" artifact.

`VK` `segments(id, name, url_id)` / `segment_usage(id, segment_id, time_slot, visit_count)` —
`time_slot` is Chrome µs floored to **local** midnight, giving per-day visit counts.

`L` `visited_links(id INTEGER PRIMARY KEY AUTOINCREMENT, link_url_id INTEGER NOT NULL,
top_level_url LONGVARCHAR NOT NULL, frame_url LONGVARCHAR NOT NULL, visit_count INTEGER DEFAULT 0
NOT NULL)` — partitioned `:visited` state, lands inside the range. Gives **frame/top-level context**
that `visits` alone does not.

`L` History Clusters ("Journeys"): `content_annotations`, `context_annotations`, `clusters`,
`clusters_and_visits`, `cluster_keywords`, `cluster_visit_duplicates`. `context_annotations` carries
`browser_type`, `window_id`, `tab_id`, `task_id`, `root_task_id`, `parent_task_id`, `response_code`,
`is_existing_part_of_tab_group`, `is_placed_in_tab_group`, `is_new_bookmark`, `is_existing_bookmark`,
`is_ntp_custom_link`, `duration_since_last_visit`, `page_end_reason`. **`tab_id`/`window_id`/
`page_end_reason` are excellent corroboration for activity timelines.** Lifecycle late in the range
is `U` — see V9. Treat as optional.

#### 2.2 Favicons

`VK` (thumbnail DB v8, stable across the range):
```sql
CREATE TABLE favicons (id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL,
                       icon_type INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL,
  last_updated INTEGER DEFAULT 0,   -- Chrome epoch µs
  image_data BLOB, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
  last_requested INTEGER DEFAULT 0);-- Chrome epoch µs
CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL,
                           icon_id INTEGER);
```
`L` `icon_type` bitmask: 1 FAVICON, 2 TOUCH_ICON, 4 TOUCH_PRECOMPOSED_ICON, 8 WEB_MANIFEST_ICON.
`image_data` is a PNG blob. **`icon_mapping.page_url` can evidence pages absent from `History`** —
favicons are pruned lazily, so this survives some history-deletion flows. Worth building as a
first-class v2 feature.

#### 2.3 Top Sites

`VK` `CREATE TABLE top_sites (url LONGVARCHAR NOT NULL, url_rank INTEGER NOT NULL, title
LONGVARCHAR NOT NULL);` plus `meta`. No timestamps. `L` The file may be **absent** on fresh or
NTP-customised profiles; user-pinned tiles live in `Preferences` → `custom_links.list` instead.

#### 2.4 Shortcuts (omnibox)

`L`
```sql
CREATE TABLE omni_box_shortcuts (
  id VARCHAR PRIMARY KEY,
  text VARCHAR,               -- what the user actually typed
  fill_into_edit VARCHAR,
  url VARCHAR,
  contents VARCHAR, contents_class VARCHAR,
  description VARCHAR, description_class VARCHAR,
  transition INTEGER, type INTEGER, keyword VARCHAR,
  last_access_time INTEGER,   -- Chrome epoch µs
  number_of_hits INTEGER);
```
Plus possibly `swap_contents_and_description` (`U`, see V11). `text` is high-value: literal omnibox
input, **including inputs that never became a visit**.

#### 2.5 Login Data / Login Data For Account

`L`
```sql
CREATE TABLE logins (
  origin_url VARCHAR NOT NULL, action_url VARCHAR,
  username_element VARCHAR, username_value VARCHAR,
  password_element VARCHAR, password_value BLOB,   -- OSCrypt ciphertext
  submit_element VARCHAR, signon_realm VARCHAR NOT NULL,
  date_created INTEGER NOT NULL,                   -- Chrome epoch µs
  blacklisted_by_user INTEGER NOT NULL,
  scheme INTEGER NOT NULL,       -- 0 HTML,1 BASIC,2 DIGEST,3 OTHER,4 USERNAME_ONLY
  password_type INTEGER, times_used INTEGER,
  form_data BLOB,                -- serialized autofill::FormData
  display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR,
  skip_zero_click INTEGER, generation_upload_status INTEGER,
  possible_username_pairs BLOB,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_last_used INTEGER NOT NULL DEFAULT 0,        -- Chrome epoch µs
  moving_blocked_for BLOB,
  date_password_modified INTEGER NOT NULL DEFAULT 0,-- Chrome epoch µs
  sender_email VARCHAR, sender_name VARCHAR,
  date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0,
  keychain_identifier BLOB,
  sender_profile_image_url VARCHAR,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
```
Companion tables (`L`):
- `stats(origin_domain VARCHAR NOT NULL, username_value VARCHAR, dismissal_count INTEGER,
  update_time INTEGER NOT NULL, UNIQUE(origin_domain, username_value))` — records **sites where the
  user declined to save a password**: accounts that exist but were never stored. Under-used
  forensically and cheap to add.
- `insecure_credentials(parent_id, insecurity_type, create_time, is_muted,
  trigger_notification_from_backend)` — 0 LEAKED, 1 PHISHED, 2 WEAK, 3 REUSED.
- `password_notes(id INTEGER PRIMARY KEY, parent_id INTEGER, key VARCHAR, value BLOB,
  date_created INTEGER, confidential INTEGER)` — `value` is **also OSCrypt-encrypted**; users store
  2FA seeds and recovery codes here. Do not skip it.
- `sync_entities_metadata`, `sync_model_metadata`.

`keychain_identifier` (macOS) semantics: `U`, see **V7**.
`VK` `Login Data For Account` has an identical schema and holds the account-scoped store used when
signed in with password sync. **Parse both files** — omitting it loses most credentials for
signed-in users.

#### 2.6 Web Data / Account Web Data

`VK` `autofill` — form-field values the user typed. **The Unix-epoch outlier.**
```sql
CREATE TABLE autofill (
  name VARCHAR, value VARCHAR, value_lower VARCHAR,
  date_created   INTEGER DEFAULT 0,   -- UNIX SECONDS
  date_last_used INTEGER DEFAULT 0,   -- UNIX SECONDS
  count INTEGER DEFAULT 1,
  PRIMARY KEY (name, value));
```
A goldmine: search boxes, email fields, usernames, addresses typed into any form, with first/last-use
dates and a use count.

**Addresses — the biggest schema break in the range** (`U` on the boundary, see **V3**):
- *Older half*: `autofill_profiles(guid, company_name, street_address, dependent_locality, city,
  state, zipcode, sorting_code, country_code, date_modified, origin, language_code, use_count,
  use_date, label, …)` with satellites `autofill_profile_names`, `autofill_profile_emails`,
  `autofill_profile_phones`, `autofill_profile_addresses`, `autofill_profiles_trash`.
- *Newer half*: normalised EAV — `local_addresses(guid, use_count, use_date, date_modified,
  language_code, label, initial_creator_id, last_modifier_id, …)` +
  `local_addresses_type_tokens(guid, type, value, verification_status, observations)` where `type`
  is an `autofill::FieldType` int. Account equivalents: `contact_info` / `contact_info_type_tokens`.
**v2 must implement both readers and choose on table presence.**

`L` `credit_cards(guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER,
expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER, origin VARCHAR,
use_count INTEGER, use_date INTEGER, billing_address_id VARCHAR, nickname VARCHAR)`.
Plaintext encoding of `card_number_encrypted` is `U` (V12). Server cards live in
`masked_credit_cards` + `server_card_metadata` (last four digits only, never the PAN). `L` Also
present in the newer half: `masked_ibans`/`local_ibans`, `payments_customer_data`, `offer_data`,
`masked_bank_accounts`, `payment_instruments`, `masked_credit_card_benefits`, `loyalty_cards`,
`entity_instances` (Autofill-AI, late range).

`L` `keywords` — search engines, and the join target for `keyword_search_terms`:
```sql
CREATE TABLE keywords (
  id INTEGER PRIMARY KEY, short_name VARCHAR NOT NULL, keyword VARCHAR NOT NULL,
  favicon_url VARCHAR NOT NULL, url VARCHAR NOT NULL,
  safe_for_autoreplace INTEGER NOT NULL, originating_url VARCHAR,
  date_created INTEGER DEFAULT 0, usage_count INTEGER DEFAULT 0,
  input_encodings VARCHAR, suggest_url VARCHAR, prepopulate_id INTEGER DEFAULT 0,
  created_by_policy INTEGER DEFAULT 0, last_modified INTEGER DEFAULT 0,
  sync_guid VARCHAR, alternate_urls VARCHAR, image_url VARCHAR,
  search_url_post_params VARCHAR, suggest_url_post_params VARCHAR,
  image_url_post_params VARCHAR, new_tab_url VARCHAR,
  last_visited INTEGER DEFAULT 0, created_from_play_api INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0, starter_pack_id INTEGER DEFAULT 0,
  enforced_by_policy INTEGER DEFAULT 0, featured_by_policy INTEGER DEFAULT 0);
```
`safe_for_autoreplace = 0` with `prepopulate_id = 0` indicates a **user-added or site-installed
(OpenSearch) engine** — worth flagging. Timestamp epoch here is `U` (V6).

`L` `token_service(service VARCHAR PRIMARY KEY, encrypted_token BLOB)` — OAuth refresh tokens,
OSCrypt-encrypted. Highest-sensitivity item in `Web Data`; a valid refresh token is a live account
takeover primitive. **v2 should redact by default.**

#### 2.7 Cookies (`Network/Cookies`)

`L`
```sql
CREATE TABLE cookies (
  creation_utc INTEGER NOT NULL,      -- Chrome epoch µs
  host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
  name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL,
  path TEXT NOT NULL,
  expires_utc INTEGER NOT NULL,       -- Chrome epoch µs
  is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
  last_access_utc INTEGER NOT NULL,   -- Chrome epoch µs
  has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
  priority INTEGER NOT NULL, samesite INTEGER NOT NULL,
  source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL,
  last_update_utc INTEGER NOT NULL,   -- Chrome epoch µs
  source_type INTEGER NOT NULL,
  has_cross_site_ancestor INTEGER NOT NULL);
```
`source_type` (0 UNKNOWN, 1 HTTP, 2 SCRIPT, 3 OTHER) and `has_cross_site_ancestor` land **inside**
the range; `top_frame_site_key` is the CHIPS partition key. The domain-prefix binding on the
decrypted plaintext is `U` — see **V5**, and it affects every cookie value.

---

### 3. Encryption

**3.1 `VK` Two-layer model.** Per-value ciphertext in `Login Data`, `Cookies`,
`credit_cards.card_number_encrypted`, `token_service`, `password_notes.value` is produced by
`OSCrypt` (`components/os_crypt/sync/os_crypt.h`). Ciphertext begins with a 3-byte ASCII version
tag: `v10`, `v11`, or (Windows, M127+) `v20`. **An absent tag means plaintext** (legacy rows) — v2
should detect and report that rather than failing.

**3.2 `VK` Windows, pre-ABE (`v10`).**
1. `Local State` → `os_crypt.encrypted_key` (base64).
2. Base64-decode. The blob starts with the 5-byte ASCII prefix **`DPAPI`**. Strip it.
3. `CryptUnprotectData()` in the **user's** context (or offline via the user's DPAPI master key +
   password/NTLM hash) → a **32-byte AES-256 key**.
4. Value layout: `"v10" || 12-byte nonce || ciphertext || 16-byte GCM tag`, AES-256-GCM
   (plus the domain-prefix caveat of V5 for cookies).

**3.3 `VK` macOS (`v10`).** Key material is a random password in the **login Keychain**, service
`Chrome Safe Storage`, account `Chrome` (Chromium: `Chromium Safe Storage`). Derivation:
`PBKDF2-HMAC-SHA1(password, salt="saltysalt", iterations=1003, dkLen=16)` → **AES-128-CBC**,
IV = 16 × `0x20` (spaces). `os_crypt.encrypted_key` is **not** used on macOS.
Newer macOS per-credential Keychain items: see V7.

**3.4 `VK` Linux (`v10` / `v11`).** Same PBKDF2/AES-128-CBC construction but **iterations = 1**.
- `v11` — password from the OS keyring (`gnome-libsecret`/`kwallet`), item label
  `Chrome Safe Storage`. Needs the live keyring or an offline keyring crack.
- `v10` — the "basic" store; password is the **hardcoded string `peanuts`**, so Linux `v10` is
  trivially decryptable offline with no secrets at all. v2 should always try this on Linux.
Source: `components/os_crypt/sync/os_crypt_linux.cc`, `key_storage_linux.cc`.

**3.5 App-Bound Encryption (Windows, from M127) — the decisive item.**

`VK` **That ABE exists, is Windows-only, arrived at M127, and introduced the `v20` prefix for
cookies.** `L` The mechanism: a second key in `Local State` under `os_crypt`, named
`app_bound_encrypted_key`, base64 with a 4-byte `APPB` prefix analogous to `DPAPI`; protected by the
**Chrome Elevation Service running as SYSTEM**, wrapped with SYSTEM-context DPAPI and then user
DPAPI, with a path/binary validation so only the Chrome executable at the registered install path
can request the unwrap.

`U` **Whether Login Data moved to `v20` at a different milestone than Cookies — see V1, the top of
the verification queue.** My working belief, to be confirmed: cookies at M127, passwords/payments
materially later (~M131–M132), possibly Finch-staged rather than milestone-gated.

`U` Later revisions may have added an extra obfuscation layer inside the elevation service (an
additional AES-GCM / ChaCha20 unwrap of the returned key). **Do not assume `v20` unwrap is a single
fixed algorithm across 127→153.**

Offline-forensics consequences — state these plainly in the tool's UX:
- Running as the live user is **no longer sufficient** for `v20`; that is the entire point of ABE.
- **Full-disk offline recovery remains possible**: recover the `DPAPI_SYSTEM` LSA secret from the
  `SYSTEM`/`SECURITY` hives, derive the SYSTEM DPAPI master keys, unwrap the SYSTEM layer, then the
  user layer with the user's DPAPI master key. This needs **registry hives in addition to** the user
  data dir — an acquisition requirement v2 should document and check for up front.
- `VK` A profile will contain a **mixture** of `v10` and `v20` values; migration is lazy/per-write.
  **Decrypt per row, dispatch on prefix, report per-row failures.** Never gate on a version number.
Sources: `chrome/elevation_service/`,
`components/os_crypt/async/browser/app_bound_encryption_win.cc`,
`.../app_bound_encryption_provider_win.cc`.

**3.6 `VK` OSCrypt Async.** Across this range Chrome moved to `os_crypt_async` with multiple key
providers and a tag-per-provider scheme — that is precisely the mechanism making `v10`/`v20`
coexistence normal. Design v2's decryptor as a **registry of prefix → provider**, mirroring
Chromium's own structure. Source: `components/os_crypt/async/`.

---

### 4. Cache — Simple Cache on-disk format

**4.1 Backend selection.** `VK` Simple Cache is the default HTTP-cache backend on Android, ChromeOS,
Linux, and macOS. `U` **Windows is the open question — see V2**, the second-ranked verification item.
GPUCache, `Code Cache/js`, `Code Cache/wasm`, and the Dawn caches are Simple Cache format on all
platforms. If you find `data_0`–`data_3` + `f_######`, that is blockfile and needs a separate reader.

**4.2 `VK` Directory contents** (`Cache/Cache_Data/`):
- `index` — small stub; the real index is `index-dir/the-real-index`.
- `<16 lowercase hex chars>_0` — main entry file (streams 0 and 1).
- `<…>_1` — stream 2 (metadata, e.g. V8 compiled-code cache).
- `<…>_s` — sparse-data file (range requests, media).
- `todelete_*` — doomed entries pending removal; **still readable, and themselves evidence of
  deletion activity.**

**4.3 `VK` URL key → filename.** The entry hash is the **first 8 bytes of SHA-1(cache key)**, rendered
as 16 lowercase hex characters. `U` exact byte order — see V8. Consequence: you can *verify* a
URL→file mapping but not recover the URL from the filename. The URL is stored in the file, so
enumeration works either way.

**4.4 `VK` Cache key format** (this is what gets hashed, not the bare URL):
- Simple case: the URL string.
- With HTTP-cache partitioning (double-keying), a prefix is prepended, e.g.
  `_dk_<top_frame_site> <frame_site> <url>`, with variants for the cross-site-ancestor bit and for
  credentialless loads (`L`), plus a `1/0/` style prefix for special modes (`L`). Grammar detail: V8.
**Practical rule: do not synthesise keys. Read the key out of each `_0` file** — it is stored verbatim.

**4.5 `L` `_0` file layout:**
```
SimpleFileHeader {
  uint64 initial_magic_number = 0xfcfb6d1ba7725c30
  uint32 version                       (5 in this range)
  uint32 key_length
  uint32 key_hash
}
key bytes (key_length, no NUL)
<stream 1 data>            <-- HTTP RESPONSE BODY
SimpleFileEOF {
  uint64 final_magic_number = 0xf4fa6f45970d41d8
  uint32 flags               (1 = CRC32_PRESENT, 2 = HAS_KEY_SHA256)
  uint32 data_crc32
  int32  stream_size
}
[optional 32-byte SHA-256 of key, if HAS_KEY_SHA256]
<stream 0 data>            <-- SERIALIZED HTTP RESPONSE HEADERS (base::Pickle)
SimpleFileEOF { ... }
```
`VK` Note the **inversion**: stream 1 (body) is written first, stream 0 (headers) last. Read backwards
from EOF, or forward using each EOF record's `stream_size`. `VK` Bodies are stored **as received**, so
`Content-Encoding: gzip/br` payloads are still compressed on disk — decompress before keyword search
or you will miss content.
Headers are a `base::Pickle` of `HttpResponseInfo`: status line, NUL-separated headers,
`request_time`/`response_time` as **Chrome epoch µs**, cert info. `U` exact pickle field ordering —
verify in `net/http/http_response_info.cc` (`InitFromPickle`/`Persist`). Struct definitions:
`net/disk_cache/simple/simple_entry_format.h`, `simple_synchronous_entry.cc`.

**4.6 `VK` `index-dir/the-real-index`** is a fast-boot hint file (entry hash, last-used time, size,
memory-entry-data). It is **not authoritative** — it can be stale or rebuilt. Enumerate `_0` files on
disk; use the index only for last-used times, which are otherwise unavailable.

---

### 5. `Preferences` and `Secure Preferences`

**5.1 `VK` `Preferences` (plaintext JSON) — forensically useful keys:**
- `account_info[]` — signed-in Google accounts: `account_id`, `email`, `gaia`, `full_name`,
  `given_name`, `hd` (hosted domain), `locale`, `picture_url`,
  `last_downloaded_image_url_with_size`, `accountcapabilities`, `is_supervised_child`.
  **The primary account-attribution artifact.**
- `profile.name`, `profile.created_by_version` (Chrome version that created the profile — a useful
  cross-check on which schema variant to expect), `profile.creation_time` (Chrome µs, as a string),
  `profile.exit_type` (`Normal` / `Crashed` / `SessionEnded`), `profile.last_engagement_time`.
- `profile.content_settings.exceptions.<type>` — per-origin permission grants (notifications,
  geolocation, media stream, clipboard…), each with `setting` and `last_modified` (Chrome µs
  string). Strong "user was here and interacted" signal.
- `sessions.event_log[]` (`L`) — ring buffer of session events: `type` (0 start, 1 restore, 2 exit,
  3 crash), `time` (Chrome µs string), `crashed`, `window_count`, `tab_count`,
  `did_schedule_command`. **Excellent browser start/stop timeline that survives history clearing.**
- `download.default_directory`, `savefile.default_directory`, `download.directory_upgrade`.
- `partition.per_host_zoom_levels.<partition>` — hosts the user deliberately adjusted, with
  `last_modified` (`L`).
- `custom_links.list` (pinned NTP tiles), `ntp.custom_background_dict`, `translate_site_blocklist`,
  `browser.window_placement`, `pinned_tabs`, `media_router`, `devtools.preferences`,
  `webauthn.touchid.metadata` (`L` — passkey metadata incl. user names), `password_manager.*`,
  `autofill.profile_enabled` / `autofill.credit_card_enabled`, `signin.allowed`, `gaia_cookie.*`.

**5.2 `VK` `Secure Preferences` (JSON + HMAC):**
- `extensions.settings.<32-char id>` — the **authoritative extension inventory**: full `manifest`,
  `path` (relative under `Extensions/`, or **absolute for unpacked/sideloaded — a strong sideload
  indicator**), `state` (0 disabled, 1 enabled, 2 externally/blocklist-disabled `L`),
  `from_webstore`, `was_installed_by_default`, `was_installed_by_oem`, `install_time` **or**
  `first_install_time` + `last_update_time` (Chrome µs as **decimal strings**),
  `granted_permissions.{api,explicit_host,scriptable_host}`, `location` (`L`: 1 internal,
  2 external-pref, 3 external-registry, 4 unpacked/LOAD, 5 component, 10 external-component),
  `disable_reasons`, `creation_flags`, `ack_external`. Both the old `install_time` and the newer
  `first_install_time`/`last_update_time` pair may appear depending on install age — **read both**.
- `protection.macs.<pref path>` — per-pref **HMAC-SHA256**, plus `protection.super_mac` over the
  set. Keyed by a seed compiled into branded Chrome plus a machine/device ID. Forensic value: a
  **MAC mismatch means the pref was edited outside Chrome** (hijack/malware — or examiner
  tampering). v2 cannot recompute branded MACs, so **report presence/structure, not validity** (`L`).
- `homepage`, `homepage_is_newtabpage`, `session.startup_urls`, `session.restore_on_startup`,
  `default_search_provider_data.template_url_data`, `pinned_extensions` — these live here precisely
  because they are hijack targets.
Sources: `services/preferences/tracked/`, `chrome/browser/prefs/chrome_pref_service_factory.cc`,
`extensions/browser/extension_prefs.cc`.

**5.3 `U` `sync.birthday` and `sync.demographics` — v1 reads these; treat as NOT PRESENT until
verified. See V4a/V4b in the ranked queue for exact symbols and expected shapes.**
Two independent traps: `sync.birthday` is a **server-issued sync token, not a date of birth**, and
`sync.demographics.birth_year` is **noised by a sibling offset pref** so a naive read produces a
confidently wrong birth year. v2 should implement both as optional, best-effort, never-required, and
must surface the offset alongside any birth year it reports.

---

### 6. Timestamp encodings

`VK` **Chrome / WebKit epoch = microseconds since 1601-01-01 00:00:00 UTC**
(`base::Time::ToDeltaSinceWindowsEpoch().InMicroseconds()`; historically `ToInternalValue()`).
Convert: `unix_seconds = chrome_us / 1_000_000 - 11_644_473_600`.
`0` means "never/unset". `L` `base::Time::Max()` (`9223372036854775807`) appears in
`Cookies.expires_utc` and must not be formatted naively.

| Artifact / column | Epoch | Tier |
|---|---|---|
| `History.urls.last_visit_time` | Chrome µs | `VK` |
| `History.visits.visit_time` | Chrome µs | `VK` |
| `History.visits.visit_duration` | **duration in µs**, not a timestamp | `VK` |
| `History.downloads.start_time / end_time / last_access_time` | Chrome µs | `VK` |
| `History.segment_usage.time_slot` | Chrome µs, floored to **local** midnight | `L` |
| `Favicons.favicon_bitmaps.last_updated / last_requested` | Chrome µs | `VK` |
| `Shortcuts.omni_box_shortcuts.last_access_time` | Chrome µs | `L` |
| `Login Data.logins.date_created / date_last_used / date_password_modified / date_received` | Chrome µs | `L` |
| `Login Data.stats.update_time`, `insecure_credentials.create_time`, `password_notes.date_created` | Chrome µs | `L` |
| `Cookies.cookies.creation_utc / expires_utc / last_access_utc / last_update_utc` | Chrome µs | `VK` |
| **`Web Data.autofill.date_created / date_last_used`** | **Unix seconds** | `VK` — the classic trap |
| `Web Data.credit_cards.date_modified / use_date` | Chrome µs | `L` |
| `Web Data.local_addresses / autofill_profiles .date_modified / use_date` | Chrome µs | `L` |
| `Web Data.keywords.date_created / last_modified / last_visited` | Chrome µs | `U` — **V6** |
| `Preferences` / `Secure Preferences` times (`install_time`, `creation_time`, `last_modified`, `sessions.event_log[].time`) | Chrome µs, as **decimal strings** | `VK` |
| `Bookmarks` JSON `date_added` / `date_modified` / `date_last_used` | Chrome µs, **decimal strings** | `VK` |
| Simple Cache `HttpResponseInfo.request_time / response_time` | Chrome µs | `L` |
| Local Storage LevelDB `META:<origin>` protobuf `last_modified` | Chrome µs | `L` |
| `Sessions/*` SNSS command timestamps | Chrome µs | `L` |

`VK` All Chrome-epoch values are **UTC**. `segment_usage.time_slot` is the one place local-timezone
bucketing leaks in — it is the browser's local midnight at write time, so a timezone change during
the profile's life makes those buckets internally inconsistent. Worth a caveat in v2's output.

---

### 7. Where formats vary across 120→153 — fixture matrix

Rank-ordered by how much it can break a parser.

1. **App-Bound Encryption (Windows)** — `v10` → `v20`, **cookies before Login Data** (V1).
   **Fixtures:** Windows M120-ish (`v10` only); Windows post-ABE-cookies (**mixed**: `v10` logins +
   `v20` cookies — this is the fixture that catches version-gating bugs); Windows late-range
   (`v20` throughout). Plus a `Local State` with `os_crypt.encrypted_key` only vs. one that also has
   `app_bound_encrypted_key`.
2. **Autofill address rewrite** (V3) — `autofill_profiles` + satellites → `local_addresses` +
   `local_addresses_type_tokens`; account side `contact_info*`. **Fixtures: one `Web Data` each side.**
3. **`History.visits` column growth** — `external_referrer_url`, `visited_link_id`, `app_id`, plus
   the `visited_links` table. **Fixtures: `History` from the bottom and top of the range.**
4. **`Cookies.cookies` column growth** — `source_type`, `has_cross_site_ancestor`, plus the
   domain-prefixed plaintext change (V5). **Fixtures: pre- and post-.**
5. **`logins` column growth** — `keychain_identifier` (macOS), `sender_email`/`sender_name`/
   `date_received`/`sharing_notification_displayed`, `sender_profile_image_url`; removal of the old
   `field_info` table. **Fixture: macOS logins with and without `keychain_identifier`.**
6. **History Clusters / Journeys tables** (V9) present-and-populated → possibly absent/empty late.
   Must be optional.
7. **Web Data payments table churn** — `masked_ibans`, `masked_bank_accounts`, `payment_instruments`,
   `masked_credit_card_benefits`, `loyalty_cards`, `entity_instances`. Additive; ignore unknown
   tables gracefully.
8. **`VK` WAL vs rollback journal.** Journal mode differs per DB and per version, so an acquisition
   may include `-wal`/`-shm` files carrying **committed-but-not-checkpointed rows**. v2 **must** copy
   `*-wal`/`*-shm` alongside the DB and open read-only with WAL applied — and should offer a
   WAL-excluded comparison pass, since the delta is itself evidence of very recent activity.
   **Fixture: a History DB with a non-empty `-wal`.**
9. **Simple Cache on Windows** (V2) and the `_dk_` key grammar (V8). **Fixture: `Cache_Data` per OS.**
10. **Profile-level:** `profile.profiles_order`; presence of `Guest Profile` / `System Profile`;
    `Login Data For Account` and `Account Web Data` exist only when signed in.
    **Fixture: one signed-in and one signed-out profile.**

**Cross-cutting parser rules this implies — the real architectural deliverable for v2:**
- Read `meta.version` for provenance, but **branch on `PRAGMA table_info(...)` / `sqlite_master`,
  never on version numbers.** Column presence is self-describing; version tables are a maintenance
  burden that goes stale every six weeks.
- **Never `SELECT *`.** Select the intersection of requested and present columns; emit `null` for
  absent ones.
- **Decrypt per row, dispatching on the 3-byte prefix**, with no version gating; record per-row
  failure reasons in the output. This is the single design decision that makes V1's answer
  non-blocking for implementation.
- Treat every optional table/file as optional; unknown tables must never fail a run.
- Attach a provenance record (file path, `meta.version`, observed column set, decryption method and
  per-row outcome) to every extracted artifact so the output is defensible in a report.

---

## Sources

**Primary (Chromium source; base `https://source.chromium.org/chromium/chromium/src/+/main:`)**

- `components/history/core/browser/history_database.cc` — History `meta.version` + full migration list.
- `components/history/core/browser/url_database.cc` — `urls`, `keyword_search_terms` DDL.
- `components/history/core/browser/visit_database.cc` — `visits`, `visit_source` DDL.
- `components/history/core/browser/download_database.cc` — downloads DDL.
- `components/history/core/browser/visitsegment_database.cc` — `segments`, `segment_usage`.
- `components/history/core/browser/thumbnail_database.cc` — Favicons DDL, `icon_type` enum.
- `components/history/core/browser/top_sites_database.cc` — `top_sites` DDL.
- `components/omnibox/browser/shortcuts_database.cc` — `omni_box_shortcuts` DDL **(V11)**.
- `components/password_manager/core/browser/password_store/login_database.cc` — `logins` DDL, version, `keychain_identifier` **(V1, V7, V10)**.
- `components/autofill/core/browser/webdata/autofill_table.cc` — Web Data migrations; `autofill` epoch.
- `components/autofill/core/browser/webdata/addresses/address_autofill_table.cc` — `local_addresses`/`contact_info` DDL **(V3)**.
- `components/autofill/core/browser/webdata/payments/payments_autofill_table.cc` — cards/IBANs **(V12)**.
- `components/search_engines/keyword_table.cc` — `keywords` DDL and timestamp epoch **(V6)**.
- `net/extras/sqlite/sqlite_persistent_cookie_store.cc` — `cookies` DDL, schema version, domain-prefix binding **(V5, V10)**.
- `components/os_crypt/sync/os_crypt_win.cc` / `os_crypt_linux.cc` / `keychain_password_mac.mm` — `DPAPI` prefix, PBKDF2 params, keyring/Keychain item names.
- `components/os_crypt/async/browser/app_bound_encryption_provider_win.cc`, `chrome/elevation_service/` — ABE, `v20`, `APPB` **(V1)**.
- `chrome/browser/net/profile_network_context_service.cc`, `services/network/network_service.cc` — which stores get the app-bound provider **(V1)**.
- `net/disk_cache/disk_cache.cc`, `net/disk_cache/backend_experiment.h` — backend selection per platform **(V2)**.
- `net/disk_cache/simple/simple_entry_format.h`, `simple_synchronous_entry.cc`, `simple_util.cc` — Simple Cache magics, stream ordering, hashing **(V8)**.
- `net/http/http_cache.cc` — cache key generation / `_dk_` grammar **(V8)**.
- `net/http/http_response_info.cc` — cached-headers pickle layout.
- `ui/base/page_transition_types.h` — `visits.transition` decoding.
- `components/download/public/common/download_danger_type.h`, `download_interrupt_reason_values.h` — download enums.
- `services/preferences/tracked/`, `chrome/browser/prefs/chrome_pref_service_factory.cc` — Secure Preferences MAC scheme.
- `extensions/browser/extension_prefs.cc` — extension pref keys, `location` enum.
- `components/sync/base/pref_names.h`, `components/sync/service/sync_transport_data_prefs.cc` — **`sync.birthday` (V4a)**.
- `components/metrics/demographics/user_demographics.cc` — **`sync.demographics` + noise offset (V4b)**.
- `chrome/common/chrome_paths_{win,mac,linux}.cc` — user-data-dir and cache-dir roots.
- `chrome/browser/profiles/profile_attributes_entry.cc` — `profile.info_cache` field names.
- `https://chromiumdash.appspot.com/branches` — milestone → branch-head mapping for permalinks.

**Dropped**
- Third-party forensic blog posts and vendor tool docs — the task prefers primary sources, and in
  this area secondary write-ups are typically pinned to one Chrome build and go stale within two
  milestones. Several also propagate the `sync.birthday` = "date of birth" error (see §5.3).
- Anything describing pre-M120 behaviour or the v80→v120 delta — out of scope by instruction.

---

## Gaps

**One structural gap:** no web/fetch tool was available in this run, so nothing was checked against a
live primary source in this session. That is handled by the **ranked verification queue** above
(V1–V12), which the parent will execute top-down with browser tooling. Everything marked `VK` is
offered as directly encodable; `L` items are safe to design against; only `U` items are queued.

**Suggested next steps**
1. Work the queue top-down. V1–V4 are the only items that change what gets built; V5–V12 change
   correctness of individual fields and can be batched.
2. Build the **fixture matrix from §7**. Minimum viable set is six profiles — Win-M120, Win-late
   (ABE), macOS-late, Linux-late, signed-in, signed-out — plus one History DB with a non-empty `-wal`.
3. Encode the "cross-cutting parser rules" at the end of §7 as v2 architecture decisions now. They
   hold **regardless of how any `U` item resolves**, and in particular per-row prefix dispatch makes
   V1's answer non-blocking for implementation — V1 then only determines *how much* is recoverable,
   not *how the code is shaped*.

---

## Severity flags for ForensiX v2

| # | Item | Severity | Why |
|---|---|---|---|
| 1 | `Local State` must be resolvable (acquire the **user data dir**, not a bare profile) | **Blocker** | Without it, no `v10`/`v20` decryption at all. |
| 2 | App-Bound Encryption `v20` handling on Windows | **Blocker** | Silent total failure on cookies/passwords for recent Windows profiles. |
| 3 | Version-gating decryption instead of per-row prefix dispatch | **Blocker** | Directly caused by getting V1 wrong: the tool would refuse to decrypt passwords it can actually read. |
| 4 | `Web Data.autofill` Unix-seconds vs everything else Chrome-µs | **High** | Wrong-by-centuries timestamps in a forensic report. |
| 5 | Autofill address dual-schema reader | **High** | Total loss of address artifacts on one side of the cutover. |
| 6 | `-wal` / `-shm` must be copied and applied | **High** | Missing uncheckpointed rows = missing the most recent activity. |
| 7 | `SELECT *` anywhere | **High** | Breaks on every additive migration in §7. |
| 8 | `Login Data For Account` / `Account Web Data` not parsed | **High** | Most credentials/addresses missing for signed-in users. |
| 9 | Cookie plaintext domain-prefix stripping | **Medium** | Garbage prefix on every cookie value. |
| 10 | macOS/Linux cache lives outside the profile dir | **Medium** | Silently empty cache results. |
| 11 | `sync.birthday` / `sync.demographics` treated as required (v1 behaviour) | **Medium** | Likely absent now → crash or false data; and the demographics noise offset makes naive output *wrong*, not merely missing. |
| 12 | `token_service` / `password_notes.value` decrypted output | **Medium** | Live-credential material; redact by default. |
| 13 | `visit_duration` treated as a timestamp | **Low** | Nonsense dates; trivial to get right. |
