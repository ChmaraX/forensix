# 117 — Characterize a modern Chrome profile directly

**Ticket:** [Characterize a modern Chrome profile directly](https://github.com/ChmaraX/forensix/issues/117)
**Method:** direct acquisition and characterisation. v1 was **not** run against this profile.

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

**The consequence is the opposite of the intuition.** For a WAL database the main file
can be a hollow shell:

```
DIPS, main file only (WAL discarded)   →  0 tables,  0 rows
DIPS, main file + -wal                 →  4 tables (meta, config, bounces, popups)
```

Not "recent rows are missing" — *the entire schema* lives in the WAL. A reader that
drops `-wal` does not under-report `DIPS`; it sees an empty database and cannot tell
that from a genuinely empty one.

**The `-wal` survived a graceful quit.** Chrome does not checkpoint `DIPS` on exit, so
this is not a hot-acquisition-only hazard — it is the steady state.

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

## Findings that bear on the build

1. **WAL is one database per profile, and it is total.** `DIPS` main-file-only yields
   zero tables. Sidecar handling is not an accuracy refinement; without it that artifact
   reads as empty. The `-wal` persists across graceful shutdown.
2. **Live acquisition loses data through process memory, not just sidecars.** A cookie
   written during the session was absent from disk entirely until Chrome quit. Correct
   sidecar handling cannot recover it.
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

- Windows and Linux profiles are not characterised here. Findings 3, 5 and the
  journal-mode table are platform-specific and need the same treatment on Windows before
  the acquisition contract is settled.
- A signed-in/synced profile was not acquired, so the `sync.transport_data_per_account`
  shape from #118 is unverified against a live profile.
- No `downloads` rows were generated; the downloads schema is captured but its
  timestamps and `state`/`danger_type` enumerations are unexercised.
