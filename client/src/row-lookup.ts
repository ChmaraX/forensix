/**
 * A row named in the URL that its page has not loaded (yet): read it from
 * the page's own route by its reference.
 *
 * A row reference is the row's record id (`rowRefOf`: `history:180`),
 * unique in the Case. No list route can be asked for one id, so the lookup
 * first reads the record itself (`get`): an id the Case does not hold, or
 * a row a later Analysis Run superseded, is not found at once. The record
 * names its profile and Commit State, which the routes filter by
 * (`profile`, `commit-state`), so the lookup then reads just that
 * profile's rows of that Commit State on the page's own route (a merged
 * route - the Timeline, a Sites host - its own rows), page by page, until
 * the row with that exact id turns up - at most `ROW_LOOKUP_PAGE_CAP`
 * pages. The row comes from the page's route, in the page's shape (a
 * Sites row keeps its `hostFields`), and only when the page lists it.
 *
 * Nothing is matched loosely: a row is found only by its own id, or not at
 * all ("not found within the first N rows"), never replaced by a
 * look-alike.
 *
 * `useRowSelection(rows, lookup)` (view-state) runs it when the URL names a
 * row the page's lists do not hold, so "Open this row in Cookies" from the
 * Timeline opens the sheet on a large Case too.
 */
import { ApiError, callApi, type QueryParameters } from "./api.js";
import { readPages } from "./read-pages.js";
import { rowMatchesRef, type RowRefSource } from "./router.js";

/** Pages of 100 the lookup reads before it gives up. */
export const ROW_LOOKUP_PAGE_CAP = 50;
/** Rows the lookup reads at most (for the "not found" words). */
export const ROW_LOOKUP_ROW_CAP = ROW_LOOKUP_PAGE_CAP * 100;

/** How a page's route is read for a row lookup. Keep it stable (a module
 *  constant or a memo): a new source starts a new lookup. */
export interface RowLookupSource {
  readonly route: string;
  /** The page's own fixed parameters (History's `view=visits`, a Sites
   *  host, the Timeline's direction and range). */
  readonly parameters?: QueryParameters;
  /** False for a route without `commit-state` (Cache, identity
   *  Candidates). @default true */
  readonly byCommitState?: boolean;
  /** False for a route without `profile` (`site-hosts`). @default true */
  readonly byProfile?: boolean;
}

/** What a lookup found: the row, or none - `capped` when the lookup
 *  stopped at `ROW_LOOKUP_PAGE_CAP` with rows still unread (so the row may
 *  exist further on), else the route holds no row with that reference. */
export interface RowLookupResult<Row> {
  readonly row: Row | null;
  readonly capped: boolean;
}

/** The `get` route's answer: one record, active or superseded. */
interface RecordRead {
  readonly active: boolean;
  readonly item: {
    readonly profile?: string;
    readonly commitState?: string;
  };
}

/** The profile and Commit State the record `ref` names has (`get`). Null
 *  when the Case holds no such active row. */
async function filterOf(
  ref: string,
  signal: AbortSignal | undefined,
): Promise<{
  readonly profile: string | null;
  readonly commitState: string | null;
} | null> {
  let read: RecordRead;
  try {
    read = await callApi<RecordRead>("get", [["id", ref]], { signal });
  } catch (error) {
    // RECORD_NOT_FOUND (404) is an answer: the Case has no such record.
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
  if (!read.active) {
    return null;
  }
  return {
    profile: read.item.profile ?? null,
    commitState: read.item.commitState ?? null,
  };
}

/** Finds the row `ref` names on `source` among the first
 *  `ROW_LOOKUP_ROW_CAP` rows of its profile and Commit State (as far as the
 *  route filters by them). Rejects when a read fails or `signal` aborts. */
export async function findRowByRef<Row extends RowRefSource>(
  source: RowLookupSource,
  ref: string,
  signal?: AbortSignal,
): Promise<RowLookupResult<Row>> {
  const filter = await filterOf(ref, signal);
  if (filter === null) {
    return { row: null, capped: false };
  }
  const parameters: (readonly [string, string])[] = [
    ...(source.parameters ?? []),
    ["limit", "100"],
  ];
  if (
    source.byProfile !== false &&
    filter.profile !== null &&
    filter.profile !== ""
  ) {
    parameters.push(["profile", filter.profile]);
  }
  if (source.byCommitState !== false && filter.commitState !== null) {
    parameters.push(["commit-state", filter.commitState]);
  }
  const hit: { row: Row | null } = { row: null };
  const read = await readPages<Row>(source.route, parameters, {
    cap: ROW_LOOKUP_PAGE_CAP,
    signal,
    onPage: (rows) => {
      hit.row = rows.find((row) => rowMatchesRef(row, ref)) ?? null;
      return hit.row === null ? undefined : "stop";
    },
  });
  return { row: hit.row, capped: hit.row === null && !read.complete };
}
