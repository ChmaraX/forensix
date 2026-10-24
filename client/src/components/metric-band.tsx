/**
 * MetricBand — a strip of recorded figures in one framed surface.
 *
 * Built from FF parts: the band is an `Elevated` surface (a Panel's level by
 * default; `variant="accent"` floats it two steps up with the popup shadow,
 * so a band docked over a chart's bottom edge reads as lifted, not as a
 * second panel). Items are separated by hairlines that each item draws on
 * its own top/left edge; the band clips the ones on its outer edge, so the
 * rules stay right whatever `grid-cols-*` the caller wraps the items into.
 *
 * Text follows FF's roles: a caption label (no eyebrow caps), the figure in
 * the display role's compact step (24px, a clear step above the 16px title
 * and below the 28px page title) at semibold with tabular digits, and
 * caption detail. The
 * optional progress bar fills by sliding a pill (transform) on
 * `spring.moderate`.
 *
 * API is unchanged: `className` still takes the grid columns
 * (`grid-cols-2 sm:grid-cols-4`), and the inner grid inherits them.
 * `tone` colours the progress fill (unless `progress.tone` overrides it)
 * and, beside the item's `status` word, a state dot. A tone never shows
 * without a word: with no `status` and no `progress`, `tone` draws nothing.
 * So a tinted tile is `tone="warning" status="recovered"` — the dot repeats
 * the word, it never replaces it.
 *
 * Below `sm` (a phone) an item's label, status word and detail wrap instead
 * of truncating, and the status drops under the label when both don't fit.
 *
 * A figure that is not (yet) a number: `figure(read, show)` renders a
 * `PendingFigure` skeleton while its read is in flight and an
 * `UnavailableFigure` ("unavailable" with its dot) when it failed — never a
 * "0" or a dash standing in for a fact.
 *
 * Forensic rule: tiles show recorded facts only — never a Candidate value.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { EvidenceDot } from "@/components/evidence";
import { Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

type MetricBandTone =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "violet";

interface MetricBandProgress {
  readonly value: number;
  readonly max: number;
  readonly tone?: MetricBandTone;
  readonly label?: ReactNode;
}

export function MetricBand({
  children,
  className,
  variant = "default",
}: {
  readonly children: ReactNode;
  /** Grid columns (e.g. `grid-cols-2 sm:grid-cols-4`) and placement. */
  readonly className?: string;
  /** `accent` lifts the band above its neighbours (docked over a chart). */
  readonly variant?: "default" | "accent";
}) {
  const shape = useShape();
  const accent = variant === "accent";
  return (
    <Elevated
      offset={accent ? 2 : 1}
      shadowLevel={accent ? 3 : undefined}
      className={cn(
        "block min-w-0 text-foreground",
        shape.container,
        className,
      )}
    >
      {/* The caller's grid-cols-* land on the outer box; this grid inherits
          them, and its clip trims the hairlines on the band's outer edge. */}
      <div className="grid [grid-template-columns:inherit] overflow-hidden">
        {children}
      </div>
    </Elevated>
  );
}

const PROGRESS_TONE: Record<MetricBandTone, string> = {
  neutral: "bg-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  violet: "bg-violet",
};

export function MetricBandItem({
  label,
  value,
  detail,
  icon,
  status,
  progress,
  tone = "neutral",
  valueClassName,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly icon?: ReactNode;
  /** A short state word at the item's top right (e.g. "recovered"). */
  readonly status?: ReactNode;
  readonly progress?: MetricBandProgress;
  /** Hue of the progress fill and of the dot beside `status`; never shown
   *  on its own (see the module note). */
  readonly tone?: MetricBandTone;
  /** Extra classes for the figure. Prefer none: the title role is the
   *  band's one figure size. */
  readonly valueClassName?: string;
}) {
  const size = useSize();
  const fraction =
    progress === undefined || progress.max <= 0
      ? 0
      : Math.min(1, Math.max(0, progress.value / progress.max));

  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3 shadow-[-1px_0_0_0_var(--border),0_-1px_0_0_var(--border)] sm:px-5 sm:py-3.5">
      <div className="flex min-w-0 items-center justify-between gap-x-3 max-sm:flex-wrap">
        {/* `metric-label`: a label that explains itself (a `Term`) gets a
            25px hit area (app.css); the truncating box is padded 8px up
            and 2px down (and pulled back by as much) so it does not clip
            that area. */}
        <span
          className={cn(
            size.type.caption,
            "metric-label flex min-w-0 items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
          )}
        >
          {icon}
          <span className="-mt-[8px] -mb-[2px] truncate pt-[8px] pb-[2px] max-sm:whitespace-normal">
            {label}
          </span>
        </span>
        {status === undefined ? null : (
          <span
            className={cn(
              size.type.caption,
              "inline-flex shrink-0 items-center gap-1.5 text-muted-foreground",
            )}
          >
            {tone === "neutral" ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-1.5 shrink-0 rounded-full",
                  PROGRESS_TONE[tone],
                )}
              />
            )}
            {status}
          </span>
        )}
      </div>
      <span
        className={cn(
          FIGURE_TYPE,
          // A figure never truncates: a long value (a Chrome build such as
          // 123.0.6312.122 on a phone) wraps, breaking anywhere if it must.
          "block min-w-0 text-foreground tabular-nums [overflow-wrap:anywhere]",
          valueClassName,
        )}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {value}
      </span>
      {progress === undefined ? null : (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-hover"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.max}
            aria-valuenow={Math.min(progress.max, Math.max(0, progress.value))}
          >
            {/* A full-width pill slid in from the left (never scaled, which
                would squash its rounded end); the track clips it. */}
            <motion.span
              className={cn(
                "block h-full w-full rounded-full",
                PROGRESS_TONE[progress.tone ?? tone],
              )}
              initial={{ x: "-100%" }}
              animate={{ x: `${String((fraction - 1) * 100)}%` }}
              transition={spring.moderate}
            />
          </div>
          {progress.label === undefined ? null : (
            <span
              className={cn(
                size.type.caption,
                "truncate text-muted-foreground",
              )}
            >
              {progress.label}
            </span>
          )}
        </div>
      )}
      {detail === undefined ? null : (
        <span
          className={cn(
            size.type.caption,
            "truncate text-muted-foreground max-sm:whitespace-normal",
          )}
          title={typeof detail === "string" ? detail : undefined}
        >
          {detail}
        </span>
      )}
    </div>
  );
}

/** The figure's type: the display role's compact step (24px / 30px), the
 *  same everywhere a figure strip sits, whatever the surrounding size. */
const FIGURE_TYPE = typeClass("display", "compact");

/**
 * A figure with its exact reading in a tooltip ("12 of 40 saved cookies
 * marked Secure"), so the tile stays label + value. The tooltip opens on
 * hover and on keyboard focus: the figure is its own tab stop with the FF
 * focus ring.
 */
export function TooltipFigure({
  value,
  detail,
}: {
  readonly value: ReactNode;
  readonly detail: ReactNode;
}) {
  return (
    <Tooltip content={detail}>
      <span
        tabIndex={0}
        className="cursor-help rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
      >
        {value}
      </span>
    </Tooltip>
  );
}

/** A figure whose read failed: the state word with its dot, never a zero. */
export function UnavailableFigure() {
  return (
    <span
      className={cn(
        typeClass("body"),
        "inline-flex items-center gap-1.5 text-foreground",
      )}
    >
      <EvidenceDot state="unavailable" />
      unavailable
    </span>
  );
}

/** A figure still being read: a skeleton the height of the figure line. */
export function PendingFigure() {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="flex h-[30px] items-center"
    >
      <Skeleton className="h-5 w-16" />
    </span>
  );
}

/** One read behind a figure. */
export type Read<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

/** The figure for a read: pending, unavailable, or `show(value)`. */
export function figure<T>(
  read: Read<T>,
  show: (value: T) => ReactNode,
): ReactNode {
  if (read.state === "loading") {
    return <PendingFigure />;
  }
  if (read.state === "failed") {
    return <UnavailableFigure />;
  }
  return show(read.value);
}
