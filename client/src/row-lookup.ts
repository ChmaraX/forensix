/**
 * A row named in the URL that its page has not loaded (yet): read it from
 * the page's own route by its reference.
 *
 * A row reference (`rowRefOf`: file | table | row id | profile | Commit
 * State) names one row exactly, but no route can be asked for a row id. The
 * reference does carry the row's profile and Commit State, which every
 * Finding route filters by (`profile`, `commit-state`), so the lookup reads
 * just that profile's rows of that Commit State, page by page, until the
 * row with that exact reference turns up - at most `ROW_LOOKUP_PAGE_CAP`
 * pages. Nothing is matched loosely: a row is found only by its own
 * reference, or not at all ("not found within the first N rows"), never
 * replaced by a look-alike.
 *
 * `useRowSelection(rows, lookup)` (view-state) runs it when the URL names a
 * row the page's lists do not hold, so "Open this row in Cookies" from the
 * Timeline opens the sheet on a large Case too.
 */
import { callApi, type QueryParameters } from "./api.js";
import { rowRefOf } from "./router.js";
import type { Finding, PageOf } from "./types.js";

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

/** How a page's route is read for a row lookup. */
export interface RowLookupSource {
  readonly route: string;
  /** The page's own fixed parameters (History's `view=visits`). */
  readonly parameters?: QueryParameters;
  /** False for a route without `commit-state` (Cache). @default true */
  readonly byCommitState?: boolean;
}

/** What a lookup found: the row, or none - `capped` when the lookup
 *  stopped at `ROW_LOOKUP_PAGE_CAP` with rows still unread (so the row may
 *  exist further on), else the route holds no row with that reference. */
export interface RowLookupResult {
  readonly row: Finding | null;
  readonly capped: boolean;
}

/** Finds the row `ref` names on `source` among the first
 *  `ROW_LOOKUP_ROW_CAP` rows of its profile and Commit State. Throws when
 *  a read fails. */
export async function findRowByRef(
  source: RowLookupSource,
  ref: string,
): Promise<RowLookupResult> {
  const filter = refFilterOf(ref);
  if (filter === null) {
    return { row: null, capped: false };
  }
  const base: (readonly [string, string])[] = [
    ...(source.parameters ?? []),
    ["limit", "100"],
  ];
  if (filter.profile !== "") {
    base.push(["profile", filter.profile]);
  }
  if (source.byCommitState !== false) {
    base.push(["commit-state", filter.commitState]);
  }
  let after: string | null = null;
  for (let page = 0; page < ROW_LOOKUP_PAGE_CAP; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      source.route,
      after === null ? base : [...base, ["after", after]],
    );
    const found = result.items.find((row) => rowRefOf(row) === ref);
    if (found !== undefined) {
      return { row: found, capped: false };
    }
    after = result.nextCursor;
    if (after === null) {
      return { row: null, capped: false };
    }
  }
  return { row: null, capped: true };
}
