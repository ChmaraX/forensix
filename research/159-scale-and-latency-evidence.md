# Scale and latency — the evidence layer under the measurement — #159

**Answers the *evidence* half of [#159](https://github.com/ChmaraX/forensix/issues/159)
("Measure Case query and Export latency at 10⁴, 10⁵ and 10⁶ rows").**

**Source-access status: LIVE.** Every CONFIRMED claim below was read from a primary source during
this run: `sqlite.org`, the SQLite source tree, the `better-sqlite3` repository, `nodejs.org/api`,
`web.dev` / `developer.chrome.com`, `nngroup.com`, `duckdb.org`, `material-table` source, and
Chromium source over gitiles at a pinned sha. Fetch manifest:
`research/_raw/159-fetch-manifest.md`.

> ### WHAT THIS FILE IS NOT
>
> **No benchmark was run.** Nothing here is a measurement of ForensiX. There is not one ForensiX
> timing number in this document, and any that appears later must come from the generator, not
> from here.
>
> This file is the layer *under* the measurement. It does three things:
> 1. States what the primary sources already document about the performance behaviour the
>    measurement will hit, so the run is not re-discovering documented mechanics.
> 2. Proposes an **interactive budget with external sourcing**, so #159's discipline rule
>    ("whoever writes the generator does NOT decide the pass mark") is satisfiable: this budget is
>    written by someone who has not seen the generator, and can be pinned to the ticket before it
>    is written.
> 3. Specifies a **measurement design** precise enough that the run cannot accidentally measure
>    the wrong thing.
>
> Every line is marked **CONFIRMED** (primary source cited) or **STILL-UNKNOWN** (in the
> verification queue, §9). Inferences over confirmed facts are marked **REASONING** and are never
> presented as sourced.

**Ubiquitous language** is `CONTEXT.md`'s: Case, Extract, Candidate, Finding, Provenance, Field
State, Manifest, Export, Report, Working Copy. The ticket's six operations are named throughout as
*cold Case open*, *first page*, *deep page*, *filter+sort*, *Export*, *Report*.

**Stack versions verified from this repo, not restated from memory:**

| Component | Declared | File |
|---|---|---|
| `better-sqlite3` | `^12.2.0` | `server/package.json` |
| `react` / `react-dom` | `^16.14.0` | `client/package.json` |
| `material-table` | `^1.69.3` | `client/package.json` |
| `recharts` | `^2.12.7` | `client/package.json` |
| `@material-ui/core` | `^4.12.4` | `client/package.json` |

> **Version drift, recorded up front.** The `better-sqlite3` documentation read in §3 was read at
> the repository's `master`, whose `package.json` declares **`13.0.3`** with `"engines": {"node":
> ">=22"}`. The repo pins `^12.2.0`. The API surface cited (`.raw()`, `.pluck()`, `.iterate()`,
> WAL guidance) is long-standing, but the *bundled SQLite version* and the *minimum Node* differ
> between 12.x and 13.x and are **STILL-UNKNOWN** here — see VQ-3.

---

## 1. Summary — what the sources already settle, before anyone runs anything

1. **The deep-page cost is documented, not emergent.** SQLite's own source implements `OFFSET` as a
   counter that discards *already-produced* rows (`codeOffset()` → `OP_IfPos`). A "deep page" done
   with `LIMIT/OFFSET` is O(offset) by construction. Keyset (seek) paging is O(log N) into the
   index. #130 already fixed the contract as keyset — so **the deep-page measurement is a test that
   the contract is actually honoured**, not an open question about SQLite. If deep page ≫ first
   page, the finding is a ForensiX regression, not a SQLite property. (§2.2)
2. **ORDER BY on a non-indexed column at 10⁶ rows is documented as K·log K *plus* full
   materialisation into temp storage.** sqlite.org states the entire output is accumulated in
   temporary storage. So *filter+sort on an un-indexed column* is the single operation most likely
   to blow any budget, and it will blow the **peak RSS / temp-file** budget as well as the latency
   one. Which columns carry indexes is therefore the dominant experimental variable. (§2.3)
3. **The serialisation third has a documented lever with a documented direction but no published
   magnitude.** `better-sqlite3` documents `.raw()` as "primarily used as a performance
   optimization when retrieving a very high number of rows", and documents `.iterate()` as
   *slightly slower* than `.all()` when you intend to read every row. It publishes **no** per-row
   object-construction cost, and its only committed benchmark numbers are 2020-era cross-library
   comparisons at 100 rows. Object-mode-vs-raw cost at 10⁶ rows is **STILL-UNKNOWN from primary
   sources and must be measured**. (§3)
4. **A 10⁶-row Export must not pass through one JSON string.** Node documents a hard
   `buffer.constants.MAX_STRING_LENGTH` whose value is engine-dependent; the Node issue tracker
   records it dropping from 1 073 741 799 to 536 870 888 UTF-16 units on 64-bit. Whether 10⁶ Extract
   rows exceed that is a row-width question, but the failure mode is a `RangeError`, not slowness.
   NDJSON + `stream.pipeline` with respected backpressure is the documented shape. (§4)
5. **The render third is bounded by material-table 1.x's own code, and the bound is severe.**
   `DataManager` holds the **entire** `data` array, and `filterData`/`searchData`/`sortData` each
   copy the whole array (`[...this.data]`) before `pageData()` takes an `Array.prototype.slice()`.
   There is **no virtualisation**. So material-table's client-side filter/sort is O(N_client) *and*
   only sees the rows it was handed. Under #130's keyset contract N_client = one page — which means
   **material-table's built-in filter/sort would silently filter one page, not the Case.** That is a
   correctness finding, not a performance one, and it outranks everything else in this file. (§5)
6. **The interactive budget can be sourced, and Export/Report cannot be — correctly.** NN/g's
   0.1 s / 1 s / 10 s limits (Miller 1968, Card et al. 1991) and Google's RAIL (100 ms response,
   5 s load) and INP (≤200 ms good, >500 ms poor) give defensible interactive numbers. They give
   **nothing** for a batch Export. §7 proposes a *different class* of budget for Export and Report:
   linearity + bounded peak RSS + progress feedback, with the 10 s progress-indicator rule as the
   one sourced element.
7. **10⁶ rows is a stress case, not a realistic Chrome History.** Chromium expires history older
   than **90 days** (`kExpireDaysThreshold = 90`) and deletes URL rows once their last visit is
   gone. 10⁶ visits inside 90 days is ~11 000 visits/day. Measure at 10⁶ anyway — but label it
   stress, and do not let a 10⁶ result drive a v2.0 architecture change on its own. (§8)
8. **Nothing here reopens #130.** §7.4 states the *only* measurement outcomes that would justify
   reopening a columnar cache, and the outcomes that close it permanently.

---

## 2. SQLite query cost at 10⁴ / 10⁵ / 10⁶ rows

### 2.1 What sqlite.org documents about index use and covering indexes

**CONFIRMED** — a covering index removes the table lookup entirely, and sqlite.org sizes the win
itself: *"by adding extra 'output' columns onto the end of an index, one can avoid having to
reference the original table and thereby cut the number of binary searches for a query in half.
This is a constant-factor improvement in performance (roughly a doubling of the speed). But on the
other hand, it is also just a refinement; A two-fold performance increase is not nearly as dramatic
as the one-mi[llion-fold]…"*
— [Query Planning §1.7](https://sqlite.org/queryplanner.html)

**REASONING.** A covering index is therefore a ~2× lever, not an order-of-magnitude one. If a
per-artifact view's page query is 100× over budget, covering indexes will not save it; only
changing the plan (index-satisfied ORDER BY instead of a temp b-tree) will.

**CONFIRMED — sqlite.org warns against redundant prefix indexes:** *"a good rule of thumb is that
your database schema should never contain two indices where one index is a prefix of the other.
Drop the index with fewer columns."* — [Query Planning §1.6](https://sqlite.org/queryplanner.html)

### 2.2 The OFFSET trap — the mechanism, from SQLite's own source

**CONFIRMED — SQLite produces the skipped rows, then throws them away.** In `src/select.c`, the
routine that implements OFFSET is:

```c
/*
** Add code to implement the OFFSET
*/
...
sqlite3VdbeAddOp3(v, OP_IfPos, iOffset, iContinue, 1);
VdbeComment((v, "OFFSET"));
```

i.e. a register counter decremented per produced row, jumping to `continue` rather than emitting.
`computeLimitRegisters()` documents the register layout: *"The iOffset register (if it exists) is
initialized to the value of the OFFSET. The iLimit register is initialized to LIMIT. Register
iOffset+1 is initialized to LIMIT+OFFSET."*
— [`src/select.c`, `sqlite/sqlite` official mirror, `master`](https://raw.githubusercontent.com/sqlite/sqlite/master/src/select.c)

**CONFIRMED — the same statement in prose, and the ordered cost ladder**, from the SQLite User
Forum, post `e4fc222f10ab0afe`, by **Gunter Hick** (`gunter_hick`), 2022-10-19:

> *"I must strongly advise against using an OFFSET clause. The OFFSET clause is implemented as a
> counter that gets decremented every time a result row is produced. The rows not returned still
> have to be produced. This is exactly re-doing the work."*

with the ladder, verbatim, worst to best:

| # | Query | Forum's own verdict |
|---|---|---|
| 1 | `SELECT * FROM x ORDER BY t LIMIT 1000,10` | *"the slowest possible way. First, it has to read all of the rows, sort them, discard 1000 rows and return 10 rows."* |
| 2 | `... ORDER BY i LIMIT 1000,10` (indexed) | *"better because it avoids the sort, but it still has to discard 1000 rows while reading the index"* |
| 3 | `... ORDER BY r LIMIT 1000,10` (rowid) | *"Still better because the rowid is the fastest for retrieval."* |
| 5 | `... WHERE i > :i LIMIT 10` | *"Very much faster because it seeks to the starting point in the index and produces rows from there."* |
| 6 | `... WHERE r > :r LIMIT 10` | *"Still faster because it omits the index lookups from (5)"* |

— [sqlite.org/forum/forumpost/e4fc222f10ab0afe](https://sqlite.org/forum/forumpost/e4fc222f10ab0afe)

> **Attribution caveat, stated rather than glossed.** Gunter Hick is a long-standing SQLite forum
> contributor, **not** confirmed by this run to be a SQLite maintainer. The *mechanism* does not
> rest on his authority — it rests on `codeOffset()` in `src/select.c` above, which is SQLite's own
> source. Cite the source; cite the forum post only as the plain-language restatement.

**CONFIRMED — the same forum thread records the correctness reason for keyset, not just the speed
reason:** *"If each chunk is processed in a separate transaction, intervening INSERT and DELETE
statements may cause some rows to be not processed … And UPDATES that change the location of a
record may cause that record to be processed anywhere from never (i.e. skip 'backwards') to
infinitely many times (always skipping 'forwards')."* — same post.

**REASONING, and it matters for a forensic tool.** For ForensiX this is a *Provenance* argument, not
a performance one. An Analysis Run appending Candidates while an investigator pages an OFFSET-based
view can cause rows to be skipped or repeated. Keyset paging is the only paging that is stable under
concurrent append. This is an independent justification for #130's contract and should be recorded
as such.

**CONFIRMED — `LIMIT ... OFFSET` semantics** (which rows, in what order): *"If an expression has an
OFFSET clause, then the first M rows are omitted from the result set returned by the SELECT
statement and the next N rows are returned"* — [SELECT §5](https://www.sqlite.org/lang_select.html).
The doc also warns against the comma form (`LIMIT 1000,10`) — the operand order reverses.

### 2.3 ORDER BY on a non-indexed column at 10⁶ rows

**CONFIRMED — cost and memory, from sqlite.org:**

> *"When no appropriate indices are available, a query with an ORDER BY clause must be sorted as a
> separate step. … SQLite processes this by gathering all the output of the query and then running
> that output through a sorter. **If the number of output rows is K, then the time needed to sort is
> proportional to K·logK.** If K is small, the sorting time is usually not a factor, but in a query
> such as the above where K==N, the time needed to sort can be much greater than the time needed to
> do a full table scan. **Furthermore, the entire output is accumulated in temporary storage** (which
> might be either in main memory or on disk, depending on various compile-time and run-time
> settings) which can mean that a lot of temporary storage is required to complete the query."*
> — [Query Planning §2](https://sqlite.org/queryplanner.html) (emphasis added)

**CONFIRMED — an index-satisfied sort avoids the buffer:** *"generally speaking, the indexed sort
would probably be chosen, if for no other reason, because it does not need to accumulate the entire
result set in temporary storage before sorting and thus uses much less temporary storage."*
And with a covering index: *"SQLite can simply walk the index from one end to the other and deliver
the output in time proportional to N and without having to allocate a large buffer to hold the
result set."* — [Query Planning §2.2, §2.3](https://sqlite.org/queryplanner.html)

**CONFIRMED — partial ("block") sorting exists** when an ORDER BY is only partly index-satisfied:
*"SQLite does many small sorts, one sort for each distinct value of fruit, rather than one large
sort."* — [Query Planning §3.3](https://sqlite.org/queryplanner.html)

**CONFIRMED — how to *observe* it, from SQLite's own docs:** *"If a SELECT query contains an ORDER
BY, GROUP BY or DISTINCT clause, SQLite may need to use a temporary b-tree structure to sort the
output rows. Or, it might use an index. Using an index is almost always much more efficient than
performing a sort. If a temporary b-tree is required, a record is added to the EXPLAIN QUERY PLAN
output with the 'detail' field set to a string value of the form 'USE TEMP B-TREE FOR xxx'."*
— [EXPLAIN QUERY PLAN §1.2](https://www.sqlite.org/eqp.html)

**REASONING — the single highest-value instrumentation decision in the whole run.** Capture
`EXPLAIN QUERY PLAN` output for **every** measured statement, at every row count, and store it
beside the timing. `USE TEMP B-TREE FOR ORDER BY` in that output converts a slow number from a
mystery into a one-line explanation, and its *absence* proves the sort was index-satisfied. A run
that reports milliseconds without EQP text is not answerable and should be rejected at review.

### 2.4 ANALYZE and the query planner

**CONFIRMED — without ANALYZE the planner guesses, and the guesses are documented constants:**
*"Without the results of ANALYZE, SQLite has to guess at the 'shape' of the data in the table, and
the default guess is that there are an average of 10 duplicates for every value in the left-most
column of the index … Hence, a skip-scan is never used on a database that has not been analyzed."*
And: *"In the absence of ANALYZE information, SQLite guesses that N is one million."*
— [Query Optimizer Overview §6, §9](https://www.sqlite.org/optoverview.html)

**CONFIRMED — ANALYZE's visibility rule, which is a confounder:** *"The results of an ANALYZE
command are only available to database connections that are opened after the ANALYZE command
completes."* — [Query Optimizer Overview](https://www.sqlite.org/optoverview.html)

**CONFIRMED — the officially recommended pattern is `PRAGMA optimize`, not bare ANALYZE:**
*"The use of ANALYZE is never required. However, if an application makes complex queries that have
many possible query plans, the query planner will be better able to pick the best plan if ANALYZE
has been run."* … *"Applications with short-lived database connections should run 'PRAGMA optimize;'
once, just prior to closing each database connection."* … *"if the application keeps a single
database connection open for a long time, then it should run 'PRAGMA optimize=0x10002' when the
connection is first opened and run 'PRAGMA optimize;' periodically thereafter"*. Since 3.46.0
(2024-05-23) `PRAGMA optimize` limits its own scope so it *"completes quickly even on enormous
databases"*, and `PRAGMA analysis_limit` is no longer needed before it. For direct ANALYZE on large
files, *"A good rule of thumb seems to be to always set 'PRAGMA analysis_limit=N' for N between 100
and 1000 prior to running … ANALYZE."*
— [ANALYZE §2, §2.1, §5](https://www.sqlite.org/lang_analyze.html)

**REASONING.** ANALYZE state is a first-class experimental variable for #159, not a detail. A Case
that has had `PRAGMA optimize` run and one that has not are different databases from the planner's
point of view, and the difference can flip a plan between index-scan and temp-b-tree. The run must
either hold it constant *and record which* (§8.3), or measure both arms.

### 2.5 What sqlite.org documents vs what it leaves to measurement

| Question | sqlite.org's position |
|---|---|
| Does OFFSET walk skipped rows? | **Documented in source** (`codeOffset`, `OP_IfPos`). CONFIRMED. |
| Cost of un-indexed ORDER BY | **Documented as K·logK plus full temp materialisation.** CONFIRMED. |
| Covering-index speedup | **Documented as ~2×, explicitly "just a refinement".** CONFIRMED. |
| Max rows / max db size | **Documented**: max db 281 TB at 64 KiB pages; *"A 281 terabytes database can hold no more than approximately 2e+13 rows"*. 10⁶ is nowhere near any limit. — [Limits §24, §25](https://www.sqlite.org/limits.html) CONFIRMED. |
| **Absolute latency at 10⁶ rows on given hardware** | **Not documented anywhere.** SQLite documents *complexity and mechanism*, never wall-clock. STILL-UNKNOWN by construction — this is exactly and only what #159 can answer. |
| Which plan a given ForensiX query gets | Not documented; observable per-query via EQP. STILL-UNKNOWN until measured. |

---

## 3. `better-sqlite3` specifics — the serialisation third

Read at repository `master` (see version-drift note in the header).

**CONFIRMED — WAL is the project's headline performance guidance, and it is *not* on by default.**
The README says *"Though not required, it is generally important to set the WAL pragma for
performance reasons"* and shows `db.pragma('journal_mode = WAL')`. `docs/performance.md`:
*"Concurrently reading and writing from an SQLite database can be very slow in some cases. … it's
recommended to turn on WAL mode to greatly increase overall performance."*
— [README](https://github.com/WiseLibs/better-sqlite3#readme),
[docs/performance.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)

**CONFIRMED — the distribution's durability default differs from stock SQLite:** *"This
distribution of SQLite uses the `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` compile-time option, which makes
databases in WAL mode default to the 'NORMAL' synchronous setting. This allows applications to
achieve extreme performance, but introduces a slight loss of durability while in WAL mode."*
— docs/performance.md

**REASONING — this is a Case-integrity question, not only a speed one.** A Case is the record of
truth. `synchronous = NORMAL` under WAL trades durability for speed by the library's own admission.
#159 must record which setting the measured Case used, because a v2.0 that chooses `FULL` for
integrity reasons will have *different Export numbers* than one that leaves the library default.
Do not let the benchmark silently pick the fast-and-less-durable arm and then have the product ship
the other.

**CONFIRMED — checkpoint starvation, and its precondition:** *"Checkpoint starvation is when SQLite
is unable to recycle the WAL file due to everlasting concurrent reads … the WAL file will grow
without bound, leading to unacceptable amounts of disk usage and deteriorating performance. **If you
don't access the database from multiple processes or threads simultaneously, you'll never encounter
this issue.**"* — docs/performance.md

**CONFIRMED — `.iterate()` vs `.all()`:** *"Similar to `.all()`, but instead of returning every row
together, an iterator is returned so you can retrieve the rows one by one. **If you plan on
retrieving every row anyways, `.all()` will perform slightly better.**"*
— [docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

**CONFIRMED — `.raw()` is documented as the high-row-count performance mode:** *"Causes the prepared
statement to return rows as arrays instead of objects. **This is primarily used as a performance
optimization when retrieving a very high number of rows.** Column names can be recovered by using the
`.columns()` method."* `.pluck()`, `.expand()` and `.raw()` are documented as **mutually
exclusive**. — docs/api.md

**CONFIRMED — the project's own streamed-export example is `.raw().iterate()` into a write
stream**, which is precisely #159's Export shape:

```js
function* toRows(stmt) {
  yield stmt.columns().map(column => column.name);
  yield* stmt.raw().iterate();
}
function writeToCSV(filename, stmt) { /* fs.createWriteStream, stream.write(row.join(',')+'\n') */ }
```
— docs/api.md, under `.columns()`

> **REASONING — but note the example's own flaw.** That snippet calls `stream.write()` without ever
> checking its return value, i.e. it ignores backpressure — the exact anti-pattern Node's own guide
> names (§4.1). ForensiX must not copy it verbatim. Use `stream.pipeline` with a `Readable.from()`
> over the iterator.

**CONFIRMED — the only published benchmark numbers, and their limits.** `docs/benchmark.md` gives
cross-library ops/sec *"from 03/29/2020, on a MacBook Pro (Retina, 15-inch, Mid 2014, OSX 10.11.6),
using nodejs v12.16.1"*, all *"executed in WAL mode"*, with workloads of **1 row and 100 rows**:

```
--- reading 100 rows into an array ---     better-sqlite3 x 8,508 ops/sec ±0.27%
--- iterating over 100 rows ---            better-sqlite3 x 6,532 ops/sec ±0.32%
```
— [docs/benchmark.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/benchmark.md)

**REASONING.** These are 2020 numbers on 2014 hardware at 100 rows against a *different library*.
They are **not usable** as a ForensiX baseline and must not be cited as one. They do establish the
project's own methodology though — WAL on, `nodemark`, reported ±%.

**CONFIRMED — the project's stated scale envelope and its named failure cases:** *"With proper
indexing, we've been able to achieve upward of 2000 queries per second with 5-way-joins in a 60 GB
database, where each query was handling 5–50 kilobytes of real data."* Inappropriate cases named:
*"If you expect a high volume of concurrent reads each returning many megabytes of data"*, high
concurrent writes, or *"If your database's size is near the terabyte range"*. And: *"If you have a
performance problem, the most likely causes are inefficient queries, improper indexing, or a lack of
WAL mode—not better-sqlite3 itself."* — README

**REASONING.** ForensiX at 10⁶ rows sits inside that envelope on every axis except one: a full
Export *is* "a read returning many megabytes of data". That is why Export must be streamed, and why
Export gets a different budget class (§7.3).

**STILL-UNKNOWN — the per-row JS object construction cost.** The project makes a *directional* claim
(`.raw()` faster for very high row counts) and **publishes no magnitude at any row count**. There is
no `benchmark/` case for 10⁴–10⁶ rows, no object-vs-raw comparison, and no statement about V8 hidden
classes or string interning per column. **This is the "serialisation third" of #159's question 2 and
the sources cannot answer it. It must be measured** — design in §8.4. → VQ-2

**STILL-UNKNOWN — prepared-statement caching.** The API docs describe `db.prepare()` returning a
`Statement` and `.bind()` for permanent binding, but this run found **no documented statement cache**
keyed by SQL text; the documented model is that the *caller* holds the prepared `Statement`. If
ForensiX re-prepares per request, that cost is on ForensiX, not the library. → VQ-4

**CONFIRMED — `unsafeMode` exists and is documented as advanced/dangerous** (`docs/unsafe.md`).
**REASONING:** nothing in #159 requires it. Any benchmark that enables it is measuring a
configuration ForensiX must not ship, and should be rejected.

---

## 4. The Node.js serialisation and streaming ceiling

### 4.1 Backpressure — the documented rule

**CONFIRMED — the trigger point:** *"The moment that backpressure is triggered can be narrowed
exactly to the return value of a Writable's `.write()` function. … In any scenario where the data
buffer has exceeded the `highWaterMark` or the write queue is currently busy, `.write()` will return
`false`. When a `false` value is returned, the backpressure system kicks in."*
**The default:** *"Node.js allows you to set your custom `highWaterMark`, but commonly, the default
is set to 16kb (16384, or 16 for objectMode streams)."*
**The golden rule:** *"The golden rule of streams is **to always respect backpressure**. … 1. Never
`.push()` if you are not asked. 2. Never call `.write()` after it returns false but wait for 'drain'
instead."*
**The consequence of ignoring it:** *"the process would use up your system's memory … Slowing down
all other current processes / A very overworked garbage collector / Memory exhaustion"*, with the
guide's own measurement showing max RSS ~87.8 MB with backpressure respected vs *"approximately 1.52
gb"* without — *"an order of magnitude greater of memory space being allocated"*.
**The recommended API:** `stream.pipeline` — *"for Node.js 10.x or later version, `pipeline` is
introduced … This is a module method to pipe between streams forwarding errors and properly cleaning
up"*, including the `stream/promises` `await pipeline(...)` form.
— [Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)

**REASONING — this converts one of #159's questions into a pass/fail assertion rather than a
number.** If Export respects backpressure, peak RSS is flat in row count; if it does not, peak RSS
grows with row count. That is a *shape* test, and it is more decisive than any millisecond figure.
§7.3 makes it a budget line.

### 4.2 The max-string ceiling — a `RangeError`, not a slowdown

**CONFIRMED — Node documents the constant and its engine-dependence:** `buffer.constants.MAX_STRING_LENGTH`
— *"The largest length allowed for a single `string` instance. Represents the largest `length` that a
`string` primitive can have, counted in UTF-16 code units. **This value may depend on the JS engine
that is being used.**"* Aliased as `buffer.kStringMaxLength`. Separately,
`buffer.constants.MAX_LENGTH` (max `Buffer`) is documented as `2^53 - 1` on 64-bit since Node v22.
— [Buffer](https://nodejs.org/api/buffer.html)

**CONFIRMED (Node issue tracker, i.e. the Node project's own repo, reporting observed values):**
`MAX_STRING_LENGTH` was `1073741799` on Node 12.3.1 and `536870888` on Node 13.6.0 / 14.4.0 on
64-bit — reported in [nodejs/node#31653](https://github.com/nodejs/node/issues/31653) and
[nodejs/node#33960](https://github.com/nodejs/node/issues/33960), both citing `RangeError: Invalid
string length` from `JSON.stringify`.

**STILL-UNKNOWN — the V8 constant itself.** This run fetched `v8/src/objects/string.h` and
`include/v8-primitive.h` over gitiles and **could not locate `kMaxLength`** in the retrieved content
(likely truncation of a large file, not absence). The exact V8-side definition and the version at
which it changed are therefore unconfirmed here. → VQ-1. The *operational* number is trivially
obtainable and should be recorded in the run's environment block:
`node -p "require('buffer').constants.MAX_STRING_LENGTH"`.

**REASONING — the design consequence is unconditional and does not depend on the exact value.**
A 10⁶-row Extract serialised as **one** `JSON.stringify` output is a single string. At ~537 M UTF-16
units the ceiling is ~537 characters per row at 10⁶ rows — plausibly *under* a realistic Extract row
carrying URL, title, timestamps, Field State and Provenance. So the one-big-string Export is at
genuine risk of a hard `RangeError` at 10⁶, and it is *not* a graceful failure: it throws after all
the work is done. **NDJSON (one JSON object per line, written through `pipeline`) removes the ceiling
entirely** — each row is its own string. That is the shape #159 should measure, and the one-string
shape should be measured only to demonstrate the failure, if at all.

### 4.3 Measuring peak RSS — Node's documented mechanisms

**CONFIRMED — three distinct APIs, with different meanings:**
- `process.memoryUsage()` → `{ rss, heapTotal, heapUsed, external, arrayBuffers }`. Caveat from the
  docs: *"The `process.memoryUsage()` method iterates over each page to gather information about
  memory usage which might be slow depending on the program memory allocations."* And under
  `Worker` threads, *"`rss` will be a value that is valid for the entire process, while the other
  fields will only refer to the current thread."*
- `process.memoryUsage.rss()` (v15.6.0/v14.18.0+) → *"an integer representing the Resident Set Size
  (RSS) in bytes … the same value as the `rss` property provided by `process.memoryUsage()` but
  `process.memoryUsage.rss()` is faster."*
- **`process.resourceUsage()` (v12.6.0+)** → *"All of these values come from the `uv_getrusage` call"*
  and the returned object includes **`maxRSS`**.
— [process](https://nodejs.org/api/process.html)

**CONFIRMED — a documented glibc confounder:** *"On Linux or other systems where glibc is commonly
used, an application may have sustained `rss` growth despite stable `heapTotal` due to fragmentation
caused by the glibc `malloc` implementation."*

**REASONING — the correct instrument for #159's "peak RSS" is `process.resourceUsage().maxRSS`**,
read once at the end of the operation. It is the kernel's high-water mark and cannot miss a spike
between samples, which a polling loop over `process.memoryUsage.rss()` can. Sample the polling one
*as well*, at a fixed interval, only to get the shape of the curve. Note `maxRSS` units follow
`uv_rusage_t`/`getrusage` and differ by platform (KiB on Linux, bytes on macOS) — normalise and say
which, or the numbers are incomparable across the team's machines.

### 4.4 Heap limit / `--max-old-space-size` default

**CONFIRMED — Node documents the flag, not a fixed default:** *"`--max-old-space-size=SIZE` (in MiB)
— Sets the max memory size of V8's old memory section. As memory consumption approaches the limit,
V8 will spend more time on garbage collection … On a machine with 2 GiB of memory, consider setting
this to 1536 (1.5 GiB)."* Also documented: `--max-old-space-size-percentage=percentage`
(*"Sets the maximum memory size of V8's old memory section as a percentage of available system
memory. This flag takes precedence over `--max-old-space-size`"*), `--max-heap-size`, and
`--heapsnapshot-near-heap-limit`. — [CLI](https://nodejs.org/api/cli.html)

**STILL-UNKNOWN — the numeric default heap limit for the Node version the run uses.** The official
CLI docs read this run do **not** publish a per-version default table; the existence of
`--max-old-space-size-percentage` implies the default is memory-dependent. → VQ-5. Obtain it in the
run's environment block via `node -p "v8.getHeapStatistics().heap_size_limit"` and record it. A run
whose 10⁶ arm OOMs is meaningless without that number.

---

## 5. The render path — and the correctness finding hiding inside it

### 5.1 material-table 1.x materialises everything and virtualises nothing

**CONFIRMED — from `material-table` source, `src/utils/data-manager.js`.** `DataManager` holds
`data = []` plus **six** derived full arrays: `filteredData`, `searchedData`, `groupedData`,
`treefiedData`, `sortedData`, `pagedData`, `renderData`. The pipeline in `getRenderState()` runs
`filterData() → searchData() → [groupData/treefyData] → sortData() → pageData()`, and each stage
**copies the whole array**:

```js
filterData = () => { ...; this.filteredData = [...this.data]; ... }
searchData = () => { ...; this.searchedData = [...this.filteredData]; ... }
sortData()  { ...; this.sortedData = [...this.searchedData];
              if (this.orderBy != -1 && this.applySort) { this.sortedData = this.sortList(this.sortedData); } }
pageData()  { this.pagedData = [...this.sortedData];
              if (this.paging) {
                const startIndex = this.currentPage * this.pageSize;
                const endIndex = startIndex + this.pageSize;
                this.pagedData = this.pagedData.slice(startIndex, endIndex);
              } }
```

`getRenderState()` returns `{ ..., data: this.sortedData, originalData: this.data, renderData:
this.pagedData, ... }`.
— [`src/utils/data-manager.js`, `mbrn/material-table` `master`](https://raw.githubusercontent.com/mbrn/material-table/master/src/utils/data-manager.js)

**CONFIRMED — no virtualisation.** Pagination is `Array.prototype.slice()` after a full sort; there
is no windowing, no row recycling, and no `@tanstack/react-virtual`-style layer anywhere in this
file. (Virtualisation is a *feature request* on the project — mbrn/material-table#891 — not a
shipped behaviour of 1.x.) Row virtualisation appears only in the unrelated successor project
*Material React Table*, per its own docs.

**REASONING — three consequences, in decreasing order of importance:**

1. **CORRECTNESS, HIGH.** material-table's filter/sort/search operate **only on the array it was
   handed**. Under #130's contract the client holds one keyset page. Therefore the column filter
   and column sort in a per-artifact view, if left to material-table, **filter and sort one page and
   present the result as if it were the Case**. For a tool whose output is evidence, that is a
   false Finding surface, not a UX wart. **#159's "filter+sort on the columns a per-artifact view
   offers" must be measured as a server round-trip (SQL `WHERE` + `ORDER BY` + fresh keyset page),
   and if the current client does it locally, that is a bug to raise before the benchmark, not a
   number to report.**
2. **PERFORMANCE.** Per interaction the client does up to 4 full array copies plus one
   `Array.prototype.sort` over `N_client`. At a page size of 25–100 that is free. At any design that
   hands the client 10⁴+ rows it is not, and it lands on the main thread as one task (§5.2).
3. **MEMORY.** `originalData` + up to six derived arrays means the client's row-object footprint is
   a multiple of the payload, not equal to it.

### 5.2 First-party thresholds for main-thread work and DOM size

**CONFIRMED — long task = 50 ms:** *"The main thread can only process one task at a time. **Any task
that takes longer than 50 milliseconds is a long task.** For tasks that exceed 50 milliseconds, the
task's total time minus 50 milliseconds is known as the task's blocking period."* And on batching
work: *"A common deadline is 50 milliseconds to try to keep tasks from becoming long tasks."*
— [web.dev, Optimize long tasks](https://web.dev/articles/optimize-long-tasks)

**CONFIRMED — DOM size, from Lighthouse's own documentation:** Lighthouse *"Warns when the body
element has more than ~800 nodes"* and *"Errors when the body element has more than ~1,400 nodes"*.
Lighthouse's audit source defines `MAX_DOM_ELEMENTS = 1500`, `MAX_DOM_TREE_WIDTH = 60`,
`MAX_DOM_TREE_DEPTH = 32`. Chrome's performance-insights doc states *"A large DOM can increase the
duration of style calculations and layouts, impacting page responsiveness. A large DOM also
increases memory usage."*
— [Lighthouse: Avoid an excessive DOM size](https://developer.chrome.com/docs/lighthouse/performance/dom-size),
[Chrome DevTools: Optimize DOM size](https://developer.chrome.com/docs/performance/insights/dom-size),
[web.dev: How large DOM sizes affect interactivity](https://web.dev/articles/dom-size-and-interactivity)

**REASONING — this arithmetically closes the "render 10⁶ rows" branch, no measurement needed.**
A table row of ~8 columns costs on the order of 10 DOM nodes (`<tr>` + 8 `<td>` + inner spans). At
Lighthouse's ~1 400-node error threshold that is ~140 rows of table before the page is in "error"
territory on DOM size alone — and 10⁶ rows would be ~10⁷ nodes. **A non-virtualised HTML table
cannot render 10⁶ rows at any latency budget.** The only measurable question is what page size keeps
render inside the interactive budget, which §7 puts at ≤100 rows/page as the design constraint and
leaves the exact figure to the run.

**CONFIRMED — React 16 is the client's version** (`client/package.json`: `react ^16.14.0`).
**STILL-UNKNOWN — whether React 16's legacy (synchronous, non-concurrent) rendering makes a large
page-size render a single unyieldable long task in this app.** React 18's concurrent features are
not available at 16.x, but this run did not read React's own docs on 16 vs 18 scheduling. → VQ-6.

---

## 6. Sourced human-factors and web-performance thresholds

**CONFIRMED — NN/g's three limits, with their cited origin [Miller 1968; Card et al. 1991]:**
- *"**0.1 second** is about the limit for having the user feel that the system is **reacting
  instantaneously**, meaning that no special feedback is necessary except to display the result."*
- *"**1.0 second** is about the limit for the **user's flow of thought** to stay uninterrupted, even
  though the user will notice the delay … the user does lose the feeling of operating directly on
  the data."*
- *"**10 seconds** is about the limit for **keeping the user's attention** focused on the dialogue.
  For longer delays, users will want to perform other tasks while waiting … they should be given
  feedback indicating when the computer expects to be done."*
- *"As a rule of thumb, percent-done progress indicators should be used for operations taking more
  than about 10 seconds."* And: *"Anything slower than 10 seconds needs a percent-done indicator as
  well as a clearly signposted way for the user to interrupt the operation."*
- **Directly on tables, which is uncannily on-point for #159:** *"this is the limit from the time the
  user selects a column in a table until that column should highlight … Ideally, this would also be
  the response time for **sorting the column** … If sorting a table according to the selected column
  can't be done in 0.1 seconds, it certainly has to be done in 1 second, or users will feel that the
  UI is sluggish."*
- *"the response time guidelines for web-based applications are the same as for all other
  applications. These guidelines have been the same for 46 years now."*

References given by NN/g: Miller, R. B. (1968), *Response time in man-computer conversational
transactions*, Proc. AFIPS Fall Joint Computer Conference Vol. 33, 267–277; Card, S. K., Robertson,
G. G., Mackinlay, J. D. (1991), *The information visualizer: An information workspace*, Proc. ACM
CHI'91, 181–188; Myers, B. A. (1985), *The importance of percent-done progress indicators for
computer-human interfaces*, Proc. ACM CHI'85, 11–17.
— [NN/g, Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)

> **STILL-UNKNOWN — Miller 1968 and Card 1991 were not read in the original.** They are cited here
> *as NN/g cites them*. Do not represent this brief as having verified the primary human-factors
> literature. → VQ-7

**CONFIRMED — Google's RAIL, which explicitly derives from the NN/g page:**
- *"Response: process events in under 50ms. **Goal**: Complete a transition initiated by user input
  within 100 ms, so users feel like the interactions are instantaneous."* … *"To ensure a visible
  response within 100 ms, process user input events within 50 ms."* … *"The goal is to respond to
  input in under 100 ms, so why is our budget only 50 ms? This is because there is generally other
  work being done in addition to input handling."*
- *"Animation: produce a frame in 10 ms … Technically, the maximum budget for each frame is 16 ms
  (1000 ms / 60 frames per second ≈ 16 ms), but browsers need about 6 ms to render each frame."*
- *"Load: deliver content and become interactive in under 5 seconds … a good target for first loads
  is to load the page and be interactive in 5 seconds or less on mid-range mobile devices with slow
  3G connections."*
- The user-perception table: *"0 to 100 ms Respond to user actions within this time window and users
  feel like the result is immediate"*; *"100 to 1000 ms Within this window, things feel part of a
  natural and continuous progression of tasks"*; *"1000 ms or more … users lose focus on the task"*;
  *"10000 ms or more … users are frustrated and are likely to abandon tasks."*
- Goals vs guidelines: *"**Goals**. Key performance metrics related to user experience … Since human
  perception is relatively constant, these goals are unlikely to change any time soon.
  **Guidelines**. Recommendations that help you achieve goals. These may be specific to current
  hardware and network connection conditions, and therefore may change over time."*
— [web.dev, Measure performance with the RAIL model](https://web.dev/articles/rail)

**CONFIRMED — INP thresholds:** *"a good threshold to measure is the **75th percentile** of page
loads recorded in the field … An INP below or at **200 milliseconds** means a page has **good
responsiveness**. An INP above 200 milliseconds and below or at **500 milliseconds** means a page's
responsiveness **needs improvement**. An INP above **500 milliseconds** means a page has **poor
responsiveness**."*
— [web.dev, Interaction to Next Paint (INP)](https://web.dev/articles/inp)

**REASONING — the caveats that stop these being misapplied.** RAIL's 5 s load goal is scoped to
*"mid-range mobile devices with slow 3G"* — a desktop forensic tool over loopback is a strictly
easier environment, so 5 s is a **ceiling, not a target**. INP's thresholds are field p75 over
*page loads*, not lab p95 over a synthetic operation; borrowing the 200 ms number as a *target* is
legitimate, calling a lab result "good INP" is not.

---

## 7. Proposed budget — pin this to #159 BEFORE the generator is written

**Discipline statement.** This section was written from external sources by someone who has not seen,
written, or reviewed the #159 generator, and contains no ForensiX timing. It exists so the pass mark
can be fixed first. **If the generator's author disagrees with a number, the number changes *in this
table, on the ticket, before the run* — never after seeing results.**

### 7.1 Measurement convention (fix this too, or the numbers are not comparable)

- **Statistic: p95 over ≥30 repetitions**, plus report p50 and max. Budgets below are p95 unless
  stated. (REASONING: INP's p75 convention is a field convention; for a lab run with a small,
  controlled population p95 is the honest choice for a "does it ever feel broken" question.)
- **Clock: end-to-end, user-action to painted result** for interactive operations — not
  server-handler time. Server-only and client-only splits are *diagnostics* (§8.4), not the budget.
- **Environment: the slowest machine any team member will run the run on**, declared in the
  environment block. Budgets are not per-machine.
- **Each budget row is per row count.** A budget met at 10⁴ and missed at 10⁶ is the *answer* to
  #159's question 1, not a failure of the budget.

### 7.2 Interactive operations

| # | Operation | Class | **Target (p50)** | **Budget — FAIL above (p95)** | Sourcing |
|---|---|---|---|---|---|
| 1 | **Cold Case open** (process start → first usable view) | Load | **1 000 ms** | **5 000 ms** | Target = RAIL/NN/g "1 s = flow of thought preserved" (**SOURCED**). Budget = RAIL Load goal *"interactive in 5 seconds or less"* (**SOURCED**), applied as a ceiling because RAIL scopes 5 s to slow-3G mobile and this is local desktop (**REASONING**). Above 5 s a determinate progress indicator is required (NN/g 10 s rule applied early — **REASONING**). |
| 2 | **First keyset page** | Response | **100 ms** | **1 000 ms** | Target = RAIL *"Complete a transition initiated by user input within 100 ms"* (**SOURCED**). Budget = NN/g 1.0 s flow-of-thought limit (**SOURCED**). |
| 3 | **Deep keyset page** (page ≥ 1 000) | Response | **100 ms** | **1 000 ms** | Same sources. **Deliberately identical to row 2** — that is the point of the test. Keyset paging is O(log N) into an index (**SOURCED**, §2.2), so a deep page that costs materially more than a first page is a contract violation, not a scale limit (**REASONING**). |
| 3a | **Deep-page ratio** | Response | — | **p95(deep) ≤ 2 × p95(first)** at every row count | **REASONING** over §2.2. This is the sharpest single line in the table: it fails a regression to OFFSET even if both numbers are fast. |
| 4 | **Filter + sort**, indexed column | Response | **100 ms** | **1 000 ms** | RAIL 100 ms; NN/g 1 s. NN/g addresses table sorting by name: *"Ideally, this would also be the response time for sorting the column … If sorting a table according to the selected column can't be done in 0.1 seconds, it certainly has to be done in 1 second"* (**SOURCED**). |
| 4a | **Filter + sort**, **non-indexed** column | Response | **1 000 ms** | **10 000 ms**, and **must** show a cancellable progress indicator above 1 s | Budget = NN/g 10 s attention limit + *"Anything slower than 10 seconds needs a percent-done indicator as well as a clearly signposted way for the user to interrupt"* (**SOURCED**). The relaxation vs 4 is **REASONING** over the documented K·logK + full temp materialisation (§2.3): an un-indexed sort at 10⁶ is a different operation class and pretending otherwise just produces a failing row with no decision attached. |
| 5 | **Client render of one page** (main-thread work) | Response | **≤ 50 ms single task** | **no task > 50 ms** | web.dev: *"Any task that takes longer than 50 milliseconds is a long task"* (**SOURCED**). Measured with `PerformanceObserver({type:'longtask'})`. |
| 6 | **DOM nodes in the table body** | — | — | **≤ 1 400** | Lighthouse: warns >~800, errors >~1 400 (**SOURCED**). Implies a page-size cap; the run reports the largest page size that satisfies it (**REASONING**). |

**Cross-cutting interactive budget: peak RSS.** For every interactive operation, `maxRSS` growth
across the 10⁴ → 10⁶ arms must be **≤ 2×**. **REASONING** — keyset paging returns a bounded page, so
per-operation memory should be flat in Case size; growth means something upstream materialised the
result set (temp b-tree per §2.3, or `.all()` over an unbounded query, which #130 forbids).

### 7.3 Batch operations — a different class, argued rather than assumed

**Export and Report are not interactive operations and must not be scored against an interactive
budget.** The argument, from the sources:

- NN/g's three limits describe *dialogue* — 10 s is *"the limit for keeping the user's attention
  focused on the dialogue"*, and the prescribed remedy above it is **not** a faster operation, it is
  *"a percent-done indicator as well as a clearly signposted way for the user to interrupt"*
  (**SOURCED**). An Export of 10⁶ rows is by nature a task the investigator walks away from.
- RAIL has no batch category at all. Its four categories are response, animation, idle, load
  (**SOURCED**). Scoring an Export against "Load: 5 s" would be a category error (**REASONING**).
- **REASONING, and this is the substantive claim:** for a batch job the property that matters is not
  *how long* but *whether it is bounded and predictable*. An Export that takes 4 minutes and finishes
  is fine. An Export whose memory grows with the row count is not fine at *any* duration, because it
  fails unpredictably on the one Case that is bigger than the last one — and it fails at the end,
  after the investigator has waited. So the batch budget is **shape-based**: linearity, bounded
  memory, and honest feedback.

| # | Operation | **Budget** | Sourcing |
|---|---|---|---|
| 7 | **Export → Extract (streamed)** — memory | **`maxRSS` at 10⁶ ≤ 1.5 × `maxRSS` at 10⁴** | **REASONING** over Node's backpressure guide (**SOURCED**, §4.1): a correctly back-pressured pipeline uses *"a fixed amount of memory … at any given time"*. Flat memory is the observable signature of a correct implementation. |
| 8 | **Export → Extract** — scaling | **time(10⁶) ≤ 12 × time(10⁵)** and **time(10⁵) ≤ 12 × time(10⁴)** (i.e. ≤1.2× linear) | **REASONING.** A streamed export over an index-ordered scan is O(N) (**SOURCED**, §2.3 covering-index walk). Super-linearity means an accidental O(N²) — quadratic string concat, per-row array copy, or a per-row query. The 1.2 slack absorbs constant-factor and GC noise. |
| 9 | **Export** — no unbounded materialisation | **Hard fail** if any single JS string or array in the Export path is proportional to row count | **SOURCED** — `MAX_STRING_LENGTH` is a hard `RangeError` ceiling (§4.2); and #130's contract already forbids unbounded returns. |
| 10 | **Export / Report** — feedback | **Determinate progress with a row counter, updating at ≤1 s intervals, plus a working cancel**, whenever projected duration >10 s | **SOURCED** — NN/g percent-done rule (>~10 s) and *"clearly signposted way for the user to interrupt"*. |
| 11 | **Report generation from the Extract** — memory | **`maxRSS` ≤ 1.5 × the Export's** | **REASONING.** The Report is *"generated from the Extract and never from the Case"* (`CONTEXT.md`). It is a second streamed pass over a smaller artifact; if it costs more than the Export it is buffering the whole Extract. |
| 12 | **Report** — the rendered artifact | **A Report that embeds >1 400 table rows per page without pagination or virtualisation is a FAIL regardless of generation time** | **SOURCED** — Lighthouse DOM-size thresholds (§5.2). A Report is an HTML document an investigator opens; generating it fast and then having it hang the browser is not a pass. |
| 13 | **Case file size** | **Report only, no budget** | **REASONING.** SQLite documents a 281 TB / ~2e13-row ceiling (**SOURCED**, §2.5); nothing at 10⁶ approaches it. Bytes-per-row and the Candidates multiplier are *inputs to the Export and disk-provisioning conversation*, not a pass/fail. Setting an invented byte budget here would be exactly the sin the ticket's discipline rule forbids. |

### 7.4 The Candidates arm

Run every row above a second time with Candidates present ("roughly doubling volume", per the
ticket). **Budget: the same absolute budgets apply** — Candidates are not an excuse. **REASONING:**
a Candidate is *"a ranked possibility produced by a heuristic, carrying a count and provenance"*
(`CONTEXT.md`) and lives in the same Case; if doubling volume doubles interactive latency, paging is
not keyset-bounded and the extra rows are being scanned.

### 7.5 What each outcome means for #130 — decided in advance

| Measurement outcome | Consequence |
|---|---|
| All interactive budgets met at 10⁶, all three cost centres small | #130 stands. Columnar cache **closed permanently**. Record the numbers on #130 and close the "unmeasured 10⁶-row latency" caveat in `130-architecture-facts.md`. |
| Budgets missed, and §8.4 attributes the cost to **SQLite plan** (EQP shows `USE TEMP B-TREE`, or a missing index) | #130 stands. Fix is an index or a query rewrite. **Not** a store change. A columnar cache would be a wildly disproportionate response to a missing index. |
| Budgets missed, cost attributed to **serialisation** (object-mode row building, JSON) | #130 stands. Fix is `.raw()` + NDJSON + streaming. Still not a store change. |
| Budgets missed, cost attributed to **render** | #130 stands. Fix is page size / virtualisation / the §5.1 correctness fix. Not a store change. |
| **Only** if: SQL cost dominates, the plan is already optimal (no temp b-tree, covering index present, ANALYZE run), and the operation is an **aggregate/scan over most of the Case** rather than a page | This is the *sole* profile that matches DuckDB's own stated sweet spot (§7.6) and the only result that justifies a fresh ticket for a **derived, regenerable cache holding no Finding**, exactly as #130 scoped it. |

**REASONING — writing this table before the run is the point.** It removes the temptation to
retrofit a conclusion onto whatever the numbers turn out to be.

### 7.6 What DuckDB's own docs say about whether it would help

**CONFIRMED — DuckDB's self-description of its workload:** *"DuckDB is designed to support analytical
query workloads, also known as online analytical processing (OLAP). These workloads are characterized
by complex, relatively long-running queries that process significant portions of the stored dataset,
for example aggregations over entire tables or joins between several large tables. Changes to the
data are expected to be rather large-scale as well, with several rows being appended, or large
portions of tables being changed or added at the same time."*
— [Why DuckDB](https://duckdb.org/why_duckdb.html)

**CONFIRMED — DuckDB's documented memory expectations, which are large for a desktop tool:**
*"Aim for 1-4 GB memory per thread."* and *"As a rule of thumb, DuckDB requires a minimum of 125 MB
of memory per thread. For example, if you use 8 threads, you need at least 1 GB of memory."*
Default memory limit is *"the default 80% of the total RAM"*, adjustable via `SET memory_limit`.
— [DuckDB, Performance Guide: Environment](https://duckdb.org/docs/stable/guides/performance/environment),
[My Workload Is Slow](https://duckdb.org/docs/stable/guides/performance/my_workload_is_slow)

**CONFIRMED — a SQLite file can be read in place** via the `sqlite` extension / `sqlite_scan()`,
autoloaded on first use — [DuckDB, SQLite extension](https://duckdb.org/docs/stable/core_extensions/sqlite).

**REASONING.** DuckDB's stated profile is *"significant portions of the stored dataset"* — which is
the **opposite** of a keyset page, and the same as an Export or a dashboard aggregate. So the
measurement can only reopen #130 for aggregate/scan operations, never for paging. And an 8-thread
DuckDB wanting ≥1 GB minimum, defaulting to 80% of RAM, on an investigator's laptop that is *also*
running the Case, is a real cost that must appear in any such proposal.

**STILL-UNKNOWN — DuckDB's process/connection startup latency floor.** This run found no first-party
DuckDB documentation of a cold-start or first-query latency figure. For a desktop tool where the
whole question is interactive latency, that is a material gap in any future reopening. → VQ-8

---

## 8. Measurement design

### 8.1 What to instrument, per operation

For each of the six operations × {10⁴, 10⁵, 10⁶} × {no Candidates, Candidates} record:

1. **Wall clock**, ≥30 reps, → p50 / p95 / max, and the rep count.
2. **`EXPLAIN QUERY PLAN` text** for every SQL statement executed (§2.3). Non-negotiable.
3. **`process.resourceUsage().maxRSS`** at operation end (§4.3), plus a 100 ms poll of
   `process.memoryUsage.rss()` for the curve. State the platform's `maxRSS` units.
4. **Rows in / rows out / bytes out.**
5. **SQLite counters**: `PRAGMA page_count`, `page_size`, WAL size on disk before and after,
   and `sqlite_version()`.
6. **Client side**: `performance.mark`/`measure` around the interaction,
   `PerformanceObserver({type:'longtask'})` entries, and the table-body DOM node count.
7. **Case file size on disk**, and the Working Copy size beside it, per `CONTEXT.md`'s Case Directory
   definition — reported, not budgeted (row 13).

### 8.2 Environment block — record once, at the top of the results

`node --version` · `process.arch` · `process.platform` · `v8.getHeapStatistics().heap_size_limit` ·
`require('buffer').constants.MAX_STRING_LENGTH` · `better-sqlite3` resolved version from the
lockfile · `db.prepare('select sqlite_version()').pluck().get()` · `PRAGMA journal_mode` ·
`PRAGMA synchronous` · `PRAGMA cache_size` · `PRAGMA temp_store` · `PRAGMA mmap_size` ·
`PRAGMA page_size` · whether `ANALYZE`/`PRAGMA optimize` was run · CPU model · total RAM ·
disk type (NVMe/SATA/spinning) · filesystem · browser build for the client arm.

**REASONING.** Every one of these can move a number by more than the effect being measured. A results
table without this block cannot be reproduced or compared across machines, and should be rejected.

### 8.3 Confounders that invalidate a run

| Confounder | Why it invalidates | Control |
|---|---|---|
| **OS page cache warm/cold** | "Cold Case open" is meaningless if the Case file is already in page cache. Warm and cold can differ by orders of magnitude. | Define **cold** explicitly (fresh boot, or `purge`/`echo 3 > /proc/sys/vm/drop_caches`) and report cold and warm as **separate rows**, never averaged. |
| **WAL checkpoint state** | A large un-checkpointed WAL changes read paths and file sizes; better-sqlite3 documents unbounded WAL growth under concurrent reads (§3). | `PRAGMA wal_checkpoint(TRUNCATE)` before each arm; record WAL size before/after. |
| **ANALYZE / `PRAGMA optimize` run or not** | Documented to change plans (§2.4), and *"results … are only available to database connections that are opened after the ANALYZE command completes"* — so even the connection open order matters. | Hold constant and record. Ideally measure both arms for filter+sort. If ANALYZE is run, also record `PRAGMA analysis_limit`. |
| **Index presence** | The dominant variable for filter+sort (§2.3). | Dump the full schema including every index into the results. Report per-column which sorts are index-satisfied (EQP proves it). |
| **First-run JIT / V8 warmup** | The first iterations run interpreted/unoptimised. | Discard ≥5 warm-up reps for *steady-state* rows. Report cold-start rows (Case open) separately and **never** warm those. |
| **Node GC** | A major GC inside a timed window shows as a spike unrelated to the operation. | Report p50 *and* max, never mean. Do **not** use `--expose-gc` to force GC mid-measurement — that measures a configuration you do not ship. Record `--max-old-space-size` if set. |
| **`synchronous` / durability setting** | better-sqlite3 ships `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` (NORMAL) — a different durability *and* speed point from `FULL` (§3). | Record it. If v2.0 may ship `FULL`, measure both for any write path. |
| **Candidates arm mixed into the base arm** | Doubling volume confounds row count. | Separate arms, never interleaved. |
| **Background load** | Laptop thermal throttling, indexers, sync clients. | Declare and quiesce; report machine state. Re-run any arm whose max is >5× its p50. |
| **Client dev-server / source maps** | A CRA dev build has different render cost from a production build. | Measure the **production build only**, and say so. |
| **Generator artefacts** | Synthetic URLs of uniform length, perfectly ascending timestamps, or all-distinct values give unrealistic b-tree and sort behaviour. | Document the generator's value distributions. Skew and duplicate rates change sort and index selectivity (§2.4: the planner's "10 duplicates" default guess). |

### 8.4 Separating the three cost centres — so question 2 is not a guess

**REASONING throughout; the technique rests on the sourced facts in §2–§5.**

Use **nested probes on one code path**, each adding one layer. Time each; the differences are the
cost centres.

**Server side, four probes over the *same* SQL:**

| Probe | How | Measures |
|---|---|---|
| **P0 — plan only** | `EXPLAIN QUERY PLAN <stmt>` | Nothing timed; captures the plan (§2.3). |
| **P1 — SQLite engine only** | `stmt.pluck().iterate()` over a single indexed column, loop and discard | B-tree traversal + I/O, with near-zero JS object construction. `.pluck()` returns first column only, and is documented mutually exclusive with raw/expand (§3). |
| **P2 — engine + array marshalling** | `stmt.raw().iterate()`, loop and discard | P2 − P1 = per-row **column value marshalling into JS arrays**. |
| **P3 — engine + object construction** | `stmt.iterate()` (object mode), loop and discard | **P3 − P2 = the per-row JS object construction cost.** This is the number `better-sqlite3` does not publish (§3) and the direct answer to "is the cost serialisation?". |
| **P4 — + encoding** | P2's rows → NDJSON line → `/dev/null` writable via `pipeline` | P4 − P2 = **JSON encoding + stream cost**, separate from row building. |

**Client side, two probes:**

| Probe | How | Measures |
|---|---|---|
| **C1 — transport** | Time from request issued to response fully received, payload discarded | Network/loopback + server. |
| **C2 — render** | `performance.measure` from "data received" to the paint after commit, plus `longtask` entries and DOM node count | **Render third.** Feed C2 from a **static local fixture** as well, with no server in the path, to get render cost with zero SQL confound. |

**The arithmetic that answers question 2**, per operation and row count:

```
SQLite      ≈ P1
Serialise   ≈ (P3 − P1)  for object-mode paths, or (P2 − P1) + (P4 − P2) for the Export path
Render      ≈ C2
Attribution =  the largest of the three, reported as a percentage of end-to-end
```

**Guard-rails:**
- Every probe must run against the **same Case file, same connection settings, same rep count**.
- Report the three shares **per row count**, not once — the attribution is allowed to *change* with
  scale, and that change is itself a finding (e.g. SQLite-dominated at 10⁴, serialisation-dominated
  at 10⁶).
- If P1 ≈ P3, object construction is not the problem and no `.raw()` refactor is justified. Say so
  explicitly; a negative result here saves real work.
- If the three shares do not sum to within ~15% of end-to-end, something un-instrumented dominates
  (framework overhead, middleware, JSON parse on the client). Find it before publishing.

### 8.5 Deliverable shape

One results table per operation, rows = {10⁴, 10⁵, 10⁶} × {±Candidates} × {cold, warm}, columns =
p50 / p95 / max / maxRSS / rows / bytes / EQP-has-temp-btree (Y/N) / P1 / P2 / P3 / P4 / C2, plus the
§8.2 environment block and the §7 budget table reproduced verbatim with PASS/FAIL per cell.
**#159's question 1 is then answerable by reading down a column**, which is the whole point.

---

## 9. Prior art and realistic scale

### 9.1 Chrome History does not naturally reach 10⁶ rows

**CONFIRMED — the 90-day expiry constant, at a pinned sha:**

```cpp
  // The number of days old a history entry can be before it is considered "old"
  // and is deleted.
  static constexpr int kExpireDaysThreshold = 90;
```
— `components/history/core/browser/history_backend.h`, chromium/src @ `673a5aee77ad12e118c8edac73359acdeb7f491c`
([gitiles](https://chromium.googlesource.com/chromium/src/+/673a5aee77ad12e118c8edac73359acdeb7f491c/components/history/core/browser/history_backend.h))

**CONFIRMED — URL rows are deleted once their last visit is gone**, same sha,
`components/history/core/browser/expire_history_backend.cc`, `ExpireURLsForVisits`:

```cpp
    // Don't delete URLs with visits still in the DB, or pinned.
    bool is_pinned =
        (backend_client_ && backend_client_->IsPinnedURL(url_row.url()));
    if (!is_pinned && url_row.last_visit().is_null()) {
      // Not pinned and no more visits. Nuke the url.
      DeleteOneURL(url_row, is_pinned, effects);
    } else {
```

**CONFIRMED — expiry is rate-limited and only runs while the browser runs**, same file:

```cpp
// The number of visits we will expire very time we check for old items. This
// Prevents us from doing too much work any given time.
const int kNumExpirePerIteration = 32;

// The number of seconds between checking for items that should be expired when
// we think there might be more items to expire. ...
const int kExpirationDelaySec = 30;

// The number of minutes between checking, as with kExpirationDelaySec, but
// when we didn't find enough things to expire last time. ...
const int kExpirationEmptyDelayMin = 5;
```
with `void ExpireHistoryBackend::StartExpiringOldStuff(base::TimeDelta expiration_threshold)` as the
entry point. (Typos *"very time"* / capitalised *"Prevents"* are verbatim from the source.)

**REASONING — four consequences:**
1. `visits` is bounded to roughly the last 90 days of browsing, and `urls` shrinks with it. **10⁶
   visits in 90 days is ~11 000 visits/day, sustained.** That is not a human; it is automation, a
   shared/kiosk profile, or an aggregate of many profiles.
2. Therefore **10⁴–10⁵ is the realistic band and 10⁶ is a stress case.** Measure all three; label
   10⁶ as stress in the results; and **do not let a 10⁶-only failure alone justify an architecture
   change** — weight the decision on 10⁵.
3. **But do not treat 90 days as a hard cap on what a Case holds.** Expiry runs at ≤32 visits per
   30 s and only while Chrome is running, so a profile seized from a machine that has been off, or
   one whose Chrome rarely ran, can carry far more than 90 days. And a ForensiX Case can hold rows
   from **multiple Sources** (`CONTEXT.md`), which multiplies freely. 10⁶ across a Case is reachable
   by aggregation even though it is not reachable in one fresh History file.
4. **Forensically, the expiry itself is the interesting fact** — 90 days is a *floor on absence*, not
   evidence of deletion. That belongs on a Field State / interpretation ticket, not this one, but it
   should not be lost.

**STILL-UNKNOWN — real-world Chrome History row-count distributions.** No first-party Chromium
telemetry or documentation giving observed `urls`/`visits` row counts in the field was located. The
90-day bound is an upper-bound *mechanism*, not a measured distribution. → VQ-9

### 9.2 Prior art in DFIR — nothing published

**STILL-UNKNOWN — Hindsight publishes no scale limits, row counts, or performance notes.** Searching
the canonical repo (`RyanDFIR/hindsight`, which `obsidianforensics/hindsight` resolves to), its
release notes and `dfir.blog/hindsight/` surfaced feature and format documentation only — no
documented maximum profile size, no row-count guidance, no timing figures. A release note states
*"Things should generally run better and faster"* (v20200607, the Python-3 port) with no numbers.
→ VQ-10

**REASONING, and it is a genuinely useful negative.** The closest comparable first-party tool in
this space publishes **no** performance contract at all. So (a) there is no external benchmark to
calibrate ForensiX against, which strengthens the case for #159's own budget being sourced from
human factors rather than from a competitor; and (b) if ForensiX publishes measured scale limits, it
would be doing something its nearest neighbour does not. That is worth stating in the v2.0 Report
and Completeness Statement conversation.

Note also the already-landed finding in `130-architecture-facts.md`: Hindsight's GUI **re-derives**
the analysis rather than reading the CLI's artifact, so it has no "open a large existing artifact"
path whose latency could even be compared to a ForensiX cold Case open.

---

## 10. Verification queue — ranked by blast radius

| # | Claim / gap | Blast radius | What to check | Where |
|---|---|---|---|---|
| **VQ-1** | **material-table 1.x client-side filter/sort applies only to the array it holds — under keyset paging that is ONE PAGE.** Confirmed in library source; **not** confirmed against ForensiX's actual view code. | **HIGHEST — correctness of a forensic view, not performance.** If true in-repo, filtered/sorted views mislead the investigator about the Case. | Read the per-artifact view components; determine whether `filtering`/`sorting` props are handled by material-table locally or delegated to the server. Raise as a bug **before** #159's run if local. | `client/src/**` + [`data-manager.js`](https://raw.githubusercontent.com/mbrn/material-table/master/src/utils/data-manager.js) |
| **VQ-2** | Per-row JS object construction cost in `better-sqlite3` (`.all()`/`.iterate()` vs `.raw()`) at 10⁴–10⁶ rows. Direction documented, **magnitude undocumented**. | HIGH — it is one third of #159's question 2, and unsourceable. | Measure via §8.4 probes P1/P2/P3. Also read `benchmark/` in the repo to confirm no large-N case exists. | [docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md), [benchmark.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/benchmark.md) |
| **VQ-3** | Bundled SQLite version and minimum Node for `better-sqlite3` **12.2.0** (docs here were read at `master` = 13.0.3, `engines.node >= 22`). | HIGH — SQLite version changes planner behaviour and defaults (e.g. `PRAGMA optimize` scope-limiting landed 3.46.0). | `db.prepare('select sqlite_version()').pluck().get()` in the run; read the v12.2.0 tag's `package.json` and `deps/`. | repo tag `v12.2.0` |
| **VQ-4** | Whether `better-sqlite3` caches prepared statements, or ForensiX must. | MEDIUM — a per-request `prepare()` is a fixed cost per operation that would show up in P1 and be misattributed to SQLite. | Read `lib/` in the library; then check ForensiX's data-access layer for statement reuse. | library `lib/`, `server/**` |
| **VQ-5** | Node's default V8 heap limit for the run's Node version (docs publish the flags, not a default table). | MEDIUM — decides whether a 10⁶ arm OOM is a ForensiX fault or a config default. | `node -p "require('v8').getHeapStatistics().heap_size_limit"`; record in §8.2. | [CLI docs](https://nodejs.org/api/cli.html) |
| **VQ-6** | Whether React 16 legacy rendering makes a large page render one unyieldable long task. | MEDIUM — bounds the achievable page size (budget row 5). | React official docs on 16 vs 18 scheduling; confirm with `longtask` observer in C2. | react.dev |
| **VQ-7** | Miller (1968) and Card et al. (1991) — cited **as NN/g cites them**, not read in the original. | MEDIUM — the budget's provenance chain. If a decision memo cites Miller 1968, read Miller 1968. | AFIPS FJCC 1968 Vol. 33, 267–277; ACM CHI'91, 181–188. | ACM DL |
| **VQ-8** | DuckDB startup / first-query latency floor on a desktop. Not found in first-party docs. | MEDIUM — only bites if §7.5's last row ever triggers. | DuckDB docs + release blog; failing that, measure. | [duckdb.org/docs](https://duckdb.org/docs/) |
| **VQ-9** | Real-world Chrome History row-count distribution (the 90-day bound is a mechanism, not a measurement). | MEDIUM — decides how much weight the 10⁶ arm carries in the v2.0 decision. | Chromium telemetry/histograms for History DB size, if any are public; otherwise sample real captures (`research/artifacts/117-chrome151-macos/`). | chromium source / repo fixtures |
| **VQ-10** | Hindsight (or any comparable first-party DFIR browser tool) publishing scale limits. Searched, **none found**. | LOW — a negative result, but confirming it strengthens §9.2. | Grep the repo's README/docs/releases directly rather than via search. | [RyanDFIR/hindsight](https://github.com/RyanDFIR/hindsight) |
| **VQ-11** | Exact V8 `String::kMaxLength` and the version it changed at. Fetched `string.h` and `v8-primitive.h`; constant not located in retrieved content. | LOW — the operational value is one command away, and the design conclusion (NDJSON) does not depend on it. | `node -p "require('buffer').constants.MAX_STRING_LENGTH"`; then locate `kMaxLength` in V8 at a pinned sha. | [v8 source](https://chromium.googlesource.com/v8/v8/) |
| **VQ-12** | Attribution of the OFFSET forum quote (Gunter Hick — contributor, maintainer status unconfirmed). | LOW — the mechanism is independently confirmed in `src/select.c`. | Cite `codeOffset()`, not the forum post, in any decision memo. | [select.c](https://raw.githubusercontent.com/sqlite/sqlite/master/src/select.c) |

---

## 11. One-paragraph handover to whoever runs #159

Pin **§7's budget tables** to the ticket first, unchanged, and get them agreed before the generator
exists — that is the discipline rule satisfied. Then build the generator to §8.2's environment block
and §8.3's controls, and instrument §8.4's five server probes and two client probes, because without
them "where is the cost" is a guess and question 2 goes unanswered. Capture `EXPLAIN QUERY PLAN` for
every statement or the numbers are unexplainable. Expect the deep-page and Export rows to pass if
#130's contract is honoured, and treat any failure there as a contract regression rather than a
scale limit. Expect the non-indexed filter+sort row to be the one that fails first, and expect the
fix to be an index rather than a database. And before any of it, check VQ-1 — if material-table is
filtering a single page and presenting it as the Case, that outranks every millisecond in this
document.
