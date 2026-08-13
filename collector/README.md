# ForensiX Collector

`forensix-collect` is the independent, offline Go Collector for ForensiX v2. It scans live Windows, macOS, and Linux accounts and emits a directory-tree Acquisition Bundle.

## Safety boundary

The Collector:

- opens Source paths for reading only;
- never starts, stops, or signals Chrome;
- links no Go networking package and performs no update or telemetry check;
- copies bytes without parsing Chrome artifacts or opening SQLite;
- copies required browser evidence such as `Local State`, but does not perform the separate opt-in capture of live derived keys or key-store backing evidence;
- records authorization as an operator-supplied claim that it witnesses but does not verify.

Run it from removable media. Do not download it on the Source machine.

## Build and test

```sh
cd collector
go test ./...
go test -race ./...
go vet ./...
go build -trimpath ./cmd/forensix-collect
```

The module is intentionally outside the analyzer pnpm workspace. It has no runtime dependencies; `golang.org/x/sys` provides native read-only OS account and environment APIs.

## Collect

```sh
forensix-collect \
  --out ./BUNDLE-2026-014 \
  --operator examiner-7 \
  --authorization-reference "CASE-2026-014; authorized by lab lead"
```

If confirmed liveness evidence is present, that User Data Dir is not copied until the operator either waits for Chrome to close or reruns with `--continue-if-chrome-running`. The Collector does not touch the process. A stale `SingletonLock` is recorded as Liveness Evidence but does not by itself prove Chrome is running.

Tier 2 bulk content is off by default. Add `--include-bulk` to opt in. Every source entry is still hashed and manifested when bulk content is not copied.

## Acquisition Bundle

Each collected User Data Dir contains:

- `manifest_header.json`
- canonical, path-sorted `manifest.jsonl`
- `working_copy/` with selected content

The bundle root contains:

- `bundle_manifest.json`
- `collector_record.json`
- `scan_record.json`

Reproduce an Evidence Set Digest with standard tools:

```sh
# Evidence Set Digest
LC_ALL=C sort manifest.jsonl | sha256sum

# Working Copy Digest
grep '"copied":true' manifest.jsonl | LC_ALL=C sort | sha256sum
```

`manifest.jsonl` is already emitted in byte order, so hashing it directly gives the same Evidence Set Digest.

## Conformance status

The Analyzer implementation in issue #167 owns the final cross-implementation contract. Draft schema, Selection Policy, and digest logic are isolated in `internal/conformance`. See [`CONFORMANCE.md`](CONFORMANCE.md) for the assumptions that must be reconciled before merge.
