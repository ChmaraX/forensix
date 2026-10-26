# Security policy

## Supported versions

Only the latest 2.x pre-release gets security fixes.
Version 1 (branch `v1`) gets no fixes.

## Report a vulnerability

Do not open a public issue, pull request, or discussion for a vulnerability.

Report it privately with GitHub private vulnerability reporting:

1. Open the [Security tab](https://github.com/ChmaraX/forensix/security) of this repository.
2. Select **Report a vulnerability**.
3. Fill in the form.

Include this information:

- the affected component: the analyzer (`forensix` npm package) or the Collector (`forensix-collect`)
- the version (`forensix --version` or `forensix-collect --version`) and the operating system
- the steps to reproduce the problem, with a minimal input if possible
- the effect, for example data written to a Source, a secret shown without `--include-secrets`, or a network call
- a proposed fix, if you have one

Do not attach real evidence or personal data. Use a synthetic Chrome profile.

## What happens next

We confirm the report and keep you informed while we work on a fix.
We publish a GitHub Security Advisory when the fix is released.
