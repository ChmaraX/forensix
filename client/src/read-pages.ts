/**
 * The one way the client follows a keyset-paged route past its first page,
 * and the one way it keeps a Case-wide read for the session.
 *
 *  - `readPages(route, parameters, { cap, signal, onPage })` reads page
 *    after page (`nextCursor`) until the route runs out, `cap` pages are
 *    read, or `onPage` says stop; every request carries `signal`, so an
 *    abort stops the read on the wire, not only the loop. `complete` is
 *    true only when the route itself ran out.
 *  - `once(read)` makes a read at most once per session (the Case is
 *    read-only, so its answer cannot go stale); a failed read is
 *    forgotten, so the next caller tries again.
 *  - `COMMIT_STATES`: the three reads a Commit-State route splits into
 *    (forensic rule 4: saved and recovered rows are separate lists).
 */
import { callApi, type QueryParameters } from "./api.js";
import type { CommitState, PageOf } from "./types.js";

/** Saved (committed), then the two sidecars (WAL, rollback journal). */
export const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const satisfies readonly CommitState[];

/** The two sidecar Commit States: a page's Recovered list. */
export const RECOVERED_STATES = [
  "wal_resident",
  "journal_resident",
] as const satisfies readonly CommitState[];

/** `parameters` narrowed to one Commit State (any earlier pick replaced). */
export function withCommitState(
  parameters: QueryParameters,
  state: CommitState,
): QueryParameters {
  return [
    ...parameters.filter(([name]) => name !== "commit-state"),
    ["commit-state", state],
  ];
}

export interface PagedRead<Row> {
  /** Every row read, in the route's order. */
  readonly rows: readonly Row[];
  /** The route ran out: no row is left unread. */
  readonly complete: boolean;
  /** Pages read. */
  readonly pages: number;
}

export interface ReadPagesOptions<Row> {
  /** Most pages read before stopping (`complete` is then false). */
  readonly cap: number;
  readonly signal?: AbortSignal;
  /** Each page's rows as it lands (with its index); returning `"stop"`
   *  ends the read after this page. */
  readonly onPage?: (rows: readonly Row[], index: number) => unknown;
}

/** Reads `route` page by page (see the module comment). Rejects when a
 *  read fails or `signal` aborts. */
export async function readPages<Row>(
  route: string,
  parameters: QueryParameters,
  { cap, signal, onPage }: ReadPagesOptions<Row>,
): Promise<PagedRead<Row>> {
  const rows: Row[] = [];
  let after: string | null = null;
  let pages = 0;
  while (pages < cap) {
    const page: PageOf<Row> = await callApi<PageOf<Row>>(
      route,
      after === null ? parameters : [...parameters, ["after", after]],
      { signal },
    );
    rows.push(...page.items);
    after = page.nextCursor;
    const verdict = onPage?.(page.items, pages);
    pages += 1;
    if (after === null || verdict === "stop") {
      break;
    }
  }
  return { rows, complete: after === null, pages };
}

/** `read` made at most once per session; `refresh` starts it again
 *  (Retry). A failed read is forgotten. */
export function once<T>(
  read: () => Promise<T>,
): (refresh?: boolean) => Promise<T> {
  let current: Promise<T> | null = null;
  return (refresh = false) => {
    if (refresh || current === null) {
      const next = read();
      current = next;
      next.catch(() => {
        if (current === next) {
          current = null;
        }
      });
    }
    return current;
  };
}
