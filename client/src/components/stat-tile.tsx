/**
 * A single stat "highlight" tile: a recorded figure with its label and an
 * optional note, on its own FF surface.
 *
 * Born as the Overview masthead's highlight strip (the tiles that dock over
 * the masthead's bottom edge) and shared so any chart panel can dock the
 * same readouts on its own bottom edge. Drawn from FF parts: an `Elevated`
 * surface two steps up with the popup shadow (it floats over the edge it
 * docks on), the shape system's container radius, a caption label, the
 * figure in the compact display role (the masthead's own scale) at
 * semibold, and a caption note.
 *
 * Entrance: the shell's `reveal-product` column already fades the page in;
 * the tile adds no animation of its own. `delay` / `riseDelay` are kept so
 * existing call sites compile; they no longer drive anything visible.
 *
 * Forensic rule: tiles show recorded facts only — never a Candidate value.
 */
import type { CSSProperties, ReactNode } from "react";

import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

/**
 * @deprecated The legacy `fx-rise` stagger offset. Still returns the
 * `--fx-delay` custom property so older call sites type-check; new code
 * relies on the shell's `reveal-product` (or `reveal-items`) instead.
 */
export function riseDelay(step: number): CSSProperties {
  return { "--fx-delay": `${String(step * 70)}ms` } as CSSProperties;
}

export function StatTile({
  label,
  value,
  note,
  children,
  className,
}: {
  readonly label: string;
  readonly value: string;
  /** Omit when the figure has nothing more to say — the note line still
   *  reserves its height (a non-breaking space) so tiles in the same row
   *  keep equal height whether or not each one has a note. */
  readonly note?: string;
  /** @deprecated No longer animates; kept for call-site compatibility. */
  readonly delay?: number;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const shape = useShape();
  const size = useSize();
  return (
    <Elevated
      offset={2}
      shadowLevel={3}
      className={cn(
        "flex min-w-0 flex-col gap-1 px-4 py-3.5 text-foreground",
        shape.container,
        className,
      )}
    >
      <span className={cn(size.type.caption, "truncate text-muted-foreground")}>
        {label}
      </span>
      <p
        className={cn(
          typeClass("display", "compact"),
          "truncate text-foreground tabular-nums",
        )}
        style={{ fontVariationSettings: fontWeights.semibold }}
        title={value}
      >
        {value}
      </p>
      {children}
      <p
        className={cn(
          size.type.caption,
          "mt-auto truncate text-muted-foreground",
        )}
        title={note}
      >
        {note ?? "\u00a0"}
      </p>
    </Elevated>
  );
}
