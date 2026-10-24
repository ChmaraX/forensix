/**
 * Presentation parts shared by the Cache, Favicons, Browser profile and Sites
 * pages, built from Fluid Functionalism pieces. They hold no data logic: each
 * page reads and filters its own rows and hands these parts plain values.
 *
 *  - `SectionHeading` — a section title (title role, semibold) with its row
 *    count and an optional description, controls trailing on the right.
 *  - `Toolbar` — a compact filter bar on the 28px ladder, spaced like the
 *    shared FilterBar; pages fill it with the shared `FilterTextField`,
 *    `FilterField` and `ProfilePicker` from filters.tsx.
 *  - `MeterList` — a ranked horizontal bar list (a distribution read at a
 *    glance). Each bar slides in on `spring.slow`, transform only, so reduced
 *    motion drops the travel. Bars carry the chart series colour, and the
 *    leading bar alone is held at full strength, like the bar charts.
 *  - `TimeText`, `formatBytes`, `IconTile`, `splitByCommit`.
 *
 * Forensic rules kept here: a missing time is the word "absent"; sidecar
 * (WAL / rollback-journal) rows are split off from saved rows by
 * `splitByCommit`, so a page lists them separately and never sorts them in.
 */
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import type { Finding } from "../types.js";
import type { ChartTokens } from "./charts.js";
import { AbsentWord, formatInstant } from "./finding-fields.js";

/* -------------------------------- formatting ------------------------------- */

/** A short, human byte size ("1.4 MB", "812 B"). Presentation only: the exact
 *  byte count stays reachable in the row detail sheet. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit] ?? "KB"}`;
}

/** Saved rows and sidecar (WAL / rollback-journal) rows, kept apart. */
export function splitByCommit<Row extends Pick<Finding, "commitState">>(
  rows: readonly Row[],
): { readonly saved: readonly Row[]; readonly recovered: readonly Row[] } {
  const saved: Row[] = [];
  const recovered: Row[] = [];
  for (const row of rows) {
    if (row.commitState === "committed") {
      saved.push(row);
    } else {
      recovered.push(row);
    }
  }
  return { saved, recovered };
}

/* ---------------------------------- text ----------------------------------- */

/** "9 Dec 2024 14:32:07" (UTC) on one line, or the word "absent". The date
 *  takes the cell's colour (so a lit table row lifts it); the time stays
 *  muted. */
export function TimeText({ utc }: { readonly utc: string | null }) {
  const size = useSize();
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className={cn(size.type.body, "whitespace-nowrap tabular-nums")}
      title={`${utc} (UTC)`}
    >
      {parts.date}
      <span className="ml-2 text-muted-foreground">{parts.time}</span>
    </span>
  );
}

/** A row count beside a title: caption, muted, tabular. */
export function Count({ children }: { readonly children: ReactNode }) {
  return (
    <span
      className={cn(typeClass("caption"), "text-muted-foreground tabular-nums")}
    >
      {children}
    </span>
  );
}

/**
 * A section title above a block of panels: the title role in semibold, its
 * count beside it, an optional muted description below, and controls (a
 * toolbar) trailing on the right, wrapping under on narrow screens.
 */
export function SectionHeading({
  title,
  count,
  description,
  icon: Icon,
  children,
  className,
}: {
  readonly title: ReactNode;
  readonly count?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: LucideIcon;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {Icon === undefined ? null : (
            <Icon
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
            />
          )}
          <h2
            className={cn(typeClass("title"), "text-foreground")}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {title}
          </h2>
          {count === undefined ? null : <Count>{count}</Count>}
        </div>
        {description === undefined ? null : (
          <div className={cn(typeClass("body"), "text-muted-foreground")}>
            {description}
          </div>
        )}
      </div>
      {children === undefined ? null : children}
    </div>
  );
}

/** A 32px tinted tile holding one muted icon (FF's CardMedia treatment). */
export function IconTile({
  icon: Icon,
  className,
}: {
  readonly icon: LucideIcon;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover",
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.5} className="text-muted-foreground" />
    </span>
  );
}

/* --------------------------------- toolbar --------------------------------- */

/** A dense filter bar: every control inside sits on the 28px ladder. */
export function Toolbar({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <SizeProvider size="compact">
      <ToolbarRow className={className}>{children}</ToolbarRow>
    </SizeProvider>
  );
}

/** Same spacing as the shared FilterBar: fields 20px apart, wrapping. */
function ToolbarRow({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 max-sm:w-full",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------- meter list ------------------------------- */

export interface MeterRow {
  readonly key: string;
  /** The category, in words (a host, a size band, a resolution). */
  readonly label: ReactNode;
  /** The quantity the bar is drawn from. */
  readonly value: number;
  /** The quantity as printed at the row's end (e.g. "1.4 MB"). */
  readonly display: ReactNode;
  /** Hover title for the printed figure (e.g. the exact byte count). */
  readonly title?: string;
}

/**
 * A ranked list of horizontal bars, one 36px row per category, scaled to the
 * largest value. The peak bar is held at full strength and the rest at a
 * lighter step, the same grammar as the bar charts. Rows are read-only, so
 * the list carries no hover highlight (it would promise a click).
 */
export function MeterList({
  rows,
  tokens,
  labelWidth = "10rem",
  className,
}: {
  readonly rows: readonly MeterRow[];
  readonly tokens: ChartTokens;
  /** Width of the label column (any CSS length). */
  readonly labelWidth?: string;
  readonly className?: string;
}) {
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  return (
    <ul
      className={cn("grid gap-x-3", className)}
      style={{
        gridTemplateColumns: `minmax(0, ${labelWidth}) minmax(0, 1fr) max-content`,
      }}
    >
      {rows.map((row) => {
        const share = peak === 0 ? 0 : row.value / peak;
        // A non-zero value always shows a sliver, so "some" never reads as
        // "none"; a true zero stays an empty track.
        const shown = row.value === 0 ? 0 : Math.max(share, 0.02);
        return (
          <li
            key={row.key}
            className="col-span-3 grid h-9 grid-cols-subgrid items-center"
          >
            <span
              className={cn(
                typeClass("body"),
                "flex min-w-0 items-center gap-2 text-foreground",
              )}
            >
              {row.label}
            </span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-hover">
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundColor: tokens["--primary"],
                  opacity: row.value === peak && peak > 0 ? 1 : 0.45,
                }}
                initial={{ x: "-100%" }}
                animate={{ x: `${String((shown - 1) * 100)}%` }}
                transition={spring.slow}
              />
            </span>
            <span
              className={cn(
                typeClass("body"),
                "text-right text-muted-foreground tabular-nums",
              )}
              title={row.title}
            >
              {row.display}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
