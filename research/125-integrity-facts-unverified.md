# Research: Chrome timestamp/timezone semantics + digital-forensics standard revisions (ForensiX v2)

> **UNVERIFIED — produced without web access. Model knowledge, not live sources.**
>
> This document was produced in a run where no `web_search` / `WebFetch` / `agent_browser` tool
> was available. **No URL below was actually fetched.** URLs are given as canonical, stable,
> fetchable paths so the parent session can verify them. Treat every statement here as a
> **hypothesis with a stated confidence level, not a fact**. Nothing in this file may be cited
> in tool output, reports, or user-facing documentation until the VERIFICATION QUEUE at the
> end has been run.

Confidence key:
- **HIGH** — I recall the specific schema/source line or the fact is structurally load-bearing and stable across many Chrome versions.
- **MEDIUM** — I recall the behaviour but not the exact source location, or the fact has changed across Chrome versions and I may be off on the version boundary.
- **LOW** — inference, likely but unconfirmed.
- **UNKNOWN — VERIFY** — I decline to guess. Do not fill this in from memory.

Inference discipline (per supervisor instruction): every row in the epoch table is tagged
either `[recall-schema]` (I recall the actual column/serialization) or `[inferred-from-name]`
(I am reasoning from the column name and surrounding convention). Do not treat
`[inferred-from-name]` rows as evidence.

---

## Summary

**Q1:** Desktop Chrome/Chromium does not appear to persist the host machine's timezone or UTC
offset in any USER_DATA_DIR artifact (MEDIUM-HIGH; negative claim, must be verified).
ChromeOS is the exception — `Local State` carries an explicit timezone setting (MEDIUM).
Chrome timestamps are stored in **three** distinct epochs — microseconds since 1601-01-01 UTC
(`base::Time` internal, the dominant one), Unix seconds (`time_t`, used mainly by the Web Data
autofill tables), and a small number of string-encoded 1601-microsecond values in JSON — and to
my knowledge **all of them are UTC / epoch-based, i.e. timezone-independent**; I am not aware of
any Chrome artifact storing wall-clock local time (HIGH for the major DBs).

**Q2:** ISO/IEC 27037 is a 2012 publication; 27041/27042/27043 are 2015 publications; all
Published. NIST SP 800-86 is August 2006 and still Final. NIST SP 800-131A Rev.2 (March 2019)
disallows SHA-1 for *digital signature generation* but does not govern non-signature integrity
hashing; NIST separately announced SHA-1 retirement by end-2030. **To my knowledge none of these
standards mandate a specific hash algorithm, nor per-file versus per-volume hashing** (MEDIUM-HIGH,
negative claim). SWGDE document version numbers are deliberately left **UNKNOWN — VERIFY**.

---

# QUESTION 1 — Timezone and timestamp semantics

## 1(b) Epoch table — HIGHEST-VALUE SECTION (per supervisor priority)

The three epochs in play:

| Epoch name | Definition | Chromium API that produces it |
|---|---|---|
| **WebKit / Windows epoch** (called "1601 µs" below) | microseconds since 1601-01-01T00:00:00 **UTC** | `base::Time::ToDeltaSinceWindowsEpoch().InMicroseconds()`; historically `base::Time::ToInternalValue()` |
| **Unix seconds** (`time_t`) | seconds since 1970-01-01T00:00:00 **UTC** | `base::Time::ToTimeT()` |
| **Unix microseconds** | microseconds since 1970-01-01 UTC | rare in Chrome profile artifacts; appears in some newer/Blink-adjacent storage and in `Simple Cache` index in some versions |

> Structural note (HIGH): `base::Time::ToInternalValue()` and
> `ToDeltaSinceWindowsEpoch().InMicroseconds()` return the **same number** on all platforms —
> Chromium's internal `base::Time` representation is microseconds from the Windows epoch on
> Windows, macOS and Linux alike. This is why "1601 µs" dominates the profile and why none of
> these values are timezone-dependent.

### History (`History` SQLite)

| Table.column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `urls.last_visit_time` | 1601 µs | UTC | HIGH | `[recall-schema]` |
| `visits.visit_time` | 1601 µs | UTC | HIGH | `[recall-schema]` |
| `visits.visit_duration` | µs **duration**, not a timestamp | n/a | HIGH | `[recall-schema]` |
| `downloads.start_time` | 1601 µs in modern Chrome | UTC | MEDIUM-HIGH | `[recall-schema]` |
| `downloads.end_time` | 1601 µs in modern Chrome | UTC | MEDIUM-HIGH | `[recall-schema]` |
| `downloads.last_access_time` | 1601 µs | UTC | MEDIUM | `[inferred-from-name]` + convention |
| `downloads_slices.received_bytes` | not a timestamp | n/a | — | — |

**Version hazard (MEDIUM, important for a forensics tool):** in older Chrome the `downloads`
table stored `start_time`/`end_time` as **Unix seconds (`time_t`)**, and migrated to 1601 µs.
I recall this migration landing in the History schema around **version 24–26, Chrome ~M26, 2013**
— the exact schema version number is **UNKNOWN — VERIFY**. A tool that assumes 1601 µs
unconditionally will mis-decode downloads from pre-2013 profiles by ~369 years. Practical
detection heuristic: a `start_time` value below ~1e12 is almost certainly Unix seconds.

Source files to verify:
- `components/history/core/browser/visit_database.cc`
- `components/history/core/browser/url_database.cc`
- `components/history/core/browser/download_database.cc` (contains the migration logic)
- `components/history/core/browser/history_database.cc` (`kCurrentVersionNumber`, migration ladder)

### Cookies (`Cookies` SQLite / `Network/Cookies`)

| Column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `creation_utc` | 1601 µs | UTC | HIGH | `[recall-schema]` |
| `expires_utc` | 1601 µs | UTC | HIGH | `[recall-schema]` |
| `last_access_utc` | 1601 µs | UTC | HIGH | `[recall-schema]` |
| `last_update_utc` | 1601 µs | UTC | MEDIUM-HIGH | `[recall-schema]`; column added in a relatively recent Chrome (~M101-ish, 2022) — **exact version UNKNOWN — VERIFY**. Absent in older profiles. |

Note: `expires_utc == 0` conventionally means a session cookie. (MEDIUM-HIGH,
`[recall-schema]`.) Since ~M80 the Cookies DB lives at `<Profile>/Network/Cookies` rather than
`<Profile>/Cookies` (MEDIUM).

Source file to verify: `net/extras/sqlite/sqlite_persistent_cookie_store.cc`.

### Login Data (`Login Data`, `Login Data For Account`)

| Column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `date_created` | 1601 µs in modern Chrome | UTC | MEDIUM-HIGH | `[recall-schema]` |
| `date_last_used` | 1601 µs | UTC | MEDIUM | `[recall-schema]` |
| `date_password_modified` | 1601 µs | UTC | MEDIUM | `[inferred-from-name]` + sits alongside the other two |
| `date_synced` | 1601 µs | UTC | MEDIUM | `[recall-schema]` |

**Version hazard (MEDIUM):** older Chrome stored `date_created` as **Unix seconds (`time_t`)**
and a LoginDatabase migration converted it to 1601 µs. The migration's database version number
is **UNKNOWN — VERIFY**. Same magnitude heuristic applies. This is a real, documented gotcha in
the password-manager code.

Source file to verify: `components/password_manager/core/browser/login_database.cc`
(look for the `MigrateDatabase` ladder and `kCurrentVersionNumber`).

### Web Data (`Web Data`) — **the main epoch exception**

| Table.column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `autofill.date_created` | **Unix seconds (`time_t`)** | UTC | HIGH | `[recall-schema]` — this is the well-known outlier; autofill uses `Time::ToTimeT()` |
| `autofill.date_last_used` | **Unix seconds** | UTC | HIGH | `[recall-schema]` |
| `credit_cards.date_modified` | **Unix seconds** | UTC | MEDIUM-HIGH | `[recall-schema]` |
| `credit_cards.use_date` | Unix seconds in older Chrome; may have migrated to 1601 µs in newer | UTC | LOW — **VERIFY** | `[inferred-from-name]`; I recall an autofill metadata timestamp change but not its direction/version |
| `autofill_profiles.date_modified` | **Unix seconds** | UTC | MEDIUM | `[recall-schema]` |
| `autofill_profiles.use_date` | Unix seconds | UTC | LOW — **VERIFY** | `[inferred-from-name]` |
| `masked_credit_cards` / server-card `use_date` | Unix seconds | UTC | LOW | `[inferred-from-name]` |

**Schema hazard (MEDIUM):** in recent Chromium the address tables were reorganised —
`autofill_profiles` was superseded by `local_addresses` / `contact_info` / `local_addresses_type_tokens`
style tables (I associate this with roughly M117–M124, **exact version UNKNOWN — VERIFY**).
A v2 tool must handle both layouts.

Source files to verify:
- `components/autofill/core/browser/webdata/autofill_table.cc` (older tree) or
  `components/autofill/core/browser/webdata/autofill/autofill_table.cc` /
  `.../addresses/address_autofill_table.cc` and `.../payments/payments_autofill_table.cc` (newer tree)

### Bookmarks (`Bookmarks` JSON)

| Field | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `date_added` | **1601 µs, encoded as a decimal STRING** | UTC | HIGH | `[recall-schema]` — `base::NumberToString(time.ToInternalValue())` |
| `date_modified` (folders) | 1601 µs string | UTC | HIGH | `[recall-schema]` |
| `date_last_used` | 1601 µs string | UTC | MEDIUM | `[recall-schema]`; newer field, absent in older profiles |

Note the string encoding: JSON cannot hold a 64-bit int losslessly as a JS number, so Chromium
writes these as quoted strings. A parser that does `JSON.parse` and reads a number will silently
lose precision. (HIGH.)

Source file to verify: `components/bookmarks/browser/bookmark_codec.cc`.

Also relevant: `Bookmarks.bak` (previous version) and the `checksum` field in `Bookmarks`, which
is an MD5 over the node contents — useful as a tamper indicator (MEDIUM).

### Favicons (`Favicons` SQLite)

| Column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `favicon_bitmaps.last_updated` | 1601 µs | UTC | MEDIUM-HIGH | `[recall-schema]` |
| `favicon_bitmaps.last_requested` | 1601 µs | UTC | MEDIUM | `[recall-schema]`; `0` has a special meaning (bitmap is "on-demand"/expired tracking) — semantics **VERIFY** |

Source file to verify: `components/history/core/browser/thumbnail_database.cc`.

### Shortcuts (`Shortcuts` SQLite — omnibox shortcuts)

| Column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `last_access_time` | 1601 µs | UTC | MEDIUM | `[recall-schema]`, but I have a weak memory of an older string encoding — **VERIFY** |

Source file to verify: `components/omnibox/browser/shortcuts_database.cc`.

### Top Sites (`Top Sites` SQLite)

- Modern schema (`top_sites` table: `url`, `url_rank`, `title`, `redirects`) has **no timestamp
  column at all** (MEDIUM-HIGH, `[recall-schema]`). Do not build a timeline feature on Top Sites.
- Older schema had a `thumbnails` table with `last_updated` = 1601 µs (MEDIUM).

Source file to verify: `components/history/core/browser/top_sites_database.cc`.

### Network Action Predictor (`Network Action Predictor` SQLite)

| Column | Epoch | UTC/local | Confidence | Basis |
|---|---|---|---|---|
| `network_action_predictor.last_hit_time` | 1601 µs | UTC | MEDIUM | `[inferred-from-name]` + convention |

Also carries `user_text` (what was typed into the omnibox) + `url` + `hit_count`/`miss_count` —
forensically valuable as typed-input evidence independent of History. (MEDIUM-HIGH.)

Source file to verify: `chrome/browser/predictors/autocomplete_action_predictor_table.cc`
(note: the on-disk file is named `Network Action Predictor` but the class is
`AutocompleteActionPredictorTable`).

### Simple Cache (`Cache/Cache_Data/`)

Two independent timestamp locations, and they use **different** epochs — this is a genuine trap:

1. **Index file** `Cache_Data/index-dir/the-real-index`: per-entry `last_used_time`. I recall
   this being changed at some point from `base::Time` internal microseconds (1601 µs) to
   **seconds since the Unix epoch** to shrink the index. Direction and version boundary are
   **LOW — VERIFY**. `[inferred]`
2. **Entry stream 0 / EOF metadata** (`f_######` and `######_0` files): contains a pickled
   `net::HttpResponseInfo`, which serialises `request_time` and `response_time` as
   `base::Time` internal values, i.e. **1601 µs UTC** (MEDIUM-HIGH, `[recall-schema]`).
   The cached HTTP `Date:` / `Last-Modified:` / `Expires:` headers are also in there as
   **RFC 7231 IMF-fixdate strings in GMT** — those are UTC by spec, not local (HIGH).

Source files to verify: `net/disk_cache/simple/simple_index_file.cc`,
`net/disk_cache/simple/simple_entry_format.h`, `net/http/http_response_info.cc`.

### Media Engagement / Media History

- Media Engagement scores are surfaced via `chrome://media-engagement` and, in the versions I
  recall, persisted through the **content-settings mechanism in `Preferences`**
  (`profile.content_settings.exceptions.media_engagement`), where each entry has a
  `last_modified` value that is a **1601 µs decimal string** (MEDIUM).
- There is also a `Media History` SQLite DB with playback/session tables carrying
  `last_updated_time_s` / similar columns; the `_s` suffix in some column names suggests
  **Unix seconds**. **LOW — VERIFY.** `[inferred-from-name]`

### DIPS / BTM (`DIPS` SQLite)

- File `<Profile>/DIPS`, `bounces` table with columns of the form
  `first_site_storage_time`, `last_site_storage_time`, `first_user_interaction_time`,
  `last_user_interaction_time`, `first_stateful_bounce_time`, ... (MEDIUM on the exact names).
- Epoch: I believe `base::Time` serialised as **1601 µs**, but I have a competing memory that
  DIPS stores **seconds** to reduce fingerprinting/precision. **LOW — VERIFY.** `[inferred]`
- Naming: the DIPS feature was renamed to **BTM (Bounce Tracking Mitigations)** in the Chromium
  source around 2024–2025 while the on-disk filename stayed `DIPS`. Source moved from
  `content/browser/dips/` to `content/browser/btm/`. (MEDIUM.)

### Preferences / Local State JSON (assorted)

- Content-settings `last_modified` / `lastModified`: 1601 µs decimal string (MEDIUM-HIGH).
- `variations_last_fetch_time` (Local State): 1601 µs decimal string (MEDIUM).
- `uninstall_metrics.installation_date2` (Local State): **Unix seconds** (MEDIUM).
- `user_experience_metrics.stability.stats_buildtime` (Local State): **Unix seconds** (MEDIUM).
- `profile.created_by_version`, `profile.creation_time`: `creation_time` 1601 µs string (LOW).

General rule (MEDIUM-HIGH): in Chrome JSON prefs, a **quoted numeric string** is almost always
1601 µs; a **bare integer** is more often Unix seconds. Useful disambiguation heuristic, but
verify per key rather than relying on it.

---

## 1(c) Are any Chrome timestamps stored in LOCAL time?

**Claim: No — I am not aware of any Chrome/Chromium-written profile artifact that stores a
wall-clock local time.** Confidence **HIGH for the major SQLite artifacts** (History, Cookies,
Login Data, Web Data, Favicons, Shortcuts, Top Sites), **MEDIUM overall** because this is a
negative claim across a large surface.

Structural reason (HIGH): Chromium's serialisation path for every timestamp above goes through
`base::Time`, which is an absolute instant. `base::Time::ToInternalValue()`,
`ToDeltaSinceWindowsEpoch()` and `ToTimeT()` are all epoch-relative and carry no offset. Local
time only enters via `base::Time::LocalExplode()` / `LocalMidnight()`, which are used for
**display and for day-bucketing**, not for persistence.

Where local time genuinely does leak in, and which a forensics tool must not conflate with
Chrome semantics:

1. **Filesystem MAC times of profile files** (MEDIUM-HIGH). NTFS, ext4, APFS and HFS+ store UTC,
   but **FAT32/exFAT store local time with no offset recorded**. A profile acquired from a
   removable exFAT volume will have file-level timestamps in the acquisition machine's local
   time even though every timestamp *inside* the files is UTC. This is the single most likely
   real-world local-time contamination for ForensiX.
2. **Downloaded target files on disk** — same as (1); the download's `end_time` in History is
   UTC but the file's mtime follows the destination filesystem's rules.
3. **`base::Time::LocalMidnight()`-derived day bucketing** in Chrome's own UI (e.g. the History
   page's day grouping) — that grouping is computed at render time from the host TZ and is not
   persisted, so a forensic tool recomputing day buckets in UTC will legitimately disagree with
   what the suspect saw on screen. **This is the practically important consequence of 1(a):
   without the host TZ you cannot faithfully reproduce the suspect's own day boundaries.**
   (MEDIUM-HIGH.)
4. **HTTP header dates in cached responses** are GMT by RFC 7231 — UTC, not local (HIGH).

---

## 1(a) Does any USER_DATA_DIR file record the host timezone / UTC offset?

Per-file answers. **All negative answers are MEDIUM confidence at best** — proving absence from
memory is unreliable, and this whole subsection is high-priority for verification.

| File | Records TZ / UTC offset? | Confidence | Notes |
|---|---|---|---|
| `Preferences` | **No** dedicated TZ key on desktop | MEDIUM | Carries `intl.accept_languages`, `intl.selected_languages`, `spellcheck.dictionaries` — **locale, not timezone**. Locale is a weak jurisdiction hint only. |
| `Secure Preferences` | **No** | MEDIUM | Holds MAC-protected prefs (extensions, homepage, search provider) + `super_mac`. No TZ. |
| `Local State` (desktop) | **No** | MEDIUM | Holds profile list, `os_crypt.encrypted_key`, variations seed/fetch times, browser metrics. No TZ field I can recall. |
| `Local State` (**ChromeOS**) | **YES** | MEDIUM | ChromeOS persists device/user timezone settings — I recall keys along the lines of `settings.timezone` and `settings.resolve_device_timezone_by_geolocation` / `settings.timezone_detection_type`. Exact key names **UNKNOWN — VERIFY**. Not applicable to Windows/macOS/Linux profiles. |
| `Network Action Predictor` | **No** | MEDIUM-HIGH | Schema is user_text/url/hit/miss/last_hit_time only. |
| Media Engagement (`Preferences` content settings / `Media History`) | **No** | MEDIUM | Scores and playback counts only. |
| `DIPS` | **No** | MEDIUM | Per-site bounce/interaction timestamps only. |
| `History` | **No** | HIGH | No TZ column in any table. |
| `Web Data` | **No** | MEDIUM-HIGH | Autofill address records may contain a **country/region** field (jurisdiction hint, not TZ). |
| `Cookies` | **No** directly | MEDIUM-HIGH | But see indirect derivation below. |
| Metrics / UMA files (`Local State` metrics section, `CrashpadMetrics*.pma`, `metrics_guid`) | **No persisted TZ** | LOW-MEDIUM | UMA logs are uploaded, not retained in a TZ-bearing form. Crashpad `settings.dat` holds a client ID + last-upload time, not TZ. **VERIFY.** |
| Crashpad reports (`Crashpad/reports/*.dmp`) | **Possibly, indirectly** | LOW | Minidumps can embed OS/system info; whether TZ (e.g. Windows `TIME_ZONE_INFORMATION`) is present depends on the minidump streams Chromium requests. **VERIFY — this is the most plausible desktop "yes".** |
| `Sessions/`, `Session Storage/`, `Local Storage/leveldb` | Site-controlled | LOW | Chrome itself writes no TZ, but **web page content can**: any site that recorded `Intl.DateTimeFormat().resolvedOptions().timeZone` or `new Date().getTimezoneOffset()` into localStorage/IndexedDB leaves the host TZ in the profile. This is a genuinely exploitable derivation path. MEDIUM as a technique, LOW that it is present in any given profile. |

**Practical derivation paths for host TZ when no explicit field exists** (all MEDIUM, all worth
testing rather than trusting):
1. Compare a Chrome-internal UTC timestamp against an OS-level local artifact for the same event
   (e.g. `downloads.end_time` in UTC vs. the downloaded file's mtime on a FAT/exFAT volume) — the
   delta is the UTC offset at that instant.
2. Search `Local Storage`/`IndexedDB`/`Session Storage` for IANA TZ identifiers
   (`America/`, `Europe/`, `Asia/`) written by analytics scripts.
3. Cached HTTP responses: a server's `Date:` header (UTC) versus the entry's local file mtime.
4. On Windows profiles, the registry (`HKLM\SYSTEM\CurrentControlSet\Control\TimeZoneInformation`)
   is the authoritative source — outside the profile, but usually available in the same image.

**Design consequence, stated as fact not recommendation:** because no desktop Chrome profile
artifact is known to carry the host TZ, a tool that presents timestamps must either present them
in UTC with an explicit label, or require the examiner to supply the offset. Any silently
locale-derived rendering is unreproducible across examiner machines.

---

# QUESTION 2 — Standards revisions — **MUST RE-VERIFY, ALL OF IT**

This entire section is the weakest part of this brief. Standards metadata (revision year,
"under development" status, SWGDE version numbers) is exactly the class of fact that goes stale
and that I should not be trusted on. Per supervisor instruction I have **not guessed SWGDE
version numbers**.

## ISO/IEC 27037

- Title (MEDIUM-HIGH): *Information technology — Security techniques — Guidelines for
  identification, collection, acquisition and preservation of digital evidence*
- Edition / year (MEDIUM-HIGH): **ISO/IEC 27037:2012**, first edition, published **2012-10-15**.
- Status (MEDIUM): Published. It has been through at least one systematic review confirming it.
- Revision under development? **UNKNOWN — VERIFY.** ISO/IEC JTC 1/SC 27/WG 4 is the responsible
  group. Check the ISO catalogue page for a linked "under development" successor entry
  (which would show as ISO/IEC AWI/CD/DIS 27037).
- URL to verify: `https://www.iso.org/standard/44381.html`
- Committee page to verify: `https://www.iso.org/committee/45306.html` (JTC 1/SC 27)

## ISO/IEC 27041, 27042, 27043 — status only

| Standard | Title (MEDIUM) | Year (MEDIUM-HIGH) | Status | URL to verify |
|---|---|---|---|---|
| ISO/IEC 27041 | Guidance on assuring suitability and adequacy of incident investigative method | 2015 | Published (MEDIUM) | `https://www.iso.org/standard/44405.html` |
| ISO/IEC 27042 | Guidelines for the analysis and interpretation of digital evidence | 2015 | Published (MEDIUM) | `https://www.iso.org/standard/44406.html` |
| ISO/IEC 27043 | Incident investigation principles and processes | 2015 | Published (MEDIUM) | `https://www.iso.org/standard/44407.html` |

The ISO catalogue "standard/NNNNN.html" numeric IDs above are **MEDIUM confidence** — if one
404s or resolves to an unrelated standard, search the ISO catalogue by number instead.

## SWGDE

**Version numbers and dates: UNKNOWN — VERIFY. I am deliberately not emitting numbers.**

Documents I am reasonably confident *exist* in the SWGDE catalogue and are relevant here
(titles approximate, MEDIUM):
- *SWGDE Best Practices for Computer Forensic Acquisitions*
- *SWGDE Best Practices for Digital Evidence Collection* (or *…for the Acquisition of Digital Evidence*)
- *SWGDE Position on the Use of MD5 and SHA1 Hash Algorithms in Digital and Multimedia Forensics*
  — this is the directly on-point document for the SHA-1 question and should be fetched first.
- *SWGDE Best Practices for Digital Forensic Video Analysis* (not relevant, listed to avoid confusion)

SWGDE uses a `NN-X-NNN` document-number scheme plus a version number and an approval date, and
documents are periodically re-approved with a bumped version. **Any version number cited without
fetching the current published listing will be wrong within a year or two.**

- Master listing to verify: `https://www.swgde.org/documents/published-complete-listing/`
- Site root if that path has moved: `https://www.swgde.org/`

## NIST SP 800-86

- Title (HIGH): *Guide to Integrating Forensic Techniques into Incident Response*
- Authors (MEDIUM): Karen Kent, Suzanne Chevalier, Tim Grance, Hung Dang
- Published (HIGH): **August 2006**. Revision: none that I am aware of; it remains the original.
- Status (MEDIUM): **Final**. NIST has been withdrawing/marking older SPs; whether 800-86 has
  been flagged for withdrawal or has an active revision project is **UNKNOWN — VERIFY**.
- URL to verify: `https://csrc.nist.gov/pubs/sp/800/86/final`
  (legacy path, also worth trying: `https://csrc.nist.gov/publications/detail/sp/800-86/final`)

## NIST SP 800-131A Rev. 2 and SHA-1

- Title (HIGH): *Transitioning the Use of Cryptographic Algorithms and Key Lengths*
- Revision (MEDIUM-HIGH): **Revision 2, March 2019**. Status: Final.
  **VERIFY whether a Rev. 3 has since been issued** — this is plausible given the SHA-1 and
  post-quantum transitions and is the single most likely stale fact in this section.
- URL to verify: `https://csrc.nist.gov/pubs/sp/800/131/a/r2/final`

SHA-1 status, as I understand it (MEDIUM, and the nuance matters):
- SP 800-131A Rev. 2 treats SHA-1 as **disallowed for digital signature generation**, and
  **acceptable only for legacy verification** of existing signatures.
- For **non-digital-signature applications** — which is what a forensic image/file integrity
  hash is — SP 800-131A's tables have historically been more permissive, since the relevant
  attack is collision, not preimage. **This distinction is the crux of the question and must be
  read directly from the Rev. 2 tables, not taken from this document.** MEDIUM.
- Separately, NIST announced in **December 2022** that SHA-1 should be **fully retired by
  31 December 2030**, with modules using it not to be certified past that date.
  Announcement URL to verify: `https://www.nist.gov/news-events/news/2022/12/nist-retires-sha-1-cryptographic-algorithm`
- SHA-256 (FIPS 180-4) is **acceptable / approved with no sunset** in SP 800-131A Rev. 2.
  FIPS 180-4 URL: `https://csrc.nist.gov/pubs/fips/180-4/upd1/final`
- Practical forensic reality (MEDIUM): chosen-prefix collisions against SHA-1 became practical
  (SHAttered 2017; Leurent–Peyrin chosen-prefix 2019/2020), which is why SHA-1 alone is
  challengeable in court as an integrity primitive even where a standard has not formally
  banned it for that use. Dual MD5+SHA-1 is the historical mitigation; SHA-256 is the
  forward-looking one.

## Does any of these MANDATE a hash algorithm, or per-file vs per-volume hashing?

**Claim: No.** Confidence **MEDIUM-HIGH**, and it is a negative claim, so verify.

Basis for the claim:
- **ISO/IEC 27037:2012** is written to be technology- and algorithm-neutral. It requires that a
  **verification function** be applied and that the process be documented, repeatable and
  reproducible, but to my knowledge it does not name SHA-256 or any other algorithm, and does not
  prescribe per-file versus per-volume scope. (MEDIUM)
- **ISO/IEC 27041/27042/27043** are about method assurance, analysis/interpretation, and process
  models respectively — none is an algorithm specification. (MEDIUM-HIGH)
- **NIST SP 800-86** is a guide, not a control catalogue; it discusses integrity hashing generally
  and is not prescriptive about algorithm or scope. (MEDIUM)
- **SWGDE** issues **positions and best practices**, which are advisory by construction, not
  mandatory. The MD5/SHA1 position paper expresses a position on continued suitability rather than
  imposing a requirement. (MEDIUM — read the actual document.)
- **NIST SP 800-131A** mandates within *cryptographic* contexts (signatures, key establishment);
  it is not a forensics standard and does not address acquisition scope at all. (MEDIUM-HIGH)

On **per-file vs per-volume**: no standard I am aware of mandates either. In practice, physical /
bit-stream acquisition is verified by a **whole-image (per-volume) hash**, optionally with
**piecewise hashing** (e.g. the ewf/E01 chunk CRCs, or `dcfldd`-style block hashes) so that a
single bad sector does not invalidate the entire image; **logical** acquisition of selected files
is verified **per-file**. Both are accepted practice; the standards require documentation of
whichever was used, not a particular choice. (MEDIUM.)

---

# VERIFICATION QUEUE

Ranked by blast radius. Each item: the claim → exact URL to fetch → what breaks if I'm wrong.

### P0 — wrong answer silently corrupts every timeline ForensiX produces

1. **Web Data autofill uses Unix seconds while everything else uses 1601 µs.**
   - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/components/autofill/core/browser/webdata/autofill_table.cc`
     (if 404, try `.../webdata/autofill/autofill_table.cc` and
     `.../webdata/addresses/address_autofill_table.cc`)
   - Breaks if wrong: autofill timestamps off by 369 years, or off by 10^6. Any "when did the
     suspect enter this address" conclusion is void.

2. **History `downloads.start_time`/`end_time` epoch, and the schema version at which it
   migrated from `time_t` to 1601 µs.**
   - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/download_database.cc`
   - And: `https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/history_database.cc`
     (for `kCurrentVersionNumber` and the migration ladder)
   - Breaks if wrong: download timelines from older profiles are 369 years off with no warning.
     Also determines whether ForensiX needs a schema-version-dispatched decoder.

3. **Login Data `date_created` epoch and its migration version.**
   - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/components/password_manager/core/browser/login_database.cc`
   - Breaks if wrong: credential-creation timelines wrong on older profiles; this is often the
     most legally significant timestamp in a case.

4. **Cookies columns are all 1601 µs, and which Chrome version added `last_update_utc`.**
   - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/net/extras/sqlite/sqlite_persistent_cookie_store.cc`
   - Breaks if wrong: cookie expiry/last-access analysis wrong; a missing-column query throws on
     older profiles.

5. **History `urls.last_visit_time` / `visits.visit_time` are 1601 µs UTC.**
   - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/visit_database.cc`
   - Breaks if wrong: the core of the product is wrong. (Lowest actual risk, highest impact —
     verify anyway so it can be cited.)

### P1 — wrong answer produces a wrong or unciteable integrity claim

6. **NIST SP 800-131A: is Rev. 2 still current, and what exactly does it say about SHA-1 for
   NON-signature integrity use?**
   - Fetch: `https://csrc.nist.gov/pubs/sp/800/131/a/r2/final` (and the CSRC SP 800-131A series
     landing page to check for a Rev. 3)
   - Breaks if wrong: ForensiX's stated justification for its hash choice is wrong in the one
     place a defence expert will look.

7. **SWGDE current document titles, version numbers and approval dates**, especially the
   MD5/SHA-1 position paper.
   - Fetch: `https://www.swgde.org/documents/published-complete-listing/`
   - Breaks if wrong: citing a superseded SWGDE version number in tool output is a credibility
     hit and is trivially checkable by an opposing expert.

8. **Do ISO/IEC 27037 or SWGDE mandate an algorithm or a per-file/per-volume scope?**
   - Fetch: `https://www.iso.org/standard/44381.html` (abstract/scope; full text is paywalled —
     note that limitation explicitly rather than inferring from the abstract)
   - Breaks if wrong: ForensiX would be claiming discretion it does not have, or imposing a
     constraint that does not exist.

9. **ISO/IEC 27037 revision under development?**
   - Fetch: `https://www.iso.org/standard/44381.html` and `https://www.iso.org/committee/45306.html`
   - Breaks if wrong: citing a superseded edition.

10. **NIST SP 800-86 status — still Final, not withdrawn, no revision in flight?**
    - Fetch: `https://csrc.nist.gov/pubs/sp/800/86/final`
    - Breaks if wrong: citing a withdrawn NIST SP.

### P2 — affects specific features, not the core

11. **Simple Cache index `last_used_time` epoch (1601 µs vs Unix seconds) and version boundary.**
    - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/net/disk_cache/simple/simple_index_file.cc`
    - Breaks if wrong: cache-derived timeline feature is wrong. Marked LOW above — genuinely uncertain.

12. **DIPS/BTM table names and timestamp epoch.**
    - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/content/browser/btm/btm_storage.cc`
      (if 404: `https://chromium.googlesource.com/chromium/src/+/main/content/browser/dips/dips_storage.cc`)
    - Breaks if wrong: DIPS parsing feature fails or mis-decodes. Also confirms the DIPS→BTM rename.

13. **ChromeOS `Local State` timezone key names** — the only "yes" in Q1(a).
    - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/chromeos/ash/components/settings/cros_settings_names.cc`
      and `https://chromium.googlesource.com/chromium/src/+/main/chrome/common/pref_names.h`
    - Breaks if wrong: a claimed ChromeOS TZ-recovery capability that does not exist.

14. **Bookmarks `date_added` is a decimal STRING of 1601 µs (not a JSON number).**
    - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/components/bookmarks/browser/bookmark_codec.cc`
    - Breaks if wrong: precision loss / parse errors on bookmark timestamps.

15. **Favicons, Shortcuts, Top Sites, Network Action Predictor epochs.**
    - Fetch: `.../components/history/core/browser/thumbnail_database.cc`,
      `.../components/omnibox/browser/shortcuts_database.cc`,
      `.../components/history/core/browser/top_sites_database.cc`,
      `.../chrome/browser/predictors/autocomplete_action_predictor_table.cc`
      (all under `https://chromium.googlesource.com/chromium/src/+/main/`)
    - Breaks if wrong: secondary-artifact timelines wrong; Top Sites in particular may have no
      timestamp at all, which would make a planned feature impossible.

16. **Confirm the absence of any TZ field** in `Preferences` / `Local State` on desktop.
    - Fetch: `https://chromium.googlesource.com/chromium/src/+/main/chrome/common/pref_names.h`
      and `https://chromium.googlesource.com/chromium/src/+/main/components/prefs/`
    - Also check whether Crashpad minidumps carry `TIME_ZONE_INFORMATION`:
      `https://chromium.googlesource.com/crashpad/crashpad/+/main/minidump/`
    - Breaks if wrong: ForensiX would be forcing manual TZ entry when the data was recoverable
      all along.

---

## Gaps

- No claim here is live-verified; the whole document is a hypothesis set.
- ISO full texts are paywalled, so the "does it mandate an algorithm" question can only be
  answered from scope/abstract text or secondary summaries unless the repo has licensed copies.
- Chrome version boundaries for every schema migration mentioned are approximate. A production
  tool needs the actual `kCurrentVersionNumber` ladders from each DB's source, not version
  guesses.
- I did not cover: `Sessions`/`Tabs` SNSS timestamp format, `Extension State`/`Local Storage`
  LevelDB internal timestamps, `Sync Data`, `Affiliation Database`, `Reporting and NEL`,
  `Trust Tokens`, `Site Characteristics Database`. These may carry additional timestamps.
