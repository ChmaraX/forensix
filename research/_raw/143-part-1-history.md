# #143 Part 1 — History family timestamp epoch/version matrix

**Scope:** `History` (urls, visits, visit_source, segment_usage, keyword_search_terms,
downloads, downloads_url_chains, content_annotations, clusters), `Top Sites`, `Favicons`,
`Shortcuts`, `Network Action Predictor`.

**Date:** 2026-08-08 (repo-relative)
**Live source status:** gitiles `?format=TEXT` = WORKING. `+log` = HTTP 401 (unusable).
Gitiles rate-limits aggressively (`RESOURCE_EXHAUSTED: Short term web rate limit exceeded`,
returned as a ~328-byte body) — pace fetches.
**Primary ref read:** `cb211f647e4138888643a909973b2d07d49ae79c` (chromium/src main), unless a
release tag is named explicitly on the line.

> STATUS: COMPLETE for the assigned scope, with an explicit verification queue in §9.
> Every claim below was read from a file that was actually fetched and decoded in this session.
> Anything not read is marked UNRESOLVED and listed in §9 rather than guessed.

---

## 0. History DB version constants (read, not recalled)

`components/history/core/browser/history_database.cc` @ `cb211f6`:

| line | constant | value |
|---|---|---|
| 42 | `kCurrentVersionNumber` | **70** |
| 43 | `kCompatibleVersionNumber` | **16** |
| 45 | `kMinimalVersionNumber` | **15** — "oldest version number that we can migrate to the current version" |

`HistoryDatabase::RazeDbIfTooOld()` (lines 98-124): if the meta table is missing, or
`GetVersionNumber() < 15` (0 if unreadable), **and** the `kRazeOldHistoryDatabase` feature is
enabled, the DB is `Raze()`d. So a live Chrome may destroy a <v15 History DB rather than
migrate it. Forensically: never let a modern Chrome open your evidence copy.

The migration ladder is a flat `if (cur_version == N) { ...; ++cur_version;
meta_table_.SetVersionNumber(cur_version); }` chain in `EnsureCurrentVersion()`
(lines 684-1189). **Read "the migration at N" as: a DB whose stored `meta.version` is N gets
upgraded to N+1 by that block.** Therefore "pre-migration state" = `meta.version <= N`.

---

## 1. History v16 platform-conditional `MigrateTimeEpoch()` — RESOLVED

**This is the headline finding: `meta.version` alone does NOT determine the epoch of
`urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot` at version <= 16.**

### 1.1 The guard — confirmed verbatim

`components/history/core/browser/history_database.cc` @ `cb211f6`, lines **706-719**:

```cpp
  if (cur_version == 16) {
#if !BUILDFLAG(IS_WIN)
    // In this version we bring the time format on Mac & Linux in sync with the
    // Windows version so that profiles can be moved between computers.
    MigrateTimeEpoch();
#endif
    // On all platforms we bump the version number, so on Windows this
    // migration is a NOP. We keep the compatible version at 16 since things
    // will basically still work, just history will be in the future if an
    // old version reads it.
    ++cur_version;
    // TODO(crbug.com/40891923): Handle failure instead of ignoring it.
    std::ignore = meta_table_.SetVersionNumber(cur_version);
  }
```

The function body itself is *also* compiled out on Windows — `#if !BUILDFLAG(IS_WIN)` wraps
the definition, lines **1192-1208**:

```cpp
#if !BUILDFLAG(IS_WIN)
void HistoryDatabase::MigrateTimeEpoch() {
  // Update all the times in the URLs and visits table in the main database.
  std::ignore = db_.Execute(
      "UPDATE urls "
      "SET last_visit_time = last_visit_time + 11644473600000000 "
      "WHERE id IN (SELECT id FROM urls WHERE last_visit_time > 0);");
  std::ignore = db_.Execute(
      "UPDATE visits "
      "SET visit_time = visit_time + 11644473600000000 "
      "WHERE id IN (SELECT id FROM visits WHERE visit_time > 0);");
  std::ignore = db_.Execute(
      "UPDATE segment_usage "
      "SET time_slot = time_slot + 11644473600000000 "
      "WHERE id IN (SELECT id FROM segment_usage WHERE time_slot > 0);");
}
#endif
```

`11644473600000000` = 11644473600 s × 1e6 = the 1601→1970 delta in **microseconds**. Adding it
to a value converts Unix-µs → 1601-µs. So the pre-state on non-Windows was **Unix microseconds
UTC**, not Unix seconds. (Contrast §2: `downloads` used Unix *seconds*.)

Note the guard is `IS_WIN`, i.e. **not-Windows** ⇒ migrate. That covers macOS, Linux, ChromeOS,
Android, iOS, Fuchsia, BSD. "Mac & Linux" in the comment is historical; the buildflag is what
executes. Android/ChromeOS profiles never realistically existed at v16 (v16 predates them), but
any non-Windows build behaves the same way.

### 1.2 What a v<=16 DB looks like, per OS

| `meta.version` on disk | Origin OS | `urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot` |
|---|---|---|
| 15 or 16 | Windows | **1601-µs UTC** (already; the migration is a documented NOP there) |
| 15 or 16 | macOS / Linux / any non-Windows | **Unix µs UTC** |
| >= 17 | any | **1601-µs UTC** — the two lineages converge here |

The version bump happens on **all** platforms (it is outside the `#if`), so there is no
version-number difference between a Windows v16→17 upgrade and a Mac v16→17 upgrade.
`kCompatibleVersionNumber` stays 16, deliberately, so old Chromes keep opening it — that comment
("history will be in the future if an old version reads it") is Chromium explicitly documenting
the 369-year skew this issue exists to prevent.

Also note the `WHERE ... > 0` predicate: **0 is preserved as 0** and is a "never/unset"
sentinel. Do not render 0 as 1601-01-01 or 1970-01-01. Negative values (if any) are also left
untouched and are therefore *not* rebased — a negative `last_visit_time` in a migrated DB is
still on the old epoch. Treat negatives as corrupt.

### 1.3 Is there an IN-FILE signal that distinguishes Mac/Linux-origin v16 from Windows-origin?

**No dedicated flag exists.** Nothing in `meta`, and no column, records the originating OS.
Confirmed by reading the full `EnsureCurrentVersion()` ladder and the `meta` keys the file
writes (`early_expiration_threshold`, `may_contain_foreign_visits`,
`delete_foreign_visits_until_id`, `known_to_sync_visits_exist` — lines 47-50; none is an OS or
platform marker).

Two usable **derived** discriminators, in order of strength:

**(a) Magnitude of the timestamps themselves — decisive in practice.**
History schema v16 is from the 2008-2009 era, so any real value is a date in roughly 2008-2013.

| Encoding | value for 2010-01-01 | digits |
|---|---|---|
| Unix µs | ~1.26 × 10^15 | 16 |
| 1601 µs | ~1.29 × 10^17 | 18 |

Two orders of magnitude apart, and the ranges cannot overlap for any plausible date: a 1601-µs
value would have to be before 1970+~4 years (i.e. ~1974, 1.26e14 → no) to masquerade as Unix-µs.
Concretely: if `MAX(last_visit_time)` in a v<=16 DB is < 1e16, the DB is **non-Windows-origin
Unix-µs**; if it is > 1e17, it is **Windows-origin 1601-µs**. This is a magnitude heuristic, not
a recorded fact — state it as an inference in any report.

**(b) `downloads.full_path` path syntax — a genuine in-file OS artefact.**
At v<=22 the `downloads` table still has the pre-v23 schema with a `full_path` column
(proved by `download_database.cc` @ `cb211f6` line 161, `"SELECT id,full_path,full_path,"` —
the v23 migration reads it). `full_path` is an absolute local filesystem path, so
`C:\Users\...` / a drive letter / backslashes ⇒ Windows origin; a leading `/` with
`/Users/` (macOS) or `/home/` (Linux) ⇒ non-Windows origin. This is *corroborating* evidence, is
empty if the user never downloaded anything, and is a path recorded at download time (a profile
could in principle have been carried across OSes — which is precisely the scenario the migration
comment says it was written for). Use it to confirm (a), not to override it.

**Explicitly NOT a signal:** `meta.version`, `meta.Compatible version`, the presence/absence of
any table, SQLite `user_version`/`application_id`, or page size. None is set per-OS by this code.

### 1.4 Forensic rule

> For History `meta.version` <= 16, the epoch of `urls.last_visit_time`, `visits.visit_time` and
> `segment_usage.time_slot` is **undetermined by the schema version**. A parser MUST NOT assume
> 1601-µs. Either require an operator-supplied origin-OS input, or apply the magnitude test in
> §1.3(a) and record which branch it took in the output provenance.

Caveat on realism: v16 DBs are from ~2009 and a modern Chrome will migrate one on first open,
so this is an *old-evidence / imaged-profile* hazard, not a live-collection one. It is still the
cleanest documented case in Chromium of `meta.version` failing as an epoch discriminator, and it
is the template for what to look for elsewhere.

**Milestone — RESOLVED by release-tag bisection: first shipped in stable Chrome M4.**

| tag | file | `kCurrentVersionNumber` | `MigrateTimeEpoch` present? |
|---|---|---|---|
| `3.0.195.38` | `chrome/browser/history/history_database.cc` | **16** | **no** (grep count 0) |
| `4.0.249.78` | same | **17** | **yes** — guard at lines 262-274, body at 284-300 |
| `5.0.375.127` | same | 17 | yes |

So a History DB still sitting at `meta.version` 15 or 16 was last written by **Chrome M3 or
earlier** (or a pre-M4 dev/beta build). `fetch_milestone_schedule?mstone=4` returns HTTP 500, so
the calendar date is **not sourced** here — do not quote one. See §8.4 for scoping.

---

## 2. History `downloads` Unix-seconds -> 1601-µs — PINNED at meta.version 23 -> 24

### 2.1 The guard

`history_database.cc` @ `cb211f6`, lines **772-778**:

```cpp
  if (cur_version == 23) {
    if (!MigrateDownloadsReasonPathsAndDangerType())
      return LogMigrationFailure(23);
    cur_version++;
    std::ignore = meta_table_.SetVersionNumber(cur_version);
  }
```

Not platform-conditional. Runs everywhere.

### 2.2 The rewrite

`components/history/core/browser/download_database.cc` @ `cb211f6`,
`DownloadDatabase::MigrateDownloadsReasonPathsAndDangerType()` lines **114-193**. It renames
`downloads` to `downloads_tmp`, creates the new `downloads` table (lines 121-135) and
`downloads_url_chains` (lines 137-144), then (lines **150-168**):

```cpp
  // Populate it.  As we do so, we transform the time values from time_t
  // (seconds since 1/1/1970 UTC), to our internal measure (microseconds
  // since the Windows Epoch).  Note that this is dependent on the
  // internal representation of base::Time and needs to change if that changes.
  ...
      "SELECT id,full_path,full_path,"
      "CASE start_time WHEN 0 THEN 0 ELSE "
      "(start_time + 11644473600) * 1000000 END,"
      "received_bytes,total_bytes,state,?,?,"
      "CASE end_time WHEN 0 THEN 0 ELSE "
      "(end_time + 11644473600) * 1000000 END,"
      "opened "
      "FROM downloads_tmp"
```

The Chromium comment states the pre-state explicitly: **`time_t`, seconds since 1970-01-01 UTC**.
Offset added in seconds (`+ 11644473600`) *then* scaled by 1e6 — that shape is itself the proof
that the source unit was seconds, distinct from the Unix-**µs** pre-state of `urls`/`visits`
(§1.1). Two different legacy epochs coexist in one file.

### 2.3 Result table

| `meta.version` on disk | `downloads.start_time`, `downloads.end_time` |
|---|---|
| <= 23 | **Unix seconds UTC** (`time_t`) — and the table has the old schema (`full_path`, no `current_path`/`target_path`, no `danger_type`/`interrupt_reason`, no `downloads_url_chains`) |
| >= 24 | **1601-µs UTC** |

Sentinel: `CASE ... WHEN 0 THEN 0` — **0 is carried through as 0** and means "unset", in both
epochs. `end_time = 0` is common (download never completed). Never render 0 as a date.

Schema-shape corollary, useful as a cross-check without reading `meta.version`: the existence of
the `downloads_url_chains` table implies version >= 24, hence 1601-µs. A `downloads` table with a
`full_path` column implies <= 23, hence Unix seconds.

### 2.4 Milestone

**RESOLVED by release-tag bisection: first shipped in stable Chrome M26.** Full bisection data in
§8.1. Summary of the four tags that bracket it, each fetched and decoded:

| tag | `kCurrentVersionNumber` in `chrome/browser/history/history_database.cc` | `MigrateDownloadsReasonPathsAndDangerType` |
|---|---|---|
| `23.0.1271.64` | 23 | absent |
| `24.0.1312.52` | 23 | absent |
| `25.0.1364.172` | 23 | absent |
| `26.0.1410.43` | **25** | **present** — `if (cur_version == 23) { MigrateDownloadsReasonPathsAndDangerType() ...}` at lines 402-408 |

M26 `stable_date` = **2013-03-26** (branch point 2013-02-08), from
`chromiumdash.appspot.com/fetch_milestone_schedule?mstone=26`.

So `research/125-...-unverified.md`'s guess of "v24-26 / ~M26 / 2013" turns out to be right, but
it is now **primary-sourced** rather than recalled, and the precise boundary is a single number:
**`meta.version` 23 → 24**, shipping in **M26 (2013-03-26)**. Narrowing further to the exact CL
within the M26 cycle would need `+log`/blame (401) — VQ-2, and not needed for parsing.

### 2.5 `downloads.last_access_time`

Added by the migration at `cur_version == 33` (`history_database.cc` lines **851-857**,
`MigrateDownloadLastAccessTime()`), implemented in `download_database.cc` line **304**:

```cpp
  return EnsureColumnExists("last_access_time", "INTEGER NOT NULL DEFAULT 0");
```

So: **column absent at `meta.version` <= 33; present at >= 34.** A parser must `PRAGMA
table_info(downloads)` (or gate on version >= 34) before selecting it.

It is 1601-µs from introduction — never had another encoding, because it is only ever written
via `BindTime`: `download_database.cc` line **613** (`UpdateDownload`, UPDATE statement at
line 596) and line **703** (`CreateDownload`, INSERT at line 680). `start_time` and `end_time`
are bound the same way today — lines **692** and **610**/**701**.

**Sentinel: DEFAULT 0.** Every row that existed before the migration, and every download never
re-opened, has `last_access_time = 0` meaning "never accessed", NOT 1601-01-01.

## 3. History — remaining columns

### 3.0 Foundation: what `BindTime` actually writes (read, so every call site below is settled)

`sql/statement.cc` @ `cb211f6`:

```cpp
// line 42
int64_t Statement::TimeToSqlValue(base::Time time) {
  return time.ToDeltaSinceWindowsEpoch().InMicroseconds();
}
// line 312 (inside Statement::BindTime)
  int64_t int_value = TimeToSqlValue(val);
  sqlite3_bind_int64(ref_->stmt(), param_index + 1, int_value);

// line 529
base::Time Statement::ColumnTime(int column_index) {
  int64_t int_value = sqlite3_column_int64(ref_->stmt(), column_index);
  return base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(int_value));
}

// line 331 (BindTimeDelta) -> delta.InMicroseconds()
// line 537 (ColumnTimeDelta) -> base::Microseconds(int_value)
```

=> **`BindTime`/`ColumnTime` == 1601-01-01T00:00:00 UTC microseconds, signed int64.**
`BindTimeDelta`/`ColumnTimeDelta` == a **duration in microseconds**, NOT a timestamp. This one
read classifies every call site below and in the rest of this file.

### 3.1 `urls.last_visit_time`

Schema `components/history/core/browser/url_database.cc` @ `cb211f6` line **735**:
`"last_visit_time INTEGER NOT NULL,"` (in `CreateURLTable`, lines 723-737).

Write sites, all `BindTime`:
- line **162** — `UPDATE urls SET title=?,visit_count=?,typed_count=?,last_visit_time=?,...` (`UpdateURLRow`)
- line **192** — `INSERT INTO urls (... last_visit_time, hidden)` (`AddURLInternal`)
- line **247** — `INSERT OR REPLACE INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)` (`InsertOrUpdateURLRowByID`)

Read site line **68** `i->set_last_visit(s.ColumnTime(5))`.

**Epoch: 1601-µs UTC** at `meta.version` >= 17, on all platforms. At <= 16 see §1 — depends on
origin OS. Sentinel `0` = never visited / placeholder (the v16 migration's `WHERE > 0` predicate
is evidence Chromium itself treats 0 specially).

### 3.2 `visits.visit_time`

Schema `components/history/core/browser/visit_database.cc` @ `cb211f6` line **155**:
`"visit_time INTEGER NOT NULL,"` (in `InitVisitTable`, `CREATE TABLE visits(` at line 146).

Write sites, `BindTime`:
- line **393** — `INSERT INTO visits (url, visit_time, from_visit, external_referrer_url, transition, segment_id, visit_duration, incremented_omnibox_typed_score, ...)` (SQL at line 384)
- line **548** — `UPDATE visits SET url=?,visit_time=?,...` (SQL at line 539)

Read site line **273** `visit->visit_time = statement.ColumnTime(2)`.

**Epoch: 1601-µs UTC** at >= 17; see §1 for <= 16.

### 3.3 `visits.visit_duration` — NOT a timestamp

Schema line **163**: `"visit_duration INTEGER DEFAULT 0 NOT NULL,"`.
Written with **`BindTimeDelta`** (lines **398**, **553**), read with **`ColumnTimeDelta`**
(line **281**). Per §3.0 this is **microseconds of elapsed time**, not an absolute time.
Rendering it as a date gives 1601-01-01 + a few minutes. Column added by the migration at
`meta.version == 20` (`history_database.cc` lines 744-751, `MigrateVisitsWithoutDuration()`),
so **absent at <= 20, present at >= 21**; rows predating the migration get `0`.

### 3.4 `visit_source` — no timestamp

`visit_database.cc` @ `cb211f6` lines **220-221**:
`CREATE TABLE visit_source(id INTEGER PRIMARY KEY,source INTEGER NOT NULL)`.
Two columns, no time. Join to `visits.id`. Note the comment at lines 217-219: ordinary
user-browsed visits are **deliberately not recorded here to save space**, so a missing row means
"browsed" (`SOURCE_BROWSED`), not "unknown" — confirmed by line **611**,
`sql += ", IFNULL(visit_source.source, 1)"`.

### 3.5 `keyword_search_terms` — no timestamp

`url_database.cc` @ `cb211f6` lines **458-464**:

```sql
CREATE TABLE keyword_search_terms (
  keyword_id INTEGER NOT NULL,   -- ID of the TemplateURL.
  url_id INTEGER NOT NULL,       -- ID of the url.
  term LONGVARCHAR NOT NULL,     -- The actual search term.
  normalized_term LONGVARCHAR NOT NULL)
```

**No time column at all.** The only time available for a search is `urls.last_visit_time` via the
`url_id` join — Chromium itself does exactly that at lines **534-535** and **623-625**
(`SELECT ... u.last_visit_time FROM keyword_search_terms kst JOIN urls u ON kst.url_id = u.id`).

**Forensic caveat:** `urls.last_visit_time` is the *last* visit to that search-results URL, not
the time the term was typed, and one `urls` row can be revisited. Repeated identical searches
collapse. Do not present it as "search time" without that qualification. For per-occurrence
timing, join through `visits` on `url_id` instead.

`normalized_term` (lower-cased, whitespace-collapsed) was added by the migration at
`meta.version == 41` (`history_database.cc` lines 922-928,
`MigrateKeywordsSearchTermsLowerTermColumn()`); the older `lower_term` column is what it
replaced — `url_database.cc` lines 76-111 recreate the table. So the column set here is
version-dependent: **`lower_term` at <= 41, `normalized_term` at >= 42.**

### 3.6 `segment_usage.time_slot` — 1601-µs UTC ENCODING OF **LOCAL** MIDNIGHT — CONFIRMED

**This is the second-highest-value finding in this file, and it is a counterexample to "no
Chrome artifact stores local time".**

`components/history/core/browser/visitsegment_database.cc` @ `cb211f6`
(note: filename is `visitsegment_database.cc`, NOT `visit_segment_database.cc`).

Schema, lines **132-136**:
```sql
CREATE TABLE segment_usage (
  id INTEGER PRIMARY KEY,
  segment_id INTEGER NOT NULL,
  time_slot INTEGER NOT NULL,
  visit_count INTEGER DEFAULT 0 NOT NULL)
```
Header comment line **37**: `//   time_slot   time stamp identifying for what day this entry is about`.

Write site, `VisitSegmentDatabase::UpdateSegmentVisitCount()` lines **228-256**:

```cpp
bool VisitSegmentDatabase::UpdateSegmentVisitCount(SegmentID segment_id,
                                                   base::Time ts,
                                                   int amount) {
  base::Time t = ts.LocalMidnight();          // line 231
  ...
  select.BindTime(0, t);                      // line 236
  ...
        "INSERT INTO segment_usage "
        "(segment_id, time_slot, visit_count) VALUES (?, ?, ?)"));
    insert.BindInt64(0, segment_id);
    insert.BindTime(1, t);                    // line 254
```

Also line **374**: `statement.BindTime(0, older_than.LocalMidnight())` in the delete path.

So the **container** is 1601-µs UTC (per §3.0), but the **value** is midnight in the
**host machine's local timezone at the moment of writing**, expressed as a UTC instant.

Forensic consequences:

1. `time_slot % 86400000000` is (almost always) the **UTC offset of the host at that time**,
   negated and reduced mod 24h. A non-zero remainder is a direct, persisted measurement of the
   machine's timezone offset on that day — including DST transitions, day by day. For a
   UTC/GMT-with-no-DST host the remainder is 0 and the column is indistinguishable from UTC
   midnight. **This is a genuine timezone-offset recovery primitive** and, as far as this pass
   found, the only one in the History file. (The arithmetic consequence is stated as inference;
   what is *sourced* is only that `LocalMidnight()` is on the write path.)
2. Rendering `time_slot` as a UTC date will show the **wrong calendar day** for roughly half the
   world (any host east of UTC shows the previous day; west of UTC, potentially the same day at
   a bizarre hour). Render as "local day of the host" and say so.
3. Values are **quantised to one day**. Do not present a `time_slot` as a visit time.
4. Sub-day quantisation means the v16 migration's `+11644473600000000` applies here too
   (§1.1 rewrites `segment_usage.time_slot` as well), so pre-v17 non-Windows DBs have local
   midnight in **Unix µs**.

`LocalMidnight()` also appears at `visit_database.cc` line **340-341**
(`found_urls_midnight = visit.visit_time.LocalMidnight()`), but that is a **query-time**
de-duplication (`REMOVE_DUPLICATES_PER_DAY`) and is not persisted. Only `segment_usage` persists
a local-derived value.

### 3.7 `downloads_url_chains` — no timestamp

`download_database.cc` @ `cb211f6` lines **137-144**:
```sql
CREATE TABLE downloads_url_chains (
  id INTEGER NOT NULL,           -- downloads.id.
  chain_index INTEGER NOT NULL,  -- Index of url in chain
  url LONGVARCHAR NOT NULL,
  PRIMARY KEY (id, chain_index) )
```
No time column. The table is **created by the v23→24 migration** (§2.2), so its presence is
itself a version signal.

### 3.8 `downloads.last_modified` — an HTTP header STRING, not an epoch

`download_database.cc` @ `cb211f6` line **208**:
`EnsureColumnExists("last_modified", "VARCHAR NOT NULL DEFAULT \"\"")` — added together with
`etag` (line 207) by `MigrateDownloadValidators()`, run at `meta.version == 27`
(`history_database.cc` lines 804-810). **Absent at <= 27, present at >= 28.**

It is a **VARCHAR** holding the server's HTTP `Last-Modified` response header verbatim
(RFC 9110 IMF-fixdate, e.g. `Wed, 21 Oct 2015 07:28:00 GMT`, always GMT by spec but
server-controlled and therefore **not trustworthy as host evidence**). Empty string = not
provided. It is the one string date in a table of integer dates — do not run it through an epoch
converter.

### 3.9 `content_annotations` / `context_annotations` / `clusters` — NO TIMESTAMPS (negative claim, verified)

`components/history/core/browser/visit_annotations_database.cc` @ `cb211f6`,
`InitVisitAnnotationsTables()` lines **194-232** and `CreateClustersTable()` /
`CreateClustersAndVisitsTableAndIndex()` lines **1443-1470**. Full `CREATE TABLE` text read.

- `content_annotations` (lines 196-210): `visit_id, visibility_score, floc_protected_score,
  categories, page_topics_model_version, annotation_flags, entities, related_searches,
  search_normalized_url, search_terms, alternative_title, page_language, password_state,
  has_url_keyed_image`. **No time column.** Time comes from `visits.visit_time` via `visit_id`.
- `context_annotations` (lines 215-227): `visit_id, context_annotation_flags,
  duration_since_last_visit, page_end_reason, total_foreground_duration, browser_type,
  window_id, tab_id, task_id, root_task_id, parent_task_id, response_code`.
  **No absolute time.** The two `duration*` columns are **microsecond durations** — written with
  plain `BindInt64(..., .InMicroseconds())` at lines **331** and **334** (INSERT) and **413** /
  **416** (UPDATE), i.e. `base::TimeDelta::InMicroseconds()` explicitly, not `BindTime`.
  **`total_foreground_duration` has a sentinel of `-1000000`** — line 1209,
  `"ADD COLUMN total_foreground_duration NUMERIC DEFAULT -1000000"`, with the comment at line
  1206 `// 1000000us = 1s which is the default duration for this DB.` A negative value means
  "unknown/not measured", not "negative time".
  (This corrects the lead sheet's guess of "duration in seconds": it is **microseconds**.)
- `clusters` (lines 1444-1451): `cluster_id, should_show_on_prominent_ui_surfaces, label,
  raw_label, triggerability_calculated, originator_cache_guid, originator_cluster_id`.
  **No time column.**
- `clusters_and_visits` (lines 1456-1465): `cluster_id, visit_id, score, engagement_score,
  url_for_deduping, normalized_url, url_for_display, interaction_state`. **No time column.**
- `cluster_keywords` (line 243), `cluster_visit_duplicates` (line 261): no time columns.

=> **A Journeys/cluster timeline must be built by joining `clusters_and_visits.visit_id` to
`visits.visit_time`.** There is no cluster-level timestamp to read.

### 3.10 Second platform-conditional block in the History ladder (schema shape, not epoch)

`history_database.cc` @ `cb211f6` lines **1155-1168**:

```cpp
  if (cur_version == 69) {
    // The android_urls table's stopped being read in 91.0.4438.0. Delete it if
    // it still exists.
#if BUILDFLAG(IS_ANDROID)
    if (!DropAndroidUrlsTable()) { ... }
#endif
    cur_version++;
```

So an `android_urls` table can **survive at `meta.version == 70` on a non-Android build**. Not a
timestamp issue, but it is a second confirmed case of `meta.version` not determining schema
shape — same failure mode as §1. Do not infer "Android profile" from the presence of
`android_urls`.

## 4. `Top Sites` — NO TIMESTAMP COLUMN (negative claim, verified)

`components/history/core/browser/top_sites_database.cc` @ `cb211f6`.

Version constants (lines **58-59**) — note this DB uses `kVersionNumber`, not
`kCurrentVersionNumber`:

```cpp
static const int kVersionNumber = 5;
static const int kDeprecatedVersionNumber = 3;  // and earlier.
```

Version history, transcribed verbatim from the source comment block (lines **50-54**) — this is
the rare case where Chromium records the landing date inline, so no `+log` is needed:

```
// Version 5: TODO apaseltiner@chromium.org on 2022-09-21
// Version 4: 95af34ec/r618360 kristipark@chromium.org on 2018-12-20
// Version 3: b6d6a783/r231648 by beaudoin@chromium.org on 2013-10-29
// Version 2: eb0b24e6/r87284 by satorux@chromium.org on 2011-05-31 (deprecated)
// Version 1: 809cc4d8/r64072 by sky@chromium.org on 2010-10-27 (deprecated)
```

Current schema, `InitTables()` lines **65-70**:

```sql
CREATE TABLE IF NOT EXISTS top_sites(
  url TEXT NOT NULL PRIMARY KEY,
  url_rank INTEGER NOT NULL,
  title TEXT NOT NULL)
```

**Three columns. No timestamp of any kind.** The v4→5 upgrade (`UpgradeToVersion5`, lines
**171-202**) copies exactly `url, url_rank, title` into a new table and drops the old one —
confirming that whatever v4 had beyond those three (the legacy thumbnail/`last_updated`
machinery) was **discarded, not migrated**.

=> **A Top Sites timeline is impossible.** Any feature or report that dates a Top Sites entry is
fabricating. The only temporal information is the implicit ordering in `url_rank`. This
contradicts the lead sheet's "legacy `thumbnails.last_updated`" row for any modern file (see
below).

**Razing:** `InitImpl()` lines **203-262**. If the file exists but has **no meta table** it is
`Raze()`d outright (lines 219-224). Then `sql::MetaTable::RazeIfIncompatible(db, /*lowest
supported=*/kDeprecatedVersionNumber + 1 = 4, kVersionNumber = 5)` (lines 227-231) **destroys
any Top Sites DB at version <= 3.** Only versions 4 and 5 survive contact with a modern Chrome;
v4 is then upgraded to v5 in place (lines 251-254). So the legacy `thumbnails` table, and its
`last_updated`, cannot be observed in a file that a recent Chrome has opened — it survives only
in a forensic image of a pre-2018 profile.

**UNRESOLVED:** the epoch/semantics of `thumbnails.last_updated` in Top Sites v<=3 files. The
migration code that would have documented it has been deleted from `main`. Would require
fetching an old release tag (~M31, 2013). Verification queue item VQ-4.

---

## 5. `Favicons` — both time columns 1601-µs UTC, with a hard 0 sentinel

**Path rot:** `components/history/core/browser/thumbnail_database.cc` is **GONE** (404). The
class was renamed and moved to `components/favicon/core/favicon_database.cc` (class
`FaviconDatabase`). Read @ `cb211f6`.

Version constants, lines **114-116**:
```cpp
const int kCurrentVersionNumber = 9;
const int kCompatibleVersionNumber = 9;
const int kDeprecatedVersionNumber = 7;  // and earlier.
```

Version history, verbatim from the comment block (lines **102-108**):
```
// Version 9: <TODO>/r6208170 by ckitagawa@chromium.org on 2025-01-28
// Version 8: 982ef2c1/r323176 by rogerm@chromium.org on 2015-03-31
// Version 7: 911a634d/r209424 by qsr@chromium.org on 2013-07-01 (depr.)
// Version 6: 610f923b/r152367 by pkotwicz@chromium.org on 2012-08-20 (depr.)
// Version 5: e2ee8ae9/r105004 by groby@chromium.org on 2011-10-12 (deprecated)
// Version 4: 5f104d76/r77288 by sky@chromium.org on 2011-03-08 (deprecated)
// Version 3: 09911bf3/r15 by initial.commit on 2008-07-26 (deprecated)
```
Note the policy comment at lines **94-100**: "For this database, schema migrations are deprecated
after two years... Databases containing deprecated versions **will be cleared at startup**."
So Favicons at version <= 7 is razed by a modern Chrome. Only 8 and 9 survive.

### 5.1 Schema (`InitTables()`, lines 119-158)

```sql
CREATE TABLE IF NOT EXISTS icon_mapping(
  id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL,
  icon_id INTEGER, page_url_type INTEGER DEFAULT 0)          -- no timestamp

CREATE TABLE IF NOT EXISTS favicons(
  id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL,
  icon_type INTEGER DEFAULT 1)                                -- no timestamp

CREATE TABLE IF NOT EXISTS favicon_bitmaps(
  id INTEGER PRIMARY KEY,
  icon_id INTEGER NOT NULL,
  last_updated INTEGER DEFAULT 0,
  image_data BLOB,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  last_requested INTEGER DEFAULT 0)
```

`icon_mapping` and `favicons` confirmed to have **no time columns**.

### 5.2 `favicon_bitmaps.last_updated` / `.last_requested` — 1601-µs UTC

Both written with `BindTime` and read with `ColumnTime` (per §3.0 ⇒ 1601-µs UTC):
- INSERT `AddFaviconBitmap` — SQL lines **433-434**, binds at lines **446** and **451**
- UPDATE lines **472**/**478**, **493**/**495**, **553**
- reads lines **371**, **379**, **402**, **417**, **575**

### 5.3 The 0 sentinel and the ON_VISIT / ON_DEMAND dichotomy — THE key semantic here

Source comments, lines **76-90**:

```
//   last_updated     The time at which this favicon was inserted into the
//                    table. This is used to determine if it needs to be
//                    redownloaded from the web. Value 0 denotes that the bitmap
//                    has been explicitly expired.
//                    This is used only for ON_VISIT icons, for ON_DEMAND the
//                    value is always 0.
//   last_requested   The time at which this bitmap was last requested. This
//                    entry is non-zero iff the bitmap is of type ON_DEMAND.
```

And the write site makes it mechanical — lines **443-451**:

```cpp
  // On-visit bitmaps:
  //  - keep track of last_updated: last write time is used for expiration;
  //  - always have last_requested==0: no need to keep track of last read time.
  type == ON_VISIT ? statement.BindTime(2, time) : statement.BindInt64(2, 0);
  // On-demand bitmaps:
  //  - always have last_updated==0: ...
  //  - keep track of last_requested: last read time is used for cache eviction.
  type == ON_DEMAND ? statement.BindTime(3, time) : statement.BindInt64(3, 0);
```

Forensic rules:

1. **Exactly one of the two columns is populated per row.** The other is a literal `0` written
   by `BindInt64`, NOT a time. Rendering `0` gives 1601-01-01T00:00:00Z — a classic false date.
   Suppress it.
2. `last_updated == 0` is **overloaded**: it means either "this is an ON_DEMAND bitmap" or
   "this ON_VISIT bitmap was **explicitly expired**". Line **507-510**
   (`UPDATE favicon_bitmaps SET last_updated=0 WHERE last_updated>=? AND last_updated<?`) is a
   deletion-by-time-range operation that **zeroes the timestamp in place**. So a `0` can be the
   residue of a user's "clear browsing data" for a time range — evidence of deletion, and
   evidence that the original time is gone. Worth surfacing as such.
3. `last_updated` is the **insert/download time of the icon**, not a page-visit time. Use
   `icon_mapping.page_url` to attribute, but do not present it as "user visited page at T".
4. `last_requested` is genuinely a **last-read** time (cache eviction), and only for ON_DEMAND
   bitmaps (which have no corresponding history visit — see the comment at lines 88-90). It is
   also **coarsened**: line **526-536** only updates it when the existing value is
   `> 0 AND <= max_time`, i.e. it is refreshed at most once per some interval rather than on
   every read. Treat it as "last requested no earlier than T", not as an exact access time.

No epoch-changing migration was found in this file; `last_updated`/`last_requested` have been
`BindTime` throughout versions 8-9. **UNRESOLVED:** whether v8 (2015-03-31) or earlier used a
different encoding — the deprecated migrations are deleted from `main`. Since v<=7 is razed
anyway, the practical exposure is v8 only. Verification queue item VQ-5.

---

## 6. `Shortcuts` — `last_access_time` is 1601-µs UTC (INTEGER, not a string)

`components/omnibox/browser/shortcuts_database.cc` @ `cb211f6`.

Version constants, lines **30-31**:
```cpp
const int kCurrentVersionNumber = 2;
const int kCompatibleVersionNumber = 1;
```

**Table name is `omni_box_shortcuts`** (not `shortcuts`). Schema, `DoMigration(-1)` lines
**356-363**:

```sql
CREATE TABLE omni_box_shortcuts(
  id VARCHAR PRIMARY KEY, text VARCHAR, fill_into_edit VARCHAR, url VARCHAR,
  document_type INTEGER, contents VARCHAR, contents_class VARCHAR,
  description VARCHAR, description_class VARCHAR, transition INTEGER,
  type INTEGER, keyword VARCHAR,
  last_access_time INTEGER,
  number_of_hits INTEGER)
```

**`last_access_time` is declared INTEGER.** This settles the "weak memory of an older string
encoding" flagged in `125-...-unverified.md` §5 for the current schema: it is an integer column.

Write site — `BindShortcutToStatement()` line **48**:
```cpp
  s.BindTime(12, shortcut.last_access_time);
```
Used by both `AddShortcut` (INSERT, SQL lines 152-158) and `UpdateShortcut` (UPDATE, SQL lines
168-176). Read site line **299**: `s.ColumnTime(12)`.

=> **1601-µs UTC**, per §3.0.

Default when a shortcut is constructed without one: line **128**,
`last_access_time(base::Time::Now())` — so there is no 0 sentinel in normal operation; a 0 here
would indicate corruption. (Line 240's comment notes "Some users have corrupt data in their SQL
database", and the read loop defends against it.)

### 6.1 Migration ladder — no epoch change

`DoMigration(int version)` lines **341-407**, a `switch`:
- `case -1` — no existing table: create at current version directly.
- `case 0` — pre-0 lacked `fill_into_edit`, `transition`, `keyword`; adds them and backfills
  `fill_into_edit=url`, `transition=1`, `type=2`. **Backfill caveat:** a `fill_into_edit` equal
  to the raw URL in an old profile may be migration residue, not user input.
- `case 1` — creates the MetaTable and renumbers four `AutocompleteMatchType` enum values
  (9→13, 10→14, 11→15, 12→16). **`type` is not comparable across the v1 boundary.**
- `case 2` — adds `document_type`.

**No migration touches `last_access_time`.** Its epoch has been 1601-µs for the whole of the
surviving ladder.

### 6.2 `meta.version` is absent below v1

Lines **320-330**: "v0 also lacks a MetaTable." `current_version` is left at 0 when
`sql::MetaTable::DoesTableExist()` is false. So a `Shortcuts` file **with no `meta` table at all
is version 0 (or pre-0)** — do not treat a missing meta table as corruption here.

---

## 7. `Network Action Predictor` — NO TIMESTAMP AT ALL (negative claim, verified; corrects #125)

`chrome/browser/predictors/autocomplete_action_predictor_table.cc` @ `cb211f6`.

Table name is set by a macro, line **22**:
```cpp
// TODO(shishir): Rename the table for consistency.
#define AUTOCOMPLETE_PREDICTOR_TABLE_NAME "network_action_predictor"
```
(so class `AutocompleteActionPredictorTable` ↔ table `network_action_predictor` ↔ on-disk file
`Network Action Predictor` — three different names for one thing.)

Schema, `CreateOrClearTablesIfNecessary()` lines **221-226**:

```sql
CREATE TABLE network_action_predictor(
  id TEXT PRIMARY KEY,
  user_text TEXT,
  url TEXT,
  number_of_hits INTEGER,
  number_of_misses INTEGER)
```

And the only bind helper, `BindRowToStatement()` lines **27-36**:
```cpp
  statement->BindString(0, row.id);
  statement->BindString16(1, row.user_text.substr(0, kMaxDataLength));
  statement->BindString(2, row.url.spec().substr(0, kMaxDataLength));
  statement->BindInt(3, row.number_of_hits);
  statement->BindInt(4, row.number_of_misses);
```

**Five columns, zero timestamps, and not a single `BindTime` in the file.**

> **CORRECTION to `research/125-integrity-facts-unverified.md`:** its
> `network_action_predictor.last_hit_time` row (MEDIUM confidence, `[inferred-from-name]`) is
> **WRONG — the column does not exist.** Nothing must be built on it. The lead sheet's suspicion
> (§2.9 / §5 item 2) is confirmed.

Forensic value of this artifact is therefore **non-temporal only**: `user_text` is
user-typed omnibox input (truncated to `kMaxDataLength` = 2048, line 25) paired with the URL it
resolved to, plus hit/miss counters. Valuable as evidence of *what* was typed; it cannot say
*when*. There is no `meta.version`-style constant in this file and no migration ladder — the
table is simply created if absent (line 217, `if (DB()->DoesTableExist(...)) return;`).

**UNRESOLVED:** the `Network Action Predictor` file is opened by `PredictorDatabase`
(`chrome/browser/predictors/predictor_database.cc`, not fetched) which also hosts the
**loading-predictor** tables (`resource_prefetch_predictor_tables.cc`, not fetched). Those hold
serialised protos that may carry `last_visit_time`. Verification queue item VQ-7.

## 8. Version-boundary notes (milestones pinned by release-tag bisection)

Method: `+log` is 401, so milestones were pinned by fetching
`history_database.cc` at `refs/tags/<stable version>` and reading `kCurrentVersionNumber` /
grepping for the migration function. A migration "first shipped in stable MN" means: absent at
the last M(N-1) stable tag fetched, present at the MN stable tag fetched. Every tag below was
actually fetched and decoded.

### 8.1 Raw bisection data

| tag fetched | path | `kCurrentVersionNumber` | notes |
|---|---|---|---|
| `3.0.195.38` | `chrome/browser/history/history_database.cc` | **16** | `MigrateTimeEpoch` **absent** (grep count 0) |
| `4.0.249.78` | same | **17** | `MigrateTimeEpoch` **present** (decl + def) |
| `5.0.375.127` | same | 17 | present |
| `23.0.1271.64` | same | **23** | `MigrateDownloadsReasonPathsAndDangerType` absent |
| `24.0.1312.52` | same | 23 | absent |
| `25.0.1364.97` | same | 23 | absent |
| `25.0.1364.172` | same | **23** | absent |
| `26.0.1410.43` | same | **25** | `if (cur_version == 23) { MigrateDownloadsReasonPathsAndDangerType() ... }` at lines 402-408; `cur_version == 24` -> `MigratePresentationIndex()` at 412 |
| `54.0.2840.99` | `components/history/core/browser/history_database.cc` | 32 | `MigrateDownloadLastAccessTime` absent |
| `58.0.3029.110` | same | **33** | absent |
| `59.0.3071.115` | same | **36** | **present** |
| `60.0.3112.113` | same | 36 | present |
| `61.0.3163.100` | same | 36 | present |
| `64.0.3282.140` | same | 38 | present |
| `cb211f6` (main) | same | **70** | current |

Milestone dates from `chromiumdash.appspot.com/fetch_milestone_schedule?mstone=N` (fetched):
M26 `stable_date` = **2013-03-26** (branch point 2013-02-08);
M59 `stable_date` = **2017-05-30** (branch point 2017-04-13).
(`mstone=4` returns a 500 from that endpoint — M4's date is not sourced here.)

### 8.2 Boundary table

| Boundary | `meta.version` | Migration fn | First stable milestone | Date |
|---|---|---|---|---|
| `urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot`: **Unix-µs -> 1601-µs, NON-WINDOWS ONLY** | **16 -> 17** | `MigrateTimeEpoch()` (guarded `#if !BUILDFLAG(IS_WIN)`) | **M4** (`4.0.249.78`); absent at `3.0.195.38` | ~2010, not sourced |
| `visits.visit_duration` column added (duration µs, not a time) | 20 -> 21 | `MigrateVisitsWithoutDuration()` | UNRESOLVED | — |
| **`downloads.start_time` / `.end_time`: Unix SECONDS -> 1601-µs** + `downloads` table reshape + `downloads_url_chains` created | **23 -> 24** | `MigrateDownloadsReasonPathsAndDangerType()` | **M26** (`26.0.1410.43`); absent at `25.0.1364.172` | **2013-03-26** |
| `downloads.referrer` added | 25 -> 26 | `MigrateReferrer()` | UNRESOLVED | — |
| `downloads.by_ext_id` / `.by_ext_name` added | 26 -> 27 | `MigrateDownloadedByExtension()` | UNRESOLVED | — |
| `downloads.etag` / **`.last_modified` (HTTP header STRING)** added | 27 -> 28 | `MigrateDownloadValidators()` | UNRESOLVED | — |
| `downloads.guid`, `.hash`, `.http_method` added | 29 -> 30 | `MigrateHashHttpMethodAndGenerateGuids()` | UNRESOLVED | — |
| `downloads_slices` table created | 32 -> 33 | (no migration needed) | UNRESOLVED | — |
| **`downloads.last_access_time` added (1601-µs, DEFAULT 0)** | **33 -> 34** | `MigrateDownloadLastAccessTime()` | **M59** (`59.0.3071.115`); absent at `58.0.3029.110`. NB v34, v35 and v36 all landed inside the M59 cycle | **2017-05-30** |
| `keyword_search_terms.lower_term` -> `.normalized_term` | 41 -> 42 | `MigrateKeywordsSearchTermsLowerTermColumn()` | UNRESOLVED | — |
| `context_annotations.total_foreground_duration` added (µs, DEFAULT **-1000000**) | 50 -> 51 | `MigrateContextAnnotationsAddTotalForegroundDuration()` | UNRESOLVED | — |
| `android_urls` dropped — **`#if BUILDFLAG(IS_ANDROID)` only** | 69 -> 70 | `DropAndroidUrlsTable()` | UNRESOLVED | — |

(Every `meta.version` in this table was read from the `EnsureCurrentVersion()` ladder in
`history_database.cc` @ `cb211f6` and is stated as "a DB at version N is upgraded to N+1 by this
block", i.e. the pre-migration state is `meta.version <= N`.)

### 8.3 The v16 migration body was NOT stable over time (minor, but worth recording)

At `4.0.249.78` (lines 284-300) the `visits` UPDATE also cleared a now-removed column:

```sql
"UPDATE visits "
"SET visit_time = visit_time + 11644473600000000, is_indexed = 0 "
"WHERE id IN (SELECT id FROM visits WHERE visit_time > 0);"
```

The modern body @ `cb211f6` has dropped the `is_indexed = 0` clause (the column itself is gone —
see `visit_database.cc` line 161: *"Some old DBs may have an 'is_indexed' field here, but this
is no longer used"*). **The arithmetic (`+ 11644473600000000`) and the `#if !IS_WIN` guard are
identical in M4 and in main**, which is what matters for §1. The guard spelling changed from
`#if !defined(OS_WIN)` to `#if !BUILDFLAG(IS_WIN)` — same semantics.

### 8.4 Practical exposure of the v16 hazard (scoping note, partly inferred)

The v16→17 migration shipped in stable **M4**, and `kCurrentVersionNumber` was already 17 at
M4. Therefore a History DB found at `meta.version` 15 or 16 was **last written by Chrome M3 or
earlier** (or by a pre-M4 dev/beta build). Its epoch depends on the OS of that build.

> **Not sourced here, flag as inference:** Chrome for macOS/Linux reached *stable* later than
> M4, so a non-Windows v16 DB most likely originates from a 2009 Mac/Linux **dev or beta**
> build. This narrows, but does not eliminate, the population. It is model knowledge — VQ-8.

The correct posture is unchanged: **at `meta.version` <= 16 the parser must not assume an
epoch.** Apply §1.3.

### 8.5 Other DBs in scope — version constants

| DB | file | constant | value @ `cb211f6` |
|---|---|---|---|
| History | `components/history/core/browser/history_database.cc` | `kCurrentVersionNumber` / `kCompatibleVersionNumber` / `kMinimalVersionNumber` | 70 / 16 / 15 |
| Top Sites | `components/history/core/browser/top_sites_database.cc` | `kVersionNumber` / `kDeprecatedVersionNumber` | 5 / 3-and-earlier (razed) |
| Favicons | `components/favicon/core/favicon_database.cc` | `kCurrentVersionNumber` / `kCompatibleVersionNumber` / `kDeprecatedVersionNumber` | 9 / 9 / 7-and-earlier (razed) |
| Shortcuts | `components/omnibox/browser/shortcuts_database.cc` | `kCurrentVersionNumber` / `kCompatibleVersionNumber` | 2 / 1 (v0 has no meta table) |
| Network Action Predictor | `chrome/browser/predictors/autocomplete_action_predictor_table.cc` | *(none)* | no version constant, no migration ladder |

---

## 9. UNRESOLVED / verification queue

| ID | Item | Why it matters | How to close it |
|---|---|---|---|
| VQ-1 | Calendar **date** for History v16 -> 17. The **milestone is pinned to M4** by tag bisection (`3.0.195.38` = v16, no migration; `4.0.249.78` = v17, migration present), but `fetch_milestone_schedule?mstone=4` returns HTTP 500, so no date is sourced. | cosmetic only; both the `meta.version` boundary and the milestone ARE pinned | try `fetch_releases` with an explicit old version string, or the Chrome release blog |
| VQ-2 | Narrow the downloads migration inside the M26 cycle to a CL/SHA. | not needed for parsing; the `meta.version` 23->24 boundary and M26 stable are both pinned | needs `+log`/blame (401 unauthenticated) |
| VQ-3 | Milestones for the remaining History boundaries in §8.2 marked UNRESOLVED (v20->21, 25->26, 26->27, 27->28, 29->30, 32->33, 41->42, 50->51, 69->70). | low: none is an epoch change, all are column adds | same tag-bisection recipe as §8.1; ~2 fetches each |
| VQ-4 | Epoch and semantics of `thumbnails.last_updated` in **Top Sites v<=3**. | v<=3 is razed by modern Chrome, so only reachable in a pre-2018 image | fetch `top_sites_database.cc` at a ~M31 (2013) tag, where the migration still existed |
| VQ-5 | Whether Favicons **v8** (2015-03-31) encoded `last_updated`/`last_requested` the same way. v<=7 is razed so v8 is the only legacy exposure. | medium | fetch `thumbnail_database.cc` at an M42-M50 tag and read the bind sites |
| VQ-6 | Whether `content_annotations` / `clusters` ever had a time column that was later dropped. Current schema verified time-free, but the migration bodies for the dropped columns were not all read. | low | read every `Migrate*` in `visit_annotations_database.cc` (1528 lines; only the CREATEs + key bodies were read) |
| VQ-7 | The **loading-predictor** tables that share the `Network Action Predictor` file: `chrome/browser/predictors/resource_prefetch_predictor_tables.cc` and `predictor_database.cc` — **NOT FETCHED**. They store serialised protos that may carry `last_visit_time`. | medium — if a timestamp exists in that file, this section is incomplete | fetch both files; grep the `.proto` for time fields and the bind sites |
| VQ-8 | The claim that Chrome reached stable on macOS/Linux after M4 (§8.4). **Model knowledge, not sourced.** | scoping only; does not change the parsing rule | Chrome release history; do not state as fact until sourced |
| VQ-9 | The arithmetic claim in §3.6 that `time_slot % 86400000000` recovers the host UTC offset. The **source fact** (`LocalMidnight()` on the write path) is verified; the offset-recovery consequence is an inference and has not been tested against a real fixture. | high value if true — first timezone primitive found | run it on a committed fixture with a known-TZ origin |
| VQ-10 | Sub-second/DST edge cases of `base::Time::LocalMidnight()` (e.g. days where local midnight does not exist due to a DST spring-forward). `base/time/time.cc` **not fetched**. | affects VQ-9's reliability | read `Time::LocalMidnight()` in `base/time/time.cc` |
| VQ-11 | `visited_links` / `VisitedLinkDatabase` (`visits.visited_link_id` added at v66->67) — the table's own schema was **not read**. | unknown; may contain no time at all | fetch `components/history/core/browser/visited_link_database.cc` |
| VQ-12 | `downloads_slices` and `download_reroute_infos` (created at v45) schemas were not read in full. | low | grep `download_database.cc` `DOWNLOADS_SLICES_TABLE` CREATE |

### Explicit non-findings (negative claims, each verified by reading the full `CREATE TABLE`)

These are safe to rely on as "no timestamp exists":

- `Top Sites` `top_sites` — 3 columns, no time (§4)
- `network_action_predictor` — 5 columns, no time; **`last_hit_time` does not exist** (§7)
- `visit_source` — 2 columns, no time (§3.4)
- `keyword_search_terms` — 4 columns, no time (§3.5)
- `downloads_url_chains` — 3 columns, no time (§3.7)
- `content_annotations`, `context_annotations`, `clusters`, `clusters_and_visits`,
  `cluster_keywords`, `cluster_visit_duplicates` — no time; only µs durations (§3.9)
- `favicons`, `icon_mapping` — no time (§5.1)

### Sentinels that must never be rendered as dates

| Column | Sentinel | Means |
|---|---|---|
| `urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot` | `0` | unset / never (Chromium's own v16 migration excludes `<= 0`) |
| `downloads.start_time`, `downloads.end_time` | `0` | unset (explicitly preserved by `CASE ... WHEN 0 THEN 0` in the v23->24 migration) |
| `downloads.last_access_time` | `0` | never accessed — also the `DEFAULT 0` back-filled into every pre-v34 row |
| `downloads.last_modified` | `""` | header not sent. **This column is an HTTP date STRING, never an integer** |
| `favicon_bitmaps.last_updated` | `0` | either ON_DEMAND bitmap, **or** an ON_VISIT bitmap whose time was **zeroed by a range delete** (deletion evidence) |
| `favicon_bitmaps.last_requested` | `0` | ON_VISIT bitmap (exactly one of the two columns is ever non-zero) |
| `context_annotations.total_foreground_duration` | `-1000000` | "unknown" — the column default, not a negative duration |
| `visits.visit_duration` | `0` | not measured; also back-filled into all pre-v21 rows. And it is a **duration**, not a time |

---

## 10. Source index

All files fetched over
`https://chromium.googlesource.com/chromium/src/+/<REF>/<PATH>?format=TEXT` and base64-decoded
locally. `+log` was **not** used (returns HTTP 401 unauthenticated). Gitiles rate-limits: two
fetches in this session returned `RESOURCE_EXHAUSTED` (~328-byte body) and were retried after a
delay — **always size-check the response before decoding** (404 = ~233 bytes,
rate-limit = ~328 bytes).

### Main ref: `cb211f647e4138888643a909973b2d07d49ae79c`

| Path | Lines cited | Used for |
|---|---|---|
| `sql/statement.cc` | 42-44, 300-316, 318-335, 529-535, 537-543 | `BindTime`/`ColumnTime` = 1601-µs; `BindTimeDelta`/`ColumnTimeDelta` = µs duration |
| `components/history/core/browser/history_database.cc` | 42-45, 47-50, 98-124, 684-1189 (whole ladder), 706-719, 744-751, 772-778, 804-810, 851-857, 922-928, 993-999, 1155-1168, 1192-1208 | version constants, razing, full migration ladder, `MigrateTimeEpoch` |
| `components/history/core/browser/download_database.cc` | 84-104, 106-112, 114-193 (esp. 121-135, 137-144, 150-168), 198, 202-203, 207-208, 212-214, 290-317 (esp. 304), 338, 386-387, 596, 610-613, 680, 692, 701-703 | downloads epoch migration, column adds, modern bind sites |
| `components/history/core/browser/url_database.cc` | 68, 76-111, 156-162, 176-192, 239-247, 455-464, 507, 520, 534-535, 546, 623-630, 718-741 | `urls.last_visit_time`, `keyword_search_terms` schema |
| `components/history/core/browser/visit_database.cc` | 144-232 (CREATE visits + visit_source), 155, 161, 163, 217-221, 273, 281, 328-348, 384-398, 539-553, 611 | `visits.visit_time`, `visit_duration`, `visit_source`, query-time `LocalMidnight` |
| `components/history/core/browser/visitsegment_database.cc` **(note: `visitsegment_`, not `visit_segment_`)** | 30-40, 111, 128-142, 228-256 (esp. 231, 236, 254), 276, 373-374, 456 | `segment_usage.time_slot` = `LocalMidnight()` via `BindTime` |
| `components/history/core/browser/visit_annotations_database.cc` | 31-32, 194-232, 325-340, 400-416, 1204-1209, 1443-1470 | annotations/clusters have no timestamps; durations in µs; `-1000000` sentinel |
| `components/history/core/browser/top_sites_database.cc` | 50-59, 64-71, 171-202, 203-262 (esp. 219-231, 251-254) | Top Sites version history + no-timestamp schema + razing |
| `components/favicon/core/favicon_database.cc` **(moved from `components/history/core/browser/thumbnail_database.cc`, which now 404s)** | 70-90, 94-116, 119-158, 305-315, 358-379, 387-417, 433-451, 466-510, 526-536, 553, 561-575, 838-841, 933-943 | Favicons versions, schema, `BindTime` sites, ON_VISIT/ON_DEMAND 0 sentinel |
| `components/omnibox/browser/shortcuts_database.cc` | 26-49, 106-128, 150-185, 228-240, 299, 320-407 | Shortcuts version constants, `last_access_time` INTEGER + `BindTime`, migration ladder |
| `chrome/browser/predictors/autocomplete_action_predictor_table.cc` | 1-36, 210-241 | NAP has no timestamp column |

### Release tags fetched (for milestone bisection)

`chrome/browser/history/history_database.cc` @ tags
`3.0.195.38`, `4.0.249.78` (lines 262-274, 284-300 cited), `5.0.375.127`,
`23.0.1271.64`, `24.0.1312.52`, `25.0.1364.97`, `25.0.1364.172`,
`26.0.1410.43` (lines 402-418 cited).

`components/history/core/browser/history_database.cc` @ tags
`54.0.2840.99`, `58.0.3029.110`, `59.0.3071.115`, `60.0.3112.113`, `61.0.3163.100`,
`64.0.3282.140`.

### chromiumdash endpoints used

- `https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=26` -> `stable_date` 2013-03-26
- `https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=59` -> `stable_date` 2017-05-30
- `?mstone=4` -> HTTP 500 (endpoint does not serve pre-M20 milestones)
- **`fetch_releases?...&mstone=N` IGNORES the `mstone` parameter** — it returned the current
  stable (151.x) for every N tried (22, 24, 26, 28, 30). Do not use it for historical lookups;
  bisect release tags instead. (This corrects the method note in `143-confirmed-partial.md`,
  which reported it "confirmed working for N=24, 60, 120".)

### Path-rot found this pass

| Stale path | Correct path @ `cb211f6` |
|---|---|
| `components/history/core/browser/thumbnail_database.cc` | `components/favicon/core/favicon_database.cc` (class `ThumbnailDatabase` -> `FaviconDatabase`) |
| `components/history/core/browser/visit_segment_database.cc` | `components/history/core/browser/visitsegment_database.cc` (no underscore) |
| `chrome/browser/history/history_database.cc` | `components/history/core/browser/history_database.cc` (moved between M26 and M54) |
