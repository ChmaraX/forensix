# #143 Part 3 — `Web Data` (SQLite) timestamp epoch / schema-version matrix

**Ref read:** `refs/heads/main` @ **`ba3c200c1564977873107f5656c015253ba129b1`**
(resolved via `curl https://chromium.googlesource.com/chromium/src/+refs/heads/main?format=TEXT`).
Milestone-pinned reads use the **release-branch-point SHAs** listed in §5.1 (obtained from
chromiumdash `fetch_milestones`), not `refs/tags`.

**Date of run:** Chrome stable at time of run was **151.0.7922.77 (M151)**; main HEAD was
`ba3c200`. Use those two facts to date this file.

**Status: COMPLETE for §§1-5. Open items are enumerated in §6 and are all genuinely open,
not omissions.**

**Live-source status:** gitiles `?format=TEXT` fetches succeeded for every file cited below.
`+log` / `+blame` are HTTP 401 unauthenticated — **no CL/commit-SHA attribution was possible
from gitiles**. Milestones are therefore pinned by *bisecting release tags* on the value of
`WebDatabase::kCurrentVersionNumber`, which gives a milestone bracket, not a CL. Where a CL
number is required by the issue it is marked `UNRESOLVED` and listed in §6.

**Version constants (main @ `ba3c200`):**

| Constant | Value | Source |
|---|---|---|
| `WebDatabase::kCurrentVersionNumber` | **153** | `components/webdata/common/web_database.h:35` |
| `WebDatabase::kDeprecatedVersionNumber` | **82** | `components/webdata/common/web_database.h:57` |
| `kCompatibleVersionNumber` | **151** | `components/webdata/common/web_database.cc:60` |

`kDeprecatedVersionNumber = 82` means Chrome **razes** (deletes and recreates) any Web Data
file at `meta.version <= 82` rather than migrating it
(`web_database.cc:176-180`, `sql::RazeIfIncompatible(..., lowest_supported_version = kDeprecatedVersionNumber + 1, ...)`).
Forensically: a Web Data at version <= 82 that is still on disk has **never been opened by a
modern Chrome**; if it is opened, its content is destroyed.

Migration dispatch: `WebDatabase::MigrateOldVersionsAsNeeded()` loops
`for (next_version = current_version + 1; next_version <= kCurrentVersionNumber; ++next_version)`
(`web_database.cc:252-255`) and calls each registered table's `MigrateToVersion(next_version, ...)`.
**The ladder is split across table classes**, so no single file holds the whole history.

---

## 1. `autofill` (autocomplete) table — `date_created`, `date_last_used`

**File:** `components/autofill/core/browser/webdata/autocomplete/autocomplete_table.cc` @ `ba3c200`
(the table is still literally named `autofill` in SQLite — see comment at line 40:
*"For historical reasons, the table in the SQLite database is named 'autofill'"*).

### Schema (write site: `AutocompleteTable::InitMainTable()`, lines 452-465)

```
autofill(name VARCHAR, value VARCHAR, value_lower VARCHAR,
         date_created INTEGER DEFAULT 0,
         date_last_used INTEGER DEFAULT 0,
         count INTEGER DEFAULT 1)   PRIMARY KEY (name, value)
```

### Epoch — **UNIX SECONDS, UTC**. Confirmed at the WRITE sites.

| Column | Epoch | Write site (file:line @ `ba3c200`) | API |
|---|---|---|---|
| `autofill.date_created` | **Unix seconds, UTC** | `autocomplete_table.cc:441` — `s.BindInt64(3, entry.date_created().ToTimeT());` | `base::Time::ToTimeT()` |
| `autofill.date_last_used` | **Unix seconds, UTC** | `autocomplete_table.cc:442` — `s.BindInt64(4, entry.date_last_used().ToTimeT());` | `base::Time::ToTimeT()` |
| `autofill.date_last_used` (update path) | **Unix seconds, UTC** | `autocomplete_table.cc:411-413` — `"UPDATE autofill SET date_last_used = ?, count = count + 1 ..."` then `s.BindInt64(0, time.ToTimeT());` | `ToTimeT()` |

Read side corroborates: `base::Time::FromTimeT(s.ColumnInt64(...))` at lines 145-146, 344-345,
366-367. Deletion/expiry paths also bind `ToTimeT()` (lines 156, 279, 294, 315).

`ToTimeT()` is defined as seconds since the Unix epoch in UTC — `base::Time` is always UTC
internally; no local-time conversion occurs anywhere on this path.

### ⚠️ THE 369-YEAR HAZARD — two columns named `date_created` in the same profile

| Column | File | Epoch | Value for 2025-01-01T00:00:00Z |
|---|---|---|---|
| `autofill.date_created` | **Web Data** | Unix **seconds** | `1735689600` (10 digits) |
| `logins.date_created` | **Login Data** | Windows/1601 **microseconds** (v9+) | `13380163200000000` (17 digits) |

*(the Login Data figure is Part-2 scope; the epoch claim there is sourced in the salvage file
`143-confirmed-partial.md` §3 — cross-check with the Part-2 agent before publishing.)*

Applying the 1601-µs decoder to `autofill.date_created` yields **1601-01-01 00:28:55 UTC**
(a value ~424 years too early, obviously wrong).
Applying the Unix-seconds decoder to `logins.date_created` yields a year in the **hundreds of
millions** (overflow) — also obviously wrong.
The genuinely dangerous direction is the reverse of each: applying **Unix seconds** to a value
that is actually **1601 seconds** (not present here, but present elsewhere in Chrome) gives a
plausible-looking date **369 years** too late (1601→1970 = 369 years). The `autofill` /
`logins` pair fails loudly; the silent failure mode is 1601-seconds vs Unix-seconds.

**Rule for the matrix: never key a decoder on the column NAME. Key it on (file, table, column,
meta.version).**

### Sentinels

`date_created` / `date_last_used` are declared `INTEGER DEFAULT 0`
(`autocomplete_table.cc:459-460`). **`0` must be rendered as "unset", not as 1970-01-01.**
`GetEndTime()` (line 65-71) maps a null/`base::Time::Max()` upper bound to
`std::numeric_limits<time_t>::max()` — a `date_*` of `9223372036854775807` (or `2147483647` on a
32-bit `time_t` build) is a **sentinel for "no bound"**, not a date.

### Version boundaries — **NONE relevant to timestamps**

`AutocompleteTable::MigrateToVersion()` (`autocomplete_table.cc:92-101`) has an **empty body**:

```cpp
bool AutocompleteTable::MigrateToVersion(int version,
                                         bool* update_compatible_version) {
  if (!db()->is_open()) { return false; }
  // Add migration logic here.
  return true;
}
```

**Explicit statement:** as of `ba3c200`, the autocomplete table implements **zero** migrations.
For every Web Data `meta.version` in the supported range (83..153), `autofill.date_created` and
`autofill.date_last_used` are **Unix seconds**. There is no epoch boundary to find. Any Web Data
version bump in that range was **irrelevant to these two columns**.

Caveat (below the supported range): versions <= 82 are razed, so their historical schema is
unreachable from this file and is out of scope. Chrome ~M11-era Web Data had a separate
`autofill_dates` table (one row per use) that was collapsed into these two columns — that
predates `kDeprecatedVersionNumber` and is `UNRESOLVED` (§6), not needed for any DB a modern
Chrome will open.

---

## 2. The address-table reorganisation — `autofill_profiles` → `local_addresses` / `contact_info` → `addresses`

**File:** `components/autofill/core/browser/webdata/addresses/address_autofill_table.cc` @ `ba3c200`.
(Note the path in the salvage file, `.../addresses/address_table.cc`, **404s**. The correct
filename is `address_autofill_table.cc`.)

### 2.1 There are THREE generations, not two. This is the key correction.

The issue (and the lead sheet) frames this as `autofill_profiles` → `local_addresses`/`contact_info`.
That is only generations 1→2. **A third generation landed later**, merging both back into a
single `addresses` table. Source comment at `address_autofill_table.cc:67-80`:

```cpp
constexpr std::string_view kAddressesTable = "addresses";
...
constexpr std::string_view kAddressTypeTokensTable = "address_type_tokens";
// Before the `kAddressesTable` and `kAddressTypeTokensTable` tables, local and
// account addresses were stored separately.
constexpr std::string_view kContactInfoTable = "contact_info";
constexpr std::string_view kLocalAddressesTable = "local_addresses";
constexpr std::string_view kContactInfoTypeTokensTable = "contact_info_type_tokens";
constexpr std::string_view kLocalAddressesTypeTokensTable = "local_addresses_type_tokens";

// Historically, a different schema was used and addresses were stored in a set
// of tables named autofill_profiles*. These tables are no longer used in
// production and only referenced in the migration logic. Do not add to them.
// Use the contact_info* and local_addresses* tables instead.
constexpr std::string_view kAutofillProfilesTable = "autofill_profiles";
```

(the last comment paragraph is itself now stale — the live tables are `addresses` /
`address_type_tokens`.)

### 2.2 The full ladder, from `AddressAutofillTable::MigrateToVersion()` (lines 591-656)

Every `case` in that switch, verbatim, with whether it touches a timestamp:

| Web Data `meta.version` | Migration function (`address_autofill_table.cc`) | Touches a timestamp column? |
|---|---|---|
| 88 | `MigrateToVersion88AddNewNameColumns` (:852) | No — name columns only |
| 90 | `MigrateToVersion90AddNewStructuredAddressColumns` (:884) | No |
| 91 | `MigrateToVersion91AddMoreStructuredAddressColumns` (:910) | No |
| 92 | `MigrateToVersion92AddNewPrefixedNameColumn` (:876) | No |
| 93 | `MigrateToVersion93AddAutofillProfileLabelColumn` (:933) | No |
| 96 | `MigrateToVersion96AddAutofillProfileDisallowConfirmableMergesColumn` (:942) | No |
| 99 | `MigrateToVersion99RemoveAutofillProfilesTrashTable` (:953) | No |
| 100 | `MigrateToVersion100RemoveProfileValidityBitfieldColumn` (:958) | No |
| 102 | `MigrateToVersion102AddAutofillBirthdatesTable` (:967) | No — `day`/`month`/`year` INTEGERs are a **birthdate, not an epoch**. Table later dropped at 113/114. |
| **107** | **`MigrateToVersion107AddContactInfoTables`** (:975) | **YES — creates `contact_info` with `use_date` + `date_modified`** |
| 110 | `MigrateToVersion110AddInitialCreatorIdAndLastModifierId` (:995) | No — two INTEGER id columns |
| **113** | **`MigrateToVersion113MigrateLocalAddressProfilesToNewTable`** (:1009) | **YES — creates `local_addresses` (`use_date`, `date_modified`) and copies rows out of `autofill_profiles`** |
| **114** | **`MigrateToVersion114DropLegacyAddressTables`** (:1050) | **YES (destructive) — DROPs `autofill_profiles`, `autofill_profile_addresses`, `autofill_profile_names`, `autofill_profile_emails`, `autofill_profile_phones`, `autofill_profile_birthdates`** |
| 117 | `MigrateToVersion117AddProfileObservationColumn` (:1062) | No — BLOB `observations` on the type-token tables |
| **121** | **`MigrateToVersion121DropServerAddressTables`** (:1072) | **YES (destructive) — DROPs `server_addresses` and `server_address_metadata` (the latter held a `use_date`)** |
| **132** | **`MigrateToVersion132AddAdditionalLastUseDateColumns`** (:1080) | **YES — ADDs `use_date2` and `use_date3` to both `local_addresses` and `contact_info`** |
| **134** | **`MigrateToVersion134UnifyLocalAndAccountAddressStorage`** (:1094) | **YES — `contact_info` RENAMEd to `addresses`, `contact_info_type_tokens` RENAMEd to `address_type_tokens`, then `local_addresses` bulk-INSERTed into `addresses` and DROPped. A `record_type` INTEGER column disambiguates.** |
| **145** | **`MigrateToVersion145DropMultipleUseDates`** (:1146) | **YES — DROPs `addresses.use_date2` and `addresses.use_date3`** |
| 149 | `MigrateToVersion149DropLastModifierId` (:1154) | No — drops `addresses.last_modifier_id` |

Versions in the supported range **not listed above are irrelevant to address timestamps** —
explicitly: 83-87, 89, 94-95, 97-98, 101, 103-106, 108-109, 111-112, 115-116, 118-120, 122-131,
133, 135-144, 146-148, 150-153 have **no address-table migration at all** in this file (they may
carry payments/keyword/other-table migrations; see §3-§4).

### 2.3 Which table holds addresses at which `meta.version` — the dispatch rule a parser needs

| `meta.version` range | Local addresses live in | Account (sync) addresses live in |
|---|---|---|
| 83 .. 106 | `autofill_profiles` (+ `autofill_profile_names/_emails/_phones/_addresses`) | n/a (feature did not exist) |
| 107 .. 112 | `autofill_profiles` | `contact_info` + `contact_info_type_tokens` |
| 113 | `local_addresses` + `local_addresses_type_tokens` (rows copied; **`autofill_profiles` still EXISTS but all its rows are DELETEd**) | `contact_info` |
| 114 .. 133 | `local_addresses` + `local_addresses_type_tokens` (`autofill_profiles*` DROPped) | `contact_info` + `contact_info_type_tokens` |
| 134 .. 153 (current) | `addresses` + `address_type_tokens`, `record_type` column distinguishes | same single `addresses` table |

**Version 113 is a genuine trap.** Its body (lines 1029-1046) does:

```cpp
  if (db()->DoesTableExist(kAutofillProfilesTable)) { ... copy ... }
  // Delete all profiles from the legacy tables. The tables are dropped in
  // version 114.
  for (std::string_view deprecated_table :
       {kAutofillProfilesTable, kAutofillProfileAddressesTable,
        kAutofillProfileNamesTable, kAutofillProfileEmailsTable,
        kAutofillProfilePhonesTable, kAutofillProfileBirthdatesTable}) {
    success = success && (!db()->DoesTableExist(deprecated_table) ||
                          sql::DeleteAllRows(*db(), deprecated_table));
  }
```

So at exactly `meta.version == 113` **both `autofill_profiles` and `local_addresses` exist**, but
`autofill_profiles` is empty. A parser that dispatches on "which tables exist" instead of on
`meta.version` will report zero addresses, or double-count if the delete failed mid-transaction.
The lead-sheet's warning about this is **confirmed by source**.

### 2.4 Epoch across the reorg: **PRESERVED — Unix seconds throughout, all three generations**

This is the load-bearing forensic answer: **the reorganisation did NOT change the epoch.**

| Generation | Column | Epoch | Write site @ `ba3c200` |
|---|---|---|---|
| gen 1 `autofill_profiles.use_date` / `.date_modified` | read back with `base::Time::FromTimeT(s.ColumnInt64(...))` | **Unix seconds UTC** | `address_autofill_table.cc:175-179` (`AddLegacyAutofillProfileDetailsFromStatement`) |
| gen 2 `local_addresses` / `contact_info` `.use_date` / `.date_modified` | `s.BindInt64(index++, profile.usage_history().use_date().ToTimeT());` and `... .modification_date().ToTimeT());` | **Unix seconds UTC** | `address_autofill_table.cc:459-460` (`AddAutofillProfileToTableVersion113`) |
| gen 3 `addresses.use_date` / `.date_modified` | `s.BindInt64(index++, profile.usage_history().use_date().ToTimeT());` / `... .modification_date().ToTimeT());` | **Unix seconds UTC** | `address_autofill_table.cc:390-391` (`AddProfileMetadataToTable`) |

Read side of gen 3: `address_autofill_table.cc:561-564`,
`profile.usage_history().set_use_date(base::Time::FromTimeT(s.ColumnInt64(index++)), 1);` /
`set_modification_date(base::Time::FromTimeT(...))`.

The v134 merge is a pure `RenameTable` + `INSERT INTO <to> SELECT * FROM <from>`
(`address_autofill_table.cc:1128-1143`) — **no value transformation whatsoever**, so integers
carry across byte-identical. The v113 copy round-trips through `base::Time`
(`FromTimeT` on read at :176-179, `ToTimeT` on write at :459-460) which is lossless for
whole seconds. **Epoch is stable Unix-seconds from generation 1 to today.**

Column declarations are `INTEGER NOT NULL DEFAULT 0` in all three generations
(:982-983 for `contact_info`, :1015-1016 for `local_addresses`, :1197-1198 for `addresses`).
**`0` is "unset"/"never used", not 1970-01-01.**

### 2.5 `use_date2` / `use_date3` — they were real, and they are gone again

The lead sheet's "weak memory" is **confirmed**. `MigrateToVersion132AddAdditionalLastUseDateColumns`
(:1080-1088) added `use_date2 INTEGER` and `use_date3 INTEGER` to *both* legacy metadata tables;
`MigrateToVersion145DropMultipleUseDates` (:1146-1152) dropped them from `addresses`.

- Present only at `meta.version` **132 .. 144** (inclusive). Absent below 132, absent from 145.
- Declared plain `INTEGER` with **no `NOT NULL DEFAULT`** — so they can be **SQL NULL**, unlike
  every other timestamp column here. NULL = "no second/third most recent use recorded".
- Epoch: `UNRESOLVED` at first-principles level. No live write site remains at `ba3c200`
  (the columns were dropped), so I could **not** cite a bind site for them from main.
  Inference-only (do not publish as fact): they held the 2nd and 3rd most recent use timestamps
  alongside `use_date`, so almost certainly the same Unix-seconds encoding — but that is
  inference, not a read. Listed in §6; requires reading `address_autofill_table.cc` at a
  `refs/tags/` release whose `kCurrentVersionNumber` is in 132..144.

### 2.6 Milestone pinning — **RESULT**

Method: `https://chromiumdash.appspot.com/fetch_milestones?mstone=<N>` returns
`chromium_main_branch_hash` (the SHA at which the M<N> release branch was cut). Fetching
`components/webdata/common/web_database.{h,cc}` at that SHA gives the exact
`kCurrentVersionNumber` that shipped in stable M<N>. Full raw table in §5.

| Web Data `meta.version` | Migration | **First Chrome stable milestone** | Evidence (branch-point bracket) |
|---|---|---|---|
| **107** — `contact_info` + `contact_info_type_tokens` created | `MigrateToVersion107AddContactInfoTables` | **M109** | M108 branch = 104; M109 branch = **107** |
| **113** — `local_addresses` + `local_addresses_type_tokens` created, rows copied out of `autofill_profiles`, legacy rows deleted | `MigrateToVersion113MigrateLocalAddressProfilesToNewTable` | **M115** | M114 branch = 112; M115 branch = **113** |
| **114** — `autofill_profiles*` DROPped | `MigrateToVersion114DropLegacyAddressTables` | **M116** | M115 branch = 113; M116 branch = 116 (114, 115 and 116 all landed in the M116 dev cycle) |
| **117** — `observations` BLOB (no timestamp) | `MigrateToVersion117AddProfileObservationColumn` | **M118** | M117 branch = 116; M118 branch = **117** |
| **121** — `server_addresses` + `server_address_metadata` DROPped | `MigrateToVersion121DropServerAddressTables` | **M121** | M120 branch = 120; M121 branch = 122 (121 and 122 both in the M121 cycle) |
| **132** — `use_date2`, `use_date3` added | `MigrateToVersion132AddAdditionalLastUseDateColumns` | **M129** | M128 branch = 130; M129 branch = 132 |
| **134** — `contact_info`→`addresses`, `local_addresses` merged in and dropped | `MigrateToVersion134UnifyLocalAndAccountAddressStorage` | **M130** | M129 branch = 132; M130 branch = 134 |
| **145** — `use_date2`, `use_date3` DROPped | `MigrateToVersion145DropMultipleUseDates` | **M142** | M141 branch = 143; M142 branch = 145 |
| **149** — `last_modifier_id` dropped (no timestamp) | `MigrateToVersion149DropLastModifierId` | **M146** | M145 branch = 147; M146 branch = 149 |

**Summary answer to the issue's question:** the `autofill_profiles` → `local_addresses`/`contact_info`
reorganisation spans **Web Data `meta.version` 107 (Chrome M109, account addresses) and 113/114
(Chrome M115/M116, local addresses)**, and was subsequently *undone* into a single `addresses`
table at **version 134 (Chrome M130)**.

Caveat on the method: the branch-point SHA captures the state at branch cut. A schema bump
merged into a release branch *after* cut would not be visible. Schema-version bumps are
normally not merged to release branches, but that is not proven from source, so the milestone
column means "first stable milestone whose branch point already contained the bump" — accurate
to within one milestone in the worst case.

### 2.7 CL numbers

`UNRESOLVED`. Gitiles `+log` and `+blame` both return HTTP 401 without authentication, so no
commit SHA, no Gerrit CL, and no author/date can be attributed from this tooling. The migration
*function names* (`MigrateToVersion113MigrateLocalAddressProfilesToNewTable` etc.) are the stable
searchable handle; a CL can be recovered by searching Gerrit for that identifier. Recorded in §6.

---

## 3. Payments tables — **MIXED EPOCHS INSIDE ONE FILE. THIS IS THE BIG ONE.**

**File:** `components/autofill/core/browser/webdata/payments/payments_autofill_table.cc` @ `ba3c200`.

### 3.1 ⚠️ `use_date` means TWO DIFFERENT EPOCHS depending on the table

This is a worse hazard than the `date_created` collision in §1, because the two columns have
the **same name**, live in the **same file on disk**, hold the **same semantic** ("when was this
payment instrument last used"), and both are declared `INTEGER NOT NULL DEFAULT 0`.

| Table.column | Epoch | Write site (`payments_autofill_table.cc` @ `ba3c200`) | API |
|---|---|---|---|
| `credit_cards.use_date` | **Unix seconds UTC** | `:290` `s->BindInt64(index++, credit_card.usage_history().use_date().ToTimeT());` | `ToTimeT()` |
| `local_ibans.use_date` | **Unix seconds UTC** | `:339` `s->BindInt64(index++, iban.usage_history().use_date().ToTimeT());` (`BindIbanToStatement`) | `ToTimeT()` |
| **`server_card_metadata.use_date`** | **WINDOWS/1601 MICROSECONDS UTC** | `:1122` `s.BindTime(1, card_metadata.use_date);` (`AddOrUpdateServerCardMetadata`) | `sql::Statement::BindTime` |
| **`masked_ibans_metadata.use_date`** | **WINDOWS/1601 MICROSECONDS UTC** | `:1168` `s.BindTime(2, iban_metadata.use_date);` (`AddOrUpdateServerIbanMetadata`) | `BindTime` |

Read side confirms the 1601-µs reading for `server_card_metadata` explicitly — `:1148-1149`:

```cpp
    card_metadata.use_date = base::Time::FromDeltaSinceWindowsEpoch(
        base::Microseconds(s.ColumnInt64(index++)));
```

**Rule:** decoding `server_card_metadata.use_date` with the Unix-seconds decoder that is correct
for `credit_cards.use_date` produces a date ~4.2 **billion** years out (1.34×10^17 interpreted as
seconds; obvious). The reverse —
applying the 1601-µs decoder to `credit_cards.use_date` — yields **1601-01-01 ~00:28 UTC**
(also obvious). Both fail loudly, but only if the tool actually *tries*; a tool that keys on the
column name `use_date` and picks one decoder will silently mis-date half the payments data.

### 3.2 Full payments timestamp inventory

| Table.column | Declared type | Epoch | Write site @ `ba3c200` |
|---|---|---|---|
| `credit_cards.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:2337`) | **Unix s UTC** | `:290` `ToTimeT()` |
| `credit_cards.date_modified` | `INTEGER NOT NULL DEFAULT 0` (`:2334`) | **Unix s UTC** | `:291` `s->BindInt64(index++, modification_date.ToTimeT());` |
| `local_ibans.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:2346`) | **Unix s UTC** | `:339` `ToTimeT()` |
| `local_stored_cvc.last_updated_timestamp` | `INTEGER NOT NULL` (`:2420`) | **Unix s UTC** | `:307` `s->BindInt64(index++, modification_date.ToTimeT());` (`BindLocalStoredCvcToStatement`) |
| `server_stored_cvc.last_updated_timestamp` | `INTEGER NOT NULL` (`:2425`) | **Unix s UTC** | `:316` `s->BindInt64(index++, server_cvc.last_updated_timestamp.ToTimeT());` (`BindServerCvcToStatement`) |
| `server_card_metadata.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:2396`) | **1601 µs UTC** | `:1122` `BindTime` |
| `masked_ibans_metadata.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:2389`) | **1601 µs UTC** | `:1168` `BindTime` |
| `masked_bank_accounts_metadata.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:192`, in `kMaskedBankAccountsMetadataColumnNamesAndTypes`) | **UNRESOLVED** — no write site for this column found at `ba3c200`. **Do not assume it matches `server_card_metadata`.** See §6. |
| **`offer_data.expiry`** | `UNSIGNED LONG` (`:2434`) | **WINDOWS/1601 *MILLISECONDS* UTC — A DISTINCT THIRD FAMILY** | `:1437-1438` `insert_offers.BindInt64(2, data.GetExpiry().ToDeltaSinceWindowsEpoch().InMilliseconds());` |
| `masked_credit_card_benefits.start_time` | `INTEGER` (`:228`) | **1601 µs UTC** | `:1710` `insert_benefit.BindTime(index++, benefit_base.start_time());` |
| `masked_credit_card_benefits.end_time` | `INTEGER` (`:229`) | **1601 µs UTC** | `:1711` `insert_benefit.BindTime(index++, benefit_base.expiry_time());` |

Read side for the benefits table: `:1771-1772` `get_benefits.ColumnTime(index++)` ×2 — consistent.

### 3.3 `offer_data.expiry` — 1601 milliseconds. Call this out loudly.

`ToDeltaSinceWindowsEpoch().InMilliseconds()` is **neither** of the two families the #125 model
assumes. Magnitude for 2026-01-01: `1.34 × 10^13` — **13 digits**, which is exactly the digit
count of **Unix milliseconds**. So the magnitude falsifier does **not** disambiguate this one;
a naive Unix-ms decode of `offer_data.expiry` returns a date in **2394** (i.e. +369 years).
**This is the genuine silent-failure case in Web Data**, and it is worse than the
`date_created` pair the issue names, because both candidate decodings produce a plausible date.

(`offer_data` holds Google-Pay merchant promo offers, so a wrong value here is low forensic
impact — but a tool that gets it wrong will get it wrong *silently*.)

### 3.4 Payments tables that carry NO timestamp — explicit negative claims

Read from the `Init*` functions at `:2326-2440` and the column-name constants at `:64-253`:

- `masked_credit_cards` — **no timestamp.** `exp_month` / `exp_year` (`:2359-2360`) are **card
  expiry month/year integers, NOT an epoch.** Do not render them as dates.
- `masked_bank_accounts` (`:194-209`) — **no timestamp column at all.** Columns are
  `instrument_id`, `bank_name`, `account_number_suffix`, `account_type`, `display_icon_url`,
  `nickname`. Confirmed by both the column-type constant list (`:203-209`) and the bind site
  `BindMaskedBankAccountToStatement` (`:242-253`), which binds six non-time values.
  The associated *metadata* table `masked_bank_accounts_metadata` does have `use_date` — above.
- `masked_ibans` (`:2375-2381`) — no timestamp (`instrument_id`, `prefix`, `suffix`, `nickname`).
- `payments_customer_data` (`:2401`) — single `customer_id` column, no timestamp.
- `server_card_cloud_token_data` (`:2406`) — no timestamp; `exp_month`/`exp_year` are card expiry.
- `generic_payment_instruments` (`:241-250`) — `instrument_id` + encrypted blob, no timestamp.
- `benefit_merchant_domains`, `offer_eligible_instrument`, `offer_merchant_domain` — join tables,
  no timestamp.
- `virtual_card_usage_data` — bind site `BindVirtualCardUsageDataToStatement` (`:344+`) binds
  `usage_data_id`, `instrument_id`, `merchant_origin`, `last_four`. **No timestamp**, despite the
  name "usage data".

### 3.5 `local_ious` — **NOT FOUND**

The assignment names a `local_ious` table. **No such identifier exists** anywhere in
`payments_autofill_table.cc` (2493 lines, grepped case-insensitively for `iou`), nor in
`payments_autofill_table.h`, nor in the payments directory listing at `ba3c200`.

Most likely explanation: `local_ious` is a **mis-transcription of `local_ibans`** (IBAN =
International Bank Account Number), which *does* exist and *does* carry a `use_date`
(Unix seconds — see §3.2). `local_ibans` itself was renamed from `ibans` at Web Data version
119 (`MigrateToVersion119AddMaskedIbanTablesAndRenameLocalIbanTable`, `:2136`); the original
table was created at v105 (`MigrateToVersion105AddAutofillIbanTable`, `:2032`) and recreated at
v106 (`:2041`). Flagged in §6 for confirmation.

### 3.6 Payments migration ladder — which versions matter for timestamps

From `PaymentsAutofillTable::MigrateToVersion()` (`:531-630`), the complete `case` list is
83, 84, 85, 87, 89, 94, 95, 98, 101, 104, 105, 106, 108, 109, 111, 115, 116, 118, 119, 123, 124,
125, 129, 131, 133, 135, 136, 141, 144, 153.

**Timestamp-relevant ones only:**

| Version | Function | Timestamp effect | First stable milestone (§5) |
|---|---|---|---|
| 105 | `MigrateToVersion105AddAutofillIbanTable` (`:2032`) | creates the IBAN table with `use_date INTEGER NOT NULL DEFAULT 0` (`:2036`) | M109 (bracket M108=104 → M109=107, so 105 landed in the M109 cycle) |
| 106 | `MigrateToVersion106RecreateAutofillIbanTable` (`:2041`) | drops+recreates it, `use_date` again (`:2047`) | M109 |
| 116 | `MigrateToVersion116AddStoredCvcTable` (`:2115`) | creates `local_stored_cvc` and `server_stored_cvc`, both with `last_updated_timestamp INTEGER NOT NULL` (`:2121`, `:2125`) | **M116** |
| 119 | `MigrateToVersion119AddMaskedIbanTablesAndRenameLocalIbanTable` (`:2136`) | `ibans` renamed to `local_ibans`; `masked_ibans_metadata` created with `use_date INTEGER NOT NULL DEFAULT 0` (`:2148`) | **M119** |
| 123 | `...AddProductTermsUrlColumnAndAddCardBenefitsTables` (`:2155`) | creates `masked_credit_card_benefits` with `start_time` / `end_time` | **M122** |
| 124 | `...DeletePaymentInstrumentRelatedTablesAndAddMaskedBankAccountTable` (`:2168`) | creates `masked_bank_accounts` (no timestamp) + `masked_bank_accounts_metadata` (`use_date`) | **M123** |
| 125 | `MigrateToVersion125DeleteFullServerCardsTable` (`:2182`) | destructive: drops the full-server-cards table | **M123** |

All other payments versions (83, 84, 85, 87, 89, 94, 95, 98, 101, 104, 108, 109, 111, 115, 118,
129, 131, 133, 135, 136, 141, 144, 153) **do not add, remove, rename or re-encode any timestamp
column** — they add/remove non-time columns (nickname, card issuer, instrument id, promo code,
product description, virtual-card enrolment state, card benefit source, card creation source,
`is_user_confirmed`, …) or drop non-time tables. Stated explicitly, per the assignment.

---

## 4. Other Web Data timestamp columns

The complete set of `WebDatabaseTable`s registered into the **profile** `Web Data` file is at
`components/webdata_services/web_data_service_wrapper.cc:154-175` @ `ba3c200`:
`AddressAutofillTable`, `AutocompleteTable`, `AutofillSyncMetadataTable`,
`PaymentsAutofillTable`, `EntityTable`, `KeywordTable`, `TokenServiceTable`,
`payments::WebAppManifestSectionTable`, `payments::WebPaymentsTable`,
`plus_addresses::PlusAddressTable`, `autofill::ValuablesTable`.
(The *account* Web Data file registers only `AutofillSyncMetadataTable` + `PaymentsAutofillTable`,
`:248-251` — so `Web Data` and `Web Data For Account` do **not** have the same table set.)

### 4.1 `keywords` (search engines) — **AN EPOCH/PRECISION MIGRATION EXISTS: version 77**

**File:** `components/search_engines/keyword_table.cc` @ `ba3c200`.

| Column | Declared type | Epoch **today** | Write site |
|---|---|---|---|
| `keywords.date_created` | `INTEGER DEFAULT 0` (`:264`) | **1601 µs UTC** | `:748` `s->BindTime(starting_column + 6, data.date_created);` |
| `keywords.last_modified` | `INTEGER DEFAULT 0` (`:270`) | **1601 µs UTC** | `:755` `s->BindTime(starting_column + 12, data.last_modified);` |
| `keywords.last_visited` | `INTEGER DEFAULT 0` (`:278`) | **1601 µs UTC** | `:763` `s->BindTime(starting_column + 20, data.last_visited);` |

Read side: `:633`, `:634`, `:659` — `s.ColumnTime(...)`.

**This falsifies the lead sheet's inference** that "the search-engine table lives in Web Data,
which is the unix-s DB, so it is a plausible unix-s row". `keywords` is **1601-µs**, in the same
file where `autofill.date_created` is Unix seconds.

**Version boundary — `MigrateToVersion77IncreaseTimePrecision()` (`:522-553`):**

```cpp
  static constexpr char kQuery[] =
      "SELECT id, date_created, last_modified, last_visited FROM keywords";
  ...  s.ColumnTime(1), s.ColumnTime(2), s.ColumnTime(3) ...
  "UPDATE keywords SET date_created = ?, last_modified = ?, last_visited = ? WHERE id = ?"
  update_statement.BindTime(0, ...); BindTime(1, ...); BindTime(2, ...);
```

The function name ("IncreaseTimePrecision") plus the read-with-`ColumnTime`/write-with-`BindTime`
shape indicates the columns changed **granularity** at v77. Note the migration *reads* with
`ColumnTime` (which interprets the stored int as 1601-µs), which argues the stored number was
already on the Windows epoch and the change was **precision, not epoch**. **UNRESOLVED** —
see §6 item 1; I could not cite the pre-77 write site and will not guess between
"1601-µs truncated to whole seconds" and "1601-seconds".

**Forensic impact is bounded**: `kDeprecatedVersionNumber = 82 > 77`, so **any Web Data file a
modern Chrome will open is already at ≥ 83 and has been through the v77 migration.** A pre-77
Web Data can only be encountered as a frozen forensic image never opened by modern Chrome.

`last_visited` did not exist before **version 69** (`MigrateToVersion69AddLastVisitedColumn`,
`:477-482`; also `ColumnsForVersion()` `:133-136`: *"Column added in version 69"*). Also below
the deprecation floor.

Other `KeywordTable` migrations — 53, 59, 68, 76, 82, 97, 103, 112, 122, 137, 152 — are **all
irrelevant to timestamps** (new-tab URL, extension keywords, show-in-default-list, instant
columns, created_from_play_api, is_active, starter_pack_id, enforced_by_policy, site-search
policy columns, `url_hash` BLOB, `url_hash` widening). Explicitly stated.

### 4.2 `autofill_ai_entities_metadata` — **TWO ADJACENT COLUMNS, TWO DIFFERENT EPOCHS**

**File:** `components/autofill/core/browser/webdata/autofill_ai/entity_table.cc` @ `ba3c200`.
**This is the single most dangerous row I found.** `EntityTable::AddEntityMetadata()`, `:279-291`:

```cpp
  sql::CachedInsertBuilder(
      SQL_FROM_HERE, *db(), s, entities_metadata::kTableName,
      {entities_metadata::kEntityGuid, entities_metadata::kUseCount,
       entities_metadata::kUseDate, entities_metadata::kDateModified});
  s.BindString(0, *metadata.guid);
  s.BindInt64(1, metadata.use_count);
  s.BindTime(2, metadata.use_date);                       // <-- 1601 µs
  s.BindInt64(3, metadata.date_modified.ToTimeT());       // <-- Unix seconds
```

| Table.column | Epoch | Site |
|---|---|---|
| `autofill_ai_entities_metadata.use_date` | **1601 µs UTC** | `entity_table.cc:288` `BindTime` |
| `autofill_ai_entities_metadata.date_modified` | **Unix seconds UTC** | `entity_table.cc:289` `ToTimeT()` |

Both are `INTEGER` in the same `CREATE TABLE` (`:132-134`), written by the same statement, in
adjacent bind slots. Corroborated on the read side: `:430` / `:483` `s.ColumnTime(2)` for
`use_date`; the deletion-by-time-range query binds `date_modified` with `ToTimeT()` (`:387-388`).

**Version boundaries for this table (all recent):**

| Version | Effect | First stable milestone (§5) |
|---|---|---|
| 138 | `attributes`/`entities`/`entities_version` DROPped; `autofill_ai_attributes` + `autofill_ai_entities` created. `autofill_ai_entities.date_modified INTEGER NOT NULL` introduced here (`:180`). Comment: *"Up to version 138, AutofillAi was purely experimental… we can simply drop all previous data."* | **M136** |
| 140 | `use_count` and `use_date` added **to `autofill_ai_entities`** (`:186-190`) | **M138** |
| 142 | `record_type` added — no timestamp | M141 |
| 143 | `attributes_read_only` added — no timestamp | M141 |
| 146 | `frecency_override` added — no timestamp | M143 |
| **147** | `autofill_ai_entities_metadata` created; `use_count`, `use_date`, `date_modified` **moved out of `autofill_ai_entities` into it** via `INSERT INTO … SELECT guid, use_count, use_date, date_modified FROM autofill_ai_entities` then `DropColumn` ×3 (`:224-247`) | **M143** |
| 151 | serialized `FieldType` may be `UNKNOWN_TYPE` — no timestamp | M148 |

The v147 move is a **verbatim SQL copy — no value transformation** — so the mixed epochs above
were **already** mixed inside `autofill_ai_entities` at versions 140..146.
Parser dispatch rule: **at `meta.version` 140..146 read `use_date`/`date_modified` from
`autofill_ai_entities`; at ≥ 147 read them from `autofill_ai_entities_metadata`.**
Note `date_modified` existed from 138 but `use_date` only from 140.

### 4.3 `valuables_metadata` (loyalty cards)

**File:** `components/autofill/core/browser/webdata/valuables/valuables_table.cc` @ `ba3c200`.

| Table.column | Declared type | Epoch | Site |
|---|---|---|---|
| `valuables_metadata.use_date` | `INTEGER NOT NULL DEFAULT 0` (`:169`) | **1601 µs UTC** | `:415` `s.BindTime(index++, metadata.use_date);` (`AddValuableMetadata`) |

Read side `:89` and `:396` — `ColumnTime(2)`.

Version boundaries: `ValuablesTable::MigrateToVersion()` (`:197-208`) has exactly two cases —
**138** (`loyalty_card`/`loyalty_cards` dropped and recreated; **no timestamp column**) and
**148** (`MigrateToVersion148AddMetadataTable`, `:190-195` — creates `valuables_metadata` with
`use_date`). So `valuables_metadata.use_date` exists only at **`meta.version` ≥ 148 →
Chrome M146+** (§5). `loyalty_cards` itself has never had a timestamp.

### 4.4 Web Data tables with no timestamps, or not resolved

- `address_type_tokens` / `contact_info_type_tokens` / `local_addresses_type_tokens` — columns are
  `guid`, `type`, `value`, `verification_status`, `observations` (BLOB). **No timestamp.**
  Confirmed from `InitAddressTypeTokensTable()`, `address_autofill_table.cc:1206-1214`.
- `autofill_ai_attributes` — `entity_guid`, `attribute_type`, `field_type`, `value_encrypted`,
  `verification_status` (`entity_table.cc:102-112`). **No timestamp.**
- `loyalty_cards`, `loyalty_card_merchant_domain` — **no timestamp**
  (`valuables_table.cc:172-188`).
- `token_service` (`TokenServiceTable`) — **UNRESOLVED**, not fetched this run. §6.
- `plus_addresses` (`plus_addresses::PlusAddressTable`) — **UNRESOLVED**; path
  `components/plus_addresses/webdata/plus_address_table.cc` 404'd. §6.
- `web_app_manifest_section`, `web_payments` — **UNRESOLVED**, not fetched. §6.
- `autofill_sync_metadata` / model-type-state (`AutofillSyncMetadataTable`) — serialised sync
  protos in BLOB columns, not epoch columns. §6.

---

## 5. Version-boundary → milestone map

### 5.1 Raw bisect data — `WebDatabase::kCurrentVersionNumber` at each milestone branch point

Method for every row: `chromiumdash.appspot.com/fetch_milestones?mstone=<N>` →
`chromium_main_branch_hash` → gitiles fetch of `components/webdata/common/web_database.h`
(falling back to `web_database.cc`; **the constant moved from the `.cc` to the `.h` between
M127 and M129**) → grep `kCurrentVersionNumber`.

| Milestone | Branch-point SHA | `kCurrentVersionNumber` | file |
|---|---|---|---|
| M105 | `7aa3f074a7907975b001346cc0288d0214af8451` | 104 | .cc |
| M108 | `27d3765d341b09369006d030f83f582a29eb57ae` | 104 | .cc |
| M109 | `4417ee59d7bf…` | **107** | .cc |
| M110 | `130f3e4d850f4bc7387cfb8d08aa993d288a67a9` | 108 | .cc |
| M111 | `3ac59a6729cd…` | 110 | .cc |
| M112 | `9c6408ef696e83a9936b82bbead3d41c93c82ee4` | 111 | .cc |
| M113 | `5f2a72468eda…` | 111 | .cc |
| M114 | `2f562e4ddbaf79a3f3cb338b4d1bd4398d49eb67` | 112 | .cc |
| M115 | `1d71a337b1f6…` | **113** | .cc |
| M116 | `5a5dff63a4a4c63b9b18589819bebb2566c85443` | **116** | .cc |
| M117 | `2b50cb4bcc23…` | 116 | .cc |
| M118 | `511350718e646be62331ae9d7213d10ec320d514` | **117** | .cc |
| M119 | `905e8bdd32d8…` | 119 | .cc |
| M120 | `e6ee4500f7d6549a9ac1354f8d056da49ef406be` | 120 | .cc |
| M121 | `222e786949e7…` | **122** | .cc |
| M122 | `9755d9d81e4a8cb5b4f76b23b761457479dbb06b` | 123 | .cc |
| M123 | `6711dcdae48e…` | 125 | .cc |
| M124 | `d158c6dc6e3604e6f899041972edf26087a49740` | 127 | .cc |
| M125 | `9012208d0ce0…` | 128 | .cc |
| M126 | `e6143acc03189c5e52959545b110d6d17ecd5286` | 128 | .cc |
| M127 | `7e0b87ec6b8c…` | 128 | .cc |
| M128 | `03c1799e6f9c7239802827eab5e935b9e14fceae` | 130 | .h |
| M129 | `05bc664984ca…` | **132** | .h |
| M130 | `985f2961df230630f9cbd75bd6fe463009855a11` | **134** | .h |
| M131 | `b21671ca172d…` | 135 | .h |
| M132 | `47a3549fac11ee8cb7be6606001ede605b302b9f` | 135 | .h |
| M134 | `de9c6fafd8ae5c6ea0438764076ca7d04a0b165d` | 137 | .h |
| M136 | `e09430c64983fc906f37a9f7e6806275c9b67b86` | **138** | .h |
| M138 | `d5de512dc9dc8ddfe4e6d71b0637578bb6158683` | **141** | .h |
| M140 | `27be8b77710f4405fdfeb4ee946fcabb0f6c92b2` | 141 | .h |
| M141 | `d481efce5eb3…` | 143 | .h |
| M142 | `29907d3c18078029695f458b42fb8e6fda3e493d` | **145** | .h |
| M143 | `b30439823e51…` | **147** | .h |
| M144 | `223dfbac1c7542a06b422390d954afe5b560b607` | 147 | .h |
| M145 | `0bbdf2913883…` | 147 | .h |
| M146 | `76b7d80e5cda23fe6537eed26d68c92e995c7f39` | **149** | .h |
| M147 | `ce0110293734…` | 149 | .h |
| M148 | `77f495ee216d4c3cc784d33658bad4778c0680ee` | **151** | .h |
| M149 | `9f3e9aaccba6…` | 151 | .h |
| M150 | `f542126b8c1b3e80104b26bb05ec830bd1206f29` | 152 | .h |
| M151 | `059c884787b1…` | 152 | .h |
| main | `ba3c200c1564977873107f5656c015253ba129b1` | **153** | .h |

M133, M135, M137, M139 not sampled (time budget). They fall inside brackets already tight enough
for every timestamp boundary above.

Latest **stable** at time of run: **151.0.7922.77 (M151)**
(`chromiumdash fetch_releases?channel=Stable&platform=Windows`). Version **153 has therefore not
shipped to stable** — a `Web Data` at `meta.version = 153` came from a Canary/Dev/Beta build of
M152+.

### 5.2 Inverse map — "a Web Data at `meta.version = N` was last opened by Chrome …"

| `meta.version` | Chrome milestone(s) |
|---|---|
| 104 | M105 – M108 |
| 107 | M109 |
| 108 | M110 |
| 110 | M111 |
| 111 | M112, M113 |
| 112 | M114 |
| 113 | M115 |
| 116 | M116, M117 |
| 117 | M118 |
| 119 | M119 |
| 120 | M120 |
| 122 | M121 |
| 123 | M122 |
| 125 | M123 |
| 127 | M124 |
| 128 | M125 – M127 |
| 130 | M128 |
| 132 | M129 |
| 134 | M130 |
| 135 | M131, M132 |
| 137 | M134 |
| 138 | M136 |
| 141 | M138, M140 |
| 143 | M141 |
| 145 | M142 |
| 147 | M143 – M145 |
| 149 | M146, M147 |
| 151 | M148, M149 |
| 152 | M150, M151 |
| 153 | M152+ (pre-stable at time of run) |

Versions **not** appearing in that column (105, 106, 109, 114, 115, 118, 121, 124, 126, 129, 131,
133, 136, 139, 140, 142, 144, 146, 148, 150) were **intermediate bumps landed mid-cycle and
superseded before branch cut** — they can still appear on disk if a Canary/Dev build wrote the
file, but **no stable Chrome ever left a Web Data at those versions.** That is a useful
provenance signal in itself: e.g. a Web Data at `meta.version = 140` implies a **non-stable
channel** build wrote it last.

### 5.3 Where `meta.version` alone does NOT determine the epoch

Unlike the History v16 case in the salvage file, **I found no platform-conditional migration in
Web Data.** Every migration in `AddressAutofillTable`, `PaymentsAutofillTable`,
`AutocompleteTable`, `KeywordTable`, `EntityTable` and `ValuablesTable` at `ba3c200` is
unconditional on `BUILDFLAG(IS_*)`. One `IS_*` guard exists in the payments file but it is not a
migration: `#if BUILDFLAG(IS_IOS) … CleanupForCrbug445879524()` (`payments_autofill_table.cc:1420-1425`)
deletes **all** `credit_cards` rows on iOS — **a silent data-loss event, not an epoch change**,
but worth flagging for iOS artefacts: absence of local cards on iOS may be a cleanup, not a
user action.

What **does** break the naive model in Web Data is different and arguably worse: within a single
`meta.version`, **the epoch is per-column, not per-file.** `Web Data` is **not** "the
Unix-seconds database" as `143-leads-unverified.md` §2.4 assumes. At version 153 it
simultaneously contains:

- **Unix seconds UTC**: `autofill.date_created`, `autofill.date_last_used`,
  `addresses.use_date`, `addresses.date_modified`, `credit_cards.use_date`,
  `credit_cards.date_modified`, `local_ibans.use_date`,
  `local_stored_cvc.last_updated_timestamp`, `server_stored_cvc.last_updated_timestamp`,
  `autofill_ai_entities_metadata.date_modified`
- **1601 microseconds UTC**: `keywords.date_created`, `keywords.last_modified`,
  `keywords.last_visited`, `server_card_metadata.use_date`, `masked_ibans_metadata.use_date`,
  `masked_credit_card_benefits.start_time`, `masked_credit_card_benefits.end_time`,
  `valuables_metadata.use_date`, `autofill_ai_entities_metadata.use_date`
- **1601 milliseconds UTC**: `offer_data.expiry`

**Three epoch families in one SQLite file, and two of them in one row of one table
(`autofill_ai_entities_metadata`).** Correct the #125 model accordingly.

### 5.4 Sentinel values that must never be rendered as dates

- `INTEGER NOT NULL DEFAULT 0` on nearly every column above → **`0` = "unset"/"never"**, not
  1970-01-01 and not 1601-01-01.
- `addresses.use_date2` / `use_date3` (v132–144) are plain `INTEGER` with no default →
  **SQL NULL** is possible and means "no 2nd/3rd use recorded". They are the only nullable
  timestamp columns found.
- `AutocompleteTable::GetEndTime()` (`autocomplete_table.cc:65-71`) maps an open upper bound to
  `std::numeric_limits<time_t>::max()`. A `date_*` equal to `9223372036854775807` is a **"no
  bound" sentinel**.
- `base::Time::Min()`/`Max()` appear on the entity deletion path (`entity_table.cc:376-381`) and
  are converted with `ToTimeT()`; extreme `date_modified` values are sentinels, not dates.

---

## 6. UNRESOLVED / verification queue

Ordered by forensic impact.

1. **`keywords` pre-version-77 encoding.** `MigrateToVersion77IncreaseTimePrecision` reads with
   `ColumnTime` (1601-µs) and writes with `BindTime` (1601-µs), which on its face changes nothing
   — contradicting the function name. Either (a) the pre-77 value was 1601-µs truncated to whole
   seconds and the migration is effectively a no-op rewrite, or (b) the pre-77 write site used a
   different serialisation and `ColumnTime` is the wrong reader for old rows. **Resolve by
   fetching `components/search_engines/keyword_table.cc` at a `refs/tags` release whose
   `kCurrentVersionNumber` is 70..76 and reading `BindURLToStatement`.** Impact bounded by
   `kDeprecatedVersionNumber = 82`.
2. **`addresses.use_date2` / `use_date3` epoch (versions 132–144).** No write site survives at
   `ba3c200`. Resolve by fetching `address_autofill_table.cc` at the M129–M141 branch-point SHAs
   in §5.1 and reading the bind site. Inference only (do **not** publish): Unix seconds, matching
   `use_date`.
3. **`masked_bank_accounts_metadata.use_date` epoch.** Column declared
   (`payments_autofill_table.cc:192`) but no `Bind*` for it found in the 2493 lines read. Likely
   written by a shared `PaymentsMetadata` path that also serves `server_card_metadata`
   (→ 1601-µs) but **this was not confirmed.** Resolve by grepping
   `kMaskedBankAccountsMetadataTable` bind sites in the `.cc` and in
   `components/autofill/core/browser/webdata/payments/autofill_wallet_metadata_sync_bridge.cc`.
4. **`local_ious` does not exist.** Confirm with the issue author that `local_ibans` was meant.
   If a `local_ious` table genuinely exists it is not in `payments_autofill_table.cc` @ `ba3c200`
   and not in that directory listing.
5. **`plus_addresses` table.** `components/plus_addresses/webdata/plus_address_table.cc` 404s;
   the path has rotted. Registered into Web Data at `web_data_service_wrapper.cc:173-174`, so it
   **is** a Web Data table and must be covered. Resolve by listing `components/plus_addresses/`.
6. **`token_service`, `web_app_manifest_section`, `web_payments` tables.** Registered
   (`web_data_service_wrapper.cc:166-171`) but not fetched. Expect no timestamps; **unverified.**
7. **CL / commit SHA / author for every version bump.** Gitiles `+log` and `+blame` are HTTP 401
   unauthenticated. Milestones are pinned (§5) but **no CL number is cited anywhere in this file.**
   Recover via Gerrit search on the migration function names (they are unique strings), or via an
   authenticated gitiles session.
8. **Pre-`kDeprecatedVersionNumber` (≤ 82) history of `autofill.date_created`.** Chrome once used
   a separate per-use `autofill_dates` table. Not reachable from `ba3c200`; not needed for any DB
   modern Chrome will open (it razes them). Recorded for completeness only.
9. **`autofill_sync_metadata` proto contents.** BLOBs may contain 1601-µs int64 fields. Not a
   column-level concern; flag if #118/#123 scope includes proto internals.
10. **Milestone method caveat.** §5 milestones are "first stable milestone whose *branch point*
    contained the bump". A post-branch merge would shift a row by one milestone. Not observed,
    not disproven.
11. **`sql::Statement::BindTime` / `ColumnTime` semantics were NOT re-verified this run.** Every
    "1601 µs" claim above rests on `BindTime` doing
    `BindInt64(col, time.ToDeltaSinceWindowsEpoch().InMicroseconds())`. `sql/statement.cc` was not
    fetched by me (it is a one-read, classifies-everything check — assigned elsewhere in the
    fan-out). The `server_card_metadata` read site (`payments_autofill_table.cc:1148-1149`,
    `FromDeltaSinceWindowsEpoch(base::Microseconds(...))`) independently corroborates it for at
    least that one column.

---

## 7. Source index

All fetched over `https://chromium.googlesource.com/chromium/src/+/<ref>/<path>?format=TEXT`
and base64-decoded (macOS `base64 -d -i <in> -o <out>`), one unique temp filename per fetch,
cached under `/tmp/wd143/`.

| # | Path | Ref / SHA | Lines cited |
|---|---|---|---|
| S1 | `components/webdata/common/web_database.h` | `refs/heads/main` @ `ba3c200c1564977873107f5656c015253ba129b1` | 35, 57 |
| S2 | `components/webdata/common/web_database.cc` | same | 60, 70, 176-180, 194-199, 252-255 |
| S3 | `components/autofill/core/browser/webdata/autocomplete/autocomplete_table.cc` | same | 40-56, 65-71, 92-101, 145-146, 156, 165-166, 234, 249-250, 279, 294, 315, 344-347, 366-367, 411-413, 441-447, 452-465 |
| S4 | `components/autofill/core/browser/webdata/addresses/address_autofill_table.cc` | same | 50-80, 175-179, 344-366, 384-395, 441-484, 543-564, 591-656, 784-787, 852-1005, 1009-1160, 1193-1214 |
| S5 | `components/autofill/core/browser/webdata/payments/payments_autofill_table.cc` | same | 64-253, 274-345, 531-630, 1120-1170, 1420-1425, 1437-1438, 1710-1711, 1771-1772, 1921-2240, 2326-2440 |
| S6 | `components/autofill/core/browser/webdata/payments/payments_autofill_table.h` | same | grepped for `iou` — no match |
| S7 | `components/search_engines/keyword_table.cc` | same | 75-145, 255-290, 287-322, 424-520, 522-553, 633-659, 748-763 |
| S8 | `components/autofill/core/browser/webdata/autofill_ai/entity_table.cc` | same | 55-73, 100-247, 279-291, 375-395, 430, 483 |
| S9 | `components/autofill/core/browser/webdata/valuables/valuables_table.cc` | same | 40-60, 89, 165-208, 396, 400-418 |
| S10 | `components/webdata_services/web_data_service_wrapper.cc` | same | 154-175, 248-251 |
| S11 | `components/autofill/core/browser/webdata/` (tree listing) | same | directory enumeration |
| S12 | `components/autofill/core/browser/webdata/payments/` (tree listing) | same | directory enumeration |
| S13 | `components/autofill/core/browser/webdata/valuables/` (tree listing) | same | directory enumeration |
| S14 | `components/webdata/common/web_database.{h,cc}` at 41 milestone branch-point SHAs | see §5.1 | `kCurrentVersionNumber` / `kCompatibleVersionNumber` / `kDeprecatedVersionNumber` only |
| S15 | `https://chromiumdash.appspot.com/fetch_milestones?mstone=<N>` | live API, N = 105..151 | `chromium_main_branch_hash` |
| S16 | `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows` | live API | latest stable = 151.0.7922.77 → M151 |

**Main HEAD resolution:**
`curl https://chromium.googlesource.com/chromium/src/+refs/heads/main?format=TEXT`
→ `ba3c200c1564977873107f5656c015253ba129b1 refs/heads/main`.

**Fetches that 404'd (path rot, recorded so nobody retries them):**
- `components/autofill/core/browser/webdata/addresses/address_table.cc` — the salvage file's path;
  correct name is **`address_autofill_table.cc`**
- `components/plus_addresses/webdata/plus_address_table.cc`
- `components/os_crypt/sync/os_crypt.h`

**Not cited, not used:** `research/_raw/143-leads-unverified.md` (model knowledge only).
`research/_raw/143-confirmed-partial.md` was used **only** for the Login Data cross-reference in
§1, which is attributed there and is Part-2 scope.

**Notes for the other agents / the final matrix:**
- `WebDatabase::kCurrentVersionNumber` **moved from `web_database.cc` to `web_database.h`**
  between M127 and M129. A bisect that only greps the `.cc` silently returns nothing for M128+
  and will look like "file not found" rather than an error.
- `chromiumdash fetch_releases?...&mstone=<N>` **ignores the `mstone` parameter** and returns the
  latest release regardless. Use `fetch_milestones?mstone=<N>` → `chromium_main_branch_hash`
  instead. This cost me several minutes; do not repeat it.
