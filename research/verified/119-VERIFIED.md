# VERIFICATION REPORT — ChmaraX/forensix#119 URL classifier options

**Verifies:** `/tmp/forensix-research/119-url-classifier-options.md` (285 lines, unverified)
**Date of fetches:** 2026-08-02
**Method:** every claim below was checked against a page or API response actually
retrieved in this session. The exact URL is given for each. Where I did not fetch
something, it is marked **STILL-UNKNOWN** and the reason is stated. No fact in this
report is from model memory.

Read this alongside the brief, not instead of it. The brief's *architecture* argument
survives verification. Three of its *licence* claims do not, and its single most
important negative claim ("no off-the-shelf URL→category model exists") is wrong.

---

## Scoreboard

| # | Claim under test | Verdict |
|---|---|---|
| 1 | UT1 blacklist is redistributable | **CONFIRMED (redistributable)** |
| 1b | UT1 licence is "permissive" | **REFUTED — it is CC BY-SA 4.0 (copyleft)** |
| 2 | No maintained off-the-shelf URL→category model exists | **REFUTED — WebOrganizer/TopicClassifier exists** |
| 2b | WebOrganizer is a drop-in replacement | **REFUTED — needs page text, no licence, custom code** |
| 3 | int8 ONNX ≈ 25–35 MB | **CONFIRMED — 32.20 MiB and 21.91 MiB exactly** |
| 4 | transformers.js / ORT run in Node with no Python | **CONFIRMED — zero Python references in package** |
| 4b | onnxruntime-node is Apache-2.0 | **CORRECTED — it is MIT** |
| 5 | 100k-URL LLM job costs $0.50–$3 | **CORRECTED — $0.15–$1.85; conclusion unchanged** |
| 6 | Tranco is free, versioned, citable | **CONFIRMED (cadence/citability)** |
| 6b | Tranco is cleanly licensed for a permissive tool | **REFUTED — default list embeds a CC BY-NC source** |
| — | fastText is a live option | **CORRECTED — upstream repo is ARCHIVED** |
| — | Citizen Lab lists are CC BY-SA 4.0 | **STILL-UNKNOWN — repo has no LICENSE file** |
| — | Model2Vec has no Node support | **CORRECTED — a third-party JS package exists** |

---

## Priority 1 — UT1 licence and redistribution terms

### CONFIRMED: UT1 is redistributable.
### REFUTED: it is not "permissive". It is CC BY-SA 4.0.

Fetched `https://dsi.ut-capitole.fr/blacklists/index_en.php`. The live licence block is:

```html
<H2>Licenses</H2>
<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">
<div>This creation is available under un
  <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Contract</a>.</div>
```

**Decisive corroboration.** The download directory
`https://dsi.ut-capitole.fr/blacklists/download/` ships two licence files. I downloaded
both and hashed them:

```
/tmp/ut1_LICENSE.pdf    78194 bytes  md5 df9a1b3eb930697f684e0aae9ee09a58
/tmp/ut1_ccbysa.pdf     78194 bytes  md5 df9a1b3eb930697f684e0aae9ee09a58
```

`LICENSE.pdf` is **byte-identical** to `cc-by-sa-4-0.pdf`. The licence UT1 distributes
with the data is CC BY-SA 4.0. This is not an inference.

**A trap I checked and cleared.** Both the French and English pages contain
`by-nc-sa` (NonCommercial) URLs. I parsed the HTML to test whether they are live:

```
by-nc-sa @5725 in_comment=True     <- inside <!-- --> , not operative
by-nc-sa @5811 in_comment=True     <- inside <!-- --> , not operative
by-sa    @5128 in_comment=False    <- live
by-sa    @5382 in_comment=False    <- live
```

The NC references are vestigial RDF inside HTML comments. **UT1 is BY-SA, not BY-NC-SA.**
Commercial use is permitted. Had this gone the other way it would have killed the
recommendation outright, so it was worth the parse.

### The consequence the brief missed

CC BY-SA 4.0 is copyleft, and its Section 4 explicitly reaches databases. From
`https://creativecommons.org/licenses/by-sa/4.0/legalcode.en`:

> "if You include all or a substantial portion of the database contents in a database
> in which You have Sui Generis Database Rights, then the database in which You have
> Sui Generis Database Rights (but not its individual contents) is **Adapted Material**,
> including for purposes of Section 3(b)"

Section 3(b) is the ShareAlike condition. So a compiled ForensiX category table that
contains a substantial portion of UT1 is Adapted Material and must itself be offered
under CC BY-SA 4.0 or a compatible licence.

**This directly contradicts the brief.** Its comparison table row 5 claims the hybrid is
"MIT/Apache-2.0 throughout" and row 4 calls UT1 "permissive `[verify]`". Both are wrong.
The recommended design ships a copyleft data artifact. That is workable — the *code* can
stay MIT if the table is a separately-licensed data file — but it must be a deliberate,
documented decision, not a surprise. Flag for legal review before the ADR.

### Bonus facts fetched while there

Directory listing `https://dsi.ut-capitole.fr/blacklists/download/`, all files timestamped
**2026-08-01 22:50** — the feed is live, refreshed the day before this check. Sizes:
`all.tar.gz` 24M, `adult.tar.gz` 17M, `malware.tar.gz` 1.9M, `phishing.tar.gz` 1.9M.

I unpacked `press.tar.gz` to confirm the on-disk shape:

```
press/domains
press/urls
press/usage
1000ktok.com
1001newsng.com
100feminin.fr
...
    4644 press/domains
```

Plain newline-delimited domains. Trivially hashable and diffable — good for the
provenance design the brief proposes.

### ⚠ Coverage warning the brief does not raise

Per-category counts from `index_en.php`. The categories ForensiX actually wants are
**tiny**:

| Category | Entries |
|---|---|
| adult | 4,600,370 |
| malware | 271,802 |
| phishing | 269,862 |
| jobsearch | 60,741 |
| games | 35,396 |
| **shopping** | **36,971** |
| gambling | 32,252 |
| **press** (news) | **4,645** |
| **social_networks** | **716** |
| webmail | 413 |
| financial | 473 |

UT1's own page says it plainly: *"Many categories are defined, but it's the main one is
'pornography'. We are actively working on the adult database, but you can help me with
the others one."*

716 domains for all social networks on Earth. 4,645 for all news. The brief's L1 layer
assumption — that a UT1∩Tranco table "resolves the large majority of *visits*" — is
plausible only because browsing is head-heavy, and it is **entirely untested**. Gap 5 in
the brief (measure real head coverage) was already the highest-value next step; these
counts make it the *blocking* step. Do not write the ADR before running it.

---

## Priority 2 — Does an off-the-shelf URL→category model exist?

### REFUTED. The brief's flagged most-likely-error is indeed an error.

The brief's Finding 3 states: *"There is no well-maintained off-the-shelf 'URL → content
category' ONNX model. This is the key negative finding."*

`https://huggingface.co/api/models?search=weborganizer` returns:

```
WebOrganizer/TopicClassifier-NoURL   downloads=113422  likes=14
WebOrganizer/TopicClassifier         downloads=18955   likes=17
WebOrganizer/FormatClassifier        downloads=17573   likes=9
```

From `https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/README.md`:

> "The TopicClassifier organizes web content into 24 categories **based on the URL and
> text contents of web pages**. The model is a gte-base-en-v1.5 with 140M parameters"

It is real, it is URL-aware (the `-NoURL` sibling exists precisely to ablate the URL
signal), it has a paper (`arXiv:2502.10341`), an AI2 project site, and 113k downloads.
The brief was wrong to assert nothing exists.

### But it is not usable as-is, for four independently fatal reasons

**(a) It requires page text, which a forensic tool does not have.**
The README specifies the exact input format:

```
{url}

{text}
```

and `https://raw.githubusercontent.com/CodeCreator/WebOrganizer/main/define_domains/taxonomies/topics.yaml`
shows the annotation template that defined the labels:

```
Consider the following web page:
URL: `{url}`
Content: ```{text}```
...
The URL might help you understand the content. Avoid shortcuts such as word overlap
between the page and the topic descriptions or simple patterns in the URL.
```

The taxonomy was authored with an explicit instruction to *not* lean on the URL. The URL
is a hint alongside the content, not the signal. Feeding it a bare URL with empty text is
off-distribution and its accuracy in that regime is **STILL-UNKNOWN** — I found no
published bare-URL ablation. This is exactly the brief's Finding 4 objection about
zero-shot NLI, and it applies here too.

**(b) The taxonomy is the wrong shape for forensics.** The 24 labels, read from
`config.json` `id2label`:

> Adult, Art & Design, Software Dev., Crime & Law, Education & Jobs, Hardware,
> Entertainment, Social Life, Fashion & Beauty, Finance & Business, Food & Dining,
> Games, Health, History, Home & Hobbies, Industrial, Literature, Politics, Religion,
> Science & Tech., Software, Sports & Fitness, Transportation, Travel

There is **no shopping, no news/press, no social-networks, no gambling, no webmail**.
This is a taxonomy for curating LLM *pre-training corpora* (that is what the paper is
about — "Organize the Web: Constructing Domains Enhances Pre-Training Data Curation"),
not for describing what a person did in a browser. It classifies *subject matter*, not
*site function*. An investigator asking "was he shopping or gambling" gets no answer.

**(c) Licence status is unresolved, and that is disqualifying on its own.**
- `https://huggingface.co/api/models/WebOrganizer/TopicClassifier` → `license: None`.
  No licence field in the model card. The README (fetched in full) contains no licence.
- `https://api.github.com/repos/CodeCreator/WebOrganizer` → `spdx=Apache-2.0`, but that
  covers the **code repository**, not the weights hosted on HF.
- The base model `Alibaba-NLP/gte-base-en-v1.5` is `apache-2.0`.

Un-licensed weights cannot ship in a tool whose output is defended in court.

**(d) It needs `trust_remote_code=True`.** From `config.json`:

```
architectures: ['NewForSequenceClassification']
auto_map: {'AutoModelForSequenceClassification': 'modeling.NewForSequenceClassification', ...}
```

and the README's own usage example passes `trust_remote_code=True`. That downloads and
executes arbitrary Python from the Hub at load time. **This is the same threat class as
the unpickling RCE ForensiX is trying to escape.** Adopting it would move the vulnerability,
not remove it.

**Size**: `model.safetensors` = **524.10 MiB** (fp32). Better than 700 MB, not decisively.

### The genuinely useful thing this turned up

`https://huggingface.co/api/models/Alibaba-NLP/gte-base-en-v1.5?blobs=true`:

```
tags: ['onnx', 'transformers.js', 'custom_code']
onnx/model.onnx:        530.10 MiB
onnx/model_int8.onnx:   139.75 MiB
onnx/model_fp16.onnx:   265.32 MiB
```

The WebOrganizer base architecture **already has official ONNX exports and is tagged
`transformers.js`**. So the arch is Node-runnable without Python. If ForensiX ever wanted
a WebOrganizer-style head, self-exporting to int8 ONNX is a real path landing near
**~140 MiB** (inferred from the base model's int8 size — I did not export and measure
WebOrganizer itself, so treat that number as an estimate, not a fetched fact).

That does not rescue problems (a), (b) or (c). Recommend: **do not adopt WebOrganizer as
a classifier.** Its taxonomy YAML and its two annotation datasets are still worth mining
as centroid-seeding and eval data, which is the same verdict the brief reached about
Homepage2Vec.

### Other candidates checked and dismissed

Searches for `url+classification`, `website+category`, `url+category`, `domain+classification`
returned only phishing/malicious-URL binary classifiers and hobby repos in single-digit
downloads (`SanandaDutta/website-category-distilbert`, dl=32; `kavip/urlclassification`,
dl=0; `nishnk/url_classification_model.pkl`, dl=0). One notable entry:
`allenai/dolma3-fasttext-weborganizer-topic-classifier`, apache-2.0 — but `model.bin` is
**4,006 MiB**. Nearly 6× the current pickle. Rejected on size.

**Net verdict:** the brief's *conclusion* (build your own head, do not adopt an
off-the-shelf URL classifier) survives. Its *reasoning* ("none exists") must be replaced
with "one exists and here is why it does not fit."

---

## Priority 3 — Real int8 ONNX file sizes

### CONFIRMED, with exact bytes. The brief's 25–35 MB estimate was accurate.

Source: `https://huggingface.co/api/models/{id}?blobs=true`.

**`Xenova/bge-small-en-v1.5`** — lastModified 2025-07-22, 411,041 downloads:

| File | Bytes | MiB |
|---|---|---|
| model.onnx (fp32) | 133,093,490 | 126.93 |
| model_fp16.onnx | 66,749,212 | 63.66 |
| **model_int8.onnx** | **33,760,831** | **32.20** |
| model_quantized.onnx | 34,014,426 | 32.44 |
| model_uint8.onnx | 33,760,859 | 32.20 |
| model_q4f16.onnx | 36,190,171 | 34.51 |

**`Xenova/all-MiniLM-L6-v2`** — lastModified 2025-07-22, 2,899,209 downloads:

| File | Bytes | MiB |
|---|---|---|
| model.onnx (fp32) | 90,387,606 | 86.20 |
| model_fp16.onnx | 45,297,825 | 43.20 |
| **model_int8.onnx** | **22,972,370** | **21.91** |
| model_quantized.onnx | 22,972,370 | 21.91 |
| model_uint8.onnx | 22,845,806 | 21.79 |

MiniLM int8 is **21.91 MiB**, slightly *below* the brief's floor. bge-small int8 is
**32.20 MiB**, inside the stated band. The brief's "roughly 1/20th of 700 MB" holds:
32.20 MiB is 1/21.7 of 700 MB.

### Licence correction on the ONNX re-hosts

- `BAAI/bge-small-en-v1.5` → `license: mit` ✅ (brief correct)
- `sentence-transformers/all-MiniLM-L6-v2` → `license: apache-2.0` ✅ (brief correct)
- `Xenova/all-MiniLM-L6-v2` → `license: apache-2.0` ✅
- **`Xenova/bge-small-en-v1.5` → `license: None`** ⚠

The Xenova re-host of bge-small declares **no licence**. The upstream BAAI model is MIT,
but the re-hosted ONNX artifact you would actually ship carries no licence grant. Either
re-export from BAAI yourself, or use `Xenova/all-MiniLM-L6-v2`, which is cleanly
apache-2.0 and 10 MiB smaller. **Recommend MiniLM on licence-hygiene grounds** — a
reversal of the brief's preference for bge-small.

---

## Priority 4 — Do these genuinely run in Node with no Python?

### CONFIRMED. Strongly.

I downloaded the actual `onnxruntime-node@1.27.0` tarball from the registry, unpacked it,
and grepped the whole package:

```
grep -rniE "python|\.py\b|pip install" package --include=*.js --include=*.json --include=*.ts
(end python grep)          <- zero matches
```

**Zero Python references anywhere in the shipped package.** The postinstall is
`node ./script/install`, and `package/script/install.js` opens with:

```js
// This script is written in JavaScript. This is because it is used in "install" script
// in package.json ... TypeScript is not always available.
// The purpose of this script is to download the required binaries for the platform...
// Currently, most of the binaries are already bundled in the package, except for the
// files that described in the file install-metadata.js.
// Some files (eg. the CUDA EP binaries) are not bundled because they are too large...
```

**The CPU binaries are bundled in the npm package.** Only the CUDA execution provider is
fetched at install time, and it is skippable via `--onnxruntime-node-install=skip`. For an
offline forensic tool this is the right property: `npm ci` with the CPU EP needs no
network beyond the registry, and no toolchain.

Registry metadata:

| Package | Version | Licence | Deps | Downloads/mo |
|---|---|---|---|---|
| `onnxruntime-node` | 1.27.0 | **MIT** | adm-zip, global-agent, onnxruntime-common | 13,981,827 |
| `@huggingface/transformers` | 4.2.0 | Apache-2.0 | @huggingface/jinja, @huggingface/tokenizers, onnxruntime-node@1.24.3, onnxruntime-web, sharp | 7,013,734 |
| `tldts` | — | MIT | — | 271,454,163 |

`os: ['win32','darwin','linux']`.
`https://api.github.com/repos/microsoft/onnxruntime` → `spdx: MIT`.
`https://api.github.com/repos/huggingface/transformers.js` → `spdx: Apache-2.0`, pushed
**2026-07-31**, 16,223 stars. Actively maintained as of two days before this check.

**Correction:** the brief calls `onnxruntime-node` "Apache-2.0" twice (Finding 1 and the
comparison table). Both npm metadata and the upstream repo say **MIT**. MIT is *more*
permissive, so this does not harm the recommendation, but the ADR must not repeat it.

**Two caveats the brief omits:**
1. The npm package is **`@huggingface/transformers`**, not `transformers.js`. The latter
   is the repo name. v3+ renamed the package.
2. `@huggingface/transformers` pulls **`sharp`** (native image lib) and
   **`onnxruntime-web`** as hard dependencies — dead weight for a text-only tool. If
   dependency surface matters, calling `onnxruntime-node` directly with a pre-tokenised
   input, or using `@huggingface/tokenizers` alone, is leaner. Worth a note in the ADR.

---

## Priority 5 — LLM pricing sanity check

### CORRECTED (numbers), CONFIRMED (conclusion).

Source: `https://platform.openai.com/docs/pricing.md` (markdown variant; the HTML page is
JS-rendered) and `https://ai.google.dev/gemini-api/docs/pricing`.

Per 1M tokens, USD:

| Model | Input | Output | Batch in | Batch out |
|---|---|---|---|---|
| gpt-4.1-nano | **$0.10** | $0.40 | $0.05 | $0.20 |
| gpt-5-nano | $0.05 | $0.40 | $0.025 | $0.20 |
| gpt-5.4-nano | $0.20 | $1.25 | $0.10 | $0.625 |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | — | — |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.15 | $1.25 |

The brief's cited "~$0.10/1M input tokens" is **exactly right for gpt-4.1-nano**. It is
**wrong for Gemini Flash-Lite**, which is now $0.25–$0.30 input — 2.5–3× higher. The brief
lumps them as one price tier; they are not.

Recomputing the brief's own scenario (100k URLs, ~50/request, ~20 tokens each → ~2M input
tokens, plus ~0.5M output tokens for short labels):

| Path | Cost |
|---|---|
| gpt-5-nano, Batch API | **$0.15** |
| gpt-4.1-nano, Batch API | $0.20 |
| gpt-5-nano, standard | $0.30 |
| gpt-4.1-nano, standard | $0.40 |
| Gemini 3.1 Flash-Lite | $1.25 |
| Gemini 3.5 Flash-Lite | $1.85 |

**$0.15–$1.85**, against the brief's stated $0.50–$3. The brief was conservative at the
low end and slightly high at the top. Its Finding 9 — *"cost is genuinely trivial and is
not the reason to reject this"* — is **CONFIRMED and if anything understated**.

The rejection stands on the brief's Finding 10 grounds (evidence exfiltration,
reproducibility, endpoint longevity), which are policy arguments and were never in scope
for factual verification. I note in passing that the pricing table's model roster
(gpt-5.4, gpt-5.2, gpt-5.1, gpt-5, gpt-4.1, gpt-4o, o3, o4-mini, plus "legacy" markers on
gpt-3.5-turbo and davinci-002) is itself direct evidence for the longevity argument: the
endpoint roster visibly churns.

---

## Priority 6 — Tranco licence and cadence

### CONFIRMED: cadence, permanence, citability.
### REFUTED: "free" in the sense a permissively-licensed tool needs.

From `https://tranco-list.eu/`:

> "A daily update to the list is made available by 0:00 UTC; the **Last-Modified** header
> provides an exact timestamp."

> "We archive all generated rankings and supply a **permanent link** to a page with
> additional information on the methodology ... and the ability to download **the exact
> same list as was used in the study**. This improves the validity of research results ...
> as well as reproducibility by keeping a permanent reference to the rankings."

Daily cadence and permanent citable list IDs: **CONFIRMED**. The brief's characterisation
of this as "a real forensic virtue" is well-founded — it is arguably the single most
forensically-aligned property of any source in the brief.

### The licence problem

**Tranco publishes no licence for its own compiled list.** I grepped
`/methodology`, `/faq` and `/privacy` for `licen|terms of use|copyright|redistribut|CC BY`:

```
--- https://tranco-list.eu/methodology --- (no licence keyword found)
--- https://tranco-list.eu/faq ---         (no licence keyword found)
--- https://tranco-list.eu/privacy ---     (no licence keyword found)
```

`https://api.github.com/repos/DistriNet/tranco-list` → `spdx: None`, last pushed
**2020-03-05**.

What the front page *does* say is an attribution notice for its inputs:

> "We currently use the lists from five providers: Cisco Umbrella (available free of
> charge), and Majestic (available under a **CC BY 3.0** license), Farsight (only for the
> default list), the Chrome User Experience Report (CrUX) (available under a
> **CC BY-SA 4.0** license), and **Cloudflare Radar (available under a CC BY-NC 4.0
> license)**."

> "The Chrome User Experience Report and Cloudflare Radar rankings have been integrated
> into the **default Tranco list** since August 1, 2023."

**This inverts one of the brief's own conclusions.** The brief lists Cloudflare Radar
under *Dropped* because "CC BY-NC conflicts with a permissively licensed tool `[verify]`".
That instinct is **CONFIRMED correct** — and it turns out Cloudflare Radar is *inside the
default Tranco list*. Shipping default Tranco does not avoid the NC problem; it inherits
it. CrUX also drags in another CC BY-SA 4.0 obligation, compounding the UT1 copyleft
finding.

**Mitigation, verified to exist:** the front page offers *"You can customize your list to
have specific properties. Configure a custom list"*. A list configured to exclude
Cloudflare Radar (and optionally CrUX) would leave Umbrella (free of charge) and Majestic
(CC BY 3.0, permissive-with-attribution). Whether the custom-list builder exposes
per-provider selection is **STILL-UNKNOWN** — the configurator is an interactive form I
did not drive. **This is the single most actionable follow-up in this report**, because
it is the difference between an NC-encumbered artifact and a clean one, and it is
probably ten minutes of work.

---

## Corrections to claims the brief made in passing

### fastText is archived. CORRECTED — this is worse than the brief thought.

`https://api.github.com/repos/facebookresearch/fastText`:

```
spdx=MIT  pushed=2024-03-22  stars=26547  archived=True
```

**`archived: True`.** The brief's Finding 5 calls fastText "the low-size dark horse" and
worries only about Node binding maintenance. The upstream project itself is frozen.

The binding situation is worse than "uneven maintenance":

| npm package | Latest | Last publish | Licence |
|---|---|---|---|
| `fasttext` | 1.0.0 | **2019-07-17** | MIT |
| `node-fasttext` | 1.0.0-alpha.1 | **2016-12-12** | none |
| `fasttext.js` | 1.1.4 | 2023-03-22 | none |

Nothing published in three years; two of three declare no licence. **Recommend striking
option 1c from the comparison table**, or re-labelling its maintenance column from
"Low–Med" to "Unmaintained upstream". A forensic tool cannot depend on this.

### Model2Vec Node support. CORRECTED — it exists, but it is hobby-scale.

The brief's Gap 4 asks whether a maintained JS runtime exists. Partial answer:

- `https://api.github.com/repos/MinishLab/model2vec` → `spdx=MIT`, pushed **2026-08-01**,
  2,171 stars. The Python project is healthy and current.
- `minishlab/potion-base-8M` → `license: mit`, 676,635 downloads.
- npm: **`@yarflam/potion-base-8m@1.0.4`** — *"Fast Model2Vec inference for potion-base-8M
  embeddings without ONNX or heavy ML"*, MIT, published 2026-03-28, **zero dependencies**,
  unpacked **30.9 MB**.

But: **1,288 downloads/month, 3 versions ever, one maintainer, not affiliated with
MiniShLab.** Compare `onnxruntime-node` at 14M/month. Zero-dependency and 30.9 MB is
genuinely attractive, and no-ONNX means no native binary at all — but a single-maintainer
package with three releases is a supply-chain risk profile a forensic tool should not
take on the critical path. **Verdict: option 1d is now *possible* rather than *blocked*,
but should stay off the recommended path.** If pursued, vendor the weights and reimplement
the lookup — it is a static embedding table, the "inference" is a hash-and-average.

### Citizen Lab licence. STILL-UNKNOWN.

The brief states Citizen Lab test-lists are "CC BY-SA 4.0" and "impeccably licensed". I
could not verify this.

```
https://api.github.com/repos/citizenlab/test-lists  ->  spdx=None, default_branch=master
https://raw.githubusercontent.com/citizenlab/test-lists/master/LICENSE  ->  HTTP 404
https://raw.githubusercontent.com/citizenlab/test-lists/main/LICENSE    ->  HTTP 404
root contents: ['.github', '.gitignore', 'README.md', 'lists', 'output', 'scripts']
```

**No LICENSE file exists in the repository**, and grepping the README for
`licen|creative commons|CC BY` returned nothing. The repo is alive (pushed 2026-07-30,
542 stars) and the README documents the four-theme category scheme the brief describes,
so the *content* claim holds. The *licence* claim does not — I found no licence grant.

It may be stated on a Citizen Lab or OONI web property I did not fetch. Until someone
finds it in writing, **treat Citizen Lab lists as unlicensed** and do not redistribute
them in a shipped artifact. Downgrade the brief's "impeccably licensed and citable".

### Claims spot-checked and CONFIRMED

| Claim | Source | Result |
|---|---|---|
| Public Suffix List is MPL-2.0 | `raw.githubusercontent.com/publicsuffix/list/master/LICENSE` → "Mozilla Public License Version 2.0" | ✅ |
| `tldts` is MIT | `api.github.com/repos/remusao/tldts` → `spdx=MIT`, pushed 2026-08-02 | ✅ + 271M dl/mo |
| Homepage2Vec is MIT | `api.github.com/repos/epfl-dlab/homepage2vec` → `spdx=MIT` | ✅ but pushed **2024-01-22**, 48 stars — staler than implied |
| transformers.js Apache-2.0 | `api.github.com/repos/huggingface/transformers.js` | ✅ |
| ONNX Runtime licence | `api.github.com/repos/microsoft/onnxruntime` → `spdx=MIT` | MIT, not Apache-2.0 |

---

## Still unknown, and why

1. **WebOrganizer accuracy on bare URLs (empty text).** No published ablation found. The
   `-NoURL` variant proves the URL carries signal, but not the converse. Would need an
   experiment, not a fetch.
2. **WebOrganizer weights licence.** Model card has no licence field; repo Apache-2.0
   covers code only. Needs an email to the authors.
3. **Citizen Lab test-lists licence.** No LICENSE file, no README mention. See above.
4. **Tranco's own licence, and whether the custom-list builder can exclude Cloudflare
   Radar.** No licence text on any page I fetched; the configurator is an interactive form
   I did not drive. **Highest-value follow-up.**
5. **Empirical head coverage** (brief Gap 5). Unchanged and now *more* urgent given the
   UT1 category counts above. Requires a real Chrome `History` DB, not a web fetch.
6. **Real int8 inference throughput in Node.** Requires a benchmark. The brief's Finding 8
   "seconds-scale" claim remains unverified.
7. **Actual size of a self-exported int8 WebOrganizer ONNX.** I inferred ~140 MiB from the
   base model's `model_int8.onnx` (139.75 MiB). Not measured.

---

## Net effect on the recommendation

**The architecture survives.** Layered list → rules → embedding fallback, with per-URL
provenance, is not undermined by anything verified here. Priorities 3 and 4 came back
clean and better than claimed: 21.91 MiB for MiniLM int8, zero Python anywhere in the
runtime chain, MIT/Apache-2.0 code licences, 14M monthly downloads on the runtime.

**Four things must change before the ADR:**

1. **Stop calling the artifact permissively licensed.** UT1 is CC BY-SA 4.0 and its
   Section 4 makes a substantially-derived table Adapted Material under ShareAlike. The
   compiled data file must be CC BY-SA 4.0 or compatible. Code can remain MIT. Say so
   explicitly; get it reviewed.
2. **Resolve Tranco's provider mix before shipping.** Default Tranco embeds Cloudflare
   Radar (CC BY-NC 4.0). Either configure a custom list without it, or drop Tranco. The
   brief's own instinct to reject CC BY-NC was right — it just did not notice the
   dependency was already inside its recommendation.
3. **Rewrite Finding 3.** "No off-the-shelf model exists" is false. Replace with
   WebOrganizer named, and the four concrete reasons it does not fit: needs page text,
   corpus-curation taxonomy with no shopping/news/social, unlicensed weights, and
   `trust_remote_code` — that last one being the same RCE class as the pickle.
4. **Prefer `Xenova/all-MiniLM-L6-v2` over `Xenova/bge-small-en-v1.5`.** 21.91 MiB vs
   32.20 MiB, and — decisively — apache-2.0 vs no declared licence on the artifact you
   would actually ship.

**Two things to strike or downgrade:** fastText (upstream archived, bindings dead since
2019) and Citizen Lab's "impeccably licensed" (no LICENSE file exists).

**One thing to raise in priority:** the coverage measurement. UT1 has 716 social-network
domains, 4,645 news domains and 36,971 shopping domains. Whether that resolves "the large
majority of visits" is now the load-bearing unknown in the entire design, and it is the
one question no amount of further reading can answer.
