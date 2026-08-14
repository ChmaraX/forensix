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
The Collector and the tools under `tools/` are not workspace members.

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
Divergent files do not enter the Working Copy; unaffected evidence remains available.

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
| 2    | partial    | Some artifacts were unavailable; other results stay queryable. |
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

## Query Credential Metadata

The `credentials` command returns Login Data Findings with the same bounded, multi-Profile query surface as History.
Each query returns 50 rows by default; set `--limit` from 1 through 100 and use `nextCursor` as the next `--after` value.

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

Plaintext secrets are redacted by default; each withheld value keeps a hash so it stays citable.
Add `--include-secrets` to disclose them.
Binary payloads are separately hashed files, never base64 cells.

The Export Manifest and its derived digest are independently reproducible.
Two exports of the same Case are byte-identical except for the quarantined generation instant.
Use `--collection`, `--profile`, and `--commit-state` to scope the Extract.

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
