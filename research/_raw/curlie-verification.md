# Curlie directory-data verification

**Claim source:** /tmp/run3-background.md (unverified ChatGPT run, summarised from https://curlie.org/docs/en/rdf.html)
**Full claim:** "Curlie provides a downloadable directory of ~2.9M human-categorized websites
(URL, title, description, hierarchical category), ~200 MB compressed, refreshed ~monthly,
openly licensed and maintained."
**Verified by:** researcher agent, 2026-08-08, primary sources only.
**Evidence index:** `curlie-fetch-manifest.md` + page captures `curlie-rdf-page.png`,
`curlie-license-page.png`, `curlie-termsofuse-page.png`.

---

## Sub-claim verdicts

### (1) Does the download exist and where?

**CONFIRMED** — Source: curlie.org/docs/en/rdf.html (HTTP 200) + curl HEAD probes.

The download is real and publicly accessible:

- Entry point: `https://curlie.org/directory-dl` (HTTP 302 redirect, no auth required)
- Resolves to: `https://share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz`
- Hosted on an S3-compatible object store at the University of Passau / OpenWebSearch.eu
  (indicated by `x-amz-*` response headers and `<Owner><DisplayName>minio</DisplayName></Owner>`
  in the bucket listing XML).
- The download page names two hosting partners: Leibniz Supercomputing Centre (LRZ) and
  OpenWebSearch.eu; the live URL resolves to the OpenWebSearch.eu / Uni Passau host.
- The S3 bucket contains exactly one file (`<IsTruncated>false</IsTruncated>`, one `<Contents>`
  entry).

---

### (2) Actual size

**CONFIRMED WITH CORRECTION** — Source: HTTP HEAD response + S3 bucket XML listing.

| Claim | Actual (as of 2026-02-02) |
|---|---|
| "~200 MB compressed" | **177,289,960 bytes = 177.3 MB** (decimal) / 169.1 MiB |

Curlie's own download page also states "only two hundred megabytes" — both the claim and the
Curlie page round up. The real file is ~12% smaller than the stated ~200 MB. The order of
magnitude (~100s of MB, single compressed file) is correct.

`content-length: 177289960` confirmed by both HTTP HEAD on the file and `<Size>177289960</Size>`
in the S3 bucket XML.

---

### (3) Actual licence text and who states it

**CONFIRMED WITH NUANCE** — Source: curlie.org/docs/en/license.html (HTTP 200).

Exact text from the licence page (stated by Curlie.org):

> "This web directory (the data of categories and listed sites) is licensed under a
> **Creative Commons Attribution 3.0 Unported License**."

The licence is CC BY 3.0 — permissive but **not attribution-free**. The licence page specifies
required attribution HTML and text. The rdf.html page calls it an "Open Source license", and the
licence page heading is "Free Use License".

The claim's wording "openly licensed" is broadly correct (CC BY 3.0 is an open licence) but
omits the mandatory attribution requirement. "Openly licensed" without that caveat would
mislead a practitioner about what is needed for compliant use.

Licence stated by: **curlie.org** itself on its canonical licence page.
Licence icon on page: Creative Commons CC BY badge (confirmed in screenshot).

The Terms of Use (curlie.org/docs/en/termsofuse.html) is a separate document covering site
use; it does not override the data licence but adds a copyright assignment clause for editor
contributions ("you hereby assign to Curlie the copyright in any material … you create and
submit for inclusion"). This means the data copyright sits with **Curlie Project Inc** and is
then re-licensed to users under CC BY 3.0.

---

### (4) Refresh cadence

**CONFIRMED (ASPIRATION) / GAP (ACTUAL CADENCE)** — Source: curlie.org/docs/en/rdf.html (HTTP 200)
+ S3 bucket `<LastModified>`.

Exact text from rdf.html:

> "We **strive** to pull a fresh copy from the Curlie database **every month**."

The word "strive" signals a best-effort target, not a guarantee.

**Actual cadence evidence:** The S3 bucket contains one file with
`<LastModified>2026-02-02T21:58:48.128Z</LastModified>`. As of the fetch date 2026-08-08, the
file is **~6 months old** — well beyond one month. Only one snapshot is visible in the bucket
(no versioning or rotation history accessible).

Verdict: The stated goal of monthly refresh is CONFIRMED as Curlie's stated policy. The
**actual observed cadence** from the current snapshot is STILL-UNKNOWN beyond the single
timestamp 2026-02-02 (historical refresh history is not exposed by the public bucket listing).

---

### (5) Fields the download contains

**CONFIRMED** — Source: curlie.org/docs/en/rdf.html, section "Data in the download" (HTTP 200).

Exact text from rdf.html:

> "The download contains the category hierarchy, categories and websites.
> For the websites, there is the **URL, title and editorial description**.
> For each category, there's its **title, description, and place in the category tree**.
> Some 45,000 categories (cities, for example) also bear a **geographic label**."

Field mapping to claim:

| Claimed field | Confirmed? | Notes |
|---|---|---|
| URL | CONFIRMED | website-entry files |
| title | CONFIRMED | website-entry files |
| description | CONFIRMED | "editorial description" |
| hierarchical category | CONFIRMED | via category IDs; "full category path is included with each category entry" |

Additional fields not in claim: category title, category description, geographic label (cities),
category-tree IDs linking website entries to category entries.

File format: TSV (tab-separated values), UTF-8, tar/gzip compressed archive.
The "RDF" in filenames is a legacy naming artefact from an older format; current format is TSV/CSV.

---

### Bonus: ~2.9M entries

**CONFIRMED** — Source: curlie.org/docs/en/rdf.html.

Exact text: "Curlie consists of a whopping **2.9 million** well-structured entries!"
The page also says: "largest human-edited directory of the web in the world … curated by
passionate editors … only contains high-quality non-spam websites."

"Human-categorized" is accurate: volunteer editors place sites; bots assist with spam detection.

---

## Summary table

| Sub-claim | Verdict | Key deviation |
|---|---|---|
| Download exists | CONFIRMED | URL: curlie.org/directory-dl → share.innkube.fim.uni-passau.de/curlie-rdf/curlie-rdf-all.tar.gz |
| ~200 MB compressed | CONFIRMED WITH CORRECTION | Actual: 177.3 MB (not 200 MB; ~12% smaller) |
| ~2.9M entries | CONFIRMED | Stated verbatim on rdf.html |
| Human-categorized | CONFIRMED | Volunteer editors; bot-assisted spam removal |
| Openly licensed | CONFIRMED WITH NUANCE | CC BY 3.0 — open but requires attribution; stated by Curlie.org |
| Refreshed ~monthly | CONFIRMED (stated goal only) | "strive … every month"; actual file is 6 months old as of 2026-08-08 |
| Fields: URL, title, description, hierarchical category | CONFIRMED | All four present; plus geographic label on ~45k categories |

---

## Forensix relevance notes (#119/#136)

- CC BY 3.0 attribution is required in any public-facing use of Curlie data. An internal
  training/label pipeline does not expose Curlie content to end-users but the licence terms
  should be reviewed with counsel for the specific deployment.
- The 6-month-stale snapshot and "strive" cadence language suggest the data is not reliably
  monthly-refreshed. Plan for a static snapshot, not a live-updating source.
- Fields are sufficient for domain→category lookup: registrable domain extracted from URL,
  category path as label. No page content or embeddings are in the dump.
- The dump is a single tar.gz; at 177 MB it fits in memory on a standard dev machine.
- "Human-categorized" quality claim is based on volunteer editing with bot-assisted spam
  detection — not ML labels. This is a strength for training-data ground truth.
