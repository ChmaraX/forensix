# ForensiX v2

ForensiX is a local, offline analyzer for Google Chrome forensic evidence.
Version 2 is a rebuild and does not use version 1 as a behavior reference.

## Current implementation

The Analyzer ingests all five Source kinds: `USER_DATA_DIR`, `PROFILE_DIR`, `FILESYSTEM_ROOT`, `IMAGE_CONTAINER`, and `ACQUISITION_BUNDLE`.
A Case can hold multiple Sources and Profiles.
Each Source has an independent Manifest identity, Evidence Set Digest, and Working Copy Digest.

A single User Data Dir or Profile Dir keeps the Wave 1 Case Directory layout:

- `case.fxdb`: the SQLite Case and its recorded Manifest
- `manifest.jsonl`: the canonical, path-sorted Manifest
- `manifest_header.json`: the Selection Policy, counts, and both digests
- `working-copy/`: the selected content for later analysis

A Filesystem Root, Image Container, or Acquisition Bundle stores each Source under `sources/<source-id>/`.
The Case records all identities and paths.

The compiled CLI checks every Working Copy before each analysis.
It parses History and Login Data from all Profiles and Sources, then writes Findings to the Case.
Committed and recovery content use separate passes.
Recovered rows keep the `wal_resident` or `journal_resident` Commit State.

Login Data yields credential metadata: origin, username, timestamps, and the encrypted-secret wrapper.
The metadata is available independently of secret decryption.
An encrypted secret without authorized key material is `unavailable` with a typed reason, never absent or blank.

The analyzer also parses `Local State` and each Profile's `Preferences` JSON into metadata Findings.
Browser-level metadata (Chrome version, variations country, OSCrypt key presence) is scoped to the Source. Profile-level metadata (account data, demographics, screen resolution, and avatars) is scoped to its Profile.
Avatar and demographic values that live in the browser-level `profile.info_cache` slice are attributed to the owning Profile through a supporting Provenance row.
Every value is verified against the current schema and carries a Field State.
A removed or inapplicable key is `absent`.
A malformed or unreadable input is `unavailable` with a typed reason.

After the Findings are written, the analyzer derives ranked identity and behavior **Candidates** from them (Web Data autofill, Preferences/Local State metadata, and History visits).
A Candidate is nominal: it is a ranked hypothesis with a supporting count and resolvable row-level Provenance.
A Candidate is never a Finding and never a factual summary tile.
Names, countries, phone numbers, addresses, and habits only ever appear as ranked, hedged Candidates, never as asserted facts.
Candidate generation reads Findings and never mutates, hides, or re-scores any source row.
See [`docs/candidates.md`](docs/candidates.md) for the supported heuristics and their deterministic behavior for ties, no evidence, conflicting evidence, and unavailable inputs.

## Requirements

- Node.js 24.15.0 or newer
- pnpm 11.0.9 through Corepack

## Build

1. Select the required Node version.
2. Install the locked dependencies.
3. Build all four analyzer workspaces.

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

The workspace members are `core`, `cli`, `server`, and `client`.
The Collector is a separate Go program, not a workspace member.

## Ingest a Source

A User Data Dir is the canonical Source kind and remains the default:

```sh
node cli/dist/cli.js ingest "/path/to/User Data" \
  --case "/path/to/CASE-001" \
  --json
```

Select another Source kind explicitly:

```sh
node cli/dist/cli.js ingest "/path/to/Default" --source-kind PROFILE_DIR --case "/path/to/CASE-002" --json
node cli/dist/cli.js ingest "/mnt/filesystem" --source-kind FILESYSTEM_ROOT --case "/path/to/CASE-003" --json
node cli/dist/cli.js ingest "/mnt/image" --source-kind IMAGE_CONTAINER --case "/path/to/CASE-004" --json
node cli/dist/cli.js ingest "/path/to/bundle" --source-kind ACQUISITION_BUNDLE --case "/path/to/CASE-005" --json
```

A Profile Dir is a partial Source.
The Case records browser-level evidence such as `Local State` as `unavailable(outside_source)` without adding paths outside the Profile Dir to its Manifest.

A Filesystem Root is searched recursively for supported Chrome Sources.
Discovery does not assume one account or installation path.
For Image Containers, mount or extract the container offline and read-only first.
The Analyzer does not boot images, write to them, or parse opaque E01 files directly.

An Acquisition Bundle preserves every supplied acquisition-time Manifest in the Case.
Verification reports `match`, `mismatch`, `missing_on_disk`, and `missing_in_manifest` per file.
Divergent files do not enter the Working Copy. Unaffected evidence remains available.

Tier 2 content is off by default for direct, filesystem, and image ingestion.
Add `--include-tier-2` to copy Tier 2 paths from Selection Policy `chrome-userdata/1`.
An Acquisition Bundle retains the Collector's recorded Tier 2 choice.

## Analyze History

Run the analysis after ingest:

```sh
node cli/dist/cli.js analyse \
  --case "/path/to/CASE-001" \
  --timezone "America/New_York" \
  --origin-os macos \
  --json
```

The Declared Timezone defaults to `UTC`.
Use `--origin-os` only for History version 16 or earlier.
The accepted values are `windows`, `macos`, and `linux`.

The command refuses a missing, moved, changed, or extended Working Copy.
The refusal has the JSON code `WORKING_COPY_INTEGRITY_REFUSAL`.

### Analysis Run identity

Every `analyse` records one Analysis Run in the Case.
The Case is the record of truth.
Each Analysis Run keeps its run id, start time, end time, tool version, command line, Source, and exit state.

### Supersede semantics

A later successful Analysis Run supersedes earlier results at artifact granularity within the same Source.
Supersede retains every earlier row, so the lineage stays complete.
Queries return only the active result for each Source, Profile, and artifact.
An artifact rerun that ends unavailable supersedes nothing, and unrelated artifact rows stay untouched.
A failure in one artifact leaves the defensible results from the other artifacts queryable.

### Exit codes

The `analyse` command reports the run exit state through the process exit code:

| Code | Exit state | Meaning                                                        |
| ---- | ---------- | -------------------------------------------------------------- |
| 0    | clean      | Every artifact produced defensible results.                    |
| 2    | partial    | Some artifacts were unavailable. Other results stay queryable.  |
| 3    | failed     | The analysis produced no defensible artifact result.           |
| 1    | error      | Usage error, missing Case, or Working Copy integrity refusal.  |

The JSON output carries the same value in the `exitState` field.

## Query History Findings

Each query returns 50 rows by default.
Set `--limit` from 1 through 100.
Use `nextCursor` as the next `--after` value.

```sh
node cli/dist/cli.js history \
  --case "/path/to/CASE-001" \
  --view visits \
  --profile Default \
  --search "example.com" \
  --commit-state committed \
  --sort visit-time \
  --direction desc \
  --limit 50 \
  --json
```

The views are `visits`, `activity`, `most-visited`, and `durations`.
You can repeat `--profile` to query at most 100 Profiles.
Use `--commit-state` to keep committed and recovered rows separate.
The `--from`, `--to`, and `--transition` filters apply only to `visits`.
Timestamp bounds must include `Z` or a numeric offset.

## Query Cookie Findings

The `analyse` command parses each Profile's Cookie store in the same Analysis
Run as History, without decrypting any value. Query the Cookie Findings with:

```sh
node cli/dist/cli.js cookies \
  --case "/path/to/CASE-001" \
  --profile Default \
  --search "example.com" \
  --commit-state committed \
  --host ".example.com" \
  --same-site lax \
  --sort host \
  --direction asc \
  --limit 50 \
  --json
```

Each Cookie Finding records host, name, path, flags, and the exact SameSite,
priority, source scheme, source type, and port. Cookie timestamps use the
1601 Epoch Family. A legacy schema needs `--origin-os` before the analyzer
asserts the UTC instant. An encrypted cookie value stays `unavailable` with the
typed reason `encrypted_secret_without_key_material`, and the Finding still
reports the encryption scheme (`v10`, `v11`, `v20`) and the ciphertext byte
length. Use `--commit-state` to keep committed and sidecar-resident cookies
separate. Repeat `--profile` to query at most 100 Profiles, and use `nextCursor`
as the next `--after` value.

## Query Credential Metadata

The `credentials` command returns Login Data Findings with the same bounded, multi-Profile query surface as History.
Each query returns 50 rows by default. Set `--limit` from 1 through 100, and use `nextCursor` as the next `--after` value.

```sh
node cli/dist/cli.js credentials \
  --case "/path/to/CASE-001" \
  --profile Default \
  --search "example.com" \
  --commit-state committed \
  --sort created-time \
  --direction desc \
  --limit 50 \
  --json
```

The sorts are `created-time`, `last-used-time`, `origin`, `username`, and `profile`.
You can repeat `--profile` to query at most 100 Profiles.
Use `--commit-state` to keep committed and recovered rows separate.
Each credential Finding carries Provenance, the raw and UTC timestamps with their Epoch Family, and the secret's encryption prefix.
The secret itself stays `unavailable` with the reason `encrypted_secret_without_key_material` until authorized key material is supplied.

## Query identity and behavior Candidates

The `candidates` command returns ranked identity and behavior Candidates with the same bounded, multi-Profile query surface as the Finding lists.
TYPE (the `candidateKind`) is the first column, and each query returns a Completeness Statement before any row.
Each query returns 50 rows by default. Set `--limit` from 1 through 100, and use `nextCursor` as the next `--after` value.

```sh
node cli/dist/cli.js candidates \
  --case "/path/to/CASE-001" \
  --profile Default \
  --category identity \
  --kind identity_email \
  --search "example" \
  --sort rank \
  --direction asc \
  --limit 50 \
  --json
```

The sorts are `rank`, `kind`, `supporting-count`, `value`, and `profile`.
Filter by `--category identity|behavior` and by an exact `--kind`, and repeat `--profile` to query at most 100 Profiles.
Every row carries its `rank`, `supportingCount`, and resolvable Provenance. Aggregated evidence is carried as supporting Provenance rows.
A Candidate never carries a Commit State and is never a Finding.
See [`docs/candidates.md`](docs/candidates.md) for the heuristics and the deterministic behavior for ties, no evidence, conflicting evidence, and unavailable inputs.

## Decrypt supported secrets offline

Decryption is disabled by default.
An authorized investigator opts in with `--decrypt` and supplies authorized key material that carries Provenance.
The Analyzer stays offline: it makes no network calls, runs no provider daemons, never queries a live suspect key store, and never writes Source bytes.

```sh
node cli/dist/cli.js analyse \
  --case "/path/to/CASE-001" \
  --decrypt \
  --key-material "/path/to/key-material.json" \
  --recipient-key "/path/to/recipient.pem" \
  --json
```

Key material is either operator-`supplied` (`forensix/supplied-key-material/1`) or Collector-`captured` (`forensix/key-material-bundle/1`).
A captured bundle seals each derived OSCrypt row key to an X25519 recipient key, so `--recipient-key` unseals it offline (see `collector/contracts/key-material`).
Each row is dispatched independently by its own `v10`, `v11`, or `v20` prefix, so a mixed-version database is handled correctly.
Supported routes are Linux basic, GNOME Keyring, KWallet, macOS Keychain, the Windows `v10` key, and legacy Windows DPAPI, each only within its evidenced bounds.
A decrypted secret becomes a `value`. It is a Redaction State secret and stays withheld in an Extract unless `--include-secrets` is set.
Everything else stays `unavailable` with a distinct typed reason and is never a guessed unwrap:

- `unsupported_app_bound_v20` (Windows `v20` App-Bound)
- `unsupported_encryption_route`
- `no_authorized_key_material`
- `decryption_wrong_key`
- `decryption_malformed_ciphertext`
- `decryption_missing_context`
- `decryption_authentication_failed`

## Export a canonical Extract

An Extract is a scoped, deterministic, citable read over the Case.
It never becomes a second record of truth: every row is copied from Findings and Candidates that an Analysis Run already recorded.

```sh
node cli/dist/cli.js export \
  --case "/path/to/CASE-001" \
  --out "/path/to/EXTRACT-001" \
  --examiner "Jane Doe" \
  --csv \
  --json
```

The output directory must be outside the Case Directory and empty.
The command writes these files:

- `export_header.json`: a versioned header with the Case, Source, tool, examiner, Declared Timezone, scope, Redaction State, and the Completeness Statement.
- `findings.jsonl` and `candidates.jsonl`: canonical JSONL rows, one per line, with Findings and Candidates in separate collections.
- `findings.lossy.csv` and `candidates.lossy.csv` (only with `--csv`): a lossy CSV profile whose first column is `record_type`.
- `export_manifest.json`: the Export Manifest listing each file digest and a derived digest over them.
- `export_generation.json`: the single quarantined generation instant.

Each row keeps its Provenance, Field State, Commit State, and timestamp semantics.
The Completeness Statement records attempted, produced, absent, and unavailable artifacts before any result row is interpreted.

Plaintext secrets are redacted by default. Each withheld value keeps a hash so it stays citable.
Add `--include-secrets` to disclose them.
Binary payloads are separately hashed files, never base64 cells.

The Export Manifest and its derived digest are independently reproducible.
Two exports of the same Case are byte-identical except for the quarantined generation instant.
Use `--collection`, `--profile`, and `--commit-state` to scope the Extract.

## Generate an HTML Report

A Report is a self-contained, human-readable rendering of a single Extract.
The generator reads only the Extract that `export` emitted and never opens the Case.

```sh
node cli/dist/cli.js report \
  --extract "/path/to/EXTRACT-001" \
  --out "/path/to/report.html" \
  --json
```

The output is one self-contained HTML file with no runtime network dependency.
Every style is inlined.
When the Report is opened, it loads no external script, stylesheet, font, or image.
The `report` command accepts no `--case` option. Its only forensic input is the Extract.

The Report preserves the Extract scope, Redaction State, Completeness Statement, Finding vs Candidate type, Field State, Commit State, Provenance, and timestamp semantics.
Committed and sidecar (WAL / rollback-journal) rows stay in separate groups.
An empty string, an absent field, and an unavailable value render with three distinct words, never by color alone.
The Report recomputes the Export Manifest derived digest from the Extract bytes.
It marks the integrity as `verified` or `altered`.
An Extract edited after export is reported as altered, never passed off as authentic.

## Verify the implementation

Run the offline verification command:

```sh
pnpm verify
```

The e2e tests run the compiled CLI.
They independently check Source bytes, per-node hashes, the Evidence Set Digest, and the Working Copy Digest.

## Shared Manifest contract

The language-neutral contract is in [`contracts/manifest/`](contracts/manifest/README.md).
The Selection Policy is in [`contracts/selection-policy.chrome-userdata-1.json`](contracts/selection-policy.chrome-userdata-1.json).
The Analyzer and Go Collector must pass the same conformance fixtures.

## License

ForensiX uses the [MIT License](LICENSE).
