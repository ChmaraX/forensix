# 153 — Linux OSCrypt v11 secret service path with live GNOME/KDE simulation

**Ticket:** [Confirm Linux OSCrypt behaviour with a live secret service (v11/libsecret path)](https://github.com/ChmaraX/forensix/issues/153)

**Scope:** Attempt to trigger Chrome's Linux libsecret/Secret Service key provider path (expected `v11` prefix) by simulating a GNOME or KDE desktop environment in GitHub Actions, building on the failed attempt in [#135](https://github.com/ChmaraX/forensix/issues/135).

**Method:** GitHub Actions workflow on `ubuntu-latest`, Chrome for Testing 151.0.7922.77 (same version as #135), headless with Xvfb + fluxbox window manager, desktop environment variables set (`XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, etc.), live D-Bus session, gnome-keyring-daemon (GNOME) or kwalletd5 (KDE) running. Two matrix jobs: `desktop: [gnome, kde]`. Driver: identical browsing session to #135 (same sites, same cookie-setting traffic). Workflow: [`.github/workflows/research-153.yml`](../.github/workflows/research-153.yml), driver: [`research/_raw/153-driver.js`](../_raw/153-driver.js).

**Run:** [workflow_dispatch #31261700261](https://github.com/ChmaraX/forensix/actions/runs/31261700261), both jobs green, committed to branch `research/153-linux-oscrypt-live`.

---

## 1. Headline finding: Chrome for Testing still produces v10 cookies even with a fully-configured desktop environment simulation

### Verified ✅

**GNOME job:**
- Environment variables set correctly:
  ```
  XDG_CURRENT_DESKTOP=GNOME
  DESKTOP_SESSION=gnome
  GNOME_DESKTOP_SESSION_ID=this-is-deprecated-but-set-anyway
  DISPLAY=:99
  ```
- `gnome-keyring-daemon` running (`ps aux` confirmed, PID 3812)
- D-Bus session bus running
- Xvfb + fluxbox window manager running (X11 display :99)
- **gnome-keyring was functional**: `secret-tool store` and `secret-tool search` both succeeded — the daemon was reachable and responding to D-Bus secret service requests
- **Cookie prefix: `v10`** — all cookies encrypted with the hardcoded "peanuts"/"saltysalt" key, same as #135's "no secret service" case
- **Local State has no `os_crypt` section** — same as #135, confirming Linux never writes key material to Local State regardless of provider

**KDE job:**
- Environment variables set correctly:
  ```
  XDG_CURRENT_DESKTOP=KDE
  DESKTOP_SESSION=kde
  KDE_FULL_SESSION=true
  DISPLAY=:99
  ```
- `kwalletd5` running (`ps aux` confirmed, PID 4994)
- D-Bus session bus running
- Xvfb + fluxbox window manager running
- **Cookie prefix: `v10`**
- **Local State has no `os_crypt` section**

Both jobs used the same `PosixKeyProvider` fallback path (hardcoded v10 key) that #135's "no secret service" job did, despite all the environmental signals and services that should trigger `FreedesktopSecretKeyProvider` / `SecretPortalKeyProvider` (GNOME) or `KWalletKeyProvider` (KDE).

---

## 2. Why this matters: Chrome's desktop environment detection is stricter than just env vars + daemon availability

### Verified ✅

[#127](https://github.com/ChmaraX/forensix/issues/127) documents from Chromium source that the Linux key provider stack has precedence:
1. `FreedesktopSecretKeyProvider` (precedence 10, tries libsecret via D-Bus Secret Service)
2. `SecretPortalKeyProvider` (precedence 10, tries org.freedesktop.portal.Secret)
3. `KWalletKeyProvider` (precedence 10, KDE only)
4. `PosixKeyProvider` (precedence 5, hardcoded "peanuts", always present as fallback)

The selection happens in `browser_process_impl.cc` — unless `--password-store=basic` is passed, Chrome adds the higher-precedence providers before the fallback. **This run did not pass `--password-store=basic`**, so those providers should have been in the stack. Yet Chrome picked the fallback anyway.

The #135 attempt set environment variables but didn't run Xvfb or a window manager. This run added both, plus verified the keyring was actually functional (not just running). Chrome **still** fell back to v10.

**Possible explanations** (none verified, all inference):
1. **Chrome for Testing may disable or lack libsecret support.** CfT has other capability differences from branded Chrome (no App-Bound Encryption per #127/#141, no system-level install support); the secret-service provider path could be similarly missing or stubbed out. The Chromium source shows the code exists, but CfT might not ship the `libsecret-1.so` dependency or might have built with a flag that disables it.
2. **Desktop environment detection may require more than env vars.** `base::nix::GetDesktopEnvironment()` reads `XDG_CURRENT_DESKTOP` and `DESKTOP_SESSION`, but it could also probe for running processes (e.g., `gnome-session`, `plasmashell`) or other session signals (systemd user units, `/proc/<pid>/environ` of session leader) that a bare Xvfb + fluxbox + daemon setup doesn't provide.
3. **The keyring providers might silently fail and fall back.** Even if the provider is in the stack, if the D-Bus query fails or returns an error (wrong permissions, wrong schema, daemon running but not exposing the expected interface), Chrome could silently drop down to the next precedence without logging to stderr. We have no Chrome debug logs to confirm what it actually tried.

### Inconclusive ⚠️ — no verified v11 path evidence yet

**This run does NOT confirm the v11 prefix or the os_crypt Local State shape for a real secret-service case**, because it didn't exercise that path. What it DOES confirm:
- Setting `XDG_CURRENT_DESKTOP` + `DESKTOP_SESSION` + running `gnome-keyring-daemon` is **not sufficient** to make Chrome for Testing use the libsecret path
- The #135 finding ("v10 on Linux with no os_crypt in Local State") extends to **every tested simulation so far**, even ones that look like a real desktop session to shell scripts

Whether a **real, installed, branded Google Chrome** on a **real Ubuntu/Fedora/Debian desktop** with a full GNOME or KDE session produces v11 cookies and an os_crypt Local State entry remains **unconfirmed from empirical acquisition**. The source says it should (#127), but we have no live evidence that the code path is reachable.

---

## 3. Next steps flagged but not executed

This ticket's original question — "what does Chrome on Linux actually do with a real secret service" — is **not answered**, but the gap is now clearer:

1. **Test with branded Chrome, not Chrome for Testing.** If CfT lacks libsecret support entirely, that would explain everything. A real `google-chrome` or `google-chrome-stable` .deb install on a real Ubuntu VM with a real GNOME session is the ground-truth test. This is out of scope for a CI-only run (branded Chrome doesn't have a simple `@puppeteer/browsers install` equivalent, and a full Ubuntu Desktop VM with GUI is heavier than #153's budget).
2. **Check Chrome's stderr/debug logs for key provider selection.** Launch Chrome with `--enable-logging --v=1` and grep for "OSCrypt", "KeyProvider", "libsecret", "gnome-keyring" to see what it actually tried. This run didn't capture those logs.
3. **Verify libsecret linkage in Chrome for Testing.** Run `ldd` on the CfT chrome binary to see if `libsecret-1.so.0` is a linked dependency. If it's missing, that's dispositive.
4. **Try a fuller desktop session.** Run `gnome-session` or `startx` instead of just Xvfb + fluxbox, though this is significantly heavier and may not even work in a container/CI environment.

---

## Evidence

**Workflow run:** https://github.com/ChmaraX/forensix/actions/runs/31261700261  
**Artifacts:**
- GNOME job: [linux-secret-service-evidence-gnome](https://github.com/ChmaraX/forensix/suites/31261701330/artifacts/2265697076)
- KDE job: [linux-secret-service-evidence-kde](https://github.com/ChmaraX/forensix/suites/31261701331/artifacts/2265697077)

**Key files:**
- `cookies_prefix.txt` — all cookies show `b'v10'` prefix (both jobs)
- `local_state_oscrypt_context.txt` — empty, no os_crypt section (both jobs)
- `env_vars.txt` — confirms env vars were set
- `process_list.txt` — confirms `gnome-keyring-daemon` (GNOME) and `kwalletd5` (KDE) were running
- `keyring_test.txt` (GNOME only) — `secret-tool search test test` succeeded, proving the keyring was functional

---

## Limitations

- **Chrome for Testing only.** No branded Chrome acquisition.
- **No Chrome debug logs.** Didn't capture what Chrome actually tried or why it fell back to v10.
- **No libsecret linkage verification.** Didn't check if CfT binary depends on libsecret at all.
- **Simulated desktop, not real.** Xvfb + fluxbox is not a full GNOME/KDE session; some session-detection signals may be missing.
- **KWallet test incomplete.** The `dbus-send` attempt in the KDE job likely failed (no verification that KWallet actually stored a secret), so the KDE result is weaker than GNOME — but both produced v10 regardless.
