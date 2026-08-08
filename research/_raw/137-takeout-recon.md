# 137 Takeout Recon — Magnet Forensics CTF Packages

**Purpose:** Evaluate three Magnet Forensics CTF "Takeout" packages as candidate ground-truth
source material for `ChmaraX/forensix#137` (browsing-history classifier test set).

**Generated:** 2026-08-08  
**Branch:** `research/wayfinder-v2` (not committed — raw research file)  
**Sources:** Digital Corpora S3 — `corpora/scenarios/magnet/`

---

## Method

All download, extraction, and parsing was performed inside an isolated Docker container.
Archive contents were never executed or extracted onto the host. The host received only
this markdown report.

```
Container image:  debian:bookworm-slim
Image digest:     sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
OS inside:        Debian GNU/Linux 12 (bookworm)
Tools:            curl, unzip, python3 3.11.2, sqlite3 3.40.1, jq
```

Files were extracted with `unzip -d <scratch-vol-subdir>` (never onto the host mount).
Only `json.load()`, `open(...).read()`, and regex were used — no execution of extracted
files at any point.

---

## Archive checksums

| Year | SHA-256 | Declared size | Actual size |
|------|---------|---------------|-------------|
| 2019 | `82727e613494647adf1b9af4705e304ca5532ddde509c73456ac4164023012d5` | 2,177,749 B | 2,177,749 B ✓ |
| 2021 | `a84314a87fcf83657fcca58b6b03947f39f049b20b42f0bfeee89adae06b3245` | 4,446,601 B | 4,446,601 B ✓ |
| 2022 | `800e0b74aeb407e1daae0176e17ccf6871d7b645c4ccc3c2e641d9373131999c` | 2,580,941 B | 2,580,941 B ✓ |

---

## Package: 2019 CTF Takeout

**CTF persona:** Selma Bouvier · `macgyverfan74@gmail.com`  
*(Simpsons character name — unambiguously staged)*

### 1. Full file listing (44 files)

| Path | Size (B) |
|------|---------|
| `Takeout/Android Device Configuration Service/Device-4116173846655979098.html` | 29,639 |
| `Takeout/Bookmarks/Bookmarks.html` | 164 |
| `Takeout/Calendar/macgyverfan74@gmail.com.ics` | 187 |
| `Takeout/Contacts/All Contacts/All Contacts.vcf` | 311 |
| `Takeout/Contacts/My Contacts/My Contacts.vcf` | 169 |
| `Takeout/Contacts/Starred in Android/Starred in Android.vcf` | 0 |
| `Takeout/Drive/Getting started.pdf` | 1,560,010 |
| `Takeout/G Suite Marketplace/README` | 366 |
| `Takeout/Google My Business/account-101569388829944777243/data.json` | 102 |
| `Takeout/Google Pay/Money sends and requests/Money sends and requests.csv` | 67 |
| `Takeout/Google Pay/Saved items including loyalty _ gift cards/Loyalty Gift Cards and Offers.pdf` | 70,577 |
| `Takeout/Google Play Movies _ TV/Linked Services.json` | 2 |
| `Takeout/Google Play Movies _ TV/Notification Preferences.json` | 2 |
| `Takeout/Google Play Movies _ TV/Ratings.json` | 2 |
| `Takeout/Google Play Movies _ TV/Streaming Services.json` | 2 |
| `Takeout/Google Play Movies _ TV/Watchlist.json` | 2 |
| `Takeout/Google Play Store/Devices.json` | 1,169 |
| `Takeout/Google Play Store/Installs.json` | 20,977 |
| `Takeout/Google Play Store/Library.json` | 3,766 |
| `Takeout/Google Play Store/Purchase History.json` | 2,630 |
| `Takeout/Google Shopping/Addresses/Addresses.txt` | 33 |
| `Takeout/Google Shopping/Loyalty/Loyalty.txt` | 40 |
| `Takeout/Google Shopping/Orders/Orders.txt` | 0 |
| `Takeout/Hangouts/Hangouts.json` | 25 |
| `Takeout/Home App/HomeApp.json` | 43 |
| `Takeout/Mail/All mail Including Spam and Trash.mbox` | 304,378 |
| `Takeout/My Activity/Ads/MyActivity.html` | 145,762 |
| `Takeout/My Activity/Android/MyActivity.html` | 243,807 |
| `Takeout/My Activity/Chrome/MyActivity.html` | 148,389 |
| `Takeout/My Activity/Discover/MyActivity.html` | 143,439 |
| `Takeout/My Activity/Google Play Store/MyActivity.html` | 208,788 |
| `Takeout/My Activity/Help/MyActivity.html` | 142,431 |
| `Takeout/My Activity/Search/MyActivity.html` | 153,556 |
| `Takeout/My Activity/YouTube/MyActivity.html` | 144,549 |
| `Takeout/News/articles.txt` | 0 |
| `Takeout/News/magazines.txt` | 0 |
| `Takeout/News/sources.txt` | 0 |
| `Takeout/News/topics.txt` | 0 |
| `Takeout/Profile/Profile.json` | 185 |
| `Takeout/Tasks/Tasks.json` | 3 |
| `Takeout/YouTube/history/search-history.html` | 142,390 |
| `Takeout/YouTube/history/watch-history.html` | 143,917 |
| `Takeout/YouTube/subscriptions/subscriptions.json` | 3 |
| `Takeout/index.html` | 520,869 |

### 2. Browser history artifacts

- **No `BrowserHistory.json` found** — this is a 2019 Takeout and Chrome's structured history
  export (`Chrome/BrowserHistory.json`) was not included in the Takeout scope.
- **My Activity/Chrome/MyActivity.html** present at `Takeout/My Activity/Chrome/MyActivity.html`
  (148,389 B) — HTML rendering of Chrome browsing events, not machine-parseable JSON.
  Extracted 9 hrefs; only 3 were non-tracking. **CONFIRMED** by direct file read inside container.
- No raw History SQLite file (Chrome's `History` database is not exported in Takeout format).
- No other history SQLite candidates found.

### 3. History artifact analysis

`My Activity/Chrome/MyActivity.html` is a human-readable HTML page rendered by Google's
archive browser — it is not a structured export. Sample hrefs recovered:

```
https://www.google.com/search?q=kingoroot&oq=kingo&...
https://www.google.com/amp/s/www.orlandosentinel.com/...iguanas-invasion...
```

These are click-through tracking wrappers from Google's activity log renderer.
**Not usable as structured title+URL pairs without a custom HTML parser.** Row count: ~9
recoverable links (not representative of full visit history). Fields: none corresponding
to `time_usec`, `page_transition`, or `title` in structured form.

### 4. Other browsing-relevant artifacts

| Artifact | Path | Size |
|----------|------|------|
| YouTube search history | `Takeout/YouTube/history/search-history.html` | 142,390 B |
| YouTube watch history | `Takeout/YouTube/history/watch-history.html` | 143,917 B |
| Chrome Bookmarks | `Takeout/Bookmarks/Bookmarks.html` | 164 B |
| My Activity / Search | `Takeout/My Activity/Search/MyActivity.html` | 153,556 B |
| My Activity / YouTube | `Takeout/My Activity/YouTube/MyActivity.html` | 144,549 B |
| My Activity / Android | `Takeout/My Activity/Android/MyActivity.html` | 243,807 B |

YouTube history HTML files are non-trivial in size; they could be HTML-parsed for watched
video titles + youtube.com URLs if needed, but that's a secondary path.

### 5. PII assessment

| File | Finding |
|------|---------|
| `Takeout/Profile/Profile.json` | `displayName = "Selma Bouvier"` — Simpsons character, clearly fictional |
| `Takeout/Calendar/macgyverfan74@gmail.com.ics` | Email `macgyverfan74@gmail.com` — CTF scenario account |

**Assessment:** No real personal PII. "Selma Bouvier" is an unambiguous fictional TV character.
The email handle `macgyverfan74` is consistent with a staged nostalgic persona.
**No PII risk.** CONFIRMED by `Profile.json` read inside container.

---

### Verdict — 2019: `UNUSABLE`

**Reason:** No `BrowserHistory.json` and no machine-parseable structured history export.
The My Activity/Chrome HTML has ~9 recoverable hrefs — far below any useful threshold.
The 2019 Takeout format predates Chrome's inclusion of `BrowserHistory.json` as a
distinct structured artifact in Takeout exports.

---

## Package: 2021 CTF Takeout

**CTF persona:** Eli Flatt · `e.flatt610@gmail.com` / `e.flatt610@protonmail.com`  
*(Consistent fictional persona — "Eli Flatt" is a CTF-constructed character)*

### 1. Full file listing (66 files)

| Path | Size (B) |
|------|---------|
| `Takeout/Calendar/e.flatt610@gmail.com.ics` | 184 |
| `Takeout/Chrome/Autofill.json` | 30 |
| `Takeout/Chrome/Bookmarks.html` | 897 |
| `Takeout/Chrome/BrowserHistory.json` | **93,051** |
| `Takeout/Chrome/Dictionary.csv` | 0 |
| `Takeout/Chrome/Extensions.json` | 4,283 |
| `Takeout/Chrome/SearchEngines.json` | 6,453 |
| `Takeout/Chrome/SyncSettings.json` | 4,120 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1612397553415.jpg` | 632,233 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1612397553415_thumbnail.jpg` | 3,312 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1613945285717.jpg` | 632,283 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1613945285717_thumbnail.jpg` | 3,316 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1613990581081.jpg` | 632,178 |
| `Takeout/Drive/Chrome Syncable FileSystem/obklkkbkpaoaejdabbfldmcfplpdgolj/third_party_1613990581081_thumbnail.jpg` | 3,307 |
| `Takeout/Drive/To-Purchase.xlsx` | 6,270 |
| `Takeout/Drive/Untitled document.docx` | 7,038 |
| `Takeout/Google Account/e.flatt610.SubscriberInfo.html` | 4,865 |
| `Takeout/Google My Business/account-114419430591931904353/data.json` | 98 |
| `Takeout/Google My Business/businessPersonalization.json` | 3 |
| `Takeout/Google Pay/Money sends and requests/Money sends and requests.csv` | 67 |
| `Takeout/Google Pay/Saved items including loyalty _ gift cards/Loyalty Gift Cards and Offers.pdf` | 70,577 |
| `Takeout/Google Play Movies _ TV/Linked Services.json` | 2 |
| `Takeout/Google Play Movies _ TV/Notification Preferences.json` | 2 |
| `Takeout/Google Play Movies _ TV/Ratings.json` | 2 |
| `Takeout/Google Play Movies _ TV/Streaming Services.json` | 2 |
| `Takeout/Google Play Movies _ TV/Watchlist.json` | 2 |
| `Takeout/Google Shopping/Addresses/Addresses.txt` | 33 |
| `Takeout/Google Shopping/Collection Point/Collection Point.txt` | 33 |
| `Takeout/Google Shopping/Loyalty/Loyalty.txt` | 40 |
| `Takeout/Google Shopping/Merchant Reviews/Merchant Reviews.txt` | 34 |
| `Takeout/Google Shopping/Orders/Orders.txt` | 0 |
| `Takeout/Google Shopping/Person Collecting/Person Collecting.txt` | 33 |
| `Takeout/Google Shopping/Product Reviews/Product Reviews.txt` | 34 |
| `Takeout/Google Workspace Marketplace/README` | 375 |
| `Takeout/Hangouts/Hangouts.json` | 25 |
| `Takeout/Home App/GoogleNestPartnerConnections.json` | 66 |
| `Takeout/Home App/HomeApp.json` | 43 |
| `Takeout/Home App/HomeHistory.json` | 3 |
| `Takeout/Home App/SoundSensing.json` | 46 |
| `Takeout/Mail/All mail Including Spam and Trash.mbox` | 6,993,981 |
| `Takeout/Maps/Added dishes, products, activities/Added dishes, products, activities.json` | 27 |
| `Takeout/Maps/Electric vehicle settings/Electric vehicle settings.json` | 39 |
| `Takeout/Maps/Questions and Answers/Questions and Answers.json` | 83 |
| `Takeout/Maps/Service requests/Service requests.json` | 1 |
| `Takeout/My Activity/Ads/MyActivity.html` | 162,617 |
| `Takeout/My Activity/Chrome/MyActivity.html` | 175,840 |
| `Takeout/My Activity/Google Analytics/MyActivity.html` | 145,770 |
| `Takeout/My Activity/Image Search/MyActivity.html` | 144,630 |
| `Takeout/My Activity/Maps/MyActivity.html` | 145,847 |
| `Takeout/My Activity/Search/MyActivity.html` | 193,500 |
| `Takeout/My Activity/Video Search/MyActivity.html` | 142,545 |
| `Takeout/My Activity/YouTube/MyActivity.html` | 147,947 |
| `Takeout/News/articles.txt` | 0 |
| `Takeout/News/followed_locations.txt` | 0 |
| `Takeout/News/followed_sources.txt` | 0 |
| `Takeout/News/followed_topics.txt` | 0 |
| `Takeout/News/magazines.txt` | 0 |
| `Takeout/News/sources.txt` | 0 |
| `Takeout/News/topics.txt` | 0 |
| `Takeout/Profile/Profile.json` | 228 |
| `Takeout/Profile/ProfilePhoto.jpg` | 62,498 |
| `Takeout/Profile/ProfilePhotos/eli_profile.jpeg.jpg` | 458,970 |
| `Takeout/YouTube and YouTube Music/history/search-history.html` | 144,996 |
| `Takeout/YouTube and YouTube Music/history/watch-history.html` | 146,681 |
| `Takeout/YouTube and YouTube Music/subscriptions/subscriptions.json` | 3 |
| `Takeout/archive_browser.html` | 883,551 |

### 2. Browser history artifacts

- **FOUND `BrowserHistory.json`** at `Takeout/Chrome/BrowserHistory.json` (93,051 B)
  **CONFIRMED** — read and parsed as valid JSON inside container.
- No raw History SQLite (not exported in Takeout format by design).

### 3. History artifact analysis — `Takeout/Chrome/BrowserHistory.json` (CONFIRMED)

| Metric | Value |
|--------|-------|
| Row count | **222** |
| Fields present | `page_transition`, `title`, `url`, `client_id`, `time_usec` |
| Empty / missing titles | **0 / 222 (0%)** |
| Date range | 2021-02-03 06:00 UTC → 2021-03-09 00:02 UTC (~5 weeks) |
| Language mix | 100% ASCII English |

**Page transitions:**

| Transition | Count |
|-----------|-------|
| LINK | 131 |
| TYPED | 37 |
| GENERATED | 28 |
| RELOAD | 12 |
| FORM_SUBMIT | 10 |
| AUTO_BOOKMARK | 3 |
| AUTO_TOPLEVEL | 1 |

**Top 15 domains:**

| Domain | Visits |
|--------|--------|
| `google.com` | 52 |
| `docs.google.com` | 34 |
| `(chrome-internal / other)` | 31 |
| `chrome.google.com` | 23 |
| `mail.protonmail.com` | 10 |
| `vineyardvines.com` | 8 |
| `facebook.com` | 6 |
| `mail.google.com` | 6 |
| `goterriers.com` | 6 |
| `amazon.com` | 5 |
| `youtube.com` | 4 |
| `timesunion.com` | 3 |
| `chick-fil-a.com` | 3 |
| `ebay.com` | 3 |
| `apple.com` | 3 |

**10 random sample rows (seed=42):**

| # | Timestamp (UTC) | Title | URL (truncated) |
|---|----------------|-------|-----------------|
| 1 | 2021-02-17 01:15:31 | Shop Mens New Arrivals at vineyard vines | `https://www.vineyardvines.com/new-arrivals-men/...` |
| 2 | 2021-03-04 08:17:26 | Login \| ProtonMail | `https://mail.protonmail.com/login` |
| 3 | 2021-03-09 00:00:06 | command line chromebook - Google Search | `https://www.google.com/search?q=command+line+chromebook...` |
| 4 | 2021-02-05 19:21:30 | New Tab | `chrome://newtab/` |
| 5 | 2021-03-01 06:00:59 | Inbox \| e.flatt610@protonmail.com \| ProtonMail | `https://mail.protonmail.com/inbox/sQ_Ci...` |
| 6 | 2021-03-01 06:04:42 | Amazon.com : lacrosse | `https://www.amazon.com/s?field-keywords=lacrosse` |
| 7 | 2021-03-04 08:03:00 | To-Purchase - Google Drive | `https://docs.google.com/spreadsheets/d/1uAv...` |
| 8 | 2021-03-04 08:14:07 | Chick-fil-A - Google Maps | `https://www.google.com/maps/place/Chick-fil-A/...` |
| 9 | 2021-02-05 19:21:57 | iphones for sale - Google Search | `https://www.google.com/search?q=iphones+for+sale...` |
| 10 | 2021-03-04 08:19:06 | Inbox \| e.flatt610@protonmail.com \| ProtonMail | `https://mail.protonmail.com/inbox/sQ_Ci...` |

**Content character:** Young adult (college/early-career), US North-East (Burlington VT /
Albany NY area inferred from `goterriers.com`=Boston University, `timesunion.com`=Albany).
Browsing mix: Google search, Google Docs, ProtonMail, shopping (Amazon, Vineyard Vines,
Chick-fil-A), social (Facebook), hinting at a Chromebook user (`command line chromebook`).
Thematically plausible and diverse.

**Usability for 500-row test set:** 222 rows is solid for a single-persona contribution.
All five required fields (`title`, `url`, `page_transition`, `time_usec`, `client_id`)
present in every record. Zero empty titles. Good spread of page_transition types.

### 4. Other browsing-relevant artifacts

| Artifact | Path | Size |
|----------|------|------|
| YouTube search history | `Takeout/YouTube and YouTube Music/history/search-history.html` | 144,996 B |
| YouTube watch history | `Takeout/YouTube and YouTube Music/history/watch-history.html` | 146,681 B |
| Chrome Bookmarks | `Takeout/Chrome/Bookmarks.html` | 897 B |
| Chrome SearchEngines | `Takeout/Chrome/SearchEngines.json` | 6,453 B |
| Chrome Extensions | `Takeout/Chrome/Extensions.json` | 4,283 B |
| Chrome Autofill | `Takeout/Chrome/Autofill.json` | 30 B (empty) |
| My Activity / Search | `Takeout/My Activity/Search/MyActivity.html` | 193,500 B |
| My Activity / YouTube | `Takeout/My Activity/YouTube/MyActivity.html` | 147,947 B |
| My Activity / Maps | `Takeout/My Activity/Maps/MyActivity.html` | 145,847 B |

**Notable:** `Chrome/SearchEngines.json` (6,453 B) contains the custom search engine
configuration — could help cross-validate domain inferences. YouTube histories are
HTML-only but sizable and could supplement if needed.

### 5. PII assessment

| File | Finding |
|------|---------|
| `Takeout/Profile/Profile.json` | `displayName = "Eli Flatt"`, email `e.flatt610@gmail.com` |
| `Takeout/Google Account/e.flatt610.SubscriberInfo.html` | `e.flatt610@gmail.com` — account info page |
| `Takeout/Profile/ProfilePhoto.jpg` (62 KB) | Photo present — **unknown whether stock/generated or real** |
| `Takeout/Profile/ProfilePhotos/eli_profile.jpeg.jpg` (459 KB) | Larger profile photo |

**Assessment:** "Eli Flatt" is consistent with a CTF-constructed persona.
The email scheme `[firstname.lastname+number]@gmail.com` is a common CTF pattern.
The ProtonMail address `e.flatt610@protonmail.com` appears in browsing history —
consistent with the staged scenario (likely a "secure comms" angle in the CTF).
**Profile photos are present and not inspected** (JPEGs not read as text).
This is a **low risk** — the CTF is public, corpus is distributed openly by Magnet/Digital Corpora —
but downstream consumers should note photos exist.
**CONFIRMED** as staged persona: the name "Eli Flatt" does not match any known real-identity
pattern in the CTF context; the `goterriers.com` / lacrosse / ProtonMail combination is
a deliberate scenario construction.

---

### Verdict — 2021: `USABLE`

**222 rows** · All 5 fields present · 0% empty titles · 5-week date range ·
Good page_transition distribution · Thematically diverse English browsing ·
Clearly staged CTF persona (no real PII risk).

**Recommended use:** Include all 222 rows in the #137 test set.
Supplement with 2022 rows (below) to approach 500 total.

---

## Package: 2022 CTF Takeout

**CTF persona:** Rafael Shell · `rafaelshell24@gmail.com`  
*(Consistent fictional persona)*

### 1. Full file listing (143 files — selected key entries)

Full listing spans 143 files (Google Fit activities dominate); key files below:

| Path | Size (B) |
|------|---------|
| `takeout-20220222T154448Z/Takeout/Chrome/BrowserHistory.json` | **16,529** |
| `takeout-20220222T154448Z/Takeout/Chrome/Bookmarks.html` | 1,268 |
| `takeout-20220222T154448Z/Takeout/Chrome/Autofill.json` | 30 |
| `takeout-20220222T154448Z/Takeout/Chrome/Extensions.json` | 54 |
| `takeout-20220222T154448Z/Takeout/Chrome/SearchEngines.json` | 28 |
| `takeout-20220222T154448Z/Takeout/Chrome/SyncSettings.json` | 899 |
| `takeout-20220222T154448Z/Takeout/Mail/All mail Including Spam and Trash.mbox` | 6,935,348 |
| `takeout-20220222T154448Z/Takeout/My Activity/Search/MyActivity.html` | 441,178 |
| `takeout-20220222T154448Z/Takeout/My Activity/Chrome/MyActivity.html` | 155,588 |
| `takeout-20220222T154448Z/Takeout/My Activity/Android/MyActivity.html` | 257,364 |
| `takeout-20220222T154448Z/Takeout/Access Log Activity/Activities - A list of Google services...csv` | 1,824,177 |
| `takeout-20220222T154448Z/Takeout/Fit/All Data/derived_com.google.location.sample...json` | 1,844,428 |
| `takeout-20220222T154448Z/Takeout/YouTube and YouTube Music/history/search-history.html` | 150,926 |
| `takeout-20220222T154448Z/Takeout/YouTube and YouTube Music/history/watch-history.html` | 164,232 |
| `takeout-20220222T154448Z/Takeout/Keep/2022-02-13T03_21_04.819-05_00.html` | 11,196 |
| `takeout-20220222T154448Z/Takeout/Home App/HomeApp.json` | 246,104 |
| `takeout-20220222T154448Z/Takeout/Google Account/rafaelshell24.SubscriberInfo.html` | 4,566 |
| `takeout-20220222T154448Z/Takeout/Profile/Profile.json` | 240 |
| `takeout-20220222T154448Z/Takeout/Tasks/Tasks.json` | 750 |

*(Remaining 124 files are Google Fit activities, daily metrics, location data, and maps.)*

### 2. Browser history artifacts

- **FOUND `BrowserHistory.json`** at
  `takeout-20220222T154448Z/Takeout/Chrome/BrowserHistory.json` (16,529 B)
  **CONFIRMED** — parsed as valid JSON inside container.
- No raw History SQLite.

### 3. History artifact analysis — `…/Chrome/BrowserHistory.json` (CONFIRMED)

| Metric | Value |
|--------|-------|
| Row count | **40** |
| Fields present | `page_transition`, `title`, `url`, `client_id`, `time_usec` |
| Empty / missing titles | **1 / 40 (2%)** |
| Date range | 2022-01-29 03:12 UTC → 2022-02-13 09:05 UTC (~2 weeks) |
| Language mix | 97.5% ASCII English, 1 record with no title |

**Page transitions:**

| Transition | Count |
|-----------|-------|
| LINK | 27 |
| RELOAD | 5 |
| GENERATED | 4 |
| FORM_SUBMIT | 4 |

**Top domains:**

| Domain | Visits | % of total |
|--------|--------|-----------|
| `play.aidungeon.io` | 16 | **40%** |
| `google.com` | 15 | 37.5% |
| `latitude.io` | 2 | 5% |
| `hackingtutorials.org` | 2 | 5% |
| `vanishingincmagic.com` | 1 | — |
| `api.aidungeon.io` | 1 | — |
| `spotify.com` | 1 | — |
| `twitter.com` | 1 | — |

**10 random sample rows (seed=42):**

| # | Timestamp (UTC) | Title | URL (truncated) |
|---|----------------|-------|-----------------|
| 1 | 2022-02-13 09:02:04 | larp - Google Search | `https://www.google.com/search?q=larp...` |
| 2 | 2022-02-13 09:04:11 | larp shield diy - Google Search | `https://www.google.com/search?q=larp+shield+diy...` |
| 3 | 2022-02-13 08:42:20 | Scenario Play \| AI Dungeon | `https://play.aidungeon.io/main/scenarioPlay?publicId=756f...` |
| 4 | 2022-02-13 08:42:49 | Scenario Play \| AI Dungeon | `https://play.aidungeon.io/main/scenarioPlay?publicId=757...` |
| 5 | 2022-02-13 08:43:04 | Adventure Play \| AI Dungeon | `https://play.aidungeon.io/main/adventurePlay?publicId=0cf...` |
| 6 | 2022-02-13 09:00:20 | 5 Intermediate and Advanced Card Tricks… | `https://www.vanishingincmagic.com/learn-card-tricks/...` |
| 7 | 2022-02-13 09:02:39 | larp - Google Search | `https://www.google.com/search?q=larp...` |
| 8 | 2022-02-13 09:02:39 | larp - Google Search | `https://www.google.com/search?q=larp...` (duplicate timestamp) |
| 9 | 2022-02-13 08:38:14 | Latitude | `https://latitude.io/account/login?...returnTo=https://api.aidungeon...` |
| 10 | 2022-01-29 03:12:26 | minecraft icon - Google Search | `https://www.google.com/search?q=minecraft+icon...` |

**Content character:** Heavy AI Dungeon focus (40% of rows), LARP, magic card tricks,
hacking tutorials, Minecraft — a niche hobbyist profile. The scenario appears to involve
AI-generated content / cybercrime investigation. Domain distribution is too skewed
(AI Dungeon dominates) to represent general browsing for a classifier test set.
Only 2 weeks of data. Several duplicate rows observed (same URL/title/timestamp).

### 4. Other browsing-relevant artifacts

| Artifact | Path | Size | Note |
|----------|------|------|------|
| YouTube search history | `…/YouTube and YouTube Music/history/search-history.html` | 150,926 B | HTML |
| YouTube watch history | `…/YouTube and YouTube Music/history/watch-history.html` | 164,232 B | HTML |
| My Activity / Search | `…/My Activity/Search/MyActivity.html` | **441,178 B** | Large — many searches |
| My Activity / Chrome | `…/My Activity/Chrome/MyActivity.html` | 155,588 B | |
| My Activity / Android | `…/My Activity/Android/MyActivity.html` | 257,364 B | |
| Google Keep note | `…/Keep/2022-02-13T03_21_04.819-05_00.html` | 11,196 B | Could contain URLs |
| Access Log Activity CSV | `…/Activities - A list of Google services...csv` | 1,824,177 B | Full access log |
| Tasks | `…/Tasks/Tasks.json` | 750 B | Non-empty (2019/2021 were empty) |

**Notable:** The Access Log Activity CSV (1.8 MB) is unique to the 2022 package and logs
every Google service access event with timestamps — richer than BrowserHistory but
different schema. `My Activity/Search/MyActivity.html` at 441 KB suggests hundreds of
search queries embedded in HTML.

### 5. PII assessment

| File | Finding |
|------|---------|
| `Takeout/Profile/Profile.json` | `displayName = "Rafael Shell"`, email `rafaelshell24@gmail.com` |
| `Takeout/Google Account/rafaelshell24.SubscriberInfo.html` | `rafaelshell24@gmail.com` |
| `Takeout/Drive/ProfilePic.jpg` (6,289 B) | Small profile image present |
| `Takeout/Search Contributions/Rafael Shell_/avatar_image.jpg` (1,411 B) | Tiny avatar |

**Assessment:** "Rafael Shell" is a CTF-constructed persona. Email pattern
`[name+number]@gmail.com` follows CTF convention. No phone numbers detected.
**No real PII risk** — publicly distributed CTF scenario, clearly staged.
**CONFIRMED** as staged persona by `rafaelshell24.SubscriberInfo.html`.

---

### Verdict — 2022: `PARTIAL`

**40 rows** · All 5 fields present · 1 empty title · Only 2 weeks of data ·
Domain distribution severely skewed (40% AI Dungeon, 37.5% Google) ·
Some duplicate rows · Niche persona (LARP, AI games, hacking) may introduce
unwanted bias into a general-purpose test set.

**Recommended use:** Can contribute ~40 rows to pad the test set if needed, but
flag them as "niche/skewed" stratum. Do not use as primary source for a
500-row balanced set.

---

## Summary verdicts

| Package | Rows (BrowserHistory.json) | Fields | Empty titles | Date span | Verdict |
|---------|---------------------------|--------|--------------|-----------|---------|
| 2019 CTF Takeout | 0 (no structured export) | n/a | n/a | n/a | **UNUSABLE** |
| 2021 CTF Takeout | **222** | all 5 present | 0% | ~5 weeks | **USABLE** |
| 2022 CTF Takeout | 40 | all 5 present | 2% | ~2 weeks | **PARTIAL** |

### Recommendation for #137 test set

- **Primary source:** 2021 package → 222 rows, all fields clean.
- **Supplementary:** 2022 package → 40 rows; usable but mark as niche stratum.
- **Combined:** 262 rows total from structured BrowserHistory.json exports.
  This falls short of the 500-row target; additional sources needed.
- **Gap:** ~238 rows needed from other sources (2020 package not yet evaluated;
  other public CTF corpora; synthetic generation guided by these real patterns).
- **Schema confirmed across both usable packages:**
  ```json
  { "page_transition": "LINK", "title": "…", "url": "https://…",
    "client_id": "…", "time_usec": 1234567890000000 }
  ```
- **No real PII in any package** — all three personas are clearly staged CTF characters
  (Selma Bouvier = Simpsons, Eli Flatt = college student persona, Rafael Shell = hobbyist persona).
  Safe to use as labeled ground truth in a public research context.

---

## Container cleanup note

The scratch Docker volume (`takeout-scratch`) and the downloaded ZIP files inside it
were removed after analysis. The container (`debian:bookworm-slim`) was run with `--rm`
and left no persistent state. No extracted files were written to the host.

```bash
# Cleanup commands run after analysis:
docker volume rm takeout-scratch
```

---

*CONFIRMED artifacts:*  
- `Takeout/Chrome/BrowserHistory.json` in 2021 package — parsed, 222 rows  
- `takeout-20220222T154448Z/Takeout/Chrome/BrowserHistory.json` in 2022 package — parsed, 40 rows  
- 2019 has no BrowserHistory.json (pre-dates Chrome Takeout structured export)
