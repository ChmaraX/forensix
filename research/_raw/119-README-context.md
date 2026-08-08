# Research briefs — ForensiX v2 renewal

**This branch is scaffolding. It is not merged into `master` and never will be.**

These briefs are working material for the decision tickets under the
[ForensiX v2 Renewal Spec](https://github.com/ChmaraX/forensix/issues/116) map.
They are *inputs to decisions*, not decisions. The decisions live on the
issues themselves.

## Status: UNVERIFIED

Every brief here was produced **without web access**. The agents that wrote them
had no search or fetch tooling, so all content derives from model knowledge
rather than live primary sources.

Each brief therefore carries:

- a per-claim confidence tag (verified-by-knowledge / likely / unverified)
- a verification queue ranked by blast radius, with source URLs and what to check

**Do not cite these as fact.** Treat them as structured hypotheses awaiting a
verification pass.

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
