import {
  createConditions,
  decodeRecordJson,
  normalizeLimit,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  validateEnum,
  type EngineRow,
  type FindingQuerySpec,
  type SortDefinition,
} from "./finding-query.js";
import {
  createCandidate,
  type Candidate,
  type CommitState,
} from "./forensic-model.js";
import { TOPIC_CANDIDATE_KIND } from "./topic-candidates.js";

/**
 * Read-only query surface for topic Candidates.
 *
 * This is deliberately a separate surface from every Finding query. Candidates
 * are ranked hypotheses, not facts: the page carries `Candidate` records
 * (recordType `candidate`) and never `Finding` records, so no consumer of this
 * API can mistake a classifier output for a Finding or a factual summary tile.
 * The query mirrors the shared surface — TYPE-first (`candidateKind`), search,
 * Profile and Commit-State filters, deterministic sort, and keyset pagination.
 */

export type TopicCandidateDirection = "asc" | "desc";
export type TopicCandidateSort = "rank" | "supporting" | "label" | "profile";

export interface TopicCandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  /** Filter to a single taxonomy label id (e.g. `finance_banking`). */
  readonly label?: string;
  readonly sort?: TopicCandidateSort;
  readonly direction?: TopicCandidateDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface TopicCandidatePage {
  readonly status: "ok";
  readonly command: "topic-candidates";
  readonly items: readonly Candidate[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const DIRECTIONS = ["asc", "desc"] as const;
const SORTS = ["rank", "supporting", "label", "profile"] as const;

const SORT_DEFINITIONS: Readonly<Record<TopicCandidateSort, SortDefinition>> = {
  rank: { expression: "f.rank", kind: "integer" },
  supporting: { expression: "f.supporting_count", kind: "integer" },
  label: { expression: "COALESCE(f.topic_label, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const TOPIC_CANDIDATE_SPEC: FindingQuerySpec<TopicCandidateQuery, Candidate> = {
  label: "Topic Candidate",
  analysisNotFound: "Case has no analysis. Run analyse first.",
  schemaTable: "forensic_candidates",
  mainTable: "forensic_candidates",
  resultsTable: "history_artifact_results",
  idColumn: "candidate_id",
  cursorIdField: "candidateId",
  selectColumns: "f.candidate_kind, f.rank, f.supporting_count",
  parse: (row: EngineRow): Candidate => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Candidate JSON.",
      "candidate_id",
    );
    return createCandidate({
      candidateKind: row.candidate_kind as string,
      rank: Number(row.rank),
      count: Number(row.supporting_count),
      provenance,
      fields,
    });
  },
  plan: (input) => {
    const direction = validateEnum(
      input.direction,
      "asc",
      DIRECTIONS,
      "--direction",
      "Topic Candidate",
    );
    const sort = validateEnum(
      input.sort,
      "rank",
      SORTS,
      "--sort",
      "Topic Candidate",
    );
    const commitState = resolveCommitState(
      input.commitState,
      "Topic Candidate",
    );
    const limit = normalizeLimit(input.limit, "Topic Candidate");
    const profiles = resolveProfiles(input.profiles, "Topic Candidate");
    const label = input.label ?? null;
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.candidate_kind = ?", TOPIC_CANDIDATE_KIND);
    where.add("f.record_type = 'candidate'");
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (label !== null) {
      where.add("f.topic_label = ?", label);
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
        search,
        commitState,
        label,
        sort,
        direction,
      }),
    };
  },
};

export function queryTopicCandidates(
  input: TopicCandidateQuery,
): TopicCandidatePage {
  const { items, nextCursor, limit } = runFindingQuery(
    TOPIC_CANDIDATE_SPEC,
    input,
  );
  return {
    status: "ok",
    command: "topic-candidates",
    items,
    nextCursor,
    limit,
  };
}
