# Research: Forensically sound acquisition of Chrome browser data, and what ForensiX v2 should accept as input

> **TOOLING DISCLOSURE.** This run had **no web search and no fetch tool** — the exposed tool set was Read / Write / intercom only. Nothing below was retrieved live. Every factual claim is therefore labelled:
>
> - **[VK]** — *Verified by knowledge*: durable, well-established forensic practice or stable technical fact. State plainly; low risk.
> - **[UNV]** — *Unverified*: version-sensitive, path-sensitive, or a claim about a named third-party tool's current behaviour. Each has a verification entry in §7 with a URL, what to look for, and the expected answer shape.
>
> The recommendation in §0 rests on **[VK]** claims only. No **[UNV]** item, if wrong, overturns the recommendation — the worst case is that a path string or a tool-name example needs correcting in the docs.

---

## 0. Recommendation: the v2 input contract

**Stop accepting "a copied profile folder in `./data`" as the only input. Accept a *source* that ForensiX classifies into one of five kinds, and be explicit about the forensic soundness of each.** *(Design recommendation, derived from [VK] claims below.)*

| # | Source kind | What it is | v2 support |
|---|---|---|---|
| 1 | `USER_DATA_DIR` | Directory containing `Local State` **and** one or more profile dirs (`Default`, `Profile 1`, `System Profile`, `Guest Profile`) | **Canonical. The unit of acquisition is the User Data dir, not the profile dir.** |
| 2 | `PROFILE_DIR` | A single profile dir with `History`/`Preferences` but no `Local State` | Accept in **degraded mode** with a structured capability warning (no cookie/password decryption). Allow `--local-state` and `--cache-dir` to be supplied separately — needed on macOS/Linux where the cache lives outside the profile. |
| 3 | `FILESYSTEM_ROOT` | Mounted disk image, mounted snapshot, or extracted filesystem tree | **Support this.** Enumerate *all users × all Chromium-family browsers × all profiles*. This is what investigators actually hold. |
| 4 | `ACQUISITION_BUNDLE` | Output of a first-party `forensix-collect`: files + `manifest.json` (per-file SHA-256, size, MACB timestamps, original absolute path, acquisition method, operator, host, tool+version, UTC times) + collection log | **Build this.** The only path where ForensiX can make an integrity claim it can actually back. Directly feeds issue #125. |
| 5 | `IMAGE_CONTAINER` | E01/Ex01/AFF4/raw `dd`/VMDK | **v2.0: document "mount it yourself" and consume the mount point as kind 3.** Native container parsing is a v2.x stretch goal. |

Non-negotiable behavioural rules that ship with the contract:

1. **Never instruct a user to `cp -r` a live profile.** [VK] Copying an open SQLite database with `cp` risks a torn/inconsistent page image, and on POSIX it also mutates access timestamps on the original. It is both unsound and destructive.
2. **Treat `Local State` as mandatory.** [VK] It holds the wrapped profile encryption key. Without it, encrypted cookie values and `Login Data` password blobs cannot be decrypted at all. v1's README captures the profile dir only, so it *structurally cannot* decrypt anything.
3. **Always capture SQLite sidecars.** [VK] For every SQLite file also take `-wal`, `-shm`, `-journal`. A hot `-wal` that is left behind silently drops the most recent activity.
4. **Never open evidence read-write.** [VK] Mount `:ro`, then copy the DB set to container-local scratch and parse the copy, so SQLite may legitimately replay the WAL without touching evidence. Do not use `immutable=1` as the general solution — it makes SQLite ignore the WAL, trading corruption risk for data loss.
5. **Hash on ingest, re-hash on close, be honest about what that proves.** [VK] ForensiX can prove "what I was handed matches the manifest I was handed" and "I did not alter it". It cannot prove the manifest matches the original machine. It does not create chain of custody.
6. **Emit a machine-readable acquisition/analysis report**: source kind, per-file SHA-256, per-file verification result, expected-but-missing files, per-database WAL state, tool version, UTC timestamps. Missing/unverified files are first-class findings in the UI, not log noise.

---

## 1. Acquisition methods and forensic soundness

**Governing principles.**
- [VK] The ACPO/NPCC *Good Practice Guide for Digital Evidence* Principle 1: no action taken should change data held on a device. Principle 2: where it is necessary to access original data, the person must be competent and able to explain the relevance and implications of their actions. **This is the doctrine that legitimises live acquisition** — live collection is accepted practice provided it is justified and documented.
- [VK] NIST SP 800-86 establishes order of volatility (collect most-volatile first: RAM, network state, then disk) and bit-for-bit media imaging.
- [VK] ISO/IEC 27037 covers identification, collection, acquisition and preservation of digital evidence, including custody documentation.
- [UNV] The precise SWGDE document titles and current revision numbers (e.g. *Best Practices for Computer Forensic Acquisitions*, *Best Practices for Digital Evidence Collection*) — see §7-V4.

**Powered-off / "dead box".** [VK]
- Preferred where possible: hardware write blocker + full physical image to E01 or raw.
- **Preserves**: unallocated space, file slack, deleted files, filesystem journals, Volume Shadow Copy stores (historical `History`/`Cookies` copies), Registry hives, hibernation/page files.
- **Loses**: all volatile state — RAM, decrypted keys in memory, running-process context. On a full-disk-encrypted system with no key, an offline image is an opaque blob.
- **Do not boot the suspect machine.** [VK]
- [UNV] Whether a specific write blocker or imaging tool has a current NIST CFTT test report — §7-V5.

**Live logical / triage collection.** [VK]
- Justified when: FDE is active and the key is only available live; the machine cannot be taken down; volatile artefacts matter; scale/time constraints.
- **Preserves**: file content and, if the collector records them, MACB timestamps, ownership, original paths.
- **Loses**: unallocated space, deleted-but-unreferenced files, filesystem journals, snapshot history, file slack.
- **Costs**: it touches the source system (process execution, prefetch, event log entries). This must be documented, not hidden.

**Volume Shadow Copy (Windows).**
- [VK] A VSS snapshot is the accepted answer to the locked-file problem on Windows: create a point-in-time snapshot, open the snapshot device, copy the locked files from that consistent view.
- [VK] Pre-existing shadow copies are *also* an evidence source — earlier versions of `History`, `Cookies`, `Web Data`, `Login Data`. This is often the highest-value browser evidence on the machine, and a naive live `cp` discards it entirely.
- [VK] VSS is NTFS/Windows-only. macOS equivalent is APFS local snapshots; Linux relies on LVM/btrfs/ZFS snapshots, which are usually absent on a workstation. In practice on macOS/Linux you either image the disk or accept a live logical copy.
- [UNV] Exact invocation syntax and current flags for `vssadmin`/`diskshadow`/`vshadow`, and whether a named tool exposes VSS collection by a specific flag — §7-V6.

**macOS specifics.**
- [VK] FileVault2 plus modern Apple silicon/T2 secure storage means a full-disk image of a modern Mac normally yields ciphertext unless the user password or recovery key is available. The mainstream accepted practice is a **live logical acquisition with admin credentials**.
- [VK] On macOS the Chrome storage secret lives in the login Keychain, not solely in `Local State` — so the Keychain must be collected too, or decryption is impossible.
- [UNV] Current DFU/target-disk-mode acquisition workflow details for Apple silicon — §7-V7 (low blast radius; not needed for the input contract).

**Ranking for evidentiary weight.** [VK] Full physical image (write-blocked, verified) > snapshot-based targeted collection with manifest > live logical collection with manifest > ad-hoc `cp -r` of a running profile (what v1 asks for — the weakest option and forensically unsound).

---

## 2. The locked-file / hot-WAL problem

**What Chrome holds open.**
- [VK] While Chrome runs it keeps SQLite databases open (history, cookies, saved credentials, autofill/web data, favicons, top sites, and a long tail of feature databases), plus LevelDB stores (Local Storage, Session Storage, IndexedDB, extension state) and its own cache format.
- [UNV] The exact current file names and their relative locations (e.g. whether `Cookies` sits in `Network/` in the version under test) — §7-V1.

**Windows behaviour.** [VK] Chrome opens these files with a share mode that causes a plain copy to fail with a sharing violation. Practitioners resolve this with VSS or by reading NTFS structures directly through a raw volume handle.

**macOS/Linux behaviour.** [VK] POSIX locking is advisory, so `cp -r` **succeeds and lies** — you can capture a page-torn database mid-transaction with no error. SQLite's own documentation identifies copying a database while a transaction is in progress as a corruption mechanism, and points at the Backup API / `VACUUM INTO` / `.dump` instead — none of which are acceptable for evidence, because they write or normalise and thereby destroy freelist content. For forensics the answer is a snapshot, or copy-the-whole-set-and-document-the-risk.

**What a hot WAL means.** [VK]
- In WAL mode, committed transactions live in `<db>-wal` until a checkpoint folds them into the main file. **Copy only the main DB and you silently lose everything since the last checkpoint** — typically the most recent browsing session, i.e. the part the investigator cares about most.
- `<db>-shm` is a regenerable shared-memory index; never treat it as authoritative, but copy it to keep the set complete.
- The WAL is *itself* evidence: it holds prior versions of pages, so records deleted from the logical tables can survive as older frames. Checkpointing, or a tool "helpfully" cleaning up, destroys that.
- [UNV] Which specific Chrome databases are in WAL mode in which Chrome versions. Chromium's journal modes have changed over releases and vary per database. **v2 must detect the mode at runtime rather than assume it** — §7-V1 (highest blast radius of the UNV set).

**Practitioner handling — the pattern v2 should implement.** [VK]
1. Acquire main DB + `-wal` + `-shm` + `-journal` as an atomic set (snapshot if possible; if not, record that they were copied sequentially and may be mutually inconsistent).
2. Hash all of them at acquisition time.
3. Analyse a *working copy*; never the original.
4. Parse in two passes: (a) normal open, letting SQLite recover the WAL, for current logical state; (b) raw carving of freelist pages, unallocated database space, and the WAL for deleted/superseded records.
5. Report the delta between (a) and (b). Deleted-record recovery is a headline feature and is only possible if the WAL was captured.
- [UNV] Names/current maintenance status of specific carving tools (`sqlparse`, `undark`, `bring2lite`, WAL-aware carvers) — §7-V8 (low blast radius; they are examples, not dependencies).

---

## 3. What must be captured

**[VK] The unit of acquisition is the *User Data* directory, not a single profile.** This is the single most important structural correction to v1.

**[VK] Structurally certain, independent of exact paths:**
- The wrapped encryption key lives at the User Data root (`Local State`), *outside* every profile directory.
- On macOS and Linux, Chrome's HTTP cache is stored under the OS cache directory, **not** inside the profile directory. On Windows it is inside the profile. Any tool that copies only the profile dir loses the cache on two of three platforms.
- Multiple profiles (`Default`, `Profile 1`, …) plus Guest and System profiles can coexist; the profile list itself is in `Local State`.

**[UNV] Exact per-OS paths — verify before writing into docs (§7-V2):**

| OS | User Data root (expected) | Cache (expected) |
|---|---|---|
| Windows | `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\` | inside the profile |
| macOS | `~/Library/Application Support/Google/Chrome/` | `~/Library/Caches/Google/Chrome/` — outside the profile |
| Linux | `~/.config/google-chrome/` | `~/.cache/google-chrome/` — outside the profile |

[UNV] Family/packaging variants to enumerate: Chrome Beta/Dev/Canary, Chromium, Edge, Brave, Opera, Vivaldi; Snap and Flatpak relocate the whole tree under `~/snap/...` and `~/.var/app/...` respectively — §7-V2.

**[UNV] File inventory inside a profile** (history, bookmarks, cookies, login data, web data, favicons, top sites, shortcuts, visited links, sessions/tabs, extensions and extension state, Local Storage/Session Storage/IndexedDB/Service Worker LevelDB stores, network state files, cache and code cache). The *categories* are [VK]; the *exact filenames in the current Chrome version* are [UNV] — §7-V1. **Design implication: v2 should discover artefacts by probing for known-shape files, not by hardcoding a filename list.**

**[VK] Outside the Chrome tree entirely — required for decryption:**
- **Windows**: DPAPI master keys under the user's roaming profile, plus `NTUSER.DAT` and the `SAM`/`SYSTEM`/`SECURITY` hives, are needed to unwrap the key offline. Also corroborating: Timeline/activity database, SRUM, Prefetch, jump lists, Registry Chrome keys, Recycle Bin, and the downloaded files themselves.
- **macOS**: the login keychain, which holds the Chrome storage password.
- **Linux**: GNOME Keyring / KWallet; Chrome falls back to a well-known hardcoded passphrase when no keyring backend is available.
- [UNV] Chrome's **App-Bound Encryption** (introduced around Chrome 127) wraps the key with a SYSTEM-level protection plus an application-identity check, materially reducing offline/dead-box decryptability and pushing toward SYSTEM-level live collection. Version number, prefix tag, and current offline feasibility all need checking — §7-V3. **This is the second-highest blast radius item: it changes what v2 can promise about password/cookie decryption.**

**Actionable finding against this repo (severity: HIGH).** `README.md`, "Prepare your browser data" step (~lines 72–80), instructs `cp -r "…/Google/Chrome/Default/." ./data/`. Four independent defects, all [VK]:
1. Omits `Local State` → decryption is impossible, permanently, by construction.
2. On macOS (the example given) omits the entire cache tree → the advertised Cache feature has no data to read.
3. Copies a live profile → torn SQLite pages, missing hot WAL, and mutation of the source.
4. Flattens to one profile → multi-profile, Guest and System profiles are invisible.
These must be fixed together as one input-contract change, not patched individually.

---

## 4. What investigators realistically hold, and what comparable tools accept

**[VK] Realistic inputs, roughly by frequency:**
1. **A mounted disk image** — the examiner has already mounted E01/raw read-only with a commercial or open-source mounter and hands the tool a *path*.
2. **A triage collection folder or archive** — a directory tree mirroring original paths, usually with a hash manifest.
3. **The raw image container itself**, for tools that parse containers natively.
4. **A live machine** they are running a collector on.

**[VK] Structural conclusion, independent of any tool name:** a directory input is table stakes; a *filesystem-root* input (auto-discover users, browsers and profiles) is what separates a demo from a usable tool; native container parsing is optional because examiners already mount.

**[UNV] Comparable tools' current input contracts — all need checking (§7-V9):**
- **Hindsight** — expected to take a path to a Chrome profile directory, with a separate cache path option, outputting XLSX/SQLite/JSONL. Closest analogue; check whether it now handles `Local State` and multi-profile.
- **Autopsy / The Sleuth Kit** — expected to ingest disk images *and* logical folders and auto-locate browser artefacts across all users. This is the model for `FILESYSTEM_ROOT`.
- **KAPE, Velociraptor, CyLR, UAC** — collectors that produce input; expected to write per-file hash manifests, and KAPE to support VSS.
- **Magnet AXIOM / Belkasoft / X-Ways / FTK** — expected to accept E01/raw/VMDK/VHD, mounted volumes, *and* loose folders. Multi-input is the industry norm.
- **libewf / `ewfmount`, `dfVFS`** — candidate dependencies for the stretch-goal `IMAGE_CONTAINER` support.

---

## 5. Integrity, hashing, and chain of custody  *(feeds issue #125)*

**[VK] Integrity is established at acquisition, not downstream.**
- Imaging tools hash the source during acquisition and verify the resulting image afterwards; a match is the integrity claim.
- The E01 format stores hashes inside the container and checksums each data chunk, so corruption is both detectable and localisable. AFF4-style containers store hashes in metadata.
- For logical collections the norm is a **per-file manifest**, not a single blanket hash. A single hash over a folder is meaningless unless it is a hash of a container whose construction is deterministic.
- Chain of custody is documentary: who collected what, when, where, why, and every subsequent transfer. **No analysis tool creates chain of custody**; it can only append an auditable analysis record.

**[VK] Algorithm guidance.** MD5 and SHA-1 remain widely used and are still accepted in practice for evidence integrity (the practical attacks are chosen-prefix collisions, not preimage attacks against an already-fixed artefact), but SHA-1 is deprecated for new applications.
**Recommendation: SHA-256 as primary; optionally emit MD5 alongside for interoperability with legacy case management. Never SHA-1 alone.**
- [UNV] The precise NIST publication and wording deprecating SHA-1 (SP 800-131A revision / NIST SHA-1 retirement announcement) — §7-V4.

**[VK] What ForensiX can and cannot verify.**
- *Can*: verify supplied files against a supplied manifest; detect change in transit or storage; hash everything at ingest to fix a reference point; prove it did not modify the evidence (re-hash at session close and diff); log every artefact read and every file expected but not found.
- *Cannot*: attest that the manifest matches the original device; attest that acquisition was sound or complete; establish custody; detect anti-forensics performed before acquisition.

**Actionable finding against this repo (severity: MEDIUM-HIGH).** `README.md` Features claims *"preserving integrity through manipulation process — read only, hash checking"*. With a `cp -r` of a live profile as the documented input, that claim is not supportable — an unsupportable integrity claim is worse than none. v2 should scope it precisely: *"ForensiX verifies and preserves the integrity of the evidence as supplied to it; it does not perform or attest acquisition unless `forensix-collect` was used."*

---

## 6. Where I am confident, stated plainly

No hedging on these — they are durable practice, not version trivia:
- Live acquisition is legitimate and routine when justified and documented; ACPO Principle 2 is the standard justification.
- Order of volatility: volatile memory before disk.
- A full write-blocked physical image is the highest-weight acquisition; ad-hoc live `cp` is the lowest.
- VSS is *the* Windows answer to locked browser databases, and pre-existing shadow copies are independently valuable evidence.
- Copying a live SQLite database with `cp` is unsafe and can yield a corrupt artifact.
- A hot WAL not captured = the most recent session silently missing.
- The WAL contains recoverable deleted records; checkpointing destroys them.
- `Local State` sits outside the profile dir and is required for decryption; capturing only the profile dir is a permanent capability loss.
- macOS/Linux put the cache outside the profile dir.
- Per-file manifests, not a single folder hash, are the norm for logical collections.
- A downstream analysis tool cannot establish chain of custody and must not claim to.

---

## 7. Verification queue — ranked by blast radius

Ranked by impact on issue #121 (input contract) and issue #125 (integrity model).

### V1 — SQLite filenames and journal modes in current Chrome. **Blast radius: HIGH (#121)**
- **URL**: https://source.chromium.org/chromium/chromium/src — search `journal_mode`, `set_wal_mode`, `sql::Database::Open` under `components/history/core/browser`, `net/extras/sqlite`, `components/password_manager/core/browser`, `components/autofill`. Also https://chromium.googlesource.com/chromium/src/+/main/docs/
- **Look for**: which databases explicitly enable WAL; the current on-disk filenames; whether `Cookies` lives under a `Network/` subdirectory.
- **Expected shape**: a per-database list of `{filename, relative path, journal mode, since-version}`. Expect WAL on at least cookies, and expect variation across databases and versions.
- **Why it matters**: determines whether v2 hardcodes filenames (fragile) or probes (robust), and whether WAL handling is a special case or the default path. **Recommended outcome regardless of result: probe at runtime, report detected mode per database.**

### V2 — Exact per-OS User Data and cache paths, plus Snap/Flatpak/other-browser variants. **Blast radius: HIGH (#121)**
- **URL**: https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md
- **Look for**: the canonical table of default user data directories per platform and channel; the separate cache directory on macOS/Linux.
- **Expected shape**: a path table per {OS, channel}. Confirm the three rows in §3 and collect the Beta/Dev/Canary/Chromium variants; Snap/Flatpak paths will need separate confirmation (distro packaging docs).
- **Why it matters**: the `FILESYSTEM_ROOT` scanner's discovery list is exactly this table. Wrong paths = silent zero-results.

### V3 — App-Bound Encryption: version, blob prefix, offline feasibility. **Blast radius: HIGH (#121 scope, #125 claims)**
- **URLs**: https://security.googleblog.com/ (search "app-bound encryption" / cookie security, 2024); Chromium source `components/os_crypt/`.
- **Look for**: the Chrome version it shipped in, the ciphertext prefix tag, whether the key is recoverable from a dead-box image given SYSTEM DPAPI material, and any documented offline path.
- **Expected shape**: "shipped in Chrome NNN; blobs prefixed `vNN`; offline recovery requires X" — plus current third-party research on feasibility.
- **Why it matters**: decides whether v2 may advertise cookie/password decryption at all for recent Chrome, and whether `ACQUISITION_BUNDLE` must support privileged live collection.

### V4 — Standards citations: SWGDE document titles/revisions, NIST SHA-1 deprecation, ISO/IEC 27037. **Blast radius: MEDIUM (#125)**
- **URLs**: https://www.swgde.org/documents/ ; https://csrc.nist.gov/publications/detail/sp/800-86/final ; https://csrc.nist.gov/publications/detail/sp/800-131a/rev-2/final ; ISO catalogue entry for 27037.
- **Look for**: exact current titles + revision numbers/dates for the acquisition and evidence-collection best-practice documents; NIST's precise wording on SHA-1 status.
- **Expected shape**: citable title + revision + year per document.
- **Why it matters**: the integrity model's credibility rests on citing real, current documents. The *practice* claims are safe; the *citations* need to be exact.

### V5 — NIST CFTT: current scope and whether it still publishes imaging/write-blocker reports. **Blast radius: MEDIUM (#125)**
- **URL**: https://www.nist.gov/itl/ssd/software-quality-group/computer-forensics-tool-testing-program-cftt
- **Look for**: active specification documents (disk imaging tool spec, write blocker spec) and recency of published reports.
- **Expected shape**: a list of specs + a report archive with dates.

### V6 — VSS invocation and which collectors expose it. **Blast radius: MEDIUM (#121 collector design)**
- **URLs**: https://ericzimmerman.github.io/KapeDocs/ ; https://docs.velociraptor.app/ ; Microsoft docs for `vssadmin` / `diskshadow`.
- **Look for**: the flag or module that performs snapshot-based collection, and whether it enumerates *existing* shadow copies too.
- **Expected shape**: concrete command lines `forensix-collect` can either shell out to or emulate.

### V7 — macOS acquisition specifics on Apple silicon. **Blast radius: LOW-MEDIUM (#121 docs only)**
- **URLs**: Apple platform security guide; current mac DFIR vendor documentation.
- **Look for**: whether a decrypting full-disk image is realistic today, and the APFS local-snapshot mount syntax (`tmutil localsnapshot`, `mount_apfs -s`).
- **Expected shape**: yes/no on dead-box viability + a working snapshot mount command.

### V8 — Deleted-record carving tools: names, maintenance status, licences. **Blast radius: LOW (#121 optional feature)**
- **URLs**: https://github.com/mdegrazia/SQLite-Deleted-Records-Parser ; search for `undark`, `bring2lite`, WAL carvers.
- **Look for**: still maintained? licence compatible? library-usable or CLI-only?
- **Expected shape**: a short shortlist with licence + integration mode. These are examples in the brief, not dependencies.

### V9 — Comparable tools' current input contracts. **Blast radius: LOW-MEDIUM (#121 positioning)**
- **URLs**: https://github.com/obsidianforensics/hindsight ; https://www.autopsy.com/ ; https://github.com/libyal/libewf ; https://github.com/log2timeline/dfvfs ; vendor pages for AXIOM/Belkasoft/X-Ways.
- **Look for**: exactly what each accepts — profile dir, user data dir, filesystem root, image container — and whether Hindsight now handles `Local State`/multi-profile.
- **Expected shape**: a small comparison table. Confirms (or sharpens) the "multi-input is the norm" positioning; does not change the recommendation.

---

## 8. Sources (all listed for verification, none fetched in this run)

- NIST SP 800-86, *Guide to Integrating Forensic Techniques into Incident Response* — https://csrc.nist.gov/publications/detail/sp/800-86/final
- NIST SP 800-131A Rev.2 (hash algorithm transitions) — https://csrc.nist.gov/publications/detail/sp/800-131a/rev-2/final
- NIST Computer Forensics Tool Testing (CFTT) — https://www.nist.gov/itl/ssd/software-quality-group/computer-forensics-tool-testing-program-cftt
- SWGDE published documents — https://www.swgde.org/documents/
- ACPO/NPCC *Good Practice Guide for Digital Evidence* — https://www.digital-detective.net/digital-forensics-documents/ACPO_Good_Practice_Guide_for_Digital_Evidence_v5.pdf
- ISO/IEC 27037:2012 — https://www.iso.org/standard/44381.html
- SQLite, *How To Corrupt An SQLite Database File* — https://www.sqlite.org/howtocorrupt.html
- SQLite, *Write-Ahead Logging* — https://www.sqlite.org/wal.html
- SQLite, *URI Filenames* (`mode=ro`, `immutable=1`) — https://www.sqlite.org/uri.html
- Chromium *User Data Directory* docs — https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md
- Chromium source, `components/os_crypt/` — https://source.chromium.org/chromium/chromium/src/+/main:components/os_crypt/
- Google Security Blog (App-Bound Encryption) — https://security.googleblog.com/
- Hindsight — https://github.com/obsidianforensics/hindsight
- KAPE documentation — https://ericzimmerman.github.io/KapeDocs/
- Velociraptor documentation — https://docs.velociraptor.app/
- Autopsy / The Sleuth Kit — https://www.autopsy.com/
- libewf (`ewfmount`) — https://github.com/libyal/libewf
- dfVFS — https://github.com/log2timeline/dfvfs
- `sqlparse` SQLite deleted-record parser — https://github.com/mdegrazia/SQLite-Deleted-Records-Parser
- CASE/UCO ontology (candidate manifest schema) — https://caseontology.org/

**Deliberately excluded**: vendor marketing pages (feature claims without methodology — usable only for "what input is accepted", not for practice claims); "top N forensic tools" listicles (no primary evidence); blog posts asserting fixed Chromium journal modes (superseded by version drift — use Chromium source).

---

## 9. Gaps

1. **No live verification was possible in this run** (no web tool). §7 is the complete verification queue, ranked; the parent has browser tooling and can verify top-down.
2. **Manifest schema not yet chosen.** Worth aligning `forensix-collect`'s `manifest.json` with an existing schema (KAPE CSV columns, AFF4-L metadata, or CASE/UCO) rather than inventing one. Feeds #125.
3. **Docker + mounted-image ergonomics unproven.** Bind-mounting a FUSE mount point (`ewfmount`, Arsenal Image Mounter) into a container has platform-specific pitfalls, particularly on macOS Docker Desktop. Prototype all three host OSes before committing `FILESYSTEM_ROOT` to user-facing docs.
4. **Collector scope undecided.** Whether `forensix-collect` shells out to existing collectors (KAPE/Velociraptor/UAC) or implements snapshot collection itself is a build-vs-integrate decision this brief does not resolve; it depends on V6.
