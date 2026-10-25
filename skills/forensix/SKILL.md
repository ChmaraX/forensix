---
name: forensix
description: Investigate Google Chrome forensic evidence offline with the ForensiX CLI. Use when the user asks to examine a Chrome profile, User Data directory, disk image, or ForensiX Case, or asks about browsing history, downloads, cookies, saved logins, autofill, bookmarks, or cache found on a machine.
allowed-tools: Bash(forensix:*), Bash(node */cli/dist/cli.js:*)
---

# ForensiX

This file is a discovery stub. The full guide ships inside the CLI, so it always matches the installed version.

Before you run any other `forensix` command, load the guide:

```bash
forensix skill get core
```

`core` holds the rules for every task and tells you which other guide to load:

```bash
forensix skill get acquire       # ingest a Source and run analyse
forensix skill get investigate   # answer questions about a Case
forensix skill get report        # export an Extract and render a Report
forensix skill list              # every guide in the installed version
```

If `forensix` is not on PATH, run the compiled CLI with `node <repo>/cli/dist/cli.js`.
