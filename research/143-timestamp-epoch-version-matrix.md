# Timestamp epoch and version matrix per artifact — #143

**Answers [#143](https://github.com/ChmaraX/forensix/issues/143). Graduated from
[#125](https://github.com/ChmaraX/forensix/issues/125). Supersedes the epoch table in
`125-integrity-facts-unverified.md`.**

**Source-access status: LIVE.** Every claim in this file was read from Chromium source fetched
over gitiles `?format=TEXT` during the run. This document is **not** in the same class as the
rest of `research/` — it is primary-sourced, and the unverified material is quarantined in §9.

**Refs read:**
- `ba3c200c1564977873107f5656c015253ba129b1` (chromium/src `refs/heads/main`) — parts 3, 4
- `cb211f647e4138888643a909973b2d07d49ae79c` — parts 1, 2. This is `ba3c200`'s **parent**
  (one autoroll commit apart), so line numbers are directly comparable across the two.
- Release tags and milestone branch-point SHAs are named inline where version pinning required them.

**Chrome stable at time of run: 151.0.7922.77 (M151).**

**Evidence files** (full working detail, one per artifact family):
`research/_raw/143-part-1-history.md` · `143-part-2-credentials.md` ·
`143-part-3-webdata.md` · `143-part-4-json-and-misc.md`

---

## 1. Summary — the short answer

The question as posed ("which epoch, and at which `meta.version` did it change") **presumes a
model that the source does not support.** The corrected model has four parts:

**1. There are five epoch families in Chrome profile artifacts, not two.**

| Family | Definition | Producing API | Example |
|---|---|---|---|
| **1601-µs** | microseconds since 1601-01-01 UTC | `BindTime()` / `ToDeltaSinceWindowsEpoch().InMicroseconds()` | most columns |
| **Unix seconds** | seconds since 1970-01-01 UTC | `ToTimeT()` | `autofill.date_created`, `credit_cards.use_date` |
| **Unix µs** | microseconds since 1970-01-01 UTC | pre-migration state only | History `urls`/`visits` at v≤16 on Mac/Linux |
| **1601-ms** | **milli**seconds since 1601-01-01 UTC | `ToDeltaSinceWindowsEpoch().InMilliseconds()` | `offer_data.expiry` — **the one genuinely silent failure** |
| **1601-seconds** | **seconds** since 1601-01-01 UTC | `.since_origin().InSeconds()` | `Media History` (all columns) |

Plus one JSON-double outlier (Site Engagement, §7.2) which loses precision by design.

**2. `meta.version` is not a sufficient epoch discriminator — in five distinct ways.**
This is the central finding and it is enumerated in §2.

**3. The epoch is per-column, not per-file.** `Web Data` at version 153 simultaneously holds
Unix-seconds, 1601-µs and 1601-ms columns — and `autofill_ai_entities_metadata` holds two
different families **in adjacent columns of the same row**. Any design that stores "the epoch of
this artifact" is wrong by construction.

**4. Some timestamps are synthetic** — written by a migration, not by the event they appear to
record. These are worse than a wrong epoch, because they are correctly decoded and still false
as evidence. Register in §8.2.

**The issue's own premises, checked:** the 1601-µs canonical claim is confirmed; the `Web Data`
autofill Unix-seconds claim is confirmed; the `logins.date_created` v≤8 claim is confirmed
exactly as stated. The path it cites for `login_database.cc` is stale (§10).

---

## 2. Where `meta.version` alone does NOT determine the epoch

Ordered by how badly they break a naive parser.

### 2.1 The recorded version can be WRONG — `FixVersionIfNeeded` (Login Data)

`login_database.cc:914-950` @ `cb211f6`. Per crbug.com/295851 some Login Data files carry an
incorrect `meta.version`. Chrome repairs it by **column sniffing**:

```cpp
  if (*current_version < 25) {
    if (db->DoesColumnExist("logins", "date_last_used")) { *current_version = 25; }
  }
```

A file recording `meta.version <= 8` but possessing a `date_last_used` column is really v25, and
its `date_created` is **1601-µs, not Unix seconds**. A parser trusting `meta.version` verbatim
is wrong by 369 years on precisely the files where the epoch question is live.

> **Rule.** Replicate `FixVersionIfNeeded`'s column sniffing, then magnitude-check
> `date_created` (10 digits ⇒ Unix s; 18 digits ⇒ 1601-µs). Never trust `meta.version` alone.

### 2.2 Platform-conditional migrations — the version bumps on all platforms, the data doesn't

**History v16→17** (`history_database.cc:706-719` @ `cb211f6`) — the cleanest case in Chromium:

```cpp
  if (cur_version == 16) {
#if !BUILDFLAG(IS_WIN)
    // In this version we bring the time format on Mac & Linux in sync with the
    // Windows version so that profiles can be moved between computers.
    MigrateTimeEpoch();
#endif
    // On all platforms we bump the version number, so on Windows this
    // migration is a NOP...
```

`MigrateTimeEpoch()` (body at `:1192-1208`) adds `11644473600000000` to
`urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot`.

| History `meta.version` | Origin OS | Epoch of those three columns |
|---|---|---|
| ≤ 16 | Windows | 1601-µs UTC |
| ≤ 16 | **macOS / Linux** | **Unix µs UTC** |
| ≥ 17 | any | 1601-µs UTC |

**Nothing in the file records the originating OS.** Two derived discriminators exist (part 1
§1.3): (a) magnitude — Unix-µs ≈ 1e15 vs 1601-µs ≈ 1e17 for the 2008-13 era, two orders apart,
cannot overlap; (b) `downloads.full_path` path syntax. Milestone: **the migration first shipped
stable in M4** (bisected `3.0.195.38` v16-no-migration → `4.0.249.78` v17-migration-present).

**Cookies v3→v4** — the same hazard class, and it was not in the round-1 notes.
`sqlite_persistent_cookie_store.cc:303-305` @ `cb211f6`:

> *"In version 4, we migrated the time epoch. If you open the DB with an older version on Mac or
> Linux, the times will look wonky, but the file will likely be usable. On Windows version 3 and
> 4 are the same."*

v4 dates to 2009-09-01. The pre-v4 non-Windows encoding is **UNRESOLVED** — the migration body no
longer exists at `cb211f6`. Do **not** assert Unix-µs from the History analogy (§9, V-7).

Practical exposure of both is small — modern Chrome razes Cookies below v23 and may raze History
below v15 — but they are the template for the failure mode.

### 2.3 The epoch is per-column, not per-file

`Web Data` @ version 153 (part 3 §5.3). Three families coexisting:

- **Unix seconds**: `autofill.date_created`, `autofill.date_last_used`, `addresses.use_date`,
  `addresses.date_modified`, `credit_cards.use_date`, `credit_cards.date_modified`,
  `local_ibans.use_date`, `local_stored_cvc.last_updated_timestamp`,
  `server_stored_cvc.last_updated_timestamp`, `autofill_ai_entities_metadata.date_modified`
- **1601-µs**: `keywords.date_created`, `keywords.last_modified`, `keywords.last_visited`,
  `server_card_metadata.use_date`, `masked_ibans_metadata.use_date`,
  `masked_credit_card_benefits.start_time`/`.end_time`, `valuables_metadata.use_date`,
  `autofill_ai_entities_metadata.use_date`
- **1601-ms**: `offer_data.expiry`

No platform-conditional migration exists anywhere in Web Data — every migration is unconditional.
The breakage here is structural, not versioned.

### 2.4 Several artifacts have no version field at all

`Preferences`, `Secure Preferences`, `Local State`, `Extension State`, `Site Characteristics`,
`Trust Tokens` carry **no schema version**. For `Preferences` the only proxy is
`profile.created_by_version` — a *product version string*, not a schema version.

### 2.5 A version field can exist and be useless

`Bookmarks` has a top-level `"version"` frozen at **1** for all of Chrome's history, enforced by
exact equality with no migration ladder. It discriminates nothing. SNSS's header version (1–5)
bounds *decryptability*, not epoch — 1601-µs at v3 and v5 alike.

---

## 3. History family

DB constants @ `cb211f6` (`history_database.cc:42-45`): `kCurrentVersionNumber` **70**,
`kCompatibleVersionNumber` **16**, `kMinimalVersionNumber` **15**. `RazeDbIfTooOld()` (`:98-124`)
destroys a DB below v15 when `kRazeOldHistoryDatabase` is enabled — *never let a modern Chrome
open an evidence copy*.

| Table.column | Epoch | Version boundary | Write site @ `cb211f6` |
|---|---|---|---|
| `urls.last_visit_time` | 1601-µs UTC (≥17); **Unix µs on Mac/Linux ≤16** | **16→17**, platform-conditional, **M4** | `BindTime`; migration `:1192-1208` |
| `visits.visit_time` | as above | as above | as above |
| `segment_usage.time_slot` | **1601-µs UTC encoding of LOCAL midnight** | as above | `visitsegment_database.cc:231,236,254` |
| `visits.visit_duration` | **not a timestamp** — a duration | — | — |
| `downloads.start_time` | 1601-µs (≥24); **Unix seconds ≤23** | **23→24**, **M26 (2013-03-26)** | `(t + 11644473600) * 1000000`, `download_database.cc:162-166` |
| `downloads.end_time` | as above | as above | as above |
| `downloads.last_access_time` | 1601-µs UTC | added later; `DEFAULT 0` | `BindTime`, `:610-613` |
| `downloads.last_modified` | **HTTP header STRING, not an epoch** | — | — |
| `keyword_search_terms` | **no timestamp** (negative, verified) | — | — |
| `visit_source` | **no timestamp** (negative, verified) | — | — |
| `content_annotations` / `context_annotations` / `clusters` | **no timestamps** (negative, verified) | — | — |
| `downloads_url_chains` | **no timestamp**; its *existence* implies version ≥24 | — | — |

**`segment_usage.time_slot` is a timezone-recovery primitive and a counterexample to #125's Q1.**
`VisitSegmentDatabase::UpdateSegmentVisitCount()` writes `ts.LocalMidnight()` (`:231`) through
`BindTime` (`:236`, `:254`). The container is UTC; the *value* is midnight in the **host's local
timezone at write time**. So `time_slot % 86400000000` is the host's UTC offset that day —
persisted, day by day, including DST transitions. Rendering it as a UTC date shows the **wrong
calendar day** for hosts east of UTC. Values are quantised to one day and must never be presented
as a visit time. (The offset arithmetic is inference; what is *sourced* is that `LocalMidnight()`
is on the write path.)

**Other artifacts in this family:** `Top Sites` — **no timestamp column** (negative, verified).
`Favicons` — `favicon_bitmaps.last_updated` / `.last_requested`, both 1601-µs UTC with a hard `0`
sentinel carrying ON_VISIT/ON_DEMAND semantics. `Shortcuts` — `last_access_time` 1601-µs UTC,
INTEGER not string, no epoch change in the ladder. **`Network Action Predictor` — no timestamp at
all** (negative, verified; this corrects #125).

---

## 4. Login Data

Constants: current **v43**, compatible **v40** (`login_database.cc:80,83` @ `cb211f6`).
**Path corrected:** `components/password_manager/core/browser/password_store/login_database.cc`.

The migration, verbatim (`:822-832`):

```cpp
  // Data changes, not covered by the schema migration above.
  if (current_version <= 8) {
    sql::Statement fix_time_format;
    fix_time_format.Assign(db->GetUniqueStatement(
        "UPDATE logins SET date_created = (date_created * ?) + ?"));
```

**The round-1 claim is confirmed exactly as stated.** Not platform-conditional — there is no
`#if BUILDFLAG` around this block, in contrast to History v16. Worth stating so the matrix does
not over-generalise.

| Column | Epoch | Boundary |
|---|---|---|
| `date_created` | Unix **seconds** at v≤8; **1601-µs** at v≥9 | **8→9** |
| `date_synced` | 1601-µs | present only v6..v30, **dropped at v31** |
| `date_last_used` | 1601-µs, `DEFAULT 0` | added **v25** |
| `date_password_modified` | 1601-µs, `DEFAULT 0` | added **v30**, **backfilled** (§8.2) |
| `password_notes.date_created` | 1601-µs | table added **v33** |
| `date_received` | 1601-µs | added **v37** |
| `date_last_filled` | 1601-µs, `DEFAULT 0` | added **v42** |
| `insecure_credentials.create_time` | 1601-µs | table added **v29**; backfilled (§8.2) |

---

## 5. Cookies

Constants: current **v24**, compatible **v24** (`sqlite_persistent_cookie_store.cc:316-317`).
Only v23 is migratable; **anything older is razed**. Four timestamp columns
(`CreateV24Schema`, `:662-686`) — `creation_utc`, `last_access_utc`, `expires_utc`,
`last_update_utc` — **all 1601-µs UTC** in supported versions.

| Boundary | Effect |
|---|---|
| **v3→v4** (2009-09-01) | **platform-conditional epoch migration** — §2.2 |
| **v18** (2022-04-19) | `last_update_utc` added; absent below |
| **v19** (2023-09-22) | **`expires_utc` values rewritten** — capped to +400 days. **Destructive: the original expiry is unrecoverable.** |

`expires_utc = 0` is the session-cookie sentinel, confirmed mechanically against `has_expires`
(`:1370-1371`).

---

## 6. Web Data

Constants @ `ba3c200`: `kCurrentVersionNumber` **153** (`web_database.h:35`),
`kCompatibleVersionNumber` **151** (`web_database.cc:60`), `kDeprecatedVersionNumber` **82**
(`web_database.h:57`). Chrome **razes** anything at `meta.version ≤ 82` rather than migrating
(`web_database.cc:176-180`) — so a Web Data file at ≤82 still on disk has **never been opened by
a modern Chrome**, and will be destroyed if it is. The ladder is **split across table classes**;
no single file holds the whole history.

### 6.1 The address reorganisation — there are THREE generations, not two

The issue frames this as `autofill_profiles` → `local_addresses`/`contact_info`. That is
generations 1→2 only. **A third generation merged both back into a single `addresses` table.**

| `meta.version` | Migration | **First stable milestone** |
|---|---|---|
| **107** — `contact_info` + `contact_info_type_tokens` created | `MigrateToVersion107AddContactInfoTables` | **M109** |
| **113** — `local_addresses*` created, rows copied out of `autofill_profiles`, legacy rows deleted | `MigrateToVersion113MigrateLocalAddressProfilesToNewTable` | **M115** |
| **114** — `autofill_profiles*` DROPped | `MigrateToVersion114DropLegacyAddressTables` | **M116** |
| **132** — `use_date2`, `use_date3` added | `MigrateToVersion132AddAdditionalLastUseDateColumns` | **M129** |
| **134** — `contact_info` → `addresses`, `local_addresses` merged in and dropped | `MigrateToVersion134UnifyLocalAndAccountAddressStorage` | **M130** |
| **145** — `use_date2`, `use_date3` DROPped | `MigrateToVersion145DropMultipleUseDates` | **M142** |

**Epoch across the whole reorg: PRESERVED — Unix seconds throughout, all three generations.**
The reorganisation is a table/name hazard, not an epoch hazard.

Method: chromiumdash `fetch_milestones?mstone=N` → `chromium_main_branch_hash` → fetch
`web_database.h` at that SHA → read `kCurrentVersionNumber`. Caveat: this captures state at
branch cut, so the milestone column means "first stable milestone whose branch point already
contained the bump" — accurate to within one milestone worst case. **CL numbers UNRESOLVED**
(gitiles `+log`/`+blame` are HTTP 401 unauthenticated); the migration function names are the
stable searchable handle in Gerrit.

### 6.2 `use_date` means two different epochs depending on the table

Worse than the `date_created` collision the issue names: same column name, same file, same
semantic, both `INTEGER NOT NULL DEFAULT 0`.

| Table.column | Epoch | Write site @ `ba3c200` |
|---|---|---|
| `credit_cards.use_date` | **Unix seconds** | `payments_autofill_table.cc:290` `ToTimeT()` |
| `local_ibans.use_date` | **Unix seconds** | `:339` `ToTimeT()` |
| `server_card_metadata.use_date` | **1601-µs** | `:1122` `BindTime` |
| `masked_ibans_metadata.use_date` | **1601-µs** | `:1168` `BindTime` |

Both wrong decodings fail loudly (~4.2 billion years out, or 1601-01-01 00:28) — but only if the
tool tries. A tool keying on the column *name* will silently mis-date half the payments data.

### 6.3 `offer_data.expiry` — the one genuinely silent failure in the corpus

`:1437-1438` — `ToDeltaSinceWindowsEpoch().InMilliseconds()`. **1601-milliseconds.** Magnitude for
2026-01-01 is ~1.34×10¹³ — **13 digits, exactly the digit count of Unix milliseconds.** The
magnitude test does **not** disambiguate it, and a naive Unix-ms decode returns a plausible date
in **2394**. Low forensic impact (Google-Pay promo offers), maximal methodological importance:
this is the case that defeats the fallback heuristic.

### 6.4 Other Web Data

`autofill.date_created` / `.date_last_used` — **Unix seconds UTC**, confirmed at the write site
(`autocomplete_table.cc:441` `ToTimeT()`). The round-1 claim is confirmed; **no version boundary
relevant to timestamps** exists for this table. This is the other half of the
"two `date_created`, 369 years apart" pair — the counterpart being `logins.date_created` at v≥9.

`keywords.date_created` / `.last_modified` / `.last_visited` — 1601-µs, with **an epoch/precision
migration at version 77**. `autofill_ai_entities_metadata` — **two adjacent columns, two
different epochs** (`use_date` 1601-µs, `date_modified` Unix seconds).

**iOS data-loss flag:** `payments_autofill_table.cc:1420-1425`, `#if BUILDFLAG(IS_IOS)` →
`CleanupForCrbug445879524()` deletes **all** `credit_cards` rows. Absence of local cards on an iOS
artifact may be a cleanup, not a user action.

---

## 7. JSON and non-SQLite artifacts

### 7.1 The JSON encoding primitive

`base/json/values_util.cc` @ `ba3c200`: `TimeToValue()` → `TimeDeltaToValue()` →
`Int64ToValue()` → `Value(NumberToString(integer))`. So **`base::TimeToValue` = 1601-µs UTC
serialised as a decimal JSON *string*.**

Two consequences that matter more than the epoch:

1. The read path **rejects a JSON number outright** (`ValueToInt64` requires `value.is_string()`).
   A tool that normalises a `Preferences` time to a JSON number doesn't lose precision — **Chrome
   silently treats the key as absent.**
2. `TimeDeltaToValue` produces the **identical shape** for a *duration*. A decimal string in JSON
   is **not self-identifying** as absolute-vs-relative, and the same shape is produced by
   `SetInt64` for Unix seconds. **Shape tells you nothing; the key must be classified individually.**

The confirmed collision, both quoted decimal strings in the same profile:

| Key | Epoch | Source @ `ba3c200` |
|---|---|---|
| `Local State` → `uninstall_metrics.installation_date2` | **Unix seconds** | `metrics_state_manager.cc:227-231` `ToTimeT()` |
| `Preferences` → `profile.creation_time` | **1601-µs** | `profile_impl.cc:451,743-744` `RegisterTimePref`/`SetTime` |

`installation_date2` can be **restored from a `client_info_backup`** (Windows registry / CrOS), so
it survives a profile wipe — it dates the *machine's* Chrome install, not the profile.

### 7.2 Remaining artifacts

| Artifact | Epoch | Notes |
|---|---|---|
| `Bookmarks` | **1601-µs decimal strings** — `date_added`, `date_modified`, `date_last_used` | `"version"` frozen at 1 forever. Checksum MD5 today, SHA-256 behind a flag (dual-write in progress) |
| `Preferences` content settings | 1601-µs strings | **keys OMITTED when zero** — absence ≠ never |
| `Preferences` Site Engagement | **JSON double** | the one double-typed timestamp; **precision loss CONFIRMED** |
| `Secure Preferences` | 1601-µs strings | `install_time` → `first_install_time` + `last_update_time` split, bounded **≤ M113** |
| **`Media History`** | **1601-SECONDS** — a fourth family | **REMOVED from Chromium between M120 and M121.** See below |
| `Site Characteristics` | **Unix seconds** | LevelDB of proto2 lite; unversioned |
| `Reporting and NEL` | 1601-µs | v1→v2 migration is **DESTRUCTIVE** (renames `report_to`→`group_name`, destroys policy validity) |
| `Trust Tokens` | 1601-µs | epoch stated in the proto schema itself — the cleanest case in the corpus |
| `Affiliation Database` | 1601-µs | stable across all 7 versions |
| `Sessions`/`Tabs` (SNSS) | 1601-µs | timestamps present via **three distinct carriers**, incl. the filename suffix |
| `Extension State` | — | LevelDB, extension-authored; **no Chrome-written timestamp schema** |

**`Media History` is a fossil artifact.** Directory `chrome/browser/media/history/` does not exist
at `ba3c200`; HTTP bisection of release tags shows **200 at `120.0.6099.71`, 404 at
`121.0.6167.85`** and all later. Chrome ≥M121 neither creates nor updates it. A `Media History`
file in a modern profile is **frozen at the last time an ≤M120 build ran** — it carries an
implicit *terminus ante quem* for that profile and must never be reported as current activity.

---

## 8. Hazard registers

### 8.1 Sentinels — must never be rendered as dates

`BindTime(base::Time())` writes literal `0` (`sql/statement.cc:41-45`), so **`0` is the universal
"null/never" marker** across every `BindTime`-written column. Specifically:
`cookies.expires_utc` (= session cookie), `cookies.last_update_utc` (never updated, or pre-v18),
`logins.date_last_used` / `date_password_modified` / `date_last_filled`,
`insecure_credentials.create_time`, `downloads.start_time`/`end_time`, `favicon_bitmaps.*`, and
effectively every `INTEGER NOT NULL DEFAULT 0` in Web Data.

Non-zero sentinels: DIPS `bounces.*_time` uses **SQL NULL**, not 0 (`BindTimesOrNull`,
`btm_database.cc:82-89`). `AutocompleteTable::GetEndTime()` maps an open bound to
`INT64_MAX` (`9223372036854775807`). `base::Time::Min()`/`Max()` appear on the entity deletion
path converted via `ToTimeT()`. Content-settings keys are **omitted entirely** when zero.

### 8.2 Synthetic timestamps — decode correctly, evidence nothing

| Value | What it actually records | Source |
|---|---|---|
| `logins.date_password_modified` for any row predating schema v30 | **Backfilled `= date_created`.** Does **not** evidence a password change | `login_database.cc:855-857` |
| `insecure_credentials.create_time` for rows that were 0 in a v29–v31 DB | `base::Time::Now()` **at migration time** — evidences a **Chrome upgrade**, not a compromise discovery | `:863-872` |
| `cookies.expires_utc` at ~+400d in a v≥19 DB | Possibly the **v19 cap**, not the server-sent expiry | `sqlite_persistent_cookie_store.cc:230-232` |

### 8.3 Destructive migrations — opening the evidence changes it

History <v15 razed; Cookies <v23 razed; Web Data ≤82 razed; DIPS anything ≠ v11 razed;
Cookies v19 rewrites `expires_utc` irreversibly; Reporting/NEL v1→v2 destroys policy validity;
Web Data on iOS deletes all `credit_cards`. **Every one of these fires on first open by a modern
Chrome.** This is the strongest available argument for the #121 read-only-copy input contract.

---

## 9. Corrections to `125-integrity-facts-unverified.md`

| #125 claim | Verdict |
|---|---|
| 1601-µs is the canonical encoding | **CONFIRMED** |
| Three epochs in play (1601-µs, Unix s, Unix µs) | **CORRECTED — there are five.** 1601-**ms** (`offer_data.expiry`) and 1601-**seconds** (Media History) were both missed |
| "All Chrome timestamps are UTC / timezone-independent; no artifact stores wall-clock local time" (its HIGH-confidence Q1 answer) | **FALSIFIED.** `segment_usage.time_slot` persists **local** midnight. It is a UTC container holding a locally-derived value, and it leaks the host's UTC offset per day |
| Downloads migration "v24-26 / ~M26 / 2013" | **CONFIRMED and tightened** — exactly `meta.version` **23→24**, stable **M26**, 2013-03-26 |
| `Web Data` is "the Unix-seconds database" | **FALSIFIED** — three families coexist; two in one row of `autofill_ai_entities_metadata` |
| `Network Action Predictor` carries timestamps | **FALSIFIED** — no timestamp column at all |
| Login Data `date_created` Unix-s at v≤8 | **CONFIRMED**, verbatim |

**Correction to issue #143's own text:** `components/password_manager/core/browser/login_database.cc`
is stale — the file moved under `password_store/`. Expect equivalent path rot elsewhere in #125.

---

## 10. Verification queue

**Blocking for correctness** (a wrong answer yields a believable wrong date):

- **V-7** — pre-v4 Cookies encoding on Mac/Linux. The v4 migration body no longer exists at
  `cb211f6`. Do **not** infer Unix-µs from the History analogy. Bisect release tags to ~2009.
- **U1** — is content-settings `last_visit` coarsened to a week boundary upstream? If yes it is a
  **bucket start, not an event time**, and forensix would overstate precision by up to 7 days.
- **U5** — SNSS session command payloads (`SessionTab::last_active_time`). Real per-tab activity
  times; `session_service_commands.cc` was fetched but not analysed.
- **`masked_bank_accounts_metadata.use_date`** — no write site found at `ba3c200`. Do **not**
  assume it matches `server_card_metadata`.
- **U2** — `stability.stats_buildtime`: the source comment says *"seconds since an epoch"* and
  declines to name which.
- **U3** — legacy `client_id_timestamp` write path: header says "local machine time", current
  write is `ToTimeT()` (UTC).

**Milestone pinning** (mis-dates a boundary, doesn't corrupt a value): Web Data CL numbers;
`Bookmarks.date_last_used` introduction; the extensions `install_time` split (bounded ≤M113);
Reporting/NEL v1→2; Affiliation DB v1→v7; the exact Media History removal CL.

**Tooling note.** Gitiles `+log` and `+blame` return **HTTP 401 unauthenticated**, so no CL,
commit SHA, author or date can be attributed from this route. Everything above was pinned by
**bisecting release tags / milestone branch-point SHAs** on version constants. Recovering CLs
requires Gerrit search on the migration **function names**, which are the stable handles.

---

## 11. What this means for #125's integrity model

The rule #125 established — *store raw value + epoch family + UTC instant, resolve the epoch
family from `meta.version`* — **does not survive contact with the source.** The resolver needs
four inputs `meta.version` cannot supply:

1. **Originating OS** (History ≤16, Cookies ≤3) — not recorded in any artifact.
2. **Column identity, not file identity** — the epoch is per-column; `use_date` and `date_created`
   each mean two different epochs depending on table.
3. **Version-integrity check** — `meta.version` itself can be wrong (`FixVersionIfNeeded`).
4. **A synthetic-vs-observed flag** — some correctly-decoded timestamps are migration artifacts.

Suggested amendment: the stored triple becomes a **quintuple** — raw value, epoch family,
UTC instant, *resolution provenance* (which rule fired, and whether a heuristic was used), and a
*synthetic* flag. And the magnitude fallback must be documented as **defeated by
`offer_data.expiry`**, so it can never be the sole resolver.
