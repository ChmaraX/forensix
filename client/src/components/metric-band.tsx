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
 * the title role at semibold with tabular digits, and caption detail. The
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
 * Forensic rule: tiles show recorded facts only — never a Candidate value.
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

export type MetricBandTone =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "violet";

export interface MetricBandProgress {
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
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span
          className={cn(
            size.type.caption,
            "flex min-w-0 items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
          )}
        >
          {icon}
          <span className="truncate">{label}</span>
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
          size.type.title,
          "block truncate text-foreground tabular-nums",
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
          className={cn(size.type.caption, "truncate text-muted-foreground")}
          title={typeof detail === "string" ? detail : undefined}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
