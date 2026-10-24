/**
 * Shared list chrome, drawn with FF parts: loading rows on the table row
 * ladder (Skeleton bars inside 36px / 28px rows, handed in one by one with
 * `reveal-items`), a load failure as an error Banner with Retry, the
 * "3 of 22" / Load more footer (only while paged or filtered), a filtered-empty state with "Clear
 * filters", `RevealSwap` (a `reveal-swap` that lets go of its skeleton) and
 * `ListBlock` — the whole body of one paginated list (saved or recovered).
 *
 * Status for assistive tech: every list keeps one polite region mounted
 * (`ListStatus`) and writes into it what a sighted reader sees change —
 * "Loading cookies", "22 saved cookies", "3 of 22 saved cookies", "No
 * loaded saved cookies match these filters." — so a filter result is heard
 * without moving focus. A standalone `LoadingRows` carries its words as
 * visually hidden text inside its `role="status"`.
 */
import {
  useEffect,
  useState,
  type AnimationEvent,
  type ReactNode,
} from "react";

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
 * `role="status"` region that says `label` (visually hidden text, so every
 * screen reader reads it; the bars themselves are hidden from AT). Inside a
 * list that already has a `ListStatus` pass `announce={false}`: the
 * skeleton is then silent.
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
  announce = true,
}: {
  readonly className?: string;
  /** How many placeholder rows. @default 5 */
  readonly rows?: number;
  /** What the status region says. @default "Loading rows" */
  readonly label?: string;
  /** Be a live status region. False inside a list whose `ListStatus`
   *  already says it. @default true */
  readonly announce?: boolean;
}) {
  const size = useSize();
  const cellInset = size.variant === "compact" ? "px-2.5" : "px-3";
  return (
    <div
      className={cn("reveal-items flex flex-col px-1 py-1", className)}
      role={announce ? "status" : undefined}
    >
      {announce ? <span className="sr-only">{label}</span> : null}
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
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

/**
 * The list's footer, drawn only when it has something to say: the list is
 * paged (the server has more — "50 of 50+" and Load more) or a client-side
 * filter hides loaded rows ("3 of 22"). A complete, unfiltered list has no
 * footer: its count is already on the Saved / Recovered tab.
 */
export function ListFooter({
  shown,
  total,
  more,
  loading = false,
  onLoadMore,
  className,
}: {
  /** Rows on show (after any client-side filter). */
  readonly shown: number;
  /** Rows loaded in this list. */
  readonly total: number;
  /** The server has more rows (a cursor stands); "+" follows the total. */
  readonly more: boolean;
  readonly loading?: boolean;
  /** Reads the next page; with it, a paged footer offers "Load more". */
  readonly onLoadMore?: () => void;
  readonly className?: string;
}) {
  const size = useSize();
  if (!more && shown >= total) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 border-t border-border px-4 py-2",
        className,
      )}
    >
      {/* Announced by the list's `ListStatus`, not here: a region that
          mounts with its text is not reliably read. */}
      <p
        className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
      >
        {`${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}${more ? "+" : ""}`}
      </p>
      {more && onLoadMore !== undefined ? (
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

/**
 * A list's polite status region: always mounted, visually hidden, saying
 * `message`. The words land a moment after they change (250ms), so a
 * region that mounts with its first message still announces it, and typing
 * a filter is read once it settles rather than per keystroke.
 *
 *   <ListStatus message={listStatusMessage({ … })} />
 */
export function ListStatus({ message }: { readonly message: string }) {
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSpoken(message);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [message]);
  return (
    <p role="status" className="sr-only">
      {spoken}
    </p>
  );
}

/** The words `ListStatus` says for a list's state. */
export function listStatusMessage({
  noun,
  loading,
  failed,
  shown,
  total,
  more,
  filtered,
  filteredMessage,
  loadingLabel,
}: {
  readonly noun: ListNoun;
  /** The first read is in flight (no rows yet). */
  readonly loading: boolean;
  /** Words while loading. @default "Loading <many>" */
  readonly loadingLabel?: string;
  /** The first read failed (its error banner speaks for itself). */
  readonly failed: boolean;
  /** Rows on show after any filter. */
  readonly shown: number;
  /** Rows loaded. */
  readonly total: number;
  /** The server has more rows. */
  readonly more: boolean;
  /** A filter narrows the list. */
  readonly filtered: boolean;
  /** Words for a filtered list with nothing to show, when they are text. */
  readonly filteredMessage?: string;
}): string {
  if (loading) {
    return loadingLabel ?? `Loading ${noun.many}`;
  }
  if (failed) {
    return "";
  }
  const plus = more ? "+" : "";
  const word = (count: number) => (count === 1 && !more ? noun.one : noun.many);
  if (filtered && shown === 0) {
    return filteredMessage ?? `No loaded ${noun.many} match these filters.`;
  }
  if (filtered) {
    return `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}${plus} ${word(total)}`;
  }
  return `${total.toLocaleString("en-US")}${plus} ${word(total)}`;
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
export interface ListNoun {
  readonly one: string;
  readonly many: string;
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
 *  - `ListFooter` closes the list only while it is paged or filtered
 *    ("3 of 12", "50 of 50+" with Load more).
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
  total,
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
  /** Rows this list holds before its client-side filter, when the list is
   *  one part of a larger loaded source (the Timeline's saved or recovered
   *  half of one stream). @default list.rows.length */
  readonly total?: number;
  /** The table, rendered only when at least one row is shown. */
  readonly children: ReactNode;
}) {
  const loaded = list.rows.length;
  const visible = shown ?? loaded;
  const narrowed = filtered ?? visible !== loaded;
  const firstRead = list.loading && loaded === 0;
  const more = list.error === null && list.cursor !== null;
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
      <ListStatus
        message={listStatusMessage({
          noun,
          loading: firstRead,
          failed: false,
          shown: visible,
          total: total ?? loaded,
          more,
          filtered: narrowed,
          filteredMessage:
            typeof filteredMessage === "string" ? filteredMessage : undefined,
          loadingLabel,
        })}
      />
      <RevealSwap
        loading={firstRead}
        skeleton={
          <LoadingRows
            rows={skeletonRows}
            label={loadingLabel ?? `Loading ${noun.many}`}
            announce={false}
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
      {visible === 0 && !more ? null : (
        <ListFooter
          shown={visible}
          total={total ?? loaded}
          more={more}
          loading={list.loading}
          onLoadMore={list.loadMore}
        />
      )}
    </>
  );
}
