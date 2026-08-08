# 125 — Integrity model: verified timestamp, timezone and standards facts

**Method — two rounds, same as [#121](https://github.com/ChmaraX/forensix/issues/121).** Round 1: a `researcher` subagent with no web tooling produced a labelled-confidence brief from model knowledge — kept verbatim at [`125-integrity-facts-unverified.md`](./125-integrity-facts-unverified.md), banner and verification queue intact. Round 2 (this file): the load-bearing claims were checked against Chromium `main` and against the standards bodies, by fetch. Every verdict below cites something actually retrieved.

Fetched 2026-08-08. Chromium ref: `main`.

---

## Verified — Chrome timestamp epochs

**Canonical encoding: microseconds since 1601-01-01 UTC.**

- `base/time/time.h:6-7` — "internally represented as microseconds (s/1,000,000) since the Windows epoch (1601-01-01 00:00:00 UTC)"; restated at `:537`
- `sql/statement.cc:529-535` — `Statement::ColumnTime()` returns `base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(int_value))`

Any column written through `sql::Statement::BindTime` is therefore 1601-µs UTC. Confirmed users:

| Artifact | Columns | Evidence |
|---|---|---|
| `Cookies.cookies` | `creation_utc`, `expires_utc`, `last_access_utc`, `last_update_utc` | `net/extras/sqlite/sqlite_persistent_cookie_store.cc:1344,1366,1369,1379` |
| `Login Data.logins` | `date_created`, `date_last_used`, `date_password_modified`, `date_received`, `date_last_filled` | `components/password_manager/core/browser/password_store/login_database.cc:240,261,265,272,275` |
| `History` | `visits.visit_time`, `urls.last_visit_time` | `components/history/core/browser/visit_database.cc:751,780` (`ToInternalValue`) |

**CONFIRMED exception — `Web Data.autofill` is Unix seconds.** `components/autofill/core/browser/webdata/autocomplete/autocomplete_table.cc:53,70,145,156,178` — `time_t`-typed, `end.ToTimeT()`, `base::Time::FromTimeT(s.ColumnInt64(2))`. The brief called this "the well-known outlier" at HIGH; it is correct, and the file has moved to `webdata/autocomplete/` in the current tree.

Net effect: **two columns named `date_created`, in one acquisition, 369 years apart.**

## NEW — the epoch of `logins.date_created` depends on the database version

Not in the brief. `login_database.cc:824-832`:

```cpp
if (current_version <= 8) {
  "UPDATE logins SET date_created = (date_created * ?) + ?"
  BindInt64(0, base::Time::kMicrosecondsPerSecond);
  BindInt64(1, base::Time::kMicrosecondsFromWindowsToUnixEpoch);
}
```

`logins.date_created` held **Unix seconds** at database version ≤ 8 and is rewritten in place to 1601-µs the first time a newer Chrome opens the file. A forensic copy is never opened by Chrome — that is the entire point of it. So the same column can carry either encoding, and **the discriminator is `meta.version`, not the column name**. This is invisible to any parser holding a single conversion constant, and it produces a plausible-looking wrong date rather than an error.

Related, from [#117](https://github.com/ChmaraX/forensix/issues/117): `last_compatible_version` is already known to be per-database. Version is now load-bearing for decoding as well as for compatibility.

## Verified — no local-time storage; but local time enters from outside

The brief's negative claim (no Chrome-written artifact stores wall-clock local time) is **CONFIRMED structurally**: every persisted timestamp above routes through `base::Time`, an absolute instant with no offset (`time.h:6-7`). v1's `'localtime'` SQL modifier is therefore a pure output-side defect — it converts correct UTC into the *container's* zone and discards the offset.

Three contamination channels the brief raised that survive review and are **not** Chrome semantics:

1. **FAT32/exFAT store file MAC times in local time with no offset.** A profile acquired from a removable volume has file-level times in the acquiring machine's zone while every timestamp inside the files is UTC. Highest-likelihood real contamination.
2. **Day bucketing.** Chrome's own History UI groups by `LocalMidnight()` at render time. A tool bucketing in UTC will legitimately disagree with what the suspect saw — without the suspect's zone you cannot reproduce their day boundaries.
3. **Downloaded target files** follow the destination filesystem's rules, not `downloads.end_time`.

## Verified — the profile does not record the host timezone

`chrome/common/pref_names.h` (3,295 lines, desktop prefs) has **zero** case-insensitive matches for `zone`. Consistent with the brief's MEDIUM-confidence negative.

Not disproved, and left open: the brief's "most plausible desktop yes" — **Crashpad minidumps** (`Crashpad/reports/*.dmp`) can embed OS system-info streams, possibly including Windows `TIME_ZONE_INFORMATION`. Not checked. ChromeOS `Local State` does carry timezone settings, but ChromeOS is not among the three source platforms in scope ([#138](https://github.com/ChmaraX/forensix/issues/138)).

Consequence: **the suspect's timezone is a declared case property, not a derived one.**

## Pinned — standards revisions

Closes [#121](https://github.com/ChmaraX/forensix/issues/121)'s open item ("must be pinned before #125 cites standards by name"). The brief deliberately left SWGDE numbers UNKNOWN; they are now fetched.

| Document | Revision | Date | Source fetched |
|---|---|---|---|
| ISO/IEC 27037 — *Guidelines for identification, collection, acquisition and preservation of digital evidence* | **:2012** | 2012 | `webstore.ansi.org/standards/iso/isoiec270372012`, shown as **"Most recent"** |
| SWGDE *Best Practices for Computer Forensic Acquisitions* | **17-F-002-2.1** | **2025-08-05** | `swgde.org/documents/published-by-committee/forensics/` |
| SWGDE *Best Practices for Digital Evidence Collection* | **18-F-002-2.0** | **2025-11-20** | same |
| SWGDE *Best Practices for Computer Forensic Examinations* | **18-F-001-2.0** | **2025-07-28** | same |
| SWGDE *Best Practices Apple MacOS Forensic Acquisition* | **23-F-005-1.0** | 2024-03-15 | same |
| NIST SP 800-131A Rev. 2 — *Transitioning the Use of Cryptographic Algorithms and Key Lengths* | **Rev. 2**, final | — | `csrc.nist.gov/pubs/sp/800/131/a/r2/final` |

`iso.org` is Cloudflare-gated to both plain fetch and a real browser; the ANSI listing substitutes. ISO/IEC 27041/27042/27043 not checked.

**Not established:** whether any of these *mandates* an algorithm, or per-file versus per-volume hashing. Titles and revisions are pinned; normative content is not. Cite for alignment only — never claim compliance.

Also from the brief, unverified and relevant to [#136](https://github.com/ChmaraX/forensix/issues/136)/parser work: NIST SP 800-131A Rev. 2 disallows SHA-1 for *digital signature generation* specifically and does not govern non-signature integrity hashing; SHA-1 retirement by end-2030 was announced separately. So "SHA-1 is banned" is **too strong** as a justification — SHA-256 is chosen for collision resistance and tool interoperability, not because a standard forbids SHA-1 here.

---

## What this changed in the decision

1. A normalised UTC instant alone is **insufficient**. Raw value + epoch family must be stored beside it.
2. Epoch resolution needs `meta.version` in scope at decode time.
3. The suspect timezone is declared, never derived — there is nothing to derive it from.
4. The `logins` version hazard generalises: **other columns may have had silent epoch migrations too.** Ticketed separately.
