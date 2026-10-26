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

export interface DownloadQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly state?: string;
  readonly dangerType?: string;
  readonly sort?: DownloadSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface DownloadPage {
  readonly status: "ok";
  readonly command: "downloads";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const DOWNLOAD_SORTS = [
  "start-time",
  "end-time",
  "target-path",
  "state",
  "total-bytes",
  "profile",
] as const;
export type DownloadSort = (typeof DOWNLOAD_SORTS)[number];
const DOWNLOAD_KIND = "download";

const SORTS: Readonly<Record<DownloadSort, SortDefinition>> = {
  "start-time": { expression: "COALESCE(f.sort_start, '')", kind: "text" },
  "end-time": { expression: "COALESCE(f.sort_end, '')", kind: "text" },
  "target-path": { expression: "COALESCE(f.sort_target, '')", kind: "text" },
  state: { expression: "COALESCE(f.sort_state, '')", kind: "text" },
  "total-bytes": { expression: "COALESCE(f.sort_bytes, -1)", kind: "integer" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const DOWNLOAD_SPEC: FindingQuerySpec<DownloadQuery, Finding> = {
  label: "Downloads",
  store: "downloads",
  analysisNotFound: "Case has no Downloads analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "desc";
    const sort =
      parseOption(input.sort, "--sort", DOWNLOAD_SORTS) ?? "start-time";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Downloads");
    const profiles = resolveProfiles(input.profiles, "Downloads");
    const search = resolveSearch(input.search);
    const state = input.state?.toLocaleLowerCase("en-US") ?? null;
    const dangerType = input.dangerType?.toLocaleLowerCase("en-US") ?? null;

    const where = createConditions();
    where.add("f.finding_kind = ?", DOWNLOAD_KIND);
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (state !== null) {
      where.add("f.sort_state = ?", state);
    }
    if (dangerType !== null) {
      where.add("f.danger_type = ?", dangerType);
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
        state,
        dangerType,
        sort,
        direction,
      }),
    };
  },
};

export function queryDownloads(input: DownloadQuery): DownloadPage {
  const { items, nextCursor, limit } = runFindingQuery(DOWNLOAD_SPEC, input);
  return { status: "ok", command: "downloads", items, nextCursor, limit };
}
