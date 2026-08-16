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

export type TopSiteDirection = "asc" | "desc";
export type TopSiteSort = "rank" | "url" | "title" | "profile";

export interface TopSiteQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: TopSiteSort;
  readonly direction?: TopSiteDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface TopSitePage {
  readonly status: "ok";
  readonly command: "top-sites";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const TOP_SITE_DIRECTIONS = ["asc", "desc"] as const;
const TOP_SITE_SORTS = ["rank", "url", "title", "profile"] as const;
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
  analysisNotFound: "Case has no Top Sites analysis. Run analyse first.",
  schemaTable: "top_sites_findings",
  mainTable: "top_sites_findings",
  resultsTable: "top_sites_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Top Site Finding JSON.",
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
      TOP_SITE_DIRECTIONS,
      "--direction",
      "Top Sites",
    );
    const sort = validateEnum(
      input.sort,
      "rank",
      TOP_SITE_SORTS,
      "--sort",
      "Top Sites",
    );
    const commitState = resolveCommitState(input.commitState, "Top Sites");
    const limit = normalizeLimit(input.limit, "Top Sites");
    const profiles = resolveProfiles(input.profiles, "Top Sites");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", TOP_SITE_KIND);
    where.add("f.record_type = 'finding'");
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
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
