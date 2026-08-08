# Research: Short-text classification approaches for title + URL (ChmaraX/forensix#136)

> **File location note.** The issue text specifies `docs/research/136-approach-survey.md`. The
> repo convention on the research branch is `research/NNN-slug.md` (`research/119-url-classifier-options.md`,
> `research/118-chrome-artifacts-today.md`), so this file follows the repo convention, not the
> issue text. Also: these briefs live on branch **`research/wayfinder-v2`**, but the working tree
> was on `master` when this was written. **This file must be moved/committed onto
> `research/wayfinder-v2` before it is linked from the issue.**

> **Evidence note.** Unlike [#119](https://github.com/ChmaraX/forensix/issues/119), this brief was
> written against live primary sources. Every sweep URL, HTTP status, and local capture path is
> recorded in `research/_raw/fetch-manifest.md` (+ `fetch-manifest-gaps.tsv`, `fetch-manifest-gaps2.tsv`),
> generated `2026-08-08T09:46Z`. Claims are tagged **CONFIRMED** (with the file/URL that owns them)
> or **STILL-UNKNOWN**. Nothing is tagged "likely". **No accuracy or benchmark numbers appear in this
> brief by design** — measurement belongs to the harness ticket, and several sources fetched here
> (MTEB model cards, arXiv abstracts) contain figures that were deliberately not carried over.

## Summary

The decision is settled by a cost model that is knowable before any benchmark, not by model quality.
**Entailment (zero-shot NLI) costs N forward passes per history row for an N-label taxonomy; single-pass
discriminative and embedding designs cost 1, independent of N.** For a 14-label forensic taxonomy over a
Chrome `urls` table with 10⁴–10⁵ rows, that is a 14× architectural penalty, and the measured artifact is
~4× larger as well (98,501,034 B vs 18,356,061 B). The recommended shape is therefore unchanged in
*layering* from #119 but changed in *substance*: a deterministic domain-list tier, then a **single-pass
embedding + label/exemplar similarity tier over `title + " " + url`**, with entailment retained only as a
low-volume adjudication tool, not the default path. Two of #119's load-bearing claims are corrected below
with primary evidence: bge-small's ONNX size, and UT1's licence.

## Comparison table — approach families

| # | Family | Encoder passes per row, as f(N) | Supervision needed | Output under uncertainty | Forensic explanation of one decision | Verdict |
|---|--------|-------------------------------|--------------------|--------------------------|--------------------------------------|---------|
| 1 | Single-pass discriminative (encoder + head) | **1**, constant in N. N only widens the final linear layer (N logits from one pass) | Labelled (title+URL, label) pairs in *our* taxonomy, or adopt someone else's fixed label set | Full N-way softmax in one shot; labels mutually comparable; threshold → abstain | "model+sha256, label L, p=0.87, runner-up 0.41, threshold 0.60". A score, not a rationale | Viable **only if we train the head** — no off-the-shelf candidate survives (Finding 6) |
| 2 | Multi-pass entailment (NLI cross-encoder) | **N**, one premise/hypothesis pair per label. +1 label = +1 pass per row, forever | None in-domain; labels are free-text, taxonomy editable without retraining | Per-label entailment scores are independently normalised → not comparable without a post-hoc softmax over the N logits | Strongest of the five: "hypothesis *'This page is about gambling'* scored entailment 0.91 against premise *'<title> <url>'*" — a human-readable proposition on the record | **Adjudication tier only.** 14× cost + 4× artifact |
| 3 | Single-pass embedding + label/exemplar similarity | **1**, constant in N. Label/exemplar vectors are precomputed at build time; N costs only an N×d matmul | None for label-name similarity; a handful of exemplars per label for the few-shot regime. +1 label = embed one string | Cosines are comparable within a row but are not probabilities; margin threshold → abstain is natural | "nearest label centroid Gambling, cos 0.42; next Finance 0.39" **plus the nearest exemplars** — you can show the investigator what the page resembles | **Recommended default tier** |
| 3b | …static-embedding variant (Model2Vec/potion) | **1**, and it is a token-embedding lookup + pooling — no transformer at all | as 3 | as 3 | as 3, and the artifact is small enough to hash and ship trivially | **Cheapest point in the space** |
| 4 | Generative (small local LLM, constrained decoding) | 1 prefill + k decode steps, but the prompt must carry all N labels → token cost is **O(N)** anyway | None; instruction-following. Prompt is a hidden hyperparameter | Logprob of the constrained label token; genuinely N-way only if all N continuations are scored (N scorings again) | Can emit a free-text rationale — forensically hazardous, because the rationale is generated, not causal | **Rejected**: no candidate near the size budget; determinism across machines unresolved (Finding 12) |
| 5 | Deterministic rules / domain lists | **0**. Hash/suffix lookup, constant in N | Curation, not training. Coverage is the cost | No score. Hit or miss; unmatched rows abstain by construction and fall through | Best of the five and the only fully auditable one: "host `bet365.com` matched list <name> version <date> line <n>". A defence expert can inspect the line | **Keep as tier 0** |

### The cost model, stated plainly

For taxonomy size **N = 14** and a history of **R** rows:

- Family 1 / 3: **R** encoder passes.
- Family 2: **14 R** encoder passes, and each pass is over a *longer* sequence (premise + hypothesis) than
  the family-3 pass (title + URL alone).
- Family 5: **0** encoder passes.

This is architectural. It does not depend on which NLI checkpoint is chosen, it cannot be tuned away, and
it gets worse every time the taxonomy grows. Adding a 15th label costs +R passes in family 2 and exactly
zero additional passes in families 1 and 3.

## Comparison table — shortlist (all sizes are real bytes from HF tree listings)

| Rank | Candidate | Family | Measured file | ONNX bytes | + tokenizer/config overhead | Total bytes | Licence (authority) |
|---|---|---|---|---|---|---|---|
| 1 | `minishlab/potion-base-2M` | 3b static | `onnx/model.onnx` | 7,563,349 | 905,399 | **8,468,748** | MIT — model card front matter |
| 2 | `minishlab/potion-base-8M` | 3b static | `onnx/model.onnx` | 30,240,854 | 905,401 | **31,146,255** | MIT — model card front matter |
| 3 | `TaylorAI/bge-micro-v2` | 3 contextual | `onnx/model_quantized.onnx` | 17,409,774 | 946,287 | **18,356,061** | MIT — in-repo `LICENSE` file |
| 4 | `sentence-transformers/all-MiniLM-L6-v2` | 3 contextual | `onnx/model_qint8_arm64.onnx` | 23,026,053 | 699,537 | **23,725,590** | Apache-2.0 — model card front matter |
| 5 | `cross-encoder/nli-deberta-v3-xsmall` | 2 entailment | `onnx/model_qint8_arm64.onnx` | 87,377,068 | 11,123,966 | **98,501,034** | Apache-2.0 — model card front matter |
| 6 | UT1 compiled domain→category table | 5 lists | n/a (data artifact) | — | — | build-time compiled | **CC BY-SA 4.0** — copyleft, see Finding 14 |

Overhead is the sum of every non-ONNX runtime file in the same repo (`tokenizer.json`, `vocab.txt`,
`config.json`, `tokenizer_config.json`, `special_tokens_map.json`, `modules.json`, pooling/ST configs).
No number in this table is derived from a parameter count.

## Findings

### 1. Enumeration method (reproducible)

1. **Sweep A — HF pipeline × ONNX, top 100 by downloads.** Three URLs, hit verbatim, all 200 OK. CONFIRMED
   [`research/_raw/fetch-manifest.md`].
   - `https://huggingface.co/api/models?filter=zero-shot-classification,onnx&sort=downloads&direction=-1&limit=100&full=true`
   - `https://huggingface.co/api/models?filter=text-classification,onnx&sort=downloads&direction=-1&limit=100&full=true`
   - `https://huggingface.co/api/models?filter=feature-extraction,onnx&sort=downloads&direction=-1&limit=100&full=true`

   Every candidate below was surfaced by one of the recorded sweeps. Nothing on the shortlist was chosen by
   keyword recall and justified afterwards; where a family had no sweep hit, that is reported as a negative
   finding rather than patched from memory.

2. **Sweep B — families the pipeline taxonomy structurally misses.** Nine further sweeps, all recorded in
   `fetch-manifest.md`: `sentence-similarity,onnx` (100), `filter=model2vec` (100), `library=model2vec` (100),
   `filter=setfit` (100), `search=fasttext` (50), `search=url classification` (8),
   `search=website category` (2), `author=onnx-community` (100), `author=Xenova` (100). CONFIRMED.
   **Sweep B was necessary and it changed the shortlist**: the entire family-3b static-embedding class
   (`minishlab/potion-*`) appears in `filter=model2vec` and in *none* of the three Sweep-A pipeline sweeps,
   because Model2Vec repos carry `library_name: model2vec` and no pipeline tag at all
   [`proj/sweep-model2vec-filter-part1.json`]. Ranking only from Sweep A would have silently excluded the
   cheapest viable family.

3. **One sweep in the plan is invalid and must not be re-used.**
   `https://huggingface.co/api/models?library=model2vec&sort=downloads&...` did **not** filter: its top
   results are `google-bert/bert-base-uncased`, `Qwen/Qwen3-8B`, `amazon/chronos-2`, i.e. the global
   download ranking [`proj/sweep-model2vec-library-part1.json`]. The `library=` query parameter appears to
   be ignored by the models API; **`filter=model2vec` is the correct form** and returns a clean
   `library_name: model2vec` set. CONFIRMED by direct comparison of the two dumps. Anyone reproducing this
   enumeration should use `filter=`, not `library=`.

4. **MTEB could not be used as a ranked enumeration source. STILL-UNKNOWN.** The leaderboard is a
   client-rendered Gradio Space, so no ordered model column with a recorded filter state could be captured
   by HTTP fetch, and none was invented. The Space revision is pinned
   (`https://huggingface.co/api/spaces/mteb/leaderboard` → `ext/mteb-space-info.json`, 200 OK, 28,030 B) and
   the machine-readable registry was fetched instead (`mteb/models/model_meta.py`,
   `mteb/models/get_model_meta.py`, directory listing of `mteb/models/model_implementations`) — note that
   `mteb/models/overview.py`, the URL named in the research plan, **404s**; the registry was restructured.
   The requested MTEB filter state (permissive licence / ONNX available / <150MB quantised) is therefore
   **not** part of this enumeration. Next step is a real browser run against the Space with the filter state
   screenshotted.

### 2. Negative findings — what does not exist

5. **There is still no off-the-shelf "URL → content category" model, and now that is measured.**
   `search=url classification` returned **8 models total**. The most-downloaded has **5 downloads**. None
   ship any `.onnx`. Four are PEFT adapters or phishing/malicious-URL binaries (a security question, not a
   content taxonomy), and one is literally named `nishnk/url_classification_model.pkl` and is gated.
   `search=website category` returned **2 models**, 24 and 4 downloads, no ONNX. CONFIRMED
   [`proj/sweep-search-url-classification-part1.json`, `proj/sweep-search-website-category-part1.json`].
   This upgrades #119's finding 3 from an assertion to an enumerated result.

6. **WebOrganizer is the only credible off-the-shelf webpage-topic classifier, and it fails three hard
   filters independently.** It was surfaced by the literature pass, not by the HF pipeline sweeps.
   CONFIRMED [`proj/weborganizer-hf-models-part1.json`, `ext/weborganizer-github-README.md`,
   `configs/WebOrganizer__TopicClassifier.json`, `ext/weborganizer-topics.yaml`]:
   - **Zero of the 21 models under `author=WebOrganizer` ship any `.onnx` file.** `onnx_files: []` for all.
   - `TopicClassifier`, `TopicClassifier-NoURL`, `FormatClassifier`, `FormatClassifier-NoURL` all have
     `trust_remote_code: true` (`custom_code` tag) — an explicit hard filter.
   - All 21 declare **no licence**: `license: null`, `license_tag: []`. This is CONFIRMED-no-licence from
     the API, not an assumption that some upstream licence applies.
   - Size is out of range regardless: `model.safetensors` = **549,556,200 B** per classifier.
   - **Structural mismatch, and this is the decisive one.** `ext/weborganizer-topics.yaml` (200 OK, 11,734 B)
     contains the prompt template `URL: {url}\nContent: {text}` — it consumes URL **plus full page text**.
     v2 has title + URL and nothing else, because the pages are gone. The README sentence "use both the URL
     and web site content" is confirmed by the taxonomy file itself.

7. **Family 4 (generative) has no candidate at this size point.** No sweep surfaced a text-generation model
   with ONNX weights anywhere near the <150 MB quantised budget; the generative entries that appear in the
   dumps (`Qwen/Qwen3-0.6B`, `Qwen/Qwen2.5-1.5B-Instruct`, `facebook/opt-125m`) carry
   `onnx_files: []` [`proj/sweep-model2vec-library-part1.json`, which by the bug in Finding 3 is effectively
   a global download ranking and therefore doubles as evidence here]. Rejected on size and on the
   cross-machine determinism concern carried forward from #119; no attempt was made to rehabilitate it.

### 3. Sizes — corrections to #119

8. **#119's headline size figure for its own primary recommendation is wrong.** #119 recommended
   `BAAI/bge-small-en-v1.5` at "~25–35 MB int8". The authoritative repo ships **exactly one** ONNX file,
   `onnx/model.onnx` at **133,093,490 B**, and **no quantised variant at all**; with tokenizer and config
   overhead the artifact is **134,038,343 B**. CONFIRMED [`trees/BAAI__bge-small-en-v1.5.json`]. The ~23 MB
   figure exists only in third-party mirrors and re-exports. This is precisely the mirror-vs-upstream
   divergence #136 warned about, and it landed on the previous brief's primary recommendation.
   Measured alternatives that actually are in that size class:
   `Xenova/all-MiniLM-L6-v2` `onnx/model_quantized.onnx` = **22,972,370 B**;
   `sentence-transformers/all-MiniLM-L6-v2` `onnx/model_qint8_arm64.onnx` = **23,026,053 B**;
   `TaylorAI/bge-micro-v2` `onnx/model_quantized.onnx` = **17,409,774 B**.

9. **The entailment penalty is now measured on both axes, not argued.** For
   `cross-encoder/nli-deberta-v3-xsmall`, the smallest ONNX is `onnx/model_qint8_arm64.onnx` =
   **87,377,068 B**, and the DeBERTa-v3 tokenizer alone is `tokenizer.json` **8,656,624 B** +
   `spm.model` **2,464,616 B` — an order of magnitude more tokenizer than a WordPiece encoder
   (`bge-micro-v2`: `tokenizer.json` 711,661 B + `vocab.txt` 231,508 B). CONFIRMED
   [`trees/cross-encoder__nli-deberta-v3-xsmall.json`, `trees/TaylorAI__bge-micro-v2.json`]. So family 2 is
   **~5.4× the artifact of the family-3 shortlist leader AND runs N times per row**. Both halves of the
   trade are measured.

10. **Static embeddings are a genuinely different size point.** `minishlab/potion-base-2M`
    `onnx/model.onnx` = **7,563,349 B**; `minishlab/M2V_base_output` `onnx/model_quantized.onnx` =
    **7,563,045 B** (byte-identical `oid` to `model_int8.onnx` and `model_uint8.onnx`, i.e. the same graph
    published under three names); `minishlab/potion-base-8M` `onnx/model.onnx` = **30,240,854 B**;
    `minishlab/potion-base-32M` `onnx/model.onnx` = **129,214,550 B**. CONFIRMED
    [`trees/minishlab__potion-base-2M.json`, `trees/minishlab__M2V_base_output.json`,
    `trees/minishlab__potion-base-8M.json`]. All four have `has_pickle: false` — no `.bin` in the repo at
    all, which is stronger hygiene than the sentence-transformers repos (Finding 13).

### 4. Licences

11. **The ONNX-mirror no-licence trap is real and now quantified.** Count of models declaring no licence in
    each namespace sweep, CONFIRMED [`fetch-manifest.md` and the `proj/sweep-author-*` dumps]:
    **`Xenova` 80 of 100**, **`onnx-community` 48 of 100**. For comparison, `setfit` 64/100,
    `sentence-similarity,onnx` 12/100, `filter=model2vec` 1/100. Any ONNX mirror must have its licence read
    off its own model card; the upstream's terms do not travel automatically.
    **Counter-example worth recording:** `Xenova/all-MiniLM-L6-v2` *does* declare
    `license: apache-2.0` in its own model card front matter, CONFIRMED
    [`licences/Xenova__all-MiniLM-L6-v2.md`, source `https://huggingface.co/Xenova/all-MiniLM-L6-v2/raw/main/README.md`].
    So the rule is "verify", not "mirrors are always unlicensed".

12. **Licence authority differs by repo and the distinction matters.** CONFIRMED from the captured
    authoritative model cards / LICENSE files:
    - `TaylorAI/bge-micro-v2` — **in-repo `LICENSE` file**, full MIT text, "Copyright (c) 2023 Benjamin
      Anderson" [`licences/TaylorAI__bge-micro-v2.md`]. Note its model card YAML has **no** `license:` key —
      the LICENSE file is the authority here, and a tag-only check would have found nothing.
    - `sentence-transformers/all-MiniLM-L6-v2` — `license: apache-2.0` in model card front matter
      [`licences/sentence-transformers__all-MiniLM-L6-v2.md`].
    - `cross-encoder/nli-deberta-v3-xsmall` — `license: apache-2.0` in model card front matter
      [`licences/cross-encoder__nli-deberta-v3-xsmall.md`].
    - `minishlab/potion-*`, `minishlab/M2V_base_output` — `license: mit` in model card front matter and
      `license = {MIT}` in the citation block; **no standalone LICENSE file on the HF repo**
      [`licences/minishlab__potion-base-8M.md`, `licences/minishlab__M2V_base_output.md`]. The Model2Vec
      *code* is separately MIT [`ext/model2vec-LICENSE`, MIT, "Copyright (c) 2024 Thomas van Dongen"].
    - `BAAI/bge-small-en-v1.5` — **MIT CONFIRMED**, but only after re-fetching the full model card: the
      `license: mit` key sits *after* a very large `model-index` block, and the card states "FlagEmbedding
      is licensed under the MIT License. The released models can be used for commercial purposes free of
      charge." No standalone LICENSE file on the HF repo — the licence text points at the FlagEmbedding
      GitHub repo [`licences/BAAI__bge-small-en-v1.5.md`]. An initial truncated capture made this look
      unlicensed, which is itself a warning about how this check is performed.

13. **Pickle hygiene: the filter must be applied to the shipped artifact, not the repo.** Most
    sentence-transformers and cross-encoder repos carry `has_pickle: true` because `pytorch_model.bin`
    (and sometimes `tf_model.h5`, `rust_model.ot`, `training_args.bin`) sits alongside the ONNX — e.g.
    `sentence-transformers/all-MiniLM-L6-v2` ships `pytorch_model.bin` 90,888,945 B, `rust_model.ot`
    90,887,379 B and `tf_model.h5` 91,005,696 B [`trees/sentence-transformers__all-MiniLM-L6-v2.json`].
    None of that is loaded by an ONNX runtime. The correct rule for v2 is **ship only the ONNX + tokenizer
    + config files, hash-pin each, and never fetch the repo at runtime** — under which all shortlist
    entries pass. The `minishlab/potion-*` repos are the only ones with no pickle in the repo at all.

14. **UT1 is CC BY-SA 4.0 — this corrects #119.** #119 recorded UT1 as "permissive `[verify]`".
    `ext/ut1-blacklists-index_en.html` (200 OK, 23,312 B, from
    `https://dsi.ut-capitole.fr/blacklists/index_en.php`) contains
    `<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">`. CONFIRMED. This is
    **copyleft on a shipped artifact**: a compiled domain→category table derived from UT1 is a derivative
    work and inherits share-alike obligations. That does not disqualify it — the hard filter is
    "redistributable under a stated licence", and CC BY-SA 4.0 is both — but it is a licensing decision the
    project must take deliberately, and it must be stated in the tool's notices.

15. **The Tranco CC BY-NC claim is NOT confirmed. STILL-UNKNOWN.** `https://tranco-list.eu/faq` **404s**
    (the URL in the #119 plan does not exist). `ext/tranco-home.html` (200 OK, 25,636 B) and
    `ext/tranco-methodology.html` contain no licence text. The methodology page documents the constituent
    sources (CrUX, Cisco Umbrella, Majestic, Cloudflare Radar); the plausible CC BY-NC carrier is Cloudflare
    Radar, but `radar.cloudflare.com/about` returned **403**, so there is no primary text either way. Do not
    repeat the #119 claim. Next URLs to check: Cloudflare Radar's terms page via a real browser, and the
    Tranco paper's data-availability statement.

16. **Citizen Lab test-lists has no LICENSE file at repo root. STILL-UNKNOWN as to the exact grant.**
    `https://raw.githubusercontent.com/citizenlab/test-lists/master/LICENSE` **404s**; the root listing is
    `.github`, `.gitignore`, `README.md`, `lists`, `output`, `scripts`. Any licence claim must be sourced
    from `ext/citizenlab-README.md` text or left unknown. #119 asserted CC BY-SA 4.0 without a source; that
    assertion is not carried forward.

17. **Runtime licences are clean.** `ext/onnxruntime-LICENSE` (MIT, Microsoft),
    `ext/transformersjs-LICENSE` (Apache-2.0), `ext/tldts-LICENSE`, `ext/fasttext-LICENSE`,
    `ext/setfit-LICENSE`, `ext/mteb-repo-LICENSE` — all 200 OK and captured. CONFIRMED
    [`fetch-manifest.md`]. **Provenance oddity worth noting:** `ext/homepage2vec-LICENSE` is MIT-style text
    but its copyright line reads "Copyright (c) 2018 The Python Packaging Authority" — a cookiecutter
    template default that names neither EPFL nor the authors. The *code* licence is CONFIRMED MIT-text;
    what governs the separately-distributed **weights** is STILL-UNKNOWN. #119 cited Homepage2Vec as
    "MIT licence" without this caveat.

### 5. Rejection log — every rejection with its reason

| Rejected | Family | Reason (all CONFIRMED unless noted) |
|---|---|---|
| `WebOrganizer/TopicClassifier`, `TopicClassifier-NoURL`, `FormatClassifier`, `FormatClassifier-NoURL` (+17 others under that author) | 1 | (a) no `.onnx` in any of the 21 repos; (b) `trust_remote_code: true`; (c) `license: null`, `license_tag: []` → CONFIRMED-no-licence; (d) 549,556,200 B safetensors; (e) input contract is URL + full page text, not title |
| `BAAI/bge-small-en-v1.5` | 3 | Only ONNX is `onnx/model.onnx` 133,093,490 B, no quantised variant → 134,038,343 B total, blows the <150 MB budget once anything else ships alongside it. Licence is fine (MIT). This was #119's primary pick |
| `BAAI/bge-base-en-v1.5`, `bge-large-en-v1.5`, `bge-m3`, `intfloat/multilingual-e5-large*`, `mixedbread-ai/mxbai-embed-large-v1`, `WhereIsAI/UAE-Large-V1`, `Alibaba-NLP/gte-large-en-v1.5`, `sentence-transformers/all-mpnet-base-v2`, `all-roberta-large-v1`, `paraphrase-multilingual-mpnet-base-v2` | 3 | Size — base/large encoders, all above the budget |
| `nomic-ai/nomic-embed-text-v1`, `nomic-embed-text-v1.5` | 3 | `trust_remote_code: true` |
| `jinaai/jina-embeddings-v3`, `jinaai/jina-reranker-v2-base-multilingual`, `CISCai/jina-embeddings-v3-separation-distilled` | 3 | `license: cc-by-nc-4.0` — non-commercial, not redistributable for this tool. (`jinaai/*` additionally `trust_remote_code: true`) |
| `Xenova/bart-large-mnli`, `Xenova/mobilebert-uncased-mnli`, `Xenova/distilbert-base-uncased-mnli`, `Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`, `Xenova/nli-deberta-v3-xsmall`, `Xenova/ms-marco-MiniLM-L-6-v2` | 2 | `license_tag: []` — no licence declared on the mirror's own card. Part of the 80/100 in Finding 11 |
| `MoritzLaurer/deberta-v3-large-zeroshot-v2.0`, `DeBERTa-v3-large-mnli-fever-anli-ling-wanli`, `mDeBERTa-v3-base-*`, `bge-m3-zeroshot-v2.0`, `deberta-v3-base-zeroshot-*`, `cross-encoder/nli-deberta-v3-base`, `nli-deberta-v3-large`, `nli-MiniLM2-L6-H768`, `nli-roberta-base`, `nli-distilroberta-base` | 2 | Size and/or the N-pass cost model; `MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33` is the closest survivor (`onnx/model_quantized.onnx` 87,246,195 B) but is dominated by `cross-encoder/nli-deberta-v3-xsmall` on artifact size once its 8,656,646 B tokenizer + 2,464,616 B `spm.model` are added |
| `cross-encoder/ms-marco-*`, `stsb-*`, `BAAI/bge-reranker-*`, `Alibaba-NLP/gte-reranker-modernbert-base`, `mixedbread-ai/mxbai-rerank-xsmall-v1` | — | Wrong task. These are relevance rerankers surfaced by the `text-classification,onnx` sweep because of tag overloading; they emit a query-document relevance score, not a category |
| `distilbert/distilbert-base-uncased-finetuned-sst-2-english`, `lxyuan/distilbert-base-multilingual-cased-sentiments-student`, `protectai/deberta-v3-base-prompt-injection-v2`, `livekit/turn-detector` | 1 | **Conflicting fixed label set** — sentiment / prompt-injection / turn-detection heads. Their `id2label` is not a content taxonomy and cannot be made into one without retraining. `livekit/turn-detector` additionally `license: other` |
| `WFullen/malicious_url_*`, `munzirmuneer/phishing_URL_classification_*`, `kavip/urlclassification`, `nishnk/url_classification_model.pkl`, `big2undey/random_forest_url_classification` | 1 | No ONNX; PEFT adapters or scikit-learn pickles; ≤5 downloads; phishing-binary task not content taxonomy; one is gated. See Finding 5 |
| `SanandaDutta/website-category-distilbert`, `website-category-classifier` | 1 | No ONNX; 24 and 4 downloads; no maintenance signal. See Finding 5 |
| `Qwen/Qwen3-0.6B`, `Qwen2.5-1.5B-Instruct`, `facebook/opt-125m`, any GGUF path | 4 | No ONNX weights; size; cross-machine determinism unresolved |
| `minishlab/potion-base-32M` | 3b | `onnx/model.onnx` 129,214,550 B — inside the letter of the budget but leaves no headroom, and `potion-base-8M` occupies the same family at 30,240,854 B |
| `minishlab/potion-multilingual-128M`, `potion-code-16M*`, `potion-science-32M`, `Jarbas/*`, `NAMAA-Space/bojji`, `NeuML/pubmedbert-*` | 3b | Either no `.onnx` file, or domain-specialised (code/science/biomedical/Portuguese) against a general web taxonomy |
| SetFit checkpoints as a class | 1/3 | 64 of 100 in the `filter=setfit` sweep declare no licence; and SetFit is a *training method* over a sentence-transformer body — the right way to consume it is to train our own head on a shortlist backbone, not to adopt someone's checkpoint |
| Homepage2Vec | 1 | Weights licence STILL-UNKNOWN (Finding 17); XLM-R body is far over budget; ~296-category Curlie label set conflicts with the proposed taxonomy. Its *labelled data* remains useful for exemplar seeding |
| fastText | 1 | Code is MIT [`ext/fasttext-LICENSE`], size would be attractive, but consuming it requires a native Node addon — reintroducing a build toolchain, which is a different flavour of the v1 Python-spawn problem. Not shortlisted; not fully rejected — worth a separate spike if the shortlist underdelivers |
| Any hosted LLM API | 4 | Evidence exfiltration, non-reproducibility, endpoint longevity. Unchanged from #119 and not re-litigated here |

### 6. What survives, and why it is ranked this way

18. **Rank 1–2, `minishlab/potion-base-2M` and `potion-base-8M` (family 3b).** 8,468,748 B and 31,146,255 B
    total. MIT CONFIRMED. `has_pickle: false`. Inference is a token-embedding lookup plus pooling, so it is
    trivially deterministic across machines — there is no attention kernel whose floating-point reduction
    order can vary. Taxonomy is fully editable (embed a new label string). Surfaced by the
    `filter=model2vec` sweep, ranked #1 and #10 by downloads in that sweep.
    Ranked first on the cost model, the size, and the determinism argument — **not** on quality, which is
    explicitly unmeasured here.

19. **Rank 3–4, `TaylorAI/bge-micro-v2` and `sentence-transformers/all-MiniLM-L6-v2` (family 3,
    contextual).** 18,356,061 B and 23,725,590 B. MIT and Apache-2.0 CONFIRMED. These are the contextual
    hedge: if a static bag-of-embeddings proves too weak on titles with word-order-sensitive meaning
    ("*Best index funds for 2026 : r/investing*"), these occupy the same 1-pass-per-row cost class at ~2–3×
    the artifact. `all-MiniLM-L6-v2` is the single most-downloaded model in the entire feature-extraction
    sweep (245,701,881 downloads), which is a maintenance-risk signal, not a quality claim.

20. **Rank 5, `cross-encoder/nli-deberta-v3-xsmall` (family 2), as an adjudication tier only.**
    98,501,034 B, Apache-2.0 CONFIRMED. Its `id2label` is `{contradiction, entailment, neutral}`
    [`configs/cross-encoder__nli-deberta-v3-xsmall.json`] — NLI mechanics, **no content taxonomy imposed**,
    which is the family's real advantage. Its cost makes it wrong for bulk classification of an entire
    history, and right for the small set of rows an investigator flags for a second opinion, where the
    human-readable hypothesis string is worth 14 forward passes.

21. **Rank 6, the deterministic list tier (family 5).** Zero forward passes, exact-match provenance, and the
    only tier whose decisions can be inspected line by line. Keyed on eTLD+1 via the Public Suffix List
    (`ext/publicsuffix-home.html`, 200 OK) with `tldts` as the Node implementation
    (`ext/tldts-LICENSE`, 200 OK). Carries the CC BY-SA 4.0 obligation from Finding 14 and the unresolved
    Tranco/Citizen Lab questions from Findings 15–16.

22. **Family 1 survives only as "train our own head".** No off-the-shelf discriminative candidate passes
    (Findings 5, 6, and the rejection log). But a head trained on top of any rank-1–4 backbone is the same
    1-pass-per-row cost class, is deterministic, is ours to license, and — decisively for section 7 below —
    imposes **no foreign label set**. This is the natural follow-on once the harness ticket has measured the
    similarity tier.

## 7. Proposed v2 taxonomy

v1 used DMOZ top level (`Business, Arts, Computers, Reference, Society, Kids, Health, Science`). That is a
2000s web-directory ontology built for browsing a curated catalogue. It has **no Finance, no Gambling, no
Adult, no Search, no File-sharing, no Anonymity tooling**, and its largest buckets — `Society`, `Reference`,
`Computers` — answer no investigative question at all. A forensic taxonomy should be a list of questions an
investigator is actually asked in a report, and each label should be defensible as such.

| Label | The forensic question it answers |
|---|---|
| **Search / Query** | "What did the subject search for?" Search-engine and site-search URLs are the single highest-value class in a history artifact — and DMOZ has no label for them whatsoever |
| **Adult / Sexual content** | "Was there adult material on this machine?" HR and misconduct casework. Explicitly **not** a CSAM detector; that is a different tool with a different evidential standard |
| **Gambling** | "Was there gambling activity?" Standard motive evidence in embezzlement and fraud |
| **Finance / Banking** | "Which financial institutions and accounts were accessed, and when?" |
| **Cryptocurrency / Exchanges** | Separated from Finance deliberately: it is the dominant exfil-monetisation and ransom-payment channel, and investigators ask it as its own question |
| **Employment / Job seeking** | "Was there job-seeking before the exfil?" A classic insider-threat precursor and one of the most-requested timeline overlays |
| **File sharing / Cloud storage / Transfer** | "How did the data leave?" A direct exfil vector |
| **Anonymity / Privacy tooling** | "Was there counter-forensic preparation?" VPN, Tor, proxy, secure-delete and anti-forensics downloads |
| **Hacking / Security tooling** | "Was there tool acquisition?" |
| **Webmail / Messaging / Communications** | "How were they communicating off-channel?" |
| **Social media** | "What accounts, and what contacts?" |
| **Shopping / E-commerce / Marketplace** | "What was purchased, and does it match the alleged fraud?" |
| **Travel / Transport / Accommodation** | "Does the browsing corroborate the movement timeline?" Placement and alibi |
| **News / Media / Reference** | The high-volume benign baseline. Keeping it explicit prevents ordinary browsing being swept into an "Other" bucket that then *looks* anomalous in a chart |
| **Unclassified / insufficient signal** | **Mandatory.** `t.co/x7Fq2`, `192.168.1.1`, CDN URLs and empty titles carry no signal, and no model of any size fixes that. A forensic classifier must be permitted to say nothing; a forced argmax on a signal-free row is a false statement in a report |

Jurisdiction-dependent extension points, deliberately not in the core set: **Drugs / Pharmacy**,
**Weapons**, **Extremism**. These carry legal definitions that vary by jurisdiction and should be opt-in
overlays with their own documented definitions.

### Conflicting fixed label sets are a hard constraint, not a nuisance

23. **Only 10 of the 54 verified models have a non-trivial `id2label`, and every zero-shot one is
    `{contradiction, entailment, neutral}`.** CONFIRMED [`configs/`]. This is the structural point:
    - **Family 1 (discriminative) checkpoints impose their label set.** `distilbert-base-uncased-finetuned-sst-2-english`
      is `{NEGATIVE, POSITIVE}`; `protectai/deberta-v3-base-prompt-injection-v2` is an injection detector.
      Adopting such a checkpoint means adopting its questions. There is no partial adoption.
    - **Families 2, 3, 3b and 5 impose nothing.** Entailment takes arbitrary hypothesis strings; embedding
      similarity takes arbitrary label/exemplar strings; lists take arbitrary category names. For a bespoke
      forensic taxonomy that is a decisive structural advantage, and it is a large part of why the shortlist
      is weighted towards family 3.
    - **WebOrganizer is the sharpest illustration.** Its 24 topic labels — Adult, Art & Design, Food &
      Dining, Games, Health, History, Home & Hobbies, Industrial, Literature, Politics, Religion, Science &
      Tech., Software Dev., Software, Sports & Fitness, Transportation, Travel, Crime & Law, Education &
      Jobs, Hardware, Entertainment, Social Life, Fashion & Beauty, Finance & Business
      [`configs/WebOrganizer__TopicClassifier.json`] — are a *pre-training data curation* ontology. It has
      Adult and Finance & Business, but **no Gambling, no Search, no Anonymity tooling, no File sharing**,
      and it spends four of its 24 labels on Software / Software Dev. / Hardware / Industrial. Even if it
      had passed the hard filters, its taxonomy answers a different set of questions.

24. **Topic and format are orthogonal axes and the second one is under-used.** WebOrganizer ships a separate
    24-label *format* classifier (News Article, Product Page, Q&A Forum, Personal Blog, Spam / Ads,
    Documentation, Tutorial, User Review, Customer Support, FAQ, Legal Notices, Listicle, …)
    [supervisor capture of `configs/WebOrganizer__FormatClassifier.json`, relayed; the file is on disk but
    was not independently re-read for this brief]. The idea generalises even though the model is rejected:
    a report reader frequently wants "was this a forum thread or a product page" *independently* of subject
    matter, and page titles carry strong format signal (`" : r/investing"`, `" | eBay"`, `" - Stack Overflow"`).
    Worth considering as a second, cheap label axis on the same single forward pass — it costs one extra
    head, not one extra pass.

## Sources

**Kept — primary, all fetched and stored under `research/_raw/`**
- HF models API, three pipeline×onnx sweeps — the ranked enumeration backbone (`fetch-manifest.md`)
- HF models API, nine Sweep-B queries — caught family 3b, which Sweep A structurally misses
- `https://huggingface.co/api/models/<id>/tree/main?recursive=true` × 61 — every byte size in this brief
- `https://huggingface.co/<id>/raw/main/README.md` and `/LICENSE` × 61 — every licence claim in this brief
- `https://huggingface.co/<id>/raw/main/config.json` × 61 — every `id2label` claim
- `https://raw.githubusercontent.com/CodeCreator/WebOrganizer/main/README.md` + `ext/weborganizer-topics.yaml` — the rejection evidence and the taxonomy comparison
- `https://dsi.ut-capitole.fr/blacklists/index_en.php` — the CC BY-SA 4.0 correction
- `https://huggingface.co/api/spaces/mteb/leaderboard` — pins the Space revision even though the ranking could not be extracted
- `ext/mteb-model_meta.py`, `ext/mteb-get_model_meta.py`, `ext/mteb-model_implementations-listing.json` — reproducible substitute registry
- `ext/onnxruntime-LICENSE`, `ext/transformersjs-LICENSE`, `ext/tldts-LICENSE`, `ext/model2vec-LICENSE`, `ext/fasttext-LICENSE`, `ext/setfit-LICENSE` — runtime licence chain
- `ext/arxiv-webpage-classification.xml`, `ext/arxiv-short-text-classification.xml` — used to identify approach families and prior art only; **no reported figures were carried into this brief**

**Dropped**
- MTEB leaderboard UI — client-rendered Gradio; no ordered column or filter state could be captured by HTTP, and none was fabricated
- `https://raw.githubusercontent.com/embeddings-benchmark/mteb/main/mteb/models/overview.py` — 404, registry restructured
- `https://tranco-list.eu/faq` — 404, the URL in the #119 plan does not exist
- `https://raw.githubusercontent.com/citizenlab/test-lists/master/LICENSE` — 404, no LICENSE at repo root
- `radar.cloudflare.com/about` — 403
- Model-card MTEB `model-index` blocks — contain accuracy figures, out of scope for this ticket by rule
- Reranker and sentiment checkpoints surfaced by tag overloading — wrong task, logged in the rejection table rather than silently dropped

## Gaps / STILL-UNKNOWN

1. **MTEB ranked enumeration with a recorded filter state.** Not obtained (Finding 4). The shortlist is
   therefore ranked by *download-ordered sweeps plus hard filters plus the cost model*, not by an
   embedding-quality ranking. Next step: drive the Space with a real browser, apply
   licence/ONNX/size filters, and capture the ordered model column plus the filter state and the Space
   revision.
2. **Tranco's effective licence** (Finding 15). Next: Cloudflare Radar terms via browser; the Tranco paper's
   data-availability statement.
3. **Citizen Lab test-lists licence grant** (Finding 16). Next: read `ext/citizenlab-README.md` in full and,
   if silent, open an issue upstream rather than assuming CC BY-SA.
4. **Homepage2Vec weights licence** (Finding 17). The repo LICENSE is a packaging template naming the wrong
   copyright holder; the weights ship separately.
5. **Whether the potion/Model2Vec ONNX graphs run under `onnxruntime-node` without a Python-side
   preprocessing step.** The ONNX files and tokenizers exist and were measured, but the end-to-end
   Node-only path was not executed here. This is a build-spike question, not a research question, and it is
   a gating one for ranks 1–2.
6. **Cross-machine determinism of int8 ONNX for ranks 3–5.** Asserted architecturally for family 3b (lookup
   + pooling has no kernel-dependent reduction), **not** verified for the quantised transformer graphs.
   Belongs to the harness ticket: run the same input on x86-64 and arm64 and diff the logits bitwise.
7. **Empirical head-coverage of the list tier** — still the highest-value unmeasured number, carried over
   from #119 gap 5 and still not measured. It determines how much traffic ever reaches the model tier at
   all, and it is cheaper to obtain than anything else on this list.
8. **`configs/WebOrganizer__FormatClassifier.json`** was relayed rather than independently re-read
   (Finding 24). The model is rejected regardless, so this affects only the strength of the
   "format as a second axis" suggestion.

**Explicitly out of scope by rule:** every accuracy, F1, nDCG or leaderboard figure encountered during this
research. Several captured model cards are dense with them. None were carried into this brief. Measurement
belongs to the harness ticket, against the taxonomy in section 7 and a real Chrome `urls` sample.
