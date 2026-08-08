# Fetch manifest — ChmaraX/forensix#137 taxonomy survey

Generated `2026-08-08T11:39Z`. Captures live under `research/_raw/137/`.
Every claim in `research/137-taxonomy-proposal.md` tagged **CONFIRMED** points at a row here.

Fetch method: `curl -sSL` with a desktop browser User-Agent, except the two rows marked
*browser* which were driven through a real Chromium session because the page is client-rendered.

## Kept — captured, parsed, load-bearing

| # | URL | Status | Local file | Bytes | SHA-256 (first 16) | What it owns |
|---|-----|--------|-----------|-------|--------------------|--------------|
| 1 | `https://dsi.ut-capitole.fr/blacklists/index_en.php` | 200 | `137/ut1-index_en.html` | 38,754 | `e51b1a10dc78f67c` | UT1's 66-row category table with per-category entry counts; the `rel="license"` CC BY-SA 4.0 link |
| 2 | `https://dsi.ut-capitole.fr/blacklists/download/` | 200 | `137/ut1-download-listing.html` | 21,277 | `cd15279a7b5c492f` | The 90 `.tar.gz` artifacts actually published, incl. alias names absent from the table |
| 3 | `https://dsi.ut-capitole.fr/blacklists/download/LICENSE.pdf` | 200 | `137/ut1-LICENSE.pdf` | 78,194 | `c3764e595a6e5461` | Licence artifact shipped alongside the data. **Not text-extracted** — see gaps |
| 4 | `https://www.fortiguard.com/webfilter/categories` | 200 | `137/fortiguard-webfilter-categories.html` | 148,341 | `2a5c34e510fa7653` | FortiGuard's 87 categories in 6 groups + the `Unrated`/`Not Rated` group |
| 5 | `https://talosintelligence.com/categories` | 200 | `137/talos-categories.html` | 142,658 | `58d9fde7d14cb6ca` | Cisco Talos 107 content categories + 27 threat categories, in two separate tables |
| 6 | `https://developers.cloudflare.com/cloudflare-one/policies/gateway/domain-categories/` | 200 | `137/cloudflare-gateway-domain-categories.html` | 301,805 | `5c5022fcb11d9035` | Cloudflare Gateway 27 top-level / 125 subcategory IDs; `No Content`, `Login Screens`, `Miscellaneous` |
| 7 | `https://raw.githubusercontent.com/InteractiveAdvertisingBureau/Taxonomies/main/Content%20Taxonomies/Content%20Taxonomy%203.0.tsv` | 200 | `137/iab-ct-3.0.tsv` | 47,335 | `413b319591649576` | IAB Content Taxonomy 3.0 — 706 rows, 36 Tier-1 names |
| 8 | `https://raw.githubusercontent.com/patcg-individual-drafts/topics/main/taxonomy_v1.md` | 200 | `137/topics-api-taxonomy_v1.md` | 30,537 | `78f71dd5950c868d` | Chrome Topics API taxonomy v1 — 349 topics, 24 top-level |
| 9 | `https://raw.githubusercontent.com/patcg-individual-drafts/topics/main/taxonomy_v2.md` | 200 | `137/topics-api-taxonomy_v2.md` | 54,165 | `fd6faedcb6463498` | Topics API taxonomy v2 — 469 topics, 22 top-level |
| 10 | `https://raw.githubusercontent.com/patcg-individual-drafts/topics/main/README.md` | 200 | `137/topics-README.md` | 30,510 | `2a663c44065f16de` | The explainer's "attempt to exclude sensitive topics" sentence |
| 11 | `https://curlie.org/en/` | 200 | `137/curlie-en.html` | 47,872 | `91ee47122354b96c` | Curlie/ODP 15 top-level categories. *browser* — the list is client-rendered, HTML capture alone does not contain it |
| 11a | `https://curlie.org/en/Adult/` | 200 | `137/curlie-en-Adult.html` | 37,536 | `bbb30067343b4bde` | Probe: the Adult branch exists (`<title>Curlie - Adult</title>`) but is absent from the front-page tree |
| 12 | `https://docs.magnetforensics.com/docs/axiom/html/Content/Resources/PDFs/Magnet%20AXIOM%20User%20Guide.pdf` | 200 | **not redistributed** — see "Fetched and hashed, deliberately not redistributed" | 4,161,401 | `653e83646e231bca` | 468-page AXIOM user guide — the negative finding on browsing-content categories |
| 12a | (text extraction of #12, `pypdf`) | — | **not redistributed** — see below | 542,200 | `06776b66eacf3292` | The searched artifact; term counts quoted in the brief are against this file |
| 13 | `https://docs.magnetforensics.com/docs/axiom/html/Content/en-us/reviewing-evidence/explorers/browsing-artifacts.htm` | 200 | `137/magnet-browsing-artifacts.html` | 27,460 | `5f63d478900a73a3` | AXIOM Artifacts-explorer view model; links to the PDF above |
| 14 | `https://raw.githubusercontent.com/sleuthkit/autopsy/develop/RecentActivity/src/org/sleuthkit/autopsy/recentactivity/default_domain_categories.csv` | 200 | `137/autopsy-default_domain_categories.csv` | 3,256,083 | `b789cdb9f80516f2` | Autopsy's entire shipped domain→category table: 3 distinct categories |
| 15 | `https://raw.githubusercontent.com/sleuthkit/autopsy/develop/RecentActivity/src/org/sleuthkit/autopsy/recentactivity/DefaultPriorityDomainCategorizer.java` | 200 | `137/autopsy-DefaultPriorityDomainCategorizer.java` | 7,144 | `bf274c4331d61063` | Autopsy's only hard-coded category, `Search Engine` |
| 16 | `https://api.github.com/repos/obsidianforensics/hindsight/git/trees/main?recursive=1` | 200 | `137/hindsight-tree.json` | 139,409 | `8592b5f468e36cc0` | Hindsight's full file tree — 10 plugins, none a content categoriser |
| 17 | `https://export.arxiv.org/api/query?search_query=all:"web page classification"&max_results=15` | 200 | `137/arxiv-web-taxonomy.xml` | 20,452 | `fbe058f6db7e8d80` | Academic pass. **Titles and abstracts only; no reported figure was read out of it** |
| 18 | `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679` | 200 | `137/gdpr-celex.html` | 809,036 | `e91620a212c7ef2a` | GDPR Article 9(1) verbatim — the special-category argument |

## Fetched and hashed, deliberately NOT redistributed

These were fetched, hashed and read to support the negative finding in
`research/137-taxonomy-proposal.md` (AXIOM ships no browsing-content taxonomy).
They are **proprietary vendor documentation** and no licence permits redistributing
them, so the bytes are not carried in this repository. The evidence that survives
is the URL plus the full SHA-256, which is sufficient to re-fetch and re-verify
the exact artifact the claim was read from.

| # | URL | Bytes | SHA-256 (full) | Why not redistributed |
|---|-----|-------|----------------|----------------------|
| 12 | `https://docs.magnetforensics.com/docs/axiom/html/Content/Resources/PDFs/Magnet%20AXIOM%20User%20Guide.pdf` | 4,161,401 | `653e83646e231bca08fbf3c2234407e282aa7a93ec6b454d668f13095614223c` | Magnet Forensics' commercial product manual, all rights reserved. Verbatim redistribution is not permitted. |
| 12a | text extraction of #12 (`pypdf`) | 542,200 | `06776b66eacf3292bc7b1ad624b5949a3d46b604f688b829e2d22e632e82986d` | Derivative of a proprietary work; same restriction. |

Re-fetch and verify:

```bash
curl -sSL -A 'Mozilla/5.0' \
  'https://docs.magnetforensics.com/docs/axiom/html/Content/Resources/PDFs/Magnet%20AXIOM%20User%20Guide.pdf' \
  -o magnet-axiom-user-guide.pdf
shasum -a 256 magnet-axiom-user-guide.pdf
# expect 653e83646e231bca08fbf3c2234407e282aa7a93ec6b454d668f13095614223c
```

Row 13 (`137/magnet-browsing-artifacts.html`) is retained: it is a short public
documentation page, consistent with the other HTML captures in this manifest.

Also read, already in the tree from #136 and not re-fetched:
`research/_raw/ext/weborganizer-topics.yaml`, `research/_raw/configs/WebOrganizer__TopicClassifier.json`,
`research/_raw/ext/ut1-blacklists-index_en.html`.

## Dropped — fetched and discarded, or never obtained

| URL | Status | Why dropped |
|-----|--------|-------------|
| `https://www.fortiguard.com/webfilter/categories` (*browser* attempt) | blocked | A web filter on the research host returned "The URL you requested has been blocked". The `curl` capture (row 4) succeeded and is the one used |
| `https://help.zscaler.com/zia/about-url-categories` | 200, 1,890 B | Shell page only; the category list is behind client-side rendering. Not carried |
| `https://sitereview.bluecoat.com/resources/bcss_categories_all.pdf` | 404 | Symantec/Broadcom WebPulse category list not obtained |
| `https://knowledge.broadcom.com/external/article/170912` | 404 | ditto |
| `https://www.netcraft.com/services/site-categorisation/`, `/site-categorisation/`, `/platform/website-categorization/` | 404 | Netcraft was named in the research plan; no categorisation-service page could be located, and `netcraft.com/sitemap.xml` (200) contains no URL matching `categor`. **STILL-UNKNOWN** |
| `https://docs.paloaltonetworks.com/pan-os/11-1/pan-os-admin/url-filtering/url-filtering-concepts/url-categories` | 404 | Doc path moved; not chased |
| `https://www.shallalist.de/categories.html` | 404 | Shalla list appears gone; UT1's own page still links it |
| `https://belkasoft.com/x/help/`, `https://www.osforensics.com/...` | 200 / 404 | No URL-categorisation documentation located. Belkasoft, X-Ways, Nuix, Oxygen: **STILL-UNKNOWN** |
| DuckDuckGo HTML, DuckDuckGo Lite, Bing, Mojeek | 202 / bot challenge | All four served anti-bot challenges. Brave Search HTML returned links and was used **only** to discover the `docs.magnetforensics.com` URL pattern; no claim rests on it |
| `https://docs.magnetforensics.com/docs/axiom/html/Content/Resources/PDFs/Magnet%20AXIOM%20Artifact%20Reference.pdf` | 404 | The AXIOM *Artifact Reference* guide, which would give the artifact-group names verbatim. See gaps |
