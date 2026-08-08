# 135 — Windows/Linux Chrome cache backend and key-store characterization

**Ticket:** [Characterize Chrome profiles on Windows and Linux](https://github.com/ChmaraX/forensix/issues/135)
**Scope:** narrowed by the ticket's own follow-up comment (inherited from
[Source platform scope](https://github.com/ChmaraX/forensix/issues/138)) to three questions —
Windows cache backend, blockfile format details, Linux key-store variance — not the full
per-database characterization [#117](https://github.com/ChmaraX/forensix/issues/117) already
did for macOS.
**Method:** direct acquisition via GitHub Actions (`windows-latest`, `ubuntu-latest`), Chrome for
Testing installed fresh per job, driven headless with `puppeteer-core` against public sites only
(no case data). v1 was **not** run against any of this. Workflow:
[`research-135.yml`](../.github/workflows/research-135.yml), driver:
[`135-driver.js`](_raw/135-driver.js). Run:
[workflow_dispatch #31260855949](https://github.com/ChmaraX/forensix/actions/runs/31260855949),
all three jobs green.

| | |
|---|---|
| Browser | Chrome for Testing **151.0.7922.77** (stable channel) |
| Platforms | `windows-latest`, `ubuntu-latest` ×2 (see below) |
| `USER_DATA_DIR` | throwaway, one profile (`Default`) |
| Traffic | example.com, iana.org, httpbin.org (html/png/jpeg/webp/json/xml/robots.txt/cookie-set), developer.mozilla.org, en.wikipedia.org ×3, news.ycombinator.com |
| Snapshot | clean only (graceful `browser.close()`) — this run does not attempt the aged/hot-vs-clean axis; see [Limitations](#limitations) |

Evidence: [`windows_cache_data_listing.txt`](artifacts/135-win-linux-cache/windows_cache_data_listing.txt) ·
[`windows_cache_tree_listing.txt`](artifacts/135-win-linux-cache/windows_cache_tree_listing.txt) ·
[`windows_index_hex.txt`](artifacts/135-win-linux-cache/windows_index_hex.txt) ·
[`windows_local_state_oscrypt_redacted.txt`](artifacts/135-win-linux-cache/windows_local_state_oscrypt_redacted.txt) ·
[`linux_no_secret_service_*`](artifacts/135-win-linux-cache/) ·
[`linux_gnome_keyring_*`](artifacts/135-win-linux-cache/)

---

## 1. Headline finding: the cache is neither blockfile nor Simple Cache — it's a third, SQL backend

Both the Windows job and both Linux jobs produced an identical, unexpected `Cache_Data` shape:

```
Cache/Cache_Data/
├── index            12 bytes,  magic "SQLCache3Sql"
├── sqldb0           ~0.6–2.0 MB
├── sqldb0-journal   0 bytes
├── sqldb1           ~1.0–1.6 MB
├── sqldb1-journal   0 bytes
├── sqldb2           ~1.6–2.0 MB
└── sqldb2-journal   0 bytes
```

This is **neither** of the two backends #118's empirical shortcut anticipated (16-hex `_0` files =
Simple; `data_0..data_3` + `f_######` = blockfile). It's Chromium's newer **SQL disk cache
backend** — `net::disk_cache::SqlBackendImpl` backed by `SqlPersistentStore`, sharded across N
SQLite database files (`sqldb0..sqldb<N-1>`, default `GetShardCount()` = 3), each an ordinary
SQLite database.

**Verified ✅** — read directly from the Chromium source tree:
- `net/disk_cache/sql/sql_backend_impl.{h,cc}`, `sql_persistent_store.{h,cc}`,
  `sql_persistent_store_backend{,_shard}.{h,cc}`, `sql_shared_cache*.{h,cc}`,
  `sql_backend_constants.h`, `entry_db_handle.{h,cc}`, `eviction_candidate_aggregator.{h,cc}` —
  all at `https://source.chromium.org/chromium/chromium/src/+/main:net/disk_cache/sql/`.
- Shard count: `net::features::kSqlDiskCacheShardCount` (`sql_backend_impl.cc`,
  `GetShardCount()`), clamped `[1, 255]`.
- Journal mode per shard is itself feature-controlled:
  `net::features::kSqlDiskCacheWalMode` selects `"Wal"` vs `"Truncate"` in the fake-index string
  construction (`sql_backend_impl.cc`). Our run shows `-journal` sidecars at 0 bytes for all three
  shards — **WAL mode was off** in this configuration (`journal_mode=TRUNCATE`, consistent with the
  rest of the profile per #117's finding that TRUNCATE is the norm outside `DIPS`).
- **This is a Finch-gated experiment, not an unconditional code default.** Selection happens in
  `components/network_session_configurator/browser/network_session_configurator.cc`,
  `ChooseCacheType()`:
  ```cpp
  if (base::FeatureList::IsEnabled(net::features::kDiskCacheBackendExperiment)) {
    switch (net::features::kDiskCacheBackendParam.Get()) {
      case net::features::DiskCacheBackend::kSql: /* ... */
      case net::features::DiskCacheBackend::kSimple: /* ... */
      case net::features::DiskCacheBackend::kBlockfile: /* ... */
      case net::features::DiskCacheBackend::kDefault: break;  // falls through to platform default
    }
  }
  ```
  `net::features::kDiskCacheBackendExperiment` is the gate; `kDiskCacheBackendParam` (`"backend"`)
  is the value (`"sql" | "simple" | "blockfile"`) — confirmed against
  `content/browser/storage_partition_impl.cc` and
  `chrome/browser/net/profile_network_context_service.cc`, both of which read the same
  `base::FieldTrial`.

### Unverified ⚠️ — this is the load-bearing caveat

**We only ran Chrome for Testing, which does not fetch a live Finch seed.** Its behaviour reflects
whatever field-trial-testing config is baked into that release, which is not necessarily what a
real installed Chrome is currently serving on a given machine — this is the **same class of gap**
already established for App-Bound Encryption in
[#141](https://github.com/ChmaraX/forensix/issues/141) (CfT's `supports_system_level = false`) and
for the ABE milestone correction in
[#118](https://github.com/ChmaraX/forensix/issues/118)/[#141](https://github.com/ChmaraX/forensix/issues/141)
(Finch-staged rollout ≠ code default; decrypt by prefix, not version).

Cross-referencing #117: that run used **branded** Google Chrome 151.0.7922.71 on macOS (a live
install with a real Finch seed) and found **Simple Cache**, not the SQL backend — one patch
version earlier (`.71` vs `.77`) and a different acquisition channel entirely. The two results are
not necessarily in conflict on the merits (different platform, different channel, different Finch
group), but they mean **we cannot yet say what a real, currently-updating Windows or Linux install
serves today**. What we can say:

- The SQL backend is real, shipped, on-by-default-somewhere code, not vaporware or a build flag we
  need to pass — we passed no cache-related flags at all.
- A v2 cache parser now has **three** possible on-disk shapes to handle, not two: blockfile
  (`data_0..data_3` + `f_######`), Simple Cache (16-hex `_0`/`_1`/`_s`), and SQL
  (`sqldb0..sqldb<N-1>` + `index` magic `SQLCache3Sql`). Detection should be by **directory
  contents**, exactly as #118 already recommended for the blockfile/Simple split — extend that
  rule to three cases rather than two.
- **Which of the three a given piece of Windows/Linux evidence actually has is now an acquisition-time
  fact, not a platform-time one.** The existing "Windows = blockfile" assumption inherited from
  #118 is unconfirmed for current branded installs and disproven for current Chrome-for-Testing
  installs. This ticket cannot settle which is more common in real casework without a branded,
  live-Finch-seed Windows acquisition, which is out of this session's reach (see Limitations).

**Practical upshot for the format-details ask:** the blockfile "index header / rankings /
allocation bitmap" question that #118 flagged STILL-UNKNOWN is not resolved by this run — no
blockfile evidence was produced on either platform. Whether it's still worth resolving depends on
how common blockfile evidence turns out to be in the field, which nobody has measured. **Recorded
as fog, not answered** — see the map's Not yet specified.

The SQL backend, if it does turn out to be what real users are running, is **considerably easier**
to parse forensically than blockfile ever was: it's SQLite, the same tooling and page-recovery
techniques v2 already needs for History/Cookies/Web Data apply directly, and the schema is
discoverable via `sqlite3_analyzer`/`.schema` rather than reverse-engineered binary structs.

---

## 2. Windows key material: DPAPI-wrapped, `Local State`, matches expected shape

**Verified ✅ (this run):**
- `Local State` on Windows carries an `os_crypt.encrypted_key`, base64-decoded prefix **`DPAPI`**
  (5 ASCII bytes), total decoded length 149 bytes.
- No `APPB` (App-Bound Encryption) prefix was observed — expected, since Chrome for Testing does
  not support App-Bound Encryption
  ([#127](https://github.com/ChmaraX/forensix/issues/127): `supports_system_level = false`;
  [#141](https://github.com/ChmaraX/forensix/issues/141) built on that to rule out `v20` fixture
  capture entirely). This run corroborates that finding from the opposite direction: even without
  deliberately avoiding ABE, a stock CfT Windows run produces a plain DPAPI-wrapped key, not an
  App-Bound one.
- Key bytes themselves are **not** committed to this repo — machine/user-bound DPAPI blob, useless
  off the generating CI runner, and out of scope to keep per #127's "no key material is ever
  committed" fixture policy, applied here by extension even though this isn't a fixture.

This matches the shape #135's own body anticipated and needed no correction.

---

## 3. Linux key material: `Local State` carries no `os_crypt` block at all — on any Linux, not just macOS

**Verified ✅ (this run, both variants):**
- Neither the "no secret service" nor the "gnome-keyring" job produced an `os_crypt` key in
  `Local State` — the section is simply absent. This extends #117's macOS finding ("`Local State`
  carries no `os_crypt` key on macOS at all") to Linux: **key acquisition is platform-dispatched at
  the code level, and Windows is the only platform of the three that stores wrapped key material
  in `Local State`.** macOS uses Keychain (per #117); Linux uses a fully **deterministic**,
  hardcoded key derived at compile time (per #127) or a live D-Bus secret-service round-trip —
  neither needs anything written to `Local State`.
- Cookie ciphertext prefix in **both** Linux jobs was `v10` — the "basic"/hardcoded-key path from
  #127 (`PosixKeyProvider`, PBKDF2-HMAC-SHA1(1 iter, `"peanuts"`, `"saltysalt"`) → AES-128-CBC).
  This empirically confirms, for the first time with a live acquisition rather than source reading
  alone, that a Linux profile with **no reachable secret service** produces deterministic, portable
  `v10` ciphertext — directly validating #127's Linux fixture strategy
  (`--password-store=basic` is not even required to get this outcome; it's what you get with
  nothing running).

**Inconclusive ⚠️ — the "gnome-keyring present" case was not actually exercised.** The
`gnome-keyring` job installed `gnome-keyring` + `dbus-x11`, started a session bus, and unlocked an
empty-password keyring, but Chrome still emitted `v10` cookies — meaning it did **not** detect or
use the secret service. Chromium's Linux key-provider selection depends on desktop-environment
detection (`base::nix::GetDesktopEnvironment()`, reading `XDG_CURRENT_DESKTOP` /
`DESKTOP_SESSION`), which a bare `gnome-keyring-daemon` process on a headless CI runner with no
window manager and no desktop-session env vars does not satisfy. **This means the "with a real
GNOME/KDE secret service" case — which prefix it produces (`v11`?), and what exact bytes get
written to `Local State` if anything — is still unconfirmed**, not because the mechanism is
unclear (#127 already documents the `v11`/libsecret path from source) but because this run's
environment wasn't a close enough simulation of a real desktop session to trigger it. Recorded as
fog rather than re-attempted here — see the map's Not yet specified.

**Not attempted — Snap/Flatpak path variance.** A source check for Snap-specific environment
handling in `chrome/common/chrome_paths_linux.cc` returned **no matches**: Chromium upstream has
no Snap awareness at all. This is expected and clarifies the question rather than leaving it
open — **Snap and Flatpak path differences are entirely a packaging/confinement-layer concern, not
a Chromium source-code branch.** Snap remaps `$HOME` via bind-mount confinement (typically to
something under `~/snap/<pkg>/current/`); Flatpak sandboxes to `~/.var/app/<app-id>/`. v2 does not
need a Chromium-side special case for either — it needs an **acquisition-time path convention**,
which is squarely #121's territory (what does the investigator have in hand, what directory do
they point the tool at), not a parser concern. No further characterization done here; this is a
sourcing fact, not a measurement.

---

## Limitations

- **No aged profile.** #135's body flagged this explicitly and this run didn't do it — WAL-related
  claims are out of scope for this write-up (and moot anyway: none of Windows/Linux/macOS shows a
  WAL-mode cache backend in any run so far; `DIPS` remains the only WAL database seen across all
  three platforms).
- **`logins`/`downloads`/`autofill`/search-terms were not populated.** The narrower scope (cache
  backend + key-store variance) didn't need them; #117 already flagged this same gap on macOS and
  it remains open on all three platforms.
- **No branded-Chrome, live-Finch-seed Windows or Linux run.** Everything here is Chrome for
  Testing. The single most important open question this run surfaces — *what cache backend do real
  installs actually have right now* — needs exactly the kind of acquisition #135's body originally
  asked for (a real machine, not CfT), which this session did not have access to.
- **`gnome-keyring` secret-service path unexercised**, as detailed above.
