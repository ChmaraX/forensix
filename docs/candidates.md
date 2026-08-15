# Identity and behavior Candidates

The analyzer derives ranked **Candidates** from the Findings it has already
written for an Analysis Run. Candidates answer questions like "whose profile is
this?" and "what does this person do?" without ever asserting an answer.

## What a Candidate is

A Candidate is a **nominal, ranked hypothesis**. Every Candidate carries:

- a `candidateKind` (the TYPE, always the first column);
- a `category`, either `identity` or `behavior`;
- a `rank` (a positive integer, dense within its kind and Profile);
- a `supportingCount` (how many source rows support it);
- resolvable, row-level **Provenance**. When more than one source row supports a
  Candidate, the extra rows are carried as `provenance.supportingRows`.

A Candidate is **never** a Finding and **never** a factual summary tile:

- It has no Commit State.
- Its `candidateKind` is a ranked-hypothesis kind (`identity_*`, `behavior_*`),
  never a Finding kind.
- Names, countries, phone numbers, addresses, linked devices, and habits appear
  only here — ranked and hedged — never in a Finding field or a summary tile.

Candidate generation **reads** Findings. It never mutates, hides, re-scores, or
re-orders any Preferences, Web Data, History, or other source row. Removing the
Candidate pass leaves every other artifact byte-for-byte identical.

## Inputs and heuristics

Each heuristic consumes committed Findings from earlier parsers in the same run.

| Kind                      | Category | Evidence                                                                   |
| ------------------------- | -------- | -------------------------------------------------------------------------- |
| `identity_name`           | identity | Web Data autofill name-like fields; Preferences `full_name` / `given_name` |
| `identity_email`          | identity | Web Data autofill email-like fields or values; Preferences account `email` |
| `identity_phone`          | identity | Web Data autofill phone/tel/mobile fields                                  |
| `identity_postal_address` | identity | Web Data autofill address/street/city/state/zip fields                     |
| `identity_country`        | identity | Web Data autofill country fields; Local State `variations_country`         |
| `behavior_frequent_host`  | behavior | Host of each committed History visit URL                                   |
| `behavior_search_query`   | behavior | Query term parsed from known search-engine History URLs                    |

**Linked-device Candidates are deferred.** The parent intent names "linked
devices" as a future Candidate class, but no linked-device heuristic is supported
yet; none is emitted, so no linked-device value is ever asserted.

Only committed evidence is used. Sidecar (WAL / rollback-journal) rows never
feed Candidate generation, so a recovered row can never inflate a rank.

## Ranking

Within one `candidateKind` and Profile, evidence is grouped by a normalized key
(trimmed, whitespace-collapsed, lower-cased). Each group becomes one Candidate:

- `supportingCount` is the number of distinct source rows in the group;
- the displayed value is the most frequent raw form, with ties broken by the
  smallest value in code-unit order;
- groups are ordered by `supportingCount` descending, then by normalized value
  ascending, and assigned dense ranks `1..N` in that order.

At most 100 Candidates are emitted per kind per Profile, and at most 200
Provenance rows total are carried per Candidate (one primary plus up to 199
supporting).

## Deterministic behavior for the awkward cases

- **Ties.** Equal supporting counts are a total order: they break by normalized
  value ascending, so tied Candidates still receive distinct, reproducible
  ranks. Identical inputs always produce identical output.
- **No evidence.** A heuristic that finds nothing emits no Candidate. When every
  heuristic is empty but at least one input was produced, the Candidate artifact
  is `complete` with zero rows — the pass ran and nominated nothing.
- **Conflicting evidence.** Distinct values under one kind each become their own
  ranked Candidate. Conflicts are surfaced as a ranked list; they are never
  merged and never resolved into a single fact.
- **Unavailable inputs.** An `absent` or `unavailable` input contributes no
  evidence and is named in the artifact `reason` (for example
  `web_data_unavailable`). If at least one input was produced, the artifact is
  `complete`. If no input was produced, the artifact is `unavailable` (an input
  failed) or `absent` (no input was present). Candidate generation never changes
  the Analysis Run exit code that the source artifacts determine.

## Query surface

The `candidates` CLI command and the dashboard `Candidates` tab share the same
contract as every Finding list: TYPE first, and `--search`, `--category`,
`--kind`, `--profile` (multi-Profile), `--sort`, `--direction`, and keyset
`--limit` / `--after` pagination. The sorts are `rank`, `kind`,
`supporting-count`, `value`, and `profile`. Like every other artifact list, the
Candidate list returns rows only; the Completeness Statement for `Candidates` is
read from the shared `completeness` route (and the dashboard renders it before
any row).
