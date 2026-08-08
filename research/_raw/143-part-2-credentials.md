# #143 Part 2 — Credential & cookie family: timestamp epoch/version matrix

**Status:** COMPLETE for the assigned scope, with an explicit verification queue (§8).
**Date:** 2026-08-08 (repo-relative).
**Live source status:** fetching from `chromium.googlesource.com` gitiles over `?format=TEXT`.
**Primary ref:** `cb211f647e4138888643a909973b2d07d49ae79c` unless a row says otherwise.

Scope: `Login Data` / `Login Data For Account`, `Network/Cookies`, `DIPS` (BTM),
and `Web Data` token/sync tables that carry timestamps.

---

## 0. Helper classification (read, not assumed)

`sql/statement.cc` @ `cb211f6`:

- L300-316 `Statement::BindTime(int param_index, base::Time val)` -> `int64_t int_value = TimeToSqlValue(val); sqlite3_bind_int64(...)`.
- L529-535 `Statement::ColumnTime` -> `base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(sqlite3_column_int64(...)))`.

So **`ColumnTime` is definitively 1601-µs UTC**, and `BindTime` is its inverse
`sql/statement.cc:41-45` @ `cb211f6` (declared `sql/statement.h:64-66`):

```cpp
// static
int64_t Statement::TimeToSqlValue(base::Time time) {
  return time.ToDeltaSinceWindowsEpoch().InMicroseconds();
}
```

**So `BindTime` writes 1601-µs UTC, definitively.** This single read classifies every
`BindTime` call site in this brief. A corollary that matters for sentinels: a default-
constructed / null `base::Time` has a zero delta since the Windows epoch, so
`BindTime(base::Time())` writes literal **`0`**. Every `BindTime`-written column therefore
has `0` as its "null/never" sentinel, and `0` must never be rendered as 1601-01-01.

`base/time/time.h` @ `cb211f6` L545-546:

```cpp
  static constexpr int64_t kMicrosecondsFromWindowsToUnixEpoch =
      INT64_C(11644473600000000);
```

and L411-412 `kMicrosecondsPerSecond = 1000000`. Note the **sign is positive** — despite the
name reading "Windows to Unix", the constant is the offset you *add* to a Unix-epoch µs value
to get a Windows-epoch (1601) µs value.

---

## 1. Login Data — `logins.date_created` (PRIORITY 1) — CONFIRMED

File: `components/password_manager/core/browser/password_store/login_database.cc` @ `cb211f6`.
(Issue #143's path `components/password_manager/core/browser/login_database.cc` is **stale/404**.)

### The migration, verbatim (L822-832)

```cpp
  // Data changes, not covered by the schema migration above.
  if (current_version <= 8) {
    sql::Statement fix_time_format;
    fix_time_format.Assign(db->GetUniqueStatement(
        "UPDATE logins SET date_created = (date_created * ?) + ?"));
    fix_time_format.BindInt64(0, base::Time::kMicrosecondsPerSecond);
    fix_time_format.BindInt64(1,
                              base::Time::kMicrosecondsFromWindowsToUnixEpoch);
    if (!fix_time_format.Run()) {
      return false;
    }
  }
```

### Resolved values

| Item | Value | Evidence |
|---|---|---|
| Version guard | `current_version <= 8` (`current_version` = `meta.version` read from disk **before** migration) | `login_database.cc:823` |
| Multiplier (`?` #0) | `base::Time::kMicrosecondsPerSecond` = **1 000 000** | `login_database.cc:827`; `base/time/time.h:411-412` |
| Offset (`?` #1) | `base::Time::kMicrosecondsFromWindowsToUnixEpoch` = **11 644 473 600 000 000** | `login_database.cc:828-829`; `base/time/time.h:545-546` |
| Transform | `new = old_unix_seconds * 1e6 + 11644473600000000` | — |

### Verdict on the round-1 claim

**"Unix seconds at db version <= 8" is CONFIRMED.** The arithmetic is unambiguous: seconds ->
µs, then Unix-epoch -> 1601-epoch. Both epochs are **UTC**.

- `meta.version` **<= 8** on disk => `logins.date_created` is **Unix seconds UTC** (10 digits).
- `meta.version` **>= 9** on disk => `logins.date_created` is **1601 µs UTC** (18 digits).

Version 8 and version 9 are otherwise **schema-identical** (`login_database.cc:423-427`:
`// Version 8.` `SealVersion(...8u);` `// Version 9.` `SealVersion(...9u);` — no column
changes). **Version 9 exists solely to carry this epoch change.** There is no column-presence
tell that distinguishes v8 from v9; a parser MUST read `meta.version`.

### Forensic caveats

1. The rewrite is **in place, on first open by a Chrome new enough to have the migration.**
   A forensic image is never opened, so its `meta.version` is a faithful record of the
   encoding at acquisition time. Good.
2. The migration is gated on `meta.version` **alone** — there is **no value-magnitude sanity
   check**. If a `meta.version` were tampered down to <= 8 on an already-migrated DB, Chrome
   would multiply the already-1601-µs values by 1e6 again (overflow). Conversely a DB whose
   version was bumped without the data being rewritten would be silently misread forever.
3. **Cross-epoch collision hazard:** `logins.date_created` at v<=8 (Unix seconds) is
   numerically indistinguishable from `Web Data`'s `autofill.date_created` (also Unix
   seconds) and *is* distinguishable from `logins.date_created` at v>=9. A single
   "date_created" renderer applied to both is wrong by ~369 years for one of them.
4. Unlike History's `MigrateTimeEpoch()`, this migration is **NOT platform-conditional** —
   there is no `#if BUILDFLAG` around it (`login_database.cc:822-833`). `meta.version` IS a
   sufficient discriminator for Login Data. This is a meaningful contrast with History v16.

### Milestone

UNRESOLVED — see verification queue V-2. `+log` is 401 unauthenticated, so pinning v8->v9 to
a milestone requires bisecting release tags, which I did not have budget to complete.
Current `kCurrentVersionNumber = 43` (`login_database.cc:80`), `kCompatibleVersionNumber = 40`
(`login_database.cc:83`).

---

## 2. Login Data — `date_password_modified` backfill (PRIORITY 2) — CONFIRMED

### Column introduction

`login_database.cc:516-519`:

```cpp
  // Version 30. Introduce 'date_password_modified' column.
  builders.logins->AddColumn("date_password_modified",
                             "INTEGER NOT NULL DEFAULT 0");
  SealVersion(builders, /*expected_version=*/30u);
```

**Column added at Login Data schema version 30.** Absent below v30 — a parser must
`PRAGMA table_info(logins)` or dispatch on `meta.version` before selecting it.

### The backfill

`login_database.cc:853-861`:

```cpp
  // Set the default value for 'date_password_modified'.
  if (current_version < 30) {
    sql::Statement set_date_password_modified;
    set_date_password_modified.Assign(db->GetUniqueStatement(
        "UPDATE logins SET date_password_modified = date_created"));
    if (!set_date_password_modified.Run()) {
      return false;
    }
  }
```

Guard: **`current_version < 30`** (i.e. any DB opened at v<=29 gets the backfill as it is
upgraded).

### FORENSIC WARNING — synthetic value

Every `logins` row that existed before the v30 upgrade has
`date_password_modified == date_created` **by construction, not by observation**. For such a
row the value is **synthetic** and **does NOT evidence a password change**. It evidences only
that the credential predates schema v30.

Detection heuristic (heuristic, not proof): `date_password_modified == date_created` exactly
to the microsecond is overwhelmingly likely to be the backfill rather than a genuine
"password set at creation" event, because a genuine change writes `base::Time::Now()` at a
different instant. But a credential *created* with a password does legitimately get equal
values at insert time (`login_database.cc:240` and `:265` bind both in the same INSERT),
so equality alone is **not** conclusive. Combine with `meta.version` and the v30 milestone.

Note the backfill runs **after** the `<= 8` epoch fix in the same `MigrateDatabase()` body
(order: L823 then L855). So for a DB coming from v<=8 all the way to v>=30 in one open, the
backfilled `date_password_modified` inherits the **already-corrected 1601-µs** value. There
is no path that leaves `date_password_modified` holding Unix seconds — it either does not
exist (v<30) or holds 1601-µs.

Also: the column default is `0`. **`0` is a sentinel meaning "unset", not 1601-01-01.**

---

## 3. Login Data — full timestamp column inventory

All write sites below use `sql::Statement::BindTime` and all read sites use `ColumnTime`
=> **1601 µs UTC** unless the row says otherwise.

| Column | Introduced at version | Epoch | Write site (`login_database.cc` @ `cb211f6`) | Read site | Sentinel |
|---|---|---|---|---|---|
| `logins.date_created` | v0/v1 (`:387`) | **Unix s UTC at meta.version <= 8; 1601 µs UTC at >= 9** | `:240`, `:1486` `BindTime` | `:1725` `ColumnTime` | — |
| `logins.date_synced` | v6 (`:412`), **DROPPED at v31** (`:521-522`) | UNRESOLVED (no live bind site remains at `cb211f6`) — see V-3 | column is gone from current source | — | — |
| `logins.date_last_used` | v25 (`:486-488`) | 1601 µs UTC | `:261`, `:1506` `BindTime` | `:1753` `ColumnTime` | `DEFAULT 0` = never used |
| `logins.date_password_modified` | v30 (`:516-518`) | 1601 µs UTC | `:265`, `:1510` `BindTime` | `:1761` `ColumnTime` | `DEFAULT 0`; **backfilled = `date_created` for pre-v30 rows** |
| `logins.date_received` | v37 (`:562`) | 1601 µs UTC | `:272`, `:1513` `BindTime` | `:1766` `ColumnTime` | shared-password metadata; NULLable |
| `logins.date_last_filled` | v42 (`:587-588`) | 1601 µs UTC | `:275`, `:1519` `BindTime` | `:1754` `ColumnTime` | `DEFAULT 0` = never filled |
| `insecure_credentials.create_time` | v29 (`:511`) | **1601 µs UTC** | `insecure_credentials_table.cc:111` (see below); backfill at `login_database.cc:869` | `insecure_credentials_table.cc:28-29` | `0` = uninitialised, backfilled |
| `password_notes.date_created` | v33 (`:535`) | **1601 µs UTC** | `password_notes_table.cc:149` `s.BindTime(3, note.date_created);` | `password_notes_table.cc:46-47` `base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(s->ColumnInt64(3)))` | — |
| `stats.update_time` | `statistics_table.cc:53-61` (`CREATE TABLE stats`, created on demand, not in the `logins` version ladder) | **1601 µs UTC** | `statistics_table.cc:94` `s.BindTime(COLUMN_DATE, stats.update_time);` | `statistics_table.cc:36` `s->ColumnTime(COLUMN_DATE)` | `NOT NULL`, no sentinel |

#### Sub-table write sites, verbatim

`components/password_manager/core/browser/password_store/insecure_credentials_table.cc:110-112`
@ `cb211f6` — note this one bypasses `BindTime` and spells the conversion out, which is
**independent confirmation of the 1601-µs encoding** rather than a `BindTime` inference:

```cpp
  s.BindInt64(2,
              metadata.create_time.ToDeltaSinceWindowsEpoch().InMicroseconds());
```

Read side, `insecure_credentials_table.cc:28-29`:
`base::Time create_time = base::Time::FromDeltaSinceWindowsEpoch(base::Microseconds(...));`

`.../password_store/statistics_table.cc:53-61` — the `stats` schema:

```sql
CREATE TABLE stats (
  origin_domain VARCHAR NOT NULL,
  username_value VARCHAR,
  dismissal_count INTEGER,
  update_time INTEGER NOT NULL,
  UNIQUE(origin_domain, username_value))
```

**`stats.update_time` is 1601 µs UTC — the round-1 sheet's "competing memory of unix-s here"
is REFUTED** by `statistics_table.cc:94` (`BindTime`) and `:36` (`ColumnTime`). `stats` records
password-bubble dismissals per origin; `update_time` is the last dismissal.

`password_notes.date_created` note: this is the **third** `date_created` in a Chrome profile
(after `logins.date_created` and `Web Data`'s `autofill.date_created`) and it is 1601 µs,
whereas `autofill.date_created` is Unix seconds and `logins.date_created` is version-dependent.
Three columns, same name, up to three different epochs. Name-based dispatch is unsafe.

### `insecure_credentials.create_time` — second synthetic-timestamp hazard

`login_database.cc:863-872`:

```cpp
  // Set the create_time value when uninitialized for 'insecure_credentials'.
  if (current_version >= 29 && current_version < 32) {
    sql::Statement set_timestamp;
    set_timestamp.Assign(
        db->GetUniqueStatement("UPDATE insecure_credentials SET create_time = "
                               "? WHERE create_time = 0"));
    set_timestamp.BindTime(0, base::Time::Now());
```

**This is a second synthetic timestamp and it is worse than the `date_password_modified`
one.** For any `insecure_credentials` row that had `create_time = 0` in a DB at version 29,
30 or 31, Chrome stamped **the wall-clock time of the migration** — i.e. the moment the user
first launched the Chrome build that shipped schema v32. That timestamp is evidence of a
**Chrome upgrade**, not of when the credential was found to be compromised/leaked/weak.
The band is narrow (`>= 29 && < 32`) so it only affects DBs that sat at v29-v31.

Note the migration writes `base::Time::Now()` via `BindTime`, i.e. 1601 µs — the write site
itself confirms the column's epoch.

### Version ladder (from `InitializeBuilders`, `login_database.cc:375-594`)

Timestamp-relevant steps only:

- v0/v1: `date_created` created (`INTEGER NOT NULL`).
- v6: `date_synced` added.
- **v8 -> v9: no schema change; version 9 exists only to mark the `date_created` epoch fix.**
- v25: `date_last_used` added, `NOT NULL DEFAULT 0`, replacing `preferred`.
- v26: `logins` table rebuilt via `logins_temp` + `INSERT INTO logins_temp SELECT * from logins`
  (`:614-634`). **Verbatim copy — epochs preserved, no re-serialisation.** Good.
- v29: `insecure_credentials` table created with `create_time INTEGER NOT NULL`.
- v30: `date_password_modified` added.
- v31: `date_synced` dropped.
- v32: `insecure_credentials.create_time == 0` backfilled with migration wall-clock.
- v33: `password_notes` created with its own `date_created INTEGER NOT NULL`.
- v37: `date_received` added.
- v42: `date_last_filled` added.
- v43: current (`kCurrentVersionNumber = 43`, `:80`; `kCompatibleVersionNumber = 40`, `:83`).

### `FixVersionIfNeeded` — meta.version can be WRONG on disk

`login_database.cc:914-950`. Because of crbug.com/295851 some early Login Data files carry a
**wrong `meta.version`**. Chrome repairs it by column sniffing:

```cpp
  if (*current_version == 1) {
    ... if (extra_columns == 2) { *current_version = 2; } ...
  }
  if (*current_version == 2) { if (db->DoesColumnExist("logins", "times_used")) *current_version = 3; }
  if (*current_version == 3) { if (db->DoesColumnExist("logins", "form_data")) *current_version = 4; }
  if (*current_version < 25) {
    if (db->DoesColumnExist("logins", "date_last_used")) { *current_version = 25; }
  }
```

**HIGH-VALUE FINDING for the epoch matrix.** The last clause is the dangerous one: a DB whose
`meta.version` reads e.g. `4` but which has a `date_last_used` column is *actually* at v25,
and its `date_created` is **1601 µs, not Unix seconds** — even though the recorded version is
<= 8. A forensic parser that trusts `meta.version` naively on a corrupted-version Login Data
file will be wrong by 369 years.

**Mitigation a parser must implement:** apply the same `FixVersionIfNeeded` ladder before
choosing the epoch, and additionally magnitude-check `date_created` (10 digits => Unix s,
18 digits => 1601 µs). Note that the pre-existing `SELECT date_created` values themselves are
the cheapest discriminator and Chrome does *not* use them.

## 4. Cookies (`<Profile>/Network/Cookies`) — CONFIRMED

File: `net/extras/sqlite/sqlite_persistent_cookie_store.cc` @ `cb211f6`.

### Current version constants (`:316-317`)

```cpp
const int kCurrentVersionNumber = 24;
const int kCompatibleVersionNumber = 24;
```

### Schema (`CreateV24Schema`, `:662-686`) — four timestamp columns

```sql
CREATE TABLE cookies(
  creation_utc INTEGER NOT NULL,
  ...
  expires_utc INTEGER NOT NULL,
  ...
  last_access_utc INTEGER NOT NULL,
  ...
  last_update_utc INTEGER NOT NULL,
  ...);
```

### Epoch — all four are 1601 µs UTC (in supported versions)

Write site: `Backend::Commit()` `kAdd` branch, `:1344-1379`:

| Column | Param | Write site | Value |
|---|---|---|---|
| `creation_utc` | 0 | `:1344` `add_statement.BindTime(0, po->cc().CreationDate());` | 1601 µs UTC |
| `expires_utc` | 7 | `:1366` `add_statement.BindTime(7, po->cc().ExpiryDate());` | 1601 µs UTC |
| `last_access_utc` | 10 | `:1369` `add_statement.BindTime(10, po->cc().LastAccessDate());` | 1601 µs UTC |
| `last_update_utc` | 17 | `:1379` `add_statement.BindTime(17, po->cc().LastUpdateDate());` | 1601 µs UTC |

`last_access_utc` is additionally rewritten on its own by the
`kUpdateLastAccessTime` op: `:1393` `update_access_statement.BindTime(0, po->cc().LastAccessDate());`
against `"UPDATE cookies SET last_access_utc=? WHERE ..."` (`:1311`).

Read side confirms, `:1067-1070`:

```cpp
        /*creation=*/statement.ColumnTime(0),      //
        /*expiration=*/statement.ColumnTime(6),    //
        /*last_access=*/statement.ColumnTime(9),   //
        /*last_update=*/statement.ColumnTime(17),  //
```

All four are **UTC** (the `_utc` suffix is honest; `base::Time` is epoch-absolute UTC).

### `expires_utc = 0` — session-cookie sentinel, CONFIRMED mechanically

A session cookie has a null `ExpiryDate()`. `BindTime(base::Time())` ->
`TimeToSqlValue(base::Time())` -> `ToDeltaSinceWindowsEpoch().InMicroseconds()` = **0**
(`sql/statement.cc:41-45`). So:

- **`expires_utc == 0` means "session cookie / no expiry", NOT 1601-01-01T00:00:00Z.**
- The same reasoning applies to `last_update_utc == 0` — and the source says so explicitly
  at `:234-236`: *"Version 18 adds one new field: "last_update_utc" (if not 0 this represents
  the last time the cookie was updated)."* So **`last_update_utc == 0` means "never updated /
  predates v18"**, not a date.
- Corroborating structural evidence, `:1370-1371`:
  ```cpp
          add_statement.BindBool(11, po->cc().IsPersistent());  // has_expires
          add_statement.BindBool(12, po->cc().IsPersistent());  // is_persistent
  ```
  Both `has_expires` and `is_persistent` are written from the *same* `IsPersistent()` call, so
  they are always equal, and a row with `has_expires = 0` is a session cookie whose
  `expires_utc` is meaningless.
- Practical rule for a renderer: render `expires_utc` only when `has_expires != 0`; render
  `last_update_utc` only when `!= 0`.

### HIGH-VALUE: Cookies ALSO had a platform-conditional epoch migration (v3 -> v4)

`sqlite_persistent_cookie_store.cc:303-305` @ `cb211f6`, verbatim:

```
// In version 4, we migrated the time epoch.  If you open the DB with an older
// version on Mac or Linux, the times will look wonky, but the file will likely
// be usable. On Windows version 3 and 4 are the same.
```

**This is the same hazard class as History v16 and it was not in the round-1 notes.**

- A Cookies DB at `meta.version <= 3` **originating on Windows** stores 1601 µs.
- A Cookies DB at `meta.version <= 3` **originating on macOS or Linux** stores something
  else — by analogy with History's `MigrateTimeEpoch()` almost certainly **Unix µs** — but I
  did **not** read the v4 migration body (it no longer exists in `cb211f6`; v4 is listed as
  unsupported and dates to 2009/09/01). **The pre-v4 non-Windows encoding is UNRESOLVED**
  (V-7). Do not assert Unix µs from the analogy alone.
- From v4 onward `meta.version` IS a sufficient discriminator on all platforms.
- **Practical impact is near-zero**: v4 landed 2009/09/01 (`:206`
  `// Version 4  - 2009/09/01 - https://codereview.chromium.org/183021`), and modern Chrome
  razes anything below v23 (see below). But it must be in the matrix as a known boundary so a
  parser does not silently misdate a 2009-era artefact.

### Version history, dated, straight from the source comment block (`:181-207`)

Supported:

| Version | Date | CL |
|---|---|---|
| 24 | 2024/08/15 | https://crrev.com/c/5792044 |
| 23 | 2024/04/10 | https://crrev.com/c/5169630 |

Unsupported (`:190-207`), timestamp-relevant ones bolded in the notes below:

| Version | Date | CL |
|---|---|---|
| 22 | 2024/03/22 | https://crrev.com/c/5378176 |
| 21 | 2023/11/22 | https://crrev.com/c/5049032 |
| 20 | 2023/11/14 | https://crrev.com/c/5030577 |
| **19** | **2023/09/22** | https://crrev.com/c/4704672 |
| **18** | **2022/04/19** | https://crrev.com/c/3594203 |
| 17 | 2022/01/25 | https://crrev.com/c/3416230 |
| 16 | 2021/09/10 | https://crrev.com/c/3152897 |
| 15 | 2021/07/01 | https://crrev.com/c/3001822 |
| 14 | 2021/02/23 | https://crrev.com/c/2036899 |
| 13 | 2020/10/28 | https://crrev.com/c/2505468 |
| 12 | 2019/11/20 | https://crrev.com/c/1898301 |
| 11 | 2019/04/17 | https://crrev.com/c/1570416 |
| 10 | 2018/02/13 | https://crrev.com/c/906675 |
| 9 | 2015/04/17 | https://codereview.chromium.org/1083623003 |
| 8 | 2015/02/23 | https://codereview.chromium.org/876973003 |
| 7 | 2013/12/16 | https://codereview.chromium.org/24734007 |
| 6 | 2013/04/23 | https://codereview.chromium.org/14208017 |
| 5 | 2011/12/05 | https://codereview.chromium.org/8533013 |
| **4** | **2009/09/01** | https://codereview.chromium.org/183021 |

(These dates are CL landing dates, not stable-milestone dates. They are still a far better
anchor than a guess and they come straight from the file.)

### Timestamp-relevant version boundaries — RESOLVED

**`last_update_utc` added at Cookies `meta.version = 18`, CL landed 2022/04/19**
(semantics at `:234-236`: *"Version 18 adds one new field: "last_update_utc" (if not 0 this
represents the last time the cookie was updated). This is distinct from creation_utc which is
carried forward when cookies are updated."*; date from the dated list entry
`// Version 18 - 2022/04/19 - https://crrev.com/c/3594203` at `:195`).
The round-1 lead "~M101, 2022" is **consistent** with the CL date; the *milestone* number
itself remains UNRESOLVED (V-8) but the `meta.version` boundary is now pinned at **18**.

Forensic reading of `last_update_utc` vs `creation_utc` (the source states this, `:235-236`):
**`creation_utc` is CARRIED FORWARD when a cookie is updated.** So `creation_utc` is the
first-ever-set time for that (host, name, path) tuple, and `last_update_utc` is the most
recent Set-Cookie. On a DB below v18 there is no way to recover the update time — the
column does not exist. A parser must `PRAGMA table_info(cookies)` / check `meta.version`.

**`expires_utc` values were REWRITTEN at v19 (2023/09/22).** `:230-232`:
*"Version 19 caps expires_utc to no more than 400 days in the future for all stored cookies
with has_expires."* This is a **destructive data migration on a timestamp column** — answering
the round-1 open question "did any cookie migration ever rewrite time values?" with **YES**.
Forensic consequence: in a DB at `meta.version >= 19`, an `expires_utc` sitting exactly ~400
days after the migration instant may be an **artefact of the v19 cap**, not the expiry the
server actually sent. The original server-sent expiry is unrecoverable. Flag any
`expires_utc` clustered at a +400d boundary.

### Only v23 is migratable; everything older is RAZED

`DoMigrateDatabaseSchema()` (`:1121-1203`) contains exactly **one** branch, `if (cur_version == 23)`,
followed by `// Put future migration cases here.` (`:1201`). Combined with
`kCompatibleVersionNumber = 24` and the policy comment at `:184-186`
(*"Versions older than two years should be removed and marked as unsupported. This was last
done in March 2026."*), a Cookies DB below v23 opened by a current Chrome is **discarded, not
upgraded**. Forensically: (a) you will rarely see a live sub-v23 Cookies file; (b) if you do,
it is a copy that was never opened by a modern Chrome, and its `meta.version` is trustworthy;
(c) `kCompatibleVersionNumber = 24` means a v24 file is unreadable by pre-v24 Chrome.

Note also that the v24 migration re-encrypts every `encrypted_value` (prepending a SHA-256 of
the domain) but **does not touch any timestamp column** — verified by reading the whole
branch body `:1124-1200`. Epochs are preserved across 23 -> 24.

### `Extension Cookies`

Same code path (`SQLitePersistentCookieStore`), therefore same schema, same epochs, same
version ladder. Not separately verified at `cb211f6` (V-9) but there is no separate
implementation file.

---

## 5. DIPS / BTM — PARTIAL

On-disk filename is still `DIPS`; the source moved to `content/browser/btm/`.
File read: `content/browser/btm/btm_database.cc` @ `cb211f6`.

### Schema (`BtmDatabase::InitTables`, `:181-222`)

```sql
CREATE TABLE bounces(
  site TEXT PRIMARY KEY NOT NULL,
  first_user_activation_time INTEGER,
  last_user_activation_time INTEGER,
  first_bounce_time INTEGER,
  last_bounce_time INTEGER,
  first_web_authn_assertion_time INTEGER,
  last_web_authn_assertion_time INTEGER)

CREATE TABLE popups(
  opener_site TEXT NOT NULL,
  popup_site TEXT NOT NULL,
  access_id INT64,
  last_popup_time INTEGER,
  is_current_interaction BOOLEAN,
  is_authentication_interaction BOOLEAN,
  PRIMARY KEY (`opener_site`,`popup_site`))

CREATE TABLE config(
  key TEXT NOT NULL,
  int_value INTEGER,
  PRIMARY KEY (`key`))
```

**Correction to the round-1 lead sheet:** the columns are NOT
`first_site_storage_time` / `last_site_storage_time` / `first_stateful_bounce_time` /
`last_stateful_bounce_time`, and there is no `unique_cookies` table. The current `bounces`
schema is the six columns above. (Earlier BTM/DIPS schema versions did have storage-time and
stateful-bounce columns — see V-10; those were consolidated. A parser must not assume the
current column set on an older `DIPS` file.)

### Epoch — 1601 µs UTC

All BTM time values go through `sql::Statement::BindTime` / `ColumnTime`, i.e. **1601 µs UTC**,
full microsecond precision — **NOT** the reduced-precision "1601 seconds" the round-1 sheet
listed as a 50/50 possibility. **That competing hypothesis is REFUTED.** There is no
`InSeconds()` anywhere in `btm_database.cc` (verified by grep over the whole file at `cb211f6`).

Evidence:

- `:82-89` helper:
  ```cpp
  void BindTimesOrNull(sql::Statement& statement, ... ) {
      statement.BindTime(start_param_idx, time->first);
      statement.BindTime(end_param_idx, time->second);
  ```

### Version constants — RESOLVED

`content/browser/btm/btm_database.h:39-45` @ `cb211f6`:

```cpp
  // Version number of the database schema.
  // NOTE: When changing the version, add a new golden file for the new version
  // at `//chrome/test/data/dips/v<N>.sql`.
  static constexpr int kLatestSchemaVersion = 11;

  // The minimum database schema version this Chrome code is compatible with.
  static constexpr int kMinCompatibleSchemaVersion = 11;
```

**`kMinCompatibleSchemaVersion == kLatestSchemaVersion == 11`.** Combined with
`RazeIfIncompatible(..., kNoLowestSupportedVersion, kLatestSchemaVersion)` at
`btm_database.cc:236-238`, current Chrome accepts **only** DIPS schema v11 and **razes**
anything else. So a live `DIPS` file from a current build is always v11 with the schema above.
An acquired `DIPS` file at any other version is a frozen artefact of an older Chrome whose
schema (and possibly column set) differs — see V-10.

Useful side-constant for interpretation: `btm_database.h:54` `kPopupTtl = base::Days(60)` —
`popups` rows are pruned after 60 days (`btm_database.cc:718` binds `clock_->Now() - kPopupTtl`),
so absence of a popup record older than 60 days is expected, not exculpatory.
- `:373-375` — the `bounces` write site, all three time *pairs*:
  ```cpp
    BindTimesOrNull(statement, user_activation_times, 1, 2);
    BindTimesOrNull(statement, bounce_times, 3, 4);
    BindTimesOrNull(statement, web_authn_assertion_times, 5, 6);
  ```
  Param indices 1..6 map onto the six `bounces` time columns in declaration order.
- `:415` — `popups.last_popup_time`: `statement.BindTime(3, popup_time);`
- `:51` — read side: `return statement.ColumnTime(column_index);`

| Table.column | Epoch | Write site (`btm_database.cc` @ `cb211f6`) |
|---|---|---|
| `bounces.first_user_activation_time` | 1601 µs UTC | `:373` via `BindTimesOrNull` `:87` |
| `bounces.last_user_activation_time` | 1601 µs UTC | `:373` via `BindTimesOrNull` `:88` |
| `bounces.first_bounce_time` | 1601 µs UTC | `:374` |
| `bounces.last_bounce_time` | 1601 µs UTC | `:374` |
| `bounces.first_web_authn_assertion_time` | 1601 µs UTC | `:375` |
| `bounces.last_web_authn_assertion_time` | 1601 µs UTC | `:375` |
| `popups.last_popup_time` | 1601 µs UTC | `:415` |
| `config.int_value` | **NOT a timestamp in general** — generic int keyed by `key`; do not date-render | `:210-214` |

**Sentinel: these columns are declared nullable `INTEGER` (no `NOT NULL`) and the writer is
`BindTimesOrNull` — the "OrNull" branch binds SQL NULL, not 0.** So for `bounces` the absent
marker is **NULL**, which is cleaner than the 0-sentinel elsewhere. Still guard against a
literal `0` appearing (it would decode to 1601-01-01) since nothing in the schema forbids it.

### Version handling — razes rather than migrates below the floor

`:236-239`:

```cpp
  if (sql::MetaTable::RazeIfIncompatible(
          db_.get(), sql::MetaTable::kNoLowestSupportedVersion,
          kLatestSchemaVersion) == sql::RazeIfIncompatibleResult::kFailed) {
```

`:251-252` `meta_table_.Init(db_.get(), kLatestSchemaVersion, kMinCompatibleSchemaVersion)`.
Upgrade path `:259-261`: `MigrateBtmSchemaToLatestVersion(*(db_.get()), meta_table_)`.

Both constants are defined in `btm_database.h` and are resolved in the subsection above
(`= 11`). The body of `MigrateBtmSchemaToLatestVersion` lives in a separate migrator TU that I
did **not** read, so **I cannot state whether any BTM migration ever rewrote a timestamp**
(V-10). Given the razing behaviour above, any DIPS file below the floor is destroyed rather
than migrated, which limits the blast radius to files acquired from an older Chrome.

Also note `:144-147`: on error the DB is `RazeAndPoison()`ed — DIPS is self-destructing on
corruption, so absence of a DIPS file is weak evidence of anything.

## 6. Web Data — token / sync tables

### Version constants (for cross-reference with the Web Data agent)

`components/webdata/common/web_database.h` @ `cb211f6`:

- `:35` `static constexpr int kCurrentVersionNumber = 153;`
- `:57` `static constexpr int kDeprecatedVersionNumber = 82;`

`components/webdata/common/web_database.cc:60` @ `cb211f6`:

- `constexpr int kCompatibleVersionNumber = 151;`

`web_database.cc:176-180` razes anything at or below `kDeprecatedVersionNumber` (82):
`RazeIfIncompatible(&db_, /*lowest_supported_version=*/kDeprecatedVersionNumber + 1, kCurrentVersionNumber)`.
So the migratable window for `Web Data` is **83..153**.

### `token_service` — NEGATIVE FINDING: no timestamps at all

`components/signin/public/webdata/token_service_table.cc:100-105` @ `cb211f6`:

```cpp
  if (!db()->DoesTableExist("token_service")) {
    if (!db()->Execute("CREATE TABLE token_service ("
                       "service VARCHAR PRIMARY KEY NOT NULL,"
                       "encrypted_token BLOB,"
                       "binding_key BLOB,"
                       "mtls_token_binding INTEGER)")) {
```

**Four columns, zero timestamp columns.** `mtls_token_binding` is an `INTEGER` but it is a
token-binding **enum/flag, not an epoch** — do not date-render it. This is an explicit
negative claim and it is verified, not inferred.

Its migrations (`token_service_table.cc:113-120`, `:295-310`) are pure `ALTER TABLE ... ADD COLUMN`:

| Web Data version | Change |
|---|---|
| 130 | `ALTER TABLE token_service ADD COLUMN binding_key BLOB` (`:295-300`) |
| 150 | `ALTER TABLE token_service ADD COLUMN mtls_token_binding INTEGER` (`:303-309`) |

Neither touches a timestamp. `token_service` carries **no time evidence**; the only temporal
signal from it is the file mtime, which is out of band.

### `autofill_sync_metadata` / `autofill_data_type_state`

`components/autofill/core/browser/webdata/autofill_sync_metadata_table.cc` @ `cb211f6`,
`:29-30` and `:37`:

```cpp
constexpr std::string_view kAutofillSyncMetadataTable =
    "autofill_sync_metadata";
...
constexpr std::string_view kAutofillDataTypeStateTable = ...
```

These hold **serialised `sync_pb::EntityMetadata` / `sync_pb::DataTypeState` protobufs**
(`:17-18` includes `sync/protocol/entity_metadata.pb.h`, `data_type_state.pb.h`), not
timestamp columns. No `BindTime`/`ColumnTime`/`ToTimeT` anywhere in the file (verified by grep
over all 247 lines). **Epoch of the timestamps *inside* those protos is UNRESOLVED (V-12)** —
out of scope for a column-level matrix, but a parser that cracks the protos must not assume.

### Login Data's sync metadata tables (same shape)

`login_database.cc:490-500` — introduced at **Login Data version 21**:
`passwords_sync_entities_metadata(storage_key PRIMARY KEY, metadata VARCHAR NOT NULL)` and
`passwords_sync_model_metadata(id PRIMARY KEY, model_metadata VARCHAR NOT NULL)`.
**No timestamp columns**; the `metadata` blob is an OSCrypt-encrypted serialised
`sync_pb::EntityMetadata` (`login_database.cc:989-1006` `DecryptAndParseSyncEntityMetadata`).
Same V-12 caveat for the in-proto times.

Also relevant: `login_database.cc:844-850` — `if (current_version >= 21 && current_version < 26)`
calls `ClearAllSyncMetadata(db, syncer::PASSWORDS)`, i.e. **sync metadata is wiped, not
migrated**, for DBs upgrading through that band. Do not treat missing sync metadata in a
v21-v25-origin DB as deliberate deletion by the user.

---

## 7. Version-boundary notes (consolidated)

### Boundaries PINNED by this pass

| Artifact | Column | Boundary | Effect |
|---|---|---|---|
| Login Data | `date_created` | **v8 -> v9** | Unix **seconds** UTC at `meta.version <= 8`; **1601 µs** UTC at `>= 9`. `login_database.cc:822-833` |
| Login Data | `date_last_used` | added at **v25** | absent below; `NOT NULL DEFAULT 0` |
| Login Data | `insecure_credentials.create_time` | table added **v29**; zero-values backfilled with **migration wall-clock** for DBs at v29-v31 | `login_database.cc:863-872` |
| Login Data | `date_password_modified` | added at **v30**; **backfilled `= date_created`** for all DBs opened at `< 30` | `login_database.cc:516-518`, `:853-861` |
| Login Data | `date_synced` | **dropped at v31** | present only in v6..v30 files |
| Login Data | `password_notes.date_created` | table added **v33** | — |
| Login Data | `date_received` | added at **v37** | shared-password metadata |
| Login Data | `date_last_filled` | added at **v42** | `NOT NULL DEFAULT 0` |
| Login Data | current | **v43** / compatible **v40** | `login_database.cc:80,83` |
| Cookies | epoch | **v3 -> v4** (2009/09/01) | **PLATFORM-CONDITIONAL** — see below |
| Cookies | `last_update_utc` | added at **v18** (CL 2022/04/19) | absent below v18 |
| Cookies | `expires_utc` | **values rewritten at v19** (2023/09/22) — capped to +400d | destructive; original expiry unrecoverable |
| Cookies | current | **v24** / compatible **v24**; only v23 is migratable, older is razed | `:316-317`, `:1121-1203` |
| DIPS/BTM | schema | **v11 only** (`kLatest == kMinCompatible == 11`) | anything else razed |
| Web Data | window | current **153**, compatible **151**, deprecated floor **82** | migratable 83..153 |

### Cases where `meta.version` alone does NOT determine the epoch

These are the highest-value rows in this brief.

1. **Cookies at `meta.version <= 3` — platform-conditional.**
   `sqlite_persistent_cookie_store.cc:303-305`: *"In version 4, we migrated the time epoch. If
   you open the DB with an older version on Mac or Linux, the times will look wonky... On
   Windows version 3 and 4 are the same."* Same hazard class as History v16. The originating
   OS is a required input and nothing in the file records it. Practical exposure is tiny (v4
   is from 2009 and modern Chrome razes anything below v23), but it belongs in the matrix.

2. **Login Data with a CORRUPTED `meta.version` — `FixVersionIfNeeded`.**
   `login_database.cc:914-950`. Per crbug.com/295851 some early Login Data files carry a wrong
   `meta.version`; Chrome repairs it by column sniffing, notably:
   ```cpp
     if (*current_version < 25) {
       if (db->DoesColumnExist("logins", "date_last_used")) { *current_version = 25; }
     }
   ```
   A file whose recorded version is `<= 8` but which has a `date_last_used` column is really at
   v25 and its `date_created` is **1601 µs, not Unix seconds**. A parser that trusts
   `meta.version` verbatim will be wrong by 369 years on exactly the files where the epoch
   question matters most. **A parser MUST replicate `FixVersionIfNeeded` and additionally
   magnitude-check `date_created` (10 digits => Unix s; 18 digits => 1601 µs).**

3. **Login Data is otherwise NOT platform-conditional.** There is no `#if BUILDFLAG` around
   the `current_version <= 8` block (`login_database.cc:822-833`). Contrast History v16.
   Worth stating explicitly so the matrix does not over-generalise the History finding.

### Synthetic-timestamp register (values that look like evidence and are not)

| Value | Why synthetic | Source |
|---|---|---|
| `logins.date_password_modified` for any row predating schema v30 | Set to `date_created` by `UPDATE logins SET date_password_modified = date_created` | `login_database.cc:855-857` |
| `insecure_credentials.create_time` for rows that were `0` in a v29-v31 DB | Set to `base::Time::Now()` **at migration time** — evidences a Chrome upgrade, not a compromise discovery | `login_database.cc:863-872` |
| `cookies.expires_utc` at ~+400d in a v>=19 DB | Possibly the v19 cap, not the server-sent expiry | `sqlite_persistent_cookie_store.cc:230-232` |

### Sentinel register (must NOT be rendered as dates)

`BindTime(base::Time())` writes literal `0` (`sql/statement.cc:41-45`), so `0` is the universal
"null/never" marker in these files:

| Column | `0` means |
|---|---|
| `cookies.expires_utc` | **session cookie / no expiry** (cross-check `has_expires`, `sqlite_persistent_cookie_store.cc:1370-1371`) |
| `cookies.last_update_utc` | never updated, or row predates v18 (`:234-236`) |
| `logins.date_last_used` | never used (`DEFAULT 0`, `:488`) |
| `logins.date_password_modified` | unset (`DEFAULT 0`, `:517-518`) |
| `logins.date_last_filled` | never filled (`DEFAULT 0`, `:588`) |
| `insecure_credentials.create_time` | uninitialised (pre-v32 state) |
| `bounces.*_time` (DIPS) | absent marker is **SQL NULL**, not 0 (`BindTimesOrNull`, `btm_database.cc:82-89`) |

---

## 8. UNRESOLVED / verification queue

| ID | Item | Why it matters | How to close |
|---|---|---|---|
| V-1 | ~~`TimeToSqlValue` body~~ | — | **CLOSED** — read at `sql/statement.cc:41-45`: `time.ToDeltaSinceWindowsEpoch().InMicroseconds()` |
| V-2 | **Chrome milestone for Login Data v8 -> v9** | Lets an examiner date-bound an unmigrated file without the DB | `+log` is 401. Bisect: fetch `login_database.cc` at `refs/tags/<release>` for candidate milestones and read `kCurrentVersionNumber`. v9 is very old (pre-M40 era) so start low. |
| V-3 | `logins.date_synced` epoch (v6..v30) | Column is dropped at v31, so no live bind site exists at `cb211f6`; a v6-v30 file on disk still has it | Fetch `login_database.cc` at a tag whose `kCurrentVersionNumber` is 25-30 and read the `date_synced` bind site. Prediction (NOT a claim): 1601 µs, since it postdates the v9 epoch fix. |
| V-4 | ~~`insecure_credentials.create_time` steady-state write site~~ | — | **CLOSED** — `insecure_credentials_table.cc:110-112`, explicit `ToDeltaSinceWindowsEpoch().InMicroseconds()` |
| V-5 | ~~`password_notes.date_created` write site~~ | — | **CLOSED** — `password_notes_table.cc:149` `BindTime`, read at `:46-47` |
| V-6 | ~~`stats.update_time` epoch~~ | — | **CLOSED** — `statistics_table.cc:94` `BindTime` / `:36` `ColumnTime` => 1601 µs. Round-1 "maybe unix-s" REFUTED |
| V-7 | **Cookies pre-v4 non-Windows encoding** | Determines how to read a 2009-era Mac/Linux Cookies file | The v4 migration body no longer exists at `cb211f6`. Fetch `chrome/browser/net/sqlite_persistent_cookie_store.cc` at a ~2009 tag (v4 CL: https://codereview.chromium.org/183021) and read the migration. **Do not assume Unix µs by analogy with History.** |
| V-8 | Chrome **milestone** for Cookies v18 | Round-1 guessed "~M101" | CL date 2022/04/19 is confirmed from source (`:195`). Map CL https://crrev.com/c/3594203 -> SHA -> `chromiumdash.appspot.com/fetch_commit?commit=<SHA>` |
| V-9 | `Extension Cookies` uses the same store | Assumed, not verified | Grep for a second `SQLitePersistentCookieStore` instantiation / `kExtensionCookieFilename` |
| V-10 | **DIPS/BTM schema versions 1..10 column sets and whether any migration rewrote a timestamp** | An acquired `DIPS` file below v11 has a different (possibly storage-time / stateful-bounce) column set | Read `content/browser/btm/btm_database_migrator.cc` (name unverified) for `MigrateBtmSchemaToLatestVersion`, and the golden files at `chrome/test/data/dips/v<N>.sql` (referenced by `btm_database.h:40-41`) — **the golden `.sql` files are the cheapest way to get every historical DIPS schema exactly.** |
| V-11 | ~~DIPS `kLatestSchemaVersion` / `kMinCompatibleSchemaVersion`~~ | — | **CLOSED** — both `= 11`, `btm_database.h:42,45` |
| V-12 | Epoch of timestamps **inside** `sync_pb::EntityMetadata` / `DataTypeState` protos | Only matters if the tool cracks sync protos | Read `components/sync/protocol/entity_metadata.proto` field comments; Chromium sync protos are usually Unix **ms**, NOT 1601 µs — this is a genuine trap and is **unverified** |
| V-13 | Whether `cookies.creation_utc` is ever rewritten (as opposed to carried forward) | Source says it is "carried forward when cookies are updated" (`:235-236`) — confirmed for the store, but `CookieMonster` may construct a fresh cookie with a new creation date on some paths | Read `net/cookies/cookie_monster.cc` `SetCanonicalCookie` for the creation-date-preservation logic |
| V-14 | Login Data milestones for v25 / v30 / v42 | Nice-to-have dating anchors | Same tag-bisection recipe as V-2 |

---

## 9. Source index

All reads at ref **`cb211f647e4138888643a909973b2d07d49ae79c`** (chromium/src `main` at the time
of this pass), fetched via
`https://chromium.googlesource.com/chromium/src/+/cb211f647e4138888643a909973b2d07d49ae79c/<PATH>?format=TEXT`.

| # | Path | Lines actually read | Used for |
|---|---|---|---|
| S-1 | `sql/statement.cc` | 38-45, 300-318, 529-535 | `TimeToSqlValue`, `BindTime`, `ColumnTime` => 1601 µs |
| S-2 | `sql/statement.h` | 63-74 | `TimeToSqlValue` declaration |
| S-3 | `base/time/time.h` | 405-415, 540-550 | `kMicrosecondsPerSecond = 1e6`; `kMicrosecondsFromWindowsToUnixEpoch = 11644473600000000` |
| S-4 | `components/password_manager/core/browser/password_store/login_database.cc` | 80-83, 240-275, 375-596, 604-640, 786-950, 1148-1246, 1486-1520, 1672-1674, 1725-1766 | Login Data version ladder, v8 epoch migration, v30 backfill, `FixVersionIfNeeded`, all bind/read sites |
| S-5 | `.../password_store/insecure_credentials_table.cc` | 28-33, 103-115 | `create_time` epoch (explicit `ToDeltaSinceWindowsEpoch`) |
| S-6 | `.../password_store/password_notes_table.cc` | 44-52, 140-152, 171-185 | `password_notes.date_created` epoch |
| S-7 | `.../password_store/statistics_table.cc` | 36, 53-62, 88-96, 133-146 | `stats` schema and `update_time` epoch |
| S-8 | `net/extras/sqlite/sqlite_persistent_cookie_store.cc` | 180-320, 662-690, 1055-1120, 1121-1203, 1300-1425 | Cookies version constants, dated version history, v3->v4 platform-conditional epoch note, v18/v19 boundaries, schema, all four bind/read sites, migration ladder |
| S-9 | `content/browser/btm/btm_database.cc` | 51, 82-89, 144-147, 181-300, 373-375, 415, 595, 704-718 | DIPS schema, `BindTimesOrNull`, all bind sites, raze behaviour |
| S-10 | `content/browser/btm/btm_database.h` | 30-55 | `kLatestSchemaVersion = 11`, `kMinCompatibleSchemaVersion = 11`, `kPopupTtl` |
| S-11 | `components/webdata/common/web_database.cc` | 60, 176-199, 252 | `kCompatibleVersionNumber = 151`, deprecation/raze window |
| S-12 | `components/webdata/common/web_database.h` | 31-57 | `kCurrentVersionNumber = 153`, `kDeprecatedVersionNumber = 82` |
| S-13 | `components/signin/public/webdata/token_service_table.cc` | 96-120, 285-310 | `token_service` schema (no timestamps), v130 / v150 migrations |
| S-14 | `components/autofill/core/browser/webdata/autofill_sync_metadata_table.cc` | 1-70 (whole file grepped, 247 lines) | proto-blob storage, no timestamp columns |

**Not read (do not cite as verified):** `net/cookies/cookie_monster.cc`,
`net/cookies/canonical_cookie.cc` (`IsPersistent()` semantics were inferred from the store's
own `BindBool(11/12, IsPersistent())` and from `BindTime(base::Time())` == 0, not from
`canonical_cookie.cc` itself), the BTM schema migrator TU, `components/sync/protocol/*.proto`,
and any pre-`cb211f6` release tag.

**Live-source status:** all fetches above succeeded over gitiles `?format=TEXT` at `cb211f6`.
`+log` was not attempted (documented HTTP 401). No milestone/`chromiumdash` lookups were
completed, which is the sole reason V-2, V-8 and V-14 remain open.
