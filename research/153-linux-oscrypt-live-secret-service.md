# 153 — Linux OSCrypt v11 secret service path: live GNOME Secret Service, then live GNOME/KDE simulation history

**Ticket:** [Confirm Linux OSCrypt behaviour with a live secret service (v11/libsecret path)](https://github.com/ChmaraX/forensix/issues/153)

**Status: ANSWERED.** A real Secret Service, reached from a real XFCE desktop session with
branded Google Chrome, produces **`v11`-prefixed cookies**. `Local State` gains a new
`os_crypt.portal` status block (`{"prev_desktop": "XFCE", "prev_init_success": true}`) — still no
raw key bytes — and the actual OSCrypt password lives as a real Secret Service item
(`label: "Chrome Safe Storage"`, `schema: chrome_libsecret_os_crypt_password_v2`) inside the
keyring, exactly as `FreedesktopSecretKeyProvider` is documented to do in
[#127](https://github.com/ChmaraX/forensix/issues/127).

This document has two parts, in the order the investigation actually happened:

1. **§1–2 (this session, ANSWERED):** a real Secret Service on a real XFCE desktop with branded
   Chrome, run via [Cua](https://github.com/trycua/cua) locally on Apple Silicon — the map's
   Acquisition tooling rule.
2. **§3 (prior session, kept for history):** GitHub Actions simulation of GNOME/KDE desktop
   environments, which reached `v10` in every configuration and was the reason this ticket was
   reopened — its leading hypothesis ("Chrome for Testing lacks libsecret support") was **wrong**,
   corrected in the reopening comment, and is **not repeated as a conclusion here**.

---

## 1. Headline finding: a real, unlocked default Secret Service collection makes Chrome use `v11`

### Verified ✅

**Method.** [Cua](https://github.com/trycua/cua)'s `trycua/cua-xfce` container image (no arm64
build exists; run under Docker Desktop's `linux/amd64` emulation, `local=True`/no cloud) provides
a real Xtigervnc X server plus a real `startxfce4` session — confirmed by inspecting `ps aux`
inside the running container: `xfce4-session`, `xfwm4`, `xfce4-panel`, `xfdesktop`, `xfsettingsd`,
`at-spi2-registryd`, and a `dbus-daemon --session` all present and connected to the same D-Bus
session bus (verified via `/proc/net/unix`, ~20 live connections on one socket). This is a real
desktop session, not an env-var simulation.

On top of that real session:

- **`gnome-keyring` 42.1-1+b2** and **`libsecret-tools` 0.20.5-3** (Debian 12 bookworm packages)
  installed.
- A **persistent, unlocked, default** Secret Service collection was set up and verified working
  *before* Chrome ever ran — see [§2](#2-getting-a-persistent-default-collection-actually-unlocked-the-hard-part)
  for why this took real effort and is itself part of the finding.
- **Branded Google Chrome Stable 151.0.7922.108** (official `.deb` from
  `dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb`, not Chrome for Testing)
  installed via `apt-get install ./google-chrome-stable_current_amd64.deb`.
- `ldd /opt/google/chrome/chrome | grep secret` returns **nothing** — branded Chrome does not
  dynamically link `libsecret-1.so` at all. It implements the Secret Service D-Bus protocol
  itself (consistent with `freedesktop_secret_key_provider.cc` talking to D-Bus directly); this
  independently confirms the reopening comment's correction that "lacks libsecret support" was
  never a meaningful framing — there is no `libsecret.so` dependency to lack.
- Chrome launched **non-headless** against the real X display (`DISPLAY=:1`, the same one XFCE's
  window manager owns — viewable over the container's VNC/noVNC ports), with
  `--enable-logging=stderr --v=1` attached as instrumentation on this live run (not a rerun of the
  old CI job — this is the "real desktop, logging as a diagnostic extra" the reopening comment
  allowed).
- Visited a local, single-purpose cookie-setting page (`http.server` on `127.0.0.1:8899` setting
  one `Set-Cookie` header) — no case data, no dependency on a flaky third party (`httpbin.org`
  returned intermittent `503`s mid-session and was dropped in favour of this).
- **Quit gracefully**: confirmed via the DevTools `/json` endpoint that the tab had actually
  navigated (not just requested) before sending `SIGTERM` to the browser process. [#117](https://github.com/ChmaraX/forensix/issues/117)
  already established that a cookie set mid-session is invisible on disk in every form until
  Chrome quits — querying `Cookies` while Chrome was still running showed `0` rows even after the
  page had loaded, exactly as #117 predicted, and is not itself evidence of anything going wrong.

**Result — `Cookies` table, after graceful shutdown:**

```
$ sqlite3 chrome-profile-153/Default/Cookies \
    "SELECT host_key,name,path,hex(encrypted_value) FROM cookies;"
127.0.0.1|forensix153|/|763131A5FBF77C0C11D8B5C8F6183420302C53038F082884A558E64F2BE1BDBF83C449112AA0BA026D6BC085DD2F8CC72D238B0B76E2996805B65B1AA83241BB88AF97
```

`0x76 0x31 0x31` = ASCII `"v11"`. **This is the answer to the ticket's central question**: with a
real, reachable, unlocked default Secret Service, Chrome writes `v11`-prefixed cookies, not
`v10`. `FreedesktopSecretKeyProvider` (precedence 10) beat `PosixKeyProvider` (precedence 5, the
`v10` fallback) exactly as [#127](https://github.com/ChmaraX/forensix/issues/127) documented from
source.

**Result — `Local State`:**

```json
{
  "os_crypt": {
    "portal": {
      "prev_desktop": "XFCE",
      "prev_init_success": true
    }
  }
}
```

This **refines** the map's existing "`Local State` carries no `os_crypt` key on Linux" finding
([#117](https://github.com/ChmaraX/forensix/issues/117), extended to Linux by
[#135](https://github.com/ChmaraX/forensix/issues/135)) rather than contradicting it: there is
still **no raw key material** (`os_crypt.encrypted_key`, the Windows-only DPAPI blob, is absent as
expected) — but there **is** now an `os_crypt` block, holding a small status record of desktop
detection and provider-initialisation outcome, that is **absent entirely in the no-secret-service
case** (#135's own evidence showed no `os_crypt` key at all when nothing backs `v10`). A v2 parser
reading `Local State.os_crypt.portal.prev_init_success` can distinguish "this profile's Chrome
successfully reached a key provider beyond the hardcoded fallback" from "it didn't", without
needing to open `Cookies` first.

**Result — where the actual key material lives:**

```
$ secret-tool search --all --unlock application chrome
[/2]
label = Chrome Safe Storage
secret = uNpZKbiEZh4txC6IfYHfAA==
created = 2026-08-09 11:01:42
modified = 2026-08-09 11:01:42
schema = chrome_libsecret_os_crypt_password_v2
attribute.application = chrome
```

Chrome created a real Secret Service item — label `Chrome Safe Storage`, schema
`chrome_libsecret_os_crypt_password_v2`, in the same `login` collection `secret-tool` had already
been used to verify. This item's `secret` is the OSCrypt *password*, which — per
[#127](https://github.com/ChmaraX/forensix/issues/127)'s already-documented KDF (PBKDF2-HMAC-SHA1,
salt `"saltysalt"`) — derives the actual AES-128-CBC key used for the `v11` cookie ciphertext
above. This is forensically significant on its own: **for a copied Linux profile with a reachable,
unlocked GNOME Keyring, `v11` decryption needs the *keyring*, not just the profile directory** —
directly relevant to [#144](https://github.com/ChmaraX/forensix/issues/144)'s GNOME Keyring split,
[#146](https://github.com/ChmaraX/forensix/issues/146).

**Aside — the portal path was not what succeeded here.** Chrome's stderr shows
`WARNING:components/dbus/xdg/portal.cc:124] Failed to register with org.freedesktop.host.portal.Registry`
— a generic XDG portal-registry probe, not `SecretPortalKeyProvider` specifically (no
`xdg-desktop-portal` main dispatcher was installed in this container, only a partial
`org.freedesktop.impl.portal.desktop.gtk` backend pulled in as a `gcr`/`p11-kit` dependency). Per
the reopening comment's correction, `SecretPortalKeyProvider` sits behind
`features::kDbusSecretPortal` and is not the unconditional path; the item found directly in
`org.freedesktop.secrets` (plain D-Bus Secret Service, gnome-keyring's native interface, no portal
involved) is consistent with **`FreedesktopSecretKeyProvider`** — the unconditionally-added
provider — being the one that actually won here, not `SecretPortalKeyProvider`. This is inference
from the evidence available (no explicit "provider selected: Freedesktop" log line was found in
the `--v=1` stderr — OSCrypt provider selection is apparently not logged at that verbosity), flagged
**Unverified** below rather than asserted as fact.

### Unverified ⚠️

- **Which specific provider class won is inferred, not logged.** `--enable-logging=stderr --v=1`
  did not print an explicit "FreedesktopSecretKeyProvider selected" (or equivalent) line. The
  conclusion that it was `FreedesktopSecretKeyProvider` and not `SecretPortalKeyProvider` rests on
  (a) the Secret Service item appearing directly under `org.freedesktop.secrets`, not behind a
  portal object, and (b) the portal registry warning in Chrome's own log. Higher `--vmodule`
  targeting `os_crypt`/`freedesktop_secret` specifically, not attempted here, would likely settle
  this outright.
- **KDE/KWallet was not attempted in this session** — GNOME/libsecret was the stated priority and
  the session budget went entirely to getting one Secret Service case fully verified end-to-end
  (see [§2](#2-getting-a-persistent-default-collection-actually-unlocked-the-hard-part)). Remains
  open, relevant to [#147](https://github.com/ChmaraX/forensix/issues/147).
- **Single run, one cookie, one profile.** Not repeated across multiple cookies/sites or a second
  independent container to rule out a one-off artefact, though the mechanism (a working default
  collection existing before Chrome starts) is well explained by source and by the contrast with
  every prior `v10` attempt lacking exactly that.
- **`--no-sandbox --disable-gpu --in-process-gpu --disable-gpu-sandbox` were required** to get
  Chrome running at all under QEMU's user-mode amd64-on-arm64 emulation (native zygote `fork()`
  and the separate GPU process both failed with `clone: Invalid argument` /
  `GPU process launch failed` without them — an emulation artefact, not an OSCrypt-relevant
  finding). These flags disable process-level sandboxing and GPU process isolation, neither of
  which the OSCrypt key-provider code path (browser process, `chrome/browser/browser_process_impl.cc`)
  runs inside — but a fully default flag set was not tested to independently confirm zero
  interaction. Flagged rather than assumed away.

---

## 2. Getting a persistent, default collection *actually unlocked* — the hard part, and itself informative

### Verified ✅

This took several failed attempts before succeeding, and **the failures are direct, first-hand
evidence for the reopening comment's revised hypothesis** — "no `/org/freedesktop/secrets/aliases/default`
collection, a locked collection, or an unsatisfiable prompt" — rather than "Chrome for Testing
lacks libsecret support":

1. **D-Bus service activation on its own is not enough.** The container's
   `/usr/share/dbus-1/services/org.freedesktop.secrets.service` unit
   (`Exec=/usr/bin/gnome-keyring-daemon --start --foreground --components=secrets`) auto-launches
   a `gnome-keyring-daemon` the instant *anything* — even an unrelated `dbus-send Introspect` probe
   — queries `org.freedesktop.secrets` and no owner exists yet. That auto-started daemon only ever
   exposes a **transient `session` collection** — `Collections` property returns exactly
   `["/org/freedesktop/secrets/collection/session"]` — with **no `login` collection and no
   `default` alias**. This is a live, reproduced instance of exactly the failure mode #135's
   `gnome-keyring` job (and the first #153 attempt) likely hit: a keyring *daemon* running and
   even *responding* to D-Bus (their `secret-tool search` succeeded against the `session`
   collection) is not the same as a **default, persistent** collection existing.
2. **Manually running `gnome-keyring-daemon --login` (the PAM-invoked mode) or `--unlock` outside
   a real PAM login session does not create a `login` keyring from nothing.** Multiple invocations
   (`--start` then separate `--unlock`; `--start --login` combined; `--login` alone; `--start
   --login --replace`) were tried; each either errored ("the --start option is incompatible with
   --login") or produced a daemon process with **no on-disk keyring file and no `login` entry in
   `Collections`** — confirmed by `find ~/.local/share/keyrings -type f` returning nothing and by
   `dbus-send .../aliases/default` erroring `Object does not exist at path
   .../collection/login` (an alias pointing at a collection that was never actually created).
3. **What worked:** seeding `~/.local/share/keyrings/login.keyring` (the plaintext `[keyring]`
   header format, no master-password hash line — an explicitly-unencrypted keyring) and
   `~/.local/share/keyrings/default` (containing the literal string `login`) on disk **before**
   starting the daemon, then `gnome-keyring-daemon --start --components=secrets,pkcs11,ssh`
   followed by `echo -n "" | gnome-keyring-daemon --unlock`. This is the standard headless/CI
   recipe for gnome-keyring (used widely for exactly this reason) — not a workaround invented for
   this ticket, but its necessity here is itself evidence: **a real GNOME desktop's display
   manager does this seeding implicitly via PAM at login** (`pam_gnome_keyring` unlocks/creates the
   login keyring using the user's login password), and a bare `gnome-keyring-daemon` process
   without that PAM integration — exactly what #135's job had — genuinely cannot produce a usable
   default collection on its own, no GUI, no session tricks, nothing missing from Chrome's side.
4. **Verified independently of Chrome, per the ticket's instructions**, before Chrome ran at all:
   - Default alias resolves: `dbus-send .../aliases/default Get ... Label` → `"login"` (previously
     errored "Object does not exist").
   - Collection is unlocked: `dbus-send .../collection/login Get ... Locked` → `false`.
   - `secret-tool store` / `lookup` / `search` all round-tripped a test secret successfully (full
     transcript: [`_raw/153-live-secret-service/keyring-pre-verification.txt`](_raw/153-live-secret-service/keyring-pre-verification.txt)).

This satisfies the map's Notes' "Acquisition tooling" instruction to verify the Secret Service
"from outside Chrome first ... before you run Chrome" in full: alias resolution and unlock state,
not just daemon liveness.

### Unverified ⚠️

- **Whether a real GNOME/XFCE display-manager login (lightdm/gdm + PAM, actually typing a
  password) reaches the same state via a different, more "natural" path** was not tested — this
  session's container has no display manager, so the on-disk seed was the practical substitute.
  The *outcome* (unlocked default collection, `v11` cookies) should be identical either way per
  source, but this specific run did not go through PAM.
- **CreateCollection via the Secret Service D-Bus API was also explored as an alternative** (calling
  `org.freedesktop.Secret.Service.CreateCollection` directly, with a `Prompt` follow-up) and, on
  the auto-activated (no seed file) daemon, the resulting `Prompt.Prompt()` call **hung
  indefinitely** (9s timeout with no `Completed` signal, no visible dialog reachable — `scrot`
  itself failed with an X authority error at the exact moment, not independently investigated
  further). This is a second, independent reproduction of an "unsatisfiable prompt" — consistent
  with, but not conclusively diagnosed as, the reopening comment's third listed cause. Not pursued
  further once the on-disk-seed path succeeded via a different route.

---

## 3. Prior session (kept for history) — GitHub Actions GNOME/KDE simulation, `v10` in every case

**This section is unchanged from the previous version of this document.** It is retained because
the GNOME/KDE simulation work and its evidence remain valid measurements — only the *conclusion*
drawn from them (Chrome for Testing lacks libsecret support) was wrong, per the ticket's reopening
comment, and is superseded by §1–2 above.

**Run:** [workflow_dispatch #31261700261](https://github.com/ChmaraX/forensix/actions/runs/31261700261),
both jobs green, `research-153.yml` on branch `research/153-linux-oscrypt-live`.

**GNOME job:** `XDG_CURRENT_DESKTOP=GNOME`, `DESKTOP_SESSION=gnome`, `gnome-keyring-daemon`
running and functional (`secret-tool store`/`search` succeeded against the transient `session`
collection — **not** a default/persistent one, per §2's finding above), D-Bus session bus, Xvfb +
fluxbox. **Result: `v10` prefix, no `os_crypt` in `Local State`.**

**KDE job:** `XDG_CURRENT_DESKTOP=KDE`, `DESKTOP_SESSION=kde`, `KDE_FULL_SESSION=true`, `kwalletd5`
running, D-Bus session bus, Xvfb + fluxbox. **Result: `v10` prefix, no `os_crypt` in `Local
State`.**

**Why, in hindsight:** both jobs ran Chrome for Testing with a keyring **daemon reachable but no
default/persistent collection ever established** — precisely the condition §2 above reproduces
and explains mechanistically. Nothing here indicates CfT itself lacks libsecret support; §1 already
shows branded Chrome doesn't even link `libsecret.so`, and the reopening comment's source citation
(`browser_process_impl.cc` adding `FreedesktopSecretKeyProvider` unconditionally) is not
build-specific. The gap was environmental, not a Chrome build difference — though this session did
not re-run Chrome for Testing itself in the working configuration to confirm the *identical*
outcome on that specific build (only branded Chrome was tested in §1); flagged as unverified.

Evidence, unchanged from before: workflow artifacts
[linux-secret-service-evidence-gnome](https://github.com/ChmaraX/forensix/suites/31261701330/artifacts/2265697076),
[linux-secret-service-evidence-kde](https://github.com/ChmaraX/forensix/suites/31261701331/artifacts/2265697077).

---

## Evidence (this session)

All files under [`research/_raw/153-live-secret-service/`](_raw/153-live-secret-service/):

- [`setup.sh`](_raw/153-live-secret-service/setup.sh) — annotated transcript of the full recipe
  (Cua/Docker container → real XFCE session → gnome-keyring seed/unlock → branded Chrome →
  graceful shutdown → read results).
- [`session-env.sh`](_raw/153-live-secret-service/session-env.sh) — the exact environment
  (`DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_CURRENT_DESKTOP=XFCE`, `DESKTOP_SESSION=xfce`) both
  the keyring daemon and Chrome ran under.
- [`keyring-pre-verification.txt`](_raw/153-live-secret-service/keyring-pre-verification.txt) —
  default-alias resolution, unlock state, and `secret-tool` round-trip, captured *before* Chrome
  ran.
- [`cookie_server.py`](_raw/153-live-secret-service/cookie_server.py) — the local, single-cookie
  HTTP server used in place of the flaky `httpbin.org`.
- [`chrome-stderr-v1.log`](_raw/153-live-secret-service/chrome-stderr-v1.log) — full
  `--enable-logging=stderr --v=1` output from the run that produced the `v11` cookie.
- [`cookies_query.txt`](_raw/153-live-secret-service/cookies_query.txt),
  [`local_state_os_crypt.json`](_raw/153-live-secret-service/local_state_os_crypt.json),
  [`secret_service_item.txt`](_raw/153-live-secret-service/secret_service_item.txt) — the three
  pieces of result evidence quoted in §1.
- [`create_collection.py`](_raw/153-live-secret-service/create_collection.py),
  [`full_create.py`](_raw/153-live-secret-service/full_create.py),
  [`unlock_login.py`](_raw/153-live-secret-service/unlock_login.py) — the `python3-dbus` scripts
  used while diagnosing the default-collection problem in §2, including the
  `CreateCollection`/`Prompt` hang.

**Environment:** Cua (`pip install cua` 0.1.6), `Sandbox`/`Image` API, Docker runtime,
`trycua/cua-xfce:latest` (`sha256:5d90f09c...`, Debian 12 bookworm, `linux/amd64` under Docker
Desktop emulation on Apple Silicon — no arm64 build of this image exists), run locally
(`local=True`, no cloud). Branded **Google Chrome Stable 151.0.7922.108**. `gnome-keyring`
42.1-1+b2, `libsecret-tools` 0.20.5-3 (both Debian bookworm package versions).

## Limitations

- Emulation flags (`--no-sandbox`, `--disable-gpu`, `--in-process-gpu`, `--disable-gpu-sandbox`)
  were necessary for Chrome to run at all under QEMU user-mode amd64-on-arm64 emulation; see the
  Unverified note in §1 for why this is believed not to affect the OSCrypt result, without a
  same-flags-minus-one control run to prove it.
- KDE/KWallet not attempted this session (GNOME/libsecret was the stated priority given the
  available time).
- One run, one cookie, one profile — not repeated for robustness.
- Which of `FreedesktopSecretKeyProvider` vs `SecretPortalKeyProvider` specifically won is inferred
  from item placement and portal-registry warnings, not an explicit provider-selection log line.
