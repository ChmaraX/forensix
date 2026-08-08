# Labelling guide — ChmaraX/forensix#137 ground-truth fixture

**Labeller of record: Fable (model), not a human**, by owner decision recorded in the #137
discussion — a documented deviation from the issue's "labelled by a human" instruction.
Mitigation: the same labeller never authors candidate supervision data. Every candidate in
this bench (`../harness/candidates/`) is supervised only by the frozen taxonomy label
names, one frozen entailment hypothesis template, or an external third-party domain list
(UT1) — **zero exemplars, zero training rows, in all seven configurations**. There is
nothing for this labeller's priors to leak into on the candidate side, and the harness's
contamination guard (`../harness/lib/contamination.js`) fails the run closed if a future
candidate ever declares one. See `results/results.json` → `candidates[].supervision`.

## Source and scope

208 distinct `(title, url)` rows, deduplicated from 709 raw rows across **three source
packages from two staged personas** (Magnet Forensics CTF corpus, `digitalcorpora.org`),
labelled against the 20-label taxonomy in `research/137-taxonomy-proposal.md` §3. See
`research/_raw/137-chromebook-recon.md` and `research/_raw/137-takeout-recon.md` for full
provenance and SHA-256 pins.

| Source package | Persona | Stratum | Rows |
|---|---|---|---|
| Magnet 2021 CTF — Chromebook `History` | `eli-flatt` | primary | 130 |
| Magnet 2021 CTF — Takeout `BrowserHistory.json` | `eli-flatt` | primary | 48 |
| Magnet 2022 CTF — Takeout `BrowserHistory.json` | `rafael-shell` | niche-skewed | 30 |

**Two personas, not three.** CONFIRMED: the 2021 Chromebook and the 2021 Takeout package
are the same staged persona (`research/_raw/137-chromebook-recon.md:400`,
`research/_raw/137-takeout-recon.md:158,358`). Earlier #137 artifacts said three; that was
wrong and is corrected here and in every generated artifact
(`fixture.census.persona_count == 2`, asserted by `harness/test/fixture.test.js`).

**Deviation from #137's 500+ row target, logged rather than silently accepted:** the corpus
yielded 208 distinct rows. Heavy real-world URL-variant overlap (one "Inbox" title against
several URL variants of the same Gmail session) collapsed 709 raw rows harder than
expected. The rows are real and the mess (OAuth redirect chains, ad-click chains,
`chrome://` internal pages, one empty-title row) is real, but volume, persona diversity
and language diversity are all short of the ticket's ask — see "Known limitations".

## Method

Rule-based, not row-by-row free judgment — every row's label(s) trace to an explicit,
readable rule in `../scripts/label_fixture.py`, which is the **single writer** of
`fixture_labelled.json` and reproduces it byte-for-byte:

```bash
docker run --rm -v "$PWD/../..":/repo -w /repo python:3.11-slim \
  python3 tools/classifier-bench/scripts/label_fixture.py
git diff --stat tools/classifier-bench/fixture/fixture_labelled.json   # must be empty
```

Validation is separate from labelling and lives in the harness:
`harness/lib/fixture.js` (`validateFixture`, rules V1–V8) plus
`harness/test/fixture.test.js`, run by `npm ci && npm test` in `harness/` (the `npm ci` is
not optional — the contamination guard needs `tldts`). Rules asserted there: labels exist in
the taxonomy (V1), mutually exclusive pairs are rejected (V2), `row_id` is the content hash
of `(title, url)` (V3), required census fields are present (V5), and every in-site search row
carries `search_query` (V8).

`etld1` is **not** a cosmetic census field. It is the cluster unit for the domain bootstrap,
the support unit for the declared power floor, and the group key for leave-one-domain-out
sensitivity, so an error in it moves published confidence intervals. An audit found the
browser-internal guard `host.startswith("chrome")` also matched the real host
`chrome.google.com` (21 rows), understating domain concentration as 48.1% rather than 58.2%.
Browser-internal URLs have an empty netloc, so the URL **scheme** is the discriminator; a
regression test in `harness/test/fixture.test.js` pins both halves.

## Per-row fields the labeller emits

Beyond `labels`, `rationale`, `ambiguous` and `labeller`, each row carries census fields
so the harness can report statistical power honestly instead of implying it:

- `persona_id`, `stratum` — power and leave-one-persona-out sensitivity.
- `etld1` — the bootstrap CI clusters by registrable domain, because 43 domains carrying
  208 rows are not 208 independent items.
- `url_group_id`, `url_group_shared` — 24 rows share a URL with another row (title
  mutations of one visit). Flagged, not silently counted as independent.
- `in_site_search` — 8 rows are in-site search endpoints; see rule 9 below.

## Boundary-rule decisions worth recording (the ones a second labeller would need)

1. **Browser-internal pages (`chrome://`, `chrome-extension://`) → `ads_trackers_infrastructure`**,
   never `unclassified`, per the taxonomy's explicit label-19 boundary rule. This includes
   `chrome-extension://.../crosh.html` even though visiting it is technically interesting —
   the *row itself* is a browser-internal surface, not a content page.
2. **Empty title does not automatically mean `unclassified`.** Rule: check title+URL
   *together*. One row (`api.aidungeon.io/verify/...`) has an empty title but the URL alone
   names the platform unambiguously → labelled `entertainment_streaming_gaming`, not
   `unclassified`. Only truly signal-free rows (bare `chrome.google.com` host, bare
   `google.com/` homepage) get `unclassified`.
3. **Google Docs/Sheets → `file_sharing_cloud_storage`**, not `technology_software_dev` or
   `reference_education_howto`. Justification: label 16's boundary rule explicitly names
   "document collaboration". The Sheets *marketing* page (`google.com/sheets/about/`) is
   different — that's `technology_software_dev` (product info, not a document).
4. **Ad-click redirect chains (`googleadservices.com`, `doubleclick.net`,
   `dartsearch.net`) → multi-label `[ads_trackers_infrastructure, <destination topic>]`**,
   not the destination topic alone. The row is evidence of two things: an ad mechanism
   fired, and the subject's interest matched an ad. Both are forensically real.
5. **Search-result pages get `search_query` PLUS a topical secondary label** when the
   query subject maps cleanly to another label (e.g. "vineyard vines stock price" →
   `[search_query, finance_banking]`). A bare, topic-less query only gets `search_query`.
6. **Wickr (`wickr.com`) → `anonymity_privacy_tooling`, not `webmail_messaging_voice`.**
   Wickr's whole product proposition is encrypted/ephemeral messaging; researching "how
   secure is Wickr" is closer to counter-forensic-preparation research than to ordinary
   communications-channel evidence.
7. **Vermont COVID travel-restriction rows → multi-label
   `[travel_transport_accommodation, health_medical]`, flagged `ambiguous: true`.**
   This is the sharpest genuine boundary case in the set: the content is simultaneously
   about movement (did the subject travel?) and public health policy. No confident single
   label exists; multi-label is the correct mechanism here, exactly as #137 §1 anticipated
   ("forcing one truth label manufactures disagreement").
8. **Chick-fil-A recipe/copycat pages → `reference_education_howto`** (how-to cooking
   instructions), separate from **Chick-fil-A official brand pages → `shopping_marketplace`**
   (ordering/account access) and **Chick-fil-A Google Maps rows → `travel_transport_accommodation`**
   (wayfinding to a physical location). Same brand, three different forensic questions.
9. **In-site search endpoints are `search_query` too — correction applied after the audit.**
   Taxonomy label 1 says it applies to search-engine result pages *and* to in-site search
   endpoints. YouTube (`/results?search_query=`) and Amazon (`/s?`) in-site search already
   carried `search_query`; Chrome Web Store `/webstore/search/<q>` did not. That
   inconsistency injected systematic false negatives into any candidate that correctly
   detects in-site search. The endpoint patterns are now declared in one list
   (`IN_SITE_SEARCH_PATTERNS`) and asserted by test V8. **No row was added, removed or
   relabelled to improve any candidate's score** — this rule was applied to the fixture
   before any v2 candidate ran, and the same rule change was applied uniformly.

## Ambiguous rows

16 of 208 rows (7.7%) are flagged `ambiguous: true` — genuinely defensible under more than
one label, not labelling errors. Every candidate is additionally scored under a
**charitable** policy that accepts any defensible label on these rows; it is published
alongside the strict score, never instead of it
(`results.json` → `candidates[].charitable_ambiguous_scoring`). A second labeller
re-adjudicating the set should start there; see `ambiguous` and `rationale` in
`fixture_labelled.json`.

## Known limitations of this fixture (all reported in the generated artifacts)

- **208 rows, not 500+.** With 65 multi-label rows the per-label support is thin.
- **43 distinct registrable-domain groups**, with `google.com` alone at 58.2% of rows and the
  top 12 domains at 83.2%. The bootstrap CI is therefore clustered by domain, and
  leave-one-domain-out sensitivity is published — a domain-blind CI on 208 rows would
  badly overstate precision.
- **24 rows share a URL** with another row; they are title mutations of one visit, not
  independent test items.
- **4 of 20 core labels have zero gold rows**: `gambling`, `adult_sexual_content`,
  `cryptocurrency_exchanges`, `employment_job_seeking`. These CTF personas never generated
  that browsing.
- **Adult-content recall is UNMEASURABLE here**, and is reported as such rather than as 0.
  False *positives* on Adult are measurable (against 208 gold-negative rows); false
  negatives are not, because there is no gold-positive row to miss. This is the single
  most consequential gap in the fixture: the most forensically sensitive label has no
  ground truth at all.
- **Zero non-English rows.** Both personas browsed in English. The stratification
  requirement in #137 §1 is unmet.
- **No held-out split.** At 43 domains a train/test split is not defensible; any threshold
  read off the coverage/accuracy sweep is selected and reported on the same rows, and the
  leaderboard says so.
- **Single labeller, no inter-rater check.** `research/137-taxonomy-proposal.md` gap 5
  recommended a second labeller on a subsample; not done.
- **No separate pilot-then-freeze cycle** — the taxonomy was validated against ten external
  category systems in `research/137-taxonomy-proposal.md` before this labelling pass, which
  substitutes for the originally planned 50-row pilot.
