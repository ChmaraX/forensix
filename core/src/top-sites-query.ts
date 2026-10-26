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

export interface TopSiteQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: TopSiteSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface TopSitePage {
  readonly status: "ok";
  readonly command: "top-sites";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const TOP_SITE_SORTS = ["rank", "url", "title", "profile"] as const;
export type TopSiteSort = (typeof TOP_SITE_SORTS)[number];
const TOP_SITE_KIND = "top_site";

// `rank` keys on the integer `sort_rank` column (with a -1 COALESCE sentinel, so
// keys can be negative); every other sort keys on text. The `kind` tag drives
// cursor-key validation in the shared engine.
const SORTS: Readonly<Record<TopSiteSort, SortDefinition>> = {
  rank: { expression: "COALESCE(f.sort_rank, -1)", kind: "integer" },
  url: { expression: "COALESCE(f.sort_url, '')", kind: "text" },
  title: { expression: "COALESCE(f.sort_title, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const TOP_SITE_SPEC: FindingQuerySpec<TopSiteQuery, Finding> = {
  label: "Top Sites",
  store: "top-sites",
  analysisNotFound: "Case has no Top Sites analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", TOP_SITE_SORTS) ?? "rank";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Top Sites");
    const profiles = resolveProfiles(input.profiles, "Top Sites");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", TOP_SITE_KIND);
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
        sort,
        direction,
      }),
    };
  },
};

export function queryTopSites(input: TopSiteQuery): TopSitePage {
  const { items, nextCursor, limit } = runFindingQuery(TOP_SITE_SPEC, input);
  return { status: "ok", command: "top-sites", items, nextCursor, limit };
}
