/**
 * Shared list chrome, drawn with FF parts: loading rows on the table row
 * ladder (Skeleton bars inside 36px / 28px rows, handed in one by one with
 * `reveal-items`), a load failure as an error Banner with Retry, the
 * "N rows shown / Load more" footer, and the framed list section (a Panel).
 */
import type { ReactNode } from "react";

import { Panel } from "@/components/panel";
import {
  Banner,
  BannerAction,
  BannerActions,
  BannerDescription,
  BannerTitle,
} from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

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
 * Placeholder rows, each the height of a table row at the surrounding ladder
 * step (36px default, 28px compact), separated by the table's hairline.
 */
export function LoadingRows({
  className,
  rows = 5,
}: {
  readonly className?: string;
  /** How many placeholder rows. @default 5 */
  readonly rows?: number;
}) {
  const size = useSize();
  return (
    <div
      className={cn("reveal-items flex flex-col px-4 py-1", className)}
      role="status"
      aria-label="Loading rows"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-center gap-6 border-b border-border last:border-b-0",
            size.control,
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
        {summary ?? (
          <>
            {count} row{count === 1 ? "" : "s"} shown
          </>
        )}
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

/** A framed list: title, row count, optional trailing control, rows. */
export function ListCard({
  title,
  titleExtra,
  count,
  description,
  className,
  children,
}: {
  readonly title: ReactNode;
  readonly titleExtra?: ReactNode;
  readonly count: number;
  /** Optional one-line caption under the title. */
  readonly description?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const size = useSize();
  return (
    <Panel className={cn("overflow-clip", className)}>
      <header className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-baseline gap-2">
            <h2
              className={cn(size.type.subtitle, "text-foreground")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {title}
            </h2>
            <span
              className={cn(
                size.type.caption,
                "text-muted-foreground tabular-nums",
              )}
            >
              {count}
            </span>
          </div>
          {description === undefined ? null : (
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              {description}
            </p>
          )}
        </div>
        {titleExtra}
      </header>
      {children}
    </Panel>
  );
}
