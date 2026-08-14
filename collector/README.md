# ForensiX Collector

`forensix-collect` is the independent, offline Go Collector for ForensiX v2.
It scans live Windows, macOS, and Linux accounts.
It emits a directory-tree Acquisition Bundle.

## Safety boundary

The Collector:

- opens Source paths for reading only
- never starts, stops, or signals Chrome
- opens no IP network endpoint and imports no process-control package
- performs no update or telemetry check
- copies Source bytes without opening SQLite or decrypting Source data
- reads Windows `Local State` only for the authorized OSCrypt wrapper capture
- reads a live key store only after explicit key-capture opt-in
- seals each derived row key before it writes the Acquisition Bundle
- never writes a plaintext provider secret or derived row key
- records authorization as an operator claim that it witnesses but does not verify

Run the Collector from removable media.
Do not download the Collector on the Source machine.

## Build and test

```sh
cd collector
go test ./...
go test -race ./...
go vet ./...
go build -trimpath ./cmd/forensix-collect
```

The Collector is outside the analyzer pnpm workspace.
The Collector has no runtime service dependency.
It uses native key-store APIs and local Unix D-Bus only.

## Collect

```sh
forensix-collect \
  --out ./BUNDLE-2026-014 \
  --operator examiner-7 \
  --authorization-reference "CASE-2026-014, authorized by lab lead"
```

If Chrome Liveness Evidence is present, the Collector does not copy that User Data Dir.
Wait for Chrome to stop, or add `--continue-if-chrome-running`.
The Collector does not touch the Chrome process.

Tier 2 bulk content is off by default.
Add `--include-bulk` to copy Tier 2 content.
The Collector always hashes and manifests every Source entry.

## Capture authorized key material

Key capture is off by default.
It requires `--capture-key-material`, the Authorization Reference, and an X25519 public key.
The private key stays with the investigator.

1. Create an X25519 private key.

   ```sh
   openssl genpkey -algorithm X25519 -out key-material-private.pem
   ```

2. Create its public key file.

   ```sh
   openssl pkey -in key-material-private.pem -pubout -out key-material-public.pem
   ```

3. Store the private key away from the live machine.

4. Run authorized capture with the public key.

   ```sh
   forensix-collect \
     --out ./BUNDLE-2026-014 \
     --operator examiner-7 \
     --authorization-reference "CASE-2026-014, authorized by lab lead" \
     --capture-key-material \
     --key-material-recipient-file ./key-material-public.pem
   ```

The sealed record uses X25519, HKDF-SHA-256, and AES-256-GCM.
The associated data covers the provider, context, policy, and wrapper references.
The Collector records the public-key fingerprint in `collector_record.json`.

### Provider bounds

- macOS reads `Chrome Safe Storage` for account `Chrome` through the Keychain API.
- Linux `basic` derives the demonstrated `v10` key from the Chrome basic provider.
- Linux `gnome-libsecret` reads unlocked `application=chrome` items through a local Unix D-Bus session.
- Linux `kwallet`, `kwallet5`, and `kwallet6` read an already-open `Chrome Keys/Chrome Safe Storage` entry.
- Windows unwraps only the legacy current-user `DPAPI` wrapper from `Local State`.
- Windows App-Bound `v20` records wrapper, version, and policy evidence only.

Use `--linux-key-provider` to select a Linux provider.
The value can be `auto`, `basic`, `gnome-libsecret`, `kwallet`, `kwallet5`, or `kwallet6`.
The `auto` value selects KWallet for KDE sessions and Secret Service for other sessions.
It never falls back to the known basic key.

The Collector binds live key-store access to the current OS account.
Other scanned accounts get reason `live-key-store-account-context-mismatch`.
The Collector never attaches the current account key to another account.

The Linux adapters refuse non-Unix D-Bus addresses.
They do not create, unlock, or update key-store items.
A locked or absent provider produces an `unavailable` record.

Windows `v20` records use reason `unsupported-google-app-bound-key-variant`.
They always set `usable_row_key` to `false`.
The Collector never attempts an App-Bound unwrap.

## Strip key material

Create a new Acquisition Bundle without the key-material subtree:

```sh
forensix-collect strip-keys \
  --out ./BUNDLE-2026-014-without-keys \
  ./BUNDLE-2026-014
```

The command verifies the input Acquisition Bundle before it copies files.
It refuses a missing, changed, or unmanifested file.
It does not change the input Acquisition Bundle.

The new `bundle_manifest.json` has these fields:

- `key_material_captured: false`
- `key_material_stripped: true`
- `original_bundle_digest` with the input digest
- a new `files` Manifest and `bundle_digest`

## Acquisition Bundle

Each collected User Data Dir contains:

- `manifest_header.json`
- canonical, path-sorted `manifest.jsonl`
- `working_copy/` with selected content

The bundle root contains:

- `bundle_manifest.json`
- `collector_record.json`
- `scan_record.json`
- `key_material/` only after explicit key capture

Each key-material directory contains:

- `key_material_manifest_header.json`
- canonical, path-sorted `key_material_manifest.jsonl`
- `records/` with sealed key records
- `evidence/` with opaque provider wrappers, when present

Reproduce the digests with standard tools:

```sh
# Evidence Set Digest
LC_ALL=C sort manifest.jsonl | sha256sum

# Working Copy Digest
grep '"copied":true' manifest.jsonl | LC_ALL=C sort | sha256sum

# Key-material Manifest digest
LC_ALL=C sort key_material_manifest.jsonl | sha256sum
```

The Manifest files are already in byte order.
A direct SHA-256 hash gives the same digest.

## Conformance status

The Collector implements the canonical Analyzer contract from issue #167.
Its tests read the shared Manifest and Selection Policy fixtures.
The tests compare wire bytes and both Source digests.

The key-material subtree has a separate Collector-owned contract.
Read [`contracts/key-material/README.md`](contracts/key-material/README.md) for its schemas and digest rules.
Read [`CONFORMANCE.md`](CONFORMANCE.md) for the Analyzer boundary.
