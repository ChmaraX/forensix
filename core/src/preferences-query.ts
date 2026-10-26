import {
  createConditions,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  type FindingQuerySpec,
  type QueryDirection,
  type SortDefinition,
} from "./finding-query.js";
import { decodeFinding, type Identified } from "./record-store.js";
import type { CommitState, Finding } from "./forensic-model.js";

export interface MetadataQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly type?: MetadataType;
  readonly sort?: MetadataSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface MetadataPage {
  readonly status: "ok";
  readonly command: "metadata";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const METADATA_SORTS = ["type", "profile"] as const;
export type MetadataSort = (typeof METADATA_SORTS)[number];
export const METADATA_TYPES = ["browser_metadata", "profile_metadata"] as const;
export type MetadataType = (typeof METADATA_TYPES)[number];

const SORTS: Readonly<Record<MetadataSort, SortDefinition>> = {
  type: { expression: "f.sort_type", kind: "text" },
  profile: { expression: "f.sort_profile", kind: "text" },
};

const METADATA_SPEC: FindingQuerySpec<MetadataQuery, Finding> = {
  label: "Metadata",
  store: "preferences",
  analysisNotFound: "Case has no Metadata analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", METADATA_SORTS) ?? "profile";
    const commitState = resolveCommitState(input.commitState);
    const type = parseOption(input.type, "--type", METADATA_TYPES) ?? null;
    const limit = normalizeLimit(input.limit, "Metadata");
    const profiles = resolveProfiles(input.profiles, "Metadata");
    const search = resolveSearch(input.search);

    const where = createConditions();
    if (type !== null) {
      where.add("f.finding_kind = ?", type);
    }
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
      direction,
      limit,
      sortDefinition: SORTS[sort],
      conditions: where.conditions,
      parameters: where.parameters,
      fingerprint: (identity) => ({
        caseId: identity.caseId,
        activeArtifactResultIds: identity.artifactResultIds,
        profiles,
        search,
        commitState,
        type,
        sort,
        direction,
      }),
    };
  },
};

export function queryMetadata(input: MetadataQuery): MetadataPage {
  const { items, nextCursor, limit } = runFindingQuery(METADATA_SPEC, input);
  return { status: "ok", command: "metadata", items, nextCursor, limit };
}
