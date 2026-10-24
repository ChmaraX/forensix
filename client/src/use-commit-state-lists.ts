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
import type { CommitState } from "./types.js";
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

interface CommitStateLists<Row> {
  /** `commit-state=committed`. */
  readonly saved: PaginatedList<Row>;
  /** `commit-state=wal_resident`, then `commit-state=journal_resident`. */
  readonly recovered: RecoveredList<Row>;
  /** Each list has settled with no page left to read (or, with `drain`, at
   *  its cap). A failed read is not drained. */
  readonly drained: { readonly saved: boolean; readonly recovered: boolean };
}

/**
 * With a cap, follow the list's cursor one page after another until it runs
 * out, the cap is reached, or a read fails (Retry resumes it). Returns
 * whether the list has settled with nothing more to follow.
 */
function useDrain<Row>(list: PaginatedList<Row>, cap: number | null): boolean {
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

function withCommitState(
  parameters: QueryParameters,
  state: CommitState,
): QueryParameters {
  return [
    ...parameters.filter(([name]) => name !== "commit-state"),
    ["commit-state", state],
  ];
}

export function useCommitStateLists<Row>(
  route: string,
  parameters: QueryParameters,
  options: {
    /** False skips every read (same as `usePaginatedList`'s `enabled`). */
    readonly enabled?: boolean;
    /** Read every page, up to this many rows per read (saved, WAL,
     *  journal), so figures describe the whole set rather than the first
     *  page. `drained` reports when each list has settled. */
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
    drained: { saved: savedDrained, recovered: walDrained && journalDrained },
  };
}
