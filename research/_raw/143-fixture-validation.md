# Fixture validation of the #143 epoch/version matrix — Chrome 151 macOS

**Lane C — adversarial reality check on `research/143-timestamp-epoch-version-matrix.md`.**

Fixture (the Source under test): `research/artifacts/117-chrome151-macos/` —
`schemas.sql` (750 lines, 50 SQLite Sources across 2 profiles + browser-level),
`db_index.json`, `layout.txt` (267), `inventory.csv` (1205), `local_state.redacted.json` (487).
Chrome 151.0.7922.71, macOS. Capture instant ≈ **2026-08-02 21:30 UTC**
(`local_state.redacted.json` `user_experience_metrics.stability.browser_last_live_timestamp` =
`13430179951226743` → 2026-08-02 21:32:31 UTC; `inventory.csv` mtimes ≈ 1785706282).

Everything below marked **V** was read directly out of the fixture. Everything marked **I** is
inference from fixture shape (magnitude / type) without a source read. Nothing here re-reads
Chromium source; where the fixture cannot settle a claim it is marked **NOT TESTABLE**.

---

## 0. Verdict

**The matrix's *epoch* claims are not contradicted anywhere the fixture can reach. Its
*coverage* claims are contradicted repeatedly, and two explicit claims are falsified.**

| | count |
|---|---|
| Matrix claims CONFIRMED against the fixture | 9 version constants + 49 column-presence claims + 10 negatives |
| Matrix claims **CONTRADICTED** | **2** |
| Matrix claims NOT TESTABLE from this fixture | 9 |
| **Timestamp-bearing columns/keys present in the fixture and ABSENT from the matrix** | **7 + 18 + ~20** (§3) |

The two contradictions:

1. **§1 / §7.2 "the one double-typed timestamp" (Site Engagement) is FALSE.**
   `Local State` contains **five** JSON-double timestamps that the matrix never mentions —
   `profile.info_cache.<Profile>.active_time` (Unix **seconds** as a float, two occurrences) and
   `network_time.network_time_mapping.{local,network,ticks}` (Unix **milliseconds** as floats, plus
   one monotonic tick counter). §1's "Plus one JSON-double outlier" and §7.2's "the one
   double-typed timestamp" must both be retracted.

2. **§1's "five epoch families" is incomplete — the fixture exhibits a sixth and a seventh.**
   `Local State` → `updateclientdata.apps.*.installdate` / `.dlrc` / `.dla` = `7153` (bare JSON
   integer). This is the Omaha/`update_client` **days-since-2007-01-01** epoch: 2007-01-01 + 7153 d
   = **2026-08-02**, exactly the capture date. And `network_time_mapping.local/.network` are
   **Unix-milliseconds-as-double**. Neither family appears in the matrix's table of five.

The Web Data 152-vs-153 gap is confirmed as the expected stable-vs-`main` skew and is **not** an
error (§1.1 below). No other off-by-N was found.

---

## 1. Check 1 — version cross-check (`-- meta:` lines vs the matrix)

Fixture carries 50 `-- meta:` lines; both profiles (`Default`, `Profile 1`) are schema-identical
(verified by programmatic diff of every `CREATE` statement — the only delta is that `Profile 1`
lacks the two empty `SharedStorage` files).

| Artifact | Fixture `version`/`last_compatible` | Matrix constant | Verdict |
|---|---|---|---|
| `History` | **70 / 16** (`schemas.sql:459`) | current 70, compatible 16, minimal 15 (matrix §3) | **CONFIRMED** (V) |
| `Login Data` | **43 / 40** (`:499`) | current 43, compatible 40 (§4) | **CONFIRMED** (V) |
| `Login Data For Account` | **43 / 40** (`:517`) | matrix names only `Login Data` | CONFIRMED + **coverage gap** (§5.1) |
| `Cookies` | **24 / 24** (`:426`) | current 24, compatible 24 (§5) | **CONFIRMED** (V) |
| `DIPS` | **11 / 11** (`:435`) | "anything ≠ v11 razed" (§8.3) | **CONFIRMED** (V) |
| `Web Data` | **152 / 151** (`:598`) | current **153**, compatible **151** (§6) | **CONFIRMED, gap explained** (§1.1) |
| `Account Web Data` | **152 / 151** (`:372`) | matrix never names this Source | CONFIRMED + **coverage gap** (§5.1) |
| `Affiliation Database` | **7 / 1** (`:401`) | "stable across all 7 versions" (§7.2) | **CONFIRMED** (V) |
| `Reporting and NEL` | **2 / 2** (`:547`) | "v1→v2 destructive, renames `report_to`→`group_name`" (§7.2) | **CONFIRMED** — fixture has `group_name`, no `report_to` (`:549-551`) (V) |
| `Trust Tokens` | **2 / 2** (`:588`) | epoch only, no version claim | consistent, no claim to test |
| `Top Sites` | **5 / 5** (`:580`) | no version claim | no claim |
| `Favicons` | **9 / 9** (`:445`) | no version claim | no claim |
| `Shortcuts` | **2 / 1** (`:572`) | no version claim | no claim |
| `Network Action Predictor` | **`{}` — NO `meta` TABLE AT ALL** (`:535`) | §2.4 lists the unversioned artifacts; NAP is **not** on that list | **coverage gap** (§5.4) |
| `heavy_ad_intervention_opt_out.db` | **`{}` — no `meta` table** (`:658`) | not mentioned | coverage gap |
| `segmentation_platform/ukm_db` | **`{}` — no `meta` table** (`:738`) | not mentioned | coverage gap |
| `first_party_sets.db` | 5 / 5 (`:4`) | not mentioned | coverage gap |
| `WebStorage/QuotaManager` | 11 / 11 (`:666`) | not mentioned | coverage gap |
| `Shared Dictionary/db` | 4 / 4 (`:708`, `:723`) | not mentioned | coverage gap |
| `BrowsingTopicsSiteData` | 1 / 1 (`:416`) | not mentioned | coverage gap |
| `declarative_performance_observer.db` | 1 / 1 (`:647`) | not mentioned | coverage gap |
| `ServerCertificate` | 1 / 1 (`:557`) | not mentioned | coverage gap (no timestamps) |

### 1.1 The Web Data 152-vs-153 gap — confirmed benign

Matrix read `kCurrentVersionNumber` = 153 at `main` (`ba3c200`); fixture is stable M151 at 152.
The gap is real and expected. **Cross-check that it is only a version-number skew and not a schema
skew:** the matrix's v153 table inventory is reproduced *exactly* by the v152 fixture —
`addresses` present, `use_date2`/`use_date3` absent (dropped at v145), `contact_info` /
`local_addresses` / `autofill_profiles` absent, `autofill_ai_entities_metadata` present with both
`use_date` and `date_modified`. So **v152 and v153 are timestamp-schema-identical** and every
epoch claim the matrix makes "@ version 153" applies verbatim to this fixture. **CONFIRMED (V).**

No other off-by-N exists in the fixture. All other version constants match exactly.

---

## 2. Check 2 — column presence for every column the matrix claims

### 2.1 History (v70) — 13/13 CONFIRMED

| Matrix claim | Fixture evidence | Verdict |
|---|---|---|
| `urls.last_visit_time` | `schemas.sql:477` `last_visit_time INTEGER NOT NULL` | CONFIRMED (V) |
| `visits.visit_time` | `:480` `visit_time INTEGER NOT NULL` | CONFIRMED (V) |
| `segment_usage.time_slot` | `:474` `time_slot INTEGER NOT NULL` | CONFIRMED (V) |
| `visits.visit_duration` is a duration, not a timestamp | `:480` `visit_duration INTEGER DEFAULT 0 NOT NULL` — name and default consistent | CONFIRMED (V, name-level) |
| `downloads.start_time` / `.end_time` / `.last_access_time` | `:468` all three present, all `INTEGER NOT NULL` | CONFIRMED (V) |
| `downloads.last_modified` is an **HTTP header STRING** | `:468` `last_modified VARCHAR NOT NULL` — **declared VARCHAR, not INTEGER** | **CONFIRMED, strongly** (V) |
| `downloads_url_chains` exists ⇒ version ≥ 24, no timestamp | `:470` `(id, chain_index, url)` | CONFIRMED (V) |
| `keyword_search_terms` has NO timestamp | `:472` `(keyword_id, url_id, term, normalized_term)` — 4 cols, none temporal | **CONFIRMED** (V) — see §4 |
| `visit_source` has NO timestamp | `:478` `(id, source)` | CONFIRMED (V) |
| `content_annotations` no timestamp | `:466` — 14 cols, none temporal | CONFIRMED (V) |
| `context_annotations` no timestamp | `:467` — `duration_since_last_visit`, `total_foreground_duration` are **durations** | CONFIRMED (V) with caveat below |
| `clusters` / `clusters_and_visits` / `cluster_keywords` no timestamp | `:462`, `:464-465` | CONFIRMED (V) |
| `Favicons.favicon_bitmaps.last_updated` / `.last_requested` | `:448` both present, `INTEGER DEFAULT 0` — the `DEFAULT 0` sentinel the matrix names is visible in the DDL | **CONFIRMED** (V) |
| `Shortcuts.omni_box_shortcuts.last_access_time` **INTEGER not string** | `:576` `last_access_time INTEGER` | **CONFIRMED** (V) |

Two refinements the fixture forces (both V):

- **`context_annotations`.** `duration_since_last_visit` and `total_foreground_duration` (`:467`)
  are durations, so the matrix's flat "no timestamps" is literally true — but
  `visits.visit_time − duration_since_last_visit` yields a *derived* instant. Reword to "no stored
  timestamp; two durations from which instants are derivable", not a bare negative.
- **`History.visited_links` (`:479`) is absent from the matrix entirely.** Fixture shows
  `(id, link_url_id, top_level_url, frame_url, visit_count)` — **no timestamp column**.
  `_raw/143-part-1-history.md:909` (VQ-11) and `_raw/143-leads-unverified.md:135` both left this
  open as "may have no timestamp at all". **The fixture closes it: it has none.**

### 2.2 Login Data (v43) — 8/8 CONFIRMED, incl. one absence

| Matrix claim | Fixture evidence (`schemas.sql:503` `logins`, `:502` `insecure_credentials`, `:505` `password_notes`) | Verdict |
|---|---|---|
| `date_created` present | present | CONFIRMED (V) |
| `date_synced` **dropped at v31** ⇒ must be ABSENT at v43 | **absent** — grep of `logins` DDL finds no `date_synced` | **CONFIRMED (a verified negative)** (V) |
| `date_last_used` (v25, `DEFAULT 0`) | `date_last_used INTEGER NOT NULL DEFAULT 0` | CONFIRMED incl. default (V) |
| `date_password_modified` (v30, `DEFAULT 0`) | `date_password_modified INTEGER NOT NULL DEFAULT 0` | CONFIRMED incl. default (V) |
| `date_received` (v37) | `date_received INTEGER` — **nullable, no default**, unlike its siblings | CONFIRMED + refinement (V) |
| `date_last_filled` (v42, `DEFAULT 0`) | `date_last_filled INTEGER NOT NULL DEFAULT 0` | CONFIRMED incl. default (V) |
| `password_notes.date_created` (table v33) | `:505` present | CONFIRMED (V) |
| `insecure_credentials.create_time` (table v29) | `:502` `create_time INTEGER NOT NULL` | CONFIRMED (V) |

Column-order note (V): `date_last_filled` sits before `actor_login_approved`, i.e. the fixture's
`logins` has **one column appended after v42's** — `actor_login_approved INTEGER NOT NULL DEFAULT 0`,
non-temporal. Consistent with v43 = the `actor_login_approved` bump. Matrix does not state what v43
added; the fixture supplies it.

### 2.3 Cookies (v24) — 4/4 CONFIRMED

`schemas.sql:429` (Default) / `:76` (Profile 1): `creation_utc`, `expires_utc`, `last_access_utc`, `last_update_utc` — all four
present, all `INTEGER NOT NULL`, plus `has_expires INTEGER NOT NULL`, the companion the matrix uses
to mechanically confirm the `expires_utc = 0` session sentinel. **CONFIRMED (V).**

### 2.4 Web Data (v152) — 19/19 matrix-named columns CONFIRMED

All at `schemas.sql:601-643` (Default profile `Web Data`).

| Family (matrix §2.3) | Columns claimed | Fixture |
|---|---|---|
| Unix seconds | `autofill.date_created`, `autofill.date_last_used`, `addresses.use_date`, `addresses.date_modified`, `credit_cards.use_date`, `credit_cards.date_modified`, `local_ibans.use_date`, `local_stored_cvc.last_updated_timestamp`, `server_stored_cvc.last_updated_timestamp`, `autofill_ai_entities_metadata.date_modified` | **all 10 present** (V) |
| 1601-µs | `keywords.date_created`, `keywords.last_modified`, `keywords.last_visited`, `server_card_metadata.use_date`, `masked_ibans_metadata.use_date`, `masked_credit_card_benefits.start_time`, `.end_time`, `valuables_metadata.use_date`, `autofill_ai_entities_metadata.use_date` | **all 9 present** (V) |
| 1601-ms | `offer_data.expiry` | present, declared `UNSIGNED LONG` (`:624`) (V) |

The matrix's headline claim that `autofill_ai_entities_metadata` holds **two epoch families in
adjacent columns of the same row** is structurally confirmed:
`:606 autofill_ai_entities_metadata (entity_guid TEXT …, use_count INTEGER DEFAULT 0, use_date INTEGER DEFAULT 0, date_modified INTEGER NOT NULL)`
— `use_date` and `date_modified` are literally adjacent. **CONFIRMED (V).**

`masked_bank_accounts_metadata.use_date` (matrix §10, UNRESOLVED write site) is present (`:618`).
Fixture cannot resolve its epoch (0 rows). **NOT TESTABLE.**

### 2.5 DIPS (v11)

`:438` `bounces(site, first_user_activation_time, last_user_activation_time, first_bounce_time,
last_bounce_time, first_web_authn_assertion_time, last_web_authn_assertion_time)` — all six are
**nullable `INTEGER` with no `DEFAULT 0`**, exactly as §8.1's "DIPS uses SQL NULL, not 0" predicts.
**CONFIRMED (V)** — this is the one sentinel claim the DDL alone can corroborate.

---

## 3. **CHECK 3 — COLUMNS AND KEYS THE MATRIX MISSED** (the highest-value section)

Method (V): programmatic scan of every `CREATE TABLE` in `schemas.sql` for columns matching
`*_time|*_date|date_*|*_utc|*_at|expir*|last_*|*timestamp*|*created*|*modified*|*accessed*|*used*`,
then set-differenced against every column name appearing anywhere in
`research/143-timestamp-epoch-version-matrix.md` and `research/_raw/143-part-{1,2,3,4}-*.md`.

### 3.1 Missed inside artifacts the matrix DOES cover — the worst class

| Source | Table.column | Type | In matrix? | In part-N evidence? | Note |
|---|---|---|---|---|---|
| **`Login Data`** | **`stats.update_time`** | `INTEGER NOT NULL` (`:507`, and `:525` in `Login Data For Account`) | **NO** | yes — `_raw/143-part-2-credentials.md:193` resolves it to **1601-µs** via `statistics_table.cc:94 BindTime` | **The evidence file settled it and the deliverable dropped it.** A real password-manager interaction time, per (origin, username). Must be added to §4. |
| **`DIPS`** | **`popups.last_popup_time`** | `INTEGER` (`:441`) | **NO** | yes — `_raw/143-part-2-credentials.md:566,577` → **1601-µs**, `:415 BindTime` | Same failure mode: resolved in evidence, lost in the deliverable. |
| **`Web Data`** | **`secure_payment_confirmation_instrument.date_created`** | `INTEGER NOT NULL DEFAULT 0` (`:634`) | **NO** | **NO** | **A THIRD `date_created` in Web Data.** The matrix's "two `date_created`, 369 years apart" narrative (§6.4) is now a three-way collision and the third member's epoch is **unresolved**. |
| **`Web Data`** | **`secure_payment_confirmation_browser_bound_key.last_used`** | **`TIMESTAMP`** (`:633`) | **NO** | **NO** | **The only column in the entire fixture declared `TIMESTAMP`.** SQLite has no TIMESTAMP type — it type-affinity-resolves to NUMERIC. A tool that trusts declared types will treat this differently from every other timestamp column. Epoch unresolved. |
| **`Web Data`** | **`payment_method_manifest.expire_date`** | `INTEGER NOT NULL DEFAULT 0` (`:628`) | **NO** | **NO** | Web Payments manifest cache expiry. |
| **`Web Data`** | **`web_app_manifest_section.expire_date`** | `INTEGER NOT NULL DEFAULT 0` (`:641`) | **NO** | flagged **UNRESOLVED/not fetched** at `_raw/143-part-3-webdata.md:548,731` | Honestly quarantined in evidence, but silently absent from the deliverable. |
| **`History`** | **`meta.early_expiration_threshold`** = `13422663071195218` (Default), `13422663094942376` (Profile 1) | meta-table string | **NO** | **NO** | **A 1601-µs timestamp stored *inside the `meta` table itself* (I: 17 digits, decodes to 2026-05-07 21:31 UTC ≈ 87 days before capture).** Per-profile, differing between the two profiles. The matrix treats `meta` purely as a version carrier; here it is also a Field State. |

`stats.update_time`, `popups.last_popup_time` and `web_app_manifest_section.expire_date` are
**regressions between the evidence files and the deliverable**, not research failures — the cheapest
possible fix.

### 3.2 Missed artifacts entirely — 18 further timestamp columns

Every one of these is a real SQLite Source in a Chrome 151 profile that the matrix's §7.2 inventory
does not list.

| Source | Timestamp columns | line |
|---|---|---|
| `BrowsingTopicsSiteData` (v1) | `browsing_topics_api_usages.last_usage_time` (indexed) | `:420` |
| `WebStorage/QuotaManager` (v11) | `buckets.last_accessed`, `buckets.last_modified`, `buckets.expiration` — all three separately indexed | `:669` |
| `Shared Dictionary/db` (v4) × 2 (profile + per-extension) | `dictionaries.last_fetch_time`, `.res_time`, `.exp_time`, `.last_used_time` | `:711`, `:726` |
| `declarative_performance_observer.db` (v1) × 2 | `declarative_performance_observer_reports.created_at` | `:651`, `:701` |
| `heavy_ad_intervention_opt_out.db` (unversioned) | `previews_v1.time` — and it is **part of the PRIMARY KEY** (`time DESC`) | `:662` |
| `segmentation_platform/ukm_db` (unversioned, **browser-level, not per-profile**) | `metrics.event_timestamp`, `uma_metrics.event_timestamp`, `urls.last_timestamp` — all indexed | `:741-743` |
| `Affiliation Database` | `eq_classes.last_update_time` — matrix asserts the *artifact* is 1601-µs but never names the column | `:406` |
| `Reporting and NEL` | `nel_policies.expires_us_since_epoch`, `.last_access_us_since_epoch`, `reporting_endpoint_groups.expires_us_since_epoch`, `.last_access_us_since_epoch` — matrix asserts "1601-µs" for the artifact but names no column | `:551-552` |

`nel_policies` is a nice self-documenting case: the column names literally say `us_since_epoch`,
consistent with the matrix's 1601-µs claim (I — names only, no rows to magnitude-test).

### 3.3 Missed in `Local State` — 8 keys, 2 new epoch families, 1 silent-failure hazard

All from `local_state.redacted.json`. **V** = value read from fixture; decodes marked **I**.

| Key | Value in fixture | Shape | In matrix? |
|---|---|---|---|
| `profile.info_cache.Default.active_time` | `1785706211.446599` | **JSON double**, Unix **seconds** with sub-second part (I: → 2026-08-02 21:30:11 UTC) | **NO — and it falsifies §7.2** |
| `profile.info_cache.Profile 1.active_time` | `1785706234.972354` | same | **NO** |
| `network_time.network_time_mapping.local` | `1785706211870.196` | **JSON double**, Unix **milliseconds** (I: → 2026-08-02 21:30:11.870 UTC) | **NO — a SIXTH epoch family** |
| `network_time.network_time_mapping.network` | `1785706212000.0` | same | **NO** |
| **`network_time.network_time_mapping.ticks`** | `2059318713987.0` | **`base::TimeTicks` — MONOTONIC SINCE BOOT, NOT A WALL CLOCK** | **NO — see hazard below** |
| `network_time.network_time_mapping.uncertainty` | `1503560.0` | a **duration** in µs, not an instant | **NO** |
| `updateclientdata.apps.*.installdate` / `.dlrc` / `.dla` | `7153` (bare **int**, ~28 occurrences) | **Omaha days-since-2007-01-01** (I: 2007-01-01 + 7153 d = **2026-08-02**, = capture date, so the derivation is self-verifying) | **NO — a SEVENTH epoch family** |
| `user_experience_metrics.stability.browser_last_live_timestamp` | `"13430179951226743"` | 1601-µs string (I: 2026-08-02 21:32:31) | **NO** |
| `variations_seed_date` | `"13430179812000000"` | 1601-µs string | named at `_raw/143-part-4:395`, **absent from the deliverable** |
| `variations_last_fetch_time` | `"13430179813640414"` | 1601-µs string | same |
| `breadcrumbs.enabled_time`, `management.platform.last_log_time`, `policy.last_statistics_update`, `signin.active_accounts_last_emitted`, `tab_stats.last_daily_sample`, `performance_intervention.last_daily_sample`, `enterprise_reporting.saas_usage.last_trigger_time`, `optimization_guide.predictionmodelfetcher.last_fetch_attempt`/`.last_fetch_success` | all 17-digit quoted decimal strings | 1601-µs strings (I) | **NO — 9 further keys** |

> **HAZARD, matrix-grade, currently unrecorded.**
> `network_time.network_time_mapping.ticks = 2059318713987.0` is a **`base::TimeTicks`** value —
> microseconds since an arbitrary boot-relative origin. It sits in the same JSON object as two real
> Unix-ms wall-clock doubles, and it is **13 digits, the same digit count as Unix ms**. Decoded as
> Unix ms it yields a fully plausible **2035-04-04**; the true meaning is ~23.8 days of host uptime.
> This is the **same failure class as `offer_data.expiry`** (§6.3) — magnitude does not
> disambiguate, and the wrong answer is plausible rather than absurd. It is arguably worse:
> `offer_data.expiry` is at least an instant, `ticks` is not an instant at all.
> **The matrix's magnitude fallback is defeated a second time, in a second artifact.**

### 3.4 Confirming counterexamples for the "shape tells you nothing" thesis (§7.1)

The fixture supplies three independent, *empirical* counterexamples that the matrix argues for only
from source. All are **V**:

| Key/column | Value | Why it's a trap |
|---|---|---|
| `session_id_generator_last_value` | `"2056925251"` | A **10-digit quoted decimal string** in `Local State` that is **not a timestamp**. Decoded as Unix seconds → **2035-03-08**. Identical shape to `uninstall_metrics.installation_date2`. |
| `first_party_sets.db` `browser_context_sites_to_clear.marked_at_run`, `browser_contexts_cleared.cleared_at_run` (`schemas.sql:8-9`) | INTEGER | Two `*_at` columns that are **run-sequence counters**, not times (cf. `meta.run_count: "1"` at `:4`). A `*_at` name heuristic mis-fires here. |
| `optimization_guide.on_device.last_version` = `"151.0.7922.71"`, `toast.non_milestone_update_toast_version` | strings | `last_*` keys that are **product version strings**. |

---

## 4. Check 4 — the three negative claims

| Negative claim | Fixture evidence | Verdict |
|---|---|---|
| **`Top Sites` has NO timestamp column** | `schemas.sql:584`: `top_sites(url TEXT NOT NULL PRIMARY KEY, url_rank INTEGER NOT NULL, title TEXT NOT NULL)` — 3 columns, plus `meta`. Nothing else. | **CONFIRMED** (V) |
| **`Network Action Predictor` has NO timestamp at all** (§9 correction to #125) | `:538-543`, esp. `:540` `network_action_predictor(id, user_text, url, number_of_hits, number_of_misses)` — no temporal column. Also **no `meta` table** at all. | **CONFIRMED** (V), with the caveat below |
| **`keyword_search_terms` has NO timestamp** | `:472`: `(keyword_id, url_id, term, normalized_term)`; its three indexes reference only those columns. | **CONFIRMED** (V) |

**Caveat on Network Action Predictor (unrecorded in the matrix).** The file's other four tables —
`lcp_critical_path_predictor`, `lcp_critical_path_predictor_initiator_origin`,
`resource_prefetch_predictor_host_redirect`, `resource_prefetch_predictor_origin` (`:538-539`,
`:541`, `:543`) — are all `(key TEXT, proto BLOB)` and are **non-empty** in this fixture (`db_index.json`: host_redirect 2,
origin 2, metadata 1). The matrix's negative is sound **at the column level** but does not say so;
as written a reader may take it as "this artifact contains no time information", which the BLOBs
cannot rule out. **Recommend narrowing the wording to "no timestamp *column*; serialized proto
payloads not examined."** Same caveat applies to `Trust Tokens` and `resource_prefetch_predictor_*`.

---

## 5. Checks 5–7

### 5.1 Check 5 — address-table generations

| Matrix claim (§6.1) | Fixture (`Web Data`, v152) | Verdict |
|---|---|---|
| generation 3 `addresses` live from v134/M130 | `schemas.sql:602` `addresses (guid, use_count, use_date, date_modified, language_code, label, initial_creator_id, record_type)` — **present**, with the `record_type` disambiguator the evidence file predicts (`_raw/143-part-3-webdata.md:181`) | **CONFIRMED** (V) |
| `autofill_profiles` DROPped at v114 | grep of all 750 lines: **0 occurrences** | **CONFIRMED** (V) |
| `contact_info` renamed away at v134 | **0 occurrences** | **CONFIRMED** (V) |
| `local_addresses` merged+dropped at v134 | **0 occurrences** | **CONFIRMED** (V) |
| `use_date2` / `use_date3` DROPped at v145 | **0 occurrences** | **CONFIRMED** (V) |
| companion token table | `:601` `address_type_tokens` present (matching the v134 rename of `contact_info_type_tokens`); no timestamp column | **CONFIRMED** (V) |

The entire §6.1 generation ladder lands exactly on its predicted end state. This is the matrix's
strongest empirical vindication.

### 5.2 Check 6 — Media History removal

| Matrix claim (§7.2) | Fixture evidence | Verdict |
|---|---|---|
| `Media History` REMOVED between M120 and M121; must be absent in an M151 profile | case-insensitive grep for `media history` / `media_history` across `layout.txt`, `inventory.csv`, `db_index.json`, `schemas.sql`: **zero hits in all four files** | **CONFIRMED** (V) |

Corroborating (V): `WebStorage/QuotaManager` `meta` carries `"IsMediaLicenseDatabaseRemoved": "1"`
(`schemas.sql:666`) — an independent, in-artifact record that a media-related store was retired.
Different store (Media *License*, not Media History) so not direct proof, but it is the kind of
removal-flag the matrix could use as a positive detector rather than relying on file absence.
**Not the same claim — flagged, not asserted.**

### 5.3 Check 7 — `local_state.redacted.json` → `uninstall_metrics.installation_date2`

| Matrix claim (§7.1) | Fixture | Verdict |
|---|---|---|
| key exists in `Local State` | present | CONFIRMED (V) |
| **Unix seconds** | `1785706210` → 2026-08-02 21:30:10 UTC; a 1601-µs read gives 1601-01-01 00:29:45, absurd | **CONFIRMED** (V+I) |
| **quoted decimal string** | value is `"1785706210"` — JSON **string**, not number | **CONFIRMED** (V) |
| **10 digits** | `len("1785706210")` = **10** | **CONFIRMED** (V) |
| collides in shape with 1601-µs string prefs | `variations_seed_date` = `"13430179812000000"` (17 digits) sits in the same file — both quoted decimal strings | **CONFIRMED** (V) |
| "restorable from `client_info_backup`, dates the machine not the profile" | no backup channel in a macOS capture | **NOT TESTABLE** |

**Bonus: the fixture partially closes verification-queue item U2.**
§10 U2 says `stability.stats_buildtime`'s source comment "declines to name which epoch".
Fixture: `user_experience_metrics.stability.stats_buildtime` = `"1785272936"` — 10-digit quoted
decimal string decoding to **2026-07-28 21:08:56 UTC**, five days before capture and consistent
with an M151.0.7922 build date. **Unix seconds, empirically (I — magnitude, not source).** This
does not replace a source read but it eliminates 1601-anything and Unix-ms.

### 5.4 Additional confirmation — SNSS filename-suffix carrier

Matrix §7.2: "`Sessions`/`Tabs` (SNSS) — 1601-µs, present via **three distinct carriers, incl. the
filename suffix**." Fixture (`inventory.csv:402-403,931-932`), **V**:

```
Default/Sessions/Session_13430179813715425   → 2026-08-02 21:30:13.715 UTC
Default/Sessions/Tabs_13430179951236979      → 2026-08-02 21:32:31.236 UTC
Profile 1/Sessions/Session_13430179837430324 → 2026-08-02 21:30:37.430 UTC
```

17-digit 1601-µs suffixes, decoding to within seconds of the capture instant. **CONFIRMED (V+I).**
Note `Tabs_...951236979` is within 10 ms of `browser_last_live_timestamp` `...951226743` — two
independent carriers agreeing. This is the single cleanest cross-artifact corroboration available.

---

## 6. NOT TESTABLE from this fixture

| Matrix claim | Why the fixture cannot reach it |
|---|---|
| **All epoch assignments** (which family each column uses) | Every timestamp-bearing table in the fixture has **0 rows** except `keywords` (14), `top_sites` (1), `cookies` (7), `urls`/`visits` (6), `favicon_bitmaps` (6), `reporting_*` — and `schemas.sql` is a **DDL dump with no values**. The fixture validates *schema*, never *encoding*. **This is the single biggest limitation of this whole pass.** |
| §2.1 `FixVersionIfNeeded` column-sniffing | Fixture is v43, well past the repair range |
| §2.2 History v16→17 / Cookies v3→v4 platform migrations | Fixture is v70 / v24 |
| §3 downloads v23→24 boundary | `downloads` has 0 rows |
| §5 Cookies v19 +400d `expires_utc` cap | needs values |
| §6.3 `offer_data.expiry` being 1601-ms | `offer_data` has 0 rows |
| §7.2 `Bookmarks` (version frozen at 1, 1601-µs strings, checksum) | **`Bookmarks` file does not exist in this fixture** (0 hits in `layout.txt`/`inventory.csv`) — the profile never wrote a bookmark |
| §7.2 `Site Characteristics`, `Extension State`, `Preferences`, `Secure Preferences` | files present in `inventory.csv` but their contents are not in the capture |
| §8.2 synthetic-timestamp register | needs rows + migration history |
| `masked_bank_accounts_metadata.use_date` epoch (§10) | 0 rows |

---

## 7. Corrections the matrix needs — exact edits

**C-1 (CONTRADICTION). `research/143-timestamp-epoch-version-matrix.md:40`**

> `Plus one JSON-double outlier (Site Engagement, §7.2) which loses precision by design.`

replace with

> `Plus JSON-double outliers which lose precision by design: Preferences Site Engagement, Local
> State profile.info_cache.<Profile>.active_time (Unix seconds as a float) and Local State
> network_time.network_time_mapping.{local,network} (Unix milliseconds as a float). Verified in
> research/artifacts/117-chrome151-macos/local_state.redacted.json.`

**C-2 (CONTRADICTION). `:350`**

> `| `Preferences` Site Engagement | **JSON double** | the one double-typed timestamp; **precision loss CONFIRMED** |`

replace `the one double-typed timestamp` with
`one of several double-typed timestamps (see Local State active_time / network_time_mapping)`.

**C-3 (new epoch families). §1 table at `:32-38`** — add two rows:

> `| **Unix-ms double** | ms since 1970 as a JSON float | base::Time → double | Local State network_time.network_time_mapping.local |`
> `| **Omaha days** | days since 2007-01-01, bare JSON integer | update_client | Local State updateclientdata.apps.*.installdate = 7153 → 2026-08-02 |`

and change "There are five epoch families in Chrome profile artifacts, not two." to **seven**.

**C-4 (new hazard, magnitude-fallback defeater #2). §6.3 / §8.1** — add:

> `Local State network_time.network_time_mapping.ticks is a base::TimeTicks value (monotonic since
> boot), 13 digits, sitting beside two genuine Unix-ms doubles in the same object. Misread as
> Unix ms it yields 2035-04-04. Not an instant at all. Second independent defeater of the magnitude
> fallback, alongside offer_data.expiry.`

**C-5 (dropped from evidence). §4 Login Data table** — add
`| `stats.update_time` | 1601-µs | table created on demand, outside the logins ladder |`
(source already in `_raw/143-part-2-credentials.md:193`).

**C-6 (dropped from evidence). §3 / DIPS** — add `popups.last_popup_time` → 1601-µs
(`_raw/143-part-2-credentials.md:566,577`). The matrix currently names only `bounces.*_time`.

**C-7 (coverage). §6.4 Web Data** — add four unmentioned timestamp columns, all epoch-UNRESOLVED:
`secure_payment_confirmation_instrument.date_created`,
`secure_payment_confirmation_browser_bound_key.last_used` (declared `TIMESTAMP` — the only such
declaration in the corpus), `payment_method_manifest.expire_date`,
`web_app_manifest_section.expire_date`. Note that `date_created` in Web Data is now a **three-way**
name collision, not two-way.

**C-8 (coverage). §7.2** — add the eight unlisted SQLite Sources of §3.2 above.

**C-9 (coverage). §2.4** — the "no version field at all" list must add
`Network Action Predictor`, `heavy_ad_intervention_opt_out.db` and `segmentation_platform/ukm_db`,
all of which have **no `meta` table whatsoever** in this fixture.

**C-10 (precision). §3 / §9** — narrow the Network Action Predictor negative to
"no timestamp *column*; serialized proto BLOBs not examined" (the proto tables are non-empty here).

**C-11 (scope). §4 / §6** — the matrix names `Login Data` and `Web Data`; the fixture carries
`Login Data For Account` (43/40) and `Account Web Data` (152/151) as **separate Sources with
identical schemas**. Every Login Data / Web Data claim should be stated as applying to both.

**C-12 (new field). §3** — record `History` `meta.early_expiration_threshold` as a 1601-µs
timestamp **inside the meta table**, per-profile (`13422663071195218` vs `13422663094942376` in the
two profiles of this fixture).

**C-13 (partial close). §10 U2** — annotate `stats_buildtime` as "Unix seconds, empirically
(fixture 117: `1785272936` → 2026-07-28, 5 days before capture)". Still wants a source read.

---

## 8. Summary tally

| Category | Count |
|---|---|
| Version constants confirmed exactly | 9 |
| Columns confirmed present as claimed | 49 (History 12, Login Data 7, Cookies 4, DIPS 6, Web Data 19, Affiliation 1) |
| Negative claims confirmed (Top Sites, NAP, `keyword_search_terms`, `date_synced` absent, `autofill_profiles`/`contact_info`/`local_addresses`/`use_date2`/`use_date3` absent, Media History absent) | 10 |
| **Claims falsified** | **2** (C-1/C-2 "one double"; C-3 "five families") |
| **Timestamp columns/keys present but unmentioned** | **7** in artifacts the matrix covers + **18** in SQLite Sources it does not list + **~20** `Local State` keys (6 distinct shape classes). §3. |
| Claims not reachable from the fixture | 9 |

---

## 9. Method — reproducible commands

All run against `research/artifacts/117-chrome151-macos/`, read-only, no application code touched.

| Purpose | Command |
|---|---|
| version cross-check | `grep -n -- "-- meta:" schemas.sql` (50 hits) |
| artifact→file mapping | `grep -n "^-- " schemas.sql \| grep -v -- "-- meta:\|-- rows:"` |
| profile-diff (schemas identical) | python: parse every `CREATE`, key by path-after-profile, set-diff `Profile 1` vs `Default` → only delta is two empty `SharedStorage` files |
| timestamp-column scan (check 3) | python regex over every `CREATE TABLE` body for `_time\|_date\|date_\|_at\|_utc\|expir\|last_\|timestamp\|created\|modified\|accessed\|used` → 113 raw hits, deduped to the tables in §3 |
| matrix coverage set-diff | `grep -rn "<col>" research/143-timestamp-epoch-version-matrix.md research/_raw/143-part-{1,2,3,4}-*.md` per candidate column |
| negative claims | direct DDL read of `top_sites`, `network_action_predictor`, `keyword_search_terms` |
| address generations | `grep -in "autofill_profiles\|contact_info\|local_addresses\|use_date2\|use_date3" schemas.sql` → **0 hits** |
| Media History | `grep -in "media history\|media_history" layout.txt inventory.csv db_index.json schemas.sql` → **0 hits** |
| Local State key walk | python recursive walk of `local_state.redacted.json`, filter keys on `time\|date\|_at$\|stamp\|expir\|install\|creat\|last_\|updat` |
| epoch decodes | python `datetime`: Unix-s, Unix-ms, 1601-µs, Omaha days-since-2007-01-01 |

**Discipline note.** Every "CONFIRMED" above is a *schema-shape* confirmation. The fixture's
timestamp-bearing tables are almost all empty, so **no epoch assignment in the matrix was tested
against a real value by this pass.** Only `Local State` and the SNSS filename suffixes carried
decodable values, and those are the only rows where an epoch family was empirically checked.
