# Research: Blind-run synthesis — three independent answers to the same classification question

> **Numbering note.** This brief is companion evidence for
> [#136](https://github.com/ChmaraX/forensix/issues/136), alongside the primary deliverable
> `research/136-approach-survey.md`. It was briefly named `137-*`; that was wrong — issue #137 is the
> **evaluation-harness ticket** ("Classifier evaluation harness and labelled ground truth") and its
> deliverable slot `137-harness.md` is reserved. Findings here that belong to the harness (domain-grouped
> split, Curlie as candidate supervision) are flagged for #137 but filed under #136.

> **Scope note.** This brief compares three answers to one question — *"how to classify 100k+ Chrome
> history rows (title + URL) into categories, offline, fast"* — produced independently, under different
> access conditions. It is a **meta-brief**: it makes no primary claims of its own about models, licences or
> datasets. Every claim below is tagged with the source that owns it. Where the sources disagree, the
> disagreement is reported rather than resolved by preference. The one exception is §5 (Curlie), where a
> verification run has since been completed and its findings are joined in — owned throughout by
> `research/_raw/curlie-verification.md`, not by this brief.

> **Evidence rule carried over from [#136](https://github.com/ChmaraX/forensix/issues/136).** No accuracy,
> F1 or coverage figure from S2 or S3 is carried into this brief as a fact. Where a figure is discussed at
> all it appears in the quarantine table (Finding 14) as an **explicitly-unverified quote**, attributed,
> and it must not be lifted out of that table.

## The three sources

| ID | Source | Access conditions | Verification status |
|---|---|---|---|
| **S1** | `research/136-approach-survey.md` + `research/_raw/119-url-classifier-options.md` | Repo context; #136 had live primary fetches recorded in `research/_raw/fetch-manifest.md`; #119 explicitly had **no** web tool and marks its own numbers `[verify]` | **Verified** for #136 (byte sizes, licences, `id2label`, HTTP statuses all captured on disk). #119 is structurally sound but numerically unverified by its own admission, and #136 corrected two of its load-bearing claims |
| **S2** | `/tmp/isolated-url-research/findings.md` | Context-isolated agent run: **no repo access, no web access**. Did not know forensix exists, did not know the taxonomy, did not know the v1 pickle problem | **Unverified.** Its own Gaps section states no live search was available and that UT1/Curlie details "should be spot-checked before implementation" |
| **S3** | `/tmp/run3-background.md` | ChatGPT with web search, summarised by the user. Citations carry `utm_source=chatgpt.com` redirects | **Unverified.** Cited URLs were not fetched or checked by this repo. Treat every S3 URL as a lead, not as evidence |

**S2 and S3 are blind runs relative to this project.** Neither had the forensic requirement, the 700 MB
pickle history, the Node-only constraint, or the v2 taxonomy. That is the point: it makes their overlap
with S1 informative in a way that a briefed run's overlap would not be.

## Findings

### 1. Convergence — what all three reached independently

1. **All three converged on the same three-part shape. CONFIRMED as a convergence fact** (i.e. confirmed
   that all three texts say it; not a confirmation that the shape is correct):

   | Element | S1 | S2 | S3 |
   |---|---|---|---|
   | **Deterministic domain-list tier keyed on eTLD+1 via the Public Suffix List** | Yes — #119 L0/L1, #136 Finding 21 "rank 6, the deterministic list tier … keyed on eTLD+1 via the Public Suffix List with `tldts`" | Yes — Finding 1, "deduplicate by registrable domain first", `tldextract` | Yes — pipeline step 1, "Public Suffix List, not last-two-labels", called "the single biggest performance optimization" |
   | **Single-pass cheap classifier for the residual tail** | Yes — #136 families 1/3/3b, "1 encoder pass per row, constant in N"; entailment demoted precisely because it is N passes | Yes — Finding 3/4, fastText or TF-IDF + linear, explicitly because it is fast on CPU | Yes — step 3, char n-gram + linear as the "best main model"; step 4 forbids running the transformer on 100% of rows |
   | **An abstain / "unknown" outcome** | Yes — #136 taxonomy label *Unclassified / insufficient signal*, marked **mandatory**; #119 Finding 7 | Weakly — the LLM tier exists to raise coverage rather than to abstain; abstention is implied by "low-confidence" routing, not named as an output class | Yes — step 5, explicit: "return 'Unknown' below a confidence threshold" |
   | **A hand-rule tier 0 above the list** | Yes — #119 L2 deterministic rules | Yes — Finding 7 | Yes — methodology point 4 |
   | **Local LLM is not the main path** | Yes — #136 family 4 rejected on size + determinism | Yes — "fallback tier only, batched by domain — not for all 100k rows" | Yes — ranking table verdict: "Overkill" |

2. **Why the convergence is itself evidence.** Two of the three runs had no access to this repo, to the
   forensic constraints, or to each other. They still produced the same layering, the same normalisation
   key, the same "cheap first, expensive only on the residual" ordering, and the same rejection of a
   full-history LLM pass. That means the architecture is **not** an artefact of forensix's particular
   constraints — it is the shape the problem has for anyone, and the forensic requirements merely make it
   *additionally* mandatory. Practical consequence: the layered design is now safe to treat as settled, and
   further research effort should not be spent re-litigating "should it be layered?" It should go to the
   items in Gaps.

3. **The convergence is weaker than it looks in one specific respect. STILL-UNKNOWN.** All three assert
   that the list tier resolves the bulk of *visits* because of Zipf-like domain skew — S1 #119 L1
   (`[verify with a real history sample]`), S2 Finding 7, S3 methodology point 4. **None of the three
   measured it.** S2 and S3 cite the skew as a standard property of browsing distributions; S1 has carried
   it as an open gap since #119 gap 5 and again as #136 gap 7. Three sources repeating an unmeasured
   premise is not three-way confirmation — it is the same assumption arriving three times. This is still
   the cheapest and highest-value unmeasured number in the whole programme.

### 2. Divergence — and why

4. **The sharpest divergence is the runtime substrate: fastText/Python (S2, S3) vs ONNX/Node (S1).**
   - **S2** recommends `tldextract` (Python) + fastText supervised, quantised, with scikit-learn as the
     no-dependency alternative and Ollama as the tail. Its concrete stack is Python end to end.
   - **S3** recommends `HashingVectorizer`/TF-IDF + LogisticRegression/LinearSVM/SGDClassifier, with
     fastText as "excellent alternative" — also Python end to end, and explicitly notes the winner
     "depends on taxonomy/training data, not algorithm".
   - **S1** rules Python out at the *architecture* level, not the model level. #119's entire premise is
     removing the ~700 MB scikit-learn pickle, the Python spawn and the unpickling RCE; #119 Finding 1
     names transformers.js + `onnxruntime-node` as "the single biggest structural win over v1 regardless of
     which model you pick".
   - **This is not a disagreement about which classifier is better. It is a disagreement about what is
     shippable**, and only S1 knew the constraint. S2 and S3 answered the stated question correctly; the
     stated question was missing the deployment target.

5. **S1 did not reject fastText — it deferred it, and for the same reason both blind runs missed.**
   CONFIRMED [S1, #136 rejection log; S1, #119 Finding 5]. #136 logs fastText as: code is MIT
   [`ext/fasttext-LICENSE`], size would be attractive, but consuming it from Node requires a **native
   addon**, reintroducing a build toolchain — "a different flavour of the v1 Python-spawn problem". #136
   records it as "not shortlisted; not fully rejected — worth a separate spike if the shortlist
   underdelivers". So the two blind runs independently pointing at fastText is a mild signal that the spike
   is worth doing, but it does not touch the objection, because neither run knew there was a Node
   constraint to object to.

6. **Only S1 knows the forensic constraints, and they change the answer, not just the tone.** CONFIRMED
   [S1 only]. Three constraints appear in S1 and in **neither** blind run:
   - **Determinism across machines.** #119 Finding 10(b) and Finding 11 (greedy decode stable per build,
     not across hardware); #136 Finding 18 ranks static embeddings partly *because* a lookup-plus-pooling
     graph has no attention kernel whose reduction order can vary; #136 gap 6 leaves int8 transformer
     determinism explicitly unverified. S3's ranking table calls a local LLM "Overkill" on *cost* grounds;
     S1 rejects it on *reproducibility* grounds. Same verdict, different and non-interchangeable reasoning
     — and the reasoning is what survives cross-examination.
   - **Per-decision provenance.** #119 Finding 20: every row carries
     `{category, method: "list|rule|model|llm", source: "UT1 2026-03-01", score}`, and calls that field
     "the actual deliverable". #136 builds the whole family comparison around "forensic explanation of one
     decision" as a *column*. S2 mentions "keep confidence + tier provenance" in its architecture block —
     one clause, no version pinning, no hashing. S3 stores a confidence but not a source.
   - **Licence hygiene on a shipped artifact.** #136 Findings 11–17 are an entire section: the ONNX-mirror
     no-licence trap quantified (Xenova 80/100, onnx-community 48/100 declaring no licence), UT1 corrected
     to **CC BY-SA 4.0** with the `rel="license"` tag captured, Tranco's licence downgraded to
     STILL-UNKNOWN after a 404 and a 403, Citizen Lab's grant left unknown, Homepage2Vec's weights licence
     left unknown. S2 states UT1 is "redistributable (CC BY-SA)" in passing without treating copyleft on a
     compiled derivative as a decision the project must take. S3 does not discuss licence obligations of
     the shipped table at all.
   - **Consequence.** A synthesis that merges S2/S3 recommendations into the pipeline without re-imposing
     these three constraints will produce something faster to build and unusable in a report.

7. **Divergence on the taxonomy, and this one favours S1 decisively. CONFIRMED [S1 §7].** S2 suggests ~20
   generic classes; S3 suggests ~20–40 and lists ~30. Both lists are *product* taxonomies — Video/Streaming,
   Music, Photography, Real Estate, Design. #136 §7 argues a forensic taxonomy must be a list of questions
   an investigator is asked in a report, and its 14 + 1 labels each carry that question explicitly
   (Gambling → motive evidence in embezzlement; Employment → insider-threat precursor; Anonymity tooling →
   counter-forensic preparation; File sharing → exfil vector). Neither blind run has Gambling, Anonymity
   tooling, File-sharing-as-exfil or Crypto-as-its-own-class, because neither was asked a forensic question.
   **S1's taxonomy stands; the blind-run taxonomies are useful only as evidence that a coarse fixed set,
   with all tiers emitting the same labels, is the normal approach — which all three agree on.**

8. **Divergence on the two-axis idea, with independent arrival. CONFIRMED as convergence [S1 #136 Finding
   24; S3 "two-axis classification"].** #136 Finding 24 proposes topic and *format* as orthogonal axes on
   the same forward pass, derived from WebOrganizer's separate format classifier. S3 independently proposes
   `service_category` + `topic_category` plus confidence, "instead of forcing one label". These are not the
   same second axis — S1's is *format* (News Article / Product Page / Q&A Forum), S3's is *service* (Video /
   Social / Shopping) — but both runs independently concluded that one label per row is under-specified.
   That raises the priority of #136 Finding 24 from a suggestion to a design question worth an explicit
   decision.

9. **Non-divergence worth stating: nobody found an off-the-shelf URL→category model.** CONFIRMED [S1 #136
   Findings 5–6, enumerated: `search=url classification` returned 8 models, top one had 5 downloads, none
   ship ONNX; WebOrganizer fails four independent filters]. S2 and S3 both route around the gap by proposing
   to *train* a classifier on Curlie/DMOZ-derived labels rather than adopt one — i.e. they reached the same
   negative finding implicitly, by never proposing a pretrained URL classifier at all. S1 is the only source
   that measured the absence rather than assuming it.

### 3. The four methodology items unique to S3

10. **These four are S3's real contribution and none of them appear in S1 or S2.** They are *method*, not
    *model choice*, which is why a web-search run could surface them and why they survive S3's verification
    problems: each can be adopted or rejected on its own logic without trusting an S3 citation. Ownership:
    **S3 only**, unverified.

    | # | S3 item | What it says | Where it belongs | Assessment against S1's constraints |
    |---|---|---|---|---|
    | (a) | **Domain-dedupe-then-propagate** | Classify each eTLD+1 once, join the label back to all rows | **Pipeline design** (an L0 property, ahead of L1) | Compatible and already half-present: S1 #119 Finding 8 says "you only need to embed *unique* eTLD+1 values, not every visit row". S3 states it as a pipeline invariant rather than a model-tier optimisation, which is stronger. **Caveat S3 does not raise:** propagation makes the *unit of classification* the domain, so a per-row provenance field must record that the row's label was inherited, not computed — otherwise the report over-claims. That caveat is S1's constraint applied to S3's method |
    | (b) | **Title aggregation per domain** | Classify `github.com` once from a sample of its observed titles, not from the bare domain string | **Pipeline design** | The genuinely new idea. It converts the single strongest S1 asset — Chrome gives titles, not just URLs — into a *per-domain* feature instead of a per-row one, which is exactly what (a) requires to not throw signal away. **Open question S3 does not answer:** which titles, how many, and whether the sample is deterministic. For forensix it must be deterministic and recorded, or two runs over the same history can label the same domain differently. Belongs in pipeline design **with a determinism requirement attached** |
    | (c) | **Domain-grouped train/test split** | Never split individual URLs randomly; split by registrable domain, or the model memorises `youtube.com → video` and accuracy is inflated | **Harness ticket** — this is an evaluation-protocol rule | The most important of the four, and the one most likely to be got wrong by default. It also retroactively explains why URL-classification accuracy figures in the literature are hard to compare, which is an argument for S1's existing rule that no external accuracy number is carried into a brief. Should be written into the harness ticket as a hard requirement before any number is produced |
    | (d) | **Active-learning loop** | Classify everything → sort unresolved domains by visit count → hand-label the top N → retrain → repeat on low-confidence | **Harness ticket** first (it is how the eval/label set gets built), **then** a maintenance process | Compatible with S1, and it is the concrete answer to S1's unanswered "where does labelled data come from" for #136 Finding 22 ("family 1 survives only as train our own head"). Visit-count ordering is the right prioritisation because it aligns labelling effort with the same head-heaviness the list tier exploits. **S1 constraint to attach:** the resulting label set becomes a shipped, versioned, hash-pinned artifact like any list, per #119 Finding 18 |

11. **Split of the four: (a) and (b) are pipeline design; (c) and (d) are harness.** Stated explicitly
    because the two tickets have different owners and different definitions of done — (a)/(b) change what
    the tool computes, (c)/(d) change what a measurement is allowed to claim.

### 4. Contradictions between sources

12. **S3 repeats the Homepage2Vec "MIT licence" claim that #136 Finding 17 corrected. FLAGGED — do not
    propagate.** CONFIRMED [S1, #136 Finding 17]. #136 fetched `ext/homepage2vec-LICENSE` and found MIT-style
    text whose copyright line reads *"Copyright (c) 2018 The Python Packaging Authority"* — a cookiecutter
    template default naming neither EPFL nor the authors. #136's conclusion: the **code** licence is
    CONFIRMED MIT-text; what governs the separately-distributed **weights** is **STILL-UNKNOWN**. #119 had
    cited Homepage2Vec as "MIT licence" without the caveat, and #136 explicitly names that as a #119 defect
    it is correcting. S3 reproduces the uncorrected form ("package is MIT-licensed"), presumably from the
    same PyPI/GitHub surface that misled #119. **This is a worked example of a claim that is true of the
    repo's LICENSE file and not established for the artifact you would actually ship**, and it is the second
    time it has entered this project's research from outside. It should be treated as a known-bad claim: if
    Homepage2Vec is used, its *dataset/methodology* is the usable part (S1 #119 Finding 3, S3's own verdict,
    and S2's Finding 2 all agree on that much), and the weights need their own licence determination.

13. **Second-order contradiction: S2 states UT1 is "redistributable (CC BY-SA)" as a simple positive.**
    CONFIRMED that S1 says more [#136 Finding 14]. S1 fetched the page, captured the
    `rel="license" href="…by-sa/4.0/"` tag, and drew the consequence S2 does not: CC BY-SA 4.0 is
    **copyleft on a shipped artifact**, so a compiled domain→category table derived from UT1 is a derivative
    work with share-alike obligations. Not disqualifying — #136 says so — but a deliberate licensing decision
    that must appear in the tool's notices. S2 is not wrong; it is under-specified in exactly the way a run
    without the shipping constraint would be.

14. **Quarantine table — figures quoted from S2/S3, carried as quotes only, never as facts.** These exist
    here solely so that nobody re-imports them later believing they were checked. **None was verified by
    this repo. None may be cited outside this table.**

    | Owner | Verbatim-ish quote | Status |
    |---|---|---|
    | S3 | Curlie dump "~2.9M human-categorized websites", "~200 MB compressed", "refreshed ~monthly" | **RESOLVED — released from quarantine, see §5.** 2.9M CONFIRMED; size **corrected to 177,289,960 B**; "monthly" is a stated goal only, actual snapshot ~6 months old. Cite §5 / `curlie-verification.md`, never this row |
    | S3 | Homepage2Vec "precision 0.920, recall 0.886, macro F1 0.902, AUC 0.963" | **UNVERIFIED QUOTE.** #136 excludes benchmark figures by rule; reproduced here only to name what S3 relied on |
    | S3 | URL-only "~70–85%", with title/text "~85–95% on coarse categories" — S3 itself marks these "unverified, secondary" | **UNVERIFIED QUOTE.** Also directly undermined by S3's own methodology point (c): a figure produced without a domain-grouped split is not comparable |
    | S2 | UT1 "~4M domains across ~60 categories"; Shallalist "~1.7M domains, 74 categories" | **UNVERIFIED QUOTE.** S1 #119 Finding 12 says "~80 categories" — also unverified, marked `[verify]` there. **The three sources give three different category counts and none is confirmed** |
    | S2 | 100k–500k entries "collapse to ~3k–15k unique eTLD+1"; S3: 500k rows → "perhaps 20,000 domains" | **UNVERIFIED QUOTES**, and they disagree with each other. This is Finding 3's unmeasured premise in numeric form |
    | S2 | fastText "hundreds of thousands of texts per second on CPU"; LLM tier "~5–30 items/sec" | **UNVERIFIED QUOTES** |

    **Note the pattern.** Every row where two sources give the same *kind* of number, they give different
    numbers. That is the strongest available argument for S1's standing rule that measurement belongs to the
    harness ticket and to nothing else.

### 5. Curlie — verified

> **Status: RESOLVED.** The placeholder that stood here has been replaced. Every claim in this section is
> owned by **`research/_raw/curlie-verification.md`** (verified 2026-08-08, primary sources only), whose
> evidence index is `research/_raw/curlie-fetch-manifest.md` plus three page captures — `curlie-rdf-page.png`,
> `curlie-license-page.png`, `curlie-termsofuse-page.png`. Nothing in this section is asserted on S2's or
> S3's authority; where S3 was right, the verification file is still the owner of the confirmation.

15. **The Curlie download exists, is public, and needs no auth. CONFIRMED**
    [`research/_raw/curlie-verification.md` §1, from `curlie.org/docs/en/rdf.html` HTTP 200 + HEAD probes].
    `https://curlie.org/directory-dl` → **HTTP 302** → `https://share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz`,
    hosted on an S3-compatible object store at the University of Passau / OpenWebSearch.eu (`x-amz-*`
    headers, `<DisplayName>minio</DisplayName>` in the bucket XML). The bucket holds exactly one file
    (`<IsTruncated>false</IsTruncated>`, one `<Contents>` entry). **This closes the single most
    consequential open question in this brief**: S3's core proposal — Curlie as the primary offline
    domain→category source — rests on a download that is genuinely there and genuinely reachable offline
    after one fetch. S1 #119 Finding 14 pointed at a different artifact class (legacy DMOZ RDF archive
    dumps); the live Curlie distribution is a separate, current thing.

16. **Size corrected: 177,289,960 B, not "~200 MB". CONFIRMED**
    [`curlie-verification.md` §2, `content-length: 177289960` on HTTP HEAD **and** `<Size>177289960</Size>`
    in the S3 bucket XML — two independent reads of the same figure]. That is **177.3 MB decimal / 169.1 MiB**,
    ~12% below the claimed figure. Worth recording *why* the wrong number was in circulation: **Curlie's own
    download page also says "only two hundred megabytes"**, so S3 was faithfully repeating an upstream
    rounding, not fabricating. The order of magnitude in the S3 claim was right. This is now a real byte
    count of the kind #136 insists on, and it supersedes the quarantined quote in Finding 14.

17. **Format is TSV, not RDF — the filename is a legacy artefact. CONFIRMED**
    [`curlie-verification.md` §5, from the "Data in the download" section of `rdf.html`]. The archive is
    **TSV (tab-separated), UTF-8, tar/gzip**; "RDF" survives only in the filenames and the docs URL from an
    older format. **All three sources got this wrong or stated it loosely** — S1 #119 Finding 14 says "ODP
    RDF dumps", S2 says "DMOZ/Curlie RDF dumps", S3 cites `curlie.org/docs/en/rdf.html` and inherits the
    name. The practical consequence is favourable and non-trivial: a 177 MB gzipped TSV is a streaming
    line-parse with no XML/RDF toolchain, which materially lowers the cost of the build-time compilation
    step in #119 L1. Fields CONFIRMED present: **URL, title, editorial description** per website entry;
    **title, description and place in the category tree** per category; a **geographic label** on some
    45,000 categories. All four fields S3 claimed are present, plus three it did not mention. No page
    content and no embeddings are in the dump [`curlie-verification.md` forensix relevance notes].

18. **Licence is CC BY 3.0 Unported with mandatory attribution — "openly licensed" is under-specified.
    CONFIRMED** [`curlie-verification.md` §3, from `curlie.org/docs/en/license.html` HTTP 200, capture
    `curlie-license-page.png`]. Verbatim: *"This web directory (the data of categories and listed sites) is
    licensed under a Creative Commons Attribution 3.0 Unported License."* The licence page specifies the
    required attribution HTML and text. Three points that matter to this project:
    - **The licence is stated by curlie.org itself on its canonical licence page** — this is first-party
      authority, the standard #136 Finding 12 sets for a licence claim, not a third-party summary.
    - **Attribution is a condition, not a courtesy.** S3's "openly licensed and maintained" omits it. Per
      `curlie-verification.md`, that omission "would mislead a practitioner about what is needed for
      compliant use".
    - **The Terms of Use are a separate document and add a copyright-assignment clause** for editor
      contributions ("you hereby assign to Curlie the copyright in any material … you create and submit"),
      so the data copyright sits with **Curlie Project Inc** and is then re-licensed under CC BY 3.0
      [`curlie-verification.md` §3, capture `curlie-termsofuse-page.png`]. It does not override the data
      licence.

    **Comparison with the other shipped-artifact licence in this pipeline.** CC BY 3.0 is *weaker copyleft
    than none* — it is attribution-only, with **no share-alike clause**, so unlike UT1's CC BY-SA 4.0
    (S1, #136 Finding 14) a compiled table derived from Curlie does not inherit a licence-propagation
    obligation onto the derived artifact. Both obligations are live simultaneously if both feeds are
    compiled into one table, and they are not the same obligation. `curlie-verification.md` flags that an
    internal training/label pipeline does not expose Curlie content to end users but that the terms should
    be reviewed against the specific deployment.

19. **"Refreshed ~monthly" is a stated goal only; the actual file is ~6 months stale. CONFIRMED, and this
    is a new finding rather than a correction** [`curlie-verification.md` §4]. Verbatim from `rdf.html`:
    *"We **strive** to pull a fresh copy from the Curlie database every month."* The S3 bucket exposes one
    file with `<LastModified>2026-02-02T21:58:48.128Z</LastModified>`; as of the 2026-08-08 fetch that is
    **~6 months old**. No versioning or rotation history is visible in the public bucket, so the *actual*
    historical cadence is **STILL-UNKNOWN** beyond that single timestamp.

    **Operational consequence: treat Curlie as a static snapshot, not a live-updating source**
    [`curlie-verification.md`]. For forensix this is closer to a feature than a defect, and it lands neatly
    on machinery S1 already specified — #119 Finding 18 requires the compiled table to ship as a dated,
    SHA-256-pinned artifact so old cases keep reproducing under the old table. A source that does not
    silently move under you is easier to pin, not harder. What it does rule out is any design that assumes
    freshness: Curlie must not be relied on for recently-registered domains, and the snapshot date belongs
    in the report alongside the UT1 list version.

20. **Net effect on the three-way comparison.** S3's Curlie claim comes out **substantially right on
    substance and wrong on two specifics** — 2.9M entries CONFIRMED (verbatim on `rdf.html`), download and
    fields CONFIRMED, size off by ~12% (inherited from Curlie's own page), "refreshed ~monthly" repeated as
    fact when the source word is "strive", and "openly licensed" stated without the attribution condition.
    S1's #119 characterisation — "froze in 2017 … dangerous as a live lookup table" — is about legacy DMOZ
    and does **not** describe the live Curlie distribution; the 2026-02-02 snapshot is current-ish data, and
    the staleness objection survives only in the weaker, measured form of Finding 19. **On this question the
    web-search run beat the repo's own unverified prior**, which is worth recording honestly: S3's failure
    mode here was imprecision, not invention, and the one place S1 was actually wrong (Finding 17, RDF vs
    TSV) all three sources shared.

## Comparison table — the three answers side by side

| Dimension | S1 (repo, verified) | S2 (isolated, no web) | S3 (web search, unverified) |
|---|---|---|---|
| Normalisation key | eTLD+1 via PSL, `tldts` (Node) | eTLD+1 via PSL, `tldextract` (Python) | eTLD+1 via PSL, "not last-two-labels" |
| Tier 0 | Deterministic rules (#119 L2) | Hand rules for top platforms | Hand rules for top platforms |
| List tier | UT1 ∩ Tranco + Citizen Lab; licences individually verified, UT1 = CC BY-SA 4.0 | UT1 / Curlie / Tranco-derived | Curlie-primary — since **verified**, see §5: download real, 2.9M entries, 177,289,960 B TSV, CC BY 3.0 |
| Main model tier | Single-pass embedding + label/exemplar similarity, ONNX, Node | fastText or TF-IDF + linear, Python | char n-gram + linear, Python; fastText alternative |
| Expensive tier | Entailment as **adjudication only**, low volume | Local LLM via Ollama, ~1–3% of domains | Small transformer on ~5% low-confidence rows |
| Abstain | Mandatory output class in the taxonomy | Implied, not named | Named ("Unknown" below threshold) |
| Second axis | Topic × **format** (proposed) | None | service × topic (proposed) |
| Determinism | Central; drives the ranking | Not mentioned | Not mentioned |
| Provenance | "The actual deliverable" | One clause | Confidence only |
| Licence of shipped artifact | Section-length treatment, two corrections | One parenthetical | Not addressed |
| Unique method contributions | Cost model as f(N); enumerated negative findings; forensic taxonomy | — (largely a subset of S1 + S3) | Domain-dedupe-propagate; title aggregation; domain-grouped split; active learning |
| Numbers usable downstream | Byte sizes and licences, CONFIRMED | **None** | **None** |

## Sources

**Read for this brief (all local, no fetches performed)**
- `research/136-approach-survey.md` — S1 primary; every CONFIRMED tag attributed to S1 traces to it
- `research/_raw/119-url-classifier-options.md` — S1 secondary; note its own no-web-tool caveat and that
  #136 corrects two of its claims (bge-small size, UT1 licence)
- `/tmp/isolated-url-research/findings.md` — S2 verbatim
- `/tmp/run3-background.md` — S3 as summarised by the user
- `research/_raw/curlie-verification.md` — **the owning source for every claim in §5** (Findings 15–20).
  Verified 2026-08-08 against primary sources: `curlie.org/docs/en/rdf.html`, `/docs/en/license.html`,
  `/docs/en/termsofuse.html` (all HTTP 200), plus HTTP HEAD and S3 bucket-listing XML on the download itself
- `research/_raw/curlie-fetch-manifest.md` — evidence index for the above
- `research/_raw/curlie-rdf-page.png`, `curlie-license-page.png`, `curlie-termsofuse-page.png` — page captures;
  the licence capture carries the CC BY badge that backs Finding 18

**Not read, not fetched, deliberately**
- Every URL cited by S2 and S3, **except** the Curlie URLs, which were fetched by the verification run and
  are cited here through `curlie-verification.md` rather than directly. **No web access was used in
  producing this brief itself.** S3's remaining citations arrive through `utm_source=chatgpt.com` redirects
  and have not been resolved
- The Curlie archive itself — the 177,289,960 B `curlie-rdf-all.tar.gz` was probed by HEAD and bucket
  listing, **not downloaded or parsed**. Field names in Finding 17 come from Curlie's documentation, not
  from inspecting the TSV. Confirming them against the actual file is a build-spike step
- Any accuracy/benchmark figure, per the #136 rule; the five still-quarantined quotes in Finding 14 are
  quoted, not adopted

**Dropped**
- S2's and S3's proposed taxonomies as taxonomies — superseded by #136 §7, which is constraint-derived.
  Retained only as evidence that "one coarse fixed set, all tiers emitting the same labels" is the
  consensus approach
- S2's commercial-feed section (zvelo, Cloudflare Domain Intelligence, Webshrinker/DNSFilter, Netstar,
  Symantec/Bluecoat) — S2 itself notes free tiers are online-only; S1 #119 Finding 10 already disqualifies
  online categorisation on evidence-exfiltration grounds. No new information
- S3's IAB Content Taxonomy 3.x advice — S1 #136 §7 already settles the taxonomy question on different and
  better-grounded reasoning

## Gaps / STILL-UNKNOWN

1. ~~**Curlie, entirely.**~~ **CLOSED.** Resolved by `research/_raw/curlie-verification.md`; the findings
   are joined into §5 above (Findings 15–20). Download, entry count, size, format, fields and licence are
   CONFIRMED. **The staleness result is not a residual gap — it is Finding 19**: monthly refresh is a stated
   goal, the observed snapshot is 2026-02-02 and ~6 months old, and the operational instruction is to treat
   Curlie as a static, date-pinned snapshot. Two narrower items remain and are listed separately as gaps 9
   and 10 below rather than keeping this entry open.

   **What this unblocks.** The question deferred from the placeholder — whether the ML tier has a usable
   free label corpus at all — is answered **yes**: 2.9M human-edited URL+title+description entries with a
   full category path, redistributable under CC BY 3.0 with attribution. Consequently S3's active-learning
   loop (Finding 10d) is a **bootstrap on top of an existing corpus**, not the only route to labels, and
   #136 Finding 22's "train our own head" option now has an identified, licence-cleared training source.
   Note the interaction with Finding 10(c): a Curlie-trained model **must** be evaluated under a
   domain-grouped split, because Curlie's unit is the site.
2. **Head-coverage of the list tier — still unmeasured after three independent runs asserted it.**
   Finding 3. Carried from #119 gap 5 → #136 gap 7 → here. Three sources agreeing on an unmeasured premise
   raises its plausibility and changes its evidential status not at all. Cheapest next step in the programme.
3. **Does the fastText/Node spike change the answer?** Finding 5. Two blind runs independently pointed at
   fastText; #136 deferred it on the native-addon objection alone. The spike is small and now has more
   reason to exist. STILL-UNKNOWN whether a maintained Node binding exists that does not reintroduce a
   build toolchain.
4. **Deterministic title sampling for S3's per-domain title aggregation.** Finding 10(b). The method is
   attractive and its determinism properties are unspecified. Must be resolved before it enters pipeline
   design, or it silently breaks the reproducibility property that motivates the whole architecture.
5. **Which second axis, if any.** Finding 8. S1 proposes format, S3 proposes service, both independently
   concluded one label is under-specified. No decision here.
6. **Homepage2Vec weights licence.** Finding 12 — unchanged from #136 gap 4, and now known to be actively
   mis-stated by at least one external source, so it needs a determination rather than continued deferral.
7. **UT1 category count.** Finding 14 — three sources, three numbers (~60 / ~80 / unstated), none confirmed.
   Trivial to settle from the captured `ext/ut1-blacklists-index_en.html` or a re-fetch; nobody has.
8. **Whether S2 contributes anything S1 ∪ S3 does not.** On this reading it does not, beyond corroboration —
   which given its isolation is precisely its value (Finding 2) and is why it was worth running. Recorded
   as a gap in case a re-read finds something this pass missed.
9. **Curlie's actual historical refresh cadence.** Finding 19. The public bucket exposes no versioning or
   rotation history, so one `LastModified` timestamp is all the evidence there is
   [`curlie-verification.md` §4]. Only resolvable by re-probing the bucket over time, or by asking upstream.
   Low priority: the mitigation (pin the snapshot, put its date in the report) is correct regardless of the
   answer.
10. **Curlie's on-disk schema, unverified against the file.** Finding 17's field list is from Curlie's
    documentation; the 177 MB archive was probed but not downloaded or parsed. Column order, category-path
    encoding, the website-entry ↔ category-entry join key, and what fraction of entries carry a usable
    registrable domain are all unknown. This is a build-spike question, and it is the natural first step of
    the compilation work in #119 L1.
11. **How CC BY 3.0 attribution is discharged in a forensic report.** Finding 18. Curlie specifies
    attribution HTML/text for web use; the equivalent for a compiled offline table cited in a court-facing
    report is a decision this project has to make, alongside the separate UT1 CC BY-SA 4.0 share-alike
    obligation (#136 Finding 14). The two feeds carry **different** obligations into the same artifact.
    `curlie-verification.md` explicitly defers the deployment-specific reading to counsel.

**Explicitly out of scope by rule:** all accuracy, F1, precision/recall and throughput figures from S2 and
S3. Six are quoted in Finding 14 for traceability. None is adopted, and every pair of comparable figures
across the sources disagrees — which is the finding, not a nuisance.
