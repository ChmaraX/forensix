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

export type FaviconDirection = "asc" | "desc";
export type FaviconSort =
  | "icon-url"
  | "page-url"
  | "last-updated"
  | "width"
  | "profile";

export interface FaviconQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: FaviconSort;
  readonly direction?: FaviconDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface FaviconPage {
  readonly status: "ok";
  readonly command: "favicons";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const FAVICON_DIRECTIONS = ["asc", "desc"] as const;
const FAVICON_SORTS = [
  "icon-url",
  "page-url",
  "last-updated",
  "width",
  "profile",
] as const;
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
  analysisNotFound: "Case has no Favicons analysis. Run analyse first.",
  schemaTable: "favicon_findings",
  mainTable: "favicon_findings",
  resultsTable: "favicon_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Favicon Finding JSON.",
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
      FAVICON_DIRECTIONS,
      "--direction",
      "Favicons",
    );
    const sort = validateEnum(
      input.sort,
      "icon-url",
      FAVICON_SORTS,
      "--sort",
      "Favicons",
    );
    const commitState = resolveCommitState(input.commitState, "Favicons");
    const limit = normalizeLimit(input.limit, "Favicons");
    const profiles = resolveProfiles(input.profiles, "Favicons");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", FAVICON_KIND);
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

export function queryFavicons(input: FaviconQuery): FaviconPage {
  const { items, nextCursor, limit } = runFindingQuery(FAVICON_SPEC, input);
  return { status: "ok", command: "favicons", items, nextCursor, limit };
}
