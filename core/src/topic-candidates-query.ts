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
import { decodeCandidate, type Identified } from "./record-store.js";
import type { Candidate } from "./forensic-model.js";
import { TOPIC_CANDIDATE_KIND } from "./topic-candidates.js";

/**
 * Read-only query surface for topic Candidates.
 *
 * This is deliberately a separate surface from every Finding query. Candidates
 * are ranked hypotheses, not facts: the page carries `Candidate` records
 * (recordType `candidate`) and never `Finding` records, so no consumer of this
 * API can mistake a classifier output for a Finding or a factual summary tile.
 * A Candidate has no Commit State, so there is no Commit-State filter. The
 * query mirrors the shared surface — TYPE-first (`candidateKind`), search,
 * Profile filter, deterministic sort, and keyset pagination.
 */

export const TOPIC_CANDIDATE_SORTS = [
  "rank",
  "supporting",
  "label",
  "profile",
] as const;
export type TopicCandidateSort = (typeof TOPIC_CANDIDATE_SORTS)[number];

export interface TopicCandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  /** Filter to a single taxonomy label id (e.g. `finance_banking`). */
  readonly label?: string;
  readonly sort?: TopicCandidateSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface TopicCandidatePage {
  readonly status: "ok";
  readonly command: "topic-candidates";
  readonly items: readonly Identified<Candidate>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const SORT_DEFINITIONS: Readonly<Record<TopicCandidateSort, SortDefinition>> = {
  rank: { expression: "f.rank", kind: "integer" },
  supporting: { expression: "f.supporting_count", kind: "integer" },
  label: { expression: "COALESCE(f.topic_label, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const TOPIC_CANDIDATE_SPEC: FindingQuerySpec<TopicCandidateQuery, Candidate> = {
  label: "Topic Candidate",
  store: "topic-candidates",
  analysisNotFound: "Case has no analysis. Run analyse first.",
  decode: decodeCandidate,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort =
      parseOption(input.sort, "--sort", TOPIC_CANDIDATE_SORTS) ?? "rank";
    const limit = normalizeLimit(input.limit, "Topic Candidate");
    const profiles = resolveProfiles(input.profiles, "Topic Candidate");
    const label = input.label ?? null;
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.candidate_kind = ?", TOPIC_CANDIDATE_KIND);
    if (label !== null) {
      where.add("f.topic_label = ?", label);
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
        search,
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
