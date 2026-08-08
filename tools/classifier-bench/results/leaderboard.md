# Classifier bench leaderboard — ChmaraX/forensix#137

> **No winner is declared in this artifact.** This is a results table, not a decision.
> The decision belongs to [#126](https://github.com/ChmaraX/forensix/issues/126), reading
> these numbers. Sorted by macro-F1 for readability only.

Generated `2026-08-08`, machine-readable source: `results.json`.
Host: `linux/arm64` (Docker Desktop, native), Node `v22.23.2`.

## Ground truth

208 rows, 20-label taxonomy (`../taxonomy.json`, sourced from `research/137-taxonomy-proposal.md`).
**Deviation from #137's 500+ row target, logged not hidden** — see
`../fixture/LABELLING-GUIDE.md`. 4 of 20 labels have zero gold rows in this fixture
(`gambling`, `adult_sexual_content`, `cryptocurrency_exchanges`, `employment_job_seeking`)
and are excluded from macro-F1 — reported as "no test rows available", not scored as 0.

## Results

| Candidate | Family | Macro-F1 (16/20 scored) | Coverage | Adult FP/FN | rows/sec | proj. 100k-row | Disk footprint | Deterministic (same-arch) | Deterministic (cross-arch) |
|---|---|---|---|---|---|---|---|---|---|
| **domain-list-v1** | 5 — deterministic domain list | **0.338** | 44.2% | 0/0 (no Adult rows in fixture) | 232,999 | 0.43 s | N/A (inline code) | ✅ yes | ✅ yes |
| **potion-base-2M-labelsim-v1** | 3b — zero-shot embedding + label-name similarity | **0.073** | 11.5% | 0/0 (no Adult rows in fixture) | 4,349 | 23.0 s | 7.87 MB | ✅ yes | ⚠️ **28/208 (13.5%) row embeddings differ bit-for-bit** — see note below |

## Reading this table

- **Coverage ≠ accuracy.** Domain-list's 44.2% coverage means it abstains on 55.8% of rows
  (any domain not in its curated global-brand list) — by construction, not failure. Its
  accuracy *on the rows it does cover* is high (several labels hit precision 1.0 — see
  `results.json` `per_class`); it is simply narrow. This is the "how much does a plain list
  already cover" number #119/#136 flagged as unmeasured, now measured: **on this fixture,
  under half.**
- **potion-2M's 32.7% raw top-1 accuracy (before any abstention) is a genuinely weak
  result**, not a harness bug — verified by direct inspection (see the bench conversation).
  It is the cheapest, weakest-supervision point in the whole design space: an 8 MB static
  embedding model matched only against bare 2–5 word label *names*, zero exemplars, zero
  training. The 11.5% coverage number reflects an abstain margin (0.15) chosen without
  calibration; `results.json`'s `coverage_accuracy_sweep` field shows the full tradeoff
  curve across 7 thresholds, which is the artifact #137 §3 actually asked for — a single
  headline number here would hide the real shape of the tradeoff.
- **Cross-arch determinism finding corrects the prior spike.**
  `tools/classifier-bench/spike/SPIKE-REPORT.md` found bitwise cross-arch identity for
  Model2Vec/potion-2M using one fixed test string and generalised the result
  architecturally. Measured here on the realistic input distribution (208 real title+URL
  strings): **13.5% of raw embedding vectors are not bitwise-identical between native
  arm64 and QEMU-emulated amd64.** It does not correlate simply with input length. On
  *this* fixture the divergence never flipped an actual label decision (aggregate
  macro-F1 and coverage are identical arm64 vs amd64) — but that is an empirical
  observation on 208 rows, not a proof it holds at 100k-row scale. Treat family 3b's
  cross-arch determinism as **unresolved for realistic inputs**, not confirmed.
- **Both candidates are same-arch deterministic** (identical SHA-256 across two
  independent processes on the same architecture) — the weaker, still-useful guarantee.

## Guardrail status

Contamination guard ran for both candidates; zero violations, because neither declares an
exemplar corpus (domain-list: hand-curated global-brand rules, documented as excluding
every fixture-only niche domain; potion-embedding: zero-shot against label names only,
no training data of any kind). See `../fixture/LABELLING-GUIDE.md` for why this sidesteps
the exemplar/test-set-author contamination question entirely rather than resolving it.

## What this run does NOT tell you

- Only 2 of #136's 6 shortlisted candidates ran (minimum requirement was 2 families; met,
  not exceeded). `bge-micro-v2`, `all-MiniLM-L6-v2`, `nli-deberta-v3-xsmall`, and a
  Curlie-exemplar version of the embedding tier are not benched here.
- No labels have gold rows for `gambling`, `adult_sexual_content`,
  `cryptocurrency_exchanges`, `employment_job_seeking` — **the single most forensically
  sensitive label (Adult) has zero test coverage in this fixture.** Any claim about
  Adult-content detection accuracy from this bench run would be fabricated.
- Zero non-English rows tested.
- Single labeller (model, owner-approved deviation), no inter-rater check.
