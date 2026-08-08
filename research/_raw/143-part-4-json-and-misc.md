# #143 Part 4 — JSON and non-SQLite artifacts + remaining DBs

**Status: COMPLETE for the artifacts marked resolved; open items are enumerated in §11.**
Every claim below was read from live Chromium source in this run and is cited with path + line +
ref. Anything not read is marked `UNRESOLVED` and appears in the §11 queue rather than being
guessed — a blank beats a believable wrong date.

**Date:** 2026-08-08 (repo clock)
**Live source access:** YES — gitiles `chromium.googlesource.com/chromium/src` over `?format=TEXT`.
**Primary ref read:** `refs/heads/main` = **`ba3c200c1564977873107f5656c015253ba129b1`**
(confirmed via `+/refs/heads/main?format=JSON`; its parent is `cb211f647e4138888643a909973b2d07d49ae79c`,
the ref used by the salvage file `143-confirmed-partial.md` — so this run is exactly one
autoroll commit ahead of that one, and line numbers are directly comparable).
Every file below was fetched at that ref unless a `refs/tags/<version>` pin is stated inline.

Scope assigned: `Bookmarks` (+ `Bookmarks.bak`), `Preferences`, `Secure Preferences`,
`Local State`, `Sessions`/`Tabs` (SNSS), `Media History`, `Extension State` /
`Extension Cookies`, `Site Characteristics`, `Reporting and NEL`, `Trust Tokens`,
`Affiliation Database`.

---

## 0. Encoding primitives (read first)

### 0.1 `base::TimeToValue` — the canonical JSON time encoding = **decimal STRING of 1601-µs**

`base/json/values_util.cc` @ `ba3c200`:

```cpp
// line 37
Value Int64ToValue(int64_t integer) {
  return Value(NumberToString(integer));      // <-- JSON STRING, not number
}
// line 58
Value TimeDeltaToValue(TimeDelta time_delta) {
  return Int64ToValue(time_delta.InMicroseconds());
}
// line 74
Value TimeToValue(Time time) {
  return TimeDeltaToValue(time.ToDeltaSinceWindowsEpoch());
}
```

Read side (line 46-56, 82-88): `ValueToInt64` **requires `value.is_string()`** and
`StringToInt64`s it; `ValueToTime` wraps it in
`Time::FromDeltaSinceWindowsEpoch(Microseconds(n))`.

**Conclusions, primary-sourced:**
- `base::TimeToValue` ⇒ **1601-µs UTC, serialised as a JSON string**. Confirmed.
- The read path **rejects a JSON number outright** (`if (!value.is_string()) return nullopt`).
  A tool that rewrites a `Preferences`/`Bookmarks` time as a JSON number does not merely lose
  precision — Chrome silently treats the key as absent. Relevant to any write-back/normalisation
  step in forensix.
- `TimeDeltaToValue` produces the **same string shape** for a *duration*. A decimal string in
  JSON is therefore **not** self-identifying as absolute-vs-relative. Must be decided per key.

### 0.2 The string shape does NOT imply 1601-µs

`base::NumberToString(int64)` and `PrefService::SetInt64` produce the identical
quoted-decimal shape for *any* int64, including Unix seconds. See §2. The
"quoted string ⇒ 1601-µs" heuristic flagged as suspect in `143-leads-unverified.md` §5.1 is
confirmed unsafe **by construction** (`Int64ToValue` is the only stringifier and it is
epoch-agnostic). Per-key verification is required.

---

## 1. Bookmarks (JSON) + `Bookmarks.bak`

**Writer:** `components/bookmarks/browser/bookmark_codec.cc` @ `ba3c200`.

### 1.1 The three timestamps — CONFIRMED 1601-µs decimal STRINGS

Helper, line 69-72:

```cpp
// Helper function to convert Time to microseconds since Windows epoch.
int64_t ToMicrosecondsSinceWindowsEpoch(Time time) {
  return time.ToDeltaSinceWindowsEpoch().InMicroseconds();
}
```

Serialisation site, `BookmarkCodec::EncodeNode`, lines 175-197:

```cpp
  value.Set(kDateAddedKey, base::NumberToString(ToMicrosecondsSinceWindowsEpoch(
                               node->date_added())));            // line 183-184
  value.Set(kDateLastUsed, base::NumberToString(ToMicrosecondsSinceWindowsEpoch(
                               node->date_last_used())));        // line 185-186
  if (node->is_url()) { ... } else {
    value.Set(kDateModifiedKey,
              base::NumberToString(ToMicrosecondsSinceWindowsEpoch(
                  node->date_folder_modified())));               // line 194-196
  }
```

Key names, lines 48/50/56:
`kDateAddedKey = "date_added"`, `kDateModifiedKey = "date_modified"`, `kDateLastUsed = "date_last_used"`.

| JSON key | Applies to | Epoch | Encoding | Source |
|---|---|---|---|---|
| `date_added` | every node (url + folder) | **1601-µs UTC** | JSON **string**, decimal | `bookmark_codec.cc:183-184` @ `ba3c200` |
| `date_last_used` | every node (url + folder) | **1601-µs UTC** | JSON **string**, decimal | `bookmark_codec.cc:185-186` @ `ba3c200` |
| `date_modified` | **folders only** (inside the `else` branch of `is_url()`) | **1601-µs UTC** | JSON **string**, decimal | `bookmark_codec.cc:194-196` @ `ba3c200` |

All UTC — `ToDeltaSinceWindowsEpoch()` is timezone-free by definition; no `LocalMidnight`-style
call appears anywhere in this file.

Note it does **not** call `base::TimeToValue` (§0.1); it open-codes the identical encoding via
`NumberToString(...InMicroseconds())`. Same bytes on disk, different call site — do not grep for
`TimeToValue` and conclude Bookmarks is unencoded.

**`date_modified` is folder-only and is a *contents* timestamp** (`date_folder_modified`), i.e.
last add/remove/reorder of children — not an edit of the folder's own title. A URL bookmark has
no modification timestamp at all: renaming or re-pointing a bookmark leaves **no trace in this
file**. Explicit negative finding.

### 1.2 The string-typed hazard for parsers (this is the load-bearing point)

Decode path, `FindMicrosecondsSinceWindowsEpoch`, lines 75-88:

```cpp
  const std::string* string_value = dict.FindString(key);
  if (!string_value) { return std::nullopt; }
  int64_t microseconds = 0;
  if (!base::StringToInt64(*string_value, &microseconds)) { return std::nullopt; }
  return Time::FromDeltaSinceWindowsEpoch(base::Microseconds(microseconds));
```

1. **`FindString` — a JSON number is not accepted.** If a tool round-trips `Bookmarks` and emits
   `"date_added": 13380000000000000` (unquoted), Chrome reads it as *absent*, not as a number.
2. **Precision.** A current 1601-µs value is ~1.34×10¹⁷ > 2^53 ≈ 9.0×10¹⁵. Any consumer whose
   JSON parser maps values to IEEE-754 double (JavaScript `JSON.parse`, Python `json` **only if
   the string is coerced**, Go `encoding/json` into `interface{}`) loses the low ~5 bits →
   quantisation of roughly **16–32 µs**. Because Chrome writes a *string*, a correct parser is
   lossless; the loss only occurs if the consumer coerces. forensix must read these as
   strings/int64 and never through a float.
3. **Missing-key defaults differ per key and are forgeries.** Lines 367-369 and 383-386:
   - `date_modified` missing → `.value_or(Time::Now())`
   - `date_added` missing → `.value_or(Time::Now())`
   - `date_last_used` missing → `.value_or(Time())` — i.e. **0**

   So a bookmark imported from an HTML file or written by a third-party tool without
   `date_added` acquires **the time Chrome first parsed the file** as its `date_added`, and that
   value is then written back on the next save. It is indistinguishable on disk from a genuine
   creation time. **Flag in the integrity model.**
4. **Sentinel:** `date_last_used == 0` means "never used", NOT 1601-01-01T00:00:00Z. Must not be
   rendered as a date. (`Time()` default-constructs to the zero delta — `bookmark_codec.cc:386`.)
   `date_added`/`date_modified` have no 0 sentinel in the write path, but 0 in those keys should
   still be treated as "unknown" rather than 1601.

### 1.3 Versioning — there IS a version, and it has never moved

```cpp
// line 41
const char BookmarkCodec::kVersionKey[] = "version";
// line 58-59
// Current version of the file.
static const int kCurrentVersion = 1;
```

Written at line 105 (`main.Set(kVersionKey, kCurrentVersion);`) and enforced at decode,
lines 223-225:

```cpp
  std::optional<int> version = value.FindInt(kVersionKey);
  if (!version || *version != kCurrentVersion)
    return false;  // Unknown version.
```

**Findings:**
- Bookmarks has a top-level `"version"` — but it is an **exact-equality gate**, not a ladder.
  There is no `MigrateToVersionN` anywhere in this codec. Chromium has never shipped version 2.
- Therefore **`version` is useless as a format-generation discriminator for Bookmarks.** A file
  from 2012 and a file from 2026 both say `"version": 1`. Fields were added (see `date_last_used`,
  §1.5) *without* a version bump. This is an instance of the general problem this issue exists to
  address: **presence/absence of keys, not a version number, is the only generation signal.**
- Corollary for the integrity model: a `Bookmarks` file cannot be dated by its own version field.
  Use key-presence (`date_last_used`, `guid`, `sync_metadata`, `checksum_sha256`) as the
  generation proxy.

### 1.4 Checksum — MD5 today, SHA-256 behind a feature flag (dual-write transition in progress)

Lines 131-135, 492-499:

```cpp
  FinalizeChecksum();
  main.Set(kChecksumKey, computed_checksum_);
  if (base::FeatureList::IsEnabled(kEnableBookmarkCodecSHA256)) {
    main.Set(kChecksumSHA256Key, computed_sha256_checksum_);
  }
...
void BookmarkCodec::InitializeChecksum() {
  md5_hasher_ = crypto::obsolete::Md5();
  sha256_hasher_ = crypto::hash::Hasher(crypto::hash::kSha256);
}
```

- `"checksum"` = MD5 (`crypto::obsolete::Md5`), always written.
- `"checksum_sha256"` = SHA-256, written **only when `kEnableBookmarkCodecSHA256` is enabled**.
- Forensic value: **presence of `checksum_sha256` dates the file to a recent build with the flag
  on** — a usable generation marker in the absence of a version bump (§1.3). Its absence proves
  nothing (flag may be off).
- The checksum covers node id/title/url only (`UpdateChecksumWithUrlNode(id, title, url)` /
  `UpdateChecksumWithFolderNode(id, title)`, lines 190/197) — **the timestamps are NOT in the
  checksum.** Editing `date_added` in a `Bookmarks` file does **not** invalidate the checksum and
  Chrome will not detect it. This is a **tamper-detection gap** and belongs in the integrity model.

### 1.5 `Bookmarks.bak` and `date_last_used` introduction

- `Bookmarks.bak`: the codec has no knowledge of it (`grep -n 'bak' bookmark_codec.cc` → no hits
  @ `ba3c200`). It is produced by the atomic-write/backup layer in `BookmarkStorage` /
  `base::ImportantFileWriter`, not by the codec. **Same format, same encoding, byte-identical
  semantics** — it is the previous generation of the same serialisation. `UNRESOLVED`: the exact
  write-ordering guarantee (see verification queue).
- Milestone that introduced `date_last_used`: `UNRESOLVED` — not bisected in this run. See queue.


## 2. `Preferences` / `Secure Preferences` / `Local State` (JSON)

> **Scope statement, stated plainly: the pref set is OPEN-ENDED.** These three files are a
> free-form key/value tree written by ~every component in the browser. There is no registry of
> "all timestamp prefs" anywhere in Chromium and no schema. **Exhaustive coverage is not
> achievable and should not be attempted or implied by forensix.** What follows is (a) the
> *mechanism* that decides the encoding, which IS exhaustive and lets a analyst classify any key
> they encounter, and (b) the forensically load-bearing keys.

### 2.1 There is NO version field in any of these files

None of `Preferences`, `Secure Preferences`, or `Local State` carries a `version`, `meta.version`,
or schema number. **This is a finding, not an omission.** Consequences for the integrity model:

- Format generation must be inferred from **key presence** and **key naming**, e.g.
  `extensions.settings.<id>.install_time` (pre-M113-ish) vs
  `first_install_time` + `last_update_time` (post) — see §2.4.
- There is no migration ladder to bound the epoch. A stale key written by Chrome 40 can survive
  untouched in a 2026 profile forever, because prefs are only rewritten when the owning component
  touches them. **A `Preferences` file is a stratigraphic deposit, not a snapshot.** Two keys in
  the same file can have been written a decade apart in different encodings.
- Chrome's own protection against tampering is not a version but a **MAC**: `Secure Preferences`
  carries `protection.macs.<path>` HMACs over selected keys (and `super_mac`). `Preferences`
  and `Local State` have no such coverage for most keys. `UNRESOLVED`: exact MAC algorithm/seed
  — see verification queue.

### 2.2 The mechanism — how to classify ANY pref key (this is the exhaustive part)

`components/prefs/pref_service.cc` @ `ba3c200`:

```cpp
// line 418
void PrefService::SetInt64(std::string_view path, int64_t value) {
  CHECK_EQ(pref_registry_->GetRegisteredPrefType(path).value_or(
               PrefRegistry::RegisteredPrefType::kInt64),
           PrefRegistry::RegisteredPrefType::kInt64, base::NotFatalUntil::M143) << path;
  SetUserPrefValue(path, base::Int64ToValue(value));      // -> JSON STRING
}
// line 450
void PrefService::SetTime(std::string_view path, base::Time value) {
  CHECK_EQ(... RegisteredPrefType::kTime ...) << path;
  SetUserPrefValue(path, base::TimeToValue(value));       // -> JSON STRING of 1601-us
}
// line 437
void PrefService::SetUint64(std::string_view path, uint64_t value) {
  SetUserPrefValue(path, base::Value(base::NumberToString(value)));  // -> JSON STRING
}
```

**Three different setters all emit an indistinguishable quoted decimal string.** The registered
pref *type* is what disambiguates, and **that type is compile-time-only — it is not on disk.**

| Registration | Setter | On-disk shape | Epoch |
|---|---|---|---|
| `RegisterTimePref` | `SetTime` | quoted decimal string | **always 1601-µs UTC** (via `base::TimeToValue`, §0.1) |
| `RegisterInt64Pref` | `SetInt64` | quoted decimal string — **identical shape** | **whatever the caller passed** — commonly `ToTimeT()` = Unix seconds |
| `RegisterUint64Pref` | `SetUint64` | quoted decimal string | caller-dependent |
| `RegisterDoublePref` | `SetDouble` | JSON **number** (double) | caller-dependent; see §2.5 site engagement |
| `RegisterStringPref` | `SetString` | JSON string | may be ISO-8601, may be a version, may be anything |

**Rule for forensix:** a quoted decimal string in a Chrome pref file carries **no epoch
information whatsoever**. The `143-leads-unverified.md` §5.1 flag against
`125-integrity-facts-unverified.md`'s "quoted string ⇒ 1601-µs" heuristic is **CONFIRMED
UNSAFE by construction**, not merely suspected. The only in-band discriminator is **magnitude**:

| Digits | Value "now" (2026) | Family |
|---|---|---|
| 10 | ~1.7×10⁹ | Unix seconds |
| 11 | ~1.34×10¹⁰ | 1601 seconds |
| 13 | ~1.7×10¹² | Unix ms |
| 16 | ~1.7×10¹⁵ | Unix µs |
| 18 | ~1.34×10¹⁷ | **1601 µs** |

And the CHECK at line 419/451 gives a **usable secondary signal**: because `SetInt64` and
`SetTime` CHECK the registered type, a key registered with `RegisterTimePref` **cannot** have been
written by `SetInt64`. So identifying the registration in source is dispositive for that key.

### 2.3 The confirmed collision — two epochs, same shape, same file

This pair is the concrete demonstration and should go in the matrix verbatim.

**A. `Local State` → `uninstall_metrics.installation_date2` = Unix SECONDS**

`components/metrics/metrics_pref_names.h:18` @ `ba3c200`:
```cpp
// Set once, to the current epoch time, on the first run of chrome on this machine.
// Note: the 'uninstall_metrics' name is a legacy name and doesn't mean much.
inline constexpr char kInstallDate[] = "uninstall_metrics.installation_date2";
```
`components/metrics/metrics_state_manager.cc` @ `ba3c200`:
```cpp
// line 522
  registry->RegisterInt64Pref(prefs::kInstallDate, 0);
// line 227-231
  int64_t install_date = local_state_->GetInt64(prefs::kInstallDate);
  // Set the install date if this is our first run.
  if (install_date == 0) {
    local_state_->SetInt64(prefs::kInstallDate, base::Time::Now().ToTimeT());
```
⇒ **Unix seconds UTC** (`ToTimeT()`), stored as a **quoted decimal string** (10 digits).
**Sentinel: `0` = not yet set / cleared.** Cleared explicitly at line 610
(`local_state_->ClearPref(prefs::kInstallDate)`), so absence ≠ never-installed.

Forensic value: this is **Chrome's install / first-run date on this machine**, set once and
"attached to metrics reports forever thereafter" per the header comment. It is one of the very
few keys with genuine single-write semantics. Note line 407-410 will *restore* it from a
`client_info_backup` (Windows registry / CrOS backup), so it can **survive a profile wipe** —
it dates the *machine's* Chrome install, not the profile.

**B. `Preferences` → `profile.creation_time` = 1601-µs**

`chrome/common/pref_names.h:139`: `kProfileCreationTime[] = "profile.creation_time";`
`chrome/browser/profiles/profile_impl.cc` @ `ba3c200`:
```cpp
// line 451
  registry->RegisterTimePref(prefs::kProfileCreationTime, base::Time());
// line 743-744
  if (!prefs->HasPrefPath(prefs::kProfileCreationTime))
    prefs->SetTime(prefs::kProfileCreationTime, path_creation_time_);
// line 1053-1054
base::Time ProfileImpl::GetCreationTime() const {
  return prefs_->GetTime(prefs::kProfileCreationTime);
}
```
⇒ `RegisterTimePref` + `SetTime` ⇒ **1601-µs UTC**, quoted decimal string (18 digits).

**Critical provenance caveat, from the same file:** the value written is `path_creation_time_`,
which comes from `GetCreationTimeForPath(path)` (line 295-298):
```cpp
base::Time GetCreationTimeForPath(const base::FilePath& path) {
  ... return info.creation_time;
```
So `profile.creation_time` is **not** an internally generated Chrome timestamp — it is the
**filesystem creation time of the profile directory**, copied into prefs on first run
(line 369-377 fall back to `base::Time::Now()` only when the directory is created in-process).
This means:
- On filesystems without birth time, or after a copy/restore that resets it, the value is the
  time of the **copy**, not of the profile.
- It is a *derived* artifact and should be cross-checked against the directory's own metadata
  rather than treated as independent evidence. **Do not treat it as corroboration of the
  filesystem timestamp — it is the same observation recorded twice.** High-value integrity note.
- Written only `if (!prefs->HasPrefPath(...))` — never updated afterwards.

`profile.created_by_version` (`chrome/common/pref_names.h:1378`) is a **version string, not a
time** — but it is the single best "what Chrome generation created this profile" marker in a
file that has no version field (§2.1). Recommend forensix surface it.

**C. `Local State` → `user_experience_metrics.client_id_timestamp` = Unix SECONDS (⚠ LOCAL?)**

`components/metrics/metrics_pref_names.h:136-139`:
```cpp
// Date/time when the user opted in to UMA and generated the client id most
// recently (local machine time, stored as a 64-bit time_t value).
inline constexpr char kMetricsReportingEnabledTimestamp[] =
    "user_experience_metrics.client_id_timestamp";
```
Written `metrics_state_manager.cc:451-452`:
`local_state_->SetInt64(prefs::kMetricsReportingEnabledTimestamp, base::Time::Now().ToTimeT());`

⇒ **Unix seconds**. **The header comment says "local machine time"** but the write site is
`base::Time::Now().ToTimeT()`, which is **UTC** — `ToTimeT` is a UTC `time_t`. The comment appears
to mean "time from the local machine's clock" (i.e. untrusted/clock-skew-prone) rather than
"local timezone". **Resolve as UTC**, but flag the comment: it is exactly the kind of wording
that produces a timezone bug in a downstream tool. `UNRESOLVED` at the level of "is there a
legacy write path that used localtime" — see queue.

**D. `Local State` → `user_experience_metrics.stability.stats_buildtime`**
`metrics_pref_names.h:238-241`: *"Build time, in seconds since an epoch"* — the comment itself
declines to name the epoch. Registration/write site **NOT read in this run**. `UNRESOLVED`.

**E. `Local State` → variations = 1601-µs**
`components/variations/variations_seed_store.cc:578,580` @ `ba3c200`:
```cpp
  registry->RegisterTimePref(prefs::kVariationsLastFetchTime, base::Time());
  registry->RegisterTimePref(prefs::kVariationsSeedDate, base::Time());
```
Key names from `components/variations/pref_names.h:58,151`:
`"variations_last_fetch_time"`, `"variations_seed_date"`; also `"variations_safe_seed_date"`
(line 107) and `kVariationsSafeSeedFetchTime` (line 116).
⇒ `RegisterTimePref` ⇒ **1601-µs UTC strings** (the `SetTime` CHECK at `pref_service.cc:451`
makes any other setter a CHECK failure, so this registration is dispositive).
Forensically useful: `variations_last_fetch_time` is a **network-contact timestamp** — close to
"last time this browser talked to Google" — and is refreshed frequently, so it bounds
last-use even when history is cleared.

### 2.4 `Secure Preferences` — extension install times, and a real key-rename boundary

`extensions/browser/extension_prefs.cc` @ `ba3c200`.

**Write site**, `PopulateExtensionInfoPrefs`, lines 2367-2374:
```cpp
  std::string install_time_str = base::NumberToString(
      install_time.ToDeltaSinceWindowsEpoch().InMicroseconds());
  // Don't overwrite any existing first_install_time pref value so that we
  // preserve the original install time.
  if (!extension_dict->HasKey(kPrefFirstInstallTime)) {
    extension_dict->SetString(kPrefFirstInstallTime, install_time_str);
  }
  extension_dict->SetString(kPrefLastUpdateTime, install_time_str);
```
⇒ both `first_install_time` and `last_update_time` are **1601-µs UTC decimal strings**.
Note it open-codes the encoding (`NumberToString(...InMicroseconds())`) rather than calling
`TimeToValue` — same bytes.

**The deprecated key and the migration**, lines 197-200:
```cpp
// A preference that indicates when an extension was installed/updated.
// TODO(anunoy): DEPRECATED! Remove after M113.
// Use kPrefLastUpdateTime instead.
constexpr const char kPrefDeprecatedInstallTime[] = "install_time";
```
`ExtensionPrefs::BackfillAndMigrateInstallTimePrefs()`, lines 2556-2578, called from line 2224:
```cpp
    if (ext_dict->HasKey(kPrefDeprecatedInstallTime)) {
      std::string install_time_string;
      ext_dict->GetString(kPrefDeprecatedInstallTime, &install_time_string);
      // Populate the new 'last_update_time' pref.
      ext_dict->SetString(kPrefLastUpdateTime, install_time_string);
      // Backfill the 'first_install_time' pref with the existing install time.
      ext_dict->SetString(kPrefFirstInstallTime, install_time_string);
      // Remove the deprecated 'install_time' pref.
      ext_dict->Remove(kPrefDeprecatedInstallTime);
    }
```

**Findings — this is the highest-value pref result:**

1. `install_time` (single key) → split into `first_install_time` + `last_update_time`. The
   migration **copies the same string into both**, verbatim. **The epoch is preserved** (it is a
   string copy, not a re-serialisation) — so no epoch hazard here, unlike Login Data v8.
2. **But both new keys are FORGED for any extension installed before the migration.** For a
   pre-migration extension, `last_update_time == first_install_time` exactly, because both were
   backfilled from the one old value. **`last_update_time` for such an extension does NOT
   evidence an update.** This is structurally the same trap as
   `logins.date_password_modified` backfilled from `date_created` (`143-confirmed-partial.md` §3).
   Detection heuristic: `first_install_time == last_update_time` to the microsecond is either a
   never-updated extension or a backfill — indistinguishable. Do not assert "never updated".
3. **Presence of `install_time` in a profile dates it to pre-migration** (Chrome had not run a
   post-migration build against that profile). Presence of `first_install_time` without
   `install_time` means a post-migration build has opened it. **This is the generation
   discriminator that substitutes for the absent version field (§2.1)** for `Secure Preferences`.
4. **Milestone:** the source comment says *"DEPRECATED! Remove after M113"*, which places the
   split at **≤ M113** (the TODO postdates the split). The exact introducing milestone was **not
   bisected in this run** — `UNRESOLVED`, see queue. Do not quote a number.
5. `last_launch_time` (line 209, `kPrefLastLaunchTime`) is written via `SaveTime` (line 1877):
   ```cpp
   void SaveTime(prefs::DictionaryValueUpdate* dictionary, const char* key,
                 const base::Time& time) { ... dictionary->Set(key, base::TimeToValue(time)); }  // line 269-277
   ```
   ⇒ **1601-µs UTC string** via `TimeToValue`. Same for `last_ping_day` (lines 1231/1240) and
   `last_active_ping_day` (line 1256).
6. Read side (`ReadTime`, lines 281-291) returns `base::Time()` = **0** when the key is absent.
   **`0` is "unknown", never 1601-01-01.**

### 2.5 Content settings in `Preferences` — 1601-µs strings, and keys OMITTED when zero

`components/content_settings/core/browser/content_settings_pref.cc` @ `ba3c200`, keys at
lines 45-51: `"expiration"`, `"last_used"`, `"last_visit"`, `"model"`, `"setting"`,
`"last_modified"`, `"lifetime"`.

Write site, lines 534-557:
```cpp
      if (metadata.last_modified() != base::Time()) {
        settings_dictionary->SetKey(kLastModifiedKey, base::TimeToValue(metadata.last_modified()));
      }
      if (metadata.expiration() != base::Time()) {
        settings_dictionary->SetKey(kExpirationKey, base::TimeToValue(metadata.expiration()));
      }
      ...
      if (metadata.last_used() != base::Time()) {
        settings_dictionary->SetKey(kLastUsedKey, base::TimeToValue(metadata.last_used()));
      }
      if (metadata.last_visited() != base::Time()) {
        settings_dictionary->SetKey(kLastVisitKey, base::TimeToValue(metadata.last_visited()));
      }
      if (!metadata.lifetime().is_zero()) {
        settings_dictionary->SetKey(kLifetimeKey, base::TimeDeltaToValue(metadata.lifetime()));
      }
```
Read side, lines 74-77: `base::ValueToTime(dict.Find(key)).value_or(base::Time())`.

| Key under `profile.content_settings.exceptions.<type>.<pattern>` | Epoch | Notes |
|---|---|---|
| `last_modified` | **1601-µs UTC string** | when the user set the permission |
| `expiration` | **1601-µs UTC string** | future-dated; an expiry, not an event |
| `last_used` | **1601-µs UTC string** | ⚠ see below |
| `last_visit` | **1601-µs UTC string** | ⚠ see below |
| `lifetime` | **duration µs string** via `TimeDeltaToValue` | **NOT a timestamp.** Same on-disk shape as the four above. A parser that date-renders every decimal string in this dict will render a *duration* as a 1601-relative date. **Concrete mis-rendering hazard.** |
| `model` | integer (`SessionModel` enum) | not a time |

**Zero is written as ABSENCE, not as `"0"`** — every setter is guarded by `!= base::Time()`.
So a missing `last_visit` means "never"/"not tracked", and a literal `"0"` should be treated as
anomalous. Conversely `kLastUsedPermissionExpiration = base::Hours(24)` (line 55) shows
`last_used` is used with a 24h window.

**`UNRESOLVED` — `last_visit` coarsening.** `143-leads-unverified.md` suspects `last_visit` is
rounded to a week boundary for privacy. The *writer* here does not round; any rounding would
happen upstream in the permission-autorevocation code before it reaches
`ContentSettingConstraints`. **Not verified in this run.** If it rounds, the value is a
**bucket start, not an event time**, which would be a significant caveat. See queue.

### 2.6 Site Engagement in `Preferences` — the ONE JSON-double timestamp (precision loss CONFIRMED)

`components/site_engagement/content/site_engagement_score.cc` @ `ba3c200`.

Keys, lines 64-69:
```cpp
const char SiteEngagementScore::kRawScoreKey[] = "rawScore";
const char SiteEngagementScore::kPointsAddedTodayKey[] = "pointsAddedToday";
const char SiteEngagementScore::kLastEngagementTimeKey[] = "lastEngagementTime";
const char SiteEngagementScore::kLastShortcutLaunchTimeKey[] = "lastShortcutLaunchTime";
```

Write site, lines 354-361:
```cpp
  score_dict.Set(kRawScoreKey, raw_score_);
  score_dict.Set(kPointsAddedTodayKey, points_added_today_);
  score_dict.Set(kLastEngagementTimeKey,
                 static_cast<double>(last_engagement_time_.ToInternalValue()));
  score_dict.Set(
      kLastShortcutLaunchTimeKey,
      static_cast<double>(last_shortcut_launch_time_.ToInternalValue()));
```
Read site, lines 385-394: `FindDouble(...)` → `base::Time::FromInternalValue(value)`.

**CONFIRMED, and it is the exception to every other rule in this document:**

- Epoch: `ToInternalValue()` ⇒ **1601-µs UTC**.
- Encoding: **an unquoted JSON NUMBER (IEEE-754 double)**, explicitly `static_cast<double>`.
  Every other JSON timestamp in scope is a string. Under `profile.content_settings.exceptions.
  site_engagement.<origin>.setting`, so it sits *inside* the content-settings tree next to the
  1601-µs **strings** of §2.5 — **two encodings of the same epoch, nested in the same subtree.**
- **Precision loss is real and unavoidable.** ~1.34×10¹⁷ exceeds 2^53 ≈ 9.007×10¹⁵ by ~15×, so the
  double's ULP at this magnitude is **16 µs** (2^54–2^57 range → ULP 16; strictly, for values in
  [2^56, 2^57) ≈ [7.2×10¹⁶, 1.44×10¹⁷) the ULP is 16 µs). The value on disk is therefore
  **quantised to a 16-µs grid** and the low bits are meaningless. Also: it will serialise as
  something like `1.3380000000000000e+16`-style or a long integer-valued decimal depending on the
  JSON writer — **a parser must not assume it is integral text.**
- Sub-16-µs differences between two `lastEngagementTime` values are noise, not ordering evidence.

**Timezone: `LocalMidnight()` IS on the site-engagement path** — lines 238-239, 307-308, 325-326:
```cpp
  if (!last_engagement_time_.is_null() &&
      now.LocalMidnight() != last_engagement_time_.LocalMidnight()) {
```
But this is used only to decide whether to **reset the daily points budget** — the *stored*
timestamp is still absolute UTC 1601-µs. So `lastEngagementTime` is **UTC**, while the
`pointsAddedToday` value adjacent to it is **bucketed by the HOST'S LOCAL DAY**.

**This is a timezone-offset recovery primitive** and is worth escalating: if you observe the
exact instant at which `pointsAddedToday` resets across a series of profile snapshots, you
recover the host's local midnight, hence its UTC offset at that date. Directly relevant to
§5.6 / #125 Q1(a) ("no Chrome artifact stores local time") — strictly true here (nothing stores
an offset) but the *behaviour* leaks it. Companion to the `segment_usage.time_slot` /
`LocalMidnight()` lead another agent is chasing in History.


## 3. `Media History` (SQLite) — **REMOVED FROM CHROMIUM**, and it is 1601-SECONDS

### 3.1 The artifact no longer exists in current Chrome — removal bracketed to M120→M121

`chrome/browser/media/history/` **does not exist at `refs/heads/main` (`ba3c200`)**. Verified by
directory listing `chrome/browser/media?format=JSON` — the `history` subdirectory is absent; only
`media_engagement_*` survives.

Release-tag bisection of `chrome/browser/media/history/media_history_store.cc` (HTTP status of the
gitiles `?format=TEXT` fetch):

| Tag | Status |
|---|---|
| `120.0.6099.71` | **200** |
| `121.0.6167.85` | 404 |
| `122.0.6261.57` | 404 |
| `125.0.6422.60` | 404 |
| `128.0.6613.84` | 404 |
| `130.0.6723.59` | 404 |

⇒ **Media History was removed between M120 and M121 (early 2024).** Chrome ≥ M121 does not
create or update this file. **A `Media History` file in a modern profile is a fossil**: its
contents are frozen at the last time an ≤M120 build ran, and its timestamps date that build, not
the seizure. This is directly forensically load-bearing — it gives an *upper bound* on the last
use of an old Chrome build against that profile. Report it as a **stale artifact with an
implicit terminus ante quem**, never as current activity.

All findings below are read at **`refs/tags/120.0.6099.71`** — the last version that shipped it.

### 3.2 Epoch: **1601-SECONDS** — a fourth epoch family, CONFIRMED

`chrome/browser/media/history/media_history_origin_table.cc` @ `120.0.6099.71`:

```cpp
// lines 37-46, schema
"CREATE TABLE IF NOT EXISTS %s("
  ... "last_updated_time_s INTEGER,"
  ... "aggregate_watchtime_audio_video_s INTEGER DEFAULT 0)"
// lines 75-80, INSERT
"(origin, last_updated_time_s) VALUES (?, ?)"
  statement.BindInt64(1,
                      base::Time::Now().ToDeltaSinceWindowsEpoch().InSeconds());
// lines 100-108, UPDATE
"aggregate_watchtime_audio_video_s = aggregate_watchtime_audio_video_s + ?, "
"last_updated_time_s = ? "
  statement.BindInt64(0, time.InSeconds());          // <-- a DURATION
  statement.BindInt64(1,
                      base::Time::Now().ToDeltaSinceWindowsEpoch().InSeconds());  // <-- a TIMESTAMP
```

**`ToDeltaSinceWindowsEpoch().InSeconds()` ⇒ seconds since 1601-01-01 UTC.**
Not Unix seconds. Not 1601-µs. A value "now" is ~**1.34×10¹⁰ (11 digits)**, versus Unix seconds
~1.7×10⁹ (10 digits). Interpreting it as Unix seconds yields a date around the year **2395** —
obviously wrong; but interpreting it as 1601-µs yields **1601-01-01 03:43** — *plausible-looking
garbage*, which is the exact failure mode issue #143 exists to prevent.

This **confirms the LOW-confidence guess in `143-leads-unverified.md` §2.10** and **corrects
`125-integrity-facts-unverified.md`**, whose three-family epoch model (unix-s / unix-µs / 1601-µs)
does not contain this family at all.

Same encoding in the sibling tables, @ `120.0.6099.71`:

| File | Line | Column | Encoding |
|---|---|---|---|
| `media_history_origin_table.cc` | 79-80 (INSERT), 107-108 (UPDATE) | `origin.last_updated_time_s` | **1601-seconds UTC** |
| `media_history_playback_table.cc` | 83-84 | `playback.last_updated_time_s` (`BIGINT NOT NULL`, line 35) | **1601-seconds UTC** |
| `media_history_session_table.cc` | 103-104 | `playbackSession.last_updated_time_s` (`BIGINT NOT NULL`, line 39) | **1601-seconds UTC** |

### 3.3 The `_s` suffix is overloaded — duration vs timestamp in the same row

This is the practical hazard and it is worse than the epoch itself:

| Column | `_s` means | Source |
|---|---|---|
| `origin.last_updated_time_s` | **absolute** 1601-seconds | `media_history_origin_table.cc:79-80` |
| `origin.aggregate_watchtime_audio_video_s` | **duration**, seconds (`time.InSeconds()` on a `TimeDelta`) | `media_history_origin_table.cc:106` |
| `playback.watch_time_s` | **duration**, seconds (`watch_time.cumulative_watch_time.InSeconds()`) | `media_history_playback_table.cc:80` |
| `playback.last_updated_time_s` | **absolute** 1601-seconds | `media_history_playback_table.cc:83-84` |
| `playbackSession.duration_ms` / `position_ms` | **durations, milliseconds** | `media_history_session_table.cc:96-97` |

A parser keyed on the `_s` suffix will date-render three durations. `duration_ms`/`position_ms`
are *media playhead* values (position within the media), not wall-clock at all.

### 3.4 Version

`chrome/browser/media/history/media_history_store.cc:32-33` @ `120.0.6099.71`:
```cpp
constexpr int kCurrentVersionNumber = 6;
constexpr int kCompatibleVersionNumber = 1;
```
Migration ladder is a chain of standalone functions `MigrateFrom1To2` … `MigrateFrom5To6`
(lines 71-128), each calling `meta_table->SetVersionNumber(kTargetVersion)`.

**No epoch migration exists in the ladder** — none of `MigrateFrom1To2` … `MigrateFrom5To6`
contains an arithmetic `UPDATE ... SET ..._time_s = ..._time_s + <offset>`. So
**1601-seconds applies uniformly at every `meta.version` 1–6**; `meta.version` is *not* an epoch
discriminator here (it only gates column presence). `6` is the terminal version — no Media
History DB will ever exceed it, which makes `meta.version = 6` plus file mtime a decent
fingerprint of "last touched by an ≤M120 build".

---

## 4. `Extension State` / `Extension Cookies`

### 4.1 `Extension State` (LevelDB) — **no Chrome-written timestamp schema**

`Extension State` is the LevelDB backing `chrome.storage.local` / `chrome.storage.sync` for
extensions (alongside `Local Extension Settings/<id>/` and `Sync Extension Settings/<id>/`).

**Structural finding (negative, and I am confident in the reasoning but did NOT read the store
implementation in this run — see queue):** the values in this store are **`base::Value` JSON blobs
supplied by the extension**, keyed by extension-chosen keys. Chrome imposes **no schema and
writes no timestamp of its own**. Therefore:

- There is **no epoch to state** for `Extension State`. Any timestamp inside it is
  **extension-authored** and can be in any format the extension chose — most commonly
  `Date.now()` ⇒ **Unix milliseconds** (because the writer is JavaScript), which is a *different*
  default from every Chrome-native artifact in this document.
- **Do not apply Chrome's epoch conventions to values found in `Extension State`.** An 18-digit
  integer here is far more likely a JS `performance`/microsecond value or an ID than a 1601-µs
  time. Classify per-extension, per-key, or not at all.
- The only *Chrome-controlled* timestamps are LevelDB-level (SST file mtimes, MANIFEST
  sequence), which are filesystem/format metadata, not content.

`UNRESOLVED`: exact on-disk directory name(s) and the value-serialisation path
(`extensions/browser/api/storage/`). Not read in this run.

### 4.2 `Extension Cookies` — UNRESOLVED (existence and current path)

Historically `<Profile>/Extension Cookies`: a **separate SQLite cookie store** with the same
schema as `Cookies`, used for cookies set from extension-scheme (`chrome-extension://`) contexts.

**I could not confirm in this run whether Chrome still creates it.** `chrome/common/chrome_constants.cc`
@ `ba3c200` no longer contains the profile filename constants (it now holds only executable /
framework names — the profile-file constants have moved, path not located). Gitiles has no
search API and `+log` is 401, so I could not locate `kExtensionsCookieFilename`.

**What is safe to state:**
- **If** the file exists in a profile, it is produced by the same writer as `Cookies`
  (`net/extras/sqlite/sqlite_persistent_cookie_store.cc`) and therefore has the **same columns,
  same `meta.version` ladder, and same epochs** as `Cookies`. It is a *second instance* of that
  artifact, not a distinct format. The Cookies analysis is owned by another agent in this issue;
  **defer to it and apply the result unchanged.**
- **Do not** state a separate epoch or version for `Extension Cookies`.
- `UNRESOLVED`: whether modern Chrome still creates the file, and at which milestone it stopped
  (if it did). See queue. A present-but-stale `Extension Cookies` would carry the same
  "fossil" caveat as Media History (§3.1).

---

## 5. `Site Characteristics` (LevelDB of `SiteDataProto`) — Unix SECONDS

Proto: `components/performance_manager/persistence/site_data/site_data.proto` @ `ba3c200`.
Writer: `components/performance_manager/persistence/site_data/site_data_impl.cc` / `.h` @ `ba3c200`.

### 5.1 The epoch — Unix seconds, confirmed at the conversion helper

`site_data_impl.cc:26-28`:
```cpp
base::TimeDelta GetTimeDeltaSinceEpoch() {
  return base::Time::Now() - base::Time::UnixEpoch();
}
```
`site_data_impl.h:187-192`:
```cpp
  // Helper functions to convert from/to the internal representation that is
  // used to store TimeDelta values in the |SiteDataProto| protobuf.
  static base::TimeDelta InternalRepresentationToTimeDelta(int64_t value) {
    return base::Seconds(value);
  }
  static int64_t TimeDeltaToInternalRepresentation(base::TimeDelta delta) {
    return delta.InSeconds();
  }
```
Write sites: `site_data_impl.cc:53-54`, `:78-79`, `:271-272` (`set_last_loaded`), `:301-302`
(`set_use_timestamp`) — all
`TimeDeltaToInternalRepresentation(GetTimeDeltaSinceEpoch())`.

⇒ **`(base::Time::Now() - base::Time::UnixEpoch()).InSeconds()` = Unix seconds UTC.**
Not 1601-anything. This is the *opposite* of Media History (§3.2), which uses the same
"`.InSeconds()` of a delta" shape but against the **Windows** epoch — a one-word difference in
the source producing an 8.5-billion-second error. Good illustration of why the write site must
be read, not inferred from the type.

### 5.2 Field table

| Proto field | Type | Meaning | Encoding |
|---|---|---|---|
| `SiteDataProto.last_loaded` (id 1) | `optional uint32` | *"The last time this site has been in the loaded state, in seconds since epoch"* | **Unix seconds UTC** |
| `SiteDataFeatureProto.use_timestamp` (id 2) | `optional int64` | *"The time at which this feature has been used (set to 0 if it hasn't been used), in seconds since epoch"* | **Unix seconds UTC** |
| `SiteDataFeatureProto.observation_duration` (id 1) | `optional int64` | *"The cumulative observation time for this feature in seconds, set to 0 once this feature has been observed"* | **DURATION, seconds — NOT a timestamp** |
| `SiteDataPerformanceMeasurement.avg_cpu_usage_us` / `avg_load_duration_us` | `optional float` | decaying averages | **durations, µs** — not times |
| `avg_footprint_kb` | `optional float` | kilobytes | not a time |

**Hazards, all citable from the proto comments at `ba3c200`:**

1. **`observation_duration` and `use_timestamp` are the same type, same units, adjacent field ids,
   in the same message — one is absolute, one is relative.** Mis-classifying `observation_duration`
   as a timestamp renders a small number (seconds of observation) as a date in **1970**, which is
   *plausible-looking garbage*, not an error.
2. **`0` is an explicit sentinel with TWO different meanings in the same message**:
   `use_timestamp == 0` ⇒ feature **never used**;
   `observation_duration == 0` ⇒ feature **has** been observed (per the comment,
   "set to 0 once this feature has been observed"). Inverted polarity between two adjacent
   fields. Neither may be rendered as `1970-01-01`.
3. **`last_loaded` is `uint32`, not int64.** At Unix seconds this **overflows in 2106**. More
   immediately relevant: it caps precision at 1 second and cannot represent pre-1970. A negative
   or absurd value indicates corruption, not a pre-epoch date.
4. Feature fields (`updates_favicon_in_background`, `updates_title_in_background`,
   `uses_audio_in_background`) each carry their **own independent `use_timestamp`** — there are
   up to four Unix-second timestamps per site record, not one.
   `deprecated_uses_notifications_in_background` (id 5) is retained but deprecated — its presence
   is a **generation marker** for old records.

### 5.3 Version

**There is no version field in `SiteDataProto` and no `meta.version` — it is a LevelDB of
lite-runtime protobufs.** Format generation is identifiable only by:
- the proto comments' `// Next Id: N` markers (3 / 4 / 7 at `ba3c200`) — which are **source-side
  only, not on disk**;
- **which field ids are actually present** in a serialised record. Because proto2 optional fields
  are omitted when unset, a record written by an older Chrome simply lacks the newer ids. This is
  the same "key presence is the only generation signal" situation as §2.1.
- Protobuf's forward/backward compatibility means **an old record is silently readable by new
  Chrome with no migration and no version bump.** There is therefore **no epoch-migration risk
  here, but also no way to date the record's format.**

---

## 6. `Reporting and NEL` (SQLite) — 1601-µs, v2 current, v1 migration DESTROYS data

`net/extras/sqlite/sqlite_persistent_reporting_and_nel_store.cc` @ `ba3c200`.

### 6.1 Versions

```cpp
// lines 47-48
const int kCurrentVersionNumber = 2;
const int kCompatibleVersionNumber = 2;
```
Used at lines 115-116. Note `kCompatibleVersionNumber == kCurrentVersionNumber == 2`: **a v1 DB
is not readable by a modern build without migration, and a v2 DB is not readable by any pre-v2
build at all.**

### 6.2 Epoch: 1601-µs UTC — and the column names say so

Schema, `CreateV2NelPoliciesSchema` (lines 289-310) and
`CreateV2ReportingEndpointGroupsSchema` (lines 331-349):
```sql
CREATE TABLE nel_policies (
  nik TEXT NOT NULL, origin_scheme TEXT NOT NULL, origin_host TEXT NOT NULL,
  origin_port INTEGER NOT NULL, received_ip_address TEXT NOT NULL,
  group_name TEXT NOT NULL,
  expires_us_since_epoch INTEGER NOT NULL,
  success_fraction REAL NOT NULL, failure_fraction REAL NOT NULL,
  is_include_subdomains INTEGER NOT NULL,
  last_access_us_since_epoch INTEGER NOT NULL,
  UNIQUE (origin_scheme, origin_host, origin_port, nik))

CREATE TABLE reporting_endpoint_groups (
  nik TEXT, origin_scheme TEXT, origin_host TEXT, origin_port INTEGER,
  group_name TEXT, is_include_subdomains INTEGER,
  expires_us_since_epoch INTEGER NOT NULL,
  last_access_us_since_epoch INTEGER NOT NULL,
  UNIQUE (origin_scheme, origin_host, origin_port, group_name, nik))
```

Value production, lines 383-388 and 498-500:
```cpp
            nel_policy.expires.ToDeltaSinceWindowsEpoch().InMicroseconds()),
            nel_policy.last_used.ToDeltaSinceWindowsEpoch().InMicroseconds()) {}
...
            group.expires.ToDeltaSinceWindowsEpoch().InMicroseconds()),
            group.last_used.ToDeltaSinceWindowsEpoch().InMicroseconds()) {
```
Bound at lines 903, 907, 916, 1098, 1100, 1110, 1134, 1136 via **`BindInt64`** (not `BindTime`).
Read back at lines 1325 and 1444-1448:
`base::Time::FromDeltaSinceWindowsEpoch(...)`.

⇒ **1601-µs UTC.** Note the **`_us_since_epoch` suffix names the WRONG epoch** — "epoch"
unqualified almost universally means Unix, but the code is unambiguously Windows-epoch. **The
column name is actively misleading and will cause a Unix-µs misinterpretation** (which yields a
date around **year 6224** — at least that one is obviously wrong rather than plausible).

| Table.column | Epoch | Semantics |
|---|---|---|
| `nel_policies.expires_us_since_epoch` | **1601-µs UTC** | future-dated policy expiry, not an event |
| `nel_policies.last_access_us_since_epoch` | **1601-µs UTC** | **last time this origin was contacted** — genuine activity evidence |
| `reporting_endpoint_groups.expires_us_since_epoch` | **1601-µs UTC** | expiry |
| `reporting_endpoint_groups.last_access_us_since_epoch` | **1601-µs UTC** | activity |
| `reporting_endpoints` (whole table) | **no timestamp** — columns are `nik, origin_*, group_name, url, priority, weight` (lines 316-329) | explicit negative finding |

Because `BindInt64` (not `BindTime`) is used, a grep for `BindTime` **misses this artifact
entirely**. Worth noting for the matrix methodology.

### 6.3 The v1→v2 migration is DESTRUCTIVE — high-value integrity finding

`Backend::DoMigrateDatabaseSchema()`, lines 702-730:
```cpp
  // Migrate from version 1 to version 2.
  //
  // For migration purposes, the NetworkAnonymizationKey field of the stored
  // policies will be populated with an empty list, which corresponds to an
  // empty NAK. This matches the behavior when NAKs are disabled. This will
  // result in effectively clearing all policies once NAKs are enabled, at
  // which point the the migration code should just be switched to deleting
  // the old tables instead.
  if (cur_version == 1) {
    ...
    !db()->Execute("ALTER TABLE nel_policies RENAME TO nel_policies_old")
    ... CreateV2NelPoliciesSchema(db()) ...
    // The "report_to" field is renamed to "group_name" ...
    "INSERT INTO nel_policies (nik, origin_scheme, origin_host, "
    "  origin_port, group_name, received_ip_address, expires_us_since_epoch, "
```

**Findings:**
1. The migration is a **table rename + re-INSERT**, and the timestamp columns are copied
   **verbatim** in the SELECT list — **no arithmetic, so the epoch is unchanged across v1→v2.**
   1601-µs applies at both versions. Clean.
2. **But it back-fills `nik` with an empty NetworkAnonymizationKey, and the comment states this
   "will result in effectively clearing all policies once NAKs are enabled."** So a profile that
   crossed this boundary has policies that were **silently invalidated/emptied** — absence of NEL
   policies for an origin after this point is **not** evidence the origin was not visited.
   Explicit anti-inference warning.
3. Column **rename** `report_to` → `group_name`. A parser must dispatch on `meta.version`:
   at v1 the column is `report_to`, at v2 it is `group_name`. Same data, different name.
4. The migration leaves `nel_policies_old` behind unless dropped — line 719 does
   `DROP TABLE IF EXISTS nel_policies_old` **before** renaming, i.e. it cleans up a *prior*
   leftover. **A `*_old` table may be recoverable in a partially-migrated DB.** Worth probing.

---

## 7. `Trust Tokens` (SQLiteProto) — 1601-µs, explicitly documented in the proto

`services/network/trust_tokens/proto/storage.proto` and `.../proto/public.proto` @ `ba3c200`.

### 7.1 The epoch is stated in the schema itself — the cleanest case in this document

`public.proto`, final message:
```proto
message Timestamp {
  // Represents microseconds since the Windows epoch.
  required int64 micros = 1;
}
```

⇒ **Every `Timestamp` field in the Trust Tokens store is 1601-µs UTC**, in the single `micros`
field (proto field id 1, varint). This is the only artifact in my scope where the epoch is
**named in the persisted schema definition** rather than only at the write site.

### 7.2 Field table

| Proto | Field | Type | Meaning |
|---|---|---|---|
| `TrustTokenIssuerConfig` | `last_issuance` (id 4) | `Timestamp` | *"The time of the most recent issuance for this pair"* — **1601-µs UTC** |
| `TrustTokenIssuerToplevelPairConfig` | `last_redemption` (id 1) | `Timestamp` | *"The time of the most recent redemption for this pair. Used for rate-limiting and expiration"* — **1601-µs UTC** |
| `TrustTokenIssuerToplevelPairConfig` | `penultimate_redemption` (id 3) | `Timestamp` | *"The time of the redemption before last"* — **1601-µs UTC**. Note: **the store retains exactly the last TWO redemption times**, no more. |
| `TrustToken` (`public.proto`) | `creation_time` (id 3) | `Timestamp` | **1601-µs UTC** — per-token, inside `TrustTokenIssuerConfig.tokens` (repeated, id 3) |
| `TrustTokenRedemptionRecord` | `creation_time` (id 6) | `Timestamp` | **1601-µs UTC** |
| `TrustTokenRedemptionRecord` | `lifetime` (id 5) | `optional uint64` | **DURATION IN SECONDS — NOT a timestamp.** *"Lifetime of the redemption record in seconds."* Different type (`uint64`, not `Timestamp`) and different unit from every other time in the file. |
| `TrustTokenToplevelConfig` | — | | **no timestamp** (only `associated_issuers`) |

**Forensic value:** `TrustTokenIssuerToplevelPairConfig` is keyed by **(issuer origin, top-level
page origin)** — so `last_redemption` / `penultimate_redemption` are a **pairwise site-visit
record that survives independently of History and Cookies**. Two timestamps per pair, and
they are *cross-site linkage evidence by construction*.

### 7.3 Version

**No version field in either proto, and no `meta.version` semantics of its own.** The store is
`SQLiteProtoKeyValueStore` — a generic key/blob SQLite table (`services/network/trust_tokens/
sqlite_trust_token_persister.cc` @ `ba3c200`, fetched) wrapping serialised protos. Format
generation is discoverable only from **field-id presence**, as with Site Characteristics (§5.3).

The field-id gaps are themselves the generation record:
- `TrustTokenIssuerConfig` uses ids **3, 4** — ids 1 and 2 are **absent/removed**.
- `TrustTokenRedemptionRecord` uses ids **1, 4, 5, 6** — ids 2 and 3 are **absent/removed**.

A record containing a removed id was written by an older Chrome. **This is the only
generation discriminator available.** `UNRESOLVED`: what ids 1/2 and 2/3 formerly held —
`+log` is 401 so I could not recover the removed definitions.

---

## 8. `Affiliation Database` (SQLite) — 1601-µs, stable across all 7 versions

`components/affiliations/core/browser/affiliation_database.cc` @ `ba3c200`.

**Versions**, lines 36-41:
```cpp
// The current version number of the affiliation database schema.
const int kVersion = 7;
// The oldest version of the schema such that a legacy Chrome client using that
// version can still read/write the current database.
const int kCompatibleVersion = 1;
```
`metatable.Init(sql_connection_.get(), kVersion, kCompatibleVersion)` at line 161;
version bumped at line 190-191.

**The only timestamp: `eq_classes.last_update_time`.**

Schema (`InitializeTableBuilders`, line 78-80) — declared in the **version 0/1** block:
```cpp
  // Version 0 and 1 of the affiliation database.
  builders.eq_classes->AddPrimaryKeyColumn("id");
  builders.eq_classes->AddColumn("last_update_time", "INTEGER");
```

**Write site**, line 390 + 411:
```cpp
      "INSERT INTO eq_classes(last_update_time, group_display_name, "...
  statement_parent.BindTime(0, affiliated_facets.last_update_time);
```
**Read sites**, lines 229 and 263: `statement.ColumnTime(4)` / `...last_update_time = ...ColumnTime`.

⇒ **`BindTime` ⇒ 1601-µs UTC.**

**Version-boundary finding (a clean negative, worth stating):** the version ladder
(`SealVersion` calls at lines 91, 92, 97, 106, 110, 113, 121, 125) shows every schema change
from v2–v7 is a **column or index addition** — `facet_display_name`/`facet_icon_url` (v2),
the `eq_class_groups` table + `group_display_name`/`group_icon_url` (v3), `main_domain` (v4),
`psl_extensions.domain` (v5), two indices (v6), `change_password_url` ×2 (v7).

**`last_update_time` was declared at v0/1 and never touched again. There is no epoch migration.
1601-µs holds for every `meta.version` 1 through 7.** `meta.version` for this DB tells you about
column presence only.

Also note the migration mechanism differs from the rest of Chromium: this DB uses
`SQLTableBuilder::MigrateFrom(version, db)` (line 130-134) — a declarative builder, not a
hand-written `MigrateToVersionNN` ladder. So grepping for `MigrateToVersion` finds nothing here;
the schema history is encoded in the ordered `AddColumn`/`SealVersion` sequence.

**Forensic content:** `eq_classes` groups facets (websites + Android apps) that share a
credential, populated from a **Google server lookup**. `last_update_time` is therefore a
**network-contact timestamp with Google's affiliation service**, not a user action. Do not
present it as user activity. It is still useful: it bounds when the profile last had
network-backed password features active.

---

## 9. `Sessions/` and `Tabs` (SNSS) — timestamps ARE present; three distinct carriers

**Answer to the assigned question up front: YES, the SNSS binary format carries timestamps, in
three separate places, and one of them is in the FILENAME.** All three are 1601-µs UTC.

`components/sessions/core/command_storage_backend.cc` and
`components/sessions/core/serialized_navigation_entry.cc`, both @ `ba3c200`.

### 9.1 Carrier 1 — the filename suffix (free, no parsing needed)

```cpp
// command_storage_backend.cc:70-77
base::FilePath::StringType TimestampToString(const base::Time time) {
#if BUILDFLAG(IS_POSIX) || BUILDFLAG(IS_FUCHSIA)
  return base::NumberToString(time.ToDeltaSinceWindowsEpoch().InMicroseconds());
#elif BUILDFLAG(IS_WIN)
  return base::NumberToWString(
      time.ToDeltaSinceWindowsEpoch().InMicroseconds());
#endif
}
// :89-94  filename = <base name> + kTimestampSeparator + <timestamp string>
// :704    .Append(GetSessionFilename(type, TimestampToString(time)));
```
Inverse, `CommandStorageBackend::TimestampFromPath`, lines 570-587:
```cpp
  auto parts = base::SplitString(path.BaseName().value(), kTimestampSeparator, ...);
  if (parts.size() != 2u) { return false; }
  int64_t result = 0u;
  if (!base::StringToInt64(parts[1], &result)) { return false; }
  timestamp_result = base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(result));
```

⇒ The numeric suffix of `Session_<N>` / `Tabs_<N>` is **1601-µs UTC**, decimal, 18 digits.
Semantics: the moment the **file was created**, i.e. session start.

**Two non-obvious integrity properties, both from `command_storage_backend.cc:728-742`:**
```cpp
  base::Time new_timestamp = clock_->Now();
  if (last_session_info_) {
    // Ensure that the last session's timestamp is before the current file's.
    if (last_session_info_->timestamp > new_timestamp) {
      new_timestamp = last_session_info_->timestamp + base::Microseconds(1);
    }
  }
  // Ensure we don't reuse the timestamp, and that it's always increasing.
  if (new_timestamp <= timestamp_) {
    new_timestamp = timestamp_ + base::Microseconds(1);
  }
```
1. **The filename timestamp is FORCIBLY MONOTONIC.** If the system clock goes backwards (NTP
   correction, user change, VM snapshot restore), Chrome does **not** write the real time — it
   writes `previous + 1 µs`. So a filename timestamp is an **upper-bounded lie** in exactly the
   scenario a forensic examiner cares most about (clock manipulation).
2. **Corollary — this is a clock-rollback DETECTOR.** A run of session files whose timestamps
   differ by exactly 1 µs is a positive signal that the host clock was set backwards at that
   point. **High-value; escalate to the integrity model.** Nothing else in the profile records
   this.

### 9.2 Carrier 2 — `SerializedNavigationEntry::timestamp_` in the pickle

`serialized_navigation_entry.cc:148` (write) / `:221-225` (read):
```cpp
  pickle->WriteInt64(timestamp_.ToInternalValue());
...
    int64_t timestamp_internal_value = 0;
    if (iterator->ReadInt64(&timestamp_internal_value)) {
      timestamp_ = base::Time::FromInternalValue(timestamp_internal_value);
    } else {
      timestamp_ = base::Time();     // <-- 0 sentinel on short/truncated pickle
    }
```
⇒ **1601-µs UTC** (`ToInternalValue()`), little-endian int64 raw in the pickle body.
This is the **per-navigation time** — i.e. the closest thing SNSS has to a browsing-history
entry, and it survives in `Last Session` / `Last Tabs` after History has been cleared. Very high
forensic value.

**The pickle has NO field tags — it is positional.** The field order is documented in the comment
at lines 95-114 and the timestamp is the **12th** field, after `is_overriding_user_agent_`.
Consequences:
- Correct offset depends on correctly parsing every preceding variable-length string.
- Field 9 is written as a **hardcoded obsolete value** for forwards compatibility
  (line 138-139: `// This field was deprecated in m61 ... we still write it to the pickle`
  `pickle->WriteInt(kObsoleteReferrerPolicyNever);`), and field 13 (`search_terms_`) was **removed
  but is still written as an empty string** (lines 150-153) to hold its slot. A parser that
  "cleans up" these dead fields desynchronises and reads the *wrong int64* as the timestamp.
- `base::Time()` (**0**) is the read-failure sentinel — must render as "unknown", not 1601.

### 9.3 Carrier 3 — session commands (tab/window last-active times)

`components/sessions/core/session_service_commands.cc` was fetched @ `ba3c200` but **the
individual command payload encodings were NOT read in this run.** `UNRESOLVED` — see queue.
Do not assume; the commands are separate `SessionCommand` structs with their own payload layouts.

### 9.4 Versioning — there IS a file header version, and it is NOT a schema version

`command_storage_backend.cc:46-64`:
```cpp
// File version numbers:
// kFileVersion1 = 1; No longer supported. Used in production prior to commit
//   223e5cd on 2021-05-25.
// kEncryptedFileVersion = 2; No longer supported. Never used in production, but
//   possible prior to commit 223e5cd on 2021-05-25.
constexpr int32_t kFileVersionWithMarker = 3;
// kEncryptedFileVersionWithMarker = 4; Never used in production, but possible
//   from early 2021 through early 2026.
constexpr int32_t kFileVersionEncryptedWithOSCrypt = 5;
// NEXT_VERSION = 6

// The signature at the beginning of the file = SSNS (Sessions).
constexpr int32_t kFileSignature = 0x53534E53;

struct FileHeader {
  int32_t signature;
  int32_t version;
};
```

**Format identification, fully specified:** the first 8 bytes are two little-endian int32:
`0x53534E53` (`"SSNS"`) then the version. Written at lines 763-768, checked at 303-336.

| Version | Meaning | Support in `ba3c200` |
|---|---|---|
| 1 | plain, pre-marker; production **before commit `223e5cd`, 2021-05-25** | **rejected** (`kUnsupportedVersion`, line 334-336) |
| 2 | encrypted, pre-marker; **never in production** | rejected |
| **3** | plain, with initial-state marker | current default — written when not encrypted (line 765-766) |
| 4 | encrypted with marker; **never in production**, possible "early 2021 through early 2026" | rejected |
| **5** | **encrypted with OSCrypt** | current when `is_encrypted()` (line 765) |

**Findings:**
- **This version is a container/encryption-format version, NOT a timestamp-schema version.** The
  1601-µs encoding of §9.1 and §9.2 is identical at v3 and v5. `meta.version`-style dispatch is
  irrelevant to the epoch here.
- **v5 files are encrypted with OSCrypt** — read the version byte before assuming a session file
  is parseable. Cross-reference `research/127-oscrypt-portability.md`: a v5 `Session_*` requires
  the same key material as `Login Data`. Whether a given profile writes v3 or v5 depends on
  `is_encrypted()`, which forensix must determine from the header, not from configuration.
- **v1 and v2 are refused by modern Chrome outright** — so a v1 file in a profile is a genuine
  pre-2021-05-25 artifact that Chrome itself can no longer read. forensix reading it is a
  capability Chrome does not have.
- Comment says `NEXT_VERSION = 6` — no version 6 exists as of `ba3c200`.

---

## 10. Version-boundary notes

### 10.1 The headline structural finding for this part of the matrix

**Most of my scope has NO version field at all.** This is not a gap in the research — it is the
finding, and it should be stated as such in the integrity model, because #143's premise
("at which `meta.version` did the epoch change?") is **unanswerable-by-construction** for these
artifacts.

| Artifact | Version field? | What it actually is | Does it bound the epoch? |
|---|---|---|---|
| `Bookmarks` / `.bak` | **yes**, top-level `"version"` | frozen at **1** forever; exact-equality gate, no ladder | **No.** Constant across all of Chrome's history. Useless as a discriminator. |
| `Preferences` | **NO** | — | n/a — use `profile.created_by_version` (a *string*, not a schema version) as the proxy |
| `Secure Preferences` | **NO** | has `protection.macs` HMACs instead | n/a — use `install_time` vs `first_install_time` key presence (§2.4) |
| `Local State` | **NO** | — | n/a |
| `Sessions`/`Tabs` (SNSS) | **yes**, 4-byte header field after `"SSNS"` | container/encryption version 1–5 | **No.** 1601-µs at v3 and v5 alike. It bounds *decryptability*, not epoch. |
| `Media History` | **yes**, `meta.version` 1–6 | terminal at 6 | **No.** No epoch migration in the ladder; 1601-**seconds** at every version. |
| `Extension State` | **NO** | LevelDB, extension-authored values | n/a — no Chrome epoch to bound |
| `Site Characteristics` | **NO** | LevelDB of proto2 lite | **No.** Proto compatibility means old records read fine, unversioned. |
| `Reporting and NEL` | **yes**, `meta.version` 1→2 | current=compatible=2 | **No epoch change**; but it renames `report_to`→`group_name` and **destroys policy validity** (§6.3) |
| `Trust Tokens` | **NO** | proto field ids only | **No.** |
| `Affiliation Database` | **yes**, `meta.version` 1→7 (compatible 1) | column-addition ladder only | **No.** `last_update_time` declared at v0/1, never migrated. |

**Zero epoch migrations found anywhere in my scope.** Every artifact I resolved uses a single
encoding for its whole documented lifetime. The hazard in this part of the matrix is therefore
**not** "epoch changed at version N" (as it is for `Login Data` v8 and `History` v16) — it is:

1. **Four different epochs coexisting across artifacts with no in-band label**
   (1601-µs, 1601-**seconds**, Unix-seconds, Unix-ms-from-JS), and
2. **Durations and timestamps sharing an identical on-disk representation** in five separate
   places (§2.5 `lifetime`, §3.3 `watch_time_s`/`aggregate_watchtime_*_s`, §5.2
   `observation_duration`, §7.2 `lifetime`, and `TimeDeltaToValue` generally).

### 10.2 Confirmed version boundaries (the few that exist)

| Boundary | Where | Pinned to | Confidence |
|---|---|---|---|
| **Media History removed** | artifact ceases to exist | **between M120 and M121** — present at tag `120.0.6099.71`, 404 at `121.0.6167.85` and all later tags tested | **HIGH** — direct HTTP bisection |
| SNSS v1/v2 → v3 (initial-state marker) | `command_storage_backend.cc:47-51` | **commit `223e5cd`, 2021-05-25** (per the in-source comment) | HIGH (source comment, commit not fetched) |
| SNSS v4 "never in production" window | `command_storage_backend.cc:52-53` | *"early 2021 through early 2026"* (in-source comment) | HIGH (source comment) |
| extensions `install_time` → `first_install_time` + `last_update_time` | `extension_prefs.cc:197-200` | **≤ M113** — the deprecation TODO says *"Remove after M113"*, so the split predates it. Exact introducing milestone **NOT pinned.** | MEDIUM |
| Reporting/NEL v1→2 | `sqlite_persistent_reporting_and_nel_store.cc:702-730` | milestone **NOT pinned** | — |
| Affiliation DB v1→7 | `affiliation_database.cc:78-126` | milestones **NOT pinned**; column→version mapping IS pinned (see §8) | — |

### 10.3 Cases where a version number does NOT determine the answer

Per the brief's request for these specifically:

1. **`Bookmarks` `"version": 1` is not a generation signal.** Two files 14 years apart carry the
   same number. Only key-presence discriminates.
2. **`Secure Preferences` extension times: `meta.version` does not exist, and the key *name*
   determines nothing about value provenance.** After the `install_time` migration,
   `first_install_time` and `last_update_time` are **both backfilled from the same legacy value**
   for pre-migration extensions (`extension_prefs.cc:2566-2572`). The keys look modern; the values
   are synthetic. Structurally identical to the `logins.date_password_modified` backfill in
   `143-confirmed-partial.md` §3.
3. **SNSS filename timestamps are clamped monotonic** (`command_storage_backend.cc:728-742`), so a
   filename timestamp can be **fabricated `previous + 1µs`** rather than a clock read — regardless
   of file version. Version tells you nothing about this.
4. **`Reporting and NEL` v2 does not mean the policies are complete** — the v1→v2 migration
   knowingly empties the NAK and thereby invalidates carried-over policies (§6.3).
5. **`Media History` `meta.version = 6` does not date the file to now** — 6 is terminal and the
   artifact is dead as of M121. The version is a *ceiling*, and the file is a fossil.

---

## 11. UNRESOLVED / verification queue

Ordered by forensic cost of getting it wrong. **None of these may be quoted as findings.**

### Blocking for correctness (a wrong answer produces a believable wrong date/claim)

| # | Question | Why it matters | Where to look |
|---|---|---|---|
| U1 | Does content settings `last_visit` get **coarsened to a week boundary** before it reaches `ContentSettingsPref`? | If yes, the value is a **bucket start, not an event time**, and forensix would over-state precision by up to 7 days. The writer (`content_settings_pref.cc:551-554`) does not round — any rounding is upstream. | permission auto-revocation / `HostContentSettingsMap::UpdateLastVisitTime`, `components/permissions/` |
| U2 | `user_experience_metrics.stability.stats_buildtime` — which epoch? | The source comment (`metrics_pref_names.h:238-239`) literally says *"seconds since an epoch"* and declines to name it. | grep the `SetInt64` call site for `kStabilityStatsBuildTime` |
| U3 | Is there a legacy write path for `client_id_timestamp` that used **local** time? | Header comment says "local machine time" while the current write is `ToTimeT()` (UTC). §2.3C. | release-tag bisect `metrics_state_manager.cc` |
| U4 | Does modern Chrome still create `Extension Cookies`? At which milestone did it stop (if it did)? | Determines whether it is live or a fossil (like Media History). | locate the moved profile-filename constants; `kExtensionsCookieFilename` |
| U5 | SNSS **session command payloads** — `SessionTab::last_active_time`, `SetTabTimestamp`-style commands. Epoch and layout. | These are real per-tab activity times and I did not read them. `session_service_commands.cc` was fetched but not analysed. | `components/sessions/core/session_service_commands.cc` @ `ba3c200` |

### Version/milestone pinning (a wrong answer mis-dates a boundary)

| # | Question | Where to look |
|---|---|---|
| U6 | Milestone that introduced `Bookmarks` `date_last_used` | release-tag bisect `bookmark_codec.cc` for `kDateLastUsed` |
| U7 | Milestone that introduced `checksum_sha256` / `kEnableBookmarkCodecSHA256` and whether the flag is on by default in stable | release-tag bisect `bookmark_codec.cc` + `bookmark_features.cc` |
| U8 | Exact milestone of the extensions `install_time` → `first_install_time`/`last_update_time` split (bounded ≤ M113) | release-tag bisect `extension_prefs.cc` for `kPrefFirstInstallTime` |
| U9 | Milestone for Reporting/NEL v1→2 | release-tag bisect `sqlite_persistent_reporting_and_nel_store.cc` for `kCurrentVersionNumber` |
| U10 | Milestones for Affiliation DB v1→v7 | release-tag bisect `affiliation_database.cc` for `kVersion` |
| U11 | Exact removal CL/milestone for Media History (bracketed M120/M121 — tighten to the CL) | `+log` is 401; bisect dev/beta tags between 120 and 121 |
| U12 | What Trust Tokens proto field ids 1/2 (`TrustTokenIssuerConfig`) and 2/3 (`TrustTokenRedemptionRecord`) formerly held | `+log` 401; release-tag bisect `storage.proto` / `public.proto` |

### Lower priority / completeness

| # | Question |
|---|---|
| U13 | `Secure Preferences` MAC algorithm + seed — needed to state what tampering IS detected (`services/preferences/tracked/`) |
| U14 | `Extension State` value serialisation path — confirm Chrome writes no timestamps of its own (`extensions/browser/api/storage/`) |
| U15 | Does `Bookmarks.bak` write happen before or after the main file? Determines which is older on a crashed write. (`components/bookmarks/browser/bookmark_storage.cc`, `base::ImportantFileWriter`) |
| U16 | Whether `media_engagement_score.cc` (`chrome/browser/media/`, still present) stores a `lastMediaPlaybackTime` and in what encoding — **not read in this run** despite being the surviving sibling of Media History |
| U17 | Whether any `Preferences` key uses **ISO-8601 strings**. The brief anticipated some; **I found none in the keys I read** — every time-valued pref I resolved was a decimal string or a JSON double. Stated as a *non-finding*, not a negative claim: I did not survey enough of the open-ended pref set to assert absence. |

---

## 12. Source index (path + ref/sha)

All fetched over gitiles `?format=TEXT` and base64-decoded. **Every file listed here was actually
read in this run.** Nothing is cited that is not in this table.

### At `refs/heads/main` = `ba3c200c1564977873107f5656c015253ba129b1`

| Path | Used for | § |
|---|---|---|
| `base/json/values_util.cc` | `TimeToValue`/`Int64ToValue`/`ValueToTime` — JSON 1601-µs string encoding | §0.1 |
| `components/prefs/pref_service.cc` | `SetInt64` / `SetTime` / `SetUint64` — pref shape vs epoch | §2.2 |
| `components/bookmarks/browser/bookmark_codec.cc` | all three Bookmarks timestamps, version, checksum | §1 |
| `extensions/browser/extension_prefs.cc` | `first_install_time`/`last_update_time`/`last_launch_time`, `SaveTime`, backfill migration | §2.4 |
| `components/content_settings/core/browser/content_settings_pref.cc` | `last_modified`/`expiration`/`last_used`/`last_visit`/`lifetime` | §2.5 |
| `components/site_engagement/content/site_engagement_score.cc` | `lastEngagementTime` JSON double, `LocalMidnight()` | §2.6 |
| `chrome/browser/profiles/profile_impl.cc` | `profile.creation_time` registration + write, `GetCreationTimeForPath` | §2.3B |
| `chrome/common/pref_names.h` | `kProfileCreationTime`, `kProfileCreatedByVersion` key strings | §2.3B |
| `components/metrics/metrics_state_manager.cc` | `kInstallDate` / `kMetricsReportingEnabledTimestamp` writes via `ToTimeT()` | §2.3A/C |
| `components/metrics/metrics_pref_names.h` | key strings + the "local machine time" and "seconds since an epoch" comments | §2.3A/C/D |
| `components/variations/pref_names.h` | `variations_last_fetch_time` / `variations_seed_date` key strings | §2.3E |
| `components/variations/variations_seed_store.cc` | `RegisterTimePref` for those keys | §2.3E |
| `components/sessions/core/command_storage_backend.cc` | SNSS header/signature/versions, filename timestamp, monotonic clamp | §9.1, §9.4 |
| `components/sessions/core/serialized_navigation_entry.cc` | pickle `timestamp_` = `ToInternalValue()`, positional layout | §9.2 |
| `components/sessions/core/session_service_commands.cc` | **fetched, NOT analysed** — see U5 | §9.3 |
| `components/affiliations/core/browser/affiliation_database.cc` | `kVersion=7`, `last_update_time` `BindTime`, builder ladder | §8 |
| `net/extras/sqlite/sqlite_persistent_reporting_and_nel_store.cc` | v2 schema, `ToDeltaSinceWindowsEpoch().InMicroseconds()`, v1→v2 migration | §6 |
| `services/network/trust_tokens/proto/storage.proto` | `last_issuance`, `last_redemption`, `penultimate_redemption` | §7 |
| `services/network/trust_tokens/proto/public.proto` | `message Timestamp { // microseconds since the Windows epoch }` | §7.1 |
| `services/network/trust_tokens/sqlite_trust_token_persister.cc` | store shape (key/blob) | §7.3 |
| `components/performance_manager/persistence/site_data/site_data.proto` | `last_loaded`, `use_timestamp`, `observation_duration` | §5 |
| `components/performance_manager/persistence/site_data/site_data_impl.cc` | `GetTimeDeltaSinceEpoch() = Now() - UnixEpoch()` | §5.1 |
| `components/performance_manager/persistence/site_data/site_data_impl.h` | `TimeDeltaToInternalRepresentation` = `.InSeconds()` | §5.1 |
| `chrome/common/chrome_constants.cc` | checked for profile filename constants — **they are no longer there** (negative result, U4) | §4.2 |

### At `refs/tags/120.0.6099.71` (last release shipping Media History)

| Path | Used for | § |
|---|---|---|
| `chrome/browser/media/history/media_history_store.cc` | `kCurrentVersionNumber = 6`, `kCompatibleVersionNumber = 1`, migration ladder | §3.4 |
| `chrome/browser/media/history/media_history_origin_table.cc` | `origin.last_updated_time_s` = `ToDeltaSinceWindowsEpoch().InSeconds()` | §3.2 |
| `chrome/browser/media/history/media_history_playback_table.cc` | `playback.last_updated_time_s`, `watch_time_s` | §3.2-3.3 |
| `chrome/browser/media/history/media_history_session_table.cc` | `playbackSession.last_updated_time_s`, `duration_ms`/`position_ms` | §3.2-3.3 |

### Existence probes (HTTP status only, no content)

| Path | Tags probed | Result |
|---|---|---|
| `chrome/browser/media/history/media_history_store.cc` | `120.0.6099.71` / `121.0.6167.85` / `122.0.6261.57` / `125.0.6422.60` / `128.0.6613.84` / `130.0.6723.59` | 200 / 404 / 404 / 404 / 404 / 404 |
| `chrome/browser/media` (dir listing, `?format=JSON`) | `refs/heads/main` | no `history/` entry |
| `chrome/browser/performance_manager/persistence` (dir listing) | `refs/heads/main` | `site_data` only |

### Method notes for the next run

- `+/refs/heads/main?format=JSON` returns the HEAD SHA — use it to record the exact ref instead of
  saying "main". Cheap, one call.
- **Directory listing works and is cheap:** `<path>?format=JSON` → strip the `)]}'` first line →
  `entries[].name`. This is how Media History's removal was found, and it is the only substitute
  for the 401'd `+log` when you need to know whether something still exists.
- **HTTP-status-only probing** (`curl -o /dev/null -w '%{http_code}'`) against release tags is a
  very cheap existence bisection — 6 probes bracketed the Media History removal to one milestone.
- Confirms the salvage file: `+log` is 401; a 404 body is ~233 bytes; use a unique temp filename
  per fetch.

