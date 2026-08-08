# Labelling guide — ChmaraX/forensix#137 ground-truth fixture

**Labeller of record:** Fable (model), by owner decision recorded in the #137 discussion —
a documented deviation from the issue's "labelled by a human" instruction. Mitigation: the
same labeller never authors candidate training/exemplar data. Candidates in this bench run
(`tools/classifier-bench/candidates/`) use zero-shot label-name similarity or hand-curated
deterministic domain lists — neither consumes exemplar strings — so there is nothing for
this labeller's priors to leak into.

## Source and scope

208 distinct `(title, url)` rows, deduplicated from 709 raw rows across three real Chrome
profiles (Magnet Forensics CTF corpus, `digitalcorpora.org`), against the 20-label taxonomy
in `research/137-taxonomy-proposal.md` §3. See `research/_raw/137-chromebook-recon.md` and
`research/_raw/137-takeout-recon.md` for full source provenance and SHA-256 pins.

**Deviation from #137's 500+ row target, logged here rather than silently accepted:** the
corpus yielded 208 distinct rows, not 500+. Heavy real-world URL-variant overlap (one
"Inbox" title against five URL variants of the same Gmail session) collapsed 709 raw rows
harder than expected. The rows are real and the mess (OAuth redirect chains, ad-click
chains, `chrome://` internal pages, one empty-title row) is real, but volume and persona
diversity (3 personas, 100% English) are both short of the ticket's ask. Logged as a known
gap, not fixed in this pass — see "Open gaps" below.

## Method

Rule-based, not row-by-row free judgment — every row's label(s) trace to an explicit,
readable rule in `tools/classifier-bench/scripts/label_fixture.py`, so the labelling is
auditable and re-runnable, not a black box. Rules were derived by reading all 208 rows
once (`research` conversation, 2026-08-08) and encoding the judgment calls made for
recurring patterns (Gmail sessions, Google Docs, Chick-fil-A, vineyard vines, lacrosse,
AI Dungeon, etc).

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

## Ambiguous rows

16 of 208 rows (7.7%) are flagged `ambiguous: true` in the fixture — genuinely defensible
under more than one label, not labelling errors. A second labeller re-adjudicating the set
should start there; see field `ambiguous` and `rationale` in
`tools/classifier-bench/fixture/fixture_labelled.json`.

## Open gaps (not fixed in this pass)

- **No pilot-then-freeze cycle was run separately** — the taxonomy was already validated
  against ten external category systems in `research/137-taxonomy-proposal.md` before this
  labelling pass, which substitutes for the originally planned 50-row pilot.
- **Zero non-English rows.** All three source personas browsed in English. The
  stratification requirement in #137 §1 (non-English titles) is unmet by this fixture.
- **Thin coverage of several labels**: `gambling` (0 rows), `adult_sexual_content` (0 rows),
  `cryptocurrency_exchanges` (0 rows), `employment_job_seeking` (0 rows). These CTF personas
  never generated that browsing. Per-class F1 for these labels cannot be measured from this
  fixture; any bench run must report them as "no test rows available", not as a score.
- **Single labeller, no inter-rater check.** `research/137-taxonomy-proposal.md` gap 5
  recommended a second labeller on a subsample; not done here.
