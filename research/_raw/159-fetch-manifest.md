# Fetch manifest — #159 scale-and-latency evidence

Every URL fetched while producing `research/159-scale-and-latency-evidence.md`, and what was taken
from each.

**When:** a single research pass, one session, in one continuous run. All fetches below were made in
that pass; no content was carried over from a previous session. Where a source drifts (`master`,
`refs/heads/main`, a live docs page), that is flagged in the "pin" column — the brief treats
unpinned sources as needing re-verification before citation in a decision memo.

**Note on failures:** three fetches failed and are listed at the bottom. They are the origin of
VQ-11 and part of VQ-9. They are recorded rather than quietly dropped.

---

## SQLite — official documentation

| URL | Pin | Taken |
|---|---|---|
| https://www.sqlite.org/optoverview.html | live doc | ANALYZE-absent planner guesses ("average of 10 duplicates", "guesses that N is one million"); skip-scan never used unanalysed; ANALYZE results only visible to connections opened after it completes; STAT3/STAT4; co-routine/ORDER BY LIMIT note. §2.4 |
| https://sqlite.org/queryplanner.html | live doc | §1.6 prefix-index rule; §1.7 covering index "roughly a doubling of the speed … just a refinement"; §2 un-indexed ORDER BY = K·logK **plus** "the entire output is accumulated in temporary storage"; §2.2 indexed sort avoids the buffer; §2.3 covering-index walk in time proportional to N; §3.3 block sorting. §2.1, §2.3 |
| https://www.sqlite.org/lang_select.html | live doc | §5 LIMIT/OFFSET semantics ("the first M rows are omitted … and the next N rows are returned"); warning against the comma form. §2.2 |
| https://www.sqlite.org/lang_analyze.html | live doc | "The use of ANALYZE is never required"; §2.1 `PRAGMA optimize` recommended patterns (short-lived connections; `optimize=0x10002` on long-lived); 3.46.0 auto scope-limiting; §5 `PRAGMA analysis_limit` N between 100 and 1000. §2.4 |
| https://www.sqlite.org/eqp.html | live doc | §1.2 "USE TEMP B-TREE FOR xxx" — the observable signature of a temp-b-tree sort. §2.3 |
| https://www.sqlite.org/limits.html | live doc | §24 max rows (~2e13 practical), §25 max database size (281 TB at 64 KiB pages); default `SQLITE_MAX_PAGE_COUNT` since 3.45.0. §2.5 |

## SQLite — source and forum

| URL | Pin | Taken |
|---|---|---|
| https://raw.githubusercontent.com/sqlite/sqlite/master/src/select.c | `master` (unpinned — VQ-12) | `computeLimitRegisters()` header comment (iLimit/iOffset/LIMIT+OFFSET register layout); `codeOffset()` — `/* Add code to implement the OFFSET */` with `OP_IfPos` jumping to `iContinue`, i.e. rows are produced then discarded; `generateWithRecursiveQuery()` — "the first OFFSET outputs are discarded rather than being sent to pDest". **The primary mechanism behind #159's "deep page".** §2.2 |
| https://sqlite.org/forum/forumpost/e4fc222f10ab0afe | post id pinned | Gunter Hick, 2022-10-19: "I must strongly advise against using an OFFSET clause… The rows not returned still have to be produced"; the six-query cost ladder; the transaction-boundary correctness argument (rows skipped backwards / repeated forwards). Attribution caveat recorded in the brief. §2.2 |
| https://sqlite.org/forum/forumpost/e4fc222f10ab0afe?raw= | post id pinned | Raw body of the same post, used to transcribe the ladder verbatim. |

## better-sqlite3

| URL | Pin | Taken |
|---|---|---|
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/README.md | `master` | "generally important to set the WAL pragma"; 2020 cross-library comparison table; scale envelope ("2000 queries per second with 5-way-joins in a 60 GB database"); named inappropriate cases; "the most likely causes are inefficient queries, improper indexing, or a lack of WAL mode—not better-sqlite3 itself". §3 |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md | `master` | `.iterate()` vs `.all()` ("`.all()` will perform slightly better"); `.raw()` — "primarily used as a performance optimization when retrieving a very high number of rows"; `.pluck()`/`.expand()`/`.raw()` mutual exclusivity; `.columns()`; the `.raw().iterate()` → `createWriteStream` CSV example (and its missing backpressure check). §3 |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/performance.md | `master` | WAL recommendation and its three stated disadvantages; checkpoint starvation and its precondition; `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` → NORMAL, "a slight loss of durability". §3 |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/benchmark.md | `master` | The only published numbers: 2020-03-29, MacBook Pro Mid-2014, node v12.16.1, WAL mode, 1-row and 100-row workloads. Used **only** to show they are not a usable ForensiX baseline. §3 |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/unsafe.md | `master` | Existence of `unsafeMode` as an advanced/dangerous option. §3 |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/threads.md | `master` | Worker-thread support (read; not cited — no #159-relevant claim). |
| https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/package.json | `master` | **Version drift evidence:** `"version": "13.0.3"`, `"engines": {"node": ">=22"}`, `node-addon-api ^8`, per-platform prebuild exports. Repo pins `^12.2.0`. Header note + VQ-3. |

## Node.js — official documentation

| URL | Pin | Taken |
|---|---|---|
| https://nodejs.org/api/buffer.html | live doc | `buffer.constants.MAX_STRING_LENGTH` ("may depend on the JS engine that is being used"), `kStringMaxLength` alias, `MAX_LENGTH` = 2^53−1 on 64-bit since v22. §4.2 |
| https://nodejs.org/api/process.html | live doc | `process.memoryUsage()` fields + "iterates over each page … might be slow"; worker-thread `rss` caveat; glibc fragmentation note; `process.memoryUsage.rss()` (faster); **`process.resourceUsage()` → `maxRSS` from `uv_getrusage`** — the recommended peak-RSS instrument. §4.3 |
| https://nodejs.org/api/cli.html | live doc | `--max-old-space-size`, `--max-old-space-size-percentage`, `--max-heap-size`, `--heapsnapshot-near-heap-limit`. **No published default heap size** → VQ-5. §4.4 |
| https://nodejs.org/en/learn/modules/backpressuring-in-streams | live guide | Backpressure trigger = `.write()` returning false; `highWaterMark` default 16 KB / 16 objects; the golden rule and its two sub-rules; the guide's own 87.8 MB vs ~1.52 GB max-RSS comparison; `stream.pipeline` and `stream/promises`. §4.1 |
| https://github.com/nodejs/node/issues/31653 | issue (via search index) | Reported `MAX_STRING_LENGTH` 1073741799 (Node 12.3.1) → 536870888 (Node 13.6.0), with `RangeError: Invalid string length` from `JSON.stringify`. §4.2 |
| https://github.com/nodejs/node/issues/33960 | issue (via search index) | Same regression confirmed on Node 14.4.0, 64-bit. §4.2 |

## Human factors and web performance — first-party

| URL | Pin | Taken |
|---|---|---|
| https://www.nngroup.com/articles/response-times-3-important-limits/ | live article | The 0.1 s / 1.0 s / 10 s limits with their [Miller 1968; Card et al. 1991] attribution; the percent-done rule (>~10 s) and "clearly signposted way for the user to interrupt"; the 2014 web-application addendum; **the table-column-sorting example verbatim**; full reference list (Miller 1968, Card 1991, Myers 1985). §6, §7 |
| https://web.dev/articles/rail | live article | RAIL's four categories; Response 100 ms goal / 50 ms processing guideline and the reason for the split; Animation 10 ms; Idle; Load 5 s on mid-range mobile + slow 3G; the 0–100 / 100–1000 / 1000 / 10000 ms perception table; the goals-vs-guidelines distinction; the explicit citation of the NN/g page. §6, §7 |
| https://web.dev/articles/inp | live article | INP thresholds: ≤200 ms good, >200–≤500 needs improvement, >500 poor, at field p75. §6, §7 |
| https://web.dev/articles/optimize-long-tasks | live article | "Any task that takes longer than 50 milliseconds is a long task"; blocking period definition; the 50 ms yield deadline. §5.2, §7 |
| https://developer.chrome.com/docs/lighthouse/performance/dom-size | live doc (via search index) | Lighthouse warns >~800 body nodes, errors >~1400. §5.2, §7 |
| https://developer.chrome.com/docs/performance/insights/dom-size | live doc (via search index) | "A large DOM can increase the duration of style calculations and layouts… A large DOM also increases memory usage." §5.2 |
| https://github.com/GoogleChrome/lighthouse/blob/e91f782.../lighthouse-core/audits/dobetterweb/dom-size.js | sha-pinned in URL | `MAX_DOM_ELEMENTS = 1500`, `MAX_DOM_TREE_WIDTH = 60`, `MAX_DOM_TREE_DEPTH = 32`. §5.2 |
| https://web.dev/articles/dom-size-and-interactivity | live article (via search index) | Restates the 800/1400 thresholds and how to measure DOM size. §5.2 |

## Client stack — material-table

| URL | Pin | Taken |
|---|---|---|
| https://raw.githubusercontent.com/mbrn/material-table/master/src/utils/data-manager.js | `master` (v1.69.3 tag returned 404 — see failures) | `DataManager` field list including `data`/`filteredData`/`searchedData`/`groupedData`/`treefiedData`/`sortedData`/`pagedData`/`renderData`; `getRenderState()` pipeline order; `[...this.data]` / `[...this.filteredData]` / `[...this.searchedData]` full-array copies; `sortData()` calling `sortList` over the whole array; `pageData()` doing `Array.prototype.slice`; **no virtualisation anywhere**. §5.1 — the highest-blast-radius finding in the brief. |
| https://github.com/mbrn/material-table/issues/891 | issue (via search index) | Virtualised scrolling is an open **feature request**, i.e. not shipped in 1.x. §5.1 |
| https://www.material-react-table.com/docs/guides/virtualization | live doc (via search index) | Virtualisation exists only in the unrelated successor project (Material React Table), via `@tanstack/react-virtual`. Used to establish the negative for material-table 1.x. §5.1 |

## DuckDB — official documentation

| URL | Pin | Taken |
|---|---|---|
| https://duckdb.org/why_duckdb.html | live doc | The OLAP self-description: "complex, relatively long-running queries that process significant portions of the stored dataset". §7.6 |
| https://duckdb.org/docs/stable/guides/performance/environment | live doc (via search index) | "Aim for 1-4 GB memory per thread"; "a minimum of 125 MB of memory per thread". §7.6 |
| https://duckdb.org/docs/stable/guides/performance/my_workload_is_slow | live doc (via search index) | "DuckDB works best if you have 1-4 GB memory per thread"; default memory limit "80% of the total RAM", `SET memory_limit`. §7.6 |
| https://duckdb.org/docs/stable/core_extensions/sqlite | live doc (via search index; direct fetch failed) | `sqlite` extension autoloads on first use; `sqlite_scan('file.db','tbl')` reads a SQLite file in place. §7.6 |

## Chromium — source, pinned

| URL | Pin | Taken |
|---|---|---|
| https://chromium.googlesource.com/chromium/src/+/673a5aee77ad12e118c8edac73359acdeb7f491c/components/history/core/browser/history_backend.h | **sha `673a5aee77ad12e118c8edac73359acdeb7f491c`** | `static constexpr int kExpireDaysThreshold = 90;` with its comment ("The number of days old a history entry can be before it is considered 'old' and is deleted"). No line numbers were rendered on the page, so none are quoted. §9.1 |
| https://chromium.googlesource.com/chromium/src/+/673a5aee77ad12e118c8edac73359acdeb7f491c/components/history/core/browser/expire_history_backend.cc | **same sha** | `kNumExpirePerIteration = 32`, `kExpirationDelaySec = 30`, `kExpirationEmptyDelayMin = 5` with comments verbatim (including the source's own "very time"/"Prevents" typos); `ExpireURLsForVisits`'s "Not pinned and no more visits. Nuke the url." branch; `DeleteOneURL`; `StartExpiringOldStuff(base::TimeDelta)` signature. §9.1 |
| https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/history/core/browser/expire_history_backend.cc?format=TEXT | `refs/heads/main` (moving) | Fetched as base64; **not decoded and not cited.** The pinned-sha fetch above supersedes it. Recorded for honesty. |

## Fetches that failed — recorded, not hidden

| URL | Failure | Consequence |
|---|---|---|
| https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/objects/string.h?format=TEXT | Fetched, but `kMaxLength` **not found** in the retrieved content (large file, likely truncated) | V8's `String::kMaxLength` is **STILL-UNKNOWN** → VQ-11. Brief falls back to Node's documented constant + the two Node issues, and notes the operational one-liner. |
| https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-primitive.h?format=TEXT | Same — fetched, `kMaxLength` not found in retrieved content | Same as above. |
| https://chromium.googlesource.com/chromium/src/+log/refs/heads/main/components/history/core/browser/expire_history_backend.cc?format=JSON&n=1 | HTTP 401 | Could not resolve the current `main` sha for the history-expiry files. Worked around by pinning to `673a5aee…`, obtained from a gitiles URL and then read directly. |
| https://raw.githubusercontent.com/mbrn/material-table/v1.69.3/src/utils/data-manager.js | HTTP 404 (tag name does not resolve) | §5.1 is sourced from `master`, **not** from the exact pinned 1.69.3 tag. The `DataManager` structure is long-standing in 1.x, but this is a real pin gap — folded into VQ-1's "verify against ForensiX's actual view code". |
| https://duckdb.org/docs/stable/core_extensions/sqlite | "Could not extract readable content from HTML structure" | `sqlite_scan` facts taken from the search index's rendering of the same official page rather than a direct read. Low blast radius (§7.6 is conditional material). |

## Searches run (provider-synthesised; used only to locate primary sources, never cited as authority)

- SQLite forum / drh statements on LIMIT-OFFSET cost → led to `forumpost/e4fc222f10ab0afe` and thence to `src/select.c`.
- "seek method" / keyset pagination → returned mostly secondary sources (use-the-index-luke, Vlad Mihalcea, Ask TOM, EF Core docs); **all dropped** in favour of SQLite's own source.
- optoverview / temp b-tree sorting → led to `queryplanner.html` §2 and `eqp.html` §1.2.
- material-table virtualisation → led to issue #891 and the `data-manager.js` source read.
- Node `JSON.stringify` / max string length → led to nodejs/node#31653 and #33960.
- Lighthouse DOM size → led to the Chrome docs and the sha-pinned `dom-size.js`.
- Chromium history expiry constants → led to the pinned `history_backend.h` / `expire_history_backend.cc` reads.
- DuckDB memory model / sqlite_scanner → led to `why_duckdb.html` and the performance guides.
- Hindsight scale limits → **nothing first-party found** (see VQ-10). Secondary hits (`dfir.blog`, an unrelated `hindsight.vectorize.io` product) dropped.

## Sources deliberately dropped

- Stack Overflow answers on temp-b-tree sorting and OFFSET performance — not authoritative; the same facts were obtained from sqlite.org and `src/select.c`.
- `use-the-index-luke.com`, `vladmihalcea.com`, `asktom.oracle.com`, Microsoft EF Core pagination docs — good explanations of keyset paging, but not primary for SQLite.
- `micahkepe.com` "Deep Dive into SQLite's Query Optimizer", `debugbear.com` DOM-size article, `jacar.es` SQLite-vs-DuckDB — secondary commentary; superseded by first-party sources.
- `sqlite-users.sqlite.narkive.com` mailing-list mirrors — user reports, not maintainer statements.
- `discourse.julialang.org` DuckDB/SQLite thread — user report.
- `hindsight.vectorize.io` — an unrelated product that shares the name.
