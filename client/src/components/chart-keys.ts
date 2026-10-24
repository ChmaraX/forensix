/**
 * The input rules of a per-day chart, as pure functions (no React, no DOM),
 * so pointer, touch and keyboard read exactly the same and are unit-tested
 * in `chart-keys.test.ts`. `chart-input.tsx` wires them to events.
 *
 * A chart is `count` equal bands (Recharts' category axis), indexed 0..n-1
 * left to right. A day range is inclusive `YYYY-MM-DD` bounds, `""` an open
 * side; `{ from: "", to: "" }` is the full span.
 *
 *  - Pointer / touch: press on a band and release on the same band = pick
 *    that day (again on the picked day = the full span); release on another
 *    band = that span. A cancelled pointer (a touch that became a scroll,
 *    a lost capture, Escape) commits nothing.
 *  - Keyboard: ←/→ move the cursor a day, Home/End to the first/last day;
 *    Enter or Space picks the cursor's day (the same toggle as a click);
 *    Shift+←/→/Home/End stretch the range from where the cursor stood (the
 *    anchor) to the cursor, each step committed like a drag's release;
 *    Escape clears the range.
 */

/** An inclusive day range; `""` is an open side. */
export interface DaySpan {
  readonly from: string;
  readonly to: string;
}

/** The full span: no range. */
export const FULL_SPAN: DaySpan = { from: "", to: "" };

/** True when the range narrows anything. */
export function hasSpan(range: DaySpan | undefined): boolean {
  return range !== undefined && (range.from !== "" || range.to !== "");
}

/** Two days as a sorted span. */
export function spanOf(first: string, second: string): DaySpan {
  return first <= second
    ? { from: first, to: second }
    : { from: second, to: first };
}

/** The range a pick on `date` makes: that day, or the full span when that
 *  day alone is already the range. */
export function pickDay(date: string, range: DaySpan | undefined): DaySpan {
  return range !== undefined && range.from === date && range.to === date
    ? FULL_SPAN
    : { from: date, to: date };
}

/** The range a released press makes: a pick on one band, a span across
 *  several. */
export function releaseSpan(
  start: string,
  end: string,
  range: DaySpan | undefined,
): DaySpan {
  return start === end ? pickDay(start, range) : spanOf(start, end);
}

/**
 * The band under a horizontal position, clamped to the plot (a drag that
 * leaves the chart keeps reading its edge band). `x` is relative to the
 * chart's own left edge; `plotLeft` / `plotWidth` are the plot area inside
 * it. Null when there is nothing to hit.
 */
export function bandIndexAt(
  x: number,
  plotLeft: number,
  plotWidth: number,
  count: number,
): number | null {
  if (count <= 0 || !(plotWidth > 0) || !Number.isFinite(x)) {
    return null;
  }
  const index = Math.floor(((x - plotLeft) / plotWidth) * count);
  return Math.min(count - 1, Math.max(0, index));
}

/**
 * Which bands get a day label on the axis. A label is wider than a band, so
 * on a sparse series a label set at a fixed interval often lands on an
 * empty day and reads as the label of the bar beside it ("23 Mar" under
 * the 24 Mar bar). Labels are spaced at least `spacing` px apart, each on
 * its regular slot or, when that day drew nothing, on the nearest day that
 * did within half a slot - so a label stands under the bar it names. A
 * slot with no bar near keeps its own day (nothing beside it to misread).
 * Labels never come closer than `minGap` px. Returns band indices,
 * ascending.
 */
export function dayTickIndices(
  values: readonly number[],
  plotWidth: number,
  spacing = 64,
  minGap = 48,
): number[] {
  const count = values.length;
  if (count === 0 || !(plotWidth > 0)) {
    return [];
  }
  const band = plotWidth / count;
  const step = Math.max(1, Math.ceil(spacing / band));
  const reach = Math.floor(step / 2);
  const closest = Math.max(1, Math.ceil(minGap / band));
  const drawn = (index: number) => (values[index] ?? 0) > 0;
  const ticks: number[] = [];
  for (let anchor = 0; anchor < count; anchor += step) {
    let chosen = anchor;
    if (!drawn(anchor)) {
      for (let offset = 1; offset <= reach; offset += 1) {
        if (anchor + offset < count && drawn(anchor + offset)) {
          chosen = anchor + offset;
          break;
        }
        if (anchor - offset >= 0 && drawn(anchor - offset)) {
          chosen = anchor - offset;
          break;
        }
      }
    }
    const previous = ticks[ticks.length - 1];
    if (previous === undefined || chosen - previous >= closest) {
      ticks.push(chosen);
    }
  }
  return ticks;
}

/** Where the keyboard cursor starts on a chart: the last day of the
 *  range when there is one, else the peak, else the last day. */
export function startIndex(
  dates: readonly string[],
  values: readonly number[],
  range: DaySpan | undefined,
): number {
  if (dates.length === 0) {
    return 0;
  }
  if (range !== undefined && hasSpan(range)) {
    const end = range.to === "" ? dates[dates.length - 1] : range.to;
    let last = -1;
    dates.forEach((date, index) => {
      if (end !== undefined && date <= end) {
        last = index;
      }
    });
    if (last >= 0) {
      return last;
    }
  }
  let peak = -1;
  let peakValue = 0;
  values.forEach((value, index) => {
    if (value > peakValue) {
      peak = index;
      peakValue = value;
    }
  });
  return peak >= 0 ? peak : dates.length - 1;
}

/** The keyboard state a chart keeps between keys. */
export interface ChartKeyState {
  /** The band the keyboard is on, or null before the first key. */
  readonly cursor: number | null;
  /** Where a Shift-stretched span started, or null outside a stretch. */
  readonly anchor: number | null;
}

/** What one key does. `null`: the key is not the chart's (let it through). */
export type ChartKeyEffect =
  /** Move the cursor; with an `anchor` (Shift held on a selectable chart)
   *  the range becomes `anchor..cursor` too. A plain move ends a stretch. */
  | {
      readonly kind: "move";
      readonly cursor: number;
      readonly anchor: number | null;
    }
  /** Pick the day under `index` (Enter / Space outside a stretch). */
  | { readonly kind: "pick"; readonly index: number }
  /** Commit the span `from..to` (indices, sorted): Enter during a stretch. */
  | { readonly kind: "commit"; readonly from: number; readonly to: number }
  /** Clear the range (Escape). */
  | { readonly kind: "clear" };

/**
 * The effect of one key on a chart of `count` bands. `selectable` false
 * (a read-only chart): only the cursor moves. `start` is where the cursor
 * starts when it has not been placed yet (see `startIndex`). `ranged`: the
 * page has a range set (Escape then clears it; otherwise Escape is left to
 * whatever is around the chart).
 */
export function chartKeyEffect(
  key: string,
  shiftKey: boolean,
  state: ChartKeyState,
  {
    count,
    start,
    selectable,
    ranged,
  }: {
    readonly count: number;
    readonly start: number;
    readonly selectable: boolean;
    readonly ranged: boolean;
  },
): ChartKeyEffect | null {
  if (count <= 0) {
    return null;
  }
  const cursor = Math.min(count - 1, Math.max(0, state.cursor ?? start));
  const stretch = selectable && shiftKey;
  const moveTo = (next: number): ChartKeyEffect => ({
    kind: "move",
    cursor: Math.min(count - 1, Math.max(0, next)),
    anchor: stretch ? (state.anchor ?? cursor) : null,
  });
  switch (key) {
    case "ArrowLeft":
      // The first key only shows where the cursor is.
      return moveTo(state.cursor === null ? cursor : cursor - 1);
    case "ArrowRight":
      return moveTo(state.cursor === null ? cursor : cursor + 1);
    case "Home":
      return moveTo(0);
    case "End":
      return moveTo(count - 1);
    case "Enter":
    case " ":
      if (!selectable) {
        return null;
      }
      if (state.anchor !== null) {
        return {
          kind: "commit",
          from: Math.min(state.anchor, cursor),
          to: Math.max(state.anchor, cursor),
        };
      }
      return { kind: "pick", index: cursor };
    case "Escape":
      return selectable && (ranged || state.anchor !== null)
        ? { kind: "clear" }
        : null;
    default:
      return null;
  }
}
