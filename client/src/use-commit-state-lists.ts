/**
 * Saved and recovered rows of one artifact route, as separate server reads.
 *
 * Forensic rule 4: sidecar (WAL / rollback-journal) rows are a separate list
 * from committed rows, never sorted in. Every Finding route that accepts the
 * `commit-state` query parameter (history, cookies, credentials, top-sites,
 * favicons, metadata, downloads, bookmarks, autofill, topic-candidates) is
 * read three times — `committed`, `wal_resident`, `journal_resident` — each
 * its own keyset-paginated list on `usePaginatedList`. The two sidecar reads
 * are joined into one "recovered" list: WAL-resident rows first, then
 * journal-resident rows, each block in the server's own order, so the two
 * sidecars are never interleaved either.
 *
 * Routes without a `commit-state` filter (cache, timeline, site-*) cannot use
 * this hook; Cache splits its mixed page with `splitByCommit` (page-kit), and
 * the Timeline stays one chronological stream on purpose.
 */
import { useCallback, useEffect, useMemo } from "react";

import type { QueryParameters } from "./api.js";
import { withCommitState } from "./read-pages.js";
import { usePaginatedList } from "./use-paginated-list.js";

/** One keyset-paginated list (the shape `usePaginatedList` returns). */
export interface PaginatedList<Row> {
  readonly rows: readonly Row[];
  /** Non-null while the server has more rows. */
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

/** The joined sidecar list, plus its two underlying reads. */
export interface RecoveredList<Row> extends PaginatedList<Row> {
  readonly wal: PaginatedList<Row>;
  readonly journal: PaginatedList<Row>;
}

export interface CommitStateLists<Row> {
  /** `commit-state=committed`. */
  readonly saved: PaginatedList<Row>;
  /** `commit-state=wal_resident`, then `commit-state=journal_resident`. */
  readonly recovered: RecoveredList<Row>;
  /** Each list has read what figures over it may count: its first page,
   *  or with `drain` every page up to the cap. A failed read is not
   *  settled. */
  readonly settled: { readonly saved: boolean; readonly recovered: boolean };
}

/* ------------------------------ status model ------------------------------ */

/**
 * Where one list stands: its first read in flight (`first`), failed with
 * nothing loaded (`failed`), read and empty (`empty`), or holding rows.
 */
export type ListState = "first" | "failed" | "empty" | "rows";

export function listState(list: PaginatedList<unknown>): ListState {
  if (list.rows.length > 0) {
    return "rows";
  }
  if (list.error !== null) {
    return "failed";
  }
  return list.loading || list.cursor !== null ? "first" : "empty";
}

/** A list's tab count: unknown (null) until a page lands - and after a
 *  failed first read, which proves nothing about how many rows exist -
 *  else the `shown` rows (the lens's). */
export function tabCount(
  list: PaginatedList<unknown>,
  shown: number,
): number | null {
  const status = listState(list);
  return status === "first" || status === "failed" ? null : shown;
}

/** The one reading of a saved / recovered page's state (`CommitStatePage`
 *  draws it). */
export interface CommitStateStatus {
  /** Both lists read empty and nothing failed: the page's empty state
   *  (never while a read is in flight or failed - that is not an
   *  absence). */
  readonly pageEmpty: boolean;
  /** The figures over the saved rows: waiting for them (`loading`), on
   *  show, or stepped aside (`hide`: no saved row in the lens, or a failed
   *  saved read - the Saved tab carries the reason). */
  readonly figures: "loading" | "show" | "hide";
  /** The saved list stopped at its drain cap with rows unread: counts over
   *  it are floors ("+"). */
  readonly capped: boolean;
  /** `CommitStateSplit`'s counts and "+" markers. */
  readonly split: {
    readonly savedCount: number | null;
    readonly recoveredCount: number | null;
    readonly savedMore: boolean;
    readonly recoveredMore: boolean;
  };
}

/** The page's state from its two lists and the rows the lens leaves
 *  (`shown`: the figures' and tabs' base). */
export function commitStateStatus(
  lists: CommitStateLists<unknown>,
  shown: { readonly saved: number; readonly recovered: number },
): CommitStateStatus {
  const { saved, recovered, settled } = lists;
  const savedState = listState(saved);
  return {
    pageEmpty: savedState === "empty" && listState(recovered) === "empty",
    figures:
      saved.error === null && !settled.saved
        ? "loading"
        : saved.error === null && shown.saved > 0
          ? "show"
          : "hide",
    capped: settled.saved && saved.cursor !== null,
    split: {
      savedCount: tabCount(saved, shown.saved),
      recoveredCount: tabCount(recovered, shown.recovered),
      savedMore: saved.cursor !== null,
      recoveredMore: recovered.cursor !== null,
    },
  };
}

/**
 * The same reading for a page whose route cannot filter by Commit State
 * (Cache): one mixed read, drained whole and split on the client
 * (`splitByCommit`). Empty only once the whole read is in; figures wait
 * for its first page; counts are floors ("+") while it drains or stopped
 * at its cap.
 */
export function mixedReadStatus(
  read: {
    readonly loaded: number;
    readonly loading: boolean;
    readonly draining: boolean;
    readonly complete: boolean;
    readonly error: string | null;
  },
  shown: {
    readonly saved: number;
    readonly recovered: number;
    /** Saved rows before the lens narrows them. */
    readonly savedLoaded: number;
  },
): CommitStateStatus {
  // A page has landed without error: the counts are known.
  const settled = !read.loading && read.error === null;
  return {
    pageEmpty: settled && !read.draining && read.loaded === 0,
    figures: read.loading
      ? "loading"
      : read.error === null && shown.savedLoaded > 0
        ? "show"
        : "hide",
    capped: !read.draining && !read.complete,
    split: {
      savedCount: settled ? shown.saved : null,
      recoveredCount: settled ? shown.recovered : null,
      savedMore: settled && !read.complete,
      recoveredMore: settled && !read.complete,
    },
  };
}

/* ---------------------------------- reads --------------------------------- */

/**
 * With a cap, follow the list's cursor one page after another until it runs
 * out, the cap is reached, or a read fails (Retry resumes it). Returns
 * whether the list has settled with nothing more to follow.
 */
export function useDrain<Row>(
  list: PaginatedList<Row>,
  cap: number | null,
): boolean {
  const { loading, error, cursor, rows, loadMore } = list;
  const capped = cap !== null && rows.length >= cap;
  useEffect(() => {
    if (
      cap !== null &&
      !capped &&
      !loading &&
      error === null &&
      cursor !== null
    ) {
      loadMore();
    }
  }, [cap, capped, loading, error, cursor, loadMore]);
  return !loading && error === null && (cursor === null || capped);
}

export function useCommitStateLists<Row>(
  route: string,
  parameters: QueryParameters,
  options: {
    /** False skips every read (same as `usePaginatedList`'s `enabled`). */
    readonly enabled?: boolean;
    /** Read every page, up to this many rows per read (saved, WAL,
     *  journal), so figures describe the whole set rather than the first
     *  page. `settled` reports when each list has. */
    readonly drain?: number;
  } = {},
): CommitStateLists<Row> {
  const enabled = options.enabled ?? true;
  const cap = options.drain ?? null;
  // Keyed by value, like usePaginatedList: callers may pass a fresh array
  // on every render.
  const key = JSON.stringify(parameters);
  const savedParameters = useMemo(
    () => withCommitState(parameters, "committed"),
    [key],
  );
  const walParameters = useMemo(
    () => withCommitState(parameters, "wal_resident"),
    [key],
  );
  const journalParameters = useMemo(
    () => withCommitState(parameters, "journal_resident"),
    [key],
  );

  const saved = usePaginatedList<Row>(route, savedParameters, enabled);
  const wal = usePaginatedList<Row>(route, walParameters, enabled);
  const journal = usePaginatedList<Row>(route, journalParameters, enabled);
  const savedDrained = useDrain(saved, cap);
  const walDrained = useDrain(wal, cap);
  const journalDrained = useDrain(journal, cap);

  const recoveredRows = useMemo(
    () => [...wal.rows, ...journal.rows],
    [wal.rows, journal.rows],
  );
  const walLoadMore = wal.loadMore;
  const journalLoadMore = journal.loadMore;
  const walCursor = wal.cursor;
  const journalCursor = journal.cursor;
  // Drain the WAL list first, then the journal list, so loaded rows only
  // ever append inside their own block.
  const loadMoreRecovered = useCallback(() => {
    if (walCursor !== null) {
      walLoadMore();
    } else if (journalCursor !== null) {
      journalLoadMore();
    }
  }, [walCursor, journalCursor, walLoadMore, journalLoadMore]);
  // Each read's own `retry` re-reads only its failed page (a failed "Load
  // more" keeps the loaded rows), so the joined list retries just the
  // half that failed.
  const walError = wal.error;
  const journalError = journal.error;
  const walRetry = wal.retry;
  const journalRetry = journal.retry;
  const retryRecovered = useCallback(() => {
    if (walError !== null) {
      walRetry();
    }
    if (journalError !== null) {
      journalRetry();
    }
  }, [walError, journalError, walRetry, journalRetry]);

  return {
    saved,
    recovered: {
      rows: recoveredRows,
      cursor: wal.cursor ?? journal.cursor,
      loading: wal.loading || journal.loading,
      error: wal.error ?? journal.error,
      loadMore: loadMoreRecovered,
      retry: retryRecovered,
      wal,
      journal,
    },
    settled:
      cap === null
        ? {
            saved: listState(saved) !== "first",
            recovered:
              listState(wal) !== "first" && listState(journal) !== "first",
          }
        : { saved: savedDrained, recovered: walDrained && journalDrained },
  };
}
