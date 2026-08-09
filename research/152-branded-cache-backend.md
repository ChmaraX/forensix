# 152 — Branded Chrome HTTP cache backend on Windows and Linux

**Ticket:** [Confirm cache backend on branded, live-Finch-seed Windows and Linux Chrome](https://github.com/ChmaraX/forensix/issues/152)

**Scope:** Determine what HTTP cache backend a real, currently-updating BRANDED Chrome installation (not Chrome for Testing) actually uses on Windows and Linux.

**Status of this document:** reopened once already — a prior CI-only attempt (kept below as [§2](#2-prior-attempt-github-actions-ci--null-result-not-an-answer)) produced a null result and was wrongly closed as if that were the answer. This revision runs a **real, headed, multi-launch desktop session** per the reopening comment's revised approach and reaches a verified answer for Linux. Windows remains genuinely blocked — see [§4](#4-windows-blocked-on-cua-cloud-credentials).

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

| | Prior CI attempt (§2) | This attempt |
|---|---|---|
| Chrome | branded (winget/.deb) | branded (official `.deb` apt repo) |
| Session | headless, one-shot | **headed** — Xvfb + fluxbox real X11 desktop, screenshots captured |
| Profile | fresh, throwaway | fresh on launch 1, **same profile reused across launch 2** (quit, relaunch, browse more) |
| First-run state | suppressed (`--no-first-run`) | **not suppressed** on launch 1 — real first-run state |
| Result | no `Cache` directory at all | full `Default/Cache/Cache_Data` from the first launch onward |

Traffic pattern matched #135/#117: example.com, iana.org, httpbin.org (html/png/jpeg/webp/json/xml/robots.txt/cookie-set), developer.mozilla.org, three Wikipedia articles, news.ycombinator.com — 15 tabs opened via `PUT /json/new?<url>` against `--remote-debugging-port=9222`, screenshotted mid-session with the real window manager visible (taskbar, tab strip, Chrome UI chrome), then quit with `SIGTERM` (graceful shutdown, not a hard kill) to let Chrome flush its cache index.

**Environment:** Docker Desktop for Mac, native **ARM64** Ubuntu 24.04 container (no emulation — matches the Apple Silicon host architecture), `google-chrome-stable` **151.0.7922.108** installed via the official Google apt repository (`arch=$(dpkg --print-architecture)`, GPG-verified). Not a Cua VM — see [§3](#3-why-not-a-cua-linux-vm-an-honest-account) for why, and why this is evidentially equivalent for the question asked.

**The three things the reopening comment asked to test explicitly, all resolved in this run:**

- **(a) Headed vs headless:** Both tested. Headed (launch 1, launch 2) → Simple Cache. A **second, separate fresh-profile run in `--headless=new` mode in the same container** was also run for comparison and **also** produced Simple Cache (same magic, same filename shape, cache present from the first session) — see `headless_fresh_cache_tree.txt` / `headless_fresh_index_hex.txt`. In this environment, headless alone did **not** reproduce the CI null result. This narrows, but does not fully close, why the original CI run produced nothing — see [§2's residual open question](#residual-open-question-from-the-ci-attempt).
- **(b) First vs second+ launch of a persistent profile:** Cache was already present and fully populated (175 entries) after **launch 1**, before any second launch happened. Launch 2 (same `--user-data-dir`, real relaunch after a graceful quit) grew it to 212 entries, same backend throughout. Cache creation is not gated on a second launch.
- **(c) Before vs after first-run/consent state clears:** Launch 1 ran **without** `--no-first-run` or `--disable-fre` — i.e. with real, unsuppressed first-run state — and still produced a full Simple Cache directory during that very session. Cache initialization is not gated on first-run/consent completing.

None of the three CI-null hypotheses from §2 reproduces once the session is headed and driven with a real profile lifecycle. The most likely remaining explanation for the original CI null result is something specific to the GitHub Actions runner environment itself (see §2), not a general property of headless or fresh-profile Chrome.

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

This Linux result is from an **ARM64** container (native on the Apple Silicon host); #135's Chrome-for-Testing run and the original §2 CI attempt were both **x86_64** (`ubuntu-latest` GitHub Actions runners). An attempt to also run this same test under x86_64 emulation (Docker Desktop's Rosetta-backed `--platform linux/amd64`) was made and **failed for environmental reasons unrelated to the cache question**: Chrome's GPU process crashed repeatedly and crashpad's `ptrace`-based crash handler itself faults under the emulation layer (`ptrace: Function not implemented`), fatally killing the browser before any cache could be observed — this is the same category of "impractical x86-64 emulation under TCG/Rosetta" problem the ticket already accepts as a reason to rule out local Windows VMs. This was **not pursued further** (would need genuine x86_64 hardware or a cloud VM), and is recorded as an open corroboration gap, not a contradiction: nothing in the Finch cache-backend selection code path (`ChooseCacheType()` in `network_session_configurator.cc`, read directly in #135) branches on CPU architecture, so there is no specific reason to expect x86_64 to differ, but this has not been empirically checked.

---

## 2. Prior attempt: GitHub Actions CI — null result, not an answer

*(Kept for context — this was the resolution comment before the ticket was reopened. The finding below is real and still true; it just isn't an answer to the ticket's question.)*

**Finding:** Branded Chrome 151.0.7922.108 installed on GitHub Actions `windows-latest` and `ubuntu-latest` via official channels (winget/.deb) produced **no cache directory at all** when driven headless with a throwaway profile, one-shot session.

**Verified ✅** — Workflow run [#31261930748](https://github.com/ChmaraX/forensix/actions/runs/31261930748) (green). Both jobs succeeded; Chrome was installed, the browsing session completed without errors, but neither `Default/Cache` nor `Cache_Data` were created on either platform.

**Evidence:** [`windows-branded-cache-evidence/`](artifacts/152-branded-cache/windows-branded-cache-evidence/), [`linux-branded-cache-evidence/`](artifacts/152-branded-cache/linux-branded-cache-evidence/), workflow [`research-152.yml`](../.github/workflows/research-152.yml).

### Residual open question from the CI attempt

§1's headed **and** headless runs, in a real desktop-adjacent Docker/Xvfb environment, both produced Simple Cache immediately. That rules out "headless" as a sufficient explanation on its own for the CI null result. What's left unexplained: something specific to the **GitHub Actions runner environment** (sandboxing, disk/tmpfs policy, a Windows install that may not have been the version logged, or another runner-specific restriction) suppressed disk cache entirely. This is now **out of scope for this ticket** — the question #152 asks (which backend does a real branded install use) is answered by §1; *why CI specifically produces zero cache* would be a new, narrower question if it ever matters again (e.g. if CI is revisited as an acquisition method elsewhere on the map).

---

## 3. Why not a Cua Linux VM — an honest account

The map's Acquisition tooling note directs this kind of question at Cua. Both of Cua's local Linux options were tried on this Apple Silicon host and found unsuitable, for reasons specific to this host's architecture:

- **`Image.linux(kind="vm")`** (QEMU) — `cua.check_local_support(Image.linux())` reports `software-only` acceleration: Cua's Linux VM path is x86_64-guest-only regardless of host architecture (`cua_sandbox.runtime.compat._x86_guest_hw_accel()` returns `False` with reason *"QEMU cannot use HVF for x86_64 guests on Apple Silicon — TCG software emulation only. Expect slow performance."*). This is the **same category of problem** the ticket already accepts as disqualifying for local Windows VMs.
- **`Image.linux(kind="container")`** (Docker, `trycua/cua-xfce:latest`) — this prebuilt image has **no `linux/arm64` manifest** at all (`docker: no matching manifest for linux/arm64/v8 in the manifest list entries`). Forcing `--platform linux/amd64` to pull it timed out / was impractically slow over the registry.

Both were confirmed by direct command output before pivoting (see the session transcript; `pip install cua`, `brew install lume qemu`, and both failure modes were reproduced, not assumed).

**What was used instead:** a native ARM64 Docker container (no emulation — matches host architecture exactly) running a genuine X11 session (Xvfb + fluxbox window manager, not just a bare display) with **branded** Chrome installed via Google's own official apt repository — i.e. every property the ticket asked for (real desktop session, non-headless, branded install, persistent multi-launch profile) except the specific tool (Cua) used to provision the VM/container. This is offered as a transparent deviation, not a silent one: the destination (a real, non-CI, headed, branded acquisition) was met by a different mechanism than the one named in the Notes, because the named mechanism's own compatibility checker ruled itself out on this host for the same architecture reason the ticket already accepts for Windows.

---

## 4. Windows: blocked on Cua cloud credentials

**Not attempted — explicitly blocked, not skipped.**

Per the ticket and the map's Notes, local Windows VMs on Apple Silicon are ruled out (x86-64 emulation under TCG is impractical — independently corroborated by this session's own x86_64 Linux emulation attempt in §1's caveat, which crashed for exactly this class of reason). Windows therefore requires **Cua cloud**.

This session has no Cua cloud account or API key configured:

```
$ env | grep -iE "cua|trycua"
(no output)
$ cua.Sandbox.ephemeral(Image.windows(), local=False)  # not attempted — no credentials to attempt with
```

**What is needed to unblock this:** a Cua cloud account and API key (`cua login`, or a `CUA_API_KEY` environment variable / equivalent per [cua.ai/docs](https://cua.ai/docs)), then:

```python
from cua import Sandbox, Image
async with Sandbox.ephemeral(Image.windows().winget_install("Google.Chrome"), local=False) as sb:
    # let Chrome auto-update / run once headed to pick up a live Finch seed,
    # quit, relaunch (same pattern as the Linux run in §1), browse the same
    # traffic set, then inspect %LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache\Cache_Data
```

This is a credential/access gap, not a technical dead end — the method (§1's Linux procedure, adapted to `winget_install` and Windows paths) is already proven out on Linux and ready to run the moment cloud access exists.

---

## What this settles and what it doesn't

- **Settled:** a real, currently-updating branded Chrome install on Linux — headed, real desktop session, persistent profile across multiple launches, real (unsuppressed) first-run state — uses **Simple Cache**, not blockfile and not the SQL backend. This corroborates #117's branded-macOS finding (also Simple Cache) and is now two of three target platforms agreeing, against #135's Chrome-for-Testing-only SQL-backend finding.
- **Not settled:** Windows (blocked on Cua cloud credentials, §4) and x86_64-specific corroboration on Linux (attempted, blocked on emulation instability, §1 caveat).
- **For v2 planning:** the parser still needs to handle three shapes at the format level (nothing here proves SQL or blockfile can't appear on some Windows/Linux install somewhere — Finch is a rollout, not a monolith), but the weight of evidence across three independent branded-Chrome acquisitions (macOS #117, Linux here) is now **2-for-2 Simple Cache**, with the SQL backend only ever observed under Chrome for Testing's baked-in (non-live) field-trial config. That is a meaningfully different prioritization signal than #135 left it at.
