# ForensiX v2

ForensiX is a local, offline analyzer for Google Chrome forensic evidence.
Version 2 is a rebuild and does not use version 1 as a behavior reference.

## Current implementation

The Wave 1 tracer bullet can ingest a Chrome User Data Dir.
It creates one Case Directory for all detected Profiles.

The Case Directory contains:

- `case.fxdb`: the SQLite Case and its recorded Manifest
- `manifest.jsonl`: the canonical, path-sorted Manifest
- `manifest_header.json`: the Selection Policy, counts, and both digests
- `working-copy/`: the selected content for later analysis

The compiled CLI also runs the integrity check that occurs before analysis.
Artifact parsing starts in issue #168.

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

## Ingest a User Data Dir

Run the compiled CLI against the top-level Chrome directory.
Do not select one Profile directory for this command.

```sh
node cli/dist/cli.js ingest "/path/to/User Data" \
  --case "/path/to/CASE-001" \
  --json
```

Tier 2 content is off by default.
Add `--include-tier-2` to copy the Tier 2 paths from Selection Policy `chrome-userdata/1`.

## Check the Working Copy

Run the analysis preflight after ingest:

```sh
node cli/dist/cli.js analyse --case "/path/to/CASE-001" --json
```

The command refuses a missing, moved, changed, or extended Working Copy.
The refusal is a JSON diagnostic with code `WORKING_COPY_INTEGRITY_REFUSAL`.

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
