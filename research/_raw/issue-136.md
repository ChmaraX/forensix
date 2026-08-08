# Issue #136: Short-text classification approaches for title + URL

## Question

What are the approaches for classifying a browsing-history entry from **page title + URL together**, and which candidates survive v2's constraints?

[URL classifier replacement options](https://github.com/ChmaraX/forensix/issues/119) answered a different question and its conclusion does not carry. It surveyed **URL-only** classification, which is genuinely hard — that difficulty is why a list-first design looked competitive. But Chrome's `urls` table carries a title:

```
CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT,
  url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL,
  typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL,
  hidden INTEGER DEFAULT 0 NOT NULL)
```

`components/history/core/browser/url_database.cc`, `URLDatabase::CreateURLTable` — confirmed against Chromium `main`.

`https://www.reddit.com/r/investing/comments/1a2b3c/` is nearly signal-free. `Best index funds for 2026 : r/investing` is not. This is ordinary short-text classification, and the approach space must be re-surveyed on that basis.

## Survey the approach space first, not model names

Characterise each family before naming candidates:

1. Single-pass discriminative classifier (fine-tuned encoder + head)
2. Multi-pass entailment (zero-shot NLI cross-encoder)
3. Single-pass embedding + label or exemplar similarity
4. Generative (small local LLM, constrained decoding)
5. Deterministic rules / domain lists

For each: **forward passes per row** as a function of taxonomy size, what supervision it needs, what it emits when uncertain, and how a decision is explained in a forensic report.

The cost model is the part that decides this. A 14-label taxonomy costs 14x more in an entailment design than a single-pass one, and that is an architectural fact available before any benchmark.

## Enumerate candidates systematically

Record the exact query used for each sweep so coverage is auditable:

- MTEB leaderboard, filtered to permissive licence / ONNX available / <150MB quantised
- HF API sweeps across `zero-shot-classification`, `text-classification`, `feature-extraction`, each intersected with `onnx`
- Published work on short-text and webpage classification, to catch families the HF taxonomy does not surface

**Trap to avoid:** an earlier informal pass picked candidates by keyword search and then benchmarked whatever it happened to find. Five encoders were tested because they were already known, not because they ranked. A shortlist assembled that way cannot support "best" — only "best of what I remembered".

## Hard filters — reject with the reason logged

Fully offline · deterministic across runs and machines · no Python at runtime · no `trust_remote_code` · no pickle deserialisation · weights redistributable under a stated licence

Licence must come from the model card or LICENSE file of the **authoritative** repo, not a mirror's tag. Two traps already found in #119 stand: UT1 is CC BY-SA 4.0 copyleft, and Tranco's default list embeds a CC BY-NC source. A third: ONNX mirrors frequently declare no licence at all even when the upstream is MIT.

## Taxonomy

Propose the v2 category set and justify each label as a forensic question someone actually asks. v1 used DMOZ top level (`Business, Arts, Computers, Reference, Society, Kids, Health, Science`) — a web-directory taxonomy with no Finance, Gambling, Adult, or Search. Note where candidate models impose a conflicting label set, since that is a hard constraint on which candidates are usable at all.

## Deliverable

`docs/research/136-approach-survey.md`

Every claim tagged CONFIRMED (with URL) or STILL-UNKNOWN. Sizes from real file listings, never parameter-count estimates. **No benchmark numbers in this ticket** — approaches, candidates, and constraints only. Measurement belongs to the harness ticket.

## Done when

A ranked shortlist of at most 6 candidates spanning at least 3 approach families, each surviving the hard filters, with the enumeration method recorded well enough that someone else could reproduce the shortlist.

