# Research: A browsing-history category taxonomy for ForensiX v2 (ChmaraX/forensix#137)

> **Scope note.** [#137](https://github.com/ChmaraX/forensix/issues/137) needs a labelled ground-truth
> set, and a ground-truth set cannot be built against a label list that nobody has validated.
> [`research/136-approach-survey.md`](136-approach-survey.md) §7 proposed one in a single pass, by one
> author, with no external comparison. This brief is that comparison. It produces **the label set only** —
> the harness, the fixture, and the labelling guide remain #137's deliverables.
>
> **Contamination rule, honoured literally.** #137 requires that whoever authors the test set is not the
> author of any candidate's supervision. This brief therefore contains **no exemplar strings, no example
> titles, no example URLs, no domain names used as illustrations, and no prompt text.** Labels are defined
> by their forensic question and by written boundary rules, never by instances. The one place where the
> #136 draft used concrete strings, those strings are restated here as abstract classes. Anyone writing
> exemplars for a candidate may read this file; that is the point of keeping it instance-free.
>
> **Evidence note.** Written against live primary sources. Every fetch — URL, HTTP status, byte size,
> SHA-256 — is in [`research/_raw/137-fetch-manifest.md`](_raw/137-fetch-manifest.md), captures under
> `research/_raw/137/`, generated `2026-08-08T11:39Z`. Claims are tagged **CONFIRMED** (with the file that
> owns them) or **STILL-UNKNOWN**. Nothing is tagged "likely".
>
> **No accuracy, F1 or benchmark number appears in this brief**, by the rule carried from #136. The counts
> that do appear are *list sizes* read off primary sources — how many categories a vendor publishes, how
> many entries sit in a category — which are facts about the taxonomies being surveyed, not measurements
> of anything ForensiX does.

## Summary

Ten category sets were surveyed against the #136 draft. Four conclusions, each of which changes the label
set:

1. **Digital-forensics tools do not have a browsing-content taxonomy to copy.** The 468-page Magnet AXIOM
   user guide contains **zero occurrences** of `gambling`, `pornograph`, or `adult` (Finding 8). Autopsy
   ships a domain→category table of 3,256,083 bytes containing exactly **three** distinct categories, plus
   one hard-coded fourth (Finding 9). Hindsight has none (Finding 10). The genre exists only in *web
   filtering* and *ad tech*, and both were built to answer a different question. So this taxonomy has to be
   designed, not adopted — which also means it must be justified line by line, which is what §4 does.
2. **The three suspected gaps are real and each is confirmed by 6–8 independent sources.**
   Entertainment/Streaming, Gaming, Health/Medical and Technology/Software are present in nearly every
   surveyed set and absent from the draft (Finding 11). A fourth gap the draft did not suspect is larger:
   **every one of the four filtering vendors separates "advertising / CDN / redirector / parked / no
   content" from "not yet categorised"**, and the draft collapses both into `Unclassified` (Finding 12).
3. **Threat is a second axis, not a category.** UT1, FortiGuard, Talos and Cloudflare all publish
   malware/phishing/botnet categories, and all four keep them in a **structurally separate group** from
   content (Finding 13). ForensiX should copy the separation, not the categories: a reputation verdict is a
   claim about *now*, and a history row is a claim about *then*.
4. **The ad-tech taxonomies deliberately exclude exactly what forensics needs.** Chrome's own Topics API
   taxonomy — which classifies the same artifact this tool classifies — has 469 topics and no Adult, no
   Health, no Religion, because the explainer states it will "attempt to exclude sensitive topics"
   (Finding 6). Those exclusions are GDPR Article 9 special categories (Finding 15). ForensiX includes two
   of them on purpose, and therefore has to flag them as special-category output rather than pretend the
   problem is absent.

The proposal in §3 is **20 core labels including the mandatory `Unclassified`**, multi-label, with a
separate opt-in overlay pack of five jurisdiction-dependent labels that never enter the core macro-F1.

---

## 1. What was surveyed

| # | Set | Kind | Size, as published | Licence / authority | Source |
|---|-----|------|--------------------|---------------------|--------|
| 1 | **UT1 (Université Toulouse 1 Capitole)** | Filtering blacklist | **66** categories in the published table; **90** `.tar.gz` artifacts in the download directory | CC BY-SA 4.0 (`rel="license"`) | `137/ut1-index_en.html`, `137/ut1-download-listing.html` |
| 2 | **FortiGuard Web Filter** | Filtering vendor | **87** categories in **6** groups, plus a 7th group `Unrated` whose single member is `Not Rated` | Vendor page, no licence offered | `137/fortiguard-webfilter-categories.html` |
| 3 | **Cisco Talos Intelligence Categories** | Filtering / reputation vendor | **107** content categories **and a separate table of 27 threat categories** | Vendor page, no licence offered | `137/talos-categories.html` |
| 4 | **Cloudflare Gateway domain categories** | Filtering vendor | **27** top-level IDs over **125** subcategory IDs | Vendor docs | `137/cloudflare-gateway-domain-categories.html` |
| 5 | **IAB Content Taxonomy 3.0** | Ad tech | **706** rows, **36** Tier-1 names | IAB Tech Lab GitHub | `137/iab-ct-3.0.tsv` |
| 6 | **Chrome Topics API taxonomy** | Ad tech, *on browsing history* | v1: **349** topics / **24** top-level. v2: **469** topics / **22** top-level | PATCG individual draft | `137/topics-api-taxonomy_v1.md`, `_v2.md`, `137/topics-README.md` |
| 7 | **Curlie (ex-DMOZ / ODP)** | Web directory | **15** top-level categories | Curlie site | `137/curlie-en.html` |
| 8 | **WebOrganizer** | Academic / pre-training curation | 24 topic labels + 24 format labels | — | carried from #136, `_raw/ext/weborganizer-topics.yaml` |
| 9 | **Magnet AXIOM** | Commercial DF tool | **No content taxonomy.** 15 *timeline activity* categories; media grading; 2 chat categories | Vendor user guide | hashed, not redistributed — see `137-fetch-manifest.md` |
| 10 | **Autopsy / The Sleuth Kit** | Open-source DF tool | **3** shipped categories + **1** hard-coded | Apache-2.0 | `137/autopsy-default_domain_categories.csv`, `137/autopsy-DefaultPriorityDomainCategorizer.java` |

Also read: Hindsight (open-source Chrome history tool), `137/hindsight-tree.json`; an arXiv title/abstract
pass, `137/arxiv-web-taxonomy.xml`; GDPR Article 9, `137/gdpr-celex.html`.

**Not obtained. STILL-UNKNOWN.** Netcraft — named in the research plan; three candidate URLs 404 and
`netcraft.com/sitemap.xml` (200) contains no URL matching `categor`. Symantec/Broadcom WebPulse — the
category PDF and knowledge-base article both 404. Zscaler — the category page is a client-rendered shell.
Belkasoft, X-Ways, Nuix, Oxygen — no URL-categorisation documentation located. The DF-tool negative
finding therefore rests on n=3 (AXIOM, Autopsy, Hindsight), not on the whole market.

---

## 2. Findings

### 2.1 The forensic tools

**1. UT1 is a filtering list first and a taxonomy second, and its shape shows it. CONFIRMED**
[`137/ut1-index_en.html`]. Its 66 published categories carry entry counts summing to 5,781,493, but they
are wildly unbalanced by *filtering* priority, not by browsing volume: `adult` 4,600,370, `phishing`
270,361, `malware` 269,529, `redirector` 132,616, `jobsearch` 60,741, `shopping` 36,971, `games` 35,396,
`gambling` 32,252, against `hacking` 307, `forums` 225, `translation` 179, `update` 33. It also carries
categories that exist only to serve one French institution — `examen_pix`, `tricheur_pix` (whose own
description reads "DO NOT USE"), `liste_bu`, `arjel`, `catalogue-biu-toulouse`. **The decisive point for
this brief is what UT1 does not have:** no Search, no Travel, no Health, no Education, no Technology, no
Entertainment as such. A list built to answer "block or allow?" never needed them.

**2. UT1's licence is CC BY-SA 4.0, and #136 Finding 14 is upheld — with one wrinkle worth recording.
CONFIRMED** [`137/ut1-index_en.html`]. The live `rel="license"` links resolve to
`creativecommons.org/licenses/by-sa/4.0/`. There are also two `by-nc-sa/4.0` references in the same file,
but both sit **inside an HTML comment** wrapping a legacy RDF block, so they are not the operative grant.
The download directory additionally publishes `LICENSE.pdf` and `cc-by-sa-4-0.pdf`
[`137/ut1-download-listing.html`]. Anyone re-verifying this must read the comment boundaries, not grep for
`creativecommons`.

**3. The download directory publishes more names than the table documents. CONFIRMED**
[`137/ut1-download-listing.html`]. 90 `.tar.gz` files, including `ads`, `aggressive`, `drugs`, `porn`,
`proxy`, `violence`, `scripts`, `special`, `local`, `indisponible`, `jstor`, `verisign` — none of which
appear in the 66-row table. Some are evidently English aliases of French category names. **A build-time
compiled table must key on the documented 66, not on the directory listing**, or it will silently
double-count aliases.

**4. FortiGuard groups its 87 categories by *filtering intent*, not by subject. CONFIRMED**
[`137/fortiguard-webfilter-categories.html`]. The six groups are `Adult / Mature Content` (15),
`Bandwidth Consuming` (6), `General Interest - Business` (17), `General Interest - Personal` (32),
`Potentially Liable` (12), `Security Risk` (5). `Gambling`, `Dating`, `Alcohol`, `Tobacco`, `Abortion` and
`Advocacy Organizations` all sit inside `Adult / Mature Content` — an arrangement that makes sense for a
school's block policy and would be indefensible in a forensic report, where placing a dating-site visit
under an "Adult" heading is a substantive and prejudicial claim. **A vendor's grouping is a policy
artefact and must not be inherited.**

**5. Talos publishes two tables, and that structure is the most transferable thing in the survey.
CONFIRMED** [`137/talos-categories.html`]. 107 `Content Categories` in one table; 27 `Threat Categories`
in a second. The content table also contains explicit non-content members — `Not Actionable`,
`Parked Domains`, `Infrastructure and Content Delivery Networks`, `Private IP Addresses as Host`,
`Web Cache and Archives`, `Dynamic and Residential` — i.e. Talos, too, needs somewhere to put traffic that
is real but is not *about* anything.

**6. Chrome's own history taxonomy deliberately omits what a forensic taxonomy is for. CONFIRMED**
[`137/topics-api-taxonomy_v1.md`, `_v2.md`, `137/topics-README.md`]. The Topics API classifies the same
artefact ForensiX classifies — sites the user visited — and its taxonomy reached 469 topics under 22
top-level names with **no topic anywhere in the tree matching `adult`, `gambling`, `dating`, `religio`, or
any medical sense of `health`** — the only `health` matches are gyms, health insurance, medical *training*
and medical *job listings*. The explainer states the taxonomy "will attempt to exclude sensitive topics".
Between v1 and v2 the topic count rose from 349 to 469 while the top-level count *fell* from 24 to 22, and
the two names dropped were exactly `Reference` and `Science`: the direction of travel is more granularity
inside safe verticals and none outside them.
**This is the single clearest evidence that no ad-tech taxonomy can be adopted wholesale**, and it is
stronger evidence than the WebOrganizer argument in #136 §23 because it is Chrome's own.

**7. Curlie confirms #136's characterisation of v1's ontology, and hides its Adult branch the same way
Topics does. CONFIRMED** [`137/curlie-en.html`, captured through a real browser because the list is
client-rendered; `137/curlie-en-Adult.html`]. The 15 top-level categories shown are Arts, Business,
Computers, Games, Health, Home, News, Recreation, Reference, Regional, Science, Shopping, Society, Sports,
Kids and Teens. v1 used eight of them. `Regional` and `Kids and Teens` are not subject categories at all;
`Society`, `Reference` and `Home` answer no investigative question. #136 §7's criticism stands on the
primary source. Separately: `curlie.org/en/Adult/` returns **200** with the title `Curlie - Adult`, i.e.
the branch exists but is omitted from the front-page tree — the same editorial move Chrome made in
Finding 6, from a completely different motive, and a reminder that "the taxonomy has no Adult category" and
"the taxonomy does not show you its Adult category" are different statements.

**8. Magnet AXIOM has no browsing-content taxonomy. CONFIRMED, and this is a negative finding with real
weight.** The published 468-page *Magnet AXIOM User Guide* [fetched and hashed, SHA-256
`653e83646e231bca08fbf3c2234407e282aa7a93ec6b454d668f13095614223c`, 4,161,401 B; text extraction SHA-256
`06776b66eacf3292bc7b1ad624b5949a3d46b604f688b829e2d22e632e82986d`, 542,200 B — **proprietary vendor
documentation, not redistributed in this repo**; URL and re-fetch/verify command in
`research/_raw/137-fetch-manifest.md` §"Fetched and hashed, deliberately NOT redistributed"] contains **0**
case-insensitive occurrences of `gambling`, **0** of `pornograph`, **0** of `adult`. What AXIOM does
categorise:
- **Artifact type** — the Artifacts explorer groups by where evidence came from, and the custom-file-type
  field documentation states plainly that the category "determines where the file type artifact will
  appear" and "You can't enter your own category name".
- **Timeline activity**, 15 categories: Account usage, Browser usage, Deleted file, Device interaction,
  External device/USB usage, File download, File knowledge, File/folder opening, Financial transactions,
  Network activity, Physical location, Program execution, Social activity, User communication, User event.
- **Media**, by hash against Project VIC / CAID lists (46 and 40 occurrences respectively) and by
  Magnet.AI.
- **Chat**, by Magnet.AI, into "possible grooming/luring and sexual content" — the guide's only two content
  categories anywhere, and they are about chat text, not URLs.

So the market leader's answer to "what was this browsing about?" is *the examiner reads the list*.
`Browser usage` is a single undifferentiated timeline bucket.

**9. Autopsy ships four categories in total. CONFIRMED**
[`137/autopsy-default_domain_categories.csv`, 3,256,083 B, 101,026 lines, SHA-256 `b789cdb9…`;
`137/autopsy-DefaultPriorityDomainCategorizer.java`]. The default table's entire category vocabulary is
`Disposable Email` (100,854 rows), `Web Email` (153), `Messaging` (10). One further category,
`Search Engine`, is hard-coded in `DefaultPriorityDomainCategorizer` over the published Google
country-domain list. The file's own header comments name its three upstream sources — a mailcheck wiki
page, an npm package, and a blog post. Autopsy's *custom* categoriser
(`Core/src/org/sleuthkit/autopsy/url/analytics/domaincategorization/`) accepts arbitrary user-supplied
category strings, i.e. an **open namespace**: fine for an examiner's working notes, unusable as a fixed set
for scoring.

**10. Hindsight has no content categorisation at all. CONFIRMED** [`137/hindsight-tree.json`]. Ten plugins:
`chrome_extensions`, `dnr_rules`, `generic_timestamps`, `google_analytics`, `google_searches`,
`load_balancer_cookies`, `quantcast_cookies`, `query_string_parser`, `template`, `time_discrepancy_finder`.
The one content-bearing plugin is `google_searches`. **Across all three DF tools surveyed, the only content
question anybody implemented is "what did they search for"** — which is precisely the label #136 §7 ranked
first, now corroborated by what tool authors actually chose to build.

### 2.2 The diff against the #136 draft

**11. The three suspected gaps are confirmed, and each has broad independent support.** Presence of a
concept in each surveyed set, CONFIRMED from the captures listed in §1. `—` means the set has no category
for the concept at any level.

**Column scope, so the `—` marks mean something exact.** UT1, FortiGuard, Talos and Cloudflare were checked
against the full published category list including every subcategory. IAB 3.0 and Topics v2 were checked
against the full machine-readable taxonomy file at every tier. Curlie was checked at top level **plus a
direct probe of the branches the top-level listing omits**. WebOrganizer is its published 24 topic labels.
`—` means the concept has no category anywhere in the scope stated for that column; `*excluded*` means the
set's own documentation says the omission is deliberate.

| Concept | UT1 | FortiGuard | Talos | Cloudflare | IAB 3.0 | Topics | Curlie | WebOrg | In #136 draft? |
|---|---|---|---|---|---|---|---|---|---|
| Search engines / portals | — | ✔ | ✔ | ✔ | ✔ | — | — | — | **yes** |
| Adult / sexual content | ✔ | ✔ | ✔ | ✔ | ✔ | *excluded* | ✔ | ✔ | **yes** |
| Gambling | ✔ | ✔ | ✔ | ✔ | ✔ | *excluded* | ✔ | — | **yes** |
| Finance / banking | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **yes** |
| Cryptocurrency | ✔ | ✔ | ✔ | ✔ | — | — | — | — | **yes** |
| Job search | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **yes** |
| File sharing / storage / transfer | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — | **yes** |
| Anonymity / proxy / VPN / remote access | ✔ | ✔ | ✔ | ✔ | — | — | — | — | **yes** |
| Hacking / security tooling | ✔ | ✔ | ✔ | ✔ | — | — | — | — | **yes** |
| Webmail / messaging / voice | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | **yes** |
| Social networking / communities | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **yes** |
| Shopping / auctions / marketplace | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | **yes** |
| Travel / transport | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **yes** |
| News / press | ✔ | ✔ | ✔ | ✔ | — | ✔ | ✔ | — | **yes** (merged with Reference) |
| **Entertainment / streaming media** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **NO — gap** |
| **Games / gaming** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **NO — gap** |
| **Health / medicine** | — | ✔ | ✔ | ✔ | ✔ | *excluded* | ✔ | ✔ | **NO — gap** |
| **Technology / software / dev** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **NO — gap** |
| **Ads / CDN / redirect / parked / no-content** | ✔ | ✔ | ✔ | ✔ | — | — | — | — | **NO — gap, unsuspected** |
| Reference / education | ✔(local) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | partial (inside News) |
| Dating / relationships | ✔ | ✔ | ✔ | ✔ | ✔ | *excluded* | — | — | no |
| Government / legal / politics | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | no |
| Sports | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | no |
| Real estate | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | no |
| Food & dining | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | no |
| Vehicles / automotive | — | ✔ | ✔ | ✔ | ✔ | ✔ | — | ✔ | no |
| Religion / belief | ✔ | ✔ | ✔ | ✔ | ✔ | *excluded* | ✔ | ✔ | no |
| Not-yet-categorised / unrated | — | ✔ | ✔ | ✔ | — | — | — | — | **yes** |

Three of the four gap rows carry **8/8** independent support — Entertainment, Games, Technology — and
Health carries **6/8**, where both dissenters are explained: UT1 is a block-list that never needed it, and
Topics excluded it on purpose (Finding 6). The fifth gap row, Ads/CDN/redirect/parked/no-content, carries
4/4 among the sources that actually see raw traffic and 0/4 among those that do not, which is itself the
argument in Finding 12.

**12. The unsuspected gap: "no signal" and "not user content" are different states, and every filtering
vendor separates them. CONFIRMED.** The draft's `Unclassified / insufficient signal` is asked to hold both
"this row carries nothing a model could read" and "this row is an ad beacon, a CDN asset, a shortener hop,
a parked domain, a login wall". The surveyed vendors do not conflate these:
- FortiGuard: `Advertising`, `Content Servers`, `Domain Parking`, `Meaningless Content`, `URL Shortening`,
  `Secure Websites` are *rated categories*, and `Not Rated` is a separate group.
- Talos: `Advertisements`, `Infrastructure and Content Delivery Networks`, `Parked Domains`,
  `URL Shorteners`, `Web Cache and Archives`, `Private IP Addresses as Host` sit in the content table;
  `Not Actionable` is a distinct member.
- Cloudflare: `Ads` and `Content Servers` are content categories, while `No Content`, `Login Screens`,
  `URL Alias/Redirect`, `Unreachable` and `Miscellaneous` are a distinct **`Miscellaneous` subcategory
  group**, and `Parked & For Sale Domains` sits under `Security Risks`.
- UT1: `publicite`, `redirector`, `strict_redirector`, `strong_redirector`, `shortener`, `marketingware`,
  `reaffected` are categories, with a combined published entry count over 400,000.

The forensic consequence is direct and it is a scoring consequence, not an aesthetic one: if `Unclassified`
absorbs every ad, tracker, CDN and redirect hop in a 100k-row history, it becomes the largest class in the
set, its per-class F1 measures nothing, and the abstain-threshold sweep #137 §3 asks for is reading a
garbage bin. **Separating them is the single highest-value change in this proposal.**

**13. Threat is a separate axis in all four filtering sources, and ForensiX should copy the separation
rather than the categories. CONFIRMED.** Talos publishes threats in a physically separate table (27 rows).
FortiGuard isolates `Security Risk` as one of six groups (5 members). Cloudflare separates `Security
threats` (14) and `Security Risks` (3) from content and states these come from internal models and
commercial feeds rather than the content vendor. UT1 carries `malware` 269,529 and `phishing` 270,361 —
together 9.3% of its total published entry count — sourced from named threat feeds listed in its own page.
For ForensiX the argument against importing them as *content labels* is stronger still: **a reputation
verdict is a statement about the domain now, and a history row is a statement about the domain at
`last_visit_time`.** Asserting "the subject visited a phishing site" from a present-day feed, in a report,
without a time-of-visit source, is an unsupported claim. Threat belongs to a separate axis with its own
provenance and its own dated feed, or nowhere.

**14. The draft's own label count is inconsistent with #136's cost model, and it matters for §3.**
#136 §7 lists **15** labels; #136's cost model is computed throughout for **N = 14**
[`research/136-approach-survey.md`, "for taxonomy size N = 14"]. Under families 1, 3 and 3b — the
recommended tiers — cost is constant in N, so growing to 20 costs nothing per row and only widens a matmul.
Under family 2 it is 20 passes per row instead of 14. **The taxonomy should therefore not be trimmed to
protect the entailment tier**, which #136 already demoted to adjudication-only; but the entailment tier's
cost does now scale with the number in §3, and that should be stated when #126 reads the numbers.

**15. Two of the proposed labels are GDPR Article 9 special categories, and that has to be on the record.
CONFIRMED** [`137/gdpr-celex.html`]. Article 9(1) prohibits, absent an exception, processing of personal
data "revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, or trade
union membership … data concerning health or data concerning a natural person's sex life or sexual
orientation". `Health & Medical` and `Adult & Sexual content` are squarely inside that list;
`Religion` and `Politics` would be, which is part of why §4 rejects them. This is not an argument for
dropping Health — Finding 11 shows six independent sources carry it and an investigator asks the question —
but it is an argument that **the taxonomy must mark which labels are special-category output**, so that the
report layer and #122's legal-constraints work can act on it rather than discovering it later. Note the
symmetry with Finding 6: Chrome excluded these topics because its lawful basis could not carry them;
ForensiX includes them because a forensic examination's basis is different, and the difference must be
visible in the artefact.

**16. Page *format* keeps reappearing as a second axis, from three unrelated directions. CONFIRMED.**
WebOrganizer ships a 24-label format classifier alongside its 24-label topic classifier (#136 §24).
Cloudflare carries `Login Screens` as a first-class subcategory — a *page role*, not a subject. An arXiv
abstract in the academic pass proposes classifying pages into "Index Pages" and "Content Pages" for crawl
support [`137/arxiv-web-taxonomy.xml`, `arXiv:2505.06972`]. Three sources with nothing in common converge
on the same observation: what a page *is* and what it is *about* are independent. **Out of scope here** —
§3 delivers one axis, as #137's F1 requirement demands — but it is the strongest candidate for a v2.x second
head, and §5 records why it was not folded in.

---

## 3. Proposal — the core label set

**20 labels, fixed, multi-label, `Unclassified` mandatory and included in the 20.** Every label is stated as
the question an investigator is asked in a report, per the #136 §7 discipline. `SC` marks a label whose
output is GDPR Article 9 special-category data (Finding 15).

| # | Label | The forensic question it answers | Boundary rules that make it scorable |
|---|-------|----------------------------------|--------------------------------------|
| 1 | **Search & Query** | "What did the subject look for, in their own words?" | Applies to search-engine result pages and to in-site search endpoints. The *subject* of the query does not change this label; a query about a second topic is a second label under multi-label |
| 2 | **Webmail, Messaging & Voice** | "How were they communicating off-channel?" | Web-hosted mail, chat, messaging and voice/meeting services. Message *content* is not visible in a history row; this label asserts the channel, never the conversation |
| 3 | **Social media & Online communities** | "What accounts and what contacts?" | Social networks, forums, community platforms, professional networks, personal blogs, and **dating/matchmaking services**. Dating is routed here deliberately; see decision D-14 |
| 4 | **News & Current affairs** | "What was the subject reading about, and when relative to the incident?" | Press, broadcast news, aggregators. Split from Reference; see D-05 |
| 5 | **Reference, Education & How-to** | "Was the subject learning or researching a method?" | Encyclopaedic and reference material, courses, academic and institutional sites, instructional material. The insider-threat question "did they look up how to do this" lands here when the method is not itself tooling |
| 6 | **Entertainment, Streaming & Gaming** | "How much of this history is leisure consumption, and when did it happen?" | Video and audio streaming, music, film and TV, humour, celebrity, comics/animation, sport as spectacle, and games and gaming platforms. See D-01 and D-02 |
| 7 | **Technology, Software & Developer resources** | "Was the subject working, or acquiring capability?" | Vendor and product documentation, developer platforms, package and code hosting, IT/SaaS/admin consoles, consumer-tech media, AI services. Its primary forensic job is defensive: it keeps ordinary technical work out of label 19. See D-03 |
| 8 | **Shopping & Marketplace** | "What was purchased, and does it match the alleged fraud?" | Retail, auctions, classifieds, marketplaces, coupons, and property listings. See D-08 |
| 9 | **Finance & Banking** | "Which financial institutions and accounts were accessed, and when?" | Retail and commercial banking, payments, brokerage, insurance, tax and government financial portals, accounting |
| 10 | **Cryptocurrency & Exchanges** | "Was there an exfil-monetisation or ransom-payment channel?" | Exchanges, wallets, chain explorers, mining and token services. Kept separate from 9 for the reason #136 gave, now corroborated by four vendors carrying it as its own category |
| 11 | **Employment & Job seeking** | "Was there job-seeking before the exfil?" | Job boards, applicant portals, recruiter services, CV tooling |
| 12 | **Travel, Transport & Accommodation** | "Does the browsing corroborate the movement timeline?" | Booking, carriers, accommodation, maps and routing, local transport. Placement and alibi |
| 13 | **Health & Medical** `SC` | "Is there a medical explanation, a capacity question, or a welfare concern?" | Conditions, symptoms, providers, appointments, pharmacy in its ordinary sense, mental-health services. Recreational-drug material is **not** here; see the overlay pack |
| 14 | **Adult & Sexual content** `SC` | "Was there adult material on this machine?" | Explicitly **not** a CSAM detector — see D-17. Does not extend to dating (rule 3), sex education (route to 13) or non-sexual nudity in a medical or artistic context |
| 15 | **Gambling** | "Was there gambling activity?" | Betting, casino, lottery, and in-game wagering. Motive evidence in embezzlement and fraud |
| 16 | **File sharing, Cloud storage & Transfer** | "How did the data leave?" | Consumer and enterprise cloud storage, document collaboration, large-file transfer, peer-to-peer, paste and snippet services |
| 17 | **Anonymity & Privacy tooling** | "Was there counter-forensic preparation?" | VPN, Tor and proxy services, encrypted-DNS and DNS-tunnelling services, anonymous mail and disposable identity, secure-delete and anti-forensic tooling, remote-desktop services used for access concealment |
| 18 | **Hacking & Security tooling** | "Was there tool acquisition or capability building?" | Offensive tooling, exploit and vulnerability material, credential and password-attack resources, malware analysis and reverse-engineering resources, hacking community material. Distinguished from 7 by *offensive or intrusion-oriented* purpose, not by technical difficulty |
| 19 | **Ads, Trackers & Web infrastructure** | "Which of these rows record an act by the user at all?" | Advertising and tracking beacons, CDN and asset hosts, URL shorteners and redirect hops, parked and for-sale domains, login and consent walls, private-IP and appliance hosts, browser-internal pages. **A positive identification that the row is machine-originated or content-free** — which is exactly what distinguishes it from 20. See D-04 |
| 20 | **Unclassified / insufficient signal** | *(mandatory)* "Can this row support any claim?" | The row's title and URL together carry no discriminating signal — empty or generic app-shell titles, opaque identifiers, bare hosts with no readable token. **A forensic classifier must be permitted to say nothing; a forced argmax on a signal-free row is a false statement in a report.** Unchanged from #136 §7 in intent, narrowed in extent by 19 |

### Opt-in overlay pack — never in the core, never in the core macro

Five labels whose definitions are jurisdiction-dependent or legally loaded. Each ships with its own written
definition, is enabled explicitly by the investigator, and is scored on its own.

| Overlay | Why it is an overlay and not core |
|---|---|
| **Drugs & Controlled substances** | Legality varies by jurisdiction and by substance; FortiGuard splits `Marijuana` from `Drug Abuse`, Talos splits `Cannabis` from `Illegal Drugs`, and a single label cannot be correct in both a jurisdiction where a substance is legal and one where it is not |
| **Alcohol & Tobacco** | Age-restricted rather than illegal; carried by FortiGuard, Talos and Cloudflare. Of interest only in specific casework |
| **Weapons** | `Weapons (Sales)` in FortiGuard, `Weapons`/`Hunting` in Talos, `Weapons` in Cloudflare. Lawful commerce in one jurisdiction, an offence in another |
| **Extremism & Hate** | FortiGuard `Extremist Groups`/`Terrorism`/`Discrimination`, Talos `Terrorism and Violent Extremism`/`Hate Speech`, Cloudflare `Militancy, Hate & Extremism`. Definitions are statutory and differ; and the label is proximate to political opinion, an Article 9 category |
| **Piracy & Copyright infringement** | UT1 `warez`, FortiGuard `Illegal or Unethical`/`Plagiarism`, Talos `Illegal Downloads`/`Cheating and Plagiarism`. Directly relevant in IP-theft casework, and a legal conclusion rather than an observation everywhere else |

### How this scores as a fixed set

The label set is fixed at exactly the 20 above for the whole of #137's evaluation.

- **Multi-label**, as #137 §1 requires. A row may carry more than one core label. Scoring is therefore
  per-label binary precision/recall/F1 over the 20, with macro-F1 averaged over exactly those 20 —
  never over a subset, and never over a merged or hierarchical view.
- **`Unclassified` is a real class and is scored like any other.** It is not an abstention bucket exempt
  from the metric. #137 §3's coverage-vs-accuracy sweep operates on the *confidence threshold*, which is a
  separate mechanism from this label.
- **Every row carries at least one label.** A row with an empty label set is a malformed fixture row, not
  an abstention. Abstention is spelled `Unclassified`.
- **`Unclassified` and `Ads, Trackers & Web infrastructure` are mutually exclusive by construction**, since
  one asserts absence of signal and the other asserts a positive identification. A row carrying both is a
  labelling-guide violation and the fixture build should reject it.
- **Overlays are scored separately** and never enter the core macro-F1. Turning an overlay on must not
  change any core number, which is only true if overlays are additional labels rather than a re-partition.
- **`SC` labels (13, 14) get their own reported confusion rows** alongside #137 §3's existing requirement
  that Adult false positives and false negatives be called out in both directions. Health inherits the same
  treatment for the reason in Finding 15.
- **No hierarchy at scoring time.** The set is flat. If a future version wants roll-ups for reporting, they
  are a presentation concern computed after scoring, never a scoring concern.

---

## 4. Decision log — every change against the #136 §7 draft

`ADD` / `SPLIT` / `MERGE` / `RENAME` / `KEEP` / `REJECT`, against the 15-label draft.

| ID | Decision | Label | Rationale |
|---|---|---|---|
| D-01 | **ADD** | Entertainment & Streaming (folded into core label 6) | Suspected gap, confirmed 7/8 (Finding 11). The draft's own justification for `News / Media / Reference` — "the high-volume benign baseline … prevents ordinary browsing being swept into an Other bucket that then *looks* anomalous in a chart" — applies with more force to streaming, which is the larger share of leisure browsing and had literally nowhere to go |
| D-02 | **ADD, then MERGE into D-01** | Gaming → core label 6 | 8/8 support, the strongest in the survey, and UT1 publishes `games` at 35,396 entries — its third-largest non-security category. Merged with Entertainment rather than given its own slot **solely** to respect the ≤20 cap; recorded here as the first candidate for promotion if the cap is ever raised, because the combined class will be the largest non-Unclassified class in the set and a large class is a weak class to diagnose |
| D-03 | **ADD** | Technology, Software & Developer resources (core 7) | 8/8 support. Its decisive argument is not coverage but *precision protection*: without it, ordinary technical work has no home and drifts into `Hacking & Security tooling`. A false positive on label 18 is one of the most damaging errors this tool can make in a report, and #137 §3 already singles out that class of error for separate reporting. Adding label 7 is the cheapest available defence |
| D-04 | **ADD** | Ads, Trackers & Web infrastructure (core 19) | Unsuspected gap. All four filtering vendors separate "categorised as infrastructure" from "not categorised" (Finding 12). Keeping them merged makes `Unclassified` the largest class in a real history and makes its per-class F1 uninterpretable, which defeats #137 §3's whole reason for demanding per-class F1 |
| D-05 | **SPLIT** | `News / Media / Reference` → `News & Current affairs` (4) + `Reference, Education & How-to` (5) | The draft's merge bundles three different questions. "What were they reading about" and "were they learning a method" are different report sentences, and the second is the one that matters in insider-threat and preparation timelines. Every surveyed set that has one also has the other as a distinct category |
| D-06 | **ADD** | Health & Medical (core 13) | Suspected gap, confirmed 6/8, with both dissenters explained: UT1 never needed it, Topics excluded it as sensitive. Marked `SC` under Finding 15 |
| D-07 | **RENAME** | `Webmail / Messaging / Communications` → `Webmail, Messaging & Voice` | "Communications" is broad enough to swallow social media and forums, which are label 3. Naming the channel types closes the overlap. Voice/meeting services are named explicitly because Talos, FortiGuard and Cloudflare all carry them and they were not obviously inside the draft's wording |
| D-08 | **RENAME + widen** | `Shopping / E-commerce / Marketplace` → `Shopping & Marketplace`, now absorbing real estate | Same question — "what were they acquiring, and does it match the alleged transaction". Real estate is carried by five surveyed sets but does not earn a slot of its own against the cap; property listings are marketplace listings |
| D-09 | **RENAME** | `Anonymity / Privacy tooling` → `Anonymity & Privacy tooling`, definition widened | Definition extended to encrypted-DNS, DNS-tunnelling and disposable-identity services, all of which UT1 (`doh`, `dynamic-dns`, `residential-proxies`), Talos (`Encrypted DNS`, `DNS-Tunneling`) and FortiGuard (`Dynamic DNS`) carry and none of which the draft's wording clearly covered |
| D-10 | **KEEP** | Search & Query | Corroborated from an unexpected direction: it is the *only* content question all three surveyed DF tools implemented (Findings 9, 10). Autopsy hard-codes `Search Engine`; Hindsight's one content plugin is `google_searches` |
| D-11 | **KEEP** | Adult & Sexual content, Gambling, Finance & Banking, Cryptocurrency, Employment, File sharing, Hacking tooling, Social media, Shopping, Travel | All present in the surveyed sets at the rates in Finding 11's table; none needed re-argument. Cryptocurrency deserves a note: the draft separated it from Finance on judgement alone, and four independent vendors do the same, so the judgement is corroborated |
| D-12 | **KEEP, narrowed** | Unclassified / insufficient signal (core 20) | Mandatory, unchanged in intent, narrowed in extent by D-04. Vendor precedent for a mandatory not-known state is unanimous among the filtering sources: FortiGuard `Not Rated` ("Sites not yet analyzed/categorized are considered unrated"), Talos `Not Actionable`, Cloudflare `Miscellaneous`/`No Content` |
| D-13 | **REJECT** | Sports as its own label | 8/8 presence but no distinct report sentence. Sports *media* is Entertainment; sports *betting* is Gambling, and that split is the forensically load-bearing one. A separate Sports label would compete with Gambling for exactly the rows that matter most |
| D-14 | **REJECT as a label, ROUTE by rule** | Dating & Relationships → core 3 | Carried by five sets, so the concept is real. It is rejected as a core label against the cap, but it gets an explicit routing rule because the alternative is worse: FortiGuard files `Dating` inside its `Adult / Mature Content` group, and inheriting that would put dating-site visits under an Adult heading in a report. Rule: **dating and matchmaking services are label 3, never label 14.** Best candidate for promotion after D-02 |
| D-15 | **REJECT, ROUTE by rule** | Government, Legal & Politics | Carried by seven sets. Rejected on two grounds. (a) The forensically interesting sub-parts already route cleanly: tax and benefits portals → 9, legal research → 5, political news → 4. (b) Political opinion is a GDPR Article 9 special category (Finding 15), and a label that reveals it should not be created without a specific investigative need to state it |
| D-16 | **REJECT, ROUTE by rule** | Religion & Belief | Same Article 9 argument as D-15, and Chrome's Topics taxonomy excluded it for the same reason (Finding 6). Religious content routes to 4 or 5 by what the page is doing. No forensic question was identified that requires asserting a subject's religion in a report |
| D-17 | **REJECT — explicitly, permanently, and with vendor precedent** | CSAM as a label | FortiGuard has `Child Sexual Abuse`, Talos has `Child Abuse Content`, Cloudflare has `Child Abuse` under an `Always blocked` group. ForensiX must not, and the draft was right. A filtering vendor's category is a blocking decision; a forensic tool's label is evidence, and this one carries an evidential standard, a legal handling regime and a hash-based methodology (Project VIC / CAID, as AXIOM implements — Finding 8) that a title-plus-URL classifier cannot meet. **A false positive here is catastrophic and a false negative is worse.** Not core, not an overlay, not configurable |
| D-18 | **REJECT as content, PROMOTE to a separate axis** | Malware, Phishing & Threat | Finding 13. All four filtering vendors keep threat structurally separate from content; UT1's `malware` + `phishing` alone are 540k entries. The forensic objection is independent and stronger: a reputation feed describes the domain today, and a history row describes it at visit time. Belongs to a dated, provenance-carrying second axis or nowhere. Explicitly **not** in the core 20 and **not** an overlay |
| D-19 | **REJECT for now, record as the strongest v2.x candidate** | Page-format / page-role as a second axis | Finding 16 — three unrelated sources converge on it, and #136 §24 already argued it costs one extra head rather than one extra pass. Excluded here because #137 needs *one* fixed set to compute macro-F1 against, and a second axis would need its own fixture, its own guide and its own metric. Deferring is a scoping decision, not a rejection of the idea |
| D-20 | **REJECT** | Food & Dining, Vehicles, Home & Garden, Pets, Fashion, Weather, Astrology, Paranormal, Humor, and the rest of the ad-tech long tail | Carried by the general-purpose taxonomies (IAB 36 Tier-1, Topics 22, Curlie 15) because those exist to sell advertising or to browse a directory. None produces a sentence an investigator writes. They route to 5, 6 or 8. This is the same argument #136 §7 used against DMOZ, applied consistently to the newer sources |
| D-21 | **REJECT** | Adopting any surveyed set wholesale | UT1's 66 categories are shaped by one French university's block policy and include categories whose own descriptions say "DO NOT USE" (Finding 1). FortiGuard's grouping is a policy artefact that files Dating under Adult (Finding 4). Talos's 107 and Cloudflare's 125 are too fine to label consistently by hand at the 500-row scale #137 needs. Topics and IAB exclude the sensitive categories forensics is for (Finding 6). Curlie answers no investigative question (Finding 7). And no DF tool has one to copy (Findings 8–10) |
| D-22 | **KEEP the overlay principle, EXTEND the pack** | Drugs, Weapons, Extremism → plus Alcohol & Tobacco, Piracy & Copyright infringement | The draft named three jurisdiction-dependent extension points and was right about all three. Two more meet the same test on the same evidence: age-restricted substances (FortiGuard, Talos and Cloudflare all carry Alcohol and Tobacco separately from Drugs) and piracy (UT1 `warez`; FortiGuard `Illegal or Unethical`; Talos `Illegal Downloads`), which is a legal conclusion outside IP casework and a first-class question inside it |
| D-23 | **ADD a property, not a label** | `SC` special-category marking on labels 13 and 14 | Finding 15. Not a taxonomy change in the counting sense, but it is a change to the artefact: the label set must publish which labels emit GDPR Article 9 data, so the report layer and [#122](https://github.com/ChmaraX/forensix/issues/122) can act on it |

**Net effect against the draft:** 15 → 20 labels. Added 5 (Entertainment+Gaming, Technology, Health, Ads &
Infrastructure, and Reference split out of News). Renamed 3. Rejected 9 concepts with routing rules.
Extended the overlay pack from 3 to 5. Added one non-counting property.

---

## 5. Sources

**Kept — primary, fetched, stored under `research/_raw/137/`, itemised in
[`research/_raw/137-fetch-manifest.md`](_raw/137-fetch-manifest.md)**
- `https://dsi.ut-capitole.fr/blacklists/index_en.php` and `/blacklists/download/` — UT1's 66 categories,
  entry counts, licence, and the 90 published artifacts
- `https://www.fortiguard.com/webfilter/categories` — 87 categories, 6 groups, and `Not Rated`
- `https://talosintelligence.com/categories` — 107 content + 27 threat categories in two tables
- `https://developers.cloudflare.com/cloudflare-one/policies/gateway/domain-categories/` — 27/125 with the
  `Miscellaneous` and `No Content` subcategories
- `https://raw.githubusercontent.com/InteractiveAdvertisingBureau/Taxonomies/main/Content%20Taxonomies/Content%20Taxonomy%203.0.tsv`
  — IAB 3.0, 706 rows, 36 Tier-1
- `https://raw.githubusercontent.com/patcg-individual-drafts/topics/main/taxonomy_v1.md`, `taxonomy_v2.md`,
  `README.md` — Chrome Topics API taxonomy and the sensitive-topic exclusion sentence
- `https://curlie.org/en/` — the 15 ODP top-level categories, via a real browser
- `https://docs.magnetforensics.com/docs/axiom/html/Content/Resources/PDFs/Magnet%20AXIOM%20User%20Guide.pdf`
  — the AXIOM negative finding and the 15 timeline activity categories
- `https://docs.magnetforensics.com/docs/axiom/html/Content/en-us/reviewing-evidence/explorers/browsing-artifacts.htm`
- `https://raw.githubusercontent.com/sleuthkit/autopsy/develop/RecentActivity/src/org/sleuthkit/autopsy/recentactivity/default_domain_categories.csv`
  and `DefaultPriorityDomainCategorizer.java` — Autopsy's four categories
- `https://api.github.com/repos/obsidianforensics/hindsight/git/trees/main?recursive=1` — Hindsight's plugin set
- `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679` — GDPR Article 9(1) verbatim
- `https://export.arxiv.org/api/query?search_query=all:"web page classification"` — academic pass, titles
  and abstracts only

**Carried from #136 without re-fetching**
- `research/_raw/ext/weborganizer-topics.yaml`, `research/_raw/configs/WebOrganizer__TopicClassifier.json` —
  the 24 topic labels used in Finding 11's table
- `research/136-approach-survey.md` §7, §23, §24 — the draft under review, the fixed-label-set constraint,
  and the format-axis idea

**Dropped, with the reason**
- Netcraft — three candidate URLs 404; `sitemap.xml` (200) has no `categor` URL. Named in the plan, not obtained
- Symantec/Broadcom WebPulse — category PDF and KB article both 404
- Zscaler — client-rendered shell, no category list in the response body
- Belkasoft, X-Ways, Nuix, Oxygen — no URL-categorisation documentation located
- Magnet AXIOM *Artifact Reference* guide — 404 at the PDF path used by the user guide's sibling
- DuckDuckGo (HTML and Lite), Bing, Mojeek — anti-bot challenges. Brave Search HTML was used **only** to
  discover a URL pattern; no claim rests on it
- FortiGuard via a real browser — a web filter on the research host blocked it. The `curl` capture is the
  one used, which is a mildly funny way to confirm the category set is doing its job
- Every accuracy, F1 or leaderboard figure encountered en route — out of scope by rule, as in #136

---

## 6. Gaps / STILL-UNKNOWN

1. **The DF-tool negative finding rests on n=3.** AXIOM, Autopsy and Hindsight were checked. Belkasoft,
   X-Ways, Nuix, Oxygen, EnCase and OSForensics were not, because no public categorisation documentation
   was located. If any of them ships a browsing-content taxonomy, Finding 8's claim needs narrowing from
   "digital-forensics tools" to "the three that were checked". **Next step:** vendor documentation portals
   directly, or a trial licence.
2. **Netcraft.** Named in the research plan, no categorisation service page found. **Next step:** the
   sitemap has 57,014 bytes of URLs; a full crawl of it, or the company's product pages via a real browser.
3. **UT1's `LICENSE.pdf` was fetched but not text-extracted** (78,194 B, SHA-256 `c3764e59…`). The CC BY-SA
   4.0 claim rests on the live `rel="license"` links in the index page, which is sufficient, but the PDF is
   the artifact that actually ships with the data and it has not been read. **Next step:** extract and diff
   against the page.
4. **No per-label prevalence estimate against real Chrome history exists.** Finding 12 argues that
   `Unclassified` would be the largest class without label 19; UT1's entry counts make that plausible but
   they measure a *block list*, not a history. Until #137's fixture is sampled, the class-balance of this
   taxonomy over real profiles is unknown — and class balance is what decides whether 20 labels is too many
   to score stably. **This is the highest-value unknown in the brief**, and #137's own §1 sampling resolves
   it for free.
5. **Whether 20 labels can be applied consistently by one human labeller at 500+ rows.** The boundary rules
   in §3 are written but untested. Inter-rater agreement on the boundaries most at risk — 7 vs 18, 3 vs 14,
   19 vs 20, 5 vs 4 — has not been measured. **Next step:** a second labeller on a subsample, before the
   full fixture is built. Note that #137's independence rule constrains who that second labeller may be.
6. **The threat axis (D-18) and the format axis (D-19) are both deferred with no owner.** Neither belongs to
   #137. Both should get their own tickets rather than being rediscovered later.
7. **Whether `Ads, Trackers & Web infrastructure` is better served by Chrome's `visits.transition` column
   than by a content classifier.** A redirect hop and an ad beacon are visible in transition types without
   any model at all. If transition data answers most of label 19, the label may be cheaper as a
   deterministic tier-0 rule than as a class the model must learn. **Next step:** cross-check against
   [`research/118-chrome-artifacts-today.md`](118-chrome-artifacts-today.md) for what transition values v2
   actually reads, and decide before the fixture is labelled — because if it becomes a rule, the label's
   ground-truth rows change.
8. **Overlay definitions are named but not written.** §3 lists five overlays and the reason each is an
   overlay; none has the per-jurisdiction definition text it needs to be usable. Deliberately out of scope
   here — writing them is a legal-drafting task, not a taxonomy-design one — but they are not shippable
   until someone does.
