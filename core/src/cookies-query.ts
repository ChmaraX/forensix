import {
  assertCommitState,
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
  createFinding,
  type CommitState,
  type Finding,
} from "./forensic-model.js";

export type CookieDirection = "asc" | "desc";
export type CookieSort =
  | "host"
  | "name"
  | "creation-time"
  | "expires-time"
  | "last-access-time"
  | "profile";

export interface CookieQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly host?: string;
  readonly sameSite?: string;
  readonly sort?: CookieSort;
  readonly direction?: CookieDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CookiePage {
  readonly status: "ok";
  readonly command: "cookies";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const COOKIE_DIRECTIONS = ["asc", "desc"] as const;
const COOKIE_SORTS = [
  "host",
  "name",
  "creation-time",
  "expires-time",
  "last-access-time",
  "profile",
] as const;

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
  analysisNotFound: "Case has no Cookies analysis. Run analyse first.",
  schemaTable: "cookie_findings",
  mainTable: "cookie_findings",
  resultsTable: "cookie_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Cookie Finding JSON.",
      "finding_id",
    );
    const commitState = assertCommitState(
      row.commit_state,
      "finding_id",
      row.entity_id.toString(),
    );
    return createFinding({
      findingKind: row.finding_kind as string,
      profile: row.profile_path as string,
      commitState,
      provenance,
      fields,
    });
  },
  plan: (input) => {
    const direction = validateEnum(
      input.direction,
      "asc",
      COOKIE_DIRECTIONS,
      "--direction",
      "Cookies",
    );
    const sort = validateEnum(
      input.sort,
      "host",
      COOKIE_SORTS,
      "--sort",
      "Cookies",
    );
    const commitState = resolveCommitState(input.commitState, "Cookies");
    const limit = normalizeLimit(input.limit, "Cookies");
    const profiles = resolveProfiles(input.profiles, "Cookies");
    const search = resolveSearch(input.search);
    const host = input.host ?? null;
    const sameSite = input.sameSite?.toLocaleLowerCase("en-US") ?? null;

    const where = createConditions();
    where.add("f.finding_kind = 'cookie'");
    where.add("f.record_type = 'finding'");
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
      sort,
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
