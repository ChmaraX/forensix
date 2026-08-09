# 152 — Branded Chrome HTTP cache backend on Windows and Linux

**Ticket:** [Confirm cache backend on branded, live-Finch-seed Windows and Linux Chrome](https://github.com/ChmaraX/forensix/issues/152)

**Scope:** Determine what HTTP cache backend a real, currently-updating BRANDED Chrome installation (not Chrome for Testing) actually uses on Windows and Linux.

**Status of this document:** reopened once already — a prior CI-only attempt (kept below as [§3](#3-prior-attempt-github-actions-ci--null-result-not-an-answer)) produced a null result and was wrongly closed as if that were the answer. A second revision answered Linux via a real, headed, multi-launch desktop session and left Windows blocked on missing Cua cloud credentials. This revision answers Windows too, on `windows-latest` CI — reinstated deliberately, as a **properly controlled experiment** (positive control, no path assumptions) rather than the void attempt in §3. See [§4](#4-windows-answered-blockfile-on-a-controlled-ci-run--why-ci-is-admissible-this-time) for why CI is admissible this time and [§2](#2-answer-windows--blockfile-verified-on-a-controlled-ci-run) for the result. **Both halves of the question are now answered.**

---

## 1. Answer: Linux — Simple Cache, verified on a real headed desktop session

**Verified ✅**

A **branded** Google Chrome install (official `google-chrome-stable` package from `dl.google.com/linux/chrome/deb/`, not Chrome for Testing) running on a **real X11 desktop session** (Xvfb + fluxbox window manager, non-headless), with a profile that survived **two separate launches** (quit and relaunch), produces:

```
Default/Cache/
├── No_Vary_Search/{snapshot.baf, journal.baj}
└── Cache_Data/
    ├── <16-hex>_0     × 210 files (e.g. 0b1862f8e0d8319f_0)
    ├── index          24 bytes, magic 0xfcfb6d1ba7725c30 (LE)
    └── index-dir/the-real-index
```

This is **Simple Cache** (`net::disk_cache::SimpleBackendImpl`) — not blockfile (`data_0..data_3` + `f_######`) and not the SQL backend (`sqldb0..sqldbN`, magic `SQLCache3Sql`).

**How this was confirmed, precisely:**

- `Cache_Data/index` first 8 bytes are `30 5c 72 a7 1b 6d fb fc`, which as a little-endian `uint64` is `0xfcfb6d1ba7725c30` — this is exactly Chromium's `disk_cache::kSimpleInitialMagicNumber` (`net/disk_cache/simple/simple_entry_format.h`). No `SQLCache3Sql` string appears anywhere, and no `data_0..data_3`/`f_######` files exist.
- 210 of 212 entries in `Cache_Data` match the Simple Cache filename pattern `^[0-9a-f]{16}_[0-9s]$` (the other two are `index` and `index-dir`); zero match `sqldb*` or `data_[0-3]`/`f_[0-9a-f]{6}`.
- A sample entry file (`0b1862f8e0d8319f_0`) opens with the **same** magic number followed by a `SimpleFileHeader`-shaped record (version, key length, key hash) and then the plaintext cache key itself: `1/0/_dk_https://wikipedia.org https://wikipedia.org http...` — the double-keyed (network-isolation-key-partitioned) cache key format Simple Cache uses. This is direct entry-format evidence, not just the index magic.
- `index-dir/the-real-index` (Simple Cache's newer B-tree-adjacent flat index, 4200 bytes) is present and populated — corroborating, not just the top-level 24-byte `index` stub.

**Method — what makes this different from the prior CI attempt:**

| | Prior CI attempt (§3) | This attempt |
|---|---|---|
| Chrome | branded (winget/.deb) | branded (official `.deb` apt repo) |
| Session | headless, one-shot | **headed** — Xvfb + fluxbox real X11 desktop, screenshots captured |
| Profile | fresh, throwaway | fresh on launch 1, **same profile reused across launch 2** (quit, relaunch, browse more) |
| First-run state | suppressed (`--no-first-run`) | **not suppressed** on launch 1 — real first-run state |
| Result | no `Cache` directory at all | full `Default/Cache/Cache_Data` from the first launch onward |

Traffic pattern matched #135/#117: example.com, iana.org, httpbin.org (html/png/jpeg/webp/json/xml/robots.txt/cookie-set), developer.mozilla.org, three Wikipedia articles, news.ycombinator.com — 15 tabs opened via `PUT /json/new?<url>` against `--remote-debugging-port=9222`, screenshotted mid-session with the real window manager visible (taskbar, tab strip, Chrome UI chrome), then quit with `SIGTERM` (graceful shutdown, not a hard kill) to let Chrome flush its cache index.

**Environment:** Docker Desktop for Mac, native **ARM64** Ubuntu 24.04 container (no emulation — matches the Apple Silicon host architecture), `google-chrome-stable` **151.0.7922.108** installed via the official Google apt repository (`arch=$(dpkg --print-architecture)`, GPG-verified). Not a Cua VM — see [§5](#5-why-not-a-cua-linux-vm-an-honest-account) for why, and why this is evidentially equivalent for the question asked.

**The three things the reopening comment asked to test explicitly, all resolved in this run:**

- **(a) Headed vs headless:** Both tested. Headed (launch 1, launch 2) → Simple Cache. A **second, separate fresh-profile run in `--headless=new` mode in the same container** was also run for comparison and **also** produced Simple Cache (same magic, same filename shape, cache present from the first session) — see `headless_fresh_cache_tree.txt` / `headless_fresh_index_hex.txt`. In this environment, headless alone did **not** reproduce the CI null result. This narrows, but does not fully close, why the original CI run produced nothing — see [§3's residual open question](#residual-open-question-from-the-ci-attempt--still-unexplained).
- **(b) First vs second+ launch of a persistent profile:** Cache was already present and fully populated (175 entries) after **launch 1**, before any second launch happened. Launch 2 (same `--user-data-dir`, real relaunch after a graceful quit) grew it to 212 entries, same backend throughout. Cache creation is not gated on a second launch.
- **(c) Before vs after first-run/consent state clears:** Launch 1 ran **without** `--no-first-run` or `--disable-fre` — i.e. with real, unsuppressed first-run state — and still produced a full Simple Cache directory during that very session. Cache initialization is not gated on first-run/consent completing.

None of the three CI-null hypotheses from §3 reproduces once the session is headed and driven with a real profile lifecycle. The most likely remaining explanation for the original CI null result is something specific to the GitHub Actions runner environment itself (see §3), not a general property of headless or fresh-profile Chrome.

**Evidence (this run):** [`artifacts/152-branded-cache/linux-desktop-evidence/`](artifacts/152-branded-cache/linux-desktop-evidence/) —
[`environment.txt`](artifacts/152-branded-cache/linux-desktop-evidence/environment.txt),
[`chrome_package.txt`](artifacts/152-branded-cache/linux-desktop-evidence/chrome_package.txt),
[`launch2_final_cache_tree.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_final_cache_tree.txt),
[`launch2_cache_data_listing.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_cache_data_listing.txt),
[`launch2_index_hex.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_index_hex.txt),
[`launch2_the-real-index_hex.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_the-real-index_hex.txt),
[`launch2_sample_entry_hex.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_sample_entry_hex.txt),
[`launch2_simple_cache_filename_count.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_simple_cache_filename_count.txt) (210),
[`launch2_sql_or_blockfile_filename_count.txt`](artifacts/152-branded-cache/linux-desktop-evidence/launch2_sql_or_blockfile_filename_count.txt) (0),
[`headless_fresh_cache_tree.txt`](artifacts/152-branded-cache/linux-desktop-evidence/headless_fresh_cache_tree.txt),
[`headless_fresh_index_hex.txt`](artifacts/152-branded-cache/linux-desktop-evidence/headless_fresh_index_hex.txt),
[`screenshot_launch1_headed_running.png`](artifacts/152-branded-cache/linux-desktop-evidence/screenshot_launch1_headed_running.png),
[`screenshot_launch2_headed_running.png`](artifacts/152-branded-cache/linux-desktop-evidence/screenshot_launch2_headed_running.png).

### Unverified ⚠️ — architecture caveat

This Linux result is from an **ARM64** container (native on the Apple Silicon host); #135's Chrome-for-Testing run and the original §3 CI attempt were both **x86_64** (`ubuntu-latest` GitHub Actions runners). An attempt to also run this same test under x86_64 emulation (Docker Desktop's Rosetta-backed `--platform linux/amd64`) was made and **failed for environmental reasons unrelated to the cache question**: Chrome's GPU process crashed repeatedly and crashpad's `ptrace`-based crash handler itself faults under the emulation layer (`ptrace: Function not implemented`), fatally killing the browser before any cache could be observed — this is the same category of "impractical x86-64 emulation under TCG/Rosetta" problem the ticket already accepts as a reason to rule out local Windows VMs. This was **not pursued further** (would need genuine x86_64 hardware or a cloud VM), and is recorded as an open corroboration gap, not a contradiction: nothing in the Finch cache-backend selection code path (`ChooseCacheType()` in `network_session_configurator.cc`, read directly in #135) branches on CPU architecture, so there is no specific reason to expect x86_64 to differ, but this has not been empirically checked.

---

## 2. Answer: Windows — blockfile, verified on a controlled CI run

**Verified ✅**

Local Windows VMs on Apple Silicon are impractical (see [§4](#4-windows-answered-blockfile-on-a-controlled-ci-run--why-ci-is-admissible-this-time) for the full reasoning), and no Cua cloud credentials are available. Windows was answered instead on `windows-latest` GitHub Actions — but as a **properly controlled experiment**, not a repeat of §3's void attempt: a positive control proves the driven Chrome session actually browsed, and the cache-signature scan does not assume a path.

Branded Google Chrome **151.0.7922.109** (installed via `winget install --id Google.Chrome --exact`, which winget itself logged as resolving and downloading `googlechromestandaloneenterprise64.msi` — a 64-bit branded MSI, not Chrome for Testing) ran **headed** (no `--headless`) on a real `windows-latest` desktop session, with a profile at one `--user-data-dir` surviving two separate launches (start, browse, quit, restart, browse more, quit), real unsuppressed first-run state on launch 1, and the same traffic pattern used on Linux. Two screenshots taken mid-session show the real Windows desktop, taskbar, clock, and Chrome UI rendering live pages (Hacker News, RFC Editor, a Wikipedia article, httpbin) — this was not a headless run.

**Positive control passed:** after the session, `Default\History`'s `urls` and `visits` tables both hold **19 rows**, including every URL in the traffic pattern (`history_positive_control.json`, verdict `LIVE`). This run is admissible — Chrome demonstrably browsed.

**Cache signature scan result, with no path assumed:** a recursive scan of the whole `--user-data-dir` tree, plus `%LOCALAPPDATA%\Google\Chrome` for good measure, found:

```
Default\Cache\Cache_Data\
├── index      24 bytes, first 4 bytes C3 CA 03 C1 (LE 0xC103CAC3)
├── data_0
├── data_1
├── data_2
├── data_3
└── f_000001 .. f_000026
```

`C3 CA 03 C1`, read as a little-endian `uint32`, is `0xC103CAC3` — exactly Chromium's `kIndexMagic` for the **blockfile** backend (`net::disk_cache::BackendImpl`, `net/disk_cache/blockfile/disk_format.h`). The `data_0..data_3` block-files plus `f_######` external-entry files are the classic blockfile layout in full — not a partial or ambiguous match. The scan found **zero** occurrences of the SQL backend's `SQLCache3Sql` string anywhere in either root, and the 16-hex-char Simple Cache filename pattern matched files only in unrelated subsystems (see below) — never in `Default\Cache\Cache_Data`.

**Independent corroboration, same run:** a *second*, entirely separate Chrome profile appeared at the real default location, `%LOCALAPPDATA%\Google\Chrome\User Data\Default` — not the one we drove, not passed any of our flags, evidently started by something else on the runner (plausibly the MSI installer's own post-install verification launch). It **also** wrote `Default\Cache\Cache_Data\{index, data_0, data_1, data_2, data_3}` — the same blockfile file set (no `f_######` files, consistent with far less browsing). This is corroboration by file shape only — its `index` bytes were not separately hex-dumped — but it independently rules out "an artifact of our specific launch flags" as an explanation.

**A necessary aside — other on-disk caches are Simple Cache, and that's expected, not a contradiction:** the same scan found the Simple Cache magic (`30 5C 72 A7 1B 6D FB FC`) in `Code Cache\js`, `Code Cache\wasm`, `Service Worker\ScriptCache`, and `Shared Dictionary\cache`. These are **different Chromium subsystems** — the V8 compiled-code cache, the service worker script cache, and the compression-dictionary cache — each running its own independent `disk_cache` instance via `GeneratedCodeCache` and friends, entirely separate from the network HTTP cache that `net::features::kDiskCacheBackendExperiment` targets (`ProfileNetworkContextService`, per #135). Finding Simple Cache there says nothing about the HTTP cache backend; it confirms the scanner correctly distinguishes cache subsystems by content, not by assumption. `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `GrShaderCache`, and `ShaderCache` also use `data_0..data_3` (without `f_######`) — GPU shader/program caches, likewise unrelated to the HTTP cache.

**Method note — one honest procedural gap:** launch 1's graceful-shutdown attempt (`taskkill /IM chrome.exe`, no `/F`) did not complete within the 20-second window and was escalated to a forced kill; launch 2's graceful shutdown succeeded within the window. The relaunch for launch 2 shows a "Chrome didn't shut down correctly — Restore pages?" bubble in its screenshot as a direct result. This did not block automation (all launch 2 URLs still opened and are present in the positive control's 19 rows) and the final on-disk state examined was written after launch 2's **genuine** graceful shutdown, but the launch1→launch2 transition itself was not the clean graceful-quit called for. Recorded plainly rather than smoothed over.

**Chrome version/architecture:** 151.0.7922.109, 64-bit (`C:\Program Files\Google\Chrome\Application\chrome.exe`, not the `(x86)` path), installed via the standalone enterprise MSI, on Windows 10.0.26100.0 (the `windows-latest` runner image).

**Evidence:** [`artifacts/152-branded-cache/windows-desktop-evidence/`](artifacts/152-branded-cache/windows-desktop-evidence/) — [`chrome_version_and_arch.txt`](artifacts/152-branded-cache/windows-desktop-evidence/chrome_version_and_arch.txt), [`history_positive_control.json`](artifacts/152-branded-cache/windows-desktop-evidence/history_positive_control.json), [`cache_signature_scan.json`](artifacts/152-branded-cache/windows-desktop-evidence/cache_signature_scan.json), [`hexdump_Cache_Data_index.txt`](artifacts/152-branded-cache/windows-desktop-evidence/hexdump_Cache_Data_index.txt), [`udd_full_listing.txt`](artifacts/152-branded-cache/windows-desktop-evidence/udd_full_listing.txt), [`localappdata_chrome_listing.txt`](artifacts/152-branded-cache/windows-desktop-evidence/localappdata_chrome_listing.txt), [`launch_pids.txt`](artifacts/152-branded-cache/windows-desktop-evidence/launch_pids.txt), [`launch1_cdp_version.json`](artifacts/152-branded-cache/windows-desktop-evidence/launch1_cdp_version.json) / [`launch2_cdp_version.json`](artifacts/152-branded-cache/windows-desktop-evidence/launch2_cdp_version.json), [`screenshot_launch1_headed_running.png`](artifacts/152-branded-cache/windows-desktop-evidence/screenshot_launch1_headed_running.png), [`screenshot_launch2_headed_running.png`](artifacts/152-branded-cache/windows-desktop-evidence/screenshot_launch2_headed_running.png). Workflow: [`research-152-windows-controlled.yml`](../.github/workflows/research-152-windows-controlled.yml), run [#31308768294](https://github.com/ChmaraX/forensix/actions/runs/31308768294) (green). Driver: [`152-windows-driver.ps1`](_raw/152-windows-driver.ps1). Positive control: [`152-history-check.py`](_raw/152-history-check.py). Scanner: [`152-cache-scan.py`](_raw/152-cache-scan.py).

---

## 3. Prior attempt: GitHub Actions CI — null result, not an answer

*(Kept for context — this was the resolution comment before the ticket was reopened. The finding below is real and still true; it just isn't an answer to the ticket's question.)*

**Finding:** Branded Chrome 151.0.7922.108 installed on GitHub Actions `windows-latest` and `ubuntu-latest` via official channels (winget/.deb) produced **no cache directory at all** when driven headless with a throwaway profile, one-shot session.

**Verified ✅** — Workflow run [#31261930748](https://github.com/ChmaraX/forensix/actions/runs/31261930748) (green). Both jobs succeeded; Chrome was installed, the browsing session completed without errors, but neither `Default/Cache` nor `Cache_Data` were created on either platform.

**Evidence:** [`windows-branded-cache-evidence/`](artifacts/152-branded-cache/windows-branded-cache-evidence/), [`linux-branded-cache-evidence/`](artifacts/152-branded-cache/linux-branded-cache-evidence/), workflow [`research-152.yml`](../.github/workflows/research-152.yml).

### Residual open question from the CI attempt — still unexplained

§1's headed **and** headless runs, in a real desktop-adjacent Docker/Xvfb environment, both produced Simple Cache immediately, ruling out "headless" as a sufficient explanation on its own. §2's controlled Windows CI run also produced a real cache, on the very same `windows-latest` runner image family as the original null. **This does not explain the original null result — it just confirms the null wasn't inevitable.** The two runs differ in more than one way at once (puppeteer-core's launch path vs a plain CDP HTTP driver; `headless: 'new'` vs headed; `--no-first-run` vs unsuppressed first-run; and critically, the original run had **no positive control**, so whether Chrome ever actually launched or navigated on that run is unknown and unrecoverable after the fact). Stated plainly, per the reopening instruction to record this honestly: **why the original CI attempt produced zero cache anywhere remains unexplained.** It no longer matters for this ticket's question — §1 and §2 both independently confirm real caching happens under a controlled protocol — but it is not resolved, only superseded.

---

## 4. Windows answered: blockfile on a controlled CI run — why CI is admissible this time

Windows was left genuinely blocked once already, on missing Cua cloud credentials. That blocker did not lift — no Cua cloud account or API key became available in this session:

```
$ env | grep -iE "cua|trycua"
(no output)
```

Local Windows VMs on Apple Silicon were separately ruled out: UTM/Parallels both need a human-driven GUI installer for a Windows guest, which an agent session cannot drive. With both the cloud and local-VM routes closed, the decision was made to put Windows back on `windows-latest` GitHub Actions — but deliberately **not** as a repeat of §3's attempt.

**Why the §3 null result does not count as evidence, and why that's not the same as re-running the same experiment:** §3's run never checked whether Chrome actually browsed anything before concluding no cache existed. A silent puppeteer/Chrome launch failure, a navigation that never completed, or a cache written somewhere other than the one path that run checked (`Default\Cache\Cache_Data`) would all have produced the exact same "no cache directory" output. That makes the null result **void** — a broken experiment — not a data point about branded Windows Chrome. Separately, §1's Linux run already tested and cleared the two mechanisms the void result's own three hypotheses rested on: headless alone doesn't suppress caching (both headed and headless produced Simple Cache), and neither does unsuppressed first-run state or a fresh profile (launch 1, before any second launch, already had a full cache). Nothing about the *conditions* §3 used explains a null; only an unverified, possibly-broken run does. Re-running CI is therefore reinstating a tool, not repeating a discredited approach.

**What makes this run admissible where §3 wasn't** — the mandatory design this run had to satisfy:

1. **A positive control.** Count `History` `urls`/`visits` rows after the session. Zero rows would make the run void again, and it would have to be reported as void, not as "no cache." §2's run scored 19/19 — the session demonstrably browsed.
2. **No assumed cache path.** Recursively scan the whole user-data-dir and `%LOCALAPPDATA%\Google\Chrome` for all three backend signatures (`SQLCache3Sql`, the Simple Cache magic, and blockfile filenames), rather than checking only `Default\Cache\Cache_Data` and concluding "not found" if nothing was there.
3. **The Linux recipe, unchanged:** branded Chrome via its official installer (not Chrome for Testing), headed, a profile surviving two separate graceful-shutdown launches, real unsuppressed first-run state on launch 1, the same traffic pattern.
4. **Exact version and architecture recorded**, not inferred after the fact.

The result is in §2: **blockfile**, with a positive control, a no-assumptions scan, and independent same-run corroboration from an unrelated second Chrome instance. Workflow source: [`research-152-windows-controlled.yml`](../.github/workflows/research-152-windows-controlled.yml) (registered on `master` so it could be dispatched against this branch's ref, which carries the driver scripts).

---

## 5. Why not a Cua Linux VM — an honest account

The map's Acquisition tooling note directs this kind of question at Cua. Both of Cua's local Linux options were tried on this Apple Silicon host and found unsuitable, for reasons specific to this host's architecture:

- **`Image.linux(kind="vm")`** (QEMU) — `cua.check_local_support(Image.linux())` reports `software-only` acceleration: Cua's Linux VM path is x86_64-guest-only regardless of host architecture (`cua_sandbox.runtime.compat._x86_guest_hw_accel()` returns `False` with reason *"QEMU cannot use HVF for x86_64 guests on Apple Silicon — TCG software emulation only. Expect slow performance."*). This is the **same category of problem** the ticket already accepts as disqualifying for local Windows VMs.
- **`Image.linux(kind="container")`** (Docker, `trycua/cua-xfce:latest`) — this prebuilt image has **no `linux/arm64` manifest** at all (`docker: no matching manifest for linux/arm64/v8 in the manifest list entries`). Forcing `--platform linux/amd64` to pull it timed out / was impractically slow over the registry.

Both were confirmed by direct command output before pivoting (see the session transcript; `pip install cua`, `brew install lume qemu`, and both failure modes were reproduced, not assumed).

**What was used instead:** a native ARM64 Docker container (no emulation — matches host architecture exactly) running a genuine X11 session (Xvfb + fluxbox window manager, not just a bare display) with **branded** Chrome installed via Google's own official apt repository — i.e. every property the ticket asked for (real desktop session, non-headless, branded install, persistent multi-launch profile) except the specific tool (Cua) used to provision the VM/container. This is offered as a transparent deviation, not a silent one: the destination (a real, non-CI, headed, branded acquisition) was met by a different mechanism than the one named in the Notes, because the named mechanism's own compatibility checker ruled itself out on this host for the same architecture reason the ticket already accepts for Windows.

---

## What this settles and what it doesn't

- **Settled — both halves of #152's question.** A real, currently-updating branded Chrome install, driven headed with a persistent profile across two launches and real unsuppressed first-run state:
  - **Linux:** **Simple Cache** (§1) — corroborates #117's branded-macOS finding.
  - **Windows:** **blockfile** (§2) — corroborates the platform #118 originally assumed, but for a different reason: not a hardcoded platform default, a Finch draw that happened to land on blockfile for this run's client.
  - Neither platform showed the SQL backend that #135 found under Chrome for Testing on both platforms. All three backends are now confirmed real in the wild, just apparently distributed differently by platform and by whether the client has a live Finch seed at all.
- **Not settled:** x86_64-specific corroboration on Linux (attempted, blocked on emulation instability, §1's caveat) and *why* §3's original CI attempt produced zero cache anywhere (superseded, not explained — §3's residual-question note).
- **For v2 planning:** the cache parser needs all three readers — this run raises the stakes on that, rather than lowering them. Windows and Linux now point at *different* backends from the same rollout mechanism, which means a v2 acquisition cannot assume a platform-to-backend mapping at all; detection must be by directory contents on every acquisition, exactly as #135 already recommended, now with real corroborating evidence instead of only a Chrome-for-Testing data point. The blockfile format-details question #118 flagged STILL-UNKNOWN (index header, rankings, allocation bitmap) is worth resolving after all — §2's index hex dump is a start (`index` magic confirmed; block-file internals beyond the header are still unexamined).
