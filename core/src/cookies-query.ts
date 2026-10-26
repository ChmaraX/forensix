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

export interface CookieQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly host?: string;
  readonly sameSite?: string;
  readonly sort?: CookieSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CookiePage {
  readonly status: "ok";
  readonly command: "cookies";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const COOKIE_SORTS = [
  "host",
  "name",
  "creation-time",
  "expires-time",
  "last-access-time",
  "profile",
] as const;
export type CookieSort = (typeof COOKIE_SORTS)[number];

const SORTS: Readonly<Record<CookieSort, SortDefinition>> = {
  host: { expression: "COALESCE(f.sort_host, '')", kind: "text" },
  name: { expression: "COALESCE(f.sort_name, '')", kind: "text" },
  "creation-time": {
    expression: "COALESCE(f.sort_creation, '')",
    kind: "text",
  },
  "expires-time": { expression: "COALESCE(f.sort_expires, '')", kind: "text" },
  "last-access-time": {
    expression: "COALESCE(f.sort_last_access, '')",
    kind: "text",
  },
  profile: { expression: "f.profile_path", kind: "text" },
};

const COOKIE_SPEC: FindingQuerySpec<CookieQuery, Finding> = {
  label: "Cookies",
  store: "cookies",
  analysisNotFound: "Case has no Cookies analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", COOKIE_SORTS) ?? "host";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Cookies");
    const profiles = resolveProfiles(input.profiles, "Cookies");
    const search = resolveSearch(input.search);
    const host = input.host ?? null;
    const sameSite = input.sameSite?.toLocaleLowerCase("en-US") ?? null;

    const where = createConditions();
    where.add("f.finding_kind = 'cookie'");
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (host !== null) {
      where.add("f.host_key = ?", host);
    }
    if (sameSite !== null) {
      where.add("f.same_site = ?", sameSite);
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
        host,
        sameSite,
        sort,
        direction,
      }),
    };
  },
};

export function queryCookies(input: CookieQuery): CookiePage {
  const { items, nextCursor, limit } = runFindingQuery(COOKIE_SPEC, input);
  return { status: "ok", command: "cookies", items, nextCursor, limit };
}
