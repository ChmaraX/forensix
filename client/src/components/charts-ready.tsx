/**
 * The ready-made charts, built on the shared parts in `charts.tsx`:
 * `ActivityBars` (counts per day, the one per-day chart), `HourBars` (per
 * hour of day, read-only) and `SegmentBar` (a categorical proportion). The
 * series style, axes, tooltip and motion rules are the ones `charts.tsx`
 * describes.
 */
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type MouseHandlerDataParam,
} from "recharts";

import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Tooltip as UiTooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import {
  activeIndexOf,
  CHART_FOCUS_CLASS,
  ChartEmpty,
  chartAnimation,
  chartAxis,
  chartGrid,
  chartRange,
  ChartTooltipCard,
  ChartTooltipNote,
  ChartTooltipValue,
  chartTooltipMotion,
  FluidBandCursor,
  formatHour,
  SERIES,
  SeriesBar,
  seriesColor,
  tooltipEntry,
  usePrefersReducedMotion,
  type ChartTokens,
  type DayCount,
} from "./charts.js";
import { formatDayTick } from "./page-kit.js";

/* ───────────────────────────── Formatting ───────────────────────────── */

function formatDayLong(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** A count's unit, singular and plural (e.g. `{ one: "entry", many:
 *  "entries" }`). */
interface ChartUnit {
  readonly one: string;
  readonly many: string;
}

const VISITS_UNIT: ChartUnit = { one: "page visit", many: "page visits" };

function unitFor(count: number, unit: ChartUnit): string {
  return count === 1 ? unit.one : unit.many;
}

/**
 * The count axis for a small peak: Recharts pads a peak of 1 or 2 up to 4,
 * which leaves half the plot as empty grid. Up to a peak of 4 the axis
 * stops at `max(peak, 2)` with one tick per whole count; above that the
 * default integer ticks follow the data.
 */
function countScale(peak: number): {
  domain?: [number, number];
  ticks?: number[];
} {
  if (peak > 4) {
    return {};
  }
  const top = Math.max(peak, 2);
  return {
    domain: [0, top],
    ticks: Array.from({ length: top + 1 }, (_, index) => index),
  };
}

/* ─────────────────────────────── Charts ─────────────────────────────── */

/**
 * Counts per recorded day, as discrete bars — the one per-day chart shared by
 * Overview, History, Timeline, Downloads and Cache, so the same kind of data
 * never reads two different ways. Each day is one recorded bucket, not a
 * sample on a continuous curve. One emphasis at full ink: the selected day
 * when the range is one day, else the peak.
 *
 * With `onRangeChange` the chart drives the page's date range (the same
 * value its date picker shows), one behaviour everywhere:
 *  - click a day: the range becomes that day; click it again: the full span
 *    (`{ from: "", to: "" }`);
 *  - drag across days: the range becomes those days;
 *  - an active range is a wash behind the bars, the days outside it dimmed.
 * The cursor is a pointer and the fluid hover band follows it. Without
 * `onRangeChange` the chart is a plain read-only reading.
 */
export function ActivityBars({
  days,
  tokens,
  range,
  onRangeChange,
  unit = VISITS_UNIT,
  emptyMessage = "No dated visits to draw.",
}: {
  readonly days: readonly DayCount[];
  readonly tokens: ChartTokens;
  /** The page's date range (`""` = an open bound). */
  readonly range?: { readonly from: string; readonly to: string };
  /** Makes the chart drive the range (see above). */
  readonly onRangeChange?: (range: { from: string; to: string }) => void;
  /** The unit the tooltip prints after the count. @default page visit(s) */
  readonly unit?: ChartUnit;
  /** Words when there is no day to draw. */
  readonly emptyMessage?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const highlight = useMemo(() => {
    if (dragStart !== null && dragCurrent !== null) {
      return dragStart <= dragCurrent
        ? { from: dragStart, to: dragCurrent }
        : { from: dragCurrent, to: dragStart };
    }
    if (range !== undefined && (range.from !== "" || range.to !== "")) {
      // An unset bound is open-ended, as the lists filter: it runs to the
      // chart's first or last day.
      const first = days[0]?.date ?? "";
      const last = days[days.length - 1]?.date ?? "";
      return {
        from: range.from === "" || range.from < first ? first : range.from,
        to: range.to === "" || range.to > last ? last : range.to,
      };
    }
    return null;
  }, [dragCurrent, dragStart, range, days]);
  // A press and release on one day is a click on it; across days, a drag.
  // Both are decided on pointer-up, never on `click`: the press re-renders
  // the bars (the drag highlight), so the element under the pointer is
  // replaced and the browser would never fire `click` on a bar. Leaving the
  // chart mid-press only ends a drag.
  const commitDrag = (release: boolean) => {
    if (dragStart !== null && dragCurrent !== null) {
      if (dragStart !== dragCurrent) {
        onRangeChange?.(
          dragStart <= dragCurrent
            ? { from: dragStart, to: dragCurrent }
            : { from: dragCurrent, to: dragStart },
        );
      } else if (release) {
        selectDay(dragStart);
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };
  const selectedDate =
    range !== undefined && range.from !== "" && range.from === range.to
      ? range.from
      : null;
  const selectDay = (date: string) => {
    if (onRangeChange === undefined) {
      return;
    }
    onRangeChange(
      date === selectedDate ? { from: "", to: "" } : { from: date, to: date },
    );
  };
  if (days.length === 0) {
    return <ChartEmpty>{emptyMessage}</ChartEmpty>;
  }
  const rows = days;
  const peak = rows.reduce((max, row) => Math.max(max, row.count), 0);
  const interactive = onRangeChange !== undefined;
  const dateAt = (state: MouseHandlerDataParam | undefined) => {
    const index = activeIndexOf(state);
    return index === null ? null : (rows[index]?.date ?? null);
  };
  // One emphasis: the selection when there is one (the picked day, or every
  // day of the picked or dragged span), else the peak.
  const emphasisOf = (row: DayCount) =>
    highlight !== null
      ? row.count > 0 && row.date >= highlight.from && row.date <= highlight.to
      : peak > 0 && row.count === peak;
  const dimmedOf = (row: DayCount) =>
    highlight !== null &&
    (row.date < highlight.from || row.date > highlight.to);
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      className={CHART_FOCUS_CLASS}
    >
      <BarChart
        data={rows as DayCount[]}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barCategoryGap="18%"
        style={interactive ? { cursor: "pointer" } : undefined}
        onMouseDown={(state) => {
          if (onRangeChange === undefined) {
            return;
          }
          const date = dateAt(state);
          if (date !== null) {
            setDragStart(date);
            setDragCurrent(date);
          }
        }}
        onMouseMove={(state) => {
          setHoverIndex(activeIndexOf(state));
          if (dragStart !== null) {
            const date = dateAt(state);
            if (date !== null) {
              setDragCurrent(date);
            }
          }
        }}
        // The whole lit band is the target, not only the bar inside it: what
        // the hover band lights is what a release selects.
        onMouseUp={() => {
          commitDrag(true);
        }}
        onMouseLeave={() => {
          setHoverIndex(null);
          commitDrag(false);
        }}
      >
        <CartesianGrid {...chartGrid(tokens)} />
        <XAxis
          dataKey="date"
          {...chartAxis(tokens)}
          minTickGap={40}
          tickFormatter={formatDayTick}
        />
        <YAxis
          width={40}
          {...chartAxis(tokens)}
          allowDecimals={false}
          {...countScale(peak)}
          tickFormatter={formatCount}
        />
        <Tooltip
          {...chartTooltipMotion(reduced)}
          cursor={<FluidBandCursor fill={tokens["--hover"]} />}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            if (row === null) {
              return null;
            }
            const count = Number(row["count"]);
            return (
              <ChartTooltipCard label={formatDayLong(String(row["date"]))}>
                <ChartTooltipValue
                  value={formatCount(count)}
                  unit={unitFor(count, unit)}
                />
                {row["date"] === selectedDate ? (
                  <ChartTooltipNote>Selected day</ChartTooltipNote>
                ) : peak > 0 && count === peak ? (
                  <ChartTooltipNote>Busiest day</ChartTooltipNote>
                ) : null}
              </ChartTooltipCard>
            );
          }}
        />
        {highlight !== null && highlight.from < highlight.to ? (
          <ReferenceArea
            x1={highlight.from}
            x2={highlight.to}
            {...chartRange(tokens)}
          />
        ) : null}
        <Bar
          dataKey="count"
          radius={[3, 3, 0, 0]}
          {...chartAnimation(reduced)}
          fill={seriesColor(tokens)}
          shape={(props: BarShapeProps) => {
            const row = rows[props.originalDataIndex];
            return (
              <SeriesBar
                {...props}
                tokens={tokens}
                emphasis={row !== undefined && emphasisOf(row)}
                dimmed={row !== undefined && dimmedOf(row)}
                hovered={props.originalDataIndex === hoverIndex}
              />
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Visits by hour of day. The busiest hour is the only one held at full
 * strength; the hovered hour rises toward it on the same spring as every other
 * fluid hover in the app.
 */
export function HourBars({
  hours,
  tokens,
}: {
  readonly hours: readonly number[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const total = hours.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return <ChartEmpty>No timed visits to draw.</ChartEmpty>;
  }
  const peak = Math.max(...hours);
  const rows = hours.map((count, hour) => ({
    hour,
    count,
    label: formatHour(hour),
  }));
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      className={CHART_FOCUS_CLASS}
    >
      <BarChart
        data={rows}
        margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
        barCategoryGap="18%"
        onMouseMove={(state) => {
          setHoverIndex(activeIndexOf(state));
        }}
        onMouseLeave={() => {
          setHoverIndex(null);
        }}
      >
        <CartesianGrid {...chartGrid(tokens)} />
        <XAxis
          dataKey="hour"
          {...chartAxis(tokens)}
          interval={5}
          tickFormatter={(hour: number) => formatHour(hour)}
        />
        <YAxis
          width={36}
          {...chartAxis(tokens)}
          allowDecimals={false}
          {...countScale(peak)}
          tickFormatter={formatCount}
        />
        <Tooltip
          {...chartTooltipMotion(reduced)}
          cursor={<FluidBandCursor fill={tokens["--hover"]} />}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            if (row === null) {
              return null;
            }
            const count = Number(row["count"]);
            const hour = Number(row["hour"]);
            return (
              <ChartTooltipCard
                label={`${formatHour(hour)} - ${formatHour((hour + 1) % 24)}`}
              >
                <ChartTooltipValue
                  value={formatCount(count)}
                  unit={unitFor(count, VISITS_UNIT)}
                />
                {count === peak ? (
                  <ChartTooltipNote>Busiest hour</ChartTooltipNote>
                ) : null}
              </ChartTooltipCard>
            );
          }}
        />
        <Bar
          dataKey="count"
          radius={[3, 3, 0, 0]}
          {...chartAnimation(reduced)}
          fill={seriesColor(tokens)}
          shape={(props: BarShapeProps) => {
            const row = rows[props.originalDataIndex];
            return (
              <SeriesBar
                {...props}
                tokens={tokens}
                emphasis={row !== undefined && row.count === peak}
                hovered={props.originalDataIndex === hoverIndex}
              />
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ───────────────────────────── Segment bar ───────────────────────────── */

/** One category of a `SegmentBar`, in the distribution's own order. */
export interface Segment {
  readonly key: string;
  /** The category, in words ("≤ 1 year"). */
  readonly label: string;
  readonly count: number;
}

/** Ink strength of the segment at `position` of `total` ordered categories:
 *  an ordinal ramp in the one series colour, light (first) to full (last). */
function segmentOpacity(position: number, total: number): number {
  if (total <= 1) {
    return SERIES.emphasis;
  }
  return (
    SERIES.rest + ((SERIES.emphasis - SERIES.rest) * position) / (total - 1)
  );
}

/**
 * A categorical distribution as one proportion bar: each non-zero category
 * a segment sized by its count, in the categories' own order, drawn in
 * neutral ordinal shades of the one series colour (ink, light to full) —
 * never an evidence hue. Zero categories are left out of the bar and the
 * legend. Under it, a compact legend: each category's swatch, label, count
 * and share.
 *
 * Hover (or focus) a segment or its legend entry: FF's fluid highlight
 * glides behind that segment (`useFluidHover`, `spring.fast`), the segment
 * lifts a step (the last, already full, stays), its legend label turns semibold, and a tooltip names
 * it ("≤ 1 year · 18 cookies · 82%"). Read-only: nothing is clickable.
 *
 *   <SegmentBar segments={buckets} tokens={tokens} unit={{ one: "cookie", many: "cookies" }} />
 */
export function SegmentBar({
  segments,
  tokens,
  unit,
  label,
  className,
}: {
  /** Every category in order; zeros are not drawn. */
  readonly segments: readonly Segment[];
  readonly tokens: ChartTokens;
  readonly unit: ChartUnit;
  /** Accessible name of the bar (e.g. "Saved cookies by lifespan"). */
  readonly label?: string;
  readonly className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "x" });
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  // The ramp runs over the drawn (non-zero) categories, in order, so two
  // neighbours never sit a hair apart in shade.
  const drawn = segments.filter((segment) => segment.count > 0);
  const shown = drawn.map((segment, position) => ({
    ...segment,
    opacity: segmentOpacity(position, drawn.length),
  }));
  if (total === 0) {
    return <ChartEmpty>Nothing to draw.</ChartEmpty>;
  }
  const share = (count: number) => {
    const percent = (count / total) * 100;
    return percent > 0 && percent < 1
      ? "<1%"
      : `${String(Math.round(percent))}%`;
  };
  const describe = (segment: Segment) =>
    `${segment.label} · ${segment.count.toLocaleString("en-US")} ${unitFor(segment.count, unit)} · ${share(segment.count)}`;
  const ink = seriesColor(tokens);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        ref={containerRef}
        role="img"
        aria-label={`${label === undefined ? "" : `${label}: `}${shown.map(describe).join("; ")}`}
        className="relative flex h-8 items-stretch gap-0.5"
        {...hover.handlers}
      >
        <FluidHoverHighlight hover={hover} className="rounded-lg" />
        {shown.map((segment, index) => (
          <SegmentCell
            key={segment.key}
            index={index}
            weight={segment.count}
            color={ink}
            opacity={segment.opacity}
            lifted={hover.activeIndex === index}
            note={describe(segment)}
            registerItem={hover.registerItem}
          />
        ))}
      </div>
      <ul
        className={cn(
          typeClass("caption"),
          "flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground tabular-nums",
        )}
      >
        {shown.map((segment, index) => (
          <li
            key={segment.key}
            className="inline-flex items-center gap-1.5"
            onMouseEnter={() => {
              hover.setActiveIndex(index);
            }}
            onMouseLeave={() => {
              hover.setActiveIndex(null);
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: ink, opacity: segment.opacity }}
            />
            <span
              className="text-foreground transition-[font-variation-settings] duration-80"
              style={{
                fontVariationSettings:
                  hover.activeIndex === index
                    ? fontWeights.semibold
                    : fontWeights.normal,
              }}
            >
              {segment.label}
            </span>
            <span>
              {segment.count.toLocaleString("en-US")} · {share(segment.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One segment: a hover target the bar's full height, the ink bar centred
 *  in it, sized by `weight` (flex-grow, so the gaps never overflow). */
function SegmentCell({
  index,
  weight,
  color,
  opacity,
  lifted,
  note,
  registerItem,
}: {
  readonly index: number;
  readonly weight: number;
  readonly color: string;
  readonly opacity: number;
  readonly lifted: boolean;
  readonly note: string;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <UiTooltip content={note}>
      <span
        ref={ref}
        tabIndex={0}
        aria-label={note}
        className="relative z-10 flex min-w-2 cursor-default items-center px-0.5 outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
        style={{ flexGrow: weight, flexBasis: 0 }}
      >
        <motion.span
          aria-hidden="true"
          className="block h-3 w-full rounded-[3px]"
          style={{ backgroundColor: color }}
          initial={false}
          animate={{
            opacity: lifted
              ? Math.min(SERIES.emphasis, opacity + 0.25)
              : opacity,
          }}
          transition={spring.fast}
        />
      </span>
    </UiTooltip>
  );
}
