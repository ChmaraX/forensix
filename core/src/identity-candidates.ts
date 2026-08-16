import type {
  CandidateArtifactWrite,
  HistoryArtifactWrite,
  MetadataArtifactWrite,
  PersistedIdentityCandidate,
  WebDataArtifactWrite,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import {
  createCandidate,
  valueField,
  type Candidate,
  type CandidateCategory,
  type FieldState,
  type Finding,
  type SourceRowProvenance,
} from "./forensic-model.js";

export type { CandidateCategory };

/**
 * Identity and behavior Candidate generation.
 *
 * A Candidate is nominal, ranked, and carries a supporting count plus resolvable
 * row-level Provenance. A Candidate is never a Finding and never a factual
 * summary tile: names, countries, phone numbers, addresses, linked devices, and
 * habits only ever appear here, ranked and hedged, never asserted as fact.
 *
 * Every heuristic below consumes Findings that other parsers already wrote for
 * the same Analysis Run — Web Data autofill, Preferences/Local State metadata,
 * and History visits. This pass reads those Findings and emits Candidates; it
 * never mutates, hides, or re-scores any source row.
 *
 * Deterministic, documented behavior for the awkward cases:
 *
 *  - Ties: Candidates within one kind are ordered by supporting count
 *    descending, then by normalized value ascending (a total order). Ranks are
 *    dense integers 1..N in that order, so equal counts still get distinct,
 *    reproducible ranks.
 *  - No evidence: a heuristic that finds nothing emits no Candidate. When every
 *    heuristic is empty but at least one input was produced, the Candidate
 *    artifact is `complete` with zero rows (searched, nothing nominable).
 *  - Conflicting evidence: distinct values under one kind each become their own
 *    ranked Candidate. Conflicts are surfaced as a ranked list, never merged and
 *    never resolved into a single fact.
 *  - Unavailable inputs: an input that is `absent`/`unavailable` contributes no
 *    evidence and is named in the artifact `reason`. If no input was produced,
 *    the artifact is `unavailable` (an input failed) or `absent` (none present).
 */

export const CANDIDATE_ARTIFACT = "Candidates" as const;

/** The upper bound on ranked Candidates emitted per kind per Profile. */
const MAX_CANDIDATES_PER_KIND = 100;

/**
 * The upper bound on total Provenance rows (primary + supporting) per Candidate.
 * The `supportingCount` reports the full tally of supporting rows; when a group
 * has more rows than this bound, the carried Provenance is a bounded sample and
 * the count stays larger than the resolvable rows (never truncated to match).
 */
const MAX_PROVENANCE_ROWS = 200;

interface HeuristicDefinition {
  readonly kind: string;
  readonly category: CandidateCategory;
  /** Gather every piece of evidence this heuristic recognizes for a Profile. */
  readonly collect: (inputs: ProfileInputs) => Evidence[];
}

// Each heuristic owns its own collector, so the kind, category, and evidence
// rule live in one place. There is no separate kind-keyed matcher/field table
// to keep in sync.
const HEURISTICS: readonly HeuristicDefinition[] = [
  {
    kind: "identity_name",
    category: "identity",
    collect: (inputs) => [
      ...autofillEvidence(inputs, (fieldName) =>
        NAME_FIELD_PATTERN.test(fieldName),
      ),
      ...preferencesFieldEvidence(inputs, [
        "accountFullName",
        "accountGivenName",
      ]),
    ],
  },
  {
    kind: "identity_email",
    category: "identity",
    collect: (inputs) => [
      ...autofillEvidence(
        inputs,
        (fieldName, value) =>
          EMAIL_FIELD_PATTERN.test(fieldName) ||
          EMAIL_VALUE_PATTERN.test(value),
      ),
      ...preferencesFieldEvidence(inputs, ["accountEmail"]),
    ],
  },
  {
    kind: "identity_phone",
    category: "identity",
    collect: (inputs) =>
      autofillEvidence(inputs, (fieldName) =>
        PHONE_FIELD_PATTERN.test(fieldName),
      ),
  },
  {
    kind: "identity_postal_address",
    category: "identity",
    collect: (inputs) =>
      autofillEvidence(
        inputs,
        (fieldName) =>
          ADDRESS_FIELD_PATTERN.test(fieldName) &&
          !COUNTRY_FIELD_PATTERN.test(fieldName),
      ),
  },
  {
    kind: "identity_country",
    category: "identity",
    collect: (inputs) => [
      ...autofillEvidence(inputs, (fieldName) =>
        COUNTRY_FIELD_PATTERN.test(fieldName),
      ),
      ...localStateCountryEvidence(inputs),
    ],
  },
  {
    kind: "behavior_frequent_host",
    category: "behavior",
    collect: (inputs) => collectHostEvidence(inputs),
  },
  {
    kind: "behavior_search_query",
    category: "behavior",
    collect: (inputs) => collectSearchEvidence(inputs),
  },
];

interface Evidence {
  readonly key: string;
  readonly raw: string;
  readonly basis: string;
  readonly row: SourceRowProvenance;
}

interface ProfileInputs {
  readonly sourceId: string;
  readonly profile: string;
  readonly history: HistoryArtifactWrite | undefined;
  readonly webData: WebDataArtifactWrite | undefined;
  readonly preferences: MetadataArtifactWrite | undefined;
  readonly localState: MetadataArtifactWrite | undefined;
}

function fieldText(field: FieldState<unknown> | undefined): string {
  if (field === undefined || field.state !== "value") {
    return "";
  }
  return typeof field.value === "string" ? field.value : String(field.value);
}

function normalizeKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function rowKey(row: SourceRowProvenance): string {
  return `${row.sourceId}\u0000${String(row.manifestEntryOrdinal)}\u0000${row.database}\u0000${row.table}\u0000${row.rowId}`;
}

/**
 * A total, locale-independent order over strings so ranking never depends on
 * the host locale. It compares by UTF-16 code unit through the built-in
 * `<`/`>` operators; there is no prefix or length special-casing.
 */
function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

const NAME_FIELD_PATTERN =
  /(?:^|[^a-z])(name|fullname|full_name|firstname|first_name|fname|lastname|last_name|lname|given[-_]?name|family[-_]?name|cc[-_]?name)(?:$|[^a-z])/;
const EMAIL_FIELD_PATTERN = /(e[-_]?mail|email)/;
const PHONE_FIELD_PATTERN = /(phone|tel|mobile|cell)/;
const ADDRESS_FIELD_PATTERN =
  /(address|addr|street|city|town|state|province|zip|postal|postcode|post_code)/;
const COUNTRY_FIELD_PATTERN = /(country|nation)/;
const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AutofillMatcher = (fieldName: string, value: string) => boolean;

function autofillFindings(
  webData: WebDataArtifactWrite | undefined,
): readonly Finding[] {
  if (webData === undefined || webData.status !== "complete") {
    return [];
  }
  return webData.findings
    .map((persisted) => persisted.finding)
    .filter(
      (finding) =>
        finding.findingKind === "autofill_entry" &&
        finding.commitState === "committed",
    );
}

function autofillEvidence(
  inputs: ProfileInputs,
  matcher: AutofillMatcher,
): Evidence[] {
  const evidence: Evidence[] = [];
  for (const finding of autofillFindings(inputs.webData)) {
    const fieldName = normalizeKey(fieldText(finding.fields.fieldName));
    const value = fieldText(finding.fields.fieldValue).trim();
    if (value.length === 0) {
      continue;
    }
    if (!matcher(fieldName, value)) {
      continue;
    }
    evidence.push({
      key: normalizeKey(value),
      raw: value,
      basis: "autofill",
      row: finding.provenance,
    });
  }
  return evidence;
}

function preferencesFinding(
  metadata: MetadataArtifactWrite | undefined,
): Finding | undefined {
  if (metadata === undefined || metadata.status !== "complete") {
    return undefined;
  }
  return metadata.findings[0]?.finding;
}

function preferencesFieldEvidence(
  inputs: ProfileInputs,
  fieldNames: readonly string[],
): Evidence[] {
  const profileFinding = preferencesFinding(inputs.preferences);
  if (profileFinding === undefined) {
    return [];
  }
  const evidence: Evidence[] = [];
  for (const fieldName of fieldNames) {
    const value = fieldText(profileFinding.fields[fieldName]).trim();
    if (value.length > 0) {
      evidence.push({
        key: normalizeKey(value),
        raw: value,
        basis: "preferences",
        row: profileFinding.provenance,
      });
    }
  }
  return evidence;
}

function localStateCountryEvidence(inputs: ProfileInputs): Evidence[] {
  const browserFinding = preferencesFinding(inputs.localState);
  if (browserFinding === undefined) {
    return [];
  }
  const value = fieldText(browserFinding.fields.variationsCountry).trim();
  if (value.length === 0) {
    return [];
  }
  return [
    {
      key: normalizeKey(value),
      raw: value,
      basis: "local_state",
      row: browserFinding.provenance,
    },
  ];
}

function committedVisits(
  history: HistoryArtifactWrite | undefined,
): readonly Finding[] {
  if (history === undefined || history.status !== "complete") {
    return [];
  }
  return history.findings
    .map((persisted) => persisted.finding)
    .filter(
      (finding) =>
        finding.findingKind === "history_visit" &&
        finding.commitState === "committed",
    );
}

function collectHostEvidence(inputs: ProfileInputs): Evidence[] {
  const evidence: Evidence[] = [];
  for (const finding of committedVisits(inputs.history)) {
    const url = fieldText(finding.fields.url).trim();
    if (url.length === 0) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (host.length === 0) {
      continue;
    }
    evidence.push({
      key: normalizeKey(host),
      raw: host,
      basis: "history",
      row: finding.provenance,
    });
  }
  return evidence;
}

const SEARCH_QUERY_PARAMS: Readonly<Record<string, string>> = {
  "google.": "q",
  "bing.": "q",
  "duckduckgo.": "q",
  "search.yahoo.": "p",
  "yandex.": "text",
  "ecosia.": "q",
  "startpage.": "query",
};

function extractSearchQuery(url: URL): string | null {
  const host = url.host.toLocaleLowerCase("en-US");
  for (const [needle, parameter] of Object.entries(SEARCH_QUERY_PARAMS)) {
    if (host.includes(needle)) {
      const term = url.searchParams.get(parameter);
      if (term !== null && term.trim().length > 0) {
        return term.trim();
      }
    }
  }
  return null;
}

function collectSearchEvidence(inputs: ProfileInputs): Evidence[] {
  const evidence: Evidence[] = [];
  for (const finding of committedVisits(inputs.history)) {
    const url = fieldText(finding.fields.url).trim();
    if (url.length === 0) {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const term = extractSearchQuery(parsed);
    if (term === null) {
      continue;
    }
    evidence.push({
      key: normalizeKey(term),
      raw: term,
      basis: "history",
      row: finding.provenance,
    });
  }
  return evidence;
}

interface Group {
  readonly key: string;
  readonly display: string;
  readonly bases: readonly string[];
  readonly rows: readonly SourceRowProvenance[];
  readonly supportingCount: number;
}

function chooseDisplay(rawCounts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [raw, count] of rawCounts) {
    if (
      count > bestCount ||
      (count === bestCount && compareStrings(raw, best) < 0)
    ) {
      best = raw;
      bestCount = count;
    }
  }
  return best;
}

function buildGroups(evidence: readonly Evidence[]): Group[] {
  const byKey = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const bucket = byKey.get(item.key);
    if (bucket === undefined) {
      byKey.set(item.key, [item]);
    } else {
      bucket.push(item);
    }
  }
  const groups: Group[] = [];
  for (const [key, bucket] of byKey) {
    const rowsByKey = new Map<string, SourceRowProvenance>();
    const rawCounts = new Map<string, number>();
    const bases = new Set<string>();
    for (const item of bucket) {
      rowsByKey.set(rowKey(item.row), item.row);
      rawCounts.set(item.raw, (rawCounts.get(item.raw) ?? 0) + 1);
      bases.add(item.basis);
    }
    const rows = [...rowsByKey.values()].sort((left, right) =>
      compareStrings(rowKey(left), rowKey(right)),
    );
    groups.push({
      key,
      display: chooseDisplay(rawCounts),
      bases: [...bases].sort(compareStrings),
      rows,
      supportingCount: rows.length,
    });
  }
  groups.sort((left, right) =>
    left.supportingCount !== right.supportingCount
      ? right.supportingCount - left.supportingCount
      : compareStrings(left.key, right.key),
  );
  return groups.slice(0, MAX_CANDIDATES_PER_KIND);
}

function candidateFields(group: Group): Record<string, FieldState<unknown>> {
  return {
    candidateValue: valueField(group.display),
    normalizedValue: valueField(group.key),
    supportingCount: valueField(group.supportingCount.toString()),
    evidenceBasis: valueField(group.bases.join("+")),
  };
}

function toCandidate(
  definition: HeuristicDefinition,
  group: Group,
  rank: number,
): Candidate {
  const [primary, ...rest] = group.rows;
  if (primary === undefined) {
    throw new Error(
      "A Candidate group must carry at least one Provenance row.",
    );
  }
  // The primary row plus its supporting rows stay within the total bound.
  const supportingRows = rest.slice(0, MAX_PROVENANCE_ROWS - 1);
  const provenance =
    supportingRows.length === 0
      ? { ...primary }
      : { ...primary, supportingRows };
  return createCandidate({
    candidateKind: definition.kind,
    rank,
    count: group.supportingCount,
    provenance,
    fields: candidateFields(group),
  });
}

function persistedCandidate(
  definition: HeuristicDefinition,
  profile: string,
  candidate: Candidate,
  group: Group,
): PersistedIdentityCandidate {
  return {
    candidate,
    category: definition.category,
    profile,
    searchText: [profile, definition.kind, group.display, group.key]
      .join("\n")
      .toLocaleLowerCase("en-US"),
    sortValue: group.key,
  };
}

function describeInputs(inputs: ProfileInputs): {
  readonly status: "complete" | "absent" | "unavailable";
  readonly reason: string | null;
} {
  const named: {
    readonly label: string;
    readonly artifact:
      | {
          readonly status: "complete" | "absent" | "unavailable";
        }
      | undefined;
  }[] = [
    { label: "history", artifact: inputs.history },
    { label: "web_data", artifact: inputs.webData },
    { label: "preferences", artifact: inputs.preferences },
    { label: "local_state", artifact: inputs.localState },
  ];
  const present = named.filter((entry) => entry.artifact !== undefined);
  const produced = present.filter(
    (entry) => entry.artifact?.status === "complete",
  );
  const notProduced = present
    .filter((entry) => entry.artifact?.status !== "complete")
    .map((entry) => `${entry.label}_${entry.artifact?.status ?? "missing"}`)
    .sort(compareStrings);
  if (produced.length > 0) {
    return {
      status: "complete",
      reason: notProduced.length === 0 ? null : notProduced.join(","),
    };
  }
  if (present.some((entry) => entry.artifact?.status === "unavailable")) {
    return {
      status: "unavailable",
      reason:
        notProduced.length === 0
          ? "no_candidate_inputs_available"
          : notProduced.join(","),
    };
  }
  return { status: "absent", reason: "no_candidate_inputs" };
}

/**
 * Generate every identity and behavior Candidate for one (Source, Profile).
 * Pure and deterministic: identical Findings always yield identical Candidates.
 */
export function generateProfileCandidates(
  inputs: ProfileInputs,
): CandidateArtifactWrite {
  const outcome = describeInputs(inputs);
  const candidates: PersistedIdentityCandidate[] = [];
  if (outcome.status === "complete") {
    for (const definition of HEURISTICS) {
      const groups = buildGroups(definition.collect(inputs));
      groups.forEach((group, index) => {
        const candidate = toCandidate(definition, group, index + 1);
        candidates.push(
          persistedCandidate(definition, inputs.profile, candidate, group),
        );
      });
    }
  }
  return {
    sourceId: inputs.sourceId,
    profile: inputs.profile,
    status: outcome.status,
    reason: outcome.reason,
    candidates,
  };
}

function artifactKey(sourceId: string, profile: string): string {
  return `${sourceId}\u0000${profile}`;
}

/**
 * Generate the Candidate artifacts for every (Source, Profile) in the Case. It
 * joins the per-Profile History and Web Data artifacts with the Profile-scoped
 * Preferences and browser-scoped Local State metadata by Source, then defers to
 * {@link generateProfileCandidates}. The output order is deterministic: Sources
 * keep their Case order and Profiles keep their recorded order.
 */
export function generateCaseCandidates(options: {
  readonly sources: readonly CaseSourceRecord[];
  readonly historyArtifacts: readonly HistoryArtifactWrite[];
  readonly webDataArtifacts: readonly WebDataArtifactWrite[];
  readonly metadataArtifacts: readonly MetadataArtifactWrite[];
}): CandidateArtifactWrite[] {
  const historyByKey = new Map<string, HistoryArtifactWrite>();
  for (const artifact of options.historyArtifacts) {
    historyByKey.set(
      artifactKey(artifact.sourceId, artifact.profile),
      artifact,
    );
  }
  const webDataByKey = new Map<string, WebDataArtifactWrite>();
  for (const artifact of options.webDataArtifacts) {
    webDataByKey.set(
      artifactKey(artifact.sourceId, artifact.profile),
      artifact,
    );
  }
  const preferencesByKey = new Map<string, MetadataArtifactWrite>();
  const localStateBySource = new Map<string, MetadataArtifactWrite>();
  for (const artifact of options.metadataArtifacts) {
    if (artifact.artifact === "Preferences") {
      preferencesByKey.set(
        artifactKey(artifact.sourceId, artifact.profile),
        artifact,
      );
    } else if (artifact.artifact === "Local State") {
      localStateBySource.set(artifact.sourceId, artifact);
    }
  }
  const results: CandidateArtifactWrite[] = [];
  for (const source of options.sources) {
    for (const profile of source.profiles) {
      const key = artifactKey(source.sourceId, profile.path);
      results.push(
        generateProfileCandidates({
          sourceId: source.sourceId,
          profile: profile.path,
          history: historyByKey.get(key),
          webData: webDataByKey.get(key),
          preferences: preferencesByKey.get(key),
          localState: localStateBySource.get(source.sourceId),
        }),
      );
    }
  }
  return results;
}

export type { ProfileInputs as CandidateProfileInputs };
