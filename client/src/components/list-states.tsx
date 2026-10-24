/**
 * Shared list chrome: loading rows, a load failure, the "N rows shown / Load
 * more" footer, and the framed list section. Moved out of app.tsx and drawn
 * with FF parts: Skeleton rows on the 36px row ladder, an error Banner with a
 * Retry action, the FF Button, and a Panel.
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
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

/** Five placeholder rows, each the height of a default table row. */
export function LoadingRows({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-2 px-4 py-4", className)}
      role="status"
      aria-label="Loading rows"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton key={index} className="h-7 w-full" />
      ))}
    </div>
  );
}

/** A failed read: what failed, the server's message, and Retry. */
export function ErrorRows({
  message,
  onRetry,
  className,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly className?: string;
}) {
  return (
    <div className={cn("px-4 py-4", className)}>
      <Banner status="error" contrast="high">
        <BannerTitle>The rows could not be loaded.</BannerTitle>
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
}: {
  readonly count: number;
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
}) {
  if (count === 0 && cursor === null) {
    return null;
  }
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
      <p
        className={cn(
          typeClass("caption"),
          "text-muted-foreground tabular-nums",
        )}
        aria-live="polite"
      >
        {count} row{count === 1 ? "" : "s"} shown
        {cursor === null ? "" : " · more available"}
      </p>
      {cursor !== null ? (
        <Button
          variant="tertiary"
          size="compact"
          onClick={onLoadMore}
          loading={loading}
          disabled={loading}
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
  children,
}: {
  readonly title: ReactNode;
  readonly titleExtra?: ReactNode;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <Panel className="overflow-clip">
      <header className="flex min-h-12 flex-wrap items-center gap-2.5 border-b border-border px-4 py-2">
        <h2
          className={cn(typeClass("subtitle"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </h2>
        <span
          className={cn(
            typeClass("caption"),
            "text-muted-foreground tabular-nums",
          )}
        >
          {count}
        </span>
        {titleExtra}
      </header>
      {children}
    </Panel>
  );
}
