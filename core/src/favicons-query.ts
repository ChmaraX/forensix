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

export interface FaviconQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: FaviconSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface FaviconPage {
  readonly status: "ok";
  readonly command: "favicons";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const FAVICON_SORTS = [
  "icon-url",
  "page-url",
  "last-updated",
  "width",
  "profile",
] as const;
export type FaviconSort = (typeof FAVICON_SORTS)[number];
const FAVICON_KIND = "favicon";

// `width` keys on the integer `sort_width` column (with a -1 COALESCE sentinel,
// so keys can be negative); every other sort keys on text. The `kind` tag drives
// cursor-key validation in the shared engine.
const SORTS: Readonly<Record<FaviconSort, SortDefinition>> = {
  "icon-url": { expression: "COALESCE(f.sort_icon_url, '')", kind: "text" },
  "page-url": { expression: "COALESCE(f.sort_page_url, '')", kind: "text" },
  "last-updated": {
    expression: "COALESCE(f.sort_last_updated, '')",
    kind: "text",
  },
  width: { expression: "COALESCE(f.sort_width, -1)", kind: "integer" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const FAVICON_SPEC: FindingQuerySpec<FaviconQuery, Finding> = {
  label: "Favicons",
  store: "favicons",
  analysisNotFound: "Case has no Favicons analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", FAVICON_SORTS) ?? "icon-url";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Favicons");
    const profiles = resolveProfiles(input.profiles, "Favicons");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", FAVICON_KIND);
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

export function queryFavicons(input: FaviconQuery): FaviconPage {
  const { items, nextCursor, limit } = runFindingQuery(FAVICON_SPEC, input);
  return { status: "ok", command: "favicons", items, nextCursor, limit };
}
