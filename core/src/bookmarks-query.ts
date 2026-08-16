import {
  createConditions,
  decodeRecordJson,
  assertCommitState,
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

export type BookmarkDirection = "asc" | "desc";
export type BookmarkSort = "name" | "url" | "date-added" | "folder" | "profile";
/** Primary `Bookmarks` vs backup `Bookmarks.bak`, exposed as a CLI filter. */
export type BookmarkSource = "primary" | "backup";

export interface BookmarkQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly source?: BookmarkSource;
  readonly sort?: BookmarkSort;
  readonly direction?: BookmarkDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface BookmarkPage {
  readonly status: "ok";
  readonly command: "bookmarks";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const BOOKMARK_DIRECTIONS = ["asc", "desc"] as const;
const BOOKMARK_SORTS = [
  "name",
  "url",
  "date-added",
  "folder",
  "profile",
] as const;
const BOOKMARK_SOURCES = ["primary", "backup"] as const;
const BOOKMARK_KIND = "bookmark";

const SOURCE_FILES: Readonly<Record<BookmarkSource, string>> = {
  primary: "Bookmarks",
  backup: "Bookmarks.bak",
};

// `date-added` keys on the integer `sort_date_added` column (WebKit microseconds,
// with a -1 COALESCE sentinel so keys can be negative); every other sort keys on
// text. The `kind` tag drives cursor-key validation in the shared engine.
const SORTS: Readonly<Record<BookmarkSort, SortDefinition>> = {
  name: { expression: "COALESCE(f.sort_name, '')", kind: "text" },
  url: { expression: "COALESCE(f.sort_url, '')", kind: "text" },
  "date-added": {
    expression: "COALESCE(f.sort_date_added, -1)",
    kind: "integer",
  },
  folder: { expression: "COALESCE(f.sort_folder, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const BOOKMARK_SPEC: FindingQuerySpec<BookmarkQuery, Finding> = {
  label: "Bookmarks",
  analysisNotFound: "Case has no Bookmarks analysis. Run analyse first.",
  schemaTable: "bookmarks_findings",
  mainTable: "bookmarks_findings",
  resultsTable: "bookmarks_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Bookmark Finding JSON.",
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
      BOOKMARK_DIRECTIONS,
      "--direction",
      "Bookmarks",
    );
    const sort = validateEnum(
      input.sort,
      "name",
      BOOKMARK_SORTS,
      "--sort",
      "Bookmarks",
    );
    const commitState = resolveCommitState(input.commitState, "Bookmarks");
    const source =
      input.source === undefined
        ? null
        : validateEnum(
            input.source,
            "primary",
            BOOKMARK_SOURCES,
            "--source",
            "Bookmarks",
          );
    const limit = normalizeLimit(input.limit, "Bookmarks");
    const profiles = resolveProfiles(input.profiles, "Bookmarks");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", BOOKMARK_KIND);
    where.add("f.record_type = 'finding'");
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (source !== null) {
      where.add("f.source_file = ?", SOURCE_FILES[source]);
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
        source,
        sort,
        direction,
      }),
    };
  },
};

export function queryBookmarks(input: BookmarkQuery): BookmarkPage {
  const { items, nextCursor, limit } = runFindingQuery(BOOKMARK_SPEC, input);
  return { status: "ok", command: "bookmarks", items, nextCursor, limit };
}
