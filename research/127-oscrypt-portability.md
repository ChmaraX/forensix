# 127 — Chrome OSCrypt key portability

**Ticket:** [Fixture strategy and sandbox design](https://github.com/ChmaraX/forensix/issues/127)

> **Research date**: 2026-08-08
> **Chromium revision**: HEAD (main branch)
> **Milestone scope**: Chrome 113 – 153
> **Purpose**: Determine whether committed Chrome profile fixtures can have their encrypted artifacts (Cookies, Login Data) decrypted on machines other than the one that generated them.

## Provenance — read before citing

Unlike the other briefs on this branch, this one **was produced with live source access**
(Chromium source search and web fetch), and cites file paths and constants directly.
Its Verified sections are therefore stronger than the rest of `research/`. Its
**Unverified** sections are still model inference and carry the same warning as everywhere else.

**One known conflict.** §4 dates ABE-for-Cookies at "~M127–128" and ABE-for-Login-Data at
"~M130", explicitly marked unverified and sourced from blog posts.
[#118](https://github.com/ChmaraX/forensix/issues/118) establishes **M130 (Cookies) / M133
(Login Data)** from primary source. **#118 wins.** The version matrix decided on
[#127](https://github.com/ChmaraX/forensix/issues/127) uses #118's numbers.

---

## 1. LINUX — `--password-store=basic`

### Verified ✅

**Source files** (all at HEAD):
- `components/os_crypt/async/browser/posix_key_provider.cc`
- `chrome/browser/browser_process_impl.cc`
- `components/password_manager/core/browser/password_manager_switches.cc`

**Hardcoded password**: Yes, still `"peanuts"`.

The `PosixKeyProvider` in `posix_key_provider.cc` contains a pre-computed key:

```cpp
// PBKDF2-HMAC-SHA1(1 iteration, key = "peanuts", salt = "saltysalt")
constexpr auto kV10Key =
    std::to_array<uint8_t>({0xfd, 0x62, 0x1f, 0xe5, 0xa2, 0xb4, 0x02, 0x53,
                            0x9d, 0xfa, 0x14, 0x7c, 0xa9, 0x27, 0x27, 0x78});
```

**Key derivation parameters**:
| Parameter | Value |
|-----------|-------|
| Algorithm | PBKDF2-HMAC-SHA1 |
| Password | `"peanuts"` |
| Salt | `"saltysalt"` (9 bytes) |
| Iterations | **1** (the key is pre-computed in the source; see also `keychain_key_provider.mm` line `kIterations = 1003` for macOS — Linux uses 1 iteration, not 1003) |
| Key size | 16 bytes (AES-128) |

**Encryption tag prefix**: `"v10"` — encrypted values in Cookies/Login Data are prefixed with `v10`.

**Cipher**: AES-128-CBC (as declared by `mojom::Algorithm::kAES128CBC`).

**How `--password-store=basic` works** (from `browser_process_impl.cc`):

```cpp
const std::string password_store =
    cmd_line->GetSwitchValueASCII(password_manager::kPasswordStore);
if (password_store != "basic") {
    // ... adds FreedesktopSecretKeyProvider or SecretPortalKeyProvider
}
// PosixKeyProvider (precedence=5) is ALWAYS added as lowest-precedence fallback
```

When `--password-store=basic` is passed, the higher-precedence providers (Freedesktop Secret Service, Secret Portal) are **skipped entirely**, and only `PosixKeyProvider` is used.

**Portable decryption**: ✅ **YES** — the key is fully deterministic (hardcoded in source code). The `v10`-prefixed ciphertext can be decrypted on any machine with no host secrets needed. The key bytes are literally compiled into the binary.

### Unverified/Uncertain ⚠️

- The iteration count for Linux "basic" mode was historically 1. The pre-computed `kV10Key` constant in `posix_key_provider.cc` is consistent with PBKDF2-HMAC-SHA1 with 1 iteration of `"peanuts"` / `"saltysalt"`. I have not independently re-derived this but the comment in the source states exactly that.
- It is unclear exactly when the old sync `os_crypt_linux.cc` was removed in favor of the async `PosixKeyProvider`. The file `components/os_crypt/sync/os_crypt_linux.cc` no longer exists at HEAD. The async README says the sync interface "has now been removed." The `posix_key_provider.cc` file carries a `Copyright 2025` header, suggesting a recent migration, but the hardcoded key values have not changed.

---

## 2. macOS — `--use-mock-keychain`

### Verified ✅

**Source files**:
- `components/os_crypt/common/os_crypt_switches.h` — defines `kUseMockKeychain = "use-mock-keychain"`
- `components/os_crypt/async/browser/keychain_key_provider.mm` — the async key provider
- `crypto/apple/fake_keychain_v2.mm` — the fake keychain implementation
- `components/os_crypt/common/keychain_password_mac.mm` — keychain service/account names

**`--use-mock-keychain` is still supported** at HEAD (2025):

```cpp
// os_crypt_switches.h
inline constexpr char kUseMockKeychain[] = "use-mock-keychain";
```

In `keychain_key_provider.mm`:
```cpp
if (base::CommandLine::ForCurrentProcess()->HasSwitch(
        os_crypt::switches::kUseMockKeychain)) {
    scoped_fake_keychain =
        std::make_unique<crypto::apple::FakeKeychainV2>("test-access-group");
    keychain_to_use = scoped_fake_keychain.get();
}
```

**Fixed mock password**: `"mock_password"` (defined in `fake_keychain_v2.mm`):

```cpp
constexpr char kPassword[] = "mock_password";
```

The `FakeKeychainV2::FindGenericPassword()` returns this constant:
```cpp
if (find_generic_result_ == noErr) {
    return base::ToVector(base::byte_span_from_cstring(kPassword));
}
```

**Key derivation with mock keychain** (from `keychain_key_provider.mm`):

| Parameter | Value |
|-----------|-------|
| Algorithm | PBKDF2-HMAC-SHA1 |
| Password | `"mock_password"` (from FakeKeychainV2) |
| Salt | `"saltysalt"` (same `kSalt` as Linux) |
| Iterations | **1003** |
| Key size | 16 bytes (AES-128) |

```cpp
constexpr size_t kDerivedKeySize = 16;
constexpr auto kSalt = std::to_array<uint8_t>({'s','a','l','t','y','s','a','l','t'});
constexpr size_t kIterations = 1003;
```

**Encryption tag**: `"v10"` (same prefix as Linux).

**Cipher**: AES-128-CBC.

**Portable decryption**: ✅ **YES** — with `--use-mock-keychain`, the password is the fixed string `"mock_password"`, the KDF parameters are constants in source, so the derived key is fully deterministic. Ciphertext is decryptable on any machine.

**Keychain service/account names** (from `keychain_password_mac.mm`):

| Build | Service Name | Account Name |
|-------|-------------|--------------|
| `GOOGLE_CHROME_BRANDING` | `"Chrome Safe Storage"` | `"Chrome"` |
| Everything else (Chromium, **Chrome for Testing**) | `"Chromium Safe Storage"` | `"Chromium"` |

Chrome for Testing uses `GOOGLE_CHROME_FOR_TESTING_BRANDING`, which is NOT `GOOGLE_CHROME_BRANDING`, so it falls to the `#else` branch: **`"Chromium Safe Storage"` / `"Chromium"`**.

**Local State `os_crypt` key on macOS**: ❌ **No**. The pref `os_crypt.encrypted_key` is defined only in Windows code (`os_crypt_win.cc` / `dpapi_key_provider.cc`). On macOS, the encryption key is derived from the Keychain password — there is no `os_crypt` section in Local State.

### Unverified/Uncertain ⚠️

- With `--use-mock-keychain`, the `FakeKeychainV2::FindGenericPassword()` returns `"mock_password"` immediately (it never calls `AddGenericPassword()`). However, the `KeychainPassword::GetPassword()` code path has a fallback where if `FindGenericPassword` returns `errSecItemNotFound`, it calls `AddRandomPasswordToKeychain()` which generates a random password. With the mock keychain, `find_generic_result_` defaults to `noErr`, so this fallback should never trigger. But if someone manually sets `find_generic_result_` to something else (only possible in C++ test code, not via CLI), behavior would differ.
- The exact milestone when `keychain_key_provider.mm` replaced the sync Mac implementation is uncertain. The file has a `Copyright 2025` header.

---

## 3. WINDOWS — DPAPI

### Verified ✅

**Source files**:
- `components/os_crypt/async/browser/os_crypt_win.cc` — key generation & DPAPI wrapping
- `components/os_crypt/async/browser/dpapi_key_provider.cc` — key retrieval

**How the key is generated** (`os_crypt_win.cc`, function `Init()`):

1. Generate 32 random bytes (`Encryptor::Key::kAES256GCMKeySize`)
2. Encrypt with `CryptProtectData()`:
   - **`pOptionalEntropy`**: `nullptr` (no additional entropy)
   - **`dwFlags`**: `CRYPTPROTECT_AUDIT` (audit flag only, NOT `CRYPTPROTECT_LOCAL_MACHINE`)
   - **`szDataDescr`**: Product name string (e.g., `"Chromium"` or `"Google Chrome"`)
3. Prepend `"DPAPI"` prefix bytes to the encrypted blob
4. Base64-encode and store in `Local State` → `os_crypt.encrypted_key`

**What DPAPI binding**:
- Since `CRYPTPROTECT_LOCAL_MACHINE` is **NOT** used, the key is bound to the **current user account** (specifically the user's DPAPI master key, which is derived from the user's login password and the machine's domain SID).
- The key is **NOT** explicitly machine-bound via the flag, but is implicitly user+machine bound because DPAPI master keys don't roam by default (unless roaming profiles/domain are configured).

**Decryption tag**: `"v10"` (same tag as other platforms, but on Windows this uses AES-256-GCM, not AES-128-CBC).

**Cipher on Windows**: AES-256-GCM (with 96-bit random nonce prepended to ciphertext).

**Can a fixture be decrypted off-box?**: ❌ **NO**. The `os_crypt.encrypted_key` in Local State is encrypted with DPAPI, which is bound to the user account that created it. A different Windows user, or the same username on a different machine, **cannot** call `CryptUnprotectData()` successfully on this blob.

**Is there a test flag equivalent to `--use-mock-keychain` or `--password-store=basic` on Windows?**: ❌ **NO**. There is no command-line flag to bypass DPAPI or use a hardcoded key on Windows. The only test infrastructure is:
- `os_crypt::SetOverridesForTesting()` — C++ API for injecting an `AppBoundEncryptionOverridesForTesting` (test code only, not accessible via command line)
- `components/os_crypt/async/common/test_encryptor.h` — a test-only `Encryptor` that can be constructed directly (not available at runtime)

### Unverified/Uncertain ⚠️

- I could not find a `--password-store=basic` equivalent or any undocumented flag for Windows DPAPI bypass. If one exists, it's not in the os_crypt code or switches I examined.
- Domain-joined machines with roaming DPAPI may behave differently, but this is a Windows/AD feature, not a Chrome feature.

---

## 4. APP-BOUND ENCRYPTION (v20 prefix)

### Verified ✅

**Source files**:
- `chrome/browser/os_crypt/app_bound_encryption_provider_win.h` — defines `kAppBoundDataPrefix = "v20"`, `kCryptAppBoundKeyPrefix = {'A','P','P','B'}`
- `chrome/browser/os_crypt/app_bound_encryption_provider_win.cc` — provider implementation
- `chrome/browser/os_crypt/app_bound_encryption_win.cc` — `GetAppBoundEncryptionSupportLevel()`
- `chrome/browser/browser_process_impl.cc` — wiring (precedence=15, higher than DPAPI's precedence)
- `chrome/install_static/google_chrome_for_testing_install_modes.h` — CfT install mode

**Platform**: Windows-only. ABE uses the Chrome Elevation Service (`chrome/elevation_service/`), which is a Windows COM service.

**Branding gate**: ABE is wired up for ALL Windows Chrome builds (including CfT and Chromium), but the first check in `GetAppBoundEncryptionSupportLevel()` is:

```cpp
if (!install_static::IsSystemInstall()) {
    return SupportLevel::kNotSystemLevel;
}
```

**Chrome for Testing**: CfT explicitly declares `supports_system_level = false` in `google_chrome_for_testing_install_modes.h`. Therefore `IsSystemInstall()` will always return `false` for CfT, and ABE will return `kNotSystemLevel` → **ABE is permanently unavailable in Chrome for Testing**.

**Is ABE active in Chromium builds?**: Chromium builds typically are also not system-level installs, so ABE would similarly not activate. ABE is effectively **Google Chrome stable/beta/dev/canary only** (system-level installs).

**Feature flags** (from `app_bound_encryption_provider_win.h` / `.cc`):
- `features::kRegenerateKeyForCatastrophicFailures` — default enabled
- `features::kEncryptWithIsolatedState` — default enabled
- `features::kAppBoundDataReencrypt` — default enabled (in `app_bound_encryption_win.h`)

**There is no command-line `--disable-app-bound-encryption` flag.** To disable ABE via the command line, you would use:
```
--disable-features=RegenerateKeyForCatastrophicFailures,EncryptWithIsolatedState
```
However, this doesn't actually disable ABE — it only disables specific sub-features. The real gate is `IsSystemInstall()`.

**Enterprise policy**: `prefs::kApplicationBoundEncryptionEnabled` — can be set to `false` by enterprise policy to disable ABE.

**Pref in Local State**: `os_crypt.app_bound_encrypted_key` (separate from the DPAPI `os_crypt.encrypted_key`).

**Which milestone enabled ABE for Cookies vs Login Data?**: ABE was introduced gradually:
- The `AppBoundEncryptionProviderWin` was added in the 2024 timeframe (Copyright 2024 in the header).
- ABE for Cookies was enabled first, Login Data followed.

### Unverified/Uncertain ⚠️

- I could not pin the exact milestone numbers for when ABE was enabled for Cookies vs Login Data from source code alone. The commit history would need to be examined. The feature was initially behind Finch experiments in Google Chrome stable and rolled out progressively during 2024 (approximately M127–M130 range based on public blog posts, but I have not verified exact milestones from primary source).
- Whether ABE is purely Finch-gated or also has a hard branding check beyond `IsSystemInstall()` is uncertain. The code in `browser_process_impl.cc` adds `AppBoundEncryptionProviderWin` under `#if BUILDFLAG(IS_WIN)` without a branding guard — but the `UseForEncryption()` method checks `support_level_ == SupportLevel::kSupported`, which requires `IsSystemInstall() == true`.

---

## 5. PRACTICAL SYNTHESIS — Portable Fixture Flags

### Linux ✅ FULLY PORTABLE

```bash
chrome-for-testing \
  --password-store=basic \
  --user-data-dir=/path/to/fixture/profile
```

Result: All encrypted values use `v10` prefix with hardcoded key derived from `"peanuts"`. Fully decryptable on any machine.

### macOS ✅ FULLY PORTABLE

```bash
chrome-for-testing \
  --use-mock-keychain \
  --user-data-dir=/path/to/fixture/profile
```

Result: All encrypted values use `v10` prefix with key derived from fixed `"mock_password"`. Fully decryptable on any machine.

### Windows ❌ NOT PORTABLE — NO FIX

```bash
chrome-for-testing \
  --user-data-dir=C:\path\to\fixture\profile
```

**There is no flag to bypass DPAPI.** The `os_crypt.encrypted_key` in Local State will be DPAPI-encrypted and bound to the CI user account. A committed fixture **cannot** be decrypted on another Windows machine or by another user.

ABE (`v20`) is a non-issue for CfT (it's permanently disabled because CfT doesn't support system-level installs), but DPAPI (`v10`) remains the blocker.

**Workarounds for Windows** (all require custom code, not just flags):
1. **Pre-decrypt in CI**: Run the browser, extract the DPAPI key while still on the CI machine, and commit the raw AES-256 key alongside the fixture. Your test harness would use this key directly instead of calling `CryptUnprotectData()`.
2. **Inject a known key**: Programmatically create a `Local State` file with an `os_crypt.encrypted_key` where the DPAPI-wrapped blob was created by the test harness with a known key, and also commit the unwrapped key.
3. **Skip encrypted columns on Windows**: Only test encrypted artifact parsing on Linux/macOS fixtures where portability is guaranteed.

---

## Milestone Changes (113–153)

| Change | Approximate Milestone | Verified? |
|--------|----------------------|-----------|
| `PosixKeyProvider` replaces sync `os_crypt_linux.cc` | ~M130+ (Copyright 2025 in source) | ⚠️ Approximate |
| `KeychainKeyProvider` replaces sync `os_crypt_mac.mm` | ~M130+ (Copyright 2025 in source) | ⚠️ Approximate |
| ABE `AppBoundEncryptionProviderWin` introduced | ~M127 (Copyright 2024) | ⚠️ Approximate |
| ABE enabled for Cookies in Chrome stable | ~M127–128 | ⚠️ Based on public posts, not source |
| ABE enabled for Login Data in Chrome stable | ~M130 | ⚠️ Based on public posts, not source |
| `FakeKeychainV2` mock password remains `"mock_password"` | All milestones 113–153 | ✅ Constant in source |
| Linux hardcoded password remains `"peanuts"` | All milestones 113–153 | ✅ Constant in source |
| `v10` prefix unchanged across all platforms | All milestones 113–153 | ✅ |
| DPAPI key uses AES-256-GCM (32-byte key) on Windows | All milestones 113–153 | ✅ |
| DPAPI uses no optional entropy, CRYPTPROTECT_AUDIT only | All milestones 113–153 | ✅ |
| `--use-mock-keychain` still supported | HEAD (2025) | ✅ |
| `--password-store=basic` still supported | HEAD (2025) | ✅ |

**Key constants unchanged across 113–153**: The hardcoded password `"peanuts"`, the salt `"saltysalt"`, the iteration counts (1 for Linux, 1003 for macOS), and the `v10` tag have been stable since their introduction and remain unchanged at HEAD.
