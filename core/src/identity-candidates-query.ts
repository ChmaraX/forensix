import {
  createConditions,
  decodeRecordJson,
  normalizeLimit,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  validateEnum,
  type EngineRow,
  type FindingQuerySpec,
  type SortDefinition,
} from "./finding-query.js";
import { ForensixError } from "./errors.js";
import type { CandidateCategory } from "./identity-candidates.js";
import type { ForensicFields, Provenance } from "./forensic-model.js";

export type CandidateSort =
  | "rank"
  | "kind"
  | "supporting-count"
  | "value"
  | "profile";
export type CandidateDirection = "asc" | "desc";

export interface CandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly category?: string;
  readonly kind?: string;
  readonly search?: string;
  readonly sort?: CandidateSort;
  readonly direction?: CandidateDirection;
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
  readonly items: readonly CandidateRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const CANDIDATE_SORTS = [
  "rank",
  "kind",
  "supporting-count",
  "value",
  "profile",
] as const;
const CANDIDATE_DIRECTIONS = ["asc", "desc"] as const;
const CATEGORIES = ["identity", "behavior"] as const;

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
  analysisNotFound: "Case has no Candidate analysis. Run analyse first.",
  schemaTable: "identity_candidates",
  mainTable: "identity_candidates",
  resultsTable: "candidate_artifact_results",
  idColumn: "candidate_id",
  cursorIdField: "candidateId",
  selectColumns:
    "f.candidate_kind, f.category, f.profile_path, f.rank, f.supporting_count",
  parse: (row: EngineRow): CandidateRecord => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Candidate JSON.",
      "candidate_id",
    );
    if (row.category !== "identity" && row.category !== "behavior") {
      throw new ForensixError(
        "CASE_INVALID",
        "Case contains an invalid Candidate category.",
        { candidate_id: row.entity_id.toString() },
      );
    }
    return {
      recordType: "candidate",
      candidateKind: row.candidate_kind as string,
      category: row.category,
      profile: row.profile_path as string,
      rank: Number(row.rank),
      supportingCount: Number(row.supporting_count),
      provenance,
      fields,
    };
  },
  plan: (input) => {
    const direction = validateEnum(
      input.direction,
      "asc",
      CANDIDATE_DIRECTIONS,
      "--direction",
      "Candidates",
    );
    const sort = validateEnum(
      input.sort,
      "rank",
      CANDIDATE_SORTS,
      "--sort",
      "Candidates",
    );
    const category =
      input.category === undefined
        ? null
        : validateEnum(
            input.category,
            "identity",
            CATEGORIES,
            "--category",
            "Candidates",
          );
    const kind =
      input.kind === undefined || input.kind.length === 0 ? null : input.kind;
    const limit = normalizeLimit(input.limit, "Candidates");
    const profiles = resolveProfiles(input.profiles, "Candidates");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.record_type = 'candidate'");
    if (category !== null) {
      where.add("f.category = ?", category);
    }
    if (kind !== null) {
      where.add("f.candidate_kind = ?", kind);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
      sort,
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
