# Research: Product and deployment shape survey (ChmaraX/forensix#129)

> **Evidence note.** This brief was written against live primary sources. The `researcher` agent that
> wrote it has **no network tool** — every fetch was performed by the parent agent and read back from
> disk, the same arrangement recorded at the top of `research/_raw/fetch-manifest.md` for
> [#136](https://github.com/ChmaraX/forensix/issues/136). All 66 fetch attempts (62 OK, 4 failed) are
> recorded with HTTP status and byte count in **`research/_raw/129-fetch-manifest.md`**, generated
> `2026-08-08T11:02Z`; captures live under `research/_raw/129/`. Claims are tagged **CONFIRMED**
> (with the capture that owns them) or **STILL-UNKNOWN**. Nothing is tagged "likely".
>
> **Four fetches failed and their claims are not made anywhere in this brief:** ISO/IEC 27037
> (403, paywalled — *no* claim about its contents appears below), `pyrossh/rust-embed` (404),
> `nist.gov/.../cftt-technical-documents` (404, substituted), `docs.velociraptor.app/docs/offline_collector/`
> (404, substituted). **No SWGDE or NIST PDF body was downloaded** — only HTML landing/listing pages
> and one browser-rendered site search. Section 6 therefore reports a **negative** finding about the
> standards, and reports it as a negative rather than stretching it into an endorsement.
>
> **No performance number appears in this brief.** Nothing in the evidence set measures ForensiX
> against 10⁴–10⁶ rows. The "large profiles" axis is argued from documented storage-engine limits and
> from what other tools' architectures imply, and is flagged as unmeasured in section 9.

## Summary

**Recommended shape: a single self-contained per-platform binary whose primary interface is a CLI that
emits a durable single-file Case artifact, and which can additionally serve a read-only localhost UI
over that same artifact from the same binary.** This is shapes 1 and 3 fused at a file seam, not shape 3
alone and emphatically not shape 4 — and it is precisely what the closest comparable tool already ships:
Hindsight's Windows GUI binary is **20,725,598 B** against its CLI binary's **18,853,397 B**, so the
entire local web UI costs **1,872,201 B** on top of the CLI (CONFIRMED, `t1-hindsight-release`).

**Consequences for the four routed v1 capabilities, stated plainly:**

| | Verdict | Why it follows from the shape |
|---|---|---|
| **I1** investigator accounts / auth | **DIES** | A 127.0.0.1-bound single-user process has exactly one principal: the OS user who launched it. Authentication only becomes meaningful when a second principal can reach the socket. Timesketch needs `tsctl create-user` (CONFIRMED, `t1-timesketch-install`) *because* it is a networked multi-user server; that is the cost of shape 4, not a feature v2 inherits. Replace with a **declared examiner identity** recorded on the Case — declared, never authenticated, exactly as CONTEXT.md treats Declared Timezone. |
| **I3** shared evidence collection across investigators | **DIES as a feature; survives as a file** | Sharing degenerates to handing over the Case artifact. SQLite is a documented single-file application format, "recommended by the US Library of Congress as a storage format for long-term preservation", portable across 32/64-bit and endianness, backwards compatible to 2004 (CONFIRMED, `t4-sqlite-appfileformat`). Genuine multi-investigator collaboration requires shape 4, which costs six always-on containers and ≥8 GB RAM (CONFIRMED, section 2). |
| **J1** dashboard | **SURVIVES, re-homed** | Not as *the product*. As a view launched by the tool over an artifact the tool already produced. The Hindsight delta above is the price. It must never be the only way to reach a number. |
| **J2** per-artifact views | **SURVIVES, and is the more valuable half** | Per-artifact views are where an examiner actually works. They survive twice: as UI routes and as CLI subcommands/exports. If a per-artifact view exists only in the UI, the artifact seam has been violated. |

**I2 (record a finding) and I4 (audit trail) are not re-litigated** — they are chain-of-custody
primitives and survive in all four shapes. Section 8 states how each shape *hosts* them, because that
does differ, and it differs in a way that counts against shape 4.

**On the maintainer's prior** ("build a regular dashboard/server as it was before, maybe some
complementary CLI later"): **half right, and the ordering is wrong.** A localhost server without Docker
or MongoDB genuinely does deliver v1's dashboard UX at a fraction of v1's operational weight — that part
of the prior survives contact with the evidence. But "dashboard first, CLI later" and "CLI first,
dashboard as a served view" are **not** the same plan reordered; one is reversible and the other is not.
Section 5 argues this concretely. Section 7 answers the prior directly.

---

## 1. The four shapes against the four axes

Cell contents are argued from the evidence in sections 2–6. Where a cell rests on no capture it says so.

### 1a. Install friction for a single investigator

| Shape | What the investigator has to do | Friction verdict |
|---|---|---|
| **1. CLI + report output** | Download one file, run it. Velociraptor ships exactly this: `velociraptor-v0.77.1-windows-amd64.exe`, 70,375,416 B, one file, plus a detached `.sig` (CONFIRMED, `t1-velociraptor-release`). Eric Zimmerman's entire toolset is distributed as per-tool zips fetched by a PowerShell script, with **no installer at all** (CONFIRMED, `t1-ez-tools`, `t1-getzimmermantools`) | **Lowest.** But note the EZ-tools baseline is not literally zero: those tools require ".net 4.7.2 or newer" or ".net 9 or newer", "Be sure sure you get the Desktop runtime if you plan on running any of the GUI programs" (CONFIRMED, `t1-ez-tools`). A truly self-contained binary beats even the Windows-examiner baseline |
| **2. Desktop application** | Run an installer, or accept a runtime dependency. Autopsy: "64-bit MSI Installer" on Windows; on Linux/macOS a ZIP plus "The Sleuth Kit Java .deb Debian package" plus "instructions to install other dependencies" (CONFIRMED, `t1-autopsy-download`). Tauri on Windows additionally drags WebView2 in (section 4) | **Low on Windows, high off it.** Autopsy's own download page is the tell: one line for Windows, three prerequisites for everything else |
| **3. Local web server launched by the tool** | Identical to shape 1 if it is the same binary. Hindsight ships `hindsight_gui.exe` as a peer of `hindsight.exe` and the README says: run it "and visit http://localhost:8080 in a browser" (CONFIRMED, `t1-hindsight-readme`, `t1-hindsight-release`) | **Same as shape 1, if and only if the server is in the binary.** If it is a `pip install` + a second `curl \| sh` — which is Hindsight's *manual* install path, including a separate `install-js.sh` to enable "View SQLite DB in Browser" (CONFIRMED, `t1-hindsight-readme`) — friction jumps |
| **4. Hosted / multi-user server** | Timesketch, from its own admin guide: "Machine with Ubuntu 22.04 installed. At least 8GB RAM"; Docker is "the only tested and actively maintained installation method"; `sudo ./deploy_timesketch.sh`, which **exits early if not run as root**, sets `vm.max_map_count=262144` system-wide, and allocates OpenSearch half of total RAM. TLS is an optional post-install step; the script prints "WARNING: The server is running without encryption" (all CONFIRMED, `t1-timesketch-install`, `t1-timesketch-deploy-sh`) | **Disqualifying for one investigator on a laptop.** There is no documented Windows install path at all |

### 1b. Suitability for large profiles (10⁴–10⁶ history rows, multi-GB profiles)

| Shape | Storage/compute story | Verdict |
|---|---|---|
| **1. CLI** | Streams; holds nothing it does not need. Emits into a store the examiner keeps | **Best.** No render budget, no session, no socket timeout |
| **2. Desktop app** | Same process as shape 3 for data; the constraint is the widget layer, not the store | Equivalent to 3 |
| **3. Local server** | SQLite's documented ceilings are nowhere near this problem: default `SQLITE_MAX_PAGE_COUNT` 4294967294 since 3.45.0 giving "about 17.5 terabytes" at the 4096-byte default page size, up to "281 terabytes" at 65536-byte pages; theoretical max rows 2⁶⁴, practically "approximately 2e+13 rows" (CONFIRMED, `t4-sqlite-limits`). 10⁶ rows is four to seven orders of magnitude inside that | **Fine — provided the UI queries rather than loads.** The failure mode is a browser asked to render 10⁶ DOM rows, which is a UI-design constraint, not a storage one. **STILL-UNKNOWN:** nothing in this evidence set measures query latency at 10⁶ rows |
| **4. Hosted server** | Timesketch's compose file runs a **single-node OpenSearch cluster** with a Java heap set to half the host's RAM, and its own guide says "in order to scale and have better performance you need to setup a multi node OpenSearch cluster" (CONFIRMED, `t1-timesketch-install`, `t1-timesketch-docker-compose`) | **Over-built for one profile.** That index exists to serve super-timelines across many hosts and many users, not 10⁶ rows from one Chrome profile. Adopting it imports the operating cost without the workload that justifies it |

### 1c. Evidence-handling implications

The relevant question is not "is there an audit trail" (there is, in every shape — I4) but **where the
record lives, who can alter it, and whether the tool's own behaviour is reproducible.**

| Shape | Chain of custody | Reproducibility | Audit trail | "Did the tool mutate the evidence?" |
|---|---|---|---|---|
| **1. CLI** | The Case artifact is a file the examiner holds and hashes. Nothing crosses a custody boundary | **Strongest.** The invocation is a string that goes in the report and re-runs verbatim. Hindsight's CLI contract is exactly this shape: `-i` input, `-o` output, `-f` format, `-t` timezone (CONFIRMED, `t1-hindsight-readme`) | The command line *is* part of the record; I2/I4 append to the artifact the same command produced | Answerable by construction: the tool's only write target is the output path |
| **2. Desktop app** | Same as 1 | **Weakest of the four.** A click path is not a reproducible method. Any replay story has to be synthesised (macro/log) rather than being the natural artifact | Must be reconstructed from UI events | Same as 1 |
| **3. Local server** | Same as 1, **if** the server never becomes the system of record. If the UI owns the data, the artifact is now a server's internal state | Depends entirely on the seam (section 5). Served-view: as good as 1. UI-owns-data: as bad as 2 | HTTP request log + the mutation, both local, both in the artifact | Same as 1, **plus** a new question: is the socket bound to 127.0.0.1 and is it authenticated-by-locality? |
| **4. Hosted server** | **Evidence leaves the examiner's custody boundary and enters a shared store.** That transfer is itself a custody event that must be documented | Requires pinning server version, index mappings and analyser config, not just a command | Now needs actor identity (hence I1) and network provenance — real work that shapes 1–3 do not need | Becomes a *server-trust* question rather than a *tool* question. Timesketch's own deploy script warns the default deployment is unencrypted (CONFIRMED, `t1-timesketch-deploy-sh`) |

v1's shape sits in the worst cell of this table for a single investigator: docker-compose + MongoDB means
the Working Copy and every derived row lived in a container volume with no document metaphor — no single
file the examiner can hash, hand over, or attach.

### 1d. Cross-platform story (Windows matters most)

| Shape | Windows | macOS | Linux |
|---|---|---|---|
| **1. CLI** | Best served shape by a wide margin. **Hindsight's own download counts settle this empirically**: of 1,216 binary-asset downloads on v2026.06, **1,092 (89.8%) are the two Windows assets** (CONFIRMED, `t1-hindsight-release`, arithmetic from the per-asset `download_count` fields) | Two binaries needed (arm64 + x86_64); Hindsight ships both | Straightforward |
| **2. Desktop app** | MSI/NSIS achievable, at the code-signing and WebView2 costs in section 4 | Notarisation required (CONFIRMED, `t2-electron-codesign`: Apple Developer Program enrolment, Xcode, macOS machine) | AppImage/Snap/distro packages — DB4S ships all three plus a FreeBSD port (CONFIRMED, `t1-sqlitebrowser-dl`) |
| **3. Local server** | Identical to shape 1 *if* it is the same binary. This is the whole argument | Identical to 1 | Identical to 1 |
| **4. Hosted server** | **No documented Windows path.** Timesketch's admin guide states Ubuntu 22.04 (CONFIRMED, `t1-timesketch-install`) | None documented | The only supported platform |

Shape 4 fails the axis the issue says matters most, outright.

---

## 2. What real tools actually ship — primary sources only

Every row is from the project's own repo, release API, or documentation site. No blog roundups.

| Tool | Distribution artifact (exact) | UI story | Licence (authority) |
|---|---|---|---|
| **Hindsight** — note the canonical repo is now **`RyanDFIR/hindsight`**; the `obsidianforensics` path resolved there (CONFIRMED, `t1-hindsight-repo` `full_name`) | Release **v2026.06**, 8 binary assets, **two variants × four platforms**: `hindsight.exe` 18,853,397 B · `hindsight_gui.exe` 20,725,598 B · `hindsight-linux-x86_64` 40,842,536 B · `hindsight_gui-linux-x86_64` 42,712,312 B · `hindsight-macos-arm64` 16,855,568 B · `hindsight_gui-macos-arm64` 18,741,088 B · `hindsight-macos-x86_64` 17,546,816 B · `hindsight_gui-macos-x86_64` 19,432,704 B. Also `pip install pyhindsight` (CONFIRMED, `t1-hindsight-release`, `t1-hindsight-readme`) | **Both, shipped as peers.** README: "It has a simple web UI - to start it, run `hindsight_gui.py` (or on Windows, the packaged `hindsight_gui.exe`) and visit http://localhost:8080". CLI options `-i -o -f -c -b -l -h -t`; `-f` output format "default is XLSX, other options are SQLite and JSONL". One optional extra install (`install-js.sh`) unlocks "View SQLite DB in Browser" in the web UI | **Apache-2.0** (CONFIRMED, `t1-hindsight-repo` `license.spdx_id`) |
| **Autopsy** | Six files per release: `autopsy-X.X.X-32bit.msi`, `-64bit.msi`, `autopsy-X.X.X.zip` (Linux/macOS), and a `.asc` GPG signature for each. Linux additionally needs "The Sleuth Kit Java .deb Debian package" and "other dependencies". "The MSI and ZIP files are signed by Brian's GPG key"; "The Autopsy EXE is signed by Sleuth Kit Labs, LLC" (CONFIRMED, `t1-autopsy-download`) | Desktop GUI (Java/NetBeans platform; repo `language: "Java"`) | **STILL-UNKNOWN.** GitHub API returns `"license": null` for `sleuthkit/autopsy` (CONFIRMED, `t1-autopsy-repo`). No SPDX identifier is asserted here |
| **plaso / log2timeline** | Release **20260512**: exactly **two** assets — `plaso-20260512.tar.gz` **199,345,836 B** and `plaso-20260512.tar.gz.asc`. **No binaries of any kind.** Docs include "Packaging with Docker" and separate troubleshooting pages for "MacOS specific issues", "Ubuntu Linux specific issues", "Windows specific issues" (CONFIRMED, `t1-plaso-release`, `t1-plaso-docs`) | **CLI-only engine.** Its own README describes it as "a Python-based engine used by several tools" — it is deliberately a component, not a product | **Apache-2.0** (CONFIRMED, `t1-plaso-repo`) |
| **Timesketch** — the hosted counterexample | Docker images only. `docker/release/docker-compose.yml` defines **10 services**; the default profile starts **six containers: `timesketch-web`, `timesketch-worker`, `opensearch`, `postgres`, `redis`, `nginx`**. Four more are behind opt-in profiles (`timesketch-web-legacy`, `timesketch-web-v3`, `otel-collector`, `jaeger`). Requirements: Ubuntu 22.04, ≥8 GB RAM, root for the deploy script, `vm.max_map_count=262144`, `OPENSEARCH_MEM_USE_GB` = half of `MemTotal`, TLS optional and off by default, users created via `tsctl create-user` (all CONFIRMED, `t1-timesketch-docker-compose`, `t1-timesketch-install`, `t1-timesketch-deploy-sh`) | Web UI behind nginx; multi-user by construction | **Apache-2.0** (CONFIRMED, `t1-timesketch-repo`) |
| **Velociraptor** | Release **v0.77.1**: self-contained per-platform binaries **plus** MSIs, **every asset accompanied by a detached `.sig`**. `velociraptor-v0.77.1-windows-amd64.msi` 27,475,968 B (8,108 downloads — the most-downloaded asset) · `...-windows-amd64.exe` 70,375,416 B (4,390) · `...-linux-amd64` 85,492,920 B (4,875) · `...-darwin-arm64` 64,764,176 B (2,108) · plus 386, 386-legacy, amd64-legacy, musl, sumo-musl, freebsd, linux-arm64 (CONFIRMED, `t1-velociraptor-release`) | **One Go binary is the client, the server, the web GUI, and the offline-collector builder.** Offline collector defined in its own docs as "a custom preconfigured Velociraptor binary that will automatically collect any artifacts that you've specified… to the point where the on-site personnel do not even need to type any command line arguments" (CONFIRMED, `t1-velociraptor-bulk`) | **STILL-UNKNOWN.** GitHub API returns `"license": {"key":"other","spdx_id":"NOASSERTION"}` (CONFIRMED, `t1-velociraptor-repo`) |
| **Eric Zimmerman's tools** (incl. KAPE, Registry Explorer) — the Windows-examiner baseline | Per-tool downloads fetched by `Get-ZimmermanTools`, a PowerShell script that "will auto-discover all available downloads and download what does not already exist"; `-NetVersion` selects ".net 4.7.2 or .net 9". **No installer.** Warnings on the same page: "DO NOT RUN ANYTHING FOUND HERE FROM 'C:\PROGRAM FILES'"; "DO NOT USE WINDOWS TO EXTRACT THINGS. Use 7-Zip or WinRAR as Windows will block the DLLs" (CONFIRMED, `t1-ez-tools`, `t1-getzimmermantools`) | **The pattern this brief recommends, already normative on Windows.** The catalogue is explicitly paired: `RECmd` (CLI) ↔ `Registry Explorer` (GUI); `SBECmd` ↔ `ShellBags Explorer`; `MFTECmd` ↔ `MFTExplorer`; and `EvtxECmd` emits "standardized CSV, XML, and json output" which `Timeline Explorer` then reads. **A CLI produces a durable artifact; a separate GUI reads it.** All GUI tools are .NET 9 only; all CLI tools still ship for both .NET 4.7.2 and .NET 9 — i.e. the CLIs are held to a *wider* compatibility bar than the GUIs | **STILL-UNKNOWN.** No licence statement appears in the captured page; KAPE is listed with `Version: NA` alongside "Kroll Artifact Parser/Extractor". No claim is made here |
| **DB Browser for SQLite** | Release 3.13.1. Windows: standard installer **and** a "no installer" `.zip`, for 32-bit, 64-bit and ARM64, **plus a PortableApp** ("There is no portable version for ARM64 Windows"). macOS: Universal build + `brew install db-browser-for-sqlite`. Linux: AppImage, Snap, Arch/Fedora/openSUSE/Debian/Ubuntu-PPA packages. FreeBSD port. "Free code signing provided by SignPath.io, certificate by SignPath Foundation" (CONFIRMED, `t1-sqlitebrowser-dl`) | Desktop GUI | **STILL-UNKNOWN.** GitHub API returns `NOASSERTION` (CONFIRMED, `t1-sqlitebrowser-repo`) |
| **browser-history** (single-purpose comparator) | A Python package. Repo self-description: "A simple, zero-dependencies, developer-friendly Python package to retrieve web browser history" (CONFIRMED, `t1-browserhistory-repo`). **STILL-UNKNOWN:** the PyPI JSON was captured (`t1-browserhistory-pypi`, 200, 25,130 B) but was not mined for this brief, so no claim is made about wheels, sdists or platform coverage | Library + docs on readthedocs. No GUI | **Apache-2.0** (CONFIRMED, `t1-browserhistory-repo`) |

### Three things this table settles

1. **Nobody in this space ships a hosted multi-user server as the default single-investigator product.**
   Exactly one tool surveyed is a hosted server — Timesketch — and it is the one that costs six
   containers, 8 GB of RAM, root, an Ubuntu host and a user-creation step. Everything an individual
   examiner reaches for is a file they download and run.

2. **The tool closest to ForensiX ships both interfaces, and the UI is the cheap half.** Hindsight's
   GUI-minus-CLI delta is remarkably stable across all four platforms — 1,872,201 B (Windows),
   1,869,776 B (Linux), 1,885,520 B (macOS arm64), 1,885,888 B (macOS x86_64). A local web UI is
   roughly **1.9 MB of marginal binary**. It is not an architecture; it is a feature.

3. **Windows dominates the download counts, and the GUI/CLI split is close to even.** Windows is 89.8%
   of Hindsight v2026.06 asset downloads. Within that, `hindsight_gui.exe` 604 vs `hindsight.exe` 488 —
   the GUI leads, but by roughly 24%, not by an order of magnitude. Read carefully: this refutes
   "nobody uses the CLI" *and* refutes "the UI is optional". **Both are load-bearing.** It does not tell
   you which to build first — section 5 does.

---

## 3. Does a localhost server get you the dashboard without v1's weight? What is the minimal honest stack?

**Yes, and the minimal honest stack is smaller than the prior assumes.**

The load-bearing v1 components were Docker, MongoDB, an Express server and a React app. Against the
captured evidence:

- **MongoDB → a single SQLite file.** SQLite's own "As An Application File Format" paper argues the
  case in terms this project already speaks: "Single-File Documents… The 'document' metaphor is
  preserved"; a 4-byte Application ID in the header for `file(1)` identification; "portable between
  32-bit and 64-bit machines and between big-endian and little-endian architectures"; atomic
  transactions; "backwards compatible to its inception in 2004"; "SQLite databases are recommended by
  the US Library of Congress as a storage format for long-term preservation of digital content"; and
  "Data lives longer than code" (all CONFIRMED, `t4-sqlite-appfileformat`). For an evidence tool this is
  not a convenience argument, it is a **custody** argument: the Case artifact becomes a thing you can
  hash, attach to an email, and hand to opposing counsel who can open it with a tool that is not yours.
  It also states "Concurrent Use By Multiple Processes… Two or more applications can connect and read
  from the same document at the same time. Writes are serialized" — which is exactly the level of
  "sharing" a single-investigator tool needs, and no more.
- **Docker → nothing.** Docker existed to orchestrate MongoDB. Remove the database daemon and the
  orchestrator has nothing left to orchestrate.
- **Express + React → a static bundle embedded in the binary, served on 127.0.0.1.** This is a solved,
  documented problem in every candidate runtime. Go's standard library documents it with an example
  literally captioned "content holds our static web server content", using `//go:embed image/*
  template/* html/index.html` into an `embed.FS` (CONFIRMED, `t2-go-embed`). Node SEA has an `assets`
  field with `getAsset`/`getAssetAsBlob`/`getRawAsset`/`getAssetKeys` (CONFIRMED, `t2-node-sea`).
- **Node additionally no longer needs a native SQLite addon.** Node's stability overview lists
  **`SQLite (1.2) Release candidate`** as a built-in module (CONFIRMED, `t2-node-stability`). That
  matters disproportionately, because bundling *native* addons into a Node SEA is genuinely nasty —
  see section 4.

So the minimal honest stack is: **one binary + one SQLite file + an embedded static bundle bound to
127.0.0.1.** No daemon, no container, no port conflict story, no service to leave running.

**The honesty caveats, stated rather than buried:**

- "Bound to 127.0.0.1" is a *design commitment*, not a property you get for free. Hindsight's README
  says "visit http://localhost:8080" but the captures do not state its bind address (STILL-UNKNOWN,
  `t1-hindsight-readme`). v2 must state and test its bind address, because on a shared examination
  workstation "localhost" and "0.0.0.0" are a chain-of-custody difference, not a config difference.
- Localhost binding is authentication-by-locality. That is adequate *and* it is the reason I1 dies —
  it is not adequate for anything else.
- A local server still has state a CLI does not: a port, a process lifetime, and a browser session. It
  is materially simpler than v1, not free.

---

## 4. Windows distribution reality for a non-developer examiner

This section decides shape 2, and it constrains the implementation language for shapes 1/3. All claims
are from the packaging tools' own docs.

| Route | What it actually produces | Documented limits that bite |
|---|---|---|
| **Node SEA** | A copy of the `node` binary with a blob injected as a PE resource named `NODE_SEA_BLOB`; `node --build-sea sea-config.json` (CONFIRMED, `t2-node-sea`) | **Stability `1.1 - Active development`**, and Node's own stability index defines Stability 1 as "not subject to semantic versioning rules. Non-backward compatible changes or removal may occur in any future release. **Use of the feature is not recommended in production environments**" (CONFIRMED, `t2-node-stability`). "Module loading in the injected main script does not read from the file system" — you must pre-bundle. **Native addons must be written to a temp file at runtime and loaded with `process.dlopen()`** (documented workaround with an example that writes to `os.tmpdir()`). CI-tested platforms are Windows, **macOS arm64 only — "x64 is not currently supported and is skipped in the tests"** — and Linux except Alpine and s390x. Cross-platform SEA generation requires `useCodeCache` and `useSnapshot` both false |
| **PyInstaller** | One-file or one-folder bundles; 6.21.0 current (CONFIRMED, `t2-pyinstaller-docs`) | **"it is not a cross-compiler; to make a Windows app you run PyInstaller on Windows, and to make a Linux app you run it on Linux"** (CONFIRMED, `t2-pyinstaller-docs`). A Windows build machine or runner is mandatory. This is exactly how Hindsight builds — its release notes include "Pin macOS build runners and update GitHub Actions dependencies" (CONFIRMED, `t1-hindsight-release` body) |
| **Tauri** | `.msi` via WiX Toolset v3, or `-setup.exe` via NSIS (CONFIRMED, `t2-tauri-win-installer`) | **".msi installers can only be created on Windows as WiX can only run on Windows systems."** NSIS cross-compilation from Linux/macOS is possible but "not as straight forward… not tested as much. Therefore it should only be used as a last resort". **And the WebView2 dependency is a real forensic-lab problem** — see the table below |
| **Electron** | Squirrel.Windows or WiX MSI via Forge/Packager (CONFIRMED, `t2-electron-codesign`) | Signing costs below. Bundle size not stated in the captures (STILL-UNKNOWN) |
| **Go single binary + embedded assets** | One static file per GOOS/GOARCH; `//go:embed` is standard library, no third-party tooling (CONFIRMED, `t2-go-embed`) | The strongest indirect evidence is Velociraptor: **one Go project ships 12 platform binaries plus 2 MSIs from a single release** (CONFIRMED, `t1-velociraptor-release`). **STILL-UNKNOWN:** Go's cross-compilation mechanics (`GOOS`/`GOARCH`) were not captured and are not asserted here |
| **Rust + rust-embed** | **STILL-UNKNOWN.** `https://api.github.com/repos/pyrossh/rust-embed` returned **404**. The substitute capture `t2-rust-embed-crates` (crates.io API, 200, 119,580 B) exists on disk but is a single 116.8 KB line that this agent's file reader cannot open. **No claim is made about rust-embed's version, licence or capabilities.** Tauri (Rust) is covered above on its own docs |

### Tauri's WebView2 table — quoted, because it disqualifies Tauri for offline labs

Tauri's own installer docs give this comparison (CONFIRMED, `t2-tauri-win-installer`):

| Install method | Requires internet? | Additional installer size |
|---|---|---|
| `downloadBootstrapper` | **Yes** | 0 MB — **this is the default** |
| `embedBootstrapper` | **Yes** | ~1.8 MB |
| `offlineInstaller` | No | **~127 MB** |
| `fixedVersion` | No | **~180 MB** |
| `skip` | No | 0 MB — "⚠️ Not recommended" |

Tauri also notes "On Windows 10 (April 2018 release or later) and Windows 11, the WebView2 runtime is
distributed as part of the operating system." So on a modern, *online* Windows box this is a non-issue.
On an **air-gapped forensic workstation** — which is a normal, not exotic, environment — the default
install mode fails, and the offline-safe modes cost 127–180 MB of installer. For comparison, Hindsight's
entire Windows GUI binary is 20.7 MB and Velociraptor's Windows MSI is 27.5 MB. **A Tauri desktop app
would be roughly 5–9× the offline distribution footprint of the largest tool surveyed, to deliver the
same web UI a 1.9 MB embedded server delivers.**

### Code signing and SmartScreen — the part that costs money and time

- **SmartScreen is reputation-based, not signature-based.** Microsoft: it checks "downloaded files
  against a list of files that are well known and downloaded frequently. If the file isn't on that list,
  Microsoft Defender SmartScreen shows a warning, advising caution", and separately "If a URL, a file,
  an app, or a certificate has an established reputation, users don't see any warnings. If there's no
  reputation, the item is marked as a higher risk and presents a warning" (CONFIRMED, `t2-smartscreen`).
  A niche forensics tool will not have reputation, and **each new release restarts the file-level
  reputation clock.**
- **OV certificates no longer buy their way out of that.** Tauri: "If you sign the app with an EV
  Certificate, it'll receive an immediate reputation with Microsoft SmartScreen and won't show any
  warnings… If you opt for an OV Certificate, which is generally cheaper and available to individuals,
  Microsoft SmartScreen will still show a warning to users when they download the app. It might take
  some time until your certificate builds enough reputation." Tauri's OV guide carries a `Danger` block:
  "This guide only applies to OV code signing certificates acquired **before June 1st 2023**"
  (CONFIRMED, `t2-tauri-sign-windows`).
- **Electron states the harder version of the same fact**, independently: "since June 2023, Microsoft
  requires software to be signed with an 'extended validation' certificate… These simpler certificates
  no longer provide benefits: **Windows will treat your app as completely unsigned** and display the
  equivalent warning dialogs. The new EV certificates are **required to be stored on a hardware storage
  module compliant with FIPS 140 Level 2, Common Criteria EAL 4+ or equivalent**. In other words, the
  certificate cannot be simply downloaded onto a CI infrastructure" (CONFIRMED, `t2-electron-codesign`).
  Two independent projects agree on the June 2023 date. Electron names Azure Artifact Signing as "the
  cheapest option for code signing on Windows, and it gets rid of SmartScreen warnings", with the caveat
  that it "is currently limited to developers in certain countries".
- **The current governing document is CA/Browser Forum "Baseline Requirements for Code-Signing
  Certificates, v.3.11", adopted by ballot CSCWG-32** (CONFIRMED, `t2-cabforum-cs`). **STILL-UNKNOWN:**
  the BR text itself was not fetched, so the HSM key-storage requirement is asserted here **only** on
  Electron's authority, not on the CA/B Forum's.

**A recorded conflict between primary sources.** Electron says "Both Windows and macOS prevent users
from running unsigned applications." Node's SEA docs say Windows signing is "(optional)… However, the
unsigned binary would still be runnable", and Tauri says "It is not required to execute your application
on Windows, as long as your end user is okay with ignoring the SmartScreen warning." **On the narrow
factual question — does Windows refuse to execute an unsigned binary — Node and Tauri agree against
Electron, and Electron's sentence is an overstatement.** The practical truth is: unsigned runs, but
behind a dialog that a cautious examiner in a regulated lab may not be permitted to click through.

### Antivirus false positives on packed binaries

**No PyInstaller document in this capture set discusses antivirus false positives.** The URL fetched for
that purpose (`when-things-go-wrong`) covers import errors and debugging only (CONFIRMED by absence,
`t2-pyinstaller-wrong`). Asserting "PyInstaller binaries trigger AV" from these captures would be
inventing a source.

**What the evidence does support** is that the DFIR community treats AV false positives on its own
tooling as routine and pre-emptively documents them. Eric Zimmerman's front page: "All software is
digitally signed. Once you verify the signature as coming from me, **any anti-virus hits are false
positives**. When in doubt, download the files directly from here!" — alongside "DO NOT USE WINDOWS TO
EXTRACT THINGS. Use 7-Zip or WinRAR as Windows will block the DLLs" (CONFIRMED, `t1-ez-tools`). The
design consequence is concrete and cheap: **publish per-asset SHA-256 digests and detached signatures,
and say in the README that AV hits on a signed release are false positives.** Hindsight publishes a
`digest: sha256:…` per asset via the releases API; Velociraptor ships a `.sig` next to every single
asset (CONFIRMED, `t1-hindsight-release`, `t1-velociraptor-release`). Do both.

---

## 5. The seam: "CLI first, dashboard as a served view" vs "dashboard first, CLI later"

**These are not the same plan in a different order. One is reversible and one is not.** The difference
is a single question: **who owns the data?**

| | Plan A — CLI first, UI as a served view | Plan B — dashboard first, CLI later |
|---|---|---|
| **Who owns the Case data** | A file on disk, produced by the CLI, with a documented schema | The server process and its store |
| **What the UI is** | A reader. It opens an artifact it did not create | The system of record. It creates state that exists nowhere else |
| **What the later CLI is** | Already there — it *made* the artifact | A **second** implementation of every read path the UI already has, or an HTTP client of a server it must first boot |
| **Reproducibility** | The invocation is the method. Re-runnable verbatim by a third party | A click path. Any replay story is retrofitted |
| **Can you reverse the decision?** | Yes, trivially: delete the `ui` subcommand. The artifact and every capability survive | **No, cheaply.** Retrofitting a CLI onto a UI-owned store means either exporting from a running server, or extracting the schema and read paths after the fact — a rewrite of the data layer, not an addition |
| **What if you build only half?** | A working forensic CLI with reports. Genuinely useful, and it is what plaso, the EZ CLIs, and `browser-history` are | A dashboard that cannot be scripted, cannot be re-run in a report, and whose findings cannot be regenerated without a human |

**The seam is a file, and it must be a file.** Concretely:

```
forensix ingest <source> --case ./CASE-2026-014.fxdb     # writes Manifest, Working Copy hashes
forensix analyse --case ./CASE-2026-014.fxdb             # writes Candidates, Findings, Provenance
forensix report  --case ./CASE-2026-014.fxdb -f xlsx     # emits the report
forensix ui      --case ./CASE-2026-014.fxdb             # serves 127.0.0.1 over the SAME file
```

`forensix ui` opens the artifact **read-mostly**: it may append I2 Findings and I4 audit entries — those
are chain-of-custody primitives and must be appendable from wherever the examiner is working — but it
must never be the only writer of anything. The falsifiable test: **delete `forensix ui` from the build
and every capability except "look at it in a browser" must still be reachable.** If that test fails,
the UI has quietly become the system of record and Plan B has happened by accident.

**This is not a novel design; it is the Windows-examiner norm.** `EvtxECmd` emits standardised CSV, and
`Timeline Explorer` is a *separate program* that reads it. `RECmd` and `Registry Explorer` are separate
tools over the same hives. `SBECmd` and `ShellBags Explorer` likewise (CONFIRMED, `t1-ez-tools`). And
Hindsight's `-f` flag defaults to XLSX with "SQLite and JSONL" alternatives (CONFIRMED,
`t1-hindsight-readme`) — the CLI's job is to produce an artifact other things can read.

**Where Hindsight differs from the pure EZ pattern, and why it matters here:** Hindsight ships the GUI
as a second *binary from the same codebase* rather than a separate program, and the GUI runs the same
analysis. That is the shape being recommended — one codebase, one artifact format, two entry points —
and the 1.9 MB delta is the measured price.

---

## 6. Court and validation practice: the standards are SILENT on shape

This section reports a negative finding. It is a real finding and it should be read as one.

**Nothing in the captured standards material expresses any preference between a scripted CLI run and a
UI click-through.** Specifically:

- **NIST CFTT.** The programme page states the goal as "to establish a methodology for testing computer
  forensic software tools by development of general tool specifications, test procedures, test criteria,
  test sets, and test hardware". Its technical categories are **functional**: Disk Imaging, Deleted File
  Recovery, Forensic File Carving, Forensic Media Preparation, Forensic String Search, Hardware Write
  Block, Software Write Block, Mobile Devices, MS Windows Registry Tools, **SQLite**, Cloud Data
  Extraction (CONFIRMED, `t3-nist-cftt`, `t3-nist-cftt-pubs`). **Not one category is about interface.**
  CFTT cares what a tool *does*, never how it is driven. Worth noting for a different ticket: **CFTT has
  a SQLite category**, which is directly relevant to ForensiX's parsing claims.
- **SWGDE.** The published-document listing is JavaScript-rendered and paginated; only page 1 plus a
  site search for `validation` were captured, and **no PDF body was downloaded** (recorded as a coverage
  gap in the fetch manifest). Nothing on page 1 concerns tool interfaces; the titles are about
  photography, video, cell-site analysis, evidence collection and admissibility of image examinations
  (CONFIRMED, `t3-swgde-docs-rendered`). The most relevant search hit is **"Quality Management System
  for Digital and Multimedia Evidence Units (SWGDE 25-Q-001-1.0)"**, whose visible abstract text reads:
  *"of tools, forensic techniques, and technical methodologies are used. For uniformity, this document
  refers to all these as 'tools'. The term 'reliability' is used throughout, as 'validation' can refer
  to several overlapping concepts. The section is organized into two main parts: 1. Tool Selection and
  Use Lifecycle a. Tool Selection and Authorization (selection…"* (CONFIRMED,
  `t3-swgde-search-validation`). That is about a *unit's* process for selecting and authorising tools.
  It says nothing about interface, and **it must not be stretched into an endorsement of CLIs.**
- **FRE 702** (post-amendment text as captured): testimony is admissible if "(b) the testimony is based
  on sufficient facts or data; (c) the testimony is the product of reliable principles and methods; and
  (d) the expert's opinion reflects a reliable application of the principles and methods to the facts of
  the case" (CONFIRMED, `t3-fre-702`). The Advisory Committee notes list the Daubert factors:
  testability, peer review and publication, known or potential error rate, existence and maintenance of
  standards and controls, and general acceptance. **Every one of these attaches to the expert's method,
  not to the vendor's user interface.** *(STILL-UNKNOWN: the LII capture's statutory-history parenthetical
  lists 1975 / 2000 / 2011 only; the December 2023 amendment date is **not** visible in this capture and
  is not asserted here, though the rule text captured is the amended wording.)*
- **ISO/IEC 27037: no evidence at all.** `iso.org` returned **403**. Any claim about its contents would
  be fabricated.

**The honest conclusion:** accepted digital-forensics practice does not favour any of the four shapes.
Anyone told otherwise is being sold an argument, not shown a citation.

**What *can* be said without a citation, as an argument rather than a finding:** FRE 702(d) asks whether
the method was *reliably applied to the facts of this case*, and Daubert's first factor asks whether the
technique "can be challenged in some objective sense". A recorded command line — tool version, input
hash, flags, output hash — is a directly re-executable answer to both. A click path is not. That is a
reason to prefer Plan A. It is **not** a standards requirement, and this brief does not dress it as one.

---

## 7. Direct response to the maintainer's prior

> "I think we should build a regular dashboard/server as it was before, maybe some complementary CLI later."

**Agreed on the destination. Disagreed on the ordering, and disagreed that "as it was before" is the
right description of the target.**

**Where the prior is right, and the evidence backs it:**

1. **A dashboard is genuinely wanted, and the download counts prove examiners reach for the GUI.**
   `hindsight_gui.exe` outdrew `hindsight.exe` 604 to 488 on the current release (CONFIRMED,
   `t1-hindsight-release`). "CLI purists only" is not a defensible reading of the evidence, and this
   brief does not make it.
2. **A local server does deliver that UX without v1's weight.** Section 3: one binary, one SQLite file,
   embedded assets, 127.0.0.1. No Docker, no MongoDB, no daemon.
3. **"Some complementary CLI" understates it in the direction the maintainer already leans** — the CLI
   is cheaper than expected, because in this design it is not complementary, it is the substrate.

**Where the prior is wrong:**

1. **"As it was before" carries the failure with it.** v1's shape is what the issue itself flags as too
   heavy. The dashboard was never the problem; MongoDB, Docker and the server-as-system-of-record were.
   Keep the pixels, discard the topology.
2. **"CLI later" is the one ordering that is not reversible.** Section 5. Every other decision in this
   brief can be revisited cheaply. This one cannot, because it determines who owns the Case data, and
   that is a data-layer decision disguised as a roadmap decision.
3. **The word "server" is doing dangerous work.** In "local web server" it means *a rendering surface
   bound to loopback*. In "dashboard/server as it was before" it means *the system of record*. The
   evidence supports the first and rejects the second. If v2 says "server" without saying which, it will
   drift into the second — that is precisely how I1 (auth), I3 (sharing) and eventually shape 4 creep
   back in, one reasonable-sounding ticket at a time.
4. **The one thing the prior gets backwards on cost.** Building the dashboard first feels like it
   de-risks the user-facing half. It does the opposite: it front-loads the part that is measurably
   ~1.9 MB and structurally optional, and defers the part that determines whether the tool's output is
   reproducible, hashable and admissible.

**The amendment, in one line:** *build the CLI and the Case artifact first; ship `forensix ui` in the
same binary in the same release if you can; never let the UI own a byte the CLI cannot produce.*

---

## 8. Where I2 and I4 live in each shape

Not re-litigated — I2 (record a finding) and I4 (audit trail) survive regardless. But the *hosting*
differs, and the difference argues against shape 4:

| Shape | I2 — record a finding | I4 — audit trail |
|---|---|---|
| **1. CLI** | Appended to the Case artifact by the command that produced the Finding, carrying Provenance in the same transaction | The invocation *is* an audit entry: argv, tool version, input Evidence Set Digest, timestamp. Written into the artifact atomically with the work |
| **2. Desktop app** | Same store, but the Finding's origin is a UI action that must be described in words rather than replayed | Must be synthesised from UI events. Higher implementation cost for a weaker record |
| **3. Local server (recommended)** | Same store as 1. This is the one write the UI is legitimately allowed to make — an examiner marking a Finding is the point of the UI | HTTP request log **plus** the mutation, both local, both appended to the same artifact. Because the process is loopback-bound and single-principal, "who" is unambiguous: the OS user who launched it |
| **4. Hosted server** | Same store, but now remote. The Finding must additionally carry an authenticated actor — **this is where I1 becomes mandatory rather than optional** | Now needs actor identity, session, and network provenance, and the log lives on a machine the examiner does not control. The audit trail becomes something the examiner must *trust* rather than *hold* |

Shape 4 is the only one where I1 stops being a product choice and becomes a structural obligation. That
is the cleanest statement of why I1 dies: **it dies because shape 4 died.**

---

## 9. STILL-UNKNOWN / verification queue, ranked by blast radius

| # | Unknown | Blast radius | How to close it |
|---|---|---|---|
| 1 | **Query latency and UI render behaviour at 10⁶ rows.** No number in this evidence set measures anything. SQLite's *limits* are settled (§1b); its *performance* on this workload is not | **Highest.** If a 10⁶-row Case artifact cannot be paged in the UI at interactive speed, J1/J2 need a different data-access design (server-side pagination, virtualised tables, or a columnar sidecar) | Build a harness: generate a synthetic `urls` table at 10⁴/10⁵/10⁶ rows, measure cold-open, filter, sort and export. Same discipline as #136's harness ticket |
| 2 | **DuckDB was captured but not mined.** `t4-duckdb-why` (200, 276,246 B), `t4-duckdb-stable`, `t4-duckdb-clients` are on disk and unread; `t4-duckdb-docs` and `t4-duckdb-install` are JS-redirect stubs (recorded as thin in the manifest) | **High** if #1 fails. DuckDB is the obvious analytic answer if SQLite proves too slow for 10⁶-row aggregations — and it changes the artifact format decision | Read the captured DuckDB pages; specifically whether a DuckDB file has comparable single-file-document and long-term-preservation properties to SQLite, and its embedding/licence story |
| 3 | **Hindsight's actual bind address and whether its GUI writes to the same store its CLI does** | **High.** Hindsight is the single closest precedent and the spine of this brief's argument. If its GUI re-derives everything rather than reading a CLI artifact, the "shipped both interfaces" finding is weaker than stated | Read `pyhindsight` source: `hindsight_gui.py` bind arguments, and whether the GUI's SQLite output is the same schema the CLI's `-f sqlite` emits |
| 4 | **CA/B Forum Code Signing BR v3.11 body — the HSM key-storage requirement** | **High** for the release plan. It determines whether signing can happen in CI at all, and therefore the real cost of shipping a signed Windows binary. Currently asserted only on Electron's authority | Fetch the v3.11 PDF from `cabforum.org` and read the subscriber private-key protection section |
| 5 | **Velociraptor's, DB4S's, Autopsy's and KAPE's actual licences** — three return `NOASSERTION`/`null` from the GitHub API and one is not stated anywhere in the captures | **Medium.** Does not affect the shape decision. Does affect whether any of them can be vendored, wrapped, or referenced as a compatible output format | Fetch each repo's `LICENSE`/`COPYING` at raw.githubusercontent, and KAPE's own terms page |
| 6 | **rust-embed** — GitHub path 404'd; the crates.io capture is a single 116.8 KB line this agent cannot read | **Medium.** Only matters if Rust is a serious candidate runtime; Tauri is covered independently | Re-fetch with a pretty-printed or field-selected crates.io query, and locate the correct GitHub org |
| 7 | **Go cross-compilation mechanics (`GOOS`/`GOARCH`)** — asserted nowhere in this brief. The 12-binary Velociraptor release is suggestive, not documentation | **Medium.** Load-bearing for the "one build machine, all platforms" claim if Go is chosen | Fetch `go.dev/doc/install/source` or the `go build` reference |
| 8 | **SWGDE published listing pages 2..n, and the body of SWGDE 25-Q-001-1.0** | **Medium-low.** Section 6's negative finding is honest about its coverage, but a later page could contain a tool-validation document that speaks to reproducibility. It would not change the recommendation; it could change how §6 is worded | Paginate the rendered listing with a browser; download the 25-Q-001-1.0 PDF and read the Tool Selection and Use Lifecycle section |
| 9 | **FRE 702's December 2023 amendment date** — the LII capture's history parenthetical lists 1975/2000/2011 only, though the captured rule text is the amended wording | **Low.** Section 6's conclusion (standards are silent on shape) does not depend on the date | Fetch the Advisory Committee's 2023 note, or uscourts.gov's rules page |
| 10 | **PyInstaller / packed-binary antivirus false positives from a first-party source** | **Low.** The mitigation (publish SHA-256 + detached signatures, document the expectation) is correct regardless, and is already evidenced by the EZ-tools page | Fetch the PyInstaller FAQ and the tracked AV issue thread |
| 11 | **browser-history's PyPI artifacts** — `t1-browserhistory-pypi` captured (200, 25,130 B) but not mined | **Lowest.** One row in the comparator table | Read the capture |
| 12 | **ISO/IEC 27037** — 403, paywalled | **Unknown by definition.** No claim about it appears in this brief and none should until someone reads the purchased standard | Purchase, or find an authoritative summary that quotes it directly |

---

## Sources

**Kept — primary, all fetched and stored under `research/_raw/129/`, all statuses in
`research/_raw/129-fetch-manifest.md`**

- `t1-hindsight-release`, `t1-hindsight-repo`, `t1-hindsight-readme` — every byte size, download count,
  licence and UI-launch claim about the closest comparable tool. **The spine of the argument.**
- `t1-timesketch-docker-compose`, `t1-timesketch-install`, `t1-timesketch-deploy-sh` — the hosted-shape
  operating cost as a concrete service list, RAM figure and root requirement rather than an adjective
- `t1-ez-tools`, `t1-getzimmermantools` — the Windows-examiner baseline, and the CLI↔GUI artifact-seam
  pattern already normative in that community
- `t1-velociraptor-release`, `t1-velociraptor-bulk`, `t1-velociraptor-repo` — the single-binary
  server+GUI+collector precedent, and per-asset detached signatures
- `t1-autopsy-download`, `t1-autopsy-repo`, `t1-plaso-release`, `t1-plaso-repo`, `t1-plaso-docs`,
  `t1-sqlitebrowser-dl`, `t1-sqlitebrowser-repo`, `t1-browserhistory-repo` — the distribution-artifact
  table
- `t2-node-sea`, `t2-node-stability` — SEA stability index, asset embedding, native-addon caveat,
  CI platform coverage, and `node:sqlite` at Stability 1.2
- `t2-pyinstaller-docs` — "it is not a cross-compiler"
- `t2-tauri-win-installer`, `t2-tauri-sign-windows` — WiX/NSIS constraints, the WebView2 install-mode
  table, and the OV/EV SmartScreen reputation split
- `t2-electron-codesign` — the June 2023 EV requirement and the FIPS-140-L2 HSM storage constraint
- `t2-smartscreen` — reputation-based warning behaviour, in Microsoft's own words
- `t2-cabforum-cs` — pins the current Code Signing BR version (v3.11, ballot CSCWG-32)
- `t2-go-embed` — `//go:embed` for "static web server content", standard library
- `t3-nist-cftt`, `t3-nist-cftt-pubs`, `t3-swgde-docs-rendered`, `t3-swgde-search-validation`,
  `t3-fre-702` — the basis for the **negative** finding in section 6
- `t4-sqlite-appfileformat`, `t4-sqlite-limits` — the single-file Case artifact argument and the
  storage ceilings

**Dropped, with reasons**

- `t3-iso-27037` — **403**, paywalled. No claim made
- `t2-rust-embed` — **404**, `pyrossh/rust-embed` did not resolve
- `t3-nist-cftt-tech` — **404**; `t3-nist-cftt-pubs` used instead
- `t1-velociraptor-offlinecollector` — **404**; `t1-velociraptor-bulk` used instead
- `t1-velociraptor-offline` — 200 but a meta-refresh stub
- `t4-duckdb-docs`, `t4-duckdb-install` — 200 but JS redirect stubs
- `t3-swgde-docs` (curl) — 200 but site chrome only; the browser-rendered capture was used
- `t2-rust-embed-crates` — 200 and on disk, but a single 116.8 KB line unreadable by this agent's tools
- `t2-pyinstaller-wrong`, `t2-pyinstaller-usage`, `t2-pyinstaller-spec` — read; contain no
  antivirus/false-positive material, so no such claim is made from them
- `t4-duckdb-why`, `t4-duckdb-stable`, `t4-duckdb-clients`, `t1-browserhistory-pypi`,
  `t1-sleuthkit-repo`, `t1-kapefiles-repo`, `t1-autopsy-site`, `t1-timesketch-site`,
  `t1-hindsight-license`, `t2-electron-appdist`, `t2-go-embed-spec`, `t3-nist-sp800-86`,
  `t3-swgde-home`, `t4-sqlite-whentouse` — captured, not mined for this brief. Listed here so the gap
  is visible rather than silent; items 2, 5 and 11 in the verification queue cover the ones that matter

## Terminology note

This brief uses CONTEXT.md's ubiquitous language deliberately: **Source** (what the investigator hands
over), **Working Copy** (the hashed copy analysis runs against), **Manifest** and **Evidence Set
Digest** (the integrity artifacts), **Provenance** (row → bytes), **Field State** (`value` / `absent` /
`unavailable`), **Candidate** vs **Finding**. The proposed **Case artifact** is the single SQLite file
that holds the Manifest, the Candidates, the Findings and the audit trail for one examination — it is
the durable thing the CLI emits and the UI reads, and it is the object the whole recommendation turns on.
Naming it formally in CONTEXT.md is a decision for the ticket, not for this brief.
