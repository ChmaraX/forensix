# Contributing to ForensiX

## Set up

You need Node.js 24.15 or newer (see `.nvmrc`), pnpm through Corepack, and Go (see `collector/go.mod`) for the Collector.

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

The analyzer workspaces are `core`, `cli`, `server`, and `client`.
The Collector in `collector/` is a separate Go module.

## Check your change

```sh
pnpm verify          # format, lint, types, tests
pnpm verify:full     # pnpm verify, then the offline end-to-end verification
cd collector && go test ./... && go vet ./...
```

Run `pnpm format` to fix the format. CI runs `verify:full` on Linux, macOS, and Windows.

## Tests

- Write an end-to-end test first. Run the compiled CLI on a synthetic Chrome profile, as the tests in `e2e/` do.
- Add a unit test only for logic that an end-to-end test cannot reach easily.
- Do not use real evidence or personal data in a fixture.
- A test that cannot run must skip with a message, never pass in silence.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(cli): add the timeline command` or `fix(core): keep WAL rows`.
The subject starts with a lower-case letter.
A commit hook checks local commit messages.

We squash-merge pull requests. The pull request title becomes the commit on `main`, so it must also be a Conventional Commit. CI checks the title.
The commit type sets the next version and the changelog: `feat` adds a feature, `fix` repairs a bug, and `!` or `BREAKING CHANGE:` marks a breaking change.

## Releases

[release-please](https://github.com/googleapis/release-please) makes the releases. You do not tag or publish by hand.

1. Each push to `main` opens or updates a release pull request. It sets the next version in all `package.json` files and updates `CHANGELOG.md`.
2. Merge the release pull request to release. The workflow `release-please.yml` then:
   - creates the tag `v<version>` and a draft GitHub Release
   - runs `pnpm verify:full`, then packs and smokes the `forensix` npm package
   - builds the six Collector binaries
   - attests the build provenance of all files and writes their SHA-256 checksums
   - publishes `forensix` to npm (dist-tag `latest`; after the first release, a pre-release goes to `next`)
   - attaches all files to the draft and publishes it
3. If a step fails, fix the cause. Then run the workflow `release-please` by hand (**Actions** → **release-please** → **Run workflow**) with `tag` set to the release tag, for example `v2.0.0-alpha.1`. A version that is already on npm is skipped.

A published release cannot change (immutable releases).

Users verify a download with its attestation and its checksums:

```sh
gh attestation verify forensix-collect-<version>-linux-amd64 --repo ChmaraX/forensix
sha256sum --check --ignore-missing SHA256SUMS-collector
sha256sum --check SHA256SUMS-analyzer
```

## Security

Do not report a vulnerability in a public issue. Read [SECURITY.md](SECURITY.md).
