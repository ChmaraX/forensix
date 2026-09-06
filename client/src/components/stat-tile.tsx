/**
 * A single stat "highlight" tile: bordered card, a soft top wash, a
 * label/value/optional-note stack, and an `fx-rise` entrance stagger.
 *
 * Born as the Overview masthead's own highlight strip (the four tiles that
 * dock over the masthead's bottom edge) and pulled out here so any chart
 * panel can dock the same kind of stat readouts on its own bottom edge,
 * instead of every page inventing its own stat-card recipe.
 */
import type { CSSProperties, ReactNode } from "react";

/** Per-tile entrance offset for the `fx-rise` stagger, 70ms a step. */
export function riseDelay(step: number): CSSProperties {
  return { "--fx-delay": `${String(step * 70)}ms` } as CSSProperties;
}

export function StatTile({
  label,
  value,
  note,
  delay = 0,
  children,
}: {
  readonly label: string;
  readonly value: string;
  /** Omit when the figure has nothing more to say \u2014 the note line still
   *  reserves its height (a non-breaking space) so tiles in the same row
   *  keep equal height whether or not each one has a note. */
  readonly note?: string;
  readonly delay?: number;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className="fx-rise relative overflow-hidden rounded-xl border border-border bg-card p-3.5 shadow-[0_16px_32px_-18px_var(--edge-shadow)]"
      style={riseDelay(delay)}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-11 bg-gradient-to-b from-accent/70 to-transparent"
      />
      <div className="relative flex h-full flex-col gap-2">
        <span className="truncate text-[11px] leading-none font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </span>
        <p className="truncate text-[27px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {value}
        </p>
        {children}
        <p
          className="mt-auto truncate text-[12px] leading-none text-muted-foreground"
          title={note}
        >
          {note ?? "\u00a0"}
        </p>
      </div>
    </div>
  );
}
