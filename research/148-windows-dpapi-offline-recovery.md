# 148 — Offline legacy Windows OSCrypt recovery from copied DPAPI evidence

**Ticket:** [Experiment: offline legacy Chrome OSCrypt recovery from copied Windows DPAPI evidence](https://github.com/ChmaraX/forensix/issues/148)

## 1. Decision

**The local-user result is positive for the tested M151 cases.**

ForensiX can recover a legacy Windows OSCrypt key from copied files when these inputs exist:

- the exact `Local State` file;
- the user DPAPI master-key file named by the wrapper;
- the user SID;
- the password that protects that master key.

The offline parser recovered the 32-byte key in two independent Source arms. It authenticated five `v10` cookie rows in each arm.

One arm used Chrome for Testing 151.0.7922.77. The other arm used branded Chrome 151.0.7922.72 with App-Bound Encryption disabled by policy.

The parser ran on macOS arm64. It did not boot the Source or call `CryptUnprotectData`.

**The domain-user result stays unsupported.** No domain lab or authorized domain backup key was available. A separate ticket must test that route.

## 2. Tested Source arms

Both arms used disposable local users on Windows Server 2025 build 26100. Each user had SID `S-1-5-21-1178926710-2200278958-3596451971-1003`.

| Arm | Browser | Configuration | Local State | Rows |
|---|---|---|---|---|
| CfT | Chrome for Testing 151.0.7922.77 | No system-level App-Bound support | Base64(`DPAPI` + 312-byte blob) | Five `v10` cookies |
| Branded | Google Chrome 151.0.7922.72 | `ApplicationBoundEncryptionEnabled=0` | Base64(`DPAPI` + 288-byte blob) | Five `v10` cookies |

Each Source stored these values:

- ASCII text;
- non-ASCII text;
- one 16-byte value;
- one 200-byte value;
- one one-byte value.

Chrome stopped before acquisition. The Source record says `SOURCE COLD`.

The [GitHub Actions Source run](https://github.com/ChmaraX/forensix/actions/runs/31317002371) contains the complete acquired sets. The branch is `research/148-windows-dpapi`.

## 3. Integrity

The Source workflow wrote a sorted SHA-256 Manifest for each snapshot. It used LF line endings and UTF-8 without a BOM.

| Snapshot | Files | Evidence Set Digest |
|---|---:|---|
| CfT `s1-cold` | 186 | `06b7eefc611caae311fe7b6ce870061fb7c9553afb734628d8f94c00725aab1c` |
| CfT `s2-after-user-pwchange` | 189 | `616640b9f9e5027f61c6e6a44e837e859112613774e4a2807230e19afa5fd887` |
| Branded `s1-cold` | 197 | `1c6d72aa5515abb5a11d6379146103b40c267ddb1153a6ab1221c10b714f8c41` |
| Branded `s3-after-admin-reset` | 198 | `04b710e5d3ddfece824f322d9d13e10eb93451361d25a677985383425cdcc1f4` |

A second-generation Working Copy was made on the analysis host. `sha256sum -c` succeeded before analysis.

It also succeeded after all recovery attempts and negative controls:

```text
branded-s1: 197/197 OK after analysis
branded-s3: 198/198 OK after analysis
cft-s1: 186/186 OK after analysis
cft-s2: 189/189 OK after analysis
```

The complete hives and browser files stay in the workflow artifacts. The repository contains the Manifests, Source records, and analysis results in `research/_raw/148-evidence/`.

## 4. Offline recovery chain

The parser completed these stages on the Working Copy:

1. It decoded `os_crypt.encrypted_key` from `Local State`.
2. It required the five-byte `DPAPI` header.
3. It parsed the DPAPI blob and read its master-key GUID.
4. It opened `%APPDATA%/Microsoft/Protect/<SID>/<GUID>`.
5. It derived three documented user-key candidates from the SID and password.
6. It authenticated and decrypted the DPAPI master key.
7. It authenticated and decrypted the DPAPI blob without optional entropy.
8. It required a 32-byte OSCrypt key.
9. It opened each `v10` row with AES-256-GCM.
10. It checked the cookie domain hash for database version 24.
11. It compared each result with the recorded plaintext.

Both Sources used the SHA-1 password-derivation candidate. Each recovered key had 32 bytes.

All 10 baseline rows matched the recorded plaintext. GCM authenticated each row.

The Finding provenance is:

```text
Manifest path -> chrome/udd/Default/Network/Cookies
Database      -> Cookies
Table         -> cookies
Row identity  -> rowid
```

## 5. Minimum and conservative acquisition sets

### Minimum set for the tested password route

The tested positive route used these inputs:

- `User Data/Local State`;
- the affected encrypted database and sidecars;
- `%APPDATA%/Microsoft/Protect/<SID>/<wrapper-master-key-GUID>`;
- the SID and local-account context;
- the password that protects the named master key.

Registry hives were not necessary for this route. A sparse Working Copy without `registry/` still authenticated all five rows.

### Conservative set

The Source workflow acquired this larger set:

- the complete Chrome User Data directory;
- the full roaming and local user `Microsoft/Protect` trees;
- `CREDHIST` and credential-store candidates;
- the system `Microsoft/Protect` tree;
- `SYSTEM`, `SECURITY`, `SAM`, and `SOFTWARE` hives;
- the SID, account type, domain state, OS build, and browser version.

The conservative set remains correct for unknown cases. This experiment only proves that the tested password route needs less data.

## 6. Password-change results

### User-initiated change

The CfT user changed password A to password B with `NetUserChangePassword` semantics. Windows created a new preferred master key protected by password B.

The existing Chrome wrapper still named the older master key. Password A still decrypted that key and all five rows.

Password B did not decrypt the older named master key. The result was:

```text
unavailable(windows-user-credential-invalid)
```

The copied `CREDHIST` file had 24 bytes and no history entries. This lab did not establish CREDHIST recovery.

The exact tested boundary is:

```text
unavailable(dpapi-password-history-unavailable)
```

This result applies when the current password cannot open the named historical master key and no usable CREDHIST entry exists.

### Administrator reset

The branded arm used an administrator password reset from password A to password C. The reset did not re-protect the Chrome master key.

Password A still recovered all five rows. Password C failed with `unavailable(windows-user-credential-invalid)`.

An administrator reset does not make the new password a recovery credential for old DPAPI data in this tested case.

## 7. Negative controls

| Control | Result |
|---|---|
| Correct supplied password | `ok`, five authenticated matches |
| Incorrect supplied password | `unavailable(windows-user-credential-invalid)` |
| Profile directory only | `unavailable(missing-windows-local-state)` |
| User Data directory only | `unavailable(missing-dpapi-master-key-material)` |
| Missing master-key file | `unavailable(missing-dpapi-master-key-material)` |
| Missing SID metadata | `unavailable(windows-sid-account-metadata-unavailable)` |
| Missing registry hives | `ok`, five authenticated matches |
| Cross-machine macOS analysis | `ok`, five authenticated matches |
| Mutated DPAPI wrapper | `unavailable(dpapi-unprotect-failed)` |
| Mutated `v10` ciphertext | `unavailable(row-authentication-failed)` |
| Wrong 32-byte row key | `unavailable(row-authentication-failed)` |
| 31-byte recovered key | `unavailable(invalid-oscrypt-key-length)` |
| Domain backup key | `unavailable(domain-lab-evidence-unavailable)` |

The parser emitted no plaintext after an authentication failure.

## 8. Typed unavailable values

The tested route uses these values:

- `missing-windows-local-state`
- `invalid-oscrypt-encrypted-key-wrapper`
- `missing-dpapi-master-key-material`
- `invalid-dpapi-master-key-material`
- `windows-sid-account-metadata-unavailable`
- `windows-user-credential-invalid`
- `dpapi-password-history-unavailable`
- `dpapi-unprotect-failed`
- `invalid-oscrypt-key-length`
- `unsupported-row-prefix`
- `row-authentication-failed`
- `cookie-host-binding-failed`
- `domain-lab-evidence-unavailable`

## 9. Public source support

The experiment used these public sources:

1. [Chromium M151 `os_crypt_win.cc`](https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/os_crypt_win.cc#28) creates the random key and DPAPI wrapper.
2. [Chromium M151 `dpapi_key_provider.cc`](https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/browser/dpapi_key_provider.cc#24) checks the wrapper and 32-byte result.
3. [Impacket 0.13.1 `dpapi.py`](https://github.com/fortra/impacket/blob/c456746d7a0f0bb25e8968a59f25aae1ad519935/impacket/dpapi.py) supplies the file structures, password derivation, master-key decryption, and DPAPI-blob authentication.
4. [Chromium M151 `encryptor.cc`](https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/components/os_crypt/async/common/encryptor.cc#35) defines the Windows AES-256-GCM row format.
5. [Chromium M151 `sqlite_persistent_cookie_store.cc`](https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/extras/sqlite/sqlite_persistent_cookie_store.cc) defines the version-24 SHA-256 host binding.
6. [Microsoft `CryptProtectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata) defines the runtime protection semantics.
7. [Microsoft `CryptUnprotectData`](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata) defines integrity and optional-entropy semantics.
8. [Microsoft DPAPI backup-key guidance](https://learn.microsoft.com/en-us/windows/win32/seccng/cng-dpapi-backup-keys-on-ad-domain-controllers) defines the untested domain recovery route.

The offline implementation uses public source code because Microsoft does not publish a complete local master-key file specification.

## 10. Reproduction

The Source scripts are:

- `research/_raw/148-driver.js`
- `research/_raw/148-source.ps1`
- `research/_raw/148-inspect.py`
- `research/_raw/148-acquire.ps1`
- `.github/workflows/research-148.yml`

The analysis parser is `research/_raw/148-recover.py`.

The analysis environment used Python 3.12.7, Impacket 0.13.1, and PyCryptodome 3.23.0.

```bash
python3 -m venv .venv-148
.venv-148/bin/pip install impacket==0.13.1 pycryptodomex==3.23.0
.venv-148/bin/python research/_raw/148-recover.py \
  WORKING_COPY \
  --password 'AUTHORIZED-PASSWORD' \
  --manifest MANIFEST.sha256 \
  --out results.json
```

The parser SHA-256 is recorded in `research/_raw/148-evidence/analysis/environment.txt`.

## 11. Untested boundaries

These cases stay unsupported:

- domain users and authorized domain backup keys;
- CREDHIST files with usable history entries;
- PIN, Windows Hello, and Protected Users;
- Microsoft-account passwords;
- Windows releases other than Server 2025 build 26100;
- Chrome milestones other than M151;
- old per-row raw-DPAPI formats;
- current App-Bound `v20` data.

The experiment created cookie rows only. Login Data uses the same OSCrypt provider and row encryptor, but no Chrome-created login row was measured.
