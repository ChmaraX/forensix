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

export interface BookmarkQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly source?: BookmarkSource;
  readonly sort?: BookmarkSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface BookmarkPage {
  readonly status: "ok";
  readonly command: "bookmarks";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const BOOKMARK_SORTS = [
  "name",
  "url",
  "date-added",
  "folder",
  "profile",
] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];
/** Primary `Bookmarks` vs backup `Bookmarks.bak`, exposed as a CLI filter. */
export const BOOKMARK_SOURCES = ["primary", "backup"] as const;
export type BookmarkSource = (typeof BOOKMARK_SOURCES)[number];
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
  store: "bookmarks",
  analysisNotFound: "Case has no Bookmarks analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
    const sort = parseOption(input.sort, "--sort", BOOKMARK_SORTS) ?? "name";
    const commitState = resolveCommitState(input.commitState);
    const source =
      parseOption(input.source, "--source", BOOKMARK_SOURCES) ?? null;
    const limit = normalizeLimit(input.limit, "Bookmarks");
    const profiles = resolveProfiles(input.profiles, "Bookmarks");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", BOOKMARK_KIND);
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (source !== null) {
      where.add("f.source_file = ?", SOURCE_FILES[source]);
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
