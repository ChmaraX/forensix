# Research: Replacing the 700MB scikit-learn pickle URL classifier (ChmaraX/forensix#119)

> **Methodology caveat — read first.** The web-search tool was not available in this
> execution environment, so this brief is assembled from model knowledge of the
> ecosystem rather than from freshly fetched pages. Structural claims (what exists,
> licence families, architecture, whether Python is required) are high confidence.
> Every *number* — artifact size, price, accuracy, list coverage, last-update date —
> is marked `[verify]` and paired with the exact URL to confirm it against. Do not
> paste the numbers into the issue or an ADR without that pass. See **Gaps**.

## Summary

The pickle should not be replaced by a single equivalent model. For a forensic tool
the dominant requirement is **deterministic, offline, auditable classification**, and
that is best served by a **layered hybrid**: a versioned, hash-pinned domain→category
table (UT1 + Citizen Lab + curated adult/news/social lists, keyed on eTLD+1 via the
Public Suffix List) resolving the head of the distribution, then a small quantised
ONNX embedding model (`bge-small-en-v1.5` or `all-MiniLM-L6-v2`, ~25–35 MB int8)
with a **nearest-centroid** head for the unknown tail. That drops the artifact from
~700 MB to roughly 30–80 MB, removes Python and the unpickling RCE entirely
(transformers.js / onnxruntime-node are pure Node + native ORT binary), and — crucially —
makes each classification explainable as either "matched list X version Y" or
"nearest centroid, cosine 0.71". LLM APIs are disqualified by the evidence-handling
constraint, not by cost.

## Comparison table

| # | Option | Artifact size | Offline | Licence | Forces Python? | Accuracy (coarse taxonomy) | Reproducible | Maintenance |
|---|--------|---------------|---------|---------|----------------|---------------------------|--------------|-------------|
| 1a | ONNX text classifier (fine-tuned MiniLM/DeBERTa-xsmall head) via transformers.js | 25–90 MB int8 `[verify]` | Yes | Model-dependent; MiniLM/BGE are MIT/Apache-2.0 | **No** | 65–80% on URL string only `[verify]` | Yes (fixed weights, fixed opset) | Med — you must train + host the head |
| 1b | Off-the-shelf zero-shot NLI (DeBERTa-v3-xsmall/base) | 280 MB–750 MB | Yes | MIT (model) | No | Mediocre on bare URLs; needs page text | Yes | Low |
| 1c | fastText supervised, quantised | 1–10 MB `[verify]` | Yes | MIT | No, but node binding is a native addon | 60–75% char-ngram on URLs | Yes | Low–Med |
| 1d | Model2Vec / potion static embeddings | ~8–30 MB `[verify]` | Yes | MIT | Node support immature `[verify]` | Slightly below MiniLM | Yes | Med (JS port risk) |
| 2 | Embedding + nearest-centroid / logistic head | 25–35 MB (bge-small int8) + <1 MB centroids | Yes | MIT (BGE), Apache-2.0 (MiniLM), Apache-2.0 (ORT/transformers.js) | **No** | 65–80%; strong on recognisable domains, weak on opaque URLs | Yes, and *explainable* | Low — centroids are a small JSON you own |
| 3 | LLM API (gpt-4.1-nano / Gemini Flash-Lite) | 0 MB | **No** | Vendor ToS | No | Highest raw accuracy (85–92%) | **No** — non-deterministic, model deprecates | Low code, high policy cost |
| 3b | Local small LLM (Qwen3-0.6B / Gemma-3-270M, GGUF via node-llama-cpp) | 200–700 MB | Yes | Apache-2.0 / Gemma ToU | No | 75–85% `[verify]` | Partly — greedy decode is stable per build, not across hardware | Med |
| 4 | Curated domain→category lists (UT1, Citizen Lab, DMOZ/Curlie, adult lists) | 5–100 MB depending on compilation | Yes | Mixed: UT1 permissive `[verify]`, Citizen Lab CC BY-SA 4.0, DMOZ archive legacy ODP licence | **No** | ~95%+ precision on matched domains; coverage is the problem | **Fully** — exact string match, citable list version | Med — quarterly refresh, staleness is the failure mode |
| 5 | **Hybrid: list → rules → embedding fallback** | ~30–80 MB | Yes | MIT/Apache-2.0 throughout | **No** | Highest *defensible* accuracy; per-URL provenance | Yes | Med |

## Findings

### 1. Small local transformer / ONNX models

1. **transformers.js + onnxruntime-node removes Python completely.**
   `@huggingface/transformers` (Apache-2.0) ships JS tokenizers and runs ONNX graphs
   through `onnxruntime-node` (Apache-2.0), which is a prebuilt native binary per
   platform. No Python interpreter, no `child_process` spawn, no pickle. This is the
   single biggest structural win over v1 regardless of which model you pick.
   [transformers.js](https://github.com/huggingface/transformers.js) ·
   [onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node)

2. **The realistic size class is 22M–33M parameters.**
   `all-MiniLM-L6-v2` (22.7M params, Apache-2.0) and `bge-small-en-v1.5` (33M, MIT)
   are the standard small encoders, and both have community ONNX exports under the
   `Xenova/` namespace including int8-quantised variants in the ~25–35 MB range `[verify]`.
   A classification head on top is a few hundred KB. Total artifact is roughly
   **1/20th of the current 700 MB**.
   [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) ·
   [bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) ·
   [Xenova ONNX exports](https://huggingface.co/Xenova)

3. **There is no well-maintained off-the-shelf "URL → content category" ONNX model.**
   This is the key negative finding. HF has news-topic and toxicity classifiers, but
   URL-taxonomy models are either research artifacts or Python-only. The closest
   credible academic work is **Homepage2Vec** (EPFL, MIT licence), which predicts
   ~296 Curlie categories — but it embeds page HTML with XLM-R, so the real
   dependency is a ~1.1 GB multilingual encoder, i.e. worse than the pickle on size.
   Its *labelled dataset* is more valuable to you than its model.
   [Homepage2Vec](https://github.com/epfl-dlab/homepage2vec)

4. **Zero-shot NLI is a trap for bare URLs.** DeBERTa-v3 zero-shot classifiers work on
   prose; a URL is 3–8 subword tokens of mostly out-of-vocabulary domain string. They
   also cost one forward pass *per candidate label*, so a 15-category taxonomy is 15×
   the inference. Only viable if you are also fetching and classifying page text,
   which a forensic tool examining historical history entries generally cannot do
   (pages are gone, and re-fetching from the investigator's network is itself a
   procedural problem).

5. **fastText is the low-size dark horse.** MIT licence, character n-grams handle
   `www.mumsnet-forums.co.uk` style tokens well, quantised models drop to single-digit
   MB `[verify]`, and inference is microseconds. The cost is that Node bindings are
   community native addons with uneven maintenance, which reintroduces a build-toolchain
   dependency — a different flavour of the same problem as the Python spawn.
   [fastText](https://github.com/facebookresearch/fastText)

### 2. Embedding + nearest-centroid

6. **Nearest-centroid is the forensically ideal head.** You embed the URL (or better,
   a normalised string like `domain + path tokens`), compare against N category
   centroids by cosine similarity, and emit the label *plus the similarity score and
   the runner-up*. That gives an investigator a defensible statement — "classified
   shopping, cosine 0.68, next-nearest news 0.41" — where a monolithic classifier
   gives an opaque softmax. Centroids are a ~50 KB JSON file you version and can
   regenerate/audit; the model weights never change.

7. **Quality expectation: good on semantically legible URLs, poor on opaque ones.**
   `bbc.co.uk/news/...` and `etsy.com/listing/...` classify well. `t.co/x7Fq2`,
   `192.168.1.1`, and CDN URLs carry no signal at all — no model of any size fixes
   this, which is an argument for a "unclassified/insufficient signal" output class
   rather than forcing a guess. For a forensic report, "unknown" is a legitimate and
   safer answer than a low-confidence label.

8. **Embedding computation is cheap enough for a full history.** A 33M-param encoder
   on CPU handles order-of-thousands of short strings per second; and crucially you
   only need to embed *unique eTLD+1 values*, not every visit row. A 200k-row history
   typically collapses to a few thousand unique registrable domains, so this is a
   seconds-scale job, not a minutes-scale one `[verify with a benchmark]`.

### 3. LLM API calls

9. **Cost is genuinely trivial and is not the reason to reject this.** At
   gpt-4.1-nano / Gemini Flash-Lite tier pricing (~$0.10/1M input tokens `[verify]`),
   100k URLs batched ~50 per request at ~20 tokens each is ~2–4M tokens ≈ **$0.50–$3**,
   halved again with a Batch API. Latency for a batched run is minutes.
   [OpenAI pricing](https://openai.com/api/pricing/) ·
   [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

10. **It is nevertheless disqualifying for the default path, on three independent grounds.**
    (a) *Evidence exfiltration* — browsing history is the evidence; transmitting it to a
    third party can breach chain-of-custody, GDPR/LED processing rules, and most lab
    accreditation policies (ISO/IEC 17025 style). (b) *Reproducibility* — sampling and
    silent model updates mean re-running the same case months later for a court
    challenge can yield different labels; `temperature=0` does not guarantee
    determinism on these serving stacks. (c) *Longevity* — the endpoint you cited in a
    2026 report may be deprecated by 2027, making the analysis unrepeatable by the
    defence. Any LLM path must be opt-in, off by default, and loudly flagged in output.

11. **A local small LLM sidesteps (a) and (c) but not fully (b).** Qwen3-0.6B or
    Gemma-3-270M as GGUF via `node-llama-cpp` runs offline in Node with no Python.
    Greedy decoding is deterministic for a fixed binary + weights + hardware, but
    differing CPU kernels/quantisation across investigator machines can flip
    borderline tokens. Also 200–700 MB, so the size win over the pickle is modest.
    [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)

### 4. Curated domain lists and public datasets

12. **UT1 (Université Toulouse Capitole) is the strongest single categorised feed.**
    ~80 categories including exactly the ones you want — `adult`, `shopping`,
    `social_networks`, `press` (news), `games`, `gambling`, `webmail`, `financial` —
    actively maintained, the de-facto standard behind SquidGuard/e2guardian. Confirm
    the current licence text and last-modified dates before shipping `[verify]`.
    [UT1 blacklists](https://dsi.ut-capitole.fr/blacklists/index_en.php)

13. **Citizen Lab test lists are small but impeccably licensed and citable.**
    CC BY-SA 4.0, maintained on GitHub, global + per-country lists across ~30
    categories (NEWS, PORN, ECOM, GRP/social, GMB, etc.). Coverage is thousands, not
    millions, of URLs — use it as a high-trust seed and evaluation set rather than
    primary coverage.
    [citizenlab/test-lists](https://github.com/citizenlab/test-lists)

14. **DMOZ/Curlie is huge, taxonomically rich, and stale.** The ODP RDF dumps cover
    millions of sites with a deep category tree, but DMOZ froze in 2017 — it will
    happily categorise dead 2010s sites and know nothing about anything since. Usable
    as *training/centroid-seeding data*, dangerous as a live lookup table.
    [Curlie](https://curlie.org/) · [DMOZ archive dumps](https://curlz.org/dmoz/)

15. **Most popular blocklists are the wrong shape.** StevenBlack hosts, OISD, Hagezi,
    Disconnect, URLhaus, PhishTank are *binary* (block/allow) or threat-typed, not
    content-categorised — with the useful exception of the porn/gambling sub-lists,
    which are strong for the `adult` category specifically.
    [StevenBlack/hosts](https://github.com/StevenBlack/hosts) ·
    [oisd](https://oisd.nl/) · [hagezi DNS blocklists](https://github.com/hagezi/dns-blocklists)

16. **Rank lists are the compression trick.** Intersecting a big category feed with
    **Tranco** (top 1M domains, free, reproducible and versioned by design — each list
    has a permanent citable ID, which is a real forensic virtue) lets you ship a few-MB
    table covering the overwhelming majority of *actual visits* rather than a 100 MB
    table covering the long tail nobody visits. Cloudflare Radar rankings are an
    alternative but are CC BY-NC `[verify]`, which is a problem for a permissively
    licensed tool.
    [Tranco](https://tranco-list.eu/) ·
    [Cloudflare Radar domain rankings](https://radar.cloudflare.com/domains)

17. **Normalise on eTLD+1 with the Public Suffix List (MPL-2.0).** Without it you will
    mis-key `foo.github.io` vs `github.io` and every ccTLD second-level registry.
    Node: the `tldts` package. Cheap, and it removes a whole class of silent
    misclassification.
    [Public Suffix List](https://publicsuffix.org/) · [tldts](https://github.com/remusao/tldts)

18. **Staleness is the maintenance burden, and it is manageable if versioned.** Ship the
    compiled table as a dated, SHA-256-pinned artifact (`categories-2026-03-01.bin`,
    hash recorded in every report). Refresh quarterly. Old cases keep reproducing under
    the old table — which is exactly the property a court needs and which the current
    "download a pickle from a GitHub release" design already half-implements but
    without the hashing or the version-in-report discipline.

### 5. Hybrid — recommended

19. **Layered pipeline, with the winning layer recorded per URL:**
    - **L0 — normalise.** PSL/`tldts` → eTLD+1 + path tokens. Drop `about:`,
      `chrome-extension:`, RFC1918 hosts to an explicit `local/system` class.
    - **L1 — exact domain lookup** against the compiled table (UT1 ∩ Tranco +
      Citizen Lab + curated adult list). Expect this to resolve the large majority of
      *visits* even though it is a minority of *unique domains* — browsing history is
      extremely head-heavy `[verify with a real history sample]`.
    - **L2 — deterministic rules.** Path/keyword heuristics for obvious cases
      (`/cart`, `/checkout` → shopping; `mail.` → webmail; known URL shapes). Fully
      auditable, zero size.
    - **L3 — embedding + nearest-centroid** on the residual tail, emitting label +
      cosine + runner-up, with a confidence floor below which the output is
      `unclassified` rather than a guess.
    - **L4 (opt-in, off by default)** — local or remote LLM, output explicitly marked
      as non-reproducible in the report.
20. **The provenance field is the actual deliverable.** Every classification row should
    carry `{category, method: "list|rule|model|llm", source: "UT1 2026-03-01", score}`.
    That is what lets an investigator justify a label under cross-examination, and it
    is the thing the v1 pickle structurally cannot provide.

## Recommendation

**Adopt option 5 (hybrid), built in this order:**

1. **Ship L0+L1+L2 first.** PSL normalisation + compiled UT1∩Tranco table + rules.
   This alone is a complete, shippable replacement: ~5–15 MB, fully offline, fully
   deterministic, MIT/permissive, zero Python, ~95% precision on what it matches. It
   removes the 700 MB download, the scikit-learn/numpy version pin, and the unpickling
   RCE in one step. Measure L1+L2 coverage on real history samples before doing any ML.
2. **Add L3 only if measured tail coverage justifies it.** `bge-small-en-v1.5` int8
   ONNX (MIT) via transformers.js, nearest-centroid head with centroids seeded from
   the labelled list data and DMOZ/Curlie, checked in as reviewable JSON. +~30 MB.
3. **Do not ship an LLM path as default.** If offered at all, gate it behind an
   explicit opt-in with a warning that results are non-reproducible and that data
   leaves the machine.

Reasoning: the forensic constraint inverts the usual ML tradeoff. A 92%-accurate
opaque model is *worse* than an 85%-accurate transparent pipeline, because the
investigator has to defend individual classifications, not aggregate accuracy. Exact
list matches are trivially defensible; cosine-to-centroid is defensible with a number;
an LLM's answer is not defensible at all. Size and dependency-hygiene wins fall out
of the same choice.

Secondary benefit: the taxonomy becomes *yours*. Right now it is whatever the pickle
was trained on. A list-driven design lets you state the category definitions in the
docs, which is itself a reporting requirement.

## Sources

**Kept**
- transformers.js — https://github.com/huggingface/transformers.js — the Python-free inference path
- onnxruntime-node — https://www.npmjs.com/package/onnxruntime-node — Apache-2.0 native runtime
- bge-small-en-v1.5 — https://huggingface.co/BAAI/bge-small-en-v1.5 — MIT, 33M params, best small encoder
- all-MiniLM-L6-v2 — https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — Apache-2.0 alternative
- Xenova ONNX model namespace — https://huggingface.co/Xenova — where quantised exports live
- UT1 blacklists — https://dsi.ut-capitole.fr/blacklists/index_en.php — primary categorised domain feed
- citizenlab/test-lists — https://github.com/citizenlab/test-lists — CC BY-SA 4.0 seed + eval set
- Tranco — https://tranco-list.eu/ — versioned, citable rank list for compression
- Public Suffix List — https://publicsuffix.org/ — eTLD+1 correctness
- tldts — https://github.com/remusao/tldts — Node PSL implementation
- Homepage2Vec — https://github.com/epfl-dlab/homepage2vec — MIT; dataset more useful than model
- Curlie / DMOZ — https://curlie.org/ — large stale taxonomy, good for centroid seeding
- fastText — https://github.com/facebookresearch/fastText — MIT, smallest viable learned option
- node-llama-cpp — https://github.com/withcatai/node-llama-cpp — offline LLM path if ever needed
- OpenAI pricing — https://openai.com/api/pricing/ — cost check
- Gemini pricing — https://ai.google.dev/gemini-api/docs/pricing — cost check

**Dropped**
- StevenBlack/hosts, OISD, Hagezi, Disconnect, URLhaus, PhishTank — binary/threat lists, not content taxonomies (except adult sub-lists)
- Shallalist — effectively unmaintained; licence unclear for redistribution
- Cloudflare Radar rankings — CC BY-NC conflicts with a permissively licensed tool `[verify]`
- Large zero-shot NLI models — wrong tool for bare URL strings, and 10–30× the size
- Commercial categorisation APIs (Webshrinker, Zvelo, Brandwatch-style) — paid, online-only, same evidence-exfiltration objection as LLM APIs

## Gaps

**Everything marked `[verify]` needs a fetch pass.** Specifically, before this goes into
an ADR:
1. **UT1 licence text and per-category last-modified dates** — the whole L1 recommendation
   hinges on it being redistributable. Check https://dsi.ut-capitole.fr/blacklists/index_en.php.
2. **Actual int8 ONNX file sizes** for `Xenova/bge-small-en-v1.5` and
   `Xenova/all-MiniLM-L6-v2` — read the HF file listings directly.
3. **Whether a maintained off-the-shelf URL-category model exists on HF** that I am
   unaware of — search HF for `url classification`, `website category`, `weborganizer`.
   AllenAI/Princeton "WebOrganizer" topic classifiers are a specific lead worth checking.
4. **Model2Vec JS/Node support status** — if a maintained JS runtime exists, option 1d
   becomes very attractive (single-digit MB, no transformer inference at all).
5. **Empirical head-coverage number**: take a real Chrome `History` DB, compute what
   fraction of *visits* and of *unique eTLD+1* are covered by UT1∩Tranco. This single
   measurement determines whether L3 is needed at all, and it is the highest-value
   next step — cheaper than any further reading.
6. **Current gpt-4.1-nano / Flash-Lite prices** — moves quarterly; cited only to show
   cost is not the objection.

Suggested next steps: (a) run the coverage measurement in gap 5 against a sample
history; (b) confirm gaps 1–3 with direct fetches; (c) prototype L0–L2 as a standalone
module with the provenance field, since it is shippable independent of any ML decision.
