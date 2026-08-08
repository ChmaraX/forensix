# Research: Classifier evaluation harness and labelled ground truth (ChmaraX/forensix#137)

> **File location note.** Following the convention #136 established for the same conflict:
> the issue text names `docs/research/137-harness.md`; this file follows the repo's actual
> convention, `research/NNN-slug.md`, on branch `research/wayfinder-v2`.

> **No winner is declared in this brief**, per the issue's explicit rule. This document
> records what was built and measured. The decision belongs to
> [#126](https://github.com/ChmaraX/forensix/issues/126).

## Summary

Built the harness (`tools/classifier-bench/`) and a 208-row labelled ground-truth fixture
from three real Chrome profiles, ran it end-to-end against two candidates spanning two
approach families (family 5 deterministic domain list, family 3b zero-shot embedding
similarity), inside an isolated two-phase Docker container (network-on fetch, then
`--network none` inference), and produced a machine-readable results table plus a
markdown leaderboard. One measured finding **corrects** a claim in the prior spike
(`tools/classifier-bench/spike/SPIKE-REPORT.md`) rather than confirming it further.

**Deviations from the issue's requirements, logged explicitly rather than silently
accepted** — see "Deviations" below. The most consequential: 208 rows, not 500+, and only
2 of 6 shortlisted candidates ran.

## 1. Taxonomy

`tools/classifier-bench/taxonomy.json` — 20 core labels (fixed, multi-label,
`unclassified` mandatory) + 5 opt-in overlay labels, sourced from
`research/137-taxonomy-proposal.md` §3. That proposal itself surveyed ten external
category systems (UT1, FortiGuard, Talos, Cloudflare, IAB, Chrome's Topics API, Curlie,
WebOrganizer, Magnet AXIOM, Autopsy) before the taxonomy was frozen — see that file for
the full survey and decision log.

## 2. Ground truth — provenance and construction

**Sources** (all facts CONFIRMED against live S3 listings; full detail in
`research/_raw/137-chromebook-recon.md` and `research/_raw/137-takeout-recon.md`):

| Source | S3 key | SHA-256 | Rows contributed |
|---|---|---|---|
| Magnet 2021 Chromebook CTF, `History` SQLite (`visits ⟶ urls` join) | `corpora/scenarios/magnet/2021 CTF - Chromebook.tgz` | `67211e1a...` (archive), `c6206acd...` (extracted `History` file) | 130 |
| Magnet 2021 Takeout, `BrowserHistory.json` | `corpora/scenarios/magnet/2021 CTF - Takeout.zip` | `a84314a8...` | 48 |
| Magnet 2022 Takeout, `BrowserHistory.json` | `corpora/scenarios/magnet/2022 CTF - Takeout.zip` | `800e0b74...` | 30 |
| **Total distinct `(title, url)` rows after dedup** | | | **208** |

All three sources are staged-but-real Chrome browsing from Digital Corpora's public,
Magnet-Forensics-sponsored CTF corpus (`digitalcorpora.org`) — real Chrome output (Chrome
76.0.3809.136 on the Chromebook), fictional/CTF personas confirmed via `Profile.json`
(Simsons-derived and CTF-convention names), zero real PII. 709 raw rows collapsed to 208
distinct rows on dedup by `(title, url)` — heavier real-world URL-variant overlap than
estimated (one Gmail session alone produces 8 URL variants of the same "Inbox" title).

**Extraction method:** everything — download, SHA-256, `tar`/`unzip` extraction, SQLite
read, JSON parse — ran inside disposable `debian:bookworm-slim` Docker containers with
scratch volumes destroyed after use, per the ticket's environment-isolation concern.
Deterministic re-extraction commands are printed in full in
`research/_raw/137-chromebook-recon.md` §"Deterministic re-extraction commands".

**Normalisation and dedup:** `tools/classifier-bench/fixture/fixture_raw.json`, produced
by a Python normaliser run inside the same container family (join Chromebook
`visits⟶urls`, parse both `BrowserHistory.json` files, dedup by exact `(title, url)`,
stable `row_id` = first 12 hex chars of `sha256(title + "\0" + url)`). Every row carries
`provenance` (source key, source URL, SHA-256, extraction path).

## 3. Labelling

`tools/classifier-bench/fixture/fixture_labelled.json` — all 208 rows labelled against
the 20-label taxonomy. Full method, boundary-rule decisions, and the list of open gaps in
`tools/classifier-bench/fixture/LABELLING-GUIDE.md`. Headline points:

- **Labeller of record: Fable (model), not a human** — an explicit, owner-approved
  deviation from the issue's "labelled by a human" instruction. Mitigation: neither
  candidate benched here consumes exemplar/training data of any kind (see §5), so there
  is nothing for the labeller's priors to leak into on the candidate side — the
  contamination trap the issue documents (test-set author = exemplar author) cannot occur
  in this run regardless of who labelled the test set.
- **Rule-based and auditable**, not free per-row judgment: every label traces to a named
  rule in `tools/classifier-bench/scripts/label_fixture.py`, re-runnable and diffable.
- 16 of 208 rows (7.7%) flagged `ambiguous: true` for a genuinely defensible
  multi-label boundary (sharpest case: COVID-era travel-restriction rows, simultaneously
  `travel_transport_accommodation` and `health_medical`).
- **4 of 20 core labels have zero gold rows** in this fixture: `gambling`,
  `adult_sexual_content`, `cryptocurrency_exchanges`, `employment_job_seeking`. These CTF
  personas never generated that browsing. Per-class F1 is reported as "no test rows
  available" for these labels, never as a fabricated score.

## 4. Harness design

`tools/classifier-bench/harness/` — candidate-agnostic per #137 §2:

- **Adapter interface**: `predict(row, normalisedInputText) → { labels: [...], top1, topScore }`.
  Any candidate implements this without the harness knowing its architecture.
- **Fixed input normalisation** shared by every candidate: `title.trim() + " " + url.trim()`
  (`lib/fixture.js`), so all candidates see byte-identical input.
- **Warm-up pass excluded from timing** — one untimed `predict()` call before the timed loop.
- **One command in, results table out**: `node run_bench.js` (inside the container) reads
  the fixture and taxonomy once, runs every registered candidate, writes `results.json`.
- **Two-phase Docker**, extending `tools/classifier-bench/spike/`'s proven design:
  - Phase A (`download.js`, network on): fetch + SHA-256 every model artifact.
  - Phase B (`run_bench.js`, `--network none`): tokenise, infer, score — fully offline.
- **Determinism check**: every candidate runs twice per invocation; predictions are
  JSON-hashed (SHA-256) and compared. Reported per candidate, per architecture.
- **Contamination guard** (`contaminationGuard()` in `run_bench.js`): fails the run if any
  candidate declares an exemplar whose URL or eTLD+1 domain appears in the fixture. Runs
  for both candidates in this pass; both declare zero exemplars, so it is a no-op by
  construction here — it is real, auditable code, not assumed away, so a future
  exemplar-based candidate (e.g. Curlie-supervised) is covered without harness changes.

## 5. Candidates run

Two families, meeting the issue's "at least two different approach families" minimum
(not exceeding it — see Deviations).

### `domain-list-v1` — family 5 (deterministic domain list)

Hand-curated mapping of ~40 **globally well-known brand domains** (Gmail, Facebook,
YouTube, Amazon, GitHub, LinkedIn, Coinbase, bet365, PornHub, Wikipedia, etc.) to core
labels — the same class of entry a real UT1/FortiGuard/Talos list ships. Deliberately
**excludes every niche/long-tail domain visible in the fixture** (vineyardvines.com,
chick-fil-a.com, aidungeon.io, wickr.com, healthvermont.gov, …) — including those would
make the "candidate" circular with how the fixture itself was labelled, since the same
labeller read those domains to write the fixture's rules. Unmatched rows abstain by
construction; this is realistic list-tier behaviour, not a gap to fix.

### `potion-base-2M-labelsim-v1` — family 3b (zero-shot embedding + label-name similarity)

Reuses the spike's proven ONNX plumbing (`tools/classifier-bench/spike/embed.js` →
extracted to `harness/lib/potion_engine.js`) unmodified in its tokeniser/inference
contract. Embeds each of the 20 core label **names** once (e.g. `"Webmail, Messaging &
Voice"`) and every fixture row's normalised text; predicts the nearest label by cosine
similarity (dot product — potion embeddings are pre-L2-normalised); abstains to
`unclassified` if the top-1/top-2 margin is below 0.15. **Zero exemplars, zero training
data of any kind** — "Supervision needed: None for label-name similarity" per
`research/136-approach-survey.md`'s family-3 row. This is the cheapest, weakest-
supervision point in the whole design space, by design.

## 6. Results

Full machine-readable table: `tools/classifier-bench/results/results.json`.
Rendered leaderboard with the required "no winner" banner:
`tools/classifier-bench/results/leaderboard.md`.

| Candidate | Family | Macro-F1 (16/20 scorable labels) | Coverage | rows/sec (native arm64) | Disk footprint | Same-arch deterministic | Cross-arch deterministic |
|---|---|---|---|---|---|---|---|
| `domain-list-v1` | 5 | 0.338 | 44.2% | 232,999 | N/A (inline code) | ✅ | ✅ |
| `potion-base-2M-labelsim-v1` | 3b | 0.073 | 11.5% | 4,349 | 7.87 MB | ✅ | ⚠️ see Finding below |

Environment recorded per run: host `linux/arm64` and `linux/amd64` (QEMU-emulated),
Node `v22.23.2` (container) / `v24.11.1` (host sanity check, results matched), ORT
`1.21.0`, Docker image digests `sha256:d6a9ca97...` (arm64), `sha256:cf2c6610...` (amd64).
Model artifact SHA-256s match the spike's exactly (`92d4a757...` for `onnx/model.onnx`).

### Finding: cross-arch bitwise determinism does NOT hold universally for family 3b — corrects the spike

`tools/classifier-bench/spike/SPIKE-REPORT.md` §6 found bitwise-identical potion-2M
embeddings across native arm64 and QEMU-emulated amd64, for **one fixed test string**,
and generalised the result architecturally ("no attention kernels, no int8 dequant" ⇒
deterministic by construction). This harness re-ran that comparison across the full
208-row realistic input distribution and found:

- **28 of 208 row embeddings (13.5%) are NOT bitwise-identical** between arm64 and amd64.
- The divergence does **not** correlate simply with input length (a 131-char and a
  658-char string appear on both sides of the split).
- **No decision-level impact was measured on this fixture** — aggregate macro-F1 and
  coverage are identical arm64 vs amd64, meaning the differing float bits never crossed a
  top-1 or abstain-margin decision boundary for these particular 208 rows. This is an
  empirical observation on a small fixture, not a proof that it holds at 100k-row scale
  or for a different taxonomy's label-name anchor set.

Root cause not isolated in this pass (time-boxed). Hypothesis: a data-dependent
EmbeddingBag/graph-optimisation code path in ONNX Runtime, not the pure
lookup-and-mean computation the spike's architectural argument assumed. This should be
treated as **open**, not resolved, for #136 Gap 6 as it pertains to realistic inputs —
the spike's confirmation stands only for the specific string it tested.

## 7. Deviations from the issue's requirements — logged, not hidden

| Requirement | What happened | Why |
|---|---|---|
| 500+ ground-truth rows | **208 rows** | Real-world URL-variant dedup collapsed the available public-corpus source harder than estimated (709 raw → 208 distinct). Owner decision: ship 208 rather than continue the source hunt — see conversation log. |
| Stratified: non-English titles | **Zero non-English rows** | All three available CTF personas browsed in English. Not fixed in this pass. |
| Multiple profiles | **3 personas, one corpus family (Magnet CTF)** | Same practical constraint as above. |
| Labelled by a human | **Labelled by Fable (model)**, owner-approved | See §3. Mitigated by both candidates using zero-exemplar supervision, so the specific contamination mechanism the issue warns about cannot occur here regardless. |
| Run ≥2 approach families | **Exactly 2 ran** (families 5 and 3b) of #136's 6-candidate shortlist | Time-boxed; families 1 (no off-the-shelf candidate exists per #136 Finding 6), 2 (entailment, 14–20× cost), and the contextual-transformer variants of family 3 (`bge-micro-v2`, `all-MiniLM-L6-v2`) are not benched. Meets the issue's stated minimum, does not exceed it. |
| Adult-content FP/FN called out both directions | **Cannot be measured** — 0 Adult-labelled rows in the fixture | Reported as "no test rows available" in every artifact, never fabricated as a 0% error rate. This is the single most consequential coverage gap in the fixture: the most forensically sensitive label has no ground truth here at all. |
| Disk footprint from real file listing | **Done** for the model-backed candidate (7.87 MB, `du -sb` inside the container); domain-list has no model artifacts to measure | — |

## 8. Reproducing this run

```bash
cd tools/classifier-bench
docker volume create bench-artifacts && docker volume create bench-results
docker build --platform linux/arm64 -f harness/Dockerfile -t classifier-bench:arm64 .
docker run --rm --platform linux/arm64 \
  -v bench-artifacts:/artifacts classifier-bench:arm64 node download.js
docker run --rm --platform linux/arm64 --network none \
  -v bench-artifacts:/artifacts:ro -v bench-results:/results \
  -e ARTIFACTS_DIR=/artifacts -e RESULTS_DIR=/results \
  classifier-bench:arm64 node run_bench.js
```

Expected model artifact SHA-256 (`onnx/model.onnx`): `92d4a7576de7d39055924b4d9d3979c8c3b2de272010f76f99e2ac14c7b2e5a8`.

## 9. What #126 still needs before it can decide

- The 4 candidates from #136's shortlist not run here, particularly the contextual
  embedding tier (`bge-micro-v2`, `all-MiniLM-L6-v2`) and an exemplar-supervised
  (Curlie-sourced) version of the embedding candidate — the zero-shot result here is a
  lower bound, not a ceiling, on family 3's achievable accuracy.
- Adult-content accuracy: genuinely unmeasured, not just low. A ground-truth top-up
  targeting this label specifically is higher priority than growing the fixture toward
  500 rows generically.
- Non-English coverage.
- Root-caused cross-arch determinism for family 3b before treating #136 Gap 6 as closed
  for realistic inputs.
