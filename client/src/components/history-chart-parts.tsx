/**
 * Small parts the History, Timeline and Downloads charts share.
 *
 * `SavedOnlyTag` replaces the full-width "N recovered … are not drawn"
 * footnote: a chart that plots saved rows only carries a small neutral tag
 * in its header (the same compact Badge as Overview's), and the tooltip names what was left out. It renders nothing
 * when nothing was left out.
 *
 * `formatDaySpan` is a recorded span as data, shortened: "11 Mar – 17 Apr"
 * within one year, full dates across years, one date for one day.
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

import { formatDay, formatDayTick, plural } from "./page-kit.js";

export function SavedOnlyTag({
  recovered,
  unit,
}: {
  /** Recovered rows the chart does not draw. */
  readonly recovered: number;
  /** The rows' noun, e.g. `{ one: "visit", many: "visits" }`. */
  readonly unit: { readonly one: string; readonly many: string };
}) {
  if (recovered <= 0) {
    return null;
  }
  const note = `${plural(recovered, `recovered ${unit.one}`, `recovered ${unit.many}`)} not drawn`;
  return (
    <Tooltip content={note}>
      <Badge
        size="compact"
        tabIndex={0}
        aria-label={`Saved only: ${note}`}
        className="cursor-help outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
      >
        Saved only
      </Badge>
    </Tooltip>
  );
}

/** "11 Mar – 17 Apr" (one year), "9 Dec 2023 – 4 Jan 2024", or "4 Mar 2024". */
export function formatDaySpan(first: string, last: string): string {
  if (first === last) {
    return formatDay(first);
  }
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${formatDayTick(first)} – ${formatDayTick(last)}`
    : `${formatDay(first)} – ${formatDay(last)}`;
}
