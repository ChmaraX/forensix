# 130 — Two facts that the architecture decision rested on

Both were fetched while resolving [Architecture decision](https://github.com/ChmaraX/forensix/issues/130).
Both were named in that ticket's own comment as its softest joints. One broke.

Primary sources only. Statements are marked CONFIRMED or STILL-UNKNOWN.

---

## Fact 1 — Hindsight's web GUI re-derives the analysis. It does not read the CLI's artifact.

This closes verification-queue item 3 of the [#129 brief](./129-product-shape-survey.md), which called it
"the closest thing the brief has to a precedent for this exact layering".

Source: `hindsight_gui.py` and `hindsight.py`, raw `master`, `RyanDFIR/hindsight` (the canonical repo;
`obsidianforensics/hindsight` resolves there).

1. **CONFIRMED — the GUI runs the analysis pipeline, it is not a file reader.**
   `hindsight_gui.py` imports `from pyhindsight.analysis import AnalysisSession`, with the module-global
   comment *"This will be the main pyhindsight.AnalysisSession object that all the work will be done on"*.
   `main_screen()` does `analysis_session = AnalysisSession()`, and `POST /run` does:

   ```python
   run_status = analysis_session.run()
   if run_status:
       analysis_session.run_plugins()
   ```

   The CLI's `main()` does the same. GUI inputs are **live source paths** —
   `analysis_session.input_path = bottle.request.forms.get('profile_path')`, plus `cache_path`,
   `temp_dir`, `no_copy` — i.e. a raw browser profile, never a Hindsight output file.

2. **CONFIRMED — binds to loopback, with the reason recorded in-source.**

   ```python
   bottle.run(host='localhost', port=8080, debug=True)
   ```

   Preceded verbatim by: *"SECURITY: bind to localhost only. … Do NOT change host to 0.0.0.0 (or
   otherwise expose it): combined with running at a higher privilege than the requester, it turns those
   operator-supplied paths into a genuine arbitrary-file-read (CWE-22). See dismissed code-scanning
   alert py/path-injection."*

3. **CONFIRMED — same writer as the CLI.** GUI route `/sqlite` calls
   `analysis_session.generate_sqlite(temp_output)`; the CLI's `write_sqlite()` calls the same method.
   Same for `/xlsx` (`generate_excel`) and `/jsonl` (`generate_jsonl`). So the *schema* is shared. The
   *artifact* is not: each front-end produces its own.

4. **CONFIRMED — no read-an-existing-artifact mode.** The complete route table is `/static/<filename>`,
   `/`, `POST /run`, `/error`, `/results`, `/sqlite`, `/xlsx`, `/jsonl`, `/sqlite-view`. None accepts an
   upload or a path to a prior output. `/sqlite-view` renders `analysis_session.__dict__`, i.e. the
   in-memory session.

**Gap:** `pyhindsight/analysis.py::generate_sqlite` was not opened, so "same schema" rests on both
front-ends calling one method rather than on a schema diff. Line numbers are not cited because the
capture is of `master`, which drifts.

### What this changed

The conclusion of #130 survived; its precedent did not. The seam-as-a-file pattern is re-based on the
Eric Zimmerman tools (`EvtxECmd` → `Timeline Explorer`), which are separate programs over a durable
artifact. Hindsight is recorded in #130 as a **third shape, deliberately rejected**: two front-ends that
both re-derive means two runs and two sets of numbers, so "which run does the Report cite" has no answer.

The CWE-22 note is a better citation than the #129 brief's STILL-UNKNOWN on bind address, and is carried
into [#131](https://github.com/ChmaraX/forensix/issues/131).

---

## Fact 2 — DuckDB is not fit to hold the Case. SQLite is.

This closes verification-queue item 2 of the #129 brief (DuckDB captured but unmined).

| Axis | SQLite | DuckDB |
|---|---|---|
| Published format spec | full `fileformat2.html`, third-party readers exist | **header bytes only** — `uint64_t` checksum, magic `DUCK`, `uint64_t` storage version. No specification section |
| Archival endorsement | Library of Congress recommended format | **none.** The project's only long-term-persistence statement recommends **Parquet**, not its own format |
| Forward compatibility | old versions read newer files | *"Forward compatibility is provided on a **best effort** basis … may be (partially) broken on occasion"* |
| Backward compatibility | contractual, to 2004 | a stated *goal*, and only from v0.10 (Feb 2024). Storage version moved 64 → 68 across v1.1 → v1.5 |
| Multi-process | WAL: readers concurrent with one writer | *"Read-write mode: one process… Read-only mode: multiple processes can read… but no processes can write."* Multi-writer needs the Quack protocol, beta as of v1.5.2 |
| Node client | `node:sqlite` built in, or `better-sqlite3` | `@duckdb/node-api`, community maintainer, **8 per-platform native prebuilds**, published roadmap gaps |
| Licence | public domain | MIT, guaranteed in perpetuity by foundation statutes |
| Columnar analytics | weaker | stronger |

Sources: DuckDB [Storage Versions and Format](https://duckdb.org/docs/current/internals/storage.html),
[Concurrency](https://duckdb.org/docs/current/connect/concurrency.html), [FAQ](https://duckdb.org/faq),
[Client Overview](https://duckdb.org/docs/current/clients/overview.html),
[Node Neo](https://duckdb.org/docs/current/clients/node_neo/overview.html),
[duckdb-node-neo](https://github.com/duckdb/duckdb-node-neo),
[Benchmarking Ourselves over Time (2024)](https://duckdb.org/2024/06/26/benchmarks-over-time.html).

### What this changed

Two rows are disqualifying rather than unfavourable, and both are structural:

1. **No concurrent reader-while-writer across processes.** `forensix ui` appends a Finding while a
   command reads the same Case. DuckDB cannot; SQLite in WAL mode is built for it. **The store choice and
   the seam choice are one decision, and DuckDB fails the coupling.**
2. **Eight native prebuilds** collide with the single-file distribution goal, and #129 already recorded
   that native addons are the worst thing to place inside a Node SEA.

DuckDB is therefore out of v2.0 entirely — not held as a likely optimisation. If the unmeasured
10⁶-row latency ever forces a columnar path, it returns as a derived, regenerable cache that holds no
Finding, through a fresh ticket.

**Gap:** the SQLite side was taken from the #129 brief and not re-verified this pass. If a decision
memo cites Library-of-Congress status, verify at `sqlite.org/locrsf.html` and `sqlite.org/fileformat2.html`.
The #129 brief's own use of that quote is weak — it is sourced from SQLite's marketing page — and the
Mongo-dies argument does not need it.
