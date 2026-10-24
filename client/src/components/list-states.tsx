/**
 * Shared list chrome, drawn with FF parts: loading rows on the table row
 * ladder (Skeleton bars inside 36px / 28px rows, handed in one by one with
 * `reveal-items`), a load failure as an error Banner with Retry, the
 * "N rows shown / Load more" footer, a filtered-empty state with "Clear
 * filters", `RevealSwap` (a `reveal-swap` that lets go of its skeleton) and
 * `ListBlock` — the whole body of one paginated list (saved or recovered).
 */
import { useState, type AnimationEvent, type ReactNode } from "react";

import {
  Banner,
  BannerAction,
  BannerActions,
  BannerDescription,
  BannerTitle,
} from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { PaginatedList } from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import { plural } from "./page-kit.js";

/** Bar widths for placeholder cells, so the rows don't read as a grid. */
const LEAD_WIDTHS = ["w-20", "w-16", "w-24", "w-14", "w-20", "w-16"] as const;
const BODY_WIDTHS = [
  "max-w-[62%]",
  "max-w-[48%]",
  "max-w-[70%]",
  "max-w-[40%]",
  "max-w-[56%]",
  "max-w-[66%]",
] as const;

/**
 * Placeholder rows the size of the real table: the same `px-1 py-1` scroller
 * inset as an evidence table, each row the height of a table row at the
 * surrounding ladder step (36px default, 28px compact) with the cell's own
 * horizontal padding, separated by the table's hairline. A live
 * `role="status"` region named by `label`.
 *
 * Use it as the first child of a `reveal-swap`, with the real table added
 * after it once rows land:
 *
 *   <div className="reveal-swap">
 *     <LoadingRows label="Loading visits" />
 *     {loaded ? <VisitTable … /> : null}
 *   </div>
 */
export function LoadingRows({
  className,
  rows = 5,
  label = "Loading rows",
}: {
  readonly className?: string;
  /** How many placeholder rows. @default 5 */
  readonly rows?: number;
  /** Accessible name of the status region. @default "Loading rows" */
  readonly label?: string;
}) {
  const size = useSize();
  const cellInset = size.variant === "compact" ? "px-2.5" : "px-3";
  return (
    <div
      className={cn("reveal-items flex flex-col px-1 py-1", className)}
      role="status"
      aria-label={label}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-center gap-6 border-b border-border last:border-b-0",
            size.control,
            cellInset,
          )}
        >
          <Skeleton
            className={cn(
              "h-3 shrink-0",
              LEAD_WIDTHS[index % LEAD_WIDTHS.length],
            )}
          />
          <Skeleton
            className={cn(
              "h-3 flex-1",
              BODY_WIDTHS[index % BODY_WIDTHS.length],
            )}
          />
        </div>
      ))}
    </div>
  );
}

/** A failed read: what failed, the server's message, and Retry. */
export function ErrorRows({
  message,
  onRetry,
  className,
  title = "The rows could not be loaded.",
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly className?: string;
  /** The Banner's title. @default "The rows could not be loaded." */
  readonly title?: ReactNode;
}) {
  return (
    <div className={cn("px-4 py-4", className)}>
      <Banner status="error" contrast="high">
        <BannerTitle>{title}</BannerTitle>
        <BannerDescription>{message}</BannerDescription>
        <BannerActions>
          <BannerAction variant="secondary" onClick={onRetry}>
            Retry
          </BannerAction>
        </BannerActions>
      </Banner>
    </div>
  );
}

export function ListFooter({
  count,
  cursor,
  loading,
  onLoadMore,
  summary,
  className,
}: {
  readonly count: number;
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
  /** Replaces the default "N rows shown" words (e.g. "12 of 40 loaded rows
   *  shown"); " · more available" is still appended while a cursor stands. */
  readonly summary?: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  if (count === 0 && cursor === null) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 border-t border-border px-4 py-2",
        className,
      )}
    >
      <p
        className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
        aria-live="polite"
      >
        {summary ?? `${plural(count, "row", "rows")} shown`}
        {cursor === null ? "" : " · more available"}
      </p>
      {cursor !== null ? (
        <Button
          variant="tertiary"
          size="compact"
          onClick={onLoadMore}
          loading={loading}
          disabled={loading}
          className="ml-auto"
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

/** A filtered list with nothing left to show: the reason and a tertiary
 *  "Clear filters" that drops every filter. */
function FilteredEmptyRows({
  message,
  onClear,
}: {
  readonly message: ReactNode;
  readonly onClear: () => void;
}) {
  return (
    <EmptyRows
      message={message}
      action={
        <Button variant="tertiary" size="compact" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

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
  className,
}: {
  readonly loading: boolean;
  readonly skeleton: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
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
    <div className={cn("reveal-swap", className)}>
      {settled && !loading ? null : (
        <div onAnimationEnd={onAnimationEnd}>{skeleton}</div>
      )}
      {loading ? null : children}
    </div>
  );
}

/** The parts of a paginated list `ListBlock` reads. `retry` must re-read
 *  only what failed (every `usePaginatedList` / `useCommitStateLists` list
 *  does). */
export type ListSource = Pick<
  PaginatedList<unknown>,
  "rows" | "cursor" | "loading" | "error" | "loadMore" | "retry"
>;

/** A list's noun, singular and plural, e.g. `{ one: "saved login", many:
 *  "saved logins" }`. */
interface ListNoun {
  readonly one: string;
  readonly many: string;
}

function countOf(count: number, noun: ListNoun): string {
  return plural(count, noun.one, noun.many);
}

/**
 * The body of one paginated list (saved or recovered), shared by every
 * evidence page:
 *  - the first read swaps a `LoadingRows` skeleton for the rows
 *    (`RevealSwap`);
 *  - a failed first read is an `ErrorRows` with Retry;
 *  - an empty result is `empty`, or — while a filter hides every loaded
 *    row — a `FilteredEmptyRows` with "Clear filters";
 *  - a failed "Load more" is an `ErrorRows` under the rows whose Retry asks
 *    for that page again (the loaded rows stay; a recovered list retries
 *    only its failed half);
 *  - `ListFooter` closes the list ("12 saved logins shown", or "3 of 12
 *    loaded saved logins shown" while filtered).
 *
 * The page's table goes in `children`, given the rows left after its own
 * filter; `shown` is their count.
 */
export function ListBlock({
  list,
  noun,
  shown,
  filtered,
  filteredMessage,
  onClearFilters,
  empty,
  skeletonRows = 6,
  loadingLabel,
  errorTitle,
  summary,
  children,
}: {
  readonly list: ListSource;
  readonly noun: ListNoun;
  /** Rows left after any client-side filter. @default list.rows.length */
  readonly shown?: number;
  /** A filter is narrowing the list (client- or server-side).
   *  @default shown !== list.rows.length */
  readonly filtered?: boolean;
  /** Words for a filtered list with nothing to show.
   *  @default "No loaded <many> match these filters." */
  readonly filteredMessage?: ReactNode;
  /** Drops every filter; with it, a filtered empty list offers "Clear
   *  filters". */
  readonly onClearFilters?: () => void;
  /** The list landed with no rows at all (usually an `EmptyRows`). */
  readonly empty: ReactNode;
  readonly skeletonRows?: number;
  /** @default "Loading <many>" */
  readonly loadingLabel?: string;
  /** Title of a failed first read. @default "The <many> could not be loaded." */
  readonly errorTitle?: string;
  /** Footer words in place of the default count. */
  readonly summary?: ReactNode;
  /** The table, rendered only when at least one row is shown. */
  readonly children: ReactNode;
}) {
  const loaded = list.rows.length;
  const visible = shown ?? loaded;
  const narrowed = filtered ?? visible !== loaded;
  const firstRead = list.loading && loaded === 0;
  if (list.error !== null && loaded === 0) {
    return (
      <ErrorRows
        title={errorTitle ?? `The ${noun.many} could not be loaded.`}
        message={list.error}
        onRetry={list.retry}
      />
    );
  }
  const emptyBlock =
    narrowed && onClearFilters !== undefined ? (
      <FilteredEmptyRows
        message={
          filteredMessage ?? `No loaded ${noun.many} match these filters.`
        }
        onClear={onClearFilters}
      />
    ) : (
      empty
    );
  return (
    <>
      <RevealSwap
        loading={firstRead}
        skeleton={
          <LoadingRows
            rows={skeletonRows}
            label={loadingLabel ?? `Loading ${noun.many}`}
          />
        }
      >
        {visible === 0 ? <div>{emptyBlock}</div> : children}
      </RevealSwap>
      {list.error === null ? null : (
        <ErrorRows
          title={`More ${noun.many} could not be loaded.`}
          message={list.error}
          onRetry={list.retry}
          className="border-t border-border"
        />
      )}
      <ListFooter
        count={loaded}
        cursor={list.error === null ? list.cursor : null}
        loading={list.loading}
        onLoadMore={list.loadMore}
        summary={
          summary ??
          (visible === loaded
            ? `${countOf(loaded, noun)} shown`
            : `${visible.toLocaleString("en-US")} of ${countOf(loaded, { one: `loaded ${noun.one}`, many: `loaded ${noun.many}` })} shown`)
        }
      />
    </>
  );
}
