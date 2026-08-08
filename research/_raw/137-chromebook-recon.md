# 137 Chromebook Recon — Magnet Forensics 2021 CTF Image

**Purpose:** Locate and characterise Eli Flatt's raw on-device Chrome `History` SQLite
from the Magnet 2021 Chromebook CTF image, as a candidate ground-truth source for the
`ChmaraX/forensix#137` browsing-history classifier test set. Cross-reference with the
2021 Takeout package (rated USABLE in `137-takeout-recon.md`).

**Generated:** 2026-08-08  
**Branch:** `research/wayfinder-v2` (not committed — raw research file)  
**Source:** Digital Corpora S3 — `corpora/scenarios/magnet/2021 CTF - Chromebook.tgz`

---

## Method

All download, extraction, and analysis was performed inside an isolated Docker container.
Archive contents were never executed. The host received only this markdown report.
The extracted `History` file lives only inside the Docker volume (cleaned up after analysis).

```
Container image:  debian:bookworm-slim
Image digest:     sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241
OS inside:        Debian GNU/Linux 12 (bookworm) — aarch64
Tools:            curl, tar, python3 3.11.2, sqlite3 3.40.1
Scratch volume:   chromebook-scratch (Docker managed, deleted after analysis)
```

**Extraction strategy:** Targeted `tar -xzf ... <specific-paths>` to pull only the nine
Chrome profile files of interest without extracting the full 18,478-entry tree.
No loop-mounting, no sleuthkit required — the CTF organisers pre-decrypted the profile
and included it in the tarball under `./decrypted/mount/user/`.

---

## Archive checksum

| Field | Value |
|-------|-------|
| Source URL | `https://digitalcorpora.s3.amazonaws.com/corpora/scenarios/magnet/2021%20CTF%20-%20Chromebook.tgz` |
| Declared size | 408,901,035 B |
| Actual size | 408,901,035 B ✓ |
| SHA-256 | `67211e1aebd876a677a1298e5b08746790b22c83a3ed6605308276aab94b3c2c` |
| Total tar entries | 18,478 |

---

## Tar listing — structure determination

The archive is **a pre-decrypted directory tree**, not a raw disk image.
No loop-mount or sleuthkit required. Top of listing (first 30 entries):

```
./
./shutdown_stateful_umount_failure
./.tpm_owned
./recovery_logs.1613990327/recovery.log
./recovery_logs.1613990327/progress.log
./recovery_logs.1613990327/dmesg
./recovery_logs.1613990327/spinner.log
./home/user/7c37097f86694f0645e38af5cf316592cce86789/
./home/root/7c37097f86694f0645e38af5cf316592cce86789/
./home/.shadow/...  (eCryptfs vault — encrypted, not readable)
./home/chronos/
./decrypted/                          ← pre-decrypted by CTF organiser
./decrypted/block-usage.txt
./decrypted/mount/
./decrypted/mount/user/               ← Chrome profile root
./decrypted/mount/user/Top Sites-journal
./decrypted/mount/user/Downloads/Wickr-Customer-Security-Promises-November-2020.pdf
./decrypted/mount/user/Downloads/network_diagnostics_2021-03-08.19-04-05.txt
./decrypted/mount/user/Downloads/Screenshot 2021-03-04 at 3.17.06 AM.png
...
```

**Encryption note:** The raw eCryptfs vault (`./home/.shadow/…`) is present and
unreadable without the key. The CTF organiser separately decrypted the profile
and placed it under `./decrypted/mount/user/`. No decryption work was needed.

**User hash:** `7c37097f86694f0645e38af5cf316592cce86789`
(ChromeOS hashed user identifier — consistent with `e.flatt610@gmail.com`).

---

## 1. History file — path, size, schema, Chrome version

**Exact tar path:** `./decrypted/mount/user/History`  **CONFIRMED**

| Field | Value |
|-------|-------|
| Path in archive | `./decrypted/mount/user/History` |
| Extracted size | **196,608 B** (192 KiB) |
| SHA-256 of extracted file | `c6206acda27becb0c249d6fd3edd8945110c233bee5a8908693f9acb1342e0be` |
| SQLite magic | `SQLite format 3\x00` ✓ |
| `PRAGMA schema_version` | 22 |
| `PRAGMA user_version` | 0 |
| Chrome History DB version (`meta.version`) | **41** |
| Chrome History last compatible version | 16 |
| Chrome browser version (from `Preferences`) | **76.0.3809.136** |

**Tables present:** `downloads`, `downloads_slices`, `downloads_url_chains`,
`keyword_search_terms`, `meta`, `segment_usage`, `segments`, `sqlite_sequence`,
`typed_url_sync_metadata`, `urls`, `visit_source`, `visits`

**Chrome version note:** Preferences reports `last_chrome_version = 76.0.3809.136`
(Chrome 76, released 2019-08-06). This is consistent with other 2021 Magnet CTF
Chromebook reports and likely reflects the ChromeOS milestone embedded in the
Chromebook image rather than the latest Chrome update version.

---

## 2. `urls` table

| Metric | Value |
|--------|-------|
| Row count | **130** |
| Empty / missing titles | **1 / 130 (0%)** |
| `http(s)://` URLs | 127 |
| `chrome://` URLs | 0 |
| `chrome-extension://` URLs | 2 |
| Distinct domains (from http/https URLs) | **29** |

**Top 20 domains:**

| Domain | url rows |
|--------|---------|
| `google.com` | 43 |
| `docs.google.com` | 22 |
| `chrome.google.com` | 16 |
| `mail.protonmail.com` | 6 |
| `mail.google.com` | 5 |
| `amazon.com` | 4 |
| `facebook.com` | 4 |
| `protonmail.com` | 2 |
| `damndelicious.net` | 2 |
| `wickr.com` | 2 |
| `healthvermont.gov` | 2 |
| `vineyardvines.com` | 2 |
| `gmail.com` | 1 |
| `accounts.google.com` | 1 |
| `ad.doubleclick.net` | 1 |
| `clickserve.dartsearch.net` | 1 |
| `darkreader.org` | 1 |
| `fullfact.org` | 1 |
| `gimmedelicious.com` | 1 |
| `millionmilesecrets.com` | 1 |

**Date range (`last_visit_time`):**
`2021-02-04 00:17:45 UTC` → `2021-04-05 02:52:31 UTC` (≈ 59 days)

---

## 3. `visits` table

| Metric | Value |
|--------|-------|
| Row count | **447** |
| Visit time range | 2021-02-03 06:00:38 UTC → 2021-04-05 02:52:31 UTC |

**Transition-type distribution** (core type = `transition & 0xFF`):

| Transition | Count | % |
|-----------|-------|---|
| `LINK` (0) | 386 | 86.4% |
| `TYPED` (1) | 20 | 4.5% |
| `GENERATED` (5) | 20 | 4.5% |
| `RELOAD` (8) | 10 | 2.2% |
| `FORM_SUBMIT` (7) | 9 | 2.0% |
| `AUTO_BOOKMARK` (2) | 2 | 0.4% |

**visit_source breakdown:**
- 14 rows in `visit_source` with `source=0` (SOURCE_SYNCED — visits from another device
  synced to this Chromebook).
- 433 visits have no `visit_source` entry → SOURCE_BROWSED (locally navigated on this device).

---

## 4. Date range

- **Earliest visit:** `2021-02-03 06:00:38 UTC` (aligns exactly with Takeout BrowserHistory.json start)
- **Latest visit:** `2021-04-05 02:52:31 UTC`
- **Span:** ~60 days; extends ~4 weeks past the Takeout export cutoff (2021-03-09)

---

## 5. Mess / noise profile

| Category | Count | Notes |
|----------|-------|-------|
| `chrome://` URLs | **0** | Zero internal-page entries |
| `chrome-extension://` URLs | **2** | Minimal extension noise |
| `New Tab` / `Untitled` / empty titles | **1** | Single empty-title row |
| Bare-domain URLs (path = `/`) | 24 | Navigations to domain roots; usable |
| URLs with query string > 100 chars | 36 | Search result / OAuth redirect URLs |
| Non-ASCII titles | **1** | Single title with extended chars |
| Non-English titles | 0 (confirmed) | 100% English-language titles |

**Assessment:** Extremely clean. Zero `chrome://` noise, near-zero extension URLs,
only 1 missing title in 130 rows. The 36 long-query-string URLs are mostly Google
Search SERPs and OAuth flows — normal real-user browsing, not noise.

---

## 6. Fifteen random sample rows (seed=42, filtered: no chrome:// / chrome-extension://, non-empty title)

| # | Last visit (UTC) | Visits | Title | URL (truncated to 120 chars) |
|---|-----------------|--------|-------|------------------------------|
| 1 | 2021-02-24 23:42:55 | 1 | Untitled document - Google Docs | `https://docs.google.com/document/d/1-NgLoP0NLVqyR8GE5KMQeOIQyDrlufaWRPaTVUbPshA/edit#heading=h.bol649azk2xu` |
| 2 | 2021-02-04 00:17:45 | 1 | Inbox - e.flatt610@gmail.com - Gmail | `https://mail.google.com/mail/u/0/?pli=1#` |
| 3 | 2021-03-01 06:03:16 | 1 | Google Sheets: Free Online Spreadsheets for Personal Use | `https://www.google.com/sheets/about/` |
| 4 | 2021-03-04 08:17:21 | 2 | Secure email: ProtonMail is free encrypted email. | `https://protonmail.com/` |
| 5 | 2021-03-01 05:58:35 | 1 | Chrome Web Store - Extensions | `https://chrome.google.com/webstore` |
| 6 | 2021-02-24 23:49:58 | 2 | lacrosse news - Google Search | `https://www.google.com/search?rlz=1CADMEA_enUS942&sxsrf=ALeKk028HqFIGOjYL1Nd6XVnsvB47C2nLw%3A1614210570067&ei=…` |
| 7 | 2021-02-24 23:40:26 | 2 | Untitled document - Google Docs | `https://docs.google.com/document/d/1-NgLoP0NLVqyR8GE5KMQeOIQyDrlufaWRPaTVUbPshA/edit#heading=h.owhe1cvedjw1` |
| 8 | 2021-02-24 23:39:07 | 14 | Untitled document - Google Docs | `https://docs.google.com/document/d/1-NgLoP0NLVqyR8GE5KMQeOIQyDrlufaWRPaTVUbPshA/edit#heading=h.4bepug260ast` |
| 9 | 2021-03-04 08:27:05 | 1 | Dialed In: Your Lacrosse Fix for Wednesday, March 3 \| US Lacrosse Magazine | `https://www.uslaxmagazine.com/fuel/daily-digest/dialed-in-your-lacrosse-fix-for-wednesday-march-3` |
| 10 | 2021-02-24 23:34:11 | 2 | Chromebooks Come with Perks - Google Chromebooks | `https://www.google.com/chromebook/perks/` |
| 11 | 2021-02-04 00:17:45 | 1 | Inbox - e.flatt610@gmail.com - Gmail | `https://mail.google.com/accounts/SetOSID?authuser=0&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%3Fpli%3D1&…` |
| 12 | 2021-02-24 23:39:45 | 3 | Untitled document - Google Docs | `https://docs.google.com/document/d/1-NgLoP0NLVqyR8GE5KMQeOIQyDrlufaWRPaTVUbPshA/edit#heading=h.zeye4lgtfqwp` |
| 13 | 2021-02-28 06:39:09 | 1 | chrome.google.com | `https://chrome.google.com/webstore/search/hide%20it%20?hl=en` |
| 14 | 2021-03-01 05:58:47 | 1 | Chrome Web Store - proton mail | `https://chrome.google.com/webstore/search/signal` |
| 15 | 2021-02-28 06:37:30 | 6 | Facebook | `https://www.facebook.com/` |

---

## 7. Takeout export window overlap

**Window:** 2021-02-03 00:00:00 UTC → 2021-03-10 00:00:00 UTC (exclusive)  
(matching the 2021 Takeout `BrowserHistory.json` date range)

| Metric | Value |
|--------|-------|
| `urls` rows with `last_visit_time` in window | **128 / 130 (98.5%)** |
| Rows outside window | 2 (both in April 2021 — post-export browsing) |

**Interpretation:** 98.5% overlap confirms this is the same session as the already-USABLE
2021 Takeout. The History SQLite adds ~4 weeks of additional data beyond the Takeout cutoff
and provides the raw `visits` table (447 events vs. 222 in the JSON export) with microsecond
timestamps, visit_duration, and join-able `from_visit` chains.

---

## 8. Sidecar files

| File | Present | Size | Notes |
|------|---------|------|-------|
| `History-journal` | ✓ | **0 B** | Empty — all pages fully committed to WAL/main file; clean checkpoint |
| `History-wal` | ✗ | — | No WAL file; DB is in rollback-journal mode, fully committed |
| `Bookmarks` | ✓ | 1,100 B | Present but not analysed per scope |
| `Login Data` | ✓ | 22,528 B | Present; saved password metadata |
| `Login Data-journal` | ✓ | 0 B | Empty journal |
| `Cookies` | ✓ | 327,680 B | Present; 320 KiB session cookies |
| `Favicons` | ✓ | 147,456 B | Present |
| `Preferences` | ✓ | 180,834 B | Present; source of Chrome version |
| `Visited Links` | ✓ (in tar) | — | In archive but not extracted |
| `Web Data` | ✓ (in tar) | — | In archive but not extracted |
| `Top Sites` / `-journal` | ✓ / ✓ (in tar) | — | In archive; Top Sites-journal in archive root |

**Key finding:** Zero-byte journal and no WAL means the SQLite is fully committed with no
pending transactions. The database is in a clean, consistent state. No recovery needed.

---

## Additional artifacts of note

### `keyword_search_terms` table (28 rows) — **CONFIRMED**

Search terms typed into Chrome's omnibox, joined to `urls`. Themes consistent with
the Eli Flatt persona: lacrosse, Chick-fil-A recipes, Vineyard Vines stock, COVID
travel restrictions (Vermont), Wickr security, Linux on Chromebook.

```
chick fil a receipes                    lacrosse news
chick fil a receipes nuggets            how secure is wickr
vineyard vines stock                    vermont covid restrictions
vineyard vines stock price              what is considered non essential travel
chick fil a stick price                 is travelling to get chicken esstential travel
lacrosse news (×3)                      is travelling to get food esstential travel
chrome webstore                         how to screenshot in chromebook
google sheets                           perks of linux
lacrosse                                linux penguin (×3)
vineyard vines                          can linux be run on chromebook
maps
```

Note: intentional misspellings (`receipes`, `esstential`) — realistic real-user typing.

### Downloads (2 items) — **CONFIRMED**

```
/home/chronos/u-7c37097f86694f0645e38af5cf316592cce86789/MyFiles/Downloads/
  Wickr-Customer-Security-Promises-November-2020.pdf  (1,782,658 B)
  tux.png                                              (46,791 B)
```

Both files are present in `./decrypted/mount/user/Downloads/` in the archive.
The Wickr PDF is highly scenario-relevant (encrypted messaging investigation angle).

### `.crosh_history` (626 B) — **CONFIRMED**

Contains the ChromeOS shell command history: `dmesg`, `top`, `ping`, `tpm_status`,
`rollback`, `connectivity`, `modem`, etc. These are CTF challenge commands, not browser URLs.
No URLs extracted.

### `visit_source` table

14 visits flagged `SOURCE_SYNCED` (source=0) — synced from another device (likely
the same Gmail account used on another machine). Remaining 433 visits are
SOURCE_BROWSED (locally navigated on this Chromebook). This is a useful label
for provenance tracking in the test set.

---

## Deterministic re-extraction commands

Anyone with the S3 URL can reproduce this exactly:

```bash
# 1. Create scratch volume
docker volume create chromebook-scratch

# 2. Download (408 MB — allow ~10 min on fast connection)
docker run --rm \
  -v chromebook-scratch:/work \
  debian:bookworm-slim \
  bash -c '
    apt-get update -qq && apt-get install -y -qq curl
    curl -sSL --max-time 1800 \
      -o /work/chromebook.tgz \
      "https://digitalcorpora.s3.amazonaws.com/corpora/scenarios/magnet/2021%20CTF%20-%20Chromebook.tgz"
    sha256sum /work/chromebook.tgz
    # Expected: 67211e1aebd876a677a1298e5b08746790b22c83a3ed6605308276aab94b3c2c
  '

# 3. Targeted extraction (History + key sidecar files only — no full unpack)
docker run --rm \
  -v chromebook-scratch:/work \
  debian:bookworm-slim \
  bash -c '
    apt-get update -qq && apt-get install -y -qq tar
    mkdir -p /work/chrome_profile
    tar -xzf /work/chromebook.tgz -C /work/chrome_profile \
      "./decrypted/mount/user/History" \
      "./decrypted/mount/user/History-journal" \
      "./decrypted/mount/user/Preferences" \
      "./decrypted/mount/user/Bookmarks" \
      "./decrypted/mount/user/Login Data" \
      "./decrypted/mount/user/Login Data-journal" \
      "./decrypted/mount/user/Cookies" \
      "./decrypted/mount/user/Favicons" \
      "./decrypted/mount/user/.crosh_history"
    sha256sum /work/chrome_profile/decrypted/mount/user/History
    # Expected: c6206acda27becb0c249d6fd3edd8945110c233bee5a8908693f9acb1342e0be
  '

# 4. Open the History DB (read-only, no execution)
docker run --rm \
  -v chromebook-scratch:/work \
  debian:bookworm-slim \
  bash -c '
    apt-get update -qq && apt-get install -y -qq sqlite3
    sqlite3 /work/chrome_profile/decrypted/mount/user/History \
      "SELECT title, url, last_visit_time FROM urls ORDER BY last_visit_time LIMIT 10;"
  '

# 5. Cleanup
docker volume rm chromebook-scratch
```

---

## Summary comparison: SQLite History vs. Takeout BrowserHistory.json

| Dimension | Takeout `BrowserHistory.json` | On-device `History` SQLite |
|-----------|------------------------------|---------------------------|
| Source | Google server-side export | Raw Chrome profile |
| Format | JSON array | SQLite (urls + visits tables) |
| URL rows / entries | 222 | 130 (deduplicated by URL) |
| Visit events | 222 (one per JSON entry) | **447** (raw individual visits) |
| Timestamp precision | 1-second (time_usec field) | **Microsecond** |
| Date range | 2021-02-03 → 2021-03-09 | 2021-02-03 → **2021-04-05** |
| Empty titles | 0 / 222 (0%) | 1 / 130 (0.8%) |
| chrome:// entries | included (some) | 0 |
| Page transition | string (e.g. `"LINK"`) | integer bitmask (mask & 0xFF) |
| Visit count per URL | not directly available | `visit_count` column in urls |
| Distinct domains | ~30 (estimated) | 29 |
| Keyword search terms | not included | 28 rows in `keyword_search_terms` |
| From-visit chains | not available | `from_visit` FK in visits |
| Visit duration | not available | `visit_duration` in visits |
| Source provenance | sync/export | local + 14 synced visits flagged |

**Key advantage of the SQLite:** The `visits` table gives 447 individual navigation events
with microsecond timestamps and from-visit chains. For the #137 classifier, joining
`visits ⟶ urls` gives more rows than the Takeout JSON and includes the `visit_duration`
field (useful as a quality signal).

---

## PII assessment

Same staged persona as the 2021 Takeout: **Eli Flatt** / `e.flatt610@gmail.com`.
Evidence visible in the History: Gmail inbox URL `mail.google.com/mail/u/0/…`,
ProtonMail inbox with `e.flatt610@protonmail.com`, Google Docs with the same
document IDs seen in the Takeout, downloads of Wickr PDF (scenario prop).
**No real personal data.** CONFIRMED as a CTF-constructed persona.

---

## Verdict — 2021 Chromebook History SQLite: `USABLE`

**447 visit rows** joining to **130 distinct URLs** · microsecond timestamps ·
0 chrome:// entries · 1 empty title (0.8%) · 100% English · 29 domains ·
clean journal state (no WAL, 0-byte journal) · 98.5% overlap with USABLE Takeout ·
additional 28 keyword search terms · 4 extra weeks of data beyond Takeout window.

**Recommended use for #137:**
- Join `visits ⟶ urls` on `visits.url = urls.id` to produce 447 visit-level rows
  with title + url + transition + visit_time + visit_duration.
- Supplement with the 222 Takeout rows (after deduplication by URL+timestamp)
  for a combined ~500-600 row set covering the same persona from two sources.
- The SQLite source is superior to the Takeout JSON for the classifier because
  it preserves raw visit events, visit duration, and from_visit chain structure —
  all relevant signals for a browsing-behaviour classifier.

---

*CONFIRMED artifacts:*
- `./decrypted/mount/user/History` — SQLite, 196,608 B, 130 urls / 447 visits
- `./decrypted/mount/user/History-journal` — 0 B (clean)
- `./decrypted/mount/user/Preferences` — Chrome version 76.0.3809.136
- `./decrypted/mount/user/.crosh_history` — ChromeOS shell history, 626 B
- No disk image; no loop-mount needed; no eCryptfs decryption needed
  (CTF organiser pre-decrypted under `./decrypted/`)
