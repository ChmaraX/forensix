# scale-bench — ChmaraX/forensix#159

Measures Case query and Export latency at 10⁴, 10⁵ and 10⁶ synthetic History rows, against the
interactive/batch budget pinned to the ticket **before** this harness was written (see
[research/159-scale-and-latency-evidence.md](../../research/159-scale-and-latency-evidence.md) §7
and the ticket comment that pins it verbatim — the same generator-author-≠-pass-mark-author
discipline #137 used).

**Results: [`results/results.md`](results/results.md)** — generated code output, nothing hand-typed.
Raw data: `results/results.json`.

## What it measures

Six operations from the ticket — cold Case open, first keyset page, deep keyset page, filter+sort
(one indexed column, one deliberately not), streamed Export → Extract, and HTML Report generation
from that Extract — each at 10⁴/10⁵/10⁶ `visits` rows, with and without a `candidates` table present
(the "roughly doubles the volume" arm). Plus §8.4's five-probe cost-attribution pass (P0 EQP, P1
engine-only, P2 raw arrays, P3 objects, P4 NDJSON) that separates SQLite cost from JS
serialisation cost.

## Schema

`urls`/`visits` are Chrome's own DDL (verified against `research/118-chrome-artifacts-today.md`,
itself live-sourced from Chromium) — the ticket asks about "History rows", and History's own schema
is what's on disk in a real Case. `candidates` is new: a v2-shaped table per `CONTEXT.md` and
#123/#139/#160's settled rule that Candidates never share a table with Findings and carry rank,
count and provenance. See `harness/schema.js`.

Generated data is deliberately **not uniform** (research doc §8.3's confounder-control list): a
Zipf-skewed domain distribution, jittered (never perfectly ascending) timestamps within a 90-day
window (Chromium's own history-expiry bound, §9.1), and a skewed `visit_duration`. Deterministic per
`(rows, seed)` via a seeded PRNG — re-running `harness/gen_case.js` reproduces the same Case.

## Running it

```sh
npm install
npm run bench     # full matrix: 10^4/10^5/10^6 x {plain, candidates} x 8 ops, ~2-3 min
npm run report    # results/results.json -> results/results.md
```

`SCALE_BENCH_ONLY="100000:candidates" npm run bench` runs a single (rows, arm) combination — useful
for iterating on the harness itself without paying for the full matrix.

`data/` (generated Case files, NDJSON extracts, HTML reports — up to ~1 GB across the full matrix)
and `harness/node_modules/` are gitignored. `results/` is committed; it's the evidence.

## Design notes worth knowing before reading the results

- **maxRSS isolation.** Every measurement runs in its own child process (`harness/op_runner.js`),
  because `process.resourceUsage().maxRSS` is a monotonic high-water-mark for the process's whole
  life — it cannot be reset or attributed to one phase within a long-lived process. `export` and
  `report` (the two ops whose *ratio* budgets are memory-sensitive at already-small absolute
  baselines) additionally run as 3 independent-process trials, keeping the median, because
  background load moves these ratios measurably between runs (research doc §8.3).
- **maxRSS units were measured, not trusted from docs.** Node's docs say bytes on Darwin, KiB on
  Linux; empirically allocating a 200 MB buffer and comparing against `process.memoryUsage().rss`
  showed KiB on this Node build on macOS too. Recorded in `harness/environment.js` as measured.
- **"Cold" open is connection-cold, not OS-page-cache-cold.** Dropping the page cache cross-platform
  without root wasn't attempted — flagged as a limitation, not hidden.
- **EQP is captured for every timed query**, not just the ones expected to be interesting — the
  research doc calls a latency number without its query plan unanswerable.
