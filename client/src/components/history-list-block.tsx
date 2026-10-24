/**
 * The body of one paginated evidence list, shared by History, Top sites and
 * Timeline: the first read swaps a `LoadingRows` skeleton for the rows
 * (`RevealSwap`, a `reveal-swap`), a failed first read is an `ErrorRows` with Retry, an
 * empty result is the page's own `EmptyRows`, a failed "Load more" is an
 * `ErrorRows` under the rows that retries only the failed page, and the
 * `ListFooter` closes the list.
 *
 * Page-local for now (prefixed for the History page that introduced it);
 * the same chrome belongs in `list-states.tsx` once it is shared.
 */
import { useState, type AnimationEvent, type ReactNode } from "react";

import type {
  PaginatedList,
  RecoveredList,
} from "../use-commit-state-lists.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";

/**
 * `reveal-swap` that lets go of its skeleton: while `loading`, only the
 * skeleton shows; when the block lands it is added after the skeleton, the
 * two cross-fade (app.css), and once the skeleton's fade-out ends it is
 * dropped, so a block shorter than its placeholder (a filtered or tiny
 * list) is not held at the placeholder's height. A new load brings the
 * skeleton back.
 */
export function RevealSwap({
  loading,
  skeleton,
  children,
}: {
  readonly loading: boolean;
  readonly skeleton: ReactNode;
  readonly children: ReactNode;
}) {
  const [settled, setSettled] = useState(false);
  if (loading && settled) {
    setSettled(false);
  }
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      event.animationName === "reveal-out"
    ) {
      setSettled(true);
    }
  };
  return (
    <div className="reveal-swap">
      {settled && !loading ? null : (
        <div onAnimationEnd={onAnimationEnd}>{skeleton}</div>
      )}
      {loading ? null : children}
    </div>
  );
}

/** The parts of a paginated list the block reads. */
export type ListSource = Pick<
  PaginatedList<unknown>,
  "rows" | "cursor" | "loading" | "error" | "loadMore" | "retry"
> & {
  readonly wal?: RecoveredList<unknown>["wal"];
  readonly journal?: RecoveredList<unknown>["journal"];
};

/**
 * Retry only what failed. A failed "Load more" keeps its cursor, so asking
 * for the same page again keeps every row already shown; a failed first
 * read starts that read over. The joined recovered list retries each of its
 * two reads on its own.
 */
export function retryFailed(list: ListSource): () => void {
  return () => {
    const parts =
      list.wal !== undefined && list.journal !== undefined
        ? [list.wal, list.journal]
        : [list];
    for (const part of parts) {
      if (part.error === null) {
        continue;
      }
      if (part.rows.length > 0 && part.cursor !== null) {
        part.loadMore();
      } else {
        part.retry();
      }
    }
  };
}

export function ListBlock({
  list,
  loadingLabel,
  skeletonRows = 6,
  errorTitle,
  empty,
  children,
  shown,
  summary,
}: {
  readonly list: ListSource;
  /** Accessible name of the loading status. */
  readonly loadingLabel: string;
  readonly skeletonRows?: number;
  /** Title of a failed first read. */
  readonly errorTitle?: string;
  /** Rendered when the read landed with nothing to show. */
  readonly empty: ReactNode;
  /** The table, given only when there is at least one row to show. */
  readonly children: ReactNode;
  /** Rows to show after any client-side filter. @default list.rows.length */
  readonly shown?: number;
  /** Footer words in place of "N rows shown". */
  readonly summary?: ReactNode;
}) {
  const firstRead = list.loading && list.rows.length === 0;
  const visible = shown ?? list.rows.length;
  if (list.error !== null && list.rows.length === 0) {
    return (
      <ErrorRows
        title={errorTitle}
        message={list.error}
        onRetry={retryFailed(list)}
      />
    );
  }
  return (
    <>
      <RevealSwap
        loading={firstRead}
        skeleton={<LoadingRows rows={skeletonRows} label={loadingLabel} />}
      >
        {visible === 0 ? <div>{empty}</div> : children}
      </RevealSwap>
      {list.error === null ? null : (
        <ErrorRows
          title="Some rows could not be loaded."
          message={list.error}
          onRetry={retryFailed(list)}
          className="border-t border-border"
        />
      )}
      <ListFooter
        count={list.rows.length}
        cursor={list.error === null ? list.cursor : null}
        loading={list.loading}
        onLoadMore={list.loadMore}
        summary={summary}
      />
    </>
  );
}
