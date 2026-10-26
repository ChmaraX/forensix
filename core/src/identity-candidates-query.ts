import {
  createConditions,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  type FindingQuerySpec,
  type QueryDirection,
  type SortDefinition,
} from "./finding-query.js";
import { decodeIdentityCandidate, type Identified } from "./record-store.js";
import type { CandidateCategory } from "./identity-candidates.js";
import type { ForensicFields, Provenance } from "./forensic-model.js";

export const CANDIDATE_SORTS = [
  "rank",
  "kind",
  "supporting-count",
  "value",
  "profile",
] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];
export const CANDIDATE_CATEGORIES = [
  "identity",
  "behavior",
] as const satisfies readonly CandidateCategory[];

export interface CandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly category?: string;
  readonly kind?: string;
  readonly search?: string;
  readonly sort?: CandidateSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

/**
 * One ranked Candidate row. It is deliberately not a Finding: it has no Commit
 * State, it carries `rank` and `supportingCount`, and its `candidateKind` is a
 * ranked-hypothesis kind, never a factual Finding kind.
 */
export interface CandidateRecord {
  readonly recordType: "candidate";
  readonly candidateKind: string;
  readonly category: CandidateCategory;
  readonly profile: string;
  readonly rank: number;
  readonly supportingCount: number;
  readonly provenance: Provenance;
  readonly fields: ForensicFields;
}

export interface CandidatePage {
  readonly status: "ok";
  readonly command: "candidates";
  readonly items: readonly Identified<CandidateRecord>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const SORT_DEFINITIONS: Readonly<Record<CandidateSort, SortDefinition>> = {
  rank: { expression: "printf('%020d', f.rank)", kind: "text" },
  kind: { expression: "f.candidate_kind", kind: "text" },
  "supporting-count": {
    expression: "printf('%020d', f.supporting_count)",
    kind: "text",
  },
  value: { expression: "f.sort_value", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const CANDIDATE_SPEC: FindingQuerySpec<CandidateQuery, CandidateRecord> = {
  label: "Candidates",
  store: "identity-candidates",
  analysisNotFound: "Case has no Candidate analysis. Run analyse first.",
  decode: decodeIdentityCandidate,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", CANDIDATE_SORTS) ?? "rank";
    const category =
      parseOption(input.category, "--category", CANDIDATE_CATEGORIES) ?? null;
    const kind =
      input.kind === undefined || input.kind.length === 0 ? null : input.kind;
    const limit = normalizeLimit(input.limit, "Candidates");
    const profiles = resolveProfiles(input.profiles, "Candidates");
    const search = resolveSearch(input.search);

    const where = createConditions();
    if (category !== null) {
      where.add("f.category = ?", category);
    }
    if (kind !== null) {
      where.add("f.candidate_kind = ?", kind);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
      direction,
      limit,
      sortDefinition: SORT_DEFINITIONS[sort],
      conditions: where.conditions,
      parameters: where.parameters,
      fingerprint: (identity) => ({
        caseId: identity.caseId,
        activeArtifactResultIds: identity.artifactResultIds,
        profiles,
        category,
        kind,
        search,
        sort,
        direction,
      }),
    };
  },
};

export function queryCandidates(input: CandidateQuery): CandidatePage {
  const { items, nextCursor, limit } = runFindingQuery(CANDIDATE_SPEC, input);
  return { status: "ok", command: "candidates", items, nextCursor, limit };
}
