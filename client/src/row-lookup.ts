/**
 * A row named in the URL that its page has not loaded (yet): read it from
 * the page's own route by its reference.
 *
 * A row reference (`rowRefOf`: file | table | row id | profile | Commit
 * State) names one row exactly, but no route can be asked for a row id. The
 * reference does carry the row's profile and Commit State, which the
 * artifact routes filter by (`profile`, `commit-state`), so the lookup reads
 * just that profile's rows of that Commit State (a merged route - the
 * Timeline, a Sites host - its own rows), page by page, until the
 * row with that exact reference turns up - at most `ROW_LOOKUP_PAGE_CAP`
 * pages. Nothing is matched loosely: a row is found only by its own
 * reference, or not at all ("not found within the first N rows"), never
 * replaced by a look-alike.
 *
 * `useRowSelection(rows, lookup)` (view-state) runs it when the URL names a
 * row the page's lists do not hold, so "Open this row in Cookies" from the
 * Timeline opens the sheet on a large Case too.
 */
import type { QueryParameters } from "./api.js";
import { readPages } from "./read-pages.js";
import { rowRefOf, type RowRefSource } from "./router.js";

/** Pages of 100 the lookup reads before it gives up. */
export const ROW_LOOKUP_PAGE_CAP = 50;
/** Rows the lookup reads at most (for the "not found" words). */
export const ROW_LOOKUP_ROW_CAP = ROW_LOOKUP_PAGE_CAP * 100;

/** The parts of a row reference the routes can filter by. */
export function refFilterOf(
  ref: string,
): { readonly profile: string; readonly commitState: string } | null {
  const parts = ref.split("|");
  if (parts.length < 5) {
    return null;
  }
  const commitState = parts[parts.length - 1] ?? "";
  const profile = parts[parts.length - 2] ?? "";
  return commitState === "" ? null : { profile, commitState };
}

/** How a page's route is read for a row lookup. Keep it stable (a module
 *  constant or a memo): a new source starts a new lookup. */
export interface RowLookupSource {
  readonly route: string;
  /** The page's own fixed parameters (History's `view=visits`, a Sites
   *  host, the Timeline's direction and range). */
  readonly parameters?: QueryParameters;
  /** False for a route without `commit-state` (Cache, Timeline, Sites).
   *  @default true */
  readonly byCommitState?: boolean;
  /** False for a route without `profile` (Timeline, Sites). @default true */
  readonly byProfile?: boolean;
}

/** What a lookup found: the row, or none - `capped` when the lookup
 *  stopped at `ROW_LOOKUP_PAGE_CAP` with rows still unread (so the row may
 *  exist further on), else the route holds no row with that reference. */
export interface RowLookupResult<Row> {
  readonly row: Row | null;
  readonly capped: boolean;
}

/** Finds the row `ref` names on `source` among the first
 *  `ROW_LOOKUP_ROW_CAP` rows of its profile and Commit State (as far as the
 *  route filters by them). Rejects when a read fails or `signal` aborts. */
export async function findRowByRef<Row extends RowRefSource>(
  source: RowLookupSource,
  ref: string,
  signal?: AbortSignal,
): Promise<RowLookupResult<Row>> {
  const filter = refFilterOf(ref);
  if (filter === null) {
    return { row: null, capped: false };
  }
  const parameters: (readonly [string, string])[] = [
    ...(source.parameters ?? []),
    ["limit", "100"],
  ];
  if (source.byProfile !== false && filter.profile !== "") {
    parameters.push(["profile", filter.profile]);
  }
  if (source.byCommitState !== false) {
    parameters.push(["commit-state", filter.commitState]);
  }
  const hit: { row: Row | null } = { row: null };
  const read = await readPages<Row>(source.route, parameters, {
    cap: ROW_LOOKUP_PAGE_CAP,
    signal,
    onPage: (rows) => {
      hit.row = rows.find((row) => rowRefOf(row) === ref) ?? null;
      return hit.row === null ? undefined : "stop";
    },
  });
  return { row: hit.row, capped: hit.row === null && !read.complete };
}
