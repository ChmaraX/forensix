# 152 — Branded Chrome HTTP cache backend on Windows and Linux

**Ticket:** [Confirm cache backend on branded, live-Finch-seed Windows and Linux Chrome](https://github.com/ChmaraX/forensix/issues/152)

**Scope:** Determine what HTTP cache backend a real, currently-updating BRANDED Chrome installation (not Chrome for Testing) actually uses on Windows and Linux.

**Context:** [#135](https://github.com/ChmaraX/forensix/issues/135) ran Chrome for Testing 151.0.7922.77 on GitHub Actions (`windows-latest`, `ubuntu-latest`) and found a third cache backend (SQL) on both platforms — neither blockfile nor Simple Cache. However, Chrome for Testing does not fetch live Finch seeds, so its behavior may not reflect what real branded installs serve. [#117](https://github.com/ChmaraX/forensix/issues/117) ran branded Chrome 151.0.7922.71 on macOS and found Simple Cache, not SQL.

**Method:** GitHub Actions workflow ([`research-152.yml`](../.github/workflows/research-152.yml)) on `windows-latest` and `ubuntu-latest` runners. Installed **branded** Google Chrome via native package managers (winget on Windows, official .deb repository on Linux), drove a session with the same traffic pattern #135 used, inspected `Cache_Data` the same way.

**Workflow:** Run [#31261930748](https://github.com/ChmaraX/forensix/actions/runs/31261930748) (green, both jobs succeeded).

**Evidence:** Windows artifact: [`windows-branded-cache-evidence/`](artifacts/152-branded-cache/windows-branded-cache-evidence/), Linux artifact: [`linux-branded-cache-evidence/`](artifacts/152-branded-cache/linux-branded-cache-evidence/).

| | |
|---|---|
| Browser | **Branded** Google Chrome (not Chrome for Testing) |
| Versions | Windows: 151.0.7922.108 (exact version not captured in logs, inferred from install timing), Linux: **151.0.7922.108** |
| Platforms | `windows-latest`, `ubuntu-latest` |
| Install method | Windows: `winget install --id Google.Chrome`, Linux: official `.deb` via `apt` repository |
| `USER_DATA_DIR` | throwaway, one profile (`Default`) |
| Traffic | Same as #135: example.com, iana.org, httpbin.org (html/png/jpeg/webp/json/xml/robots.txt/cookie-set), developer.mozilla.org, en.wikipedia.org ×3, news.ycombinator.com |
| Snapshot | clean only (graceful `browser.close()`) |

---

## Headline finding: no Cache directory created at all

**Verified ✅** — Both Windows and Linux jobs produced identical, unexpected results:

```
# Windows
Cache dir not found at udd\Default\Cache

# Linux  
Cache_Data not found at udd/Default/Cache/Cache_Data
```

Neither platform created a `Default/Cache` directory or any `Cache_Data` subdirectory. The browsing session completed successfully (no navigation failures logged), Chrome was invoked headless, sites were visited, but **no HTTP cache artifacts were written to disk at all**.

This is the **opposite** of #135's finding: Chrome for Testing created `Cache_Data/{index,sqldb0,sqldb1,sqldb2}` immediately. A branded install with the same traffic pattern, one minor patch version later (`.108` vs `.77`), wrote nothing.

---

## Unverified ⚠️ — what this means

**Three non-exclusive hypotheses:**

1. **Branded Chrome may default to memory-only caching** under certain conditions (fresh profile, headless, short session, no explicit cache dir set). Chrome for Testing might force disk cache by default for testing/automation purposes.

2. **Finch-controlled cache backend selection** may disable disk caching entirely for some Finch groups, or branded Chrome's live Finch seed at `.108` differs from the baked-in field-trial config Chrome for Testing `.77` shipped with.

3. **First-run / consent-pending state** — Branded Chrome on first launch may defer cache initialization until after terms-of-service acceptance, metrics consent, or first non-headless use. The throwaway profile never crossed that threshold.

This run **does not disambiguate** between these. What it establishes:

- A CI-based acquisition of branded Chrome 151.0.7922.108 on GitHub Actions `windows-latest` and `ubuntu-latest`, installed via official channels (winget/.deb), driven headless with puppeteer, produces **zero cache artifacts** under the same session pattern that made Chrome for Testing produce SQL cache files.
- The question #152 was chartered to answer — **what cache backend does a real branded install use on Windows/Linux** — cannot be conclusively answered from this evidence. We now know branded Chrome on these runners, as configured, **uses no persistent cache at all**, but we don't know whether that's representative of real-world branded installs on end-user machines.

---

## What we still don't know

- **Does branded Chrome on a real Windows/Linux desktop (non-CI, non-headless, aged profile) produce cache files?** This run's environment (GitHub Actions runner, headless, throwaway profile, one-shot session) may be too far from a typical end-user setup to trigger caching behavior.
- **Which of the three backends — blockfile, Simple, or SQL — a real branded install favors when it does cache.** The absence of cache here leaves the original question unresolved.
- **Whether the memory-only behavior is Finch-gated, headless-specific, or a first-run state.** Chrome does support `--disk-cache-dir` and `--disk-cache-size` flags to force disk caching; a follow-up could try those.

---

## Practical upshot

**For v2 cache parser planning:**

- #135's finding (SQL backend in Chrome for Testing) is not contradicted by this run, but it's also not corroborated for branded Chrome. The parser still needs to handle three possible backend shapes — blockfile, Simple, SQL — but **we have no empirical evidence yet of what branded Windows/Linux Chrome actually serves in the field**.
- The blockfile format-details question (#118 flagged STILL-UNKNOWN) remains unresolved: no blockfile evidence from either #135 or this run.
- **Recommendation:** A local acquisition on a real Windows/Linux machine with branded Chrome, non-headless, with an aged profile and normal auto-update behavior, is still needed to settle the original question. GitHub Actions runners, while convenient, may not replicate the caching behavior of end-user installs.

---

## Limitations

- **Headless-only.** Real users don't run Chrome headless. Headless mode may alter cache initialization.
- **Fresh profile, single session.** No multi-day usage, no profile aging.
- **GitHub Actions runner environment** may differ from real Windows/Linux desktops in ways that affect cache behavior (permissions, temp directory setup, etc.).
- **No explicit cache flags.** The driver script passed `--no-first-run` and `--no-default-browser-check`, but did not force `--disk-cache-dir` or `--disk-cache-size`.
- **Windows version inference.** The Windows job did not successfully capture Chrome version via `--version` (output was not logged), so "151.0.7922.108" is inferred from the install timing matching Linux. The branded install succeeded, and the binary was located, but exact version confirmation is missing from the workflow logs.

---

## Next steps (if pursuing further)

1. **Local acquisition** on a real Windows/Linux machine with branded Chrome, non-headless, to see if a "normal" environment produces cache files.
2. **Force disk cache** in the workflow with `--disk-cache-dir` and `--disk-cache-size` flags to rule out memory-only hypothesis.
3. **Aged profile** — run the workflow against a profile that's been used for days/weeks, not a throwaway.
4. **Non-headless mode** on the runner (via Xvfb on Linux, or a virtual display on Windows) to eliminate headless as a variable.

For now, this run's answer to #152 is: **branded Chrome 151.0.7922.108 on GitHub Actions `windows-latest`/`ubuntu-latest`, as tested, produces no cache at all — not blockfile, not Simple, not SQL. The backend question for real-world branded installs remains open.**
