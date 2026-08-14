# AGENTS.md — ForensiX v2

Working rules for agents and contributors in this repository.

## Branching

- **`v2` is the integration branch.** Open every PR against `v2`.
- **Never merge to `master`.**
- Keep research ancestry out of product branches: do **not** add `CONTEXT.md` or
  other research-only scaffolding to `v2`.

## Toolchain

- **Node 24.15.0** (see `engines` in `package.json`).
- pnpm workspace monorepo (`core/`, `cli/`, `server/`, `client/`, `contracts/`,
  `collector/`, `e2e/`).
- Run the full gate before pushing:

  ```bash
  pnpm verify
  ```

  `verify` runs `format:check`, `lint`, `typecheck`, and the vitest suite.

## Conventional Commits (required)

Commit messages **and** PR titles must follow
[Conventional Commits](https://www.conventionalcommits.org/), for example:

```
feat(history): recover rollback-journal rows
fix(cli): retry transient SQLite open on Windows
ci: enforce conventional commits
test: harden Windows rollback-journal flake
chore: bump dependencies
```

Enforcement has two layers, because they cover two different things:

1. **Local commit messages** — the husky `commit-msg` hook
   (`.husky/commit-msg`) runs `commitlint` on every commit. The hook is
   installed by the `prepare` script (`husky`) during `pnpm install`. Shared
   config lives in `commitlint.config.cjs`
   (extends `@commitlint/config-conventional`).

2. **PR titles** — PRs are **squash-merged**, and the squash promotes the **PR
   title** to the commit that lands on `v2`. A recent merge landed as
   `Serve a read-only local Case dashboard (#171) (#197)`, which is **not**
   conventional. To prevent that, the `commitlint-pr-title` CI job
   (`.github/workflows/commitlint-pr-title.yml`) lints the PR title as a
   Conventional Commit on open/edit/reopen/synchronize.

When you rename a PR, keep the title conventional so the squash commit is valid.

## Forensic invariants (do not break)

- The Analyzer and Collector are **separate, offline** programs. Do not couple
  them.
- Do not change Analyzer behavior or output. Hardening (e.g. the bounded SQLite
  open retry in `core/src/sqlite-open.ts`) must leave successful results
  byte-for-byte identical; it only affects the transient-failure path.
