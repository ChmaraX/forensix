# 117 — Characterize a modern Chrome profile directly

**Ticket:** [Characterize a modern Chrome profile directly](https://github.com/ChmaraX/forensix/issues/117)
**Method:** direct acquisition. v1 was **not** run against this profile.
**Status:** **scouting pass**, not a controlled characterisation — see [Scope of this run](#scope-of-this-run).
**Revised** after review: the §3 WAL claim was overclaimed and is corrected in place.

---

## Acquisition

| | |
|---|---|
| Browser | Google Chrome **151.0.7922.71** (stable) |
| Platform | macOS, arm64 |
| `USER_DATA_DIR` | throwaway `--user-data-dir`, never a real user profile |
| Profiles | `Default` + `Profile 1` (two profile directories, both populated) |
| Traffic | example.com, wikipedia.org, httpbin.org (cookie-setting), developer.mozilla.org, news.ycombinator.com, iana.org |
| Snapshots | **hot** (`rsync` with Chrome running) and **clean** (after graceful quit) |
| Size | 1,204 files, 163.5 MB |

Two snapshots exist deliberately: the hot/clean delta is the measurement, not a side effect.

Evidence: [`schemas.sql`](artifacts/117-chrome151-macos/schemas.sql) ·
[`inventory.csv`](artifacts/117-chrome151-macos/inventory.csv) ·
[`db_index.json`](artifacts/117-chrome151-macos/db_index.json) ·
[`layout.txt`](artifacts/117-chrome151-macos/layout.txt) ·
[`local_state.redacted.json`](artifacts/117-chrome151-macos/local_state.redacted.json)

---

## 1. On-disk layout

`USER_DATA_DIR` holds ~40 browser-level entries plus one directory per profile.

```
USER_DATA_DIR/
├── Local State                 ← browser-level JSON, sibling of profiles (confirms #121)
├── Last Version                ← "151.0.7922.71"
├── RunningChromeVersion        ← present only while Chrome runs; a liveness marker
├── Singleton{Cookie,Lock,Socket}  ← Lock is a symlink to host-pid; profile-in-use evidence
├── first_party_sets.db         ← browser-level SQLite (v5)
├── segmentation_platform/ukm_db
├── Default/                    ← 24 SQLite DBs + Preferences + Secure Preferences + Cache/
├── Profile 1/                  ← identical shape
└── ~30 component dirs (optimization_guide_model_store, WasmTtsEngine, component_crx_cache, …)
```

**Signal-to-noise is poor.** 163.5 MB total, of which the forensically interesting SQLite
set is **under 2 MB**. The bulk is ML/component payload:
`optimization_guide_model_store/43` alone is 37.6 MB, `WasmTtsEngine` and one
`component_crx_cache` entry 23.3 MB each. An acquisition that copies `USER_DATA_DIR`
wholesale carries ~99% ballast.

`SingletonLock` is a symlink whose target encodes `hostname-pid`. It is direct evidence
of which machine had the profile open, and it does not survive a naive file copy that
dereferences symlinks.

---

## 2. Databases: 48 SQLite files, 24 per profile

Per profile: `History`, `Cookies`, `Login Data`, `Login Data For Account`, `Web Data`,
`Account Web Data`, `Favicons`, `Top Sites`, `Shortcuts`, `Network Action Predictor`,
`Affiliation Database`, `DIPS`, `Trust Tokens`, `Shared Dictionary/db`,
`BrowsingTopicsSiteData`, `Reporting and NEL`, `ServerCertificate`,
`WebStorage/QuotaManager`, `heavy_ad_intervention_opt_out.db`,
`declarative_performance_observer.db`, plus a mirrored set under
`Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/` (the built-in Google Docs Offline extension).

Schema versions observed on Chrome 151:

| Database | `meta.version` | `last_compatible` |
|---|---|---|
| History | **70** | 16 |
| Cookies | **24** | 24 |
| Login Data / For Account | **43** | 40 |
| Web Data / Account Web Data | **152** | 151 |
| Favicons | 9 | 9 |
| Top Sites | 5 | 5 |
| Shortcuts | 2 | 1 |
| DIPS | 11 | 11 |
| Affiliation Database | 7 | 1 |
| Trust Tokens / Reporting and NEL | 2 | 2 |

`last_compatible_version` is the useful gate: History declares 16, so a reader that
targets the current column set stays valid across a wide back-range. Web Data declares
151 — one milestone of tolerance only. **Version tolerance is per-database, not global.**

Full DDL for all 50 databases (including the two browser-level ones) is in
[`schemas.sql`](artifacts/117-chrome151-macos/schemas.sql).

---

## 3. Journal modes — the WAL picture is inverted

Read from the SQLite header (bytes 18/19: `1` = rollback journal, `2` = WAL), not from
a `PRAGMA` on a copied file.

| Database | write/read version | sidecars |
|---|---|---|
| History, Cookies, Login Data, Web Data, Favicons, Top Sites, Shortcuts, … | **1** (rollback) | `-journal`, **0 bytes** |
| **DIPS** | **2** (WAL) | **`-wal`, 45,352 bytes** |

Everything except `DIPS` is `journal_mode=TRUNCATE` — a persistent, zero-length
`-journal` file. Exactly **one** database per profile is WAL.

On this profile, the `DIPS` main file was a hollow shell:

```
DIPS, main file only (WAL discarded)   →  0 tables,  0 rows
DIPS, main file + -wal                 →  4 tables (meta, config, bounces, popups)
```

### Correction: the 0-tables result is a young-profile artifact, not steady state

An earlier revision of this report claimed the `-wal` surviving a graceful quit made
total loss "the steady state." **That was wrong**, and the measurement says so:

```
page_size = 4096      page_count = 9       -wal = 45,352 B ≈ 11 frames
wal_autocheckpoint = 1000 pages (default) → threshold ~4000 KB
                                          → 11/1000. Never checkpointed.

pragma wal_checkpoint(TRUNCATE)
  main file             4,096 B  →  36,864 B
  main-file-only after  0 tables →  4 tables [bounces, config, meta, popups]
```

The profile was minutes old, so `DIPS` had accumulated ~1% of the pages needed to
trigger an automatic checkpoint. The schema had simply never been written back. On an
aged profile the main file **will** carry the schema.

What survives the correction, and what does not:

| Claim | Status |
|---|---|
| A reader that drops `-wal` silently under-reports `DIPS` | **Holds.** Post-checkpoint, rows written since the last checkpoint still live only in the WAL |
| `-wal` persists across a graceful Chrome quit | **Holds** — observed, 45,352 B still present after quit |
| Main file → 0 tables; empty-vs-dropped-WAL is indistinguishable | **Young profiles only.** Generalised from n=1 on a minutes-old profile |

The practical requirement is unchanged — copy and read the sidecars — but the failure
mode is ordinary under-reporting, not catastrophic total loss, on any profile with real
age. **The catastrophic case is still reachable**: a freshly-created or freshly-reset
profile is exactly the young-profile condition, so a parser must still distinguish
"no `-wal` supplied" from "empty database" rather than assuming age.

---

## 4. Hot vs clean: a live copy loses data that has nothing to do with WAL

| Table | HOT, main file only | HOT + sidecars | CLEAN |
|---|---|---|---|
| `Default/History.urls` | 6 | 6 | 6 |
| `Default/History.visits` | 6 | 6 | 6 |
| `Default/Cookies.cookies` | 7 | 7 | 7 |
| **`Profile 1/Cookies.cookies`** | **0** | **0** | **1** |
| `Default/Favicons.favicons` | 3 | 3 | 3 |
| `Default/DIPS.bounces` | *no such table* | 0 | 0 |

`Profile 1` had a cookie set over the network during the session. At hot-snapshot time
it was **not in the file at all** — not in the WAL, not in the journal, not in the main
database. It appeared only after Chrome quit.

Chrome's network service batches cookie writes in memory and flushes on a timer or at
shutdown. **Perfect sidecar handling does not recover it.** Any live acquisition has a
write-lag window in which recently-observed activity exists only in Chrome's address
space.

This is a stronger and different claim than "WAL contents are invisible": the loss
channel is process memory, and the only mitigations are (a) acquire from a stopped
browser, or (b) treat a live acquisition as explicitly lossy and record it as such in
the provenance record.

---

## 5. Credential encryption — `Local State` has no key on macOS

```
"os_crypt" in Local State  →  False
keys matching /crypt|key/  →  []
```

The 34 top-level keys are variations/metrics/policy/profile bookkeeping. **There is no
`os_crypt.encrypted_key` on macOS at all.** That field is a Windows artifact (DPAPI-wrapped,
`DPAPI`/`APPB` prefixed). On macOS the Safe Storage key lives in the login Keychain
(`Chrome Safe Storage`), and on Linux in the desktop secret service or a hardcoded
fallback.

So the acquisition contract is platform-conditional:

| Platform | Key source | Is `Local State` sufficient? |
|---|---|---|
| Windows | `Local State` → `os_crypt.encrypted_key` (DPAPI / ABE) | yes, with the user's DPAPI context |
| **macOS** | **login Keychain, `Chrome Safe Storage`** | **no — `Local State` carries no key** |
| Linux | secret service, or `peanuts` fallback | no |

`Local State` is still required — it is the only source of the profile roster
(`profile.info_cache`, `profile.profiles_order`, `profile.last_used`) — but on macOS it
is worthless for decryption. An acquisition model built around "copy `Local State` and
you can decrypt" is Windows-shaped and silently fails elsewhere.

**Observed ciphertext prefixes**, all 7 `Default` cookies:

```
763130 = "v10"    encrypted_value 51–115 B,   value column length 0
```

`v10` on macOS as expected; `value` is always empty, so plaintext never sits alongside.
This is consistent with the locked decision from #118: **dispatch on the per-row prefix**.
Nothing in this profile contradicts it, and nothing in `Local State` would have told you
which prefix to expect.

`Login Data.logins` carries a `keychain_identifier BLOB` column — a macOS-specific
indirection worth noting for the credential-decryption policy ticket.

---

## 6. Cache — Simple Cache confirmed on macOS

```
Default/Cache/Cache_Data/    87 entries + index-dir/
Profile 1/Cache/Cache_Data/  23 entries + index-dir/
entry magic: 30 5c 72 a7 1b 6d fb fc   → LE 0xfcfb6d1ba7725c30 = Simple Cache
```

Filenames are `<16 hex>_0`. Combined with #118's finding that Windows remains
**blockfile**, v2 needs **two cache readers** and must select on the acquired platform,
not on the Chrome version.

---

## 7. Timestamps

`urls.last_visit_time = 13430179812042122` → `WebKit/Chrome epoch` (µs since
1601-01-01). `unixepoch = value/1000000 - 11644473600` round-trips correctly against
the known acquisition wall-clock.

`Cookies.creation_utc`, `expires_utc`, `last_access_utc`, `last_update_utc` use the same
encoding. `Favicons.favicon_bitmaps.last_updated`/`last_requested` also.

`Web Data.autofill.date_created` and `Login Data.logins.date_created` were **not
exercised** — both tables are empty in this profile, so their epoch is asserted by
neither this acquisition nor a round-trip. Chrome is known to mix epochs across
databases; that has to be established per column against populated ground truth, not
assumed from History.

---

## 8. Demographics keys are conditional, not merely moved

```
sync.demographics                  <<ABSENT>>
sync.demographics.birth_year       <<ABSENT>>
sync.birthday                      <<ABSENT>>
sync.transport_data_per_account    <<ABSENT>>
account_info                       <<ABSENT>>
```

This profile was never signed in. #118 established *where* the birth-year value lives
and that it is raw on disk; this profile shows the prior condition: **the entire key
subtree is absent without an active sync account**, not present-and-empty. Any parser
must treat "absent" as the normal case, and the feature must be specified as
*conditional on a synced profile* rather than as a generally-available artifact.

v1's bare `catch` (defect #6) would render this indistinguishable from a parse failure.

---

## Scope of this run

This was a **scouting pass**, not a controlled characterisation. Two limits bound every
finding below:

- **Behaviour was not exercised for most artifacts.** `logins` 0 rows, `downloads` 0,
  `autofill` 0, `credit_cards` 0, `keyword_search_terms` 0, `visit_source` 0,
  `segments` 0. Their DDL is captured; their timestamps, enum values and encodings are
  **unverified**. These are precisely the artifacts ForensiX exists to recover.
- **No controlled ground truth.** Inputs were browsed, not scripted against known
  values, so outputs were observed rather than checked. Nothing here was typed in the
  omnibox, so transition codes and `typed_count` are unexercised.

The rigorous version of this belongs in
[Fixture strategy and sandbox design](https://github.com/ChmaraX/forensix/issues/127) —
building a characterisation harness and then a fixture harness is the same work twice.

## Findings that bear on the build

1. **Exactly one database per profile is WAL (`DIPS`); everything else is TRUNCATE.**
   Sidecars must still be copied and read, or rows written since the last checkpoint are
   silently dropped. The `-wal` persists across graceful shutdown. The observed
   *total* loss (main file → 0 tables) was a **young-profile artifact** — see the
   correction in §3 — but remains reachable on freshly-created or reset profiles.
2. **Live acquisition loses data through process memory, not just sidecars.** A cookie
   written during the session was absent from disk entirely until Chrome quit. Correct
   sidecar handling cannot recover it. **The window is unmeasured** — snapshot timing
   here was arbitrary (14 s / 10 s / 12 s sleeps), so this establishes that the loss
   channel exists, not its size.
3. **`Local State` carries no key material on macOS.** The Windows-shaped assumption
   behind v1 defect #3 does not generalise. Key acquisition is a platform-dispatched
   step, and on macOS it requires Keychain access — which has its own consent and
   provenance implications for #124.
4. **`last_compatible_version` is per-database.** History tolerates back to 16; Web Data
   to 151. Version-range support must be declared per parser, not per Chrome release.
5. **Simple Cache on macOS, blockfile on Windows** — two readers, selected by acquired
   platform.
6. **~99% of `USER_DATA_DIR` is ballast.** A selective acquisition manifest is viable and
   would cut 163 MB to under 2 MB, but `SingletonLock` (a symlink encoding host-pid) and
   `RunningChromeVersion` are liveness evidence that a naive copy destroys.
7. **Demographics keys are absent, not empty, without sync.**

## Open

- **Windows and Linux are uncharacterised.** Findings 3, 5 and the journal-mode table
  are platform-specific. Tracked as
  [Characterize Chrome profiles on Windows and Linux](https://github.com/ChmaraX/forensix/issues/135).
  Treat these macOS numbers as a scouting result, not a baseline to diff against.
- **The write-lag window is unmeasured.** Needs timed sampling, not a single arbitrary
  snapshot, before any acquisition mode can be called "acceptably lossy".
- **The aged-profile case is untested.** Every observation here comes from a profile
  minutes old. The checkpoint correction in §3 was only caught because the numbers were
  re-derived; other young-profile artifacts may be hiding in this report.
- **No synced profile**, so #118's `sync.transport_data_per_account` shape is unverified
  against a live profile.
- **No populated `downloads`, `logins`, or `autofill`.** Schemas captured; timestamps and
  `state`/`danger_type` enumerations unexercised.
