# #143 — CONFIRMED partial findings (salvaged from timed-out run b1be1734)

> **Status: PARTIAL but PRIMARY-SOURCED.** Everything in this file was read from
> live Chromium source over gitiles by run `b1be1734`, which timed out at 30 min
> before writing its brief. Recovered from the run transcript.
>
> Unlike `143-leads-unverified.md` (grep plan, model knowledge only), the claims
> **in this file are cited and were actually fetched**. They can be promoted into
> the final matrix after a spot-check of the quoted lines.

Ref read against: `cb211f647e4138888643a909973b2d07d49ae79c` (main at time of run).

---

## 1. History — `MigrateTimeEpoch()` at v16→17 is PLATFORM-CONDITIONAL

**This is the highest-value finding and it generalises the issue's hazard.**

`components/history/core/browser/history_database.cc` @ `cb211f6`:

```cpp
  if (cur_version == 16) {
#if !BUILDFLAG(IS_WIN)
    // In this version we bring the time format on Mac & Linux in sync with the
    // Windows version so that profiles can be moved between computers.
    MigrateTimeEpoch();
#endif
    // On all platforms we bump the version number, so on Windows this
    // migration is a NOP. We keep the compatible version at 16 since things
    // will basically still work, just history will be in the future if an
    // old version reads it.
    ++cur_version;
    std::ignore = meta_table_.SetVersionNumber(cur_version);
  }
```

Body at line ~1193:

```cpp
void HistoryDatabase::MigrateTimeEpoch() {
  std::ignore = db_.Execute(
      "UPDATE urls SET last_visit_time = last_visit_time + 11644473600000000 "
      "WHERE id IN (SELECT id FROM urls WHERE last_visit_time > 0);");
  std::ignore = db_.Execute(
      "UPDATE visits SET visit_time = visit_time + 11644473600000000 "
      "WHERE id IN (SELECT id FROM visits WHERE visit_time > 0);");
  std::ignore = db_.Execute(
      "UPDATE segment_usage SET time_slot = time_slot + 11644473600000000 "
      "WHERE id IN (SELECT id FROM segment_usage WHERE time_slot > 0);");
}
```

Forensic consequence:

- A **History DB at `meta.version` <= 16 originating on macOS or Linux stores Unix
  microseconds**, not 1601-µs. Columns affected: `urls.last_visit_time`,
  `visits.visit_time`, `segment_usage.time_slot`.
- The **same DB at the same version originating on Windows stores 1601-µs.**
- So `meta.version` **alone does not determine the epoch for History** — the
  originating OS is a required input. No column records that OS.
- The version bump happens on all platforms, so a Windows-origin v17 DB and a
  Mac-origin v17 DB agree; the ambiguity is confined to <= 16.

This breaks the assumption in the #125 model (and in the #143 issue text) that
`meta.version` is a sufficient discriminator. **Escalate to the integrity model
in #125.** A v16 History DB needs a platform hint or a range/sanity heuristic.

---

## 2. History downloads — Unix **seconds** before the migration

`components/history/core/browser/download_database.cc` @ `cb211f6`, lines ~158-166:

```sql
  "(id,current_path,target_path,start_time,received_bytes,"
  "total_bytes,state,danger_type,interrupt_reason,end_time,"
  ...
  "CASE start_time WHEN 0 THEN 0 ELSE (start_time + 11644473600) * 1000000 END,"
  "CASE end_time   WHEN 0 THEN 0 ELSE (end_time   + 11644473600) * 1000000 END,"
```

Note the shape: `(t + 11644473600) * 1000000` — offset in **seconds** then scaled
to µs. So the pre-migration `downloads.start_time` / `end_time` were **Unix
seconds**, a different pre-state from History's `urls`/`visits` (Unix µs).
Two different legacy epochs inside the same file.

`last_access_time` added later via `EnsureColumnExists("last_access_time", "INTEGER NOT NULL DEFAULT 0")` (line ~304);
written with `statement.BindTime(...)` (lines ~610-613) so it is 1601-µs from
introduction. **Sentinel 0 means "never", not 1601-01-01** — must not be rendered
as a date.

UNRESOLVED: exact History `meta.version` at which the downloads migration ran.

---

## 3. Login Data — the v8 epoch migration, confirmed

`components/password_manager/core/browser/password_store/login_database.cc` @ `cb211f6`
(**note: path corrected — issue #143 cites the pre-move path, which now 404s**):

- line ~826: `"UPDATE logins SET date_created = (date_created * ?) + ?"`
  — bound multiplier + offset, consistent with Unix-seconds -> 1601-µs.
- line ~857: `"UPDATE logins SET date_password_modified = date_created"`
  — so `date_password_modified` is **backfilled from `date_created`** at its
  introducing version. For any row not modified since, that timestamp is
  synthetic and does not evidence a password change. Forensically important.
- line ~240 / ~1486: `s->BindTime(COLUMN_DATE_CREATED, cred.date_created)` — 1601-µs today.
- line ~1725: `cred.date_created = s.ColumnTime(COLUMN_DATE_CREATED)`.

UNRESOLVED: exact bound values of the `?` params and the precise version guard.

---

## 4. Web Data — address table reorg located, versions NOT yet pinned

`components/autofill/core/browser/webdata/addresses/address_table.cc` (approx) @ `cb211f6`:

```cpp
constexpr std::string_view kContactInfoTable = "contact_info";
constexpr std::string_view kLocalAddressesTable = "local_addresses";
constexpr std::string_view kContactInfoTypeTokensTable = "contact_info_type_tokens";
constexpr std::string_view kLocalAddressesTypeTokensTable = "local_addresses_type_tokens";
// ... tables named autofill_profiles* are no longer used in ...
// Use the contact_info* and local_addresses* tables instead.
constexpr std::string_view kAutofillProfilesTable = "autofill_profiles";
```

Legacy `autofill_profiles*` constants are retained **only for migration/cleanup**.
UNRESOLVED: the `meta.version` boundary and the Chrome milestone. This is exactly
where run b1be1734 was working ("bisecting Web Data schema versions to milestones")
when it timed out.

---

## Method notes — what works, what doesn't

Learned the hard way by run b1be1734; reuse these, don't rediscover.

**Fetch a file (works):**
```bash
curl -sS --max-time 30 "https://chromium.googlesource.com/chromium/src/+/refs/heads/main/<PATH>?format=TEXT" -o f.b64
base64 -d -i f.b64 -o f.src     # macOS syntax: -i/-o, NOT `base64 -d f.b64`
```
A 404 returns a ~233-byte `NOT_FOUND` body — **check size before decoding**.

**Pin a file at a release:** `.../+/refs/tags/<VERSION>/<PATH>?format=TEXT`

**`+log` is HTTP 401 unauthenticated — the blame/log route is CLOSED.** Do not
retry it. Bisect over release tags instead.

**Milestone mapping (works):**
- `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&mstone=<N>&num=5`
  -> version strings for milestone N. Confirmed working for N=24, 60, 120.
- `https://chromiumdash.appspot.com/fetch_commit?commit=<SHA>` -> milestone for a SHA.
- `fetch_milestone_schedule?mstone=<N>` -> dates.

**Bisection recipe for "which version introduced X":** pick milestone -> get its
release tag -> fetch the table's `.cc` at `refs/tags/<tag>` -> read
`kCurrentVersionNumber`. Binary search milestones. Cache every fetch to disk;
use a **unique temp filename per fetch** (b1be1734 hit a race clobbering a shared
temp file).

**Cost warning:** whole-scope-in-one-agent took >30 min and produced nothing on
disk. Split by artifact and checkpoint after every artifact.
