# 143 — Timestamp epoch/version matrix: LEAD SHEET (grep plan)

**Ticket:** [Timestamp epoch and version matrix per artifact](https://github.com/ChmaraX/forensix/issues/143)

> ## READ THIS FIRST — provenance
>
> **NO LIVE SOURCE ACCESS.** This document was produced in a run where the agent had only
> `Read` / `Write` on the local repo. No `web_search`, no `WebFetch`, no `agent_browser`, no
> `Bash`. **Zero URLs below were fetched.** Every epoch claim is **model knowledge**, i.e.
> exactly the class of output that `research/125-integrity-facts-unverified.md` already is.
>
> **This file does NOT meet issue #143's acceptance bar** ("MANDATORY: primary sources only").
> It is not the deliverable. It exists for one purpose: to turn the web-enabled sibling pass
> into **confirmation** rather than **rediscovery**.
>
> The final artifact `research/143-timestamp-epoch-version-matrix.md` is owned by a sibling
> agent with network access. **Do not merge this file's guesses into that one.** Use this file
> only as a list of places to look and things to grep.
>
> Two rules held throughout:
> 1. No URL is presented as read. The URL column is literally labelled
>    **candidate permalink (NOT fetched)**.
> 2. Where recall is genuinely absent the cell says `UNKNOWN — grep for X`. A blank costs the
>    verifier less than a wrong guess.

**Date:** 2026-08-08 (repo-relative; no live clock consulted)
**Refs read:** none. All `main` references below are *aspirational targets*, not reads.

---

## 0. Path-rot warning (confirmed by supervisor, not by me)

The supervisor verified out-of-band that the path quoted in issue #143,
`components/password_manager/core/browser/login_database.cc`, is **stale**. The file now lives at:

```
components/password_manager/core/browser/password_store/login_database.cc
```

**Assume every path in issue #143 and in `125-integrity-facts-unverified.md` has rotted the
same way.** Chromium has done several large `components/` reorganisations (autofill split into
`addresses/` `payments/` `autocomplete/` subdirs; password_manager into `password_store/`;
DIPS moved to `content/browser/btm/`). Each row below carries a **path-rot risk** rating:

- **HIGH** — I expect this path to have moved; search by symbol, not by path.
- **MED** — plausible move.
- **LOW** — path has been stable for years.

**Recommended discovery method that survives path rot:** use Code Search symbol/regex queries
rather than file URLs, e.g. `https://source.chromium.org/search?q=file:autocomplete_table.cc`
or grep a local checkout. Resolve the file first, *then* permalink it with `;drc=<sha>`.

---

## 1. The single highest-value grep — do this before anything else

Almost every epoch question in #143 collapses to "which serialisation helper was called at the
bind site". Enumerate the helpers first, then classify every call site.

| Helper symbol | Produces | Falsifier / where it is defined (NOT fetched) |
|---|---|---|
| `sql::Statement::BindTime(col, t)` | **1601-µs UTC** int64 | Read `sql/statement.cc`. Expect body `BindInt64(col, time.ToDeltaSinceWindowsEpoch().InMicroseconds())`. If it does anything else, **every** "1601-µs" row below is wrong at once. |
| `sql::Statement::ColumnTime(col)` | reads 1601-µs | same file; confirms the read side |
| `sql::Statement::BindTimeDelta` / `ColumnTimeDelta` | **duration µs**, not a timestamp | disambiguates `visits.visit_duration` |
| `base::Time::ToDeltaSinceWindowsEpoch().InMicroseconds()` | 1601-µs UTC | `base/time/time.h` |
| `base::Time::ToInternalValue()` | 1601-µs UTC (identical number) | `base/time/time.h`; legacy spelling, being removed |
| `base::Time::ToTimeT()` / `base::Time::FromTimeT()` | **Unix seconds UTC** | `base/time/time.cc` |
| `base::Time::InMillisecondsSinceUnixEpoch()` / `FromMillisecondsSinceUnixEpoch()` | **Unix ms UTC** (modern spelling of `ToJsTime`) | `base/time/time.h` |
| `base::Time::ToJsTime()` / `FromJsTime()` | Unix ms as **double** | legacy; being renamed to the above |
| `base::Time::InSecondsFSinceUnixEpoch()` / legacy `ToDoubleT()` | **Unix seconds as double** (fractional) | used by JSON persisters (TransportSecurity, NEL) |
| `base::TimeToValue(t)` / `base::ValueToTime(v)` | JSON **decimal STRING of 1601-µs** | `base/json/values_util.cc`. This is the modern canonical JSON time encoding. |
| `PrefService::SetInt64(...)` | JSON **decimal STRING** of whatever int64 was passed | `components/prefs/pref_service.cc`. **Important:** a quoted string in prefs does NOT by itself imply 1601-µs — it may be a `SetInt64` of a Unix-seconds value. `125-…-unverified.md`'s "quoted string ⇒ 1601 µs" heuristic is therefore **unsafe** and should be corrected. |
| `base::Time::Now().ToDeltaSinceWindowsEpoch().InSeconds()` | **1601-SECONDS** — a fourth epoch family | suspected in Media History and possibly BTM/DIPS. Magnitude falsifier: ~1.3×10¹⁰ vs Unix-seconds ~1.7×10⁹. |

**Magnitude falsifier table** (use on real fixture data to sanity-check any claim below; a value
for "now", 2026):

| Family | Order of magnitude "now" | Digits |
|---|---|---|
| Unix seconds | 1.7×10⁹ | 10 |
| Unix ms | 1.7×10¹² | 13 |
| 1601 seconds | 1.34×10¹⁰ | 11 |
| Unix µs | 1.7×10¹⁵ | 16 |
| 1601 µs | 1.34×10¹⁷ | 18 |

This alone disambiguates 1601-µs vs Unix-seconds without any source access, and is the cheapest
cross-check the sibling can run against a committed fixture.

**Version-constant greps, per DB:** `kCurrentVersionNumber`, `kCompatibleVersionNumber`,
`kVersionNumber`, `kCurrentSchemaVersion`, `kDeprecatedVersionNumber`,
and the migration ladder `MigrateToVersion[0-9]+`, `MigrateDatabase(`, `DoMigration(`.

**Milestone pinning recipe** (untested, no access): take the SHA from the gitiles log entry for
the version-constant bump, then query
`https://chromiumdash.appspot.com/fetch_commit?commit=<sha>` (NOT fetched — confirm the endpoint
name; alternatives are `/fetch_releases` and the "Commits" UI at
`https://chromiumdash.appspot.com/commits`).

---

## 2. Per-artifact lead sheet

Legend for the **Epoch guess** column:
`1601-µs` / `1601-s` / `unix-s` / `unix-ms` / `unix-µs` / `str-1601-µs` (decimal string) /
`dbl-*` (JSON double) / `dur-µs` (duration, not a timestamp) / `UNKNOWN`.
**Every value is UNVERIFIED.** All epochs are UTC unless a row says otherwise.

---

### 2.1 `History` (SQLite)

- Version constants: `kCurrentVersionNumber`, `kCompatibleVersionNumber` in
  `components/history/core/browser/history_database.cc`. **Current value UNKNOWN — grep.**
  (`125-…-unverified.md` does not state one either; do not carry over any number from memory.)
- Migration ladder: `HistoryDatabase::EnsureCurrentVersion()` — one `if (cur_version == N)` block
  per step; this is where every History epoch boundary will be visible.
- Path-rot risk: **LOW** (`components/history/core/browser/` has been stable).
- Candidate permalink (NOT fetched):
  `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/history/core/browser/history_database.cc`

| Table.column | Epoch guess | Confidence | Writer file (candidate) | Grep for | Falsifier / suspected version boundary |
|---|---|---|---|---|---|
| `urls.last_visit_time` | 1601-µs | high | `url_database.cc` | `URLDatabase::AddURL`, `UpdateURLRow`, `BindTime` | If bind site is `ToTimeT()`, wrong. No boundary suspected. |
| `visits.visit_time` | 1601-µs | high | `visit_database.cc` | `VisitDatabase::AddVisit`, `BindTime` | as above |
| `visits.visit_duration` | **dur-µs** (not a timestamp) | high | `visit_database.cc` | `BindTimeDelta` / `ColumnTimeDelta` | If bound with `BindTime`, it's being treated as an absolute time — flag. |
| `downloads.start_time` | 1601-µs **today**; **unix-s in old DBs** | med | `download_database.cc` | `MigrateDownload*`, `ToTimeT`, `FromTimeT`, `BindTime` | **PRIORITY ROW.** `125-…` guessed "History version 24–26, ~M26, 2013" — treat that as a lead only. Grep the ladder for the block that rewrites `start_time`/`end_time`; the migration function name is the answer. |
| `downloads.end_time` | same as `start_time` | med | `download_database.cc` | same | same |
| `downloads.last_access_time` | 1601-µs | low | `download_database.cc` | column added by a `MigrateToVersionNN`; grep `last_access_time` | Column absent below some version — that version number is part of the deliverable. |
| `downloads.*` other (`by_ext_id`, `etag`, `last_modified`) | `last_modified` is an **HTTP header string** (RFC 7231 IMF-fixdate, GMT), not an epoch int | med | `download_database.cc` | `last_modified` | If it is an INTEGER column, my guess is wrong. Worth calling out — it is a string date in a table full of int dates. |
| `segment_usage.time_slot` | 1601-µs **but LOCAL-MIDNIGHT-ALIGNED** | med | `visit_segment_database.cc` | `LocalMidnight()`, `UpdateSegmentVisitCount` | **HIGHEST-VALUE LEAD IN THIS FILE.** If `LocalMidnight()` is on the write path, this is the one place a Chrome profile persists a value derived from the host timezone — which would partially answer #125 Q1(a) in the affirmative and give an offset-recovery primitive. Falsifier: bind site uses `UTCMidnight()` or raw `base::Time`. |
| `visit_source.*` | no timestamp | med | `visit_database.cc` | `CREATE TABLE visit_source` | — |
| `keyword_search_terms.*` | no timestamp (join to `urls` for time) | med | `keyword_search_term_...` in `url_database.cc` | `CREATE TABLE keyword_search_terms` | — |
| `content_annotations` / `context_annotations` | UNKNOWN — grep for `duration`, `time` columns | low | `visit_annotations_database.cc` | `CREATE TABLE context_annotations` | `total_foreground_duration` is likely a **duration in seconds** (int), not a timestamp. Verify. |
| `clusters` / `clusters_and_visits` | UNKNOWN — grep | none | `history_backend` / `visit_annotations_database.cc` | `CREATE TABLE clusters` | Journeys/clustering tables; may carry `last_visit_time`. Do not guess. |
| `visited_links` (newer table) | UNKNOWN — grep | none | `visited_link_database.cc` | `CREATE TABLE visited_links` | Recent addition; may have no timestamp at all. |
| `downloads_url_chains`, `downloads_slices` | no timestamp | med | `download_database.cc` | — | `downloads_slices.received_bytes` is a byte count; `125-…` already flags this. |

---

### 2.2 `Network/Cookies` (SQLite) and `Extension Cookies`

- Version constants in `net/extras/sqlite/sqlite_persistent_cookie_store.cc`:
  `kCurrentVersionNumber`, `kCompatibleVersionNumber`. **Current value UNKNOWN — grep.**
- Migration: a `switch`/`if` ladder inside `DoMigrateDatabaseSchema()` (name approximate — grep
  `MigrateDatabaseSchema` / `cur_version ==`).
- Path-rot risk: **LOW**.
- Location note: since ~M80 the file is `<Profile>/Network/Cookies`, previously `<Profile>/Cookies`
  — **UNVERIFIED milestone**, grep `chrome/common/chrome_constants.cc` for `kCookieFilename` and
  the network-service profile-path move.
- Candidate permalink (NOT fetched):
  `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc`

| Column | Epoch guess | Confidence | Grep for | Falsifier / boundary |
|---|---|---|---|---|
| `creation_utc` | 1601-µs | high | `BindTime`, `INSERT INTO cookies` | column is also the PK component |
| `expires_utc` | 1601-µs | high | same | `0` conventionally = session cookie — **verify semantics in `CanonicalCookie::IsPersistent()`**, do not assert from the DB alone |
| `last_access_utc` | 1601-µs | high | same | — |
| `last_update_utc` | 1601-µs | med | `last_update_utc`, `MigrateToVersion` | **Column does not exist below some version.** `125-…` guessed "~M101, 2022" — lead only. The exact `meta.version` that adds it is a required deliverable row. A tool must `PRAGMA table_info` before selecting it. |
| `has_cross_site_ancestor` (not a time) | — | low | — | listed only because it is a recent schema add that will show up in the same ladder |

**Also check:** whether any cookie-store migration ever *rewrote* time values (as opposed to
adding/dropping columns). I am **not aware of one**, but that is a negative claim from memory —
grep the ladder bodies for `UPDATE cookies SET ... utc`.

---

### 2.3 `Login Data` / `Login Data For Account` (SQLite)

- **Path corrected by supervisor:**
  `components/password_manager/core/browser/password_store/login_database.cc`
- Version constants: `kCurrentVersionNumber`, `kCompatibleVersionNumber` in that file.
  **Current value UNKNOWN — grep.**
- Migration entry point: `LoginDatabase::MigrateDatabase(...)` (grep `MigrateDatabase`,
  `MigrateLogins`, `kCurrentVersionNumber`).
- Path-rot risk: **HIGH** (already rotted once).
- Candidate permalink (NOT fetched):
  `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/password_manager/core/browser/password_store/login_database.cc`

| Table.column | Epoch guess | Confidence | Grep for | Falsifier / boundary |
|---|---|---|---|---|
| `logins.date_created` | **BOTH ENCODINGS LIVE.** unix-s at db version ≤ 8; 1601-µs at ≥ 9 | med | `FromTimeT`, `ToTimeT`, `UPDATE logins SET date_created`, `MigrateDatabase` | **PRIORITY ROW — the flagship hazard of #143.** Issue #143 cites lines ~824-832; expect those line numbers to be wrong post-move. The forensic point: the rewrite happens **in place on first open by newer Chrome**, and a forensic copy is never opened, so a v9+ `meta.version` does **not** guarantee the column was rewritten if the DB was copied mid-life. Verify whether the migration is gated on `meta.version` alone or also on a value-magnitude check. |
| `logins.date_synced` | 1601-µs | med | `BindTime` at the sync bind site | may have been unix-s at some early version — grep the ladder |
| `logins.date_last_used` | 1601-µs | med | `date_last_used`, `MigrateToVersion` | column added at a specific version — that number is a deliverable row |
| `logins.date_password_modified` | 1601-µs | med | `date_password_modified` | as above; added later than `date_last_used` I believe — verify order |
| `logins.date_received` (if present) | UNKNOWN — grep | none | `date_received` | may relate to password-sharing/received credentials |
| `stats.update_time` | **UNKNOWN — grep for `ToTimeT` vs `BindTime` in the `stats` INSERT** | none | `InteractionsStats`, `CREATE TABLE stats`, `update_time` | I have a competing memory of unix-s here. **Do not guess.** |
| `insecure_credentials.create_time` | 1601-µs | low | `CREATE TABLE insecure_credentials`, `create_time` | leaked/phished/weak credential table |
| `password_notes.date_created` | 1601-µs | low | `CREATE TABLE password_notes` | **Third `date_created` in the profile** — after `logins.date_created` and `autofill.date_created`. Worth an explicit collision note in the deliverable. |
| `sync_entities_metadata` / `sync_model_metadata` | serialised protos, not columns | med | — | proto timestamps are usually 1601-µs int64 fields; out of scope unless #118/#123 include them |

---

### 2.4 `Web Data` (SQLite) — the epoch exception zone

- Version constants: `components/webdata/common/web_database.cc` —
  `WebDatabase::kCurrentVersionNumber`, `kCompatibleVersionNumber`, `kDeprecatedVersionNumber`.
  **Current value UNKNOWN — grep.** (My unanchored recall is "somewhere in the 120s–140s"; that
  is a range, not a claim — do not quote it.)
- Migration ladder: `WebDatabase::MigrateOldVersionsAsNeeded()` dispatches into each table object's
  `MigrateToVersion(version, ...)`. So the ladder is **split across table classes** — grep
  `MigrateToVersion` in every `*_table.cc` under `components/autofill/core/browser/webdata/`,
  plus `components/search_engines/keyword_table.cc` and `components/os_crypt/.../token_service_table.cc`.
- Path-rot risk: **HIGH.** `autofill_table.cc` was split into at least:
  `webdata/autocomplete/autocomplete_table.cc`,
  `webdata/addresses/address_autofill_table.cc`,
  `webdata/payments/payments_autofill_table.cc`.
  Search by symbol (`AutocompleteTable`, `AddressAutofillTable`, `PaymentsAutofillTable`).
- Candidate permalinks (NOT fetched):
  `.../components/webdata/common/web_database.cc`,
  `.../components/autofill/core/browser/webdata/autocomplete/autocomplete_table.cc`,
  `.../components/autofill/core/browser/webdata/addresses/address_autofill_table.cc`,
  `.../components/autofill/core/browser/webdata/payments/payments_autofill_table.cc`
  (all under `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/`)

| Table.column | Epoch guess | Confidence | Grep for | Falsifier / boundary |
|---|---|---|---|---|
| `autofill.date_created` | **unix-s** | high | `ToTimeT()` in `AutocompleteTable::AddFormFieldValueTime` / `InsertAutocompleteEntry` | Issue #143 cites lines ~70,145 in `autocomplete_table.cc` — verify line numbers. **This is the 369-year collision partner of `logins.date_created`.** |
| `autofill.date_last_used` | **unix-s** | high | same | — |
| `credit_cards.date_modified` | unix-s | med | `PaymentsAutofillTable`, `ToTimeT` | — |
| `credit_cards.use_date` | UNKNOWN — grep `use_date` bind site | low | `use_date`, `use_count`, `use_date2`, `use_date3` | I have a weak memory that Autofill added **`use_date2` / `use_date3`** columns to retain the last N use timestamps. If so, their epoch and the adding version are deliverable rows. **Do not guess the epoch.** |
| `autofill_profiles.date_modified` | unix-s | med | `AddressAutofillTable`, `ToTimeT` | **legacy table — see §3 reorg** |
| `autofill_profiles.use_date` | UNKNOWN — grep | low | `use_date` | — |
| `local_addresses.date_modified` / `.use_date` | assume **same encoding as the `autofill_profiles` rows they replaced** (unix-s) | low | `kLocalAddressesTable`, `local_addresses` | **Explicitly verify the migration body** — if the reorg copied values verbatim the epoch is preserved; if it re-serialised, it could have changed. This is exactly the silent-epoch-change hazard #143 is about. |
| `local_addresses_type_tokens` | no timestamp | low | — | — |
| `contact_info.date_modified` / `.use_date` | UNKNOWN — grep | low | `kContactInfoTable`, `contact_info` | account (sync-backed) addresses |
| `contact_info_type_tokens` | no timestamp | low | — | — |
| `server_card_metadata.use_date` | unix-s | low | `server_card_metadata` | — |
| `server_address_metadata.use_date` | unix-s | low | `server_address_metadata` | table may be deleted by a migration (`MigrateToVersionNNDropServerAddressTables`) — grep |
| `masked_credit_cards.*` | UNKNOWN — grep | none | `masked_credit_cards` | `card_issuer`, `expiration_month/year` are card expiry **not** epochs — do not misclassify |
| `offer_data.offer_expiry_date` | UNKNOWN — grep (unix-s suspected) | low | `offer_data` | — |
| `local_ibans` / `masked_ibans` / `bank_accounts` / `payment_instrument*` | UNKNOWN — grep for `use_date`, `date_modified` | none | those table names | recent payments tables; may or may not carry times |
| `plus_addresses` | UNKNOWN — grep | none | `plus_address` | — |
| `keywords.date_created` | **UNKNOWN — grep the `KeywordTable` bind site for `ToTimeT` vs `BindTime`** | none | `components/search_engines/keyword_table.cc`, `BindURLToStatement` | Search-engine table lives in `Web Data`, which is the unix-s DB, so it is a plausible unix-s row — but that is inference, not recall. |
| `keywords.last_modified` | UNKNOWN — grep | none | same | — |
| `keywords.last_visited` | UNKNOWN — grep | none | same | — |
| `token_service.*` | no timestamp | low | `token_service_table.cc` | encrypted refresh tokens |
| `autofill_model_type_state`, `*_sync_metadata` | protos | low | — | — |

---

### 2.5 `Bookmarks` (JSON) and `Bookmarks.bak`

- Writer: `components/bookmarks/browser/bookmark_codec.cc`. Path-rot risk: **LOW**.
- No `meta.version`; the JSON has a top-level `"version"` (I believe `1`) and a `"checksum"`
  (MD5 over node contents). Grep `kVersionKey`, `kChecksumKey`, `ComputeChecksum`.
- Candidate permalink (NOT fetched):
  `https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/bookmarks/browser/bookmark_codec.cc`

| Field | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `date_added` | **str-1601-µs** (decimal string) | high | `kDateAddedKey`, `base::NumberToString`, `ToInternalValue` | If the value is emitted as a JSON number, precision is lost above 2^53 — a parser bug either way. Verify whether the codec has migrated to `base::TimeToValue`. |
| `date_modified` (folders only) | str-1601-µs | high | `kDateModifiedKey` | — |
| `date_last_used` | str-1601-µs | med | `kDateLastUsedKey` | newer field; absent in older profiles. **Which milestone added it is a deliverable row** — grep the CL that introduced `kDateLastUsedKey`. |
| `guid` / `sync_transaction_version` | not times | low | — | — |

**Forensic note to carry into the deliverable:** the string encoding means a naive
`JSON.parse` + numeric read is lossless *only* if the parser keeps the string. Any JS/Python
consumer that coerces to float64 loses sub-second precision. Falsifiable by inspection of any
real `Bookmarks` file — cheap, do it.

---

### 2.6 `Top Sites` (SQLite)

- `components/history/core/browser/top_sites_database.cc`, version constant `kVersionNumber`
  (grep — it may be `kVersionNumber` not `kCurrentVersionNumber`). Path-rot risk: **LOW**.

| Table.column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `top_sites` (url, url_rank, title, redirects) | **no timestamp column** | med | `CREATE TABLE top_sites` | If a time column exists, my claim is wrong. **This is a negative claim — verify explicitly**, because #118/#123 may have planned a Top Sites timeline feature that cannot exist. |
| legacy `thumbnails.last_updated` | 1601-µs | low | `thumbnails`, `MigrateToVersion` | only in old profiles; the migration that dropped `thumbnails` is a deliverable row |

---

### 2.7 `Favicons` (SQLite)

- `components/history/core/browser/thumbnail_database.cc`. Grep `kCurrentVersionNumber`,
  `kCompatibleVersionNumber`. Path-rot risk: **LOW**.

| Table.column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `favicon_bitmaps.last_updated` | 1601-µs | med | `BindTime`, `last_updated` | — |
| `favicon_bitmaps.last_requested` | 1601-µs | med | `last_requested` | **`0` has special meaning** (on-demand / not-expiry-tracked). Semantics `UNKNOWN — grep` the read site and the comment above the column in the `CREATE TABLE`. Do not render `0` as 1601-01-01. |
| `favicons`, `icon_mapping` | no timestamp | med | — | — |

---

### 2.8 `Shortcuts` (SQLite, omnibox)

- `components/omnibox/browser/shortcuts_database.cc`. Path-rot risk: **MED**.

| Column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `last_access_time` | 1601-µs | low | `last_access_time`, `BindTime`, `ToInternalValue`, `NumberToString` | `125-…` records a "weak memory of an older string encoding". **Check the column's declared type in `CREATE TABLE`** — TEXT vs INTEGER settles it instantly, and if it is TEXT check whether it is a decimal string or something else. |
| `text`, `fill_into_edit`, `url`, `contents`, … | not times | med | — | forensically valuable typed-input evidence regardless |

---

### 2.9 `Network Action Predictor` (SQLite)

- Class name ≠ filename: `chrome/browser/predictors/autocomplete_action_predictor_table.cc`.
  Path-rot risk: **MED**.
- The same file on disk also holds the **loading predictor** tables
  (`chrome/browser/predictors/resource_prefetch_predictor_tables.cc`) — check both.

| Table.column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `network_action_predictor.*` | **UNKNOWN — I am not confident this table has a timestamp at all.** `125-…` asserts a `last_hit_time` at MEDIUM from name-inference only. | none | `CREATE TABLE network_action_predictor` | Read the `CREATE TABLE`. If the schema is `(id, user_text, url, number_of_hits, number_of_misses)` with no time, **`125-…` is wrong and must be corrected**. |
| `resource_prefetch_predictor_*` | proto blobs with `last_visit_time` int64 | low | `resource_prefetch_predictor_tables.cc`, `.proto` | proto int64 times in Chromium are usually 1601-µs; verify |

---

### 2.10 `Media History` (SQLite) and Media Engagement

- `chrome/browser/media/history/media_history_store.cc` plus per-table files
  (`media_history_origin_table.cc`, `..._playback_table.cc`, `..._session_table.cc`,
  `..._images_table.cc`, `..._feed*_table.cc`). Grep `kCurrentVersionNumber`.
  Path-rot risk: **MED**.

| Table.column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `origin.last_updated_time_s` | **1601-SECONDS** (not Unix seconds) | low | `InSeconds()`, `ToDeltaSinceWindowsEpoch` | **PRIORITY ROW — a candidate fourth epoch family.** The `_s` suffix says seconds; the open question is *seconds since what*. Magnitude check on a fixture settles it: ~1.34×10¹⁰ ⇒ 1601-s, ~1.7×10⁹ ⇒ Unix-s. |
| `playback.timestamp_s` (name approx) | 1601-s | low | same | — |
| `playbackSession.last_updated_time_s` | 1601-s | low | same | — |
| Media Engagement `lastMediaPlaybackTime` (in `Preferences` content settings) | **JSON double holding a 1601-µs value** | low | `media_engagement_score.cc`, `kLastMediaPlaybackTimeKey` | A double cannot hold 1.34×10¹⁷ exactly — expect quantisation to ~16-32 µs. If confirmed this is a real precision caveat worth stating. |

---

### 2.11 `DIPS` (SQLite) — renamed BTM in source

- Feature renamed **DIPS → BTM (Bounce Tracking Mitigations)**; source moved
  `content/browser/dips/` → `content/browser/btm/` while the **on-disk filename stayed `DIPS`**.
  Path-rot risk: **HIGH**. Try `content/browser/btm/btm_database.cc` and `btm_storage.cc` first,
  fall back to `content/browser/dips/dips_database.cc`.
- Version constant: grep `kCurrentSchemaVersion` / `kLatestSchemaVersion` in `btm_database.cc`.

| Table.column | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| `bounces.first_site_storage_time` / `last_site_storage_time` | UNKNOWN — 1601-µs vs **1601-s** | none | `BindTime` vs `InSeconds()` | I have two competing memories (full precision vs deliberately reduced precision for anti-fingerprinting). **Do not guess.** Read the bind site. |
| `bounces.first_user_interaction_time` / `last_user_interaction_time` | UNKNOWN — same | none | same | same |
| `bounces.first_stateful_bounce_time` / `last_stateful_bounce_time` | UNKNOWN — same | none | same | same |
| `popups`, `unique_cookies`, `config` (names approximate) | UNKNOWN — grep `CREATE TABLE` | none | `btm_database.cc` | table names themselves are unverified |

---

### 2.12 `Sessions/` (SNSS: `Session_<ts>`, `Tabs_<ts>`) and `Last Session` / `Current Session`

- `components/sessions/core/command_storage_backend.cc` (file header/magic + version),
  `components/sessions/core/serialized_navigation_entry.cc` (pickle field encoding),
  `components/sessions/core/session_service_commands.cc`. Path-rot risk: **MED**.
- Not SQLite — no `meta.version`. Instead there is a **file header version**
  (grep `kFileCurrentVersion`, `kEncryptedFileCurrentVersion`, `FileHeader`). I recall version 1
  (plain) and 3 (encrypted, AES-GCM per-command) — **UNVERIFIED, grep**.
- **The filename itself is a timestamp**: `Session_13380000000000000` style — a 1601-µs value in
  the filename. Grep `TimestampToString` / `base::NumberToString(...ToDeltaSinceWindowsEpoch()`
  in `command_storage_manager.cc`. Cheap, high-value, verifiable from any fixture directory listing.

| Field | Epoch guess | Confidence | Grep for | Falsifier |
|---|---|---|---|---|
| filename timestamp suffix | 1601-µs | med | `command_storage_manager.cc`, `TimestampFromPath` | directory listing of a fixture confirms magnitude immediately |
| `SerializedNavigationEntry::timestamp_` | 1601-µs int64 in pickle | med | `WriteToPickle`, `ToInternalValue` | — |
| `SessionTab::last_active_time` | 1601-µs | low | `kCommandSetLastActiveTime` | — |
| `SessionTab::timestamp` | 1601-µs | low | — | — |

---

### 2.13 `Preferences`, `Secure Preferences`, `Local State` (JSON)

**Do not apply a blanket rule.** See §1: quoted decimal strings arise from *both*
`base::TimeToValue` (1601-µs) *and* `PrefService::SetInt64` (any int64, possibly Unix-s).
`125-…-unverified.md`'s "quoted string ⇒ 1601 µs" heuristic should be **downgraded to
'must be checked per key'** in the deliverable.

| Key (approximate) | File | Epoch guess | Confidence | Grep for |
|---|---|---|---|---|
| `profile.content_settings.exceptions.<type>.<pattern>.last_modified` | Preferences | str-1601-µs | med | `content_settings_pref.cc`, `kLastModifiedPath`, `base::TimeToValue` |
| content settings `expiration`, `last_visited`, `session_model` | Preferences | str-1601-µs | low | same file; `last_visited` may be **coarsened to a week boundary** for privacy — verify, it matters forensically |
| `extensions.settings.<id>.install_time` | Secure Preferences | str-1601-µs | med | `extension_prefs.cc`, `kPrefInstallTime` |
| `extensions.settings.<id>.first_install_time` / `last_update_time` | Secure Preferences | str-1601-µs | low | same; **these replaced `install_time` at some milestone — that boundary is a deliverable row.** Grep the CL that split them. |
| `profile.creation_time` | Preferences | str-1601-µs via `base::TimeToValue` | low | `profile_impl.cc`, `kProfileCreationTime` |
| `profile.created_by_version` | Preferences | version string, not a time | med | — |
| site engagement `lastEngagementTime` | Preferences (content settings) | **JSON double of 1601-µs** | low | `site_engagement_score.cc`, `kLastEngagementTimeKey` | 
| `variations_last_fetch_time` / `variations_seed_date` | Local State | str-1601-µs via `SetInt64` | low | `components/variations/pref_names.cc` |
| `uninstall_metrics.installation_date2` | Local State | **unix-s** | low | `kUninstallMetricsInstallDate`; grep `ToTimeT` |
| `user_experience_metrics.stability.stats_buildtime` | Local State | **unix-s** | low | `stats_buildtime` |
| `os_crypt.encrypted_key`, `os_crypt.app_bound_encrypted_key` | Local State | not times | high | cross-ref `research/127-oscrypt-portability.md` |
| ChromeOS `settings.timezone` etc. | Local State (CrOS only) | IANA TZ **string** | low | `chromeos/ash/components/settings/cros_settings_names.cc` | only "yes" candidate for #125 Q1(a) |

---

### 2.14 Adjacent artifacts worth one grep each (may be in #118/#123 scope)

I could not read issues #118 / #123 (no network). The list below is what I would expect to be
in scope beyond the explicit list, each with one grep target.

| Artifact | Candidate writer | Epoch guess | Grep for |
|---|---|---|---|
| `TransportSecurity` (JSON) | `net/http/transport_security_persister.cc` | **dbl-unix-s** (`ToDoubleT` / `InSecondsFSinceUnixEpoch`) — genuinely a different family | `expiry`, `sts_observed`, `sts_expiry` |
| `Network Persistent State` (JSON, NEL/Reporting) | `net/network_error_logging/`, `net/reporting/` | dbl-unix-s or unix-µs — UNKNOWN | `expires`, `ToDoubleT` |
| `Affiliation Database` (SQLite) | `components/affiliations/core/browser/affiliation_database.cc` | 1601-µs | `last_update_time` |
| `AutofillStrikeDatabase` (LevelDB, protos) | `components/autofill/core/browser/strike_databases/` | 1601-µs int64 in proto | `last_update_timestamp` |
| `Local Storage` / `Session Storage` / `Extension State` / IndexedDB (LevelDB) | — | **site-controlled; Chrome writes no schema timestamp** | — |
| `Trust Tokens` (SQLiteProto) | `services/network/trust_tokens/` | UNKNOWN | `last_redemption` |
| Simple Cache index (`Cache_Data/index-dir/the-real-index`) | `net/disk_cache/simple/simple_index_file.cc` | UNKNOWN — 1601-µs vs unix-s, and I believe it **changed** to shrink the index | `last_used_time`, `kSimpleIndexFileVersion`, `InSeconds` |
| Simple Cache entry metadata (`HttpResponseInfo` pickle) | `net/http/http_response_info.cc` | 1601-µs for `request_time`/`response_time`; HTTP `Date:`/`Expires:` are **IMF-fixdate GMT strings** | `request_time_`, `response_time_` |
| `Visited Links` | `components/visitedlink/` | hashtable, no timestamps | — |

---

## 3. The address-table reorganisation — `autofill_profiles` → `local_addresses` / `contact_info`

**This is an explicit deliverable of #143 and I cannot answer it. Do not let a guess through.**

What I believe (all **UNVERIFIED**, and the version numbers are the part I am least willing to
guess):

- `contact_info` + `contact_info_type_tokens` were added first, for **account/sync-backed**
  addresses, while local addresses stayed in `autofill_profiles`.
- Later, local addresses were moved out of `autofill_profiles` into
  `local_addresses` + `local_addresses_type_tokens`, giving both address kinds the same
  token-based shape, and `autofill_profiles` (+ `autofill_profile_names`,
  `autofill_profile_emails`, `autofill_profile_phones`, `autofill_profile_addresses`) was dropped.
- `125-…-unverified.md` guesses "roughly M117–M124". **That is a guess about a guess.**

**Exact `meta.version` numbers: `UNKNOWN — grep`.**
**CL: `UNKNOWN — grep`. Milestone: `UNKNOWN — grep`.**

Search plan, in order:

1. `WebDatabase::kCurrentVersionNumber` **history**, not just its current value:
   `https://chromium.googlesource.com/chromium/src/+log/refs/heads/main/components/webdata/common/web_database.cc`
   (NOT fetched). Every reorg bumps this constant; the log gives you SHA → CL → milestone in one pass.
2. In `address_autofill_table.cc` (or whatever `AddressAutofillTable` currently lives in), grep:
   - `MigrateToVersion` (list every one it implements)
   - `kLocalAddressesTable`, `kLocalAddressesTypeTokensTable`, `kContactInfoTable`,
     `kContactInfoTypeTokensTable`, `kAutofillProfilesTable`
   - the migration body that does `INSERT INTO local_addresses SELECT ... FROM autofill_profiles`
     — **read this body specifically**, because it tells you whether the epoch was preserved
     verbatim or re-serialised. That is the actual forensic question.
3. Blame the `CREATE TABLE local_addresses` line to get the landing SHA:
   `https://chromium.googlesource.com/chromium/src/+blame/refs/heads/main/<resolved-path>` (NOT fetched).
4. SHA → milestone via chromiumdash (endpoint unverified, see §1).

**Forensic consequence to state in the deliverable regardless of the numbers:** a `Web Data` file
at a version *below* the reorg has addresses only in `autofill_profiles`; above it, only in
`local_addresses`/`contact_info`; and because the migration runs on first open, a **forensic copy
is frozen at whatever version it was copied at**. A parser must dispatch on `meta.version`, not on
"which tables happen to exist", because a partially-migrated or rolled-back DB can have both.

---

## 4. Suspected version boundaries — all UNKNOWN, listed as things to look for

Every row here is a **question**, not an answer. The deliverable must fill in the `meta.version`,
the migration function, the CL, and the milestone from source.

| Artifact | Boundary to find | Migration fn to grep | My guess |
|---|---|---|---|
| Login Data | `date_created` unix-s → 1601-µs | grep `MigrateDatabase` body that touches `date_created` | issue says "db version ≤ 8"; **verify the ≤8 claim itself** |
| Login Data | version that added `date_last_used` | `MigrateToVersion*` | UNKNOWN |
| Login Data | version that added `date_password_modified` | `MigrateToVersion*` | UNKNOWN |
| History | `downloads.start_time`/`end_time` unix-s → 1601-µs | grep the `EnsureCurrentVersion` block | `125-…` guessed v24–26 / ~M26 — **lead only** |
| History | version that added `downloads.last_access_time` | — | UNKNOWN |
| Cookies | version that added `last_update_utc` | — | `125-…` guessed ~M101 — lead only |
| Cookies | file path move `<Profile>/Cookies` → `<Profile>/Network/Cookies` | not a schema migration; a profile-layout change | ~M80 — **lead only, and it is a milestone not a `meta.version`** |
| Web Data | `contact_info` tables added | `MigrateToVersion*` in address table | UNKNOWN |
| Web Data | `local_addresses` reorg + `autofill_profiles` drop | `MigrateToVersion*` | UNKNOWN — §3 |
| Web Data | `use_date2`/`use_date3` added (if real) | — | UNKNOWN — verify the columns even exist |
| Top Sites | version that dropped `thumbnails` | — | UNKNOWN |
| Bookmarks | milestone that added `date_last_used` | CL for `kDateLastUsedKey` | UNKNOWN |
| Secure Preferences | `install_time` → `first_install_time` + `last_update_time` | CL in `extension_prefs.cc` | UNKNOWN |
| DIPS/BTM | schema versions; also the `content/browser/dips` → `btm` move | `kCurrentSchemaVersion` | UNKNOWN |
| Simple Cache | index `last_used_time` epoch change | `kSimpleIndexFileVersion` | UNKNOWN, direction unknown |

---

## 5. Claims in `125-integrity-facts-unverified.md` that this sheet flags as SUSPECT

Not corrections — I have no more access than that file did. These are the rows the verifier
should attack first because they are load-bearing *and* likely wrong:

1. **"quoted numeric string ⇒ 1601 µs; bare integer ⇒ Unix seconds"** (§Preferences, MEDIUM-HIGH).
   Unsafe. `PrefService::SetInt64` stringifies *any* int64. Downgrade to "per-key verification
   required".
2. **`network_action_predictor.last_hit_time` exists and is 1601 µs** (MEDIUM, `[inferred-from-name]`).
   I am not confident the column exists at all. Verify the `CREATE TABLE` before building anything on it.
3. **`Media History` `_s` columns are Unix seconds** (LOW, inferred from the suffix).
   Candidate 1601-**seconds** — a family `125-…` does not list at all. Its three-epoch model may
   be incomplete.
4. **DIPS is 1601 µs** (LOW). Genuinely 50/50 against 1601-seconds. Left UNKNOWN here.
5. **`Shortcuts.last_access_time` is 1601 µs** (MEDIUM). The competing "older string encoding"
   memory is worth one `CREATE TABLE` read.
6. **"No Chrome artifact stores local time"** (HIGH for major DBs). `segment_usage.time_slot` is a
   plausible counterexample via `LocalMidnight()`. If confirmed, this is both a correction *and*
   a timezone-offset recovery primitive — the most valuable single finding available here.
7. **History `downloads` migrated at schema v24–26 / M26.** Stated with a version range from
   memory; the range is not evidence.
8. **Address reorg at "M117–M124".** Guess. §3 above.

---

## 6. What the verifier should do first (ordered, cheapest-first)

1. Read `sql/statement.cc` `BindTime`/`ColumnTime`. One read classifies dozens of call sites.
2. Read `base/json/values_util.cc` `TimeToValue`/`ValueToTime`. One read classifies the JSON side.
3. Run the **magnitude falsifier** (§1) against a real committed fixture for every column in this
   sheet. This resolves 1601-µs vs unix-s vs 1601-s with zero source access and catches any row
   where I guessed wrong — and it is the check that will catch a *silent* epoch error in
   production.
4. Then, and only then, go after the version boundaries in §4 via the version-constant `+log`
   history, which is the cheapest path from "a boundary exists" to "SHA → CL → milestone".
5. §3 (address reorg) last, because it is the most work per answer.

---

## 7. Coverage accounting

Columns/fields enumerated in §2: **~105** across 14 artifact groups.
Of those, tagged `UNKNOWN — grep` (no guess offered): **~30**.
Explicit negative claims requiring verification (column/table asserted absent): **5**.
Version boundaries listed as open questions: **14**.

**None of it is verified. None of it may be cited.**
