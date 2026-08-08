# `143-timestamp-epoch-table.yaml` — schema design, coverage, and the data-vs-code argument

**Artifact:** `research/143-timestamp-epoch-table.yaml`
**Lane B of [#145](https://github.com/ChmaraX/forensix/issues/145).** Derived by **transcription only**
from `research/143-timestamp-epoch-version-matrix.md` and `research/_raw/143-part-1..4-*.md`.
**No source was fetched and no new research was done.** Every `provenance[]` entry in the YAML is
a citation the #143 run made; nothing was added, tightened or invented here.

Validated: `python3 -c "import yaml; yaml.safe_load(open('research/143-timestamp-epoch-table.yaml'))"`
(pyyaml 6.0.1, available) — parses. Plus a structural pass asserting unique ids, controlled
vocabularies, non-empty provenance on every row, known refs, and `kind: timestamp` ⇒ has `epoch`
or `ambiguity`. **0 errors.**

---

## 1. Schema — every field, and why it exists

The key is **(artifact, table, column)**. `columns[].id` is `artifact-slug/table/column`, unique.
Whole-table negative rows use `column: null` and id suffix `/-`.

| Field | Exists because |
|---|---|
| `artifact` / `table` / `column` | #143 finding 3: **the epoch is per-column, not per-file.** Web Data at v153 holds three families; `autofill_ai_entities_metadata` holds two in adjacent columns of one row. A key of `artifact` alone is wrong by construction. |
| `kind` | Four values. `timestamp` \| `duration` \| `not_a_timestamp` \| `no_timestamp_columns`. Separates the "looks like a time, isn't" class (`visits.visit_duration`, `downloads.last_modified`, `offer.lifetime`, `duration_ms`) from real instants, and gives verified negatives their own type. |
| `epoch[]` | A **list** of `{version_range, platform, family, basis, source}`. A list, not a scalar, because a column's family depends on a `meta.version` range *and* (sometimes) on platform. `logins.date_created` has two entries; `urls.last_visit_time` has three. |
| `epoch[].version_range {min,max}` | Half-open, `null` = unbounded. Expresses "Unix seconds at ≤8, 1601-µs at ≥9" and "present only 132..144". |
| `epoch[].platform` | `any` \| `windows` \| `non_windows`. History ≤16 and Cookies ≤3 bump the version on *all* platforms but rewrite the data on only some. Without this axis the two rows are unrepresentable. |
| `epoch[].basis` | `verified` \| `inferred` \| `unresolved`. A row can carry a verified rule for one range and an unresolved one for another (Cookies ≤3 non-Windows). |
| `ambiguity` | **Requirement 3.** A first-class object, never a missing value. `state` ∈ `requires_os_input`, `version_field_untrusted`, `unresolved_source_deleted`, `not_examined`, each with `emit_when_unsupplied: unavailable`. This is the "ambiguous, requires OS input" state the brief demanded, and it maps onto CONTEXT.md's **Field State** `unavailable` — not `absent`. |
| `ambiguity.discriminators[]` | Magnitude / `downloads.full_path` syntax etc., each tagged `basis: inferred, emit_as: candidate`. A heuristic can produce a **Candidate**, never a **Finding**. |
| `sentinels[]` | **Requirement 4.** Per-column `{raw, means, emit_as, basis, source}`. `raw` is not always `0`: DIPS uses `SQL NULL`, `AutocompleteTable::GetEndTime()` uses `INT64_MAX`, `context_annotations.total_foreground_duration` uses `-1000000`, content-settings keys are **omitted entirely**, Shortcuts has *no* legitimate 0. `emit_as` is the Field State to emit — usually `absent`, sometimes `unavailable` (a 0 that means corruption). |
| `synthetic[]` | **Requirement 5.** `{applies_when.version_range, written_by, actually_records, not_evidence_of, evidences, detection, source}`. A synthetic value decodes *correctly* and is still false as evidence — the field names force the distinction between what the column is called and what the value records. |
| `provenance[]` | **Requirement 7.** Per row, list of `{ref, path, lines, claim}`. `ref` keys into `meta.source_refs` (`cb211f6` / `ba3c200` / `tag_120`) so every row carries its own SHA. A row is re-verifiable in isolation. |
| `claim_state` | Row-level `verified` \| `inferred` \| `unresolved`. Distinguishes what #143 read from what it reasoned. |
| `verified_absent` + `kind: no_timestamp_columns` | **Requirement 8.** `verified_absent: true` + `emit_as: absent` = "we read the whole CREATE TABLE, there is nothing". `claim_state: unresolved` + `ambiguity.state: not_examined` + `emit_as: unavailable` = "we did not look". Exactly the Field State `absent`/`unavailable` split from CONTEXT.md. |
| `column_presence` | `{present_from, present_to, added_by, dropped_at}` — column existence is version-scoped independently of epoch (`date_synced` v6..v30; `use_date2/3` v132..v144). |
| `table_generation_dispatch` | For columns that migrate *table*, not epoch: `autofill_profiles → contact_info/local_addresses → addresses`; `ibans → local_ibans`; `autofill_ai_entities → *_metadata`. Includes the v113 trap where both tables exist and one is empty. |
| `artifacts{}` | Version-field character per artifact, incl. `version_useful: false` (Bookmarks frozen at 1) and `version_field_trustworthy: false` (Login Data `FixVersionIfNeeded`). |
| `destructive_on_open[]` | 11 entries. Every one fires on first open by a modern Chrome — the machine-readable form of the #121 read-only **Working Copy** argument. |
| `registers{}` | Derived indexes (name collisions, defeated magnitude fallback, requires-OS set, synthetic set, JSON-shape rule, Declared Timezone leaks) so a consumer can load one register without walking 99 rows. Redundant with the rows **by design**. |

Terms used as CONTEXT.md defines them: **Epoch Family** (`epoch[].family`), **Field State**
(`emit_as`, `field_state_mapping`), **Provenance** (`provenance[]`), **Candidate** (`emit_as: candidate`
on every heuristic), **Declared Timezone** (`declared_timezone_interaction`, `registers.declared_timezone_leaks`),
**Working Copy** (`destructive_on_open`).

---

## 2. Row count and coverage

**99 rows.**

| Breakdown | Count |
|---|---|
| `kind: timestamp` | 71 |
| `kind: no_timestamp_columns` (verified negatives) | 16 |
| `kind: duration` | 8 |
| `kind: not_a_timestamp` | 4 |
| `claim_state: verified` | 90 |
| `claim_state: unresolved` | 8 |
| `claim_state: inferred` | 1 |
| rows carrying ≥1 sentinel | 39 |
| rows carrying a synthetic entry | 6 |
| rows in the `requires_os_input` state | 6 |

Epoch-family rule instances: `win1601_us` 53 · `unix_s` 17 · `unresolved` 10 · `unix_us` 3 ·
`win1601_ms` 1 · `win1601_s` 1 · `json_double_win1601_us` 1. All five families from §1 of the
matrix appear, plus the JSON-double outlier.

### Coverage vs the matrix

| Artifact | Rows | Coverage |
|---|---|---|
| History | 15 | **complete** — every column in matrix §3 incl. all negatives |
| Web Data | 25 | **partial** — see below |
| Login Data | 10 | **complete** for matrix §4 (`date_synced` transcribed as unresolved) |
| Trust Tokens | 5 | complete |
| Preferences | 5 | **partial by construction** — pref set is open-ended |
| Cookies | 4 | complete (4 columns, all 4 boundaries) |
| Local State | 4 | **partial by construction** |
| Site Characteristics | 4 | complete |
| Bookmarks / DIPS / Favicons / Media History / Reporting+NEL / Sessions | 3 each | complete |
| Secure Preferences | 2 | partial by construction |
| Network Action Predictor | 2 | complete (1 verified negative + 1 not-examined) |
| Top Sites | 2 | complete (1 verified negative + 1 unresolved legacy) |
| Affiliation DB / Shortcuts | 1 each | complete |
| Extension State | 1 | complete-as-negative (no Chrome-authored schema) |

**Complete** (every timestamp column, negative and sentinel the matrix names is transcribed):
History, Top Sites, Favicons, Shortcuts, Network Action Predictor, Login Data, Cookies, DIPS,
Bookmarks, Media History, Site Characteristics, Reporting and NEL, Trust Tokens, Affiliation
Database, Sessions.

**Partial, and the YAML says so in-band:**

| Artifact | Gap | How it is represented |
|---|---|---|
| Web Data | `plus_addresses`, `web_app_manifest_section`, `web_payments` registered but never fetched | one row, `ambiguity.state: not_examined`, `emit_as: unavailable` |
| Web Data | `masked_bank_accounts_metadata.use_date` — column declared, **no write site found** | `claim_state: unresolved`, explicit `DO NOT assume it matches server_card_metadata` |
| Web Data | `addresses.use_date2/use_date3` (v132..144) — no surviving write site | `unresolved_source_deleted` + `prediction_not_a_claim` |
| Web Data | `keywords` pre-v77 encoding | `unresolved_source_deleted`, bounded by the v82 raze floor |
| Preferences / Local State / Secure Preferences | the pref set has **no registry and no schema**; exhaustive coverage is not achievable | `registers.json_shape_is_not_epoch` carries the *mechanism* (which is exhaustive); the 11 rows are the forensically load-bearing keys only |
| Sessions | session-command payloads (`SessionTab::last_active_time`) — fetched, never analysed | own row, `not_examined` |
| Login Data / Web Data | timestamps *inside* sync protos | `nested_payload.epoch_of_nested_times: unresolved` with the "sync protos are commonly Unix **ms**" trap flagged |
| Cookies | pre-v4 non-Windows encoding | **double**-unresolved: `requires_os_input` *and* `unresolved_source_deleted` |

Every unresolved row carries `verification_queue:` pointing at the matrix §10 / part-N item that
closes it. Nothing is silently omitted.

---

## 3. #145: data or code?

### The honest argument for **data**

1. **The shape is tabular and the volume is not small.** 99 rows, 71 with epoch rules, 39 with
   sentinels. As code this is a 2000-line `if`-ladder or a hand-written map that a reviewer cannot
   diff meaningfully. As YAML it diffs one row at a time.
2. **Provenance is per row, and provenance is the product.** ForensiX's claim to be evidential
   rests on being able to answer *"how do you know?"* for one column. A row that carries its own
   `{ref, path, lines, claim}` answers it; a `switch` statement does not, and comments rot faster
   than data because nothing validates them.
3. **The states are the hard part, not the arithmetic.** The decoding is five multiplications. The
   difficulty is `absent` vs `unavailable`, requires-OS, synthetic, sentinel, verified-negative.
   Those are *declarations about the world*, and declarations belong in data where they can be
   enumerated, counted, and asserted over. The structural validator above (unique ids, controlled
   vocabularies, provenance non-empty, timestamp ⇒ epoch-or-ambiguity) is 30 lines and catches
   whole classes of mistake that a code table cannot express, let alone check.
4. **The consumers are plural.** A resolver, a report renderer, an "unresolved items" audit, and a
   test-fixture generator all want the same table sliced differently. `registers` already
   demonstrates three of those slices.
5. **Coverage becomes measurable.** "16 verified negatives, 8 unresolved, 6 requires-OS" is a
   number you can put in a release note and regress on. In code it is an opinion.

### The honest argument for **code** (and where it wins)

- **Resolution logic is not tabular.** `FixVersionIfNeeded`'s column-sniffing ladder, the magnitude
  fallback, and the v113 "both tables exist, one is empty" dispatch are *procedures*. The YAML
  states them in `required_procedure` / `discriminators` / `table_generation_dispatch` as prose a
  human must implement. **That prose is a spec, not an executable.** If it drifts from the code
  that implements it, the data is worse than useless — it is a second, authoritative-looking,
  wrong answer.
- **A schema this expressive is a small language.** `epoch[]` with version×platform predicates,
  `covers_also`, `covers_also_rows`, `table_generation_dispatch`, `same_as` — a consumer has to
  implement all of it correctly before it decodes a single timestamp. Some of that complexity is
  the domain's; some is mine.
- **Nothing enforces the vocabulary at rest.** Today the guarantee is a validator I ran once.

**Recommendation:** data for the *facts* (family, version range, platform, sentinel, synthetic,
negative, provenance); code for the *resolver* (sniff ladder, magnitude fallback, dispatch), with
the code loading this table rather than restating it. The line falls exactly where #143 §11 put
it: the stored quintuple — raw value, epoch family, UTC instant, resolution provenance, synthetic
flag — is data; *which rule fired* is code.

### The maintenance problem — and it is not solved

This table describes a **moving target**. Every row is pinned to `cb211f6` / `ba3c200`, both of
which were already one autoroll apart when #143 read them and are stale now. Concretely:

| Rot mode | Already observed in #143 |
|---|---|
| Path rot | `login_database.cc` moved under `password_store/`; `thumbnail_database.cc` → `favicon_database.cc`; `address_table.cc` → `address_autofill_table.cc`; `plus_address_table.cc` 404 |
| Line rot | every `lines:` field is a bare line number against a specific SHA |
| Artifact death | Media History removed between M120 and M121 — a whole artifact became a fossil |
| Constant drift | Web Data `kCurrentVersionNumber` moved 104 → 153 across the milestones sampled |
| Column churn | `use_date2/3` added at 132 and dropped at 145 — a column can appear and vanish inside 13 versions |

**What I could not resolve: there is no mechanical re-verification path.** The obvious one —
`gitiles +log` / `+blame` to ask "has this line moved?" — returns **HTTP 401 unauthenticated**, as
#143 documents in all four parts. So today re-verification means a human re-running the same
manual bisection. Options, none of them implemented and all of them stated here as proposals, not
findings:

1. **Anchor on text, not line numbers.** Store a short verbatim excerpt per row (`BindTime(2, metadata.use_date)`)
   and re-locate it by search at a new ref. Survives line drift; fails on refactor.
2. **Anchor on symbols.** Migration function names (`MigrateToVersion134UnifyLocalAndAccountAddressStorage`)
   are the stable searchable handles #143 already identified for Gerrit. Version *constants*
   (`kCurrentVersionNumber`) are similarly stable and cheap to re-read.
3. **A per-milestone drift check.** For each artifact re-read only the version constant at the new
   milestone branch point; if it moved, flag every row for that artifact as `stale` rather than
   silently trusting it. Cheap: one fetch per artifact per milestone.
4. **Make staleness a first-class state.** The schema currently has no `verified_at_milestone` /
   `stale_since` field. It should. A row whose artifact's `kCurrentVersionNumber` has moved past
   its highest known `version_range.max` is *unverified for the new range* and should degrade to
   Field State `unavailable`, not keep asserting.
5. **Fixture regression.** Cheapest real check: committed fixtures at known versions with expected
   decoded instants. Catches a wrong family immediately, catches nothing about a *new* column.

Until one of (1)–(4) exists, the honest posture is: **this table is a dated snapshot, and its date
is the two SHAs in `meta.source_refs`.** That is exactly why every row carries its own ref — so a
future run can re-verify a row without re-verifying the file, and so a partially-refreshed table is
still coherent.

---

## 4. Verified vs inferred, for this pass

- **VERIFIED (transcription fidelity):** every `provenance` entry, epoch family, version boundary,
  sentinel, synthetic entry and negative claim in the YAML appears in the #143 matrix or its four
  evidence files. I re-read all five documents in full.
- **INFERRED (mine, and only structural):** the schema shape; the `field_state_mapping` onto
  CONTEXT.md; grouping the six DIPS `bounces` columns and the three Media History
  `last_updated_time_s` columns under `covers_also` rather than one row each; the `registers`
  block, which is derived from the rows and adds no facts.
- **NOT DONE:** no Chromium source was fetched; no line number was checked; no version pin was
  re-derived. Where #143 said "unresolved", so does the YAML.
