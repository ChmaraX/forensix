# Research briefs — ForensiX v2 renewal

**This branch is scaffolding. It is not merged into `master` and never will be.**

These briefs are working material for the decision tickets under the
[ForensiX v2 Renewal Spec](https://github.com/ChmaraX/forensix/issues/116) map.
They are *inputs to decisions*, not decisions. The decisions live on the
issues themselves.

## Status: UNVERIFIED

Most briefs here were produced **without web access**. The agents that wrote them
had no search or fetch tooling, so their content derives from model knowledge
rather than live primary sources.

**The exceptions are listed below and are held to a different standard.** They were
produced with live primary-source access and cite the ref/sha they read against:

- `127-oscrypt-portability.md` (partial — see below)
- `129-product-shape-survey.md` (fetch manifest at `_raw/129-fetch-manifest.md`)
- **`143-timestamp-epoch-version-matrix.md`** — see below
- **`144-offline-oscrypt-key-recovery.md`** — live primary-source research with unresolved recovery paths explicitly marked untested
- **`145-epoch-family-resolver-design.md`** (partial — see below)

The blanket warning in this section does **not** apply to those files.

Each brief therefore carries:

- a per-claim confidence tag (verified-by-knowledge / likely / unverified)
- a verification queue ranked by blast radius, with source URLs and what to check

**Do not cite these as fact.** Treat them as structured hypotheses awaiting a
verification pass.

### `127-oscrypt-portability.md` — the exception

That brief **was** produced with live source access and cites Chromium file paths and
constants directly. Its Verified sections are stronger than the rest of this directory.
Its Unverified sections are not. It also carries one recorded conflict with
[#118](https://github.com/ChmaraX/forensix/issues/118) over ABE milestone numbers, in which
#118 wins — the conflict is documented at the top of the file.

### `143-timestamp-epoch-version-matrix.md` — primary-sourced, and it corrects #125

That brief was produced with live access to Chromium source over gitiles. Every claim
cites a file path, a line, and the ref/sha it was read at. Its unresolved items are
quarantined in an explicit verification queue rather than guessed.

It **supersedes the epoch table in `125-integrity-facts-unverified.md`** and falsifies
two of that file's claims, including one of its HIGH-confidence answers. It also
records corrections to the text of [#143](https://github.com/ChmaraX/forensix/issues/143)
itself (a stale Chromium path). Working evidence, one file per artifact family, is in
`_raw/143-part-1..4-*.md`.

### `145-epoch-family-resolver-design.md` — the exception (partial)

That brief fetched live Chromium source (a newer `refs/heads/main` ref than `#143`'s) to confirm
the process-singleton lock mechanism differs by platform, and fetched `hindsight`'s actual source
over `raw.githubusercontent.com` and the GitHub API to check tool precedent. Both fetches are
cited with the ref/sha or URL read. Everything else in the file is design reasoning over
already-landed research (`#143`, `CONTEXT.md`) and is marked inline as such — it is not a second
independent verification pass over `#143`'s facts.

### `122-legal-constraints-decryption.md` — read this warning

That brief discusses computer-misuse statutes. It is **not legal advice**, it is
**unverified**, and it must not be relied on for any decision with legal
consequence. It exists to frame a design discussion on
[#124](https://github.com/ChmaraX/forensix/issues/124), nothing more.

## Contents

| File | Ticket | Question |
|---|---|---|
| `118-chrome-artifacts-today.md` | [#118](https://github.com/ChmaraX/forensix/issues/118) | How Chrome profile artifacts work in current versions |
| `119-url-classifier-options.md` | [#119](https://github.com/ChmaraX/forensix/issues/119) | Replacing the 700MB scikit-learn pickle |
| `121-acquisition-practice.md` | [#121](https://github.com/ChmaraX/forensix/issues/121) | Forensically sound acquisition, and v2's input contract |
| `122-legal-constraints-decryption.md` | [#122](https://github.com/ChmaraX/forensix/issues/122) | Constraints on shipping credential decryption |
| `127-oscrypt-portability.md` | [#127](https://github.com/ChmaraX/forensix/issues/127) | Whether a committed fixture's encrypted rows decrypt off-box, per platform |
| `129-product-shape-survey.md` | [#129](https://github.com/ChmaraX/forensix/issues/129) | What shape v2 should take (CLI / desktop / local server / hosted), and which v1 capabilities survive it — **live primary sources**, fetch manifest at `_raw/129-fetch-manifest.md` |
| `143-timestamp-epoch-version-matrix.md` | [#143](https://github.com/ChmaraX/forensix/issues/143) | Which epoch family every Chrome timestamp column uses, and at which `meta.version` it changed — **live primary sources**, evidence in `_raw/143-part-1..4-*.md` |
| `144-offline-oscrypt-key-recovery.md` | [#144](https://github.com/ChmaraX/forensix/issues/144) | Whether Chrome OSCrypt keys can be recovered offline from real macOS Keychain, Linux keyring/wallet, and legacy Windows DPAPI evidence — **live primary sources**, copied-store paths explicitly untested |
| `145-epoch-family-resolver-design.md` | [#145](https://github.com/ChmaraX/forensix/issues/145) | How ForensiX resolves a timestamp's Epoch Family, given that `meta.version` alone cannot decide it — **partial live primary sources** (Chromium process-singleton source, `hindsight` tool source), builds on `#143`/`143-timestamp-epoch-table.yaml` |
