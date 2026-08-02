# Verification report for issue #121

**Companion to:** `/tmp/forensix-research/121-acquisition-practice.md`  
**Verified:** 2026-08-02  
**Scope:** Chrome acquisition practice and the ForensiX v2 input contract

This report verifies the queue in section 7 of the brief. It does not replace the brief.

## Result summary

| Queue item | Result | Main effect on the brief |
|---|---|---|
| V1 | **CORRECTED / PARTIAL** | Current Chromium uses `TRUNCATE` rollback journals by default. Historical version boundaries remain unknown. |
| V2 | **CONFIRMED / PARTIAL** | Standard Chrome paths are correct. Paths for other Chromium-family browsers remain unknown. |
| V3 | **CONFIRMED / STILL-UNKNOWN** | Chrome 127 introduced App-Bound Encryption for cookies. No fetched source proves a clean dead-box workflow for current Chrome. |
| V4 | **CONFIRMED with current revisions** | Current SWGDE documents are newer than the brief expected. Exact titles and versions are below. |
| V5 | **CONFIRMED with limits** | CFTT still publishes imaging and write-blocker reports. The age of reports varies by category. |
| V6 | **CORRECTED** | `diskshadow` creates a new VSS snapshot. KAPE and Velociraptor process existing snapshots. |
| V7 | **CORRECTED / PARTIAL** | Apple-silicon storage is hardware-bound. A complete forensic snapshot procedure remains unknown. |
| V8 | **CORRECTED** | Most named carving examples are stale or have license problems. `sqlite-dissect` is the strongest integration candidate. |
| V9 | **PARTIALLY CORRECTED** | Hindsight, Autopsy, and KAPE are verified. Other tools named in the brief remain unknown. |

## Input-contract verdict

The five source kinds in section 0 remain valid:

1. `USER_DATA_DIR`
2. `PROFILE_DIR`
3. `FILESYSTEM_ROOT`
4. `ACQUISITION_BUNDLE`
5. `IMAGE_CONTAINER`

The following corrections are required:

1. Keep `USER_DATA_DIR` as the canonical Chrome directory input.
2. Do not claim that `Local State` is the decryption key source on every operating system.
3. Make decryption dependencies operating-system specific.
4. Capture `-journal` sidecars as a normal case. Do not describe WAL as Chrome's default journal mode.
5. Probe SQLite journal mode at analysis time. Do not infer it from the filename.
6. Search both `Cookies` locations: `<profile>/Cookies` and `<profile>/Network/Cookies`.
7. Permit a bundle to contain a live-exported App-Bound key and its provenance record.
8. Keep native E01, VMDK, and similar parsing outside the v2.0 minimum scope.

### Correct decryption dependency model

These items are known prerequisites. They are not proven sufficient for offline decryption.

| Platform | Known prerequisites | `Local State` role |
|---|---|---|
| Windows, legacy DPAPI | `Local State`, user DPAPI material, and credentials or equivalent secrets | Contains `os_crypt.encrypted_key`. It is mandatory for the current AES key path. |
| Windows, App-Bound Encryption | `Local State` plus machine and user protection context, or a live key export | Contains `os_crypt.app_bound_encrypted_key`. Offline sufficiency remains `STILL-UNKNOWN`. |
| macOS | Login Keychain secret and the profile data | The key provider reads Keychain. `Local State` is evidence, but it is not the key source shown by Chromium. |
| Linux | Secret Service, KWallet, or the configured fallback provider | The provider reads the desktop secret service. It does not use `Local State` as its key source. |

Provider sources:

- https://raw.githubusercontent.com/chromium/chromium/main/components/os_crypt/async/browser/dpapi_key_provider.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/os_crypt/async/browser/keychain_key_provider.mm
- https://raw.githubusercontent.com/chromium/chromium/main/components/os_crypt/async/browser/freedesktop_secret_key_provider.cc

**Correction to section 0, rule 2:** The sentence "Without it, encrypted cookie values and `Login Data` password blobs cannot be decrypted at all" is false as a cross-platform statement. It is correct for current Windows key storage.

---

# V1 — SQLite filenames and journal modes

## V1.1 Chromium's default journal mode

**Status: CORRECTED**

Fetched URL:

- https://raw.githubusercontent.com/chromium/chromium/main/sql/database.h
- https://raw.githubusercontent.com/chromium/chromium/main/sql/database.cc

Settling code from `sql/database.h`:

```cpp
// If true, enables SQLite's Write-Ahead Logging (WAL).
DatabaseOptions& set_wal_mode(bool wal_mode) {
  wal_mode_ = wal_mode;
  return *this;
}
...
bool wal_mode_ = false;
```

Settling code from `sql/database.cc`:

```cpp
if (UseWALMode()) {
  if (!Execute("PRAGMA journal_mode=WAL")) {
    ...
  }
} else {
  // For speed, change the journal mode from the default DELETE to TRUNCATE.
  ...
  if (!Execute("PRAGMA journal_mode=TRUNCATE")) {
    ...
  }
}
```

The brief expected WAL on at least cookies. Current Chromium source does not support that expectation.

The normal mode for a `sql::Database` is `TRUNCATE`. A component must explicitly enable WAL.

A `TRUNCATE` commit leaves a zero-length `<database>-journal` file. Therefore, `-journal` is a normal Chrome sidecar.

## V1.2 Per-database result

| Database file | Current relative location | Current default mode | Settling evidence |
|---|---|---|---|
| `History` | Profile root | `TRUNCATE` | `HistoryDatabase` gates WAL with `kHistoryDatabaseWriteAheadLogging`. The feature is disabled by default. |
| `Cookies` | Profile root or `Network/` | `TRUNCATE` | The cookie backend creates `sql::DatabaseOptions()` without `set_wal_mode()`. |
| `Login Data` | Profile root | `TRUNCATE` | `LoginDatabase` sets page and cache sizes only. |
| `Login Data For Account` | Profile root | `TRUNCATE` | It uses the same `LoginDatabase` class. |
| `Web Data` | Profile root | `TRUNCATE` | WAL uses `kSqlWALModeOnWebDatabase`. The feature is disabled by default. |
| `Account Web Data` | Profile root | `TRUNCATE` | It uses the same `WebDatabase` class. |
| `Favicons` | Profile root | `TRUNCATE` | `FaviconDatabase` sets page and cache sizes only. |
| `Top Sites` | Profile root | `TRUNCATE` | `TopSitesDatabase` sets cache size only. |
| `Shortcuts` | Profile root | `TRUNCATE` | `ShortcutsDatabase` constructs the default `sql::Database`. |

Fetched URLs:

- https://raw.githubusercontent.com/chromium/chromium/main/components/history/core/browser/history_database.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/history/core/browser/features.cc
- https://raw.githubusercontent.com/chromium/chromium/main/net/extras/sqlite/sqlite_persistent_store_backend_base.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/password_manager/core/browser/password_store/login_database.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/webdata/common/web_database.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/favicon/core/favicon_database.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/history/core/browser/top_sites_database.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/omnibox/browser/shortcuts_database.cc

Feature definitions:

```cpp
BASE_FEATURE(kHistoryDatabaseWriteAheadLogging,
             base::FEATURE_DISABLED_BY_DEFAULT);
```

```cpp
BASE_FEATURE(kSqlWALModeOnWebDatabase,
             base::FEATURE_DISABLED_BY_DEFAULT);
```

Cookie backend construction:

```cpp
db_ = std::make_unique<sql::Database>(
    sql::DatabaseOptions()
        .set_exclusive_locking(false)
        .set_exclusive_database_file_lock(enable_exclusive_access_),
    histogram_tag_);
```

Password database construction:

```cpp
db_(sql::DatabaseOptions().set_page_size(2048).set_cache_size(32),
    /*tag=*/"Passwords")
```

## V1.3 Current filenames

**Status: CONFIRMED**

Fetched URLs:

- https://raw.githubusercontent.com/chromium/chromium/main/components/history/core/browser/history_constants.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/password_manager/core/browser/password_manager_constants.cc
- https://raw.githubusercontent.com/chromium/chromium/main/components/webdata/common/webdata_constants.cc
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/chrome_constants.h
- https://raw.githubusercontent.com/chromium/chromium/main/components/omnibox/browser/shortcuts_constants.cc

Settling constants include:

```cpp
kFaviconsFilename = "Favicons"
kHistoryFilename = "History"
kTopSitesFilename = "Top Sites"
kLoginDataForProfileFileName = "Login Data"
kLoginDataForAccountFileName = "Login Data For Account"
kWebDataFilename = "Web Data"
kAccountWebDataFilename = "Account Web Data"
kCookieFilename = "Cookies"
kShortcutsDatabaseName = "Shortcuts"
```

## V1.4 Cookie location

**Status: CORRECTED**

Fetched URLs:

- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/net/profile_network_context_service.cc
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/browser_features.cc
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/chrome_constants.h

The network context receives two paths:

```cpp
file_paths->data_directory = path.Append(chrome::kNetworkDataDirname);
file_paths->unsandboxed_data_path = path;
file_paths->trigger_migration =
    base::FeatureList::IsEnabled(features::kTriggerNetworkDataMigration);
```

The migration feature has this platform default:

```cpp
BASE_FEATURE(kTriggerNetworkDataMigration,
#if BUILDFLAG(IS_WIN)
             base::FEATURE_ENABLED_BY_DEFAULT
#else
             base::FEATURE_DISABLED_BY_DEFAULT
#endif
);
```

Therefore, `Cookies` is not in one universal location. ForensiX must check both locations.

## V1.5 Since-version history

**Status: STILL-UNKNOWN**

The fetched `main` source settles current behavior. It does not settle the first Chrome version for each mode or path.

The v2 contract does not need these version boundaries. Runtime probing is safer.

---

# V2 — User Data and cache paths

## V2.1 Chrome and Chromium paths

**Status: CONFIRMED**

Fetched URL:

- https://raw.githubusercontent.com/chromium/chromium/main/docs/user_data_dir.md

Current User Data paths:

| Platform | Product | User Data directory |
|---|---|---|
| Windows | Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data` |
| Windows | Beta | `%LOCALAPPDATA%\Google\Chrome Beta\User Data` |
| Windows | Dev | `%LOCALAPPDATA%\Google\Chrome Dev\User Data` |
| Windows | Canary | `%LOCALAPPDATA%\Google\Chrome SxS\User Data` |
| Windows | Chrome for Testing | `%LOCALAPPDATA%\Google\Chrome for Testing\User Data` |
| Windows | Chromium | `%LOCALAPPDATA%\Chromium\User Data` |
| macOS | Chrome | `~/Library/Application Support/Google/Chrome` |
| macOS | Beta | `~/Library/Application Support/Google/Chrome Beta` |
| macOS | Dev | `~/Library/Application Support/Google/Chrome Dev` |
| macOS | Canary | `~/Library/Application Support/Google/Chrome Canary` |
| macOS | Chrome for Testing | `~/Library/Application Support/Google/Chrome for Testing` |
| macOS | Chromium | `~/Library/Application Support/Chromium` |
| Linux | Chrome | `~/.config/google-chrome` |
| Linux | Beta | `~/.config/google-chrome-beta` |
| Linux | Dev | `~/.config/google-chrome-unstable` |
| Linux | Canary | `~/.config/google-chrome-canary` |
| Linux | Chrome for Testing | `~/.config/google-chrome-for-testing` |
| Linux | Chromium | `~/.config/chromium` |

Linux can override these paths with:

- `--user-data-dir`
- `$CHROME_USER_DATA_DIR`
- `$CHROME_CONFIG_HOME`
- `$XDG_CONFIG_HOME`

## V2.2 Cache paths

**Status: CONFIRMED**

The same Chromium document states:

- Windows and ChromeOS use the profile directory as the user cache directory.
- macOS maps `Library/Application Support/.../<profile>` to `Library/Caches/.../<profile>`.
- Linux maps `$XDG_CONFIG_HOME/.../<profile>` to `$XDG_CACHE_HOME/.../<profile>`.

Examples from the document:

```text
macOS user data:  ~/Library/Application Support/Google/Chrome
macOS cache:      ~/Library/Caches/Google/Chrome/Default
Linux user data:  ~/.config/google-chrome
Linux cache:      ~/.cache/google-chrome/Default
```

The actual HTTP cache is below `<user cache dir>/Cache`.

## V2.3 Snap Chromium

**Status: CORRECTED**

Fetched URLs:

- https://snapcraft.io/docs/reference/administration/data-locations/
- https://askubuntu.com/questions/1455357/how-to-get-consistent-default-user-data-dir-when-installing-snap-chromium

Snap defines:

```text
SNAP_USER_COMMON = /home/<username>/snap/<snap name>/common
SNAP_USER_DATA   = /home/<username>/snap/<snap name>/<revision>
```

The fetched Chromium case shows two layouts in use:

```text
~/snap/chromium/common/chromium/Default/
~/snap/chromium/current/.config/chromium/Default/
```

ForensiX must search both. The scanner must not assume one Snap layout.

## V2.4 Flatpak Chromium

**Status: CONFIRMED by path derivation**

Fetched URLs:

- https://docs.flatpak.org/en/latest/sandbox-permissions.html#filesystem-access
- https://raw.githubusercontent.com/flathub/org.chromium.Chromium/master/chromium.sh

Flatpak maps application state below:

```text
~/.var/app/$FLATPAK_ID/{cache,config,data}
```

The Chromium wrapper uses `$XDG_CONFIG_HOME/chromium`.

For app ID `org.chromium.Chromium`, the derived paths are:

```text
User Data: ~/.var/app/org.chromium.Chromium/config/chromium
Cache:     ~/.var/app/org.chromium.Chromium/cache/chromium/<profile>
```

## V2.5 Other Chromium-family browsers

**Status: STILL-UNKNOWN**

This run did not fetch authoritative path tables for Edge, Brave, Opera, or Vivaldi.

The scanner must keep these paths in a versioned registry. It must not mix them into the verified Chrome table.

---

# V3 — App-Bound Encryption

## V3.1 Release and scope

**Status: CONFIRMED**

Fetched URL:

- https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html

Settling text:

> "In Chrome 127 we are introducing a new protection on Windows ... App-Bound Encryption primitives."

> "We will be migrating each type of secret to this new system starting with cookies in Chrome 127."

The post says that passwords, payment data, and other tokens were future work. It does not give their release versions.

## V3.2 Key and data prefixes

**Status: CONFIRMED**

Fetched URLs:

- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_provider_win.h
- https://raw.githubusercontent.com/chromium/chromium/main/components/os_crypt/async/browser/dpapi_key_provider.cc

Settling code:

```cpp
inline constexpr uint8_t kCryptAppBoundKeyPrefix[] = {'A', 'P', 'P', 'B'};
inline constexpr char kAppBoundDataPrefix[] = "v20";
```

Legacy Windows data uses:

```cpp
constexpr char kKeyTag[] = "v10";
constexpr uint8_t kDPAPIKeyPrefix[] = {'D', 'P', 'A', 'P', 'I'};
```

## V3.3 Protection and support conditions

**Status: CONFIRMED**

Fetched URLs:

- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/README.md
- https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_win.cc

The Chromium README states that `PROTECTION_PATH_VALIDATION` checks the caller's user identity and executable path.

Current source also rejects App-Bound Encryption when these conditions apply:

- Chrome is not a system install.
- Chrome does not use the default User Data directory.
- Policy disables App-Bound Encryption.
- The profile roams.
- The User Data directory is on a network drive.

The source states:

> "App-Bound binds the encryption key to the SYSTEM DPAPI key, which does not roam with a roaming profile."

## V3.4 Offline and dead-box feasibility

**Status: STILL-UNKNOWN for a general offline workflow**

Fetched URLs:

- https://blog.elcomsoft.com/2026/01/browser-forensics-in-2026-app-bound-encryption-and-live-triage/
- https://raw.githubusercontent.com/runassu/chrome_v20_decryption/main/README.md
- https://raw.githubusercontent.com/Xaitax/Chrome-App-Bound-Encryption-Decryption/main/README.md
- https://raw.githubusercontent.com/runassu/chrome_v20_decryption/main/decrypt_chrome_v20_cookie.py

The Elcomsoft article states:

> "Even with the correct Windows password, you cannot decrypt the App-Bound keys offline for the time being."

The runassu proof of concept documents two protection stages:

> "first need to decrypt `app_bound_encrypted_key` with the SYSTEM DPAPI, followed by the user DPAPI."

Its code does not implement a dead-box workflow. It impersonates `lsass.exe`, enables `SeDebugPrivilege`, and calls DPAPI on the running Windows system.

The Xaitax tool also uses a live bypass. It injects code into a browser process identity. Its README states that it needs no administrator privilege.

These sources document live recovery implementations. They do not prove routine dead-box recovery from copied files.

Chrome changed the inner key format after release:

- Chrome 133 used `ChaCha20_Poly1305`, according to the runassu README.
- Chrome 137 returned to `AES-256-GCM` and a KSP-backed key path, according to the same README.

Therefore, ForensiX must treat App-Bound key recovery as a versioned capability.

### Input-contract effect

Add these optional bundle fields:

```json
{
  "decryption_material": {
    "type": "chrome_app_bound_key",
    "browser_version": "...",
    "key_id": "...",
    "artifact_path": "decryption/chrome-app-bound-key.bin",
    "artifact_sha256": "...",
    "export_method": "...",
    "export_tool": "...",
    "export_time_utc": "...",
    "source_file_sha256": "..."
  }
}
```

The report must distinguish these states:

- key not supplied
- key supplied but not verified
- key verified for this browser version
- key rejected
- key extraction not supported

---

# V4 — Standards and current revisions

## V4.1 SWGDE

**Status: CONFIRMED and updated**

Fetched URLs:

- https://www.swgde.org/17-f-002-2-1/
- https://www.swgde.org/18-f-002-2-0/
- https://www.swgde.org/14-f-003-2-0

Use these citations:

1. **SWGDE, _Best Practices for Computer Forensic Acquisition_, 17-F-002-2.1, Version 2.1, 2025-08-05.**
2. **SWGDE, _Best Practices for Digital Evidence Collection_, 18-F-002-2.0, Version 2.0, 2025-11-20.**
3. **SWGDE, _Considerations for Focused Collection of Digital Evidence_, 14-F-003-2.0, Version 2.0, 2025-11-20.**

The current listing uses "Acquisitions" in one link label. The document page title uses singular "Acquisition." Cite the document title.

## V4.2 NIST forensic guide

**Status: CONFIRMED**

Fetched URL:

- https://csrc.nist.gov/pubs/sp/800/86/final

Citation:

**NIST SP 800-86, _Guide to Integrating Forensic Techniques into Incident Response_, Final, 2006-09-01.**

## V4.3 NIST algorithm transition guide and SHA-1

**Status: CONFIRMED with correction**

Fetched URLs:

- https://csrc.nist.gov/pubs/sp/800/131/a/r2/final
- https://www.nist.gov/news-events/news/2022/12/nist-retires-sha-1-cryptographic-algorithm

Citation:

**NIST SP 800-131A Rev. 2, _Transitioning the Use of Cryptographic Algorithms and Key Lengths_, Final, 2019-03-21.**

NIST says:

> "SHA-1 should be phased out by Dec. 31, 2030."

> "We recommend that anyone relying on SHA-1 for security migrate to SHA-2 or SHA-3 as soon as possible."

ForensiX must use SHA-256 as its primary integrity hash. SHA-1 can appear only as a legacy interoperability value.

## V4.4 ISO/IEC 27037

**Status: CONFIRMED**

Fetched URLs:

- https://webstore.iec.ch/en/publication/11317
- https://webstore.ansi.org/standards/incits/incitsisoiec270372012r2024

Citation:

**ISO/IEC 27037:2012, _Information technology — Security techniques — Guidelines for identification, collection, acquisition and preservation of digital evidence_, Edition 1.0, 2012-10-15.**

ANSI reaffirmed the identical national adoption in 2024 as `INCITS/ISO/IEC 27037:2012 (R2024)`.

---

# V5 — NIST CFTT

**Status: CONFIRMED with limits**

Fetched URLs:

- https://www.nist.gov/itl/ssd/software-quality-group/computer-forensics-tool-testing-program-cftt/cftt-technical
- https://www.nist.gov/itl/ssd/software-quality-group/disk-imaging-cftt
- https://www.nist.gov/itl/ssd/software-quality-group/hardware-write-block-cftt
- https://www.dhs.gov/science-and-technology/nist-cftt-reports
- https://www.dhs.gov/publication/disk-imaging
- https://www.dhs.gov/publication/hardware-write-block
- https://www.dhs.gov/publication/software-write-block

CFTT still lists these active technical areas:

- Disk Imaging
- Hardware Write Block
- Software Write Block
- Digital Data Acquisition
- Deleted File Recovery
- SQLite Data Recovery
- Forensic Media Preparation

Current specification evidence:

- Disk imaging specification: Draft 1 of Version 4.0, 2004-10-04.
- Disk imaging test plan: Draft 1 of Version 1.0, 2005-11-10.
- Hardware Write Block specification: Version 2.0.

Current report evidence:

- Newest listed disk-imaging report: Falcon-NEO2 v1.0u1, 2024-02-13.
- Newest listed hardware write-block reports: Kanguru devices, 2025-12-16.
- Newest listed software write-block report: WiebeTech USB Data Diode v2.1.0.7, 2024-09-27.

CFTT remains active, but its specifications and report dates are uneven.

Do not write "NIST approved" for a tool. Cite the exact tested tool, version, report, and date.

---

# V6 — VSS invocation and collector support

## V6.1 Create and expose a snapshot

**Status: CONFIRMED**

Fetched URLs:

- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/diskshadow
- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/create_2
- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/expose

Microsoft gives this script pattern:

```text
set context persistent nowriters
set metadata c:\diskshadowdata\example.cab
set verbose on
begin backup
add volume c: alias systemvolumeshadow
create
expose %systemvolumeshadow% p:
exec c:\diskshadowdata\backupscript.cmd
end backup
```

Run it with:

```text
diskshadow /s script.dsh
```

For a collector, the `exec` script copies the Chrome file sets from the exposed snapshot.

## V6.2 `vssadmin`

**Status: CORRECTED**

Fetched URLs:

- https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/cc788055(v=ws.11)
- https://docs.velociraptor.app/docs/forensic/filesystem/ntfs/

The legacy syntax is:

```text
vssadmin create shadow /for=C:
```

Velociraptor documentation states that this creation command is for server-class Windows. Other Windows versions need WMI or another VSS API path.

Do not make `vssadmin create shadow` the universal collector implementation.

## V6.3 KAPE

**Status: CONFIRMED**

Fetched URL:

- https://raw.githubusercontent.com/EricZimmerman/KapeDocs/master/Pages/3.-Using-KAPE.md

KAPE defines `--vss` as:

> "Find, mount, and search all available Volume Shadow Copies on `--tsource`."

This wording describes existing snapshots. It does not say that KAPE creates a new acquisition snapshot.

## V6.4 Velociraptor

**Status: CONFIRMED**

Fetched URLs:

- https://docs.velociraptor.app/docs/forensic/filesystem/ntfs/
- https://raw.githubusercontent.com/Velocidex/velociraptor/master/accessors/ntfs/vss.go

Velociraptor registers:

```go
Name: "ntfs_vss"
Description: "Access the NTFS filesystem by considering all VSS."
```

The accessor enumerates VSS devices and their creation times. It is useful for historical Chrome databases.

### Collector-design result

The collector needs two separate actions:

1. Create a new snapshot for a consistent live collection.
2. Enumerate existing snapshots as independent historical evidence.

Do not combine these actions under one `--vss` meaning.

---

# V7 — Apple-silicon acquisition

## V7.1 Encryption and dead-box limits

**Status: CONFIRMED**

Fetched URL:

- https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web

Apple states that Apple-silicon internal storage remains encrypted when FileVault is off.

When FileVault is off, the volume key is protected by the hardware UID in the Secure Enclave.

When FileVault is on, Apple states:

> "Without valid login credentials or a cryptographic recovery key, the internal APFS volumes remain encrypted."

Removing the storage and attaching it to another computer does not bypass this protection.

A conventional raw dead-box image is not the normal decrypting acquisition path for Apple silicon.

## V7.2 Share Disk

**Status: CONFIRMED**

Fetched URL:

- https://support.apple.com/guide/mac-help/macos-recovery-a-mac-apple-silicon-mchl82829c17/mac

Apple documents this Recovery workflow:

1. Start the source Mac in macOS Recovery.
2. Select `Utilities > Share Disk`.
3. Select the volume.
4. Start sharing.
5. Connect from another Mac through Finder and copy files.

This is a logical file-sharing path. It is not a physical image or a write-blocked acquisition.

## V7.3 APFS local snapshots

**Status: CONFIRMED for command syntax**

Fetched URLs:

- https://keith.github.io/xcode-man-pages/mount_apfs.8.html
- https://keith.github.io/xcode-man-pages/tmutil.8.html

The current man-page syntax is:

```text
mount_apfs -s <snapshot> <pathname> <directory>
```

`tmutil localsnapshot` creates local Time Machine snapshots for included APFS volumes.

Creating a new snapshot changes the source. Forensic processing must prefer pre-existing snapshots.

The fetched Apple support pages do not provide a complete forensic snapshot-mount procedure.

**Status for a fully supported forensic command sequence: STILL-UNKNOWN.**

---

# V8 — SQLite deleted-record tools

## V8.1 `SQLite-Deleted-Records-Parser`

**Status: REFUTED as a v2 integration candidate**

Fetched URLs:

- https://github.com/mdegrazia/SQLite-Deleted-Records-Parser
- https://raw.githubusercontent.com/mdegrazia/SQLite-Deleted-Records-Parser/master/README.md

Evidence:

- Latest commit: 2015-06-22.
- It is a script and packaged CLI or GUI executable.
- The repository has no license file.
- The README documents main-database recovery only.

Do not integrate unlicensed code.

## V8.2 `undark`

**Status: REFUTED as a v2 integration candidate**

Fetched URL:

- https://github.com/alitrack/undark

The repository was archived in 2026. Its current README states:

> "This project is no longer maintained."

It also states that Undark has no WAL or rollback-journal support.

## V8.3 `bring2lite`

**Status: CORRECTED**

Fetched URLs:

- https://github.com/bring2lite/bring2lite
- https://raw.githubusercontent.com/bring2lite/bring2lite/master/README.md

Evidence:

- Latest commit: 2019-08-05.
- It accepts a main database, WAL, journal, or folder.
- It installs a Python console entry point.
- The README says `CC-BY-NC`.
- `setup.py` says `MIT`.

The license conflict blocks integration until the owners clarify it.

## V8.4 `sqlite-dissect`

**Status: CONFIRMED as the strongest candidate in this queue**

Fetched URLs:

- https://github.com/dod-cyber-crime-center/sqlite-dissect
- https://raw.githubusercontent.com/dod-cyber-crime-center/sqlite-dissect/master/README.md
- https://raw.githubusercontent.com/dod-cyber-crime-center/sqlite-dissect/master/LICENSE.txt

Evidence:

- Latest commit: 2024-11-04.
- It has a Python package, CLI, and API example.
- It accepts a database with a WAL or rollback journal.
- It can carve table data and freelist pages.
- Its DC3 license grants use, modification, distribution, sublicensing, and sale.

Important limits from its README:

- Invalidated WAL frames are skipped.
- Rollback-journal support is under development.
- `WITHOUT ROWID`, virtual tables, and indexes are not carved.

Evaluate it behind an adapter. Do not make it the sole recovery engine.

---

# V9 — Comparable input contracts

## V9.1 Hindsight

**Status: CORRECTED**

Fetched URLs:

- https://raw.githubusercontent.com/obsidianforensics/hindsight/main/hindsight.py
- https://raw.githubusercontent.com/obsidianforensics/hindsight/main/pyhindsight/analysis.py
- https://raw.githubusercontent.com/obsidianforensics/hindsight/main/pyhindsight/browsers/chrome.py
- https://github.com/obsidianforensics/hindsight/archive/refs/heads/main.zip

Current CLI text:

```text
-i, --input
Path to the Chrome(ium) profile directory (typically "Default").
If a higher-level directory is specified instead, Hindsight will recursively search for profiles.
```

Current code recursively identifies profiles and runs one parser per profile.

This resolves the brief's open question. Hindsight recursively discovers profiles from a higher-level directory.

Hindsight still takes a directory, not an image container.

It also has a separate cache path:

```text
-c, --cache
Path to the cache directory; only needed if the directory is outside the input directory.
```

The fetched source contains no `Local State`, `os_crypt.encrypted_key`, or `app_bound_encrypted_key` parser.

Its visible legacy cookie routine handles `v10`, direct Windows DPAPI, macOS Keychain derivation, and the Linux fallback.

Do not use Hindsight as proof that modern Windows decryption works from a profile directory alone.

## V9.2 Autopsy

**Status: CONFIRMED**

Fetched URLs:

- https://raw.githubusercontent.com/sleuthkit/autopsy/develop/docs/doxygen-user/data_sources.dox
- https://github.com/sleuthkit/autopsy/releases/tag/autopsy-4.23.1

Current documented input types:

- Disk Image or VM File
- Local Disk
- Logical Files
- Unallocated Space Image Files
- Autopsy Logical Imager Results
- XRY Text Export

Current documented image formats:

- raw single: `.img`, `.dd`, `.raw`, `.bin`
- raw split: `.001`, `.aa`
- EnCase: `.e01`
- virtual machine disk: `.vmdk`
- virtual hard disk: `.vhd`, `.vhdx`
- limited logical evidence: `.L01`

This confirms the brief's `FILESYSTEM_ROOT` and `IMAGE_CONTAINER` distinction.

## V9.3 KAPE

**Status: CONFIRMED**

Fetched URL:

- https://raw.githubusercontent.com/EricZimmerman/KapeDocs/master/Pages/3.-Using-KAPE.md

KAPE target processing uses:

```text
--tsource <drive-letter-or-UNC-path>
--tdest <output-directory>
--target <target-name>
```

Module processing uses a source directory through `--msource`.

KAPE can create VHD, VHDX, or ZIP output containers. The fetched input documentation does not describe native E01 or VMDK ingestion.

KAPE is evidence for drive and directory input. It is not evidence for native image-container input.

---

## V9.4 Tools not checked in this run

**Status: STILL-UNKNOWN**

This run did not verify CyLR, UAC, libewf, dfVFS, or the named commercial tools.

Their omission does not change the verified Hindsight, Autopsy, and KAPE comparison.

---

# Final changes required in the original brief

## Required corrections

1. Replace "WAL is expected on at least cookies" with "Chrome uses TRUNCATE by default. WAL is component-controlled."
2. Replace the universal `Local State` decryption claim with the operating-system table in this report.
3. State that current Hindsight can recursively find multiple profiles.
4. State that KAPE `--vss` processes existing VSS snapshots. It does not document snapshot creation.
5. State that Apple Recovery Share Disk is logical access, not physical imaging.
6. Remove `undark` and the Mari DeGrazia parser from the integration-candidate examples.
7. Mark `bring2lite` as license-blocked.
8. Add `sqlite-dissect` as an evaluation candidate with documented limits.
9. Update the SWGDE citations to the current 2025 versions.

## Recommendations that remain viable

The fetched evidence did not contradict these product decisions:

- Use the User Data directory as the normal directory unit.
- Accept a profile directory in degraded mode.
- Accept a mounted filesystem root.
- Build a manifest-based acquisition bundle.
- Keep native image parsing out of the v2.0 minimum scope.
- Capture every SQLite sidecar.
- Analyze a working copy.
- Report missing files and decryption capability as structured results.
- Keep cache paths separate from profile paths.
- Support a live acquisition path for current Windows secrets.

## Remaining unknowns

1. Exact first-version boundaries for each SQLite journal-mode change.
2. Exact first-version boundaries for App-Bound password and payment-data encryption.
3. A clean and repeatable offline App-Bound decryption workflow for current Chrome.
4. Authoritative current path tables for Edge, Brave, Opera, and Vivaldi.
5. A complete Apple-supported command sequence for mounting pre-existing APFS snapshots for forensic collection.
6. Docker behavior for FUSE-mounted images on each host operating system.
7. Input contracts for CyLR, UAC, libewf, dfVFS, and the named commercial tools.

## Reproducibility note

Most Chromium and tool-source URLs point to mutable `main` or `master` branches.

Pin commit hashes before the project uses this report as a release or legal attestation.
