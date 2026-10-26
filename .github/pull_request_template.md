## What and why

<!-- What does this change do, and why? Link the issue, for example "Closes #123". -->

## Checklist

- [ ] The PR title is a Conventional Commit, for example `feat(cli): add the timeline command`.
- [ ] `pnpm verify` passes (`pnpm verify:full` for a change to ingest, analysis, or export).
- [ ] `go test ./...` passes in `collector/` (Collector changes only).
- [ ] Tests cover the change, end to end through the compiled CLI first.
- [ ] Docs are updated (README, `docs/reference.md`, or the agent skill), if needed.
- [ ] No real evidence or personal data is in a fixture.
