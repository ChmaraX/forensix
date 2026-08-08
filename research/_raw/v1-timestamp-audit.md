# v1 timestamp handling audit — against the #143 epoch/version matrix

**Lane A deliverable.** Repo `/Users/adamchmara/projects/forensix`, branch `research/wayfinder-v2`.
Reference: `research/143-timestamp-epoch-version-matrix.md` (primary-sourced), `CONTEXT.md`.
Scope: every site in `server/` and `client/` that reads, decodes, or renders a timestamp.

Method: exhaustive grep of `server/` + `client/src` for `datetime(`, `unixepoch`, `localtime`,
`11644473600`, `strftime`, `new Date(`, `toLocale*`, `moment`, `dayjs`, `date-fns`,
`getTimezoneOffset`, `toISOString`, plus a per-file read of all 14 `db_name:` call sites and
every JSON artifact read. `VERIFIED` = read in this repo or executed. `INFERRED` = reasoned,
not executed.

---

## 1. Summary

### What v1 gets right — and it is more than the lead suggested

| | Evidence |
|---|---|
| **Epoch families are correct at every site v1 touches.** Nine of nine SQL columns and two of two Bookmarks JSON keys use the family the matrix specifies for modern schema versions. Someone knew about the 369-year trap and applied it per-column, not per-file. | table §3 |
| **The `date_created` collision is handled correctly.** `logins.date_created` gets the 1601-µs formula (`LoginDataController.js:49`); `autofill.date_created` gets bare `'unixepoch'` (`WebDataController.js:10`). Same column name, two families, both right. This is exactly the pair matrix §6.4 flags. | VERIFIED |
| **`visit_duration` is treated as a duration, not a timestamp.** `/1000000` → seconds at `HistoryController.js:173` and `:195`, labelled "Visit Duration (sec.)" at `HistoryTable.js:102-104`. Nothing else in the codebase conflates a duration with an instant. | VERIFIED |
| **The client never re-offsets a Chrome timestamp.** All date columns are rendered as opaque server-supplied strings. The two client `new Date()` calls operate on Mongoose `createdAt`, not Chrome data. | VERIFIED, §7 |
| **v1 never touches the matrix's hardest traps.** No `credit_cards.use_date`, no `server_card_metadata.use_date`, no `offer_data.expiry` (1601-ms), no Media History (1601-s), no `segment_usage.time_slot` (local midnight), no Cookies, no `keywords.*`. v1's narrow artifact scope protects it from the four cases that defeat naive parsers. | VERIFIED by grep — zero hits |
| **Read-only source access is honoured.** `db_operations.js:6` opens `{readonly: true}`; `docker-compose.yml:14-18` binds `./data` `read_only: true`. `server/server.js:16` SHA1s the medium at boot. Adjacent to this audit but worth stating. | VERIFIED |

### What v1 gets wrong

| | |
|---|---|
| **Every rendered timestamp is in the analysis machine's timezone.** 15 column-level render sites across 5 files. **Zero are UTC-correct. Zero record which offset was applied.** Directly contradicts `CONTEXT.md` → Declared Timezone: *"Defaults to UTC and is always labelled as declared, never derived. The host's timezone is never used."* | §2 |
| **A second, independent shift compounds the first** at `HistoryController.js:124-125` — the monthly browsing-activity aggregate. VERIFIED off-by-one. | §5, S1b |
| **No `meta.version` check anywhere.** Zero. Confirms the expectation. Three version boundaries in v1's own artifacts are therefore ungated. | §4 |
| **Sentinel `0` is rendered as a date** on all three code paths — `1601-01-01`, `1970-01-01`, `1/1/1601`. VERIFIED by execution. | §6 |
| **`SELECT *` leaks undecoded 1601-µs integers** — including `date_password_modified` — into the API payload and into the shared evidence database. | §7 |
| **No timestamp carries an Epoch Family, a Declared Timezone, or resolution provenance.** No emitted date can be re-derived or corrected from the record. | S4 |

**One-line verdict.** v1's *epoch* handling is good — the part that is hard, it got right.
v1's *timezone* handling is unconditionally wrong at every single site, and the error is
silent, plausible, and baked irreversibly into saved evidence.

---

## 2. The timezone defect — full call-site inventory

`'localtime'` in SQLite converts the instant to the **process's** timezone. `TZ` is set
nowhere in the repo (VERIFIED: grep across `server/`, `client/src`, `docker-compose.yml`,
`server/Dockerfile`, `startup.sh` — no `TZ`, no `/etc/localtime` mount, no timezone config of
any kind). So the offset is whatever the analysis machine happens to be set to.

Demonstration (VERIFIED, executed) — one raw value `13400000000000000`:

| Host `TZ` | Rendered |
|---|---|
| `UTC` (correct) | `2025-08-18 12:13:20` |
| `America/Los_Angeles` | `2025-08-18 07:13:20` |
| `Europe/Bratislava` | `2025-08-18 16:13:20` |
| `Asia/Tokyo` | `2025-08-18 23:13:20` |

A 16-hour spread, and a different **calendar day** at the extremes. Nothing in the output
distinguishes them.

### SQL sites — `'localtime'` modifier (VERIFIED, 9 column renderings / 5 statements / 3 files)

| # | file:line | column |
|---|---|---|
| 1 | `server/controllers/HistoryController.js:104` | `visits.visit_time` → `visit_date` |
| 2 | `server/controllers/HistoryController.js:173` | `urls.last_visit_time` |
| 3 | `server/controllers/HistoryController.js:173` | `visits.visit_time` |
| 4 | `server/controllers/HistoryController.js:275` | `downloads.start_time` |
| 5 | `server/controllers/HistoryController.js:275` | `downloads.end_time` |
| 6 | `server/controllers/LoginDataController.js:49` | `logins.date_created` |
| 7 | `server/controllers/LoginDataController.js:49` | `logins.date_last_used` |
| 8 | `server/controllers/WebDataController.js:10` | `autofill.date_created` |
| 9 | `server/controllers/WebDataController.js:10` | `autofill.date_last_used` |

### JS sites — `toLocaleDateString()` (VERIFIED, 6 renderings / 2 files)

`toLocaleDateString()` applies the host timezone **and** the host locale, and discards the
time-of-day entirely.

| # | helper | used at | value |
|---|---|---|---|
| 10 | `server/routers/bookmarks.js:9-11` | `:36` | `Bookmarks` → `date_added` |
| 11 | `server/routers/bookmarks.js:9-11` | `:38` | `Bookmarks` → `meta_info.last_visited_desktop` |
| 12 | `server/controllers/CacheController.js:283-286` | `:102` | Cache index header `creationTime` |
| 13 | `server/controllers/CacheController.js:283-286` | `:413` | Rankings node `lastUsed` |
| 14 | `server/controllers/CacheController.js:283-286` | `:416` | Rankings node `lastModified` |
| 15 | `server/controllers/CacheController.js:283-286` | `:513` | Cache entry `creationTime` |

**Is any path UTC-correct? No — not one of the 15.** There is no UTC branch, no `'utc'`
modifier, no `toISOString()`, no `Date.UTC` anywhere in `server/` or `client/src`.

**Deployment nuance, in fairness.** The shipped `docker-compose.yml` sets no `TZ` and does not
mount `/etc/localtime`, so a container built from `server/Dockerfile` (`nikolaik/python-nodejs`)
runs at **UTC by default** — under Docker, `'localtime'` is accidentally correct. Anyone running
the server directly on their workstation gets the host offset. The result is worse than either:
the same Source yields different times depending on *how* it was run, and the output does not
say which. (INFERRED — I did not build the image; base-image TZ default is standard Debian/UTC.)

---

## 3. Column-by-column matrix cross-check

`Fam.` = epoch family. Verdicts assume a **modern** schema version (History ≥24, Login Data ≥9,
Web Data ≥83) — see §4 for what happens below those.

| file:line | artifact | column | v1's decoding | matrix says | epoch verdict | tz verdict |
|---|---|---|---|---|---|---|
| `HistoryController.js:104` | History | `visits.visit_time` | `(x/1e6)-11644473600` = 1601-µs | 1601-µs (§3) | **correct** | **wrong** |
| `HistoryController.js:173` | History | `urls.last_visit_time` | 1601-µs | 1601-µs (§3) | **correct** | **wrong** |
| `HistoryController.js:173` | History | `visits.visit_time` | 1601-µs | 1601-µs | **correct** | **wrong** |
| `HistoryController.js:173` | History | `visits.visit_duration` | `/1e6` → seconds, **as a duration** | not a timestamp — a duration (§3) | **correct** | n/a |
| `HistoryController.js:195` | History | `AVG(visit_duration)` | `/1e6` → seconds | duration | **correct** | n/a |
| `HistoryController.js:275` | History | `downloads.start_time` | 1601-µs | 1601-µs at ≥v24 (§3) | **correct (≥24)** | **wrong** |
| `HistoryController.js:275` | History | `downloads.end_time` | 1601-µs | 1601-µs at ≥v24 | **correct (≥24)** | **wrong** |
| `HistoryController.js:275` (`*`) | History | `downloads.last_access_time` | **not decoded** — raw int emitted | 1601-µs, `DEFAULT 0` (§3) | **wrong presentation** | n/a |
| `HistoryController.js:275` (`*`) | History | `downloads.last_modified` | passed through as string | **HTTP header string, not an epoch** (§3) | **correct** (accidentally) | n/a |
| `LoginDataController.js:49` | Login Data | `logins.date_created` | 1601-µs | 1601-µs at ≥v9; **Unix s at ≤v8** (§4) | **correct (≥9)** | **wrong** |
| `LoginDataController.js:49` | Login Data | `logins.date_last_used` | 1601-µs | 1601-µs, `DEFAULT 0`, added v25 (§4) | **correct** | **wrong** |
| `LoginDataController.js:49` (`*`) | Login Data | `date_password_modified` | **not decoded** — raw int emitted | 1601-µs, **SYNTHETIC pre-v30** (§8.2) | **wrong presentation** | n/a |
| `LoginDataController.js:49` (`*`) | Login Data | `date_synced` / `date_received` / `date_last_filled` | **not decoded** — raw int emitted | 1601-µs (§4) | **wrong presentation** | n/a |
| `WebDataController.js:10` | Web Data | `autofill.date_created` | bare `'unixepoch'` = Unix s | **Unix seconds** (§6.4) | **correct** | **wrong** |
| `WebDataController.js:10` | Web Data | `autofill.date_last_used` | bare `'unixepoch'` = Unix s | **Unix seconds** (§6.4) | **correct** | **wrong** |
| `routers/bookmarks.js:36` | Bookmarks | `date_added` | `round(x/1e6)-11644473600` = 1601-µs | 1601-µs decimal string (§7.2) | **correct** | **wrong** |
| `routers/bookmarks.js:38` | Bookmarks | `meta_info.last_visited_desktop` | 1601-µs | 1601-µs (§7.2, by same encoder) | **correct** | **wrong** |
| — | Bookmarks | `date_modified`, `date_last_used` | **never read** | 1601-µs (§7.2) | not attempted | n/a |
| `CacheController.js:102` | Cache index | header `creationTime` | 1601-µs | **NOT IN MATRIX** | **UNCHECKED** | **wrong** |
| `CacheController.js:413/416` | Cache rankings | `lastUsed`, `lastModified` | 1601-µs | **NOT IN MATRIX** | **UNCHECKED** | **wrong** |
| `CacheController.js:513` | Cache entry | `creationTime` | 1601-µs | **NOT IN MATRIX** | **UNCHECKED** | **wrong** |
| `FaviconsController.js:5-12` | Favicons | `favicons` table (`SELECT *`) | no timestamp selected | timestamps live in `favicon_bitmaps` (§3) | **n/a — correct by omission** | n/a |
| `FaviconsController.js:14-22` | Favicons | `icon_mapping` (`SELECT *`) | no timestamp | no timestamp column | **n/a** | n/a |
| `TopSitesController.js:3-11` | Top Sites | `top_sites` (`SELECT *`) | no timestamp | **no timestamp column** (§3, negative verified) | **n/a** | n/a |
| `SuspectProfile.js:96-115` | Preferences | `sync.birthday`, `demographics.*` | read as-is | not a timestamp | **n/a** | n/a |
| `SuspectProfile.js:176-190` | Preferences | `extensions.last_chrome_version` | product version string | matrix §2.4: a *product* version, not a schema version | **correct use** | n/a |

**No column is decoded with the wrong epoch family.** That is the honest headline of §3.

---

## 4. `meta.version` — answering the brief's Q3

**VERIFIED: v1 reads `meta.version` nowhere.** Grep across `server/controllers/` and
`server/routers/` for `meta`/`version` returns only:
- `server/routers/history.js:72` — `getDownloadsMeta()`, an application-level aggregate, unrelated
- `CacheController.js:93-94` — cache index `minorVersion`/`majorVersion` (a file-format header)
- `SuspectProfile.js:182` — `extensions.last_chrome_version` from Preferences

There is no `SELECT ... FROM meta`, no column sniffing, no `FixVersionIfNeeded` equivalent
(matrix §2.1), and no magnitude fallback.

### The three ungated boundaries inside v1's own artifact set

| Boundary | matrix | If v1 meets an old file, it renders | Class |
|---|---|---|---|
| Login Data **v≤8**: `date_created` is Unix **seconds** | §4 | `(1.3e9 / 1e6) - 11644473600` → ≈ **1601-01-01 00:00:2x** | **wrong value, loud** |
| History **v≤23**: `downloads.start_time`/`end_time` are Unix **seconds** | §3 | integer division → ≈ **1601-01-01 00:22** | **wrong value, loud** |
| History **v≤16 on macOS/Linux**: `urls`/`visits` times are Unix **µs** | §2.2 | ≈ **1640** | **wrong value, loud** |

All three fail conspicuously rather than silently — a 1601 or 1640 date is not a plausible
browsing time. Practical exposure is small (matrix §2.2: modern Chrome razes below these
versions). But `FixVersionIfNeeded` (§2.1) means a file can *record* v≤8 and actually be v25 —
so a naive version gate would not be enough either. v1 has no gate and no sniff, so it is
simply silent about the whole question. **Class: unverifiable claim**, not wrong value.

### Q2 — `use_date`

**VERIFIED: v1 touches neither table.** Grep for `use_date`, `credit_cards`,
`server_card_metadata`, `offer_data`, `keywords`, `local_ibans`, `addresses`, `cookies`
across `server/` and `client/src` → **zero hits**. The only Web Data table v1 reads is
`autofill` (`WebDataController.js:5-13`). The matrix §6.2 collision is entirely out of scope
for v1. Not a defect; a scope fact.

---

## 5. The second shift — `HistoryController.js:124-125`

```js
data.results.some((e, i) => {
  data.results[i].visit_date = e.visit_date.split(" ")[0];              // :124
  data.results[i].visit_month = month[new Date(e.visit_date).getMonth()]; // :125
});
```

`e` and `data.results[i]` are the **same object**. Line 124 truncates `visit_date` to
`"YYYY-MM-DD"` *before* line 125 reads it. `new Date("YYYY-MM-DD")` is the ISO **date-only**
form, which JS parses as **UTC midnight**; `.getMonth()` then returns the **local** month.

VERIFIED by execution:

| `TZ` | input | `.getMonth()` | correct |
|---|---|---|---|
| `America/Los_Angeles` | `"2022-07-01"` | `5` (Jun) | `6` (Jul) |

So a visit already shifted into local time by SQL is shifted *again* — in the opposite
direction — before being bucketed. Every visit on the 1st of a month is filed under the
previous month for any host west of UTC. Feeds the "Browsing Activity" bar chart
(`client/src/views/dashboard/components/BrowsingActivity/BrowsingActivity.js:47-58`).

`HistoryController.js:308` (`download_date`) does the same string split but does **not** re-parse
it — that one is safe.

---

## 6. Sentinels — answering Q4

Matrix §8.1: `BindTime(base::Time())` writes literal `0`; `0` is the universal never/null marker.
It **must never be rendered as a date**.

**VERIFIED by execution — v1 renders it as a date on all three paths:**

| path | expression | result (host UTC+1) |
|---|---|---|
| SQL 1601-µs | `datetime((0/1000000)-11644473600,'unixepoch','localtime')` | `1601-01-01 01:00:00` |
| SQL Unix-s | `datetime(0,'unixepoch','localtime')` | `1970-01-01 01:00:00` |
| JS | `new Date((0/1e6-11644473600)*1000).toLocaleDateString()` | `1/1/1601` |

Note the sentinel is *itself* timezone-shifted (`01:00:00`), so it isn't even a stable
recognisable constant across analysis machines.

**Client-side: no sentinel handling at all.** `LoginDataContainer.js:71-75`,
`DownloadsTable.js:42-43`, `WebDataTable.js:33-35`, `BookmarksContainer.js:66-70`,
`HistoryTable.js:100`, `CacheContainer.js:72,92,96` all bind the field directly with no
`render`/formatter and no null check.

Columns where this bites in practice (matrix §8.1): `logins.date_last_used` (`DEFAULT 0` — every
credential never auto-filled shows a 1601 date), `logins.date_password_modified` /
`date_last_filled` (`DEFAULT 0`), `downloads.start_time`/`end_time`, `autofill.date_last_used`.

**Related — absence rendered as garbage.** `server/routers/bookmarks.js:37-39`: if `meta_info`
exists but lacks `last_visited_desktop`, `undefined/1e6` → `NaN` → `new Date(NaN)
.toLocaleDateString()` → **`"Invalid Date"`**. `CONTEXT.md` → Field State requires `absent`;
v1 emits a string that looks like a failed parse of a real value. VERIFIED by code reading.

---

## 7. Synthetic timestamps and the `SELECT *` leak — Q5

**Does v1 present `date_password_modified` as a password-change time? No.** VERIFIED: it is
never selected by name, never given a column title, never rendered. `LoginDataContainer.js:56-77`
shows only Action URL, Username, Password (hex), Preferred, Times Used, Created, Last Used.

**But it is exported, raw and unlabelled.** `LoginDataController.js:46-49` is
`SELECT *, ... AS date_created, ... AS date_last_used`. VERIFIED against sqlite3: the result set
contains **both** the raw and the aliased column, raw first:

```json
[{"date_created":13300000000000000, "date_password_modified":13300000000000000,
  "other":"x", "date_created":"2022-06-18 06:26:40"}]
```

INFERRED (not executed — `better-sqlite3` is not installed in this checkout): a JS driver
mapping rows to objects keeps the **last** duplicate key, so the aliased string wins for
`date_created` and every *other* timestamp column arrives as a bare 1601-µs integer.

Those raw integers reach the browser, and `SaveEvidenceModal.js:16-19` posts the **entire**
`rowData` object to `/evidences`; `server/models/evidence.js:5` stores it as
`data: { type: Object }`. So `date_password_modified` — which matrix §8.2 says is
**backfilled `= date_created`** for any row predating Login Data v30 and therefore evidences
**nothing** — is persisted into a shared investigator database as an undecoded, unlabelled
integer. Same for `date_synced`, `date_received`, `date_last_filled`,
`insecure_credentials.create_time` (if the table is present), and `downloads.last_access_time`.

**A related presentation defect.** `HistoryController.js:171-175` joins `urls × visits`, giving
one row per **visit**, and selects both `last_visit_time` and `visit_time`. The client
(`HistoryTable.js:100`) renders **only `last_visit_time`**, labelled *"Last Visit Time"*.
So on a table whose rows are individual visits, the only visible time is the URL's *most recent*
visit, repeated identically on every row. `visit_time` — the actual time of the row — is
computed, shipped, and never displayed. VERIFIED (`visit_time` appears nowhere in `client/src`).

---

## 8. Client-side — Q7

**No client code re-formats or re-offsets a Chrome timestamp.** VERIFIED per field:

| client site | what it touches | verdict |
|---|---|---|
| `LoginDataContainer.js:71-75` | `date_created`, `date_last_used` | opaque string passthrough — **no second shift** |
| `DownloadsTable.js:42-43` | `start_time`, `end_time` | passthrough |
| `WebDataTable.js:33-35` | `date_created`, `date_last_used` | passthrough |
| `BookmarksContainer.js:66-70` | `date_added`, `last_visited_desktop` | passthrough |
| `HistoryTable.js:100,102-104` | `last_visit_time`, `visit_duration` | passthrough |
| `CacheContainer.js:72,92,96` | `creationTime`, `rankings.lastUsed/lastModified` | passthrough |
| `DatabaseContainer.js:79`, `UserActivity.js:48` | `new Date(createdAt).toDateString()` | **not Chrome data** — Mongoose `createdAt` from `evidence.js` `timestamps:true` |
| `BrowsingActivity.js:17-21,27-28` | `shiftDate(new Date(), -365)` | heatmap bounds from **now**, not from the data. Fixed 365-day window — silently hides any activity older than a year |

So the compounding shift the brief anticipated on the client **does not exist**. It exists
one layer up, on the server, at `HistoryController.js:125` (§5).

---

## 9. Severity ranking

### S1 — Wrong value, silent, irreversible

**S1a. Host-timezone rendering — 15 sites, 5 files, 0 correct.** §2. Produces a plausible but
wrong instant, off by the analysis machine's UTC offset. Nothing in the output records the
offset, so the error cannot be detected or undone from the artifact. Evidence saved via
`SaveEvidenceModal` freezes the shifted string into a shared database permanently. Directly
violates `CONTEXT.md` → Declared Timezone.

**S1b. Compounding second shift — `HistoryController.js:124-125`.** §5. VERIFIED off-by-one in
the monthly aggregate. Same class, narrower blast radius (one chart), but it proves the shift
is not a single containable substitution.

### S2 — Wrong value, loud

**S2a. Three ungated version boundaries** (§4): Login Data `date_created` ≤v8; History
`downloads.start_time`/`end_time` ≤v23; History `urls`/`visits` ≤v16 on macOS/Linux. Renders
1601 or 1640 — an analyst would notice. Low exposure (modern Chrome razes these), but v1 makes
no statement either way.

### S3 — Wrong presentation

**S3a. Sentinel `0` rendered as a date** (§6) — `1601-01-01`, `1970-01-01`, `1/1/1601`. Highest
practical frequency of anything in this audit: `logins.date_last_used` is `DEFAULT 0` for every
credential never auto-filled. An analyst reading the table sees a *date* where the truth is
"never".
**S3b. `"Invalid Date"` for an absent Bookmarks field** (`bookmarks.js:37-39`) — Field State
`absent` emitted as a broken value string.
**S3c. `last_visit_time` labelled on a per-visit row** (§7) — the label is wrong for the row.
**S3d. `toLocaleDateString()` discards time-of-day** at all 6 JS sites (§2) — Bookmarks and Cache
show a bare date, losing the hour that is usually the forensically interesting part.
**S3e. Raw 1601-µs integers surfaced** for `date_password_modified`, `date_synced`,
`date_received`, `date_last_filled`, `downloads.last_access_time` (§7).

### S4 — Unverifiable claim

**S4a. No timestamp anywhere carries an Epoch Family, a Declared Timezone, or resolution
provenance.** Every emitted date is a bare formatted string. Given a v1 output, it is impossible
to recover the raw value, the family assumed, the offset applied, or the schema version of the
Source. Per `CONTEXT.md`, none of v1's timestamps qualifies as a **Finding**.
**S4b. Synthetic timestamps are never flagged** (matrix §8.2) — `date_password_modified` and
`insecure_credentials.create_time` are migration artifacts. v1 doesn't render them, so it makes
no false claim; but it exports them raw into evidence storage with no marker (§7).
**S4c. Cache timestamps are unchecked against any primary source** (§10).

### Not a defect

`visit_duration` handling (correct). `autofill` Unix-seconds (correct). `logins.date_created`
1601-µs (correct). Bookmarks 1601-µs (correct). Absence of Cookies / `use_date` / `offer_data` /
Media History / `segment_usage` (out of scope, not mishandled). Number-precision loss on
1601-µs values above 2^53 in `bookmarks.js:9` and `CacheController.js:284` — ulp is ~16 µs and
both round to whole seconds, so **immaterial** (VERIFIED by arithmetic).

---

## 10. Unresolved

| # | Item | Why it matters |
|---|---|---|
| **U-1** | **The Chrome disk-cache timestamp family is not covered by the #143 matrix.** v1 applies the 1601-µs formula to the index-header `create_time`, `RankingsNode.last_used`/`last_modified`, and `EntryStore.creation_time` (`CacheController.js:102,413,416,513`). I **INFER** 1601-µs from `Time::ToInternalValue()` being the historical block-file cache encoder, but I did **not** fetch Chromium source to verify in this run. **4 of the 15 render sites are unverified.** This is the single most important thing I could not resolve. | If the family is wrong, those four are S1 wrong-value, not S3. |
| **U-2** | `better-sqlite3` duplicate-column resolution not executed (module not installed). sqlite3 CLI confirms both columns are emitted, raw first; last-wins is INFERRED from JS object semantics. | Determines whether the API returns the raw int or the formatted string for `date_created`. If raw wins, S1a is *worse* (no dates at all) — but the client screenshots imply formatted wins. |
| **U-3** | Docker base-image default `TZ` assumed UTC (`nikolaik/python-nodejs`); not built or inspected. | Determines whether the shipped deployment is accidentally correct. |
| **U-4** | Whether any real-world Source in `data/` exercises the ≤v8 / ≤v16 / ≤v23 paths. Not tested — no sample corpus examined. | Bounds S2 exposure. |

---

## 11. Draft issue body

> ### v1 renders every timestamp in the analysis machine's timezone, unlabelled
>
> **Summary.** ForensiX v1 decodes Chrome timestamps into the timezone of whatever machine is
> running the analysis, and records nothing about which timezone that was. The same evidence
> Source therefore produces different times on different investigators' machines, and the
> output gives no way to tell them apart or convert between them.
>
> **What's happening.** Chrome stores timestamps as UTC integers. To display them, v1 asks
> SQLite to convert, and passes the `'localtime'` modifier:
>
> ```js
> // server/controllers/HistoryController.js:104
> datetime((visit_time/1000000)-11644473600, 'unixepoch', 'localtime') AS visit_date
> ```
>
> `'localtime'` means "the timezone of the machine running this process". The same stored value
> renders as:
>
> | Analyst's machine | Displayed |
> |---|---|
> | Los Angeles | `2025-08-18 07:13:20` |
> | Bratislava | `2025-08-18 16:13:20` |
> | Tokyo | `2025-08-18 23:13:20` |
> | (the truth, UTC) | `2025-08-18 12:13:20` |
>
> A 16-hour spread. At the extremes the **calendar day** differs. There is no field in the
> output that says which of these you are looking at.
>
> **Scope.** 15 timestamp render sites, 5 files. **None of them is UTC-correct.**
> - `server/controllers/HistoryController.js:104, 173, 275` — visit times, download start/end
> - `server/controllers/LoginDataController.js:49` — password created / last used
> - `server/controllers/WebDataController.js:10` — autofill created / last used
> - `server/routers/bookmarks.js:9-11` — bookmark added / last visited
> - `server/controllers/CacheController.js:283-286` — cache entry creation / last used / modified
>
> A second, independent shift compounds it at `HistoryController.js:124-125`: a date already
> converted to local time is re-parsed as UTC and re-read as local, putting every visit on the
> 1st of a month into the previous month's bar for any analyst west of UTC (verified:
> `TZ=America/Los_Angeles`, `new Date("2022-07-01").getMonth()` → `5`, i.e. June).
>
> **Why it's not cosmetic.** Timestamps saved through the "Mark as evidence" button are stored
> as pre-formatted strings in a shared database
> (`client/src/common/SaveEvidenceModal/SaveEvidenceModal.js:16-19` →
> `server/models/evidence.js:5`). The offset is baked in at save time and cannot be recovered
> afterwards. Two investigators marking the same row produce two different records with no
> indication that they disagree, or by how much.
>
> **Two smaller problems in the same code.**
>
> 1. **`0` is rendered as a date.** Chrome writes `0` to mean "never happened". v1 converts it
>    like any other value and shows `1601-01-01` (or `1970-01-01` for autofill columns). The
>    Login Data "Last Used" column is `DEFAULT 0`, so *every credential the browser never
>    auto-filled* displays a date in 1601. That is a real, frequent, misleading output — not a
>    corner case.
> 2. **An absent bookmark field displays as `Invalid Date`** (`server/routers/bookmarks.js:37-39`),
>    which reads like a corrupt value rather than a missing one.
>
> **What v1 gets right, for the record.** The genuinely hard part of Chrome timestamps is that
> different columns use different time bases — some count microseconds from 1601, others count
> seconds from 1970, and there are columns with the *same name* in different tables using
> different ones. v1 gets every single one of these right at every place it decodes:
> `logins.date_created` is treated as 1601-microseconds and `autofill.date_created` as
> Unix-seconds, correctly, in the same codebase. `visit_duration` is correctly handled as a
> duration rather than an instant. And the client never applies a second conversion on top of
> the server's. This is a timezone bug, not an epoch bug. The decoding is sound; only the final
> presentation step is wrong.
>
> **Suggested direction.** Render in UTC by default; carry the investigator-declared timezone as
> an explicit, labelled input rather than reading it off the host; keep the raw stored value
> alongside the rendered one so any conversion can be re-derived or corrected later; and treat
> `0` as "never", not as a date.

---

*Audit complete. 15 render sites enumerated, 26 column-level checks against the matrix,
4 execution-verified demonstrations. One unresolved family (Cache — U-1).*
