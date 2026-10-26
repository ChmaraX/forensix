/**
 * The ready-made charts, built on the shared parts in `charts.tsx`:
 * `DayBars` (a value per recorded day, the one per-day chart), its counting
 * form `ActivityBars`, `HourBars` (per hour of day, read-only) and
 * `SegmentBar` (a categorical proportion). The series style, axes, tooltip
 * and motion rules are the ones `charts.tsx` describes; pointer, touch and
 * keyboard input and the text equivalent are `chart-input.tsx`'s.
 */
import { motion } from "motion/react";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
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
  ChartCursorBand,
  ChartFrame,
  ChartPlotProbe,
  ChartRangeWash,
  useChartInput,
} from "./chart-input.js";
import { dayTickIndices, type DaySpan } from "./chart-keys.js";
import {
  ChartEmpty,
  CHART_STATIC,
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
import { formatDayLong, formatDayTick } from "../day-format.js";

/* ───────────────────────────── Formatting ───────────────────────────── */

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** A count's unit, singular and plural (e.g. `{ one: "entry", many:
 *  "entries" }`). */
export interface ChartUnit {
  readonly one: string;
  readonly many: string;
}

const VISITS_UNIT: ChartUnit = { one: "page visit", many: "page visits" };

function unitFor(count: number, unit: ChartUnit): string {
  return count === 1 ? unit.one : unit.many;
}

function capitalise(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Words for a committed range, for the live region. */
function describeSpan(range: DaySpan): string {
  return range.from === range.to
    ? `Selected ${formatDayLong(range.from)}`
    : `Selected ${formatDayLong(range.from)} to ${formatDayLong(range.to)}`;
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

/** One recorded day of a `DayBars` series. */
export interface DayBar {
  /** `YYYY-MM-DD`, a Case day. */
  readonly date: string;
}

/** The value axis of a `DayBars` chart. */
export interface DayBarsAxis {
  /** Width reserved for the tick labels. @default 40 */
  readonly width?: number;
  readonly ticks?: readonly number[];
  readonly domain?: readonly [number, number];
  readonly tickFormatter?: (value: number) => string;
}

/**
 * A value per recorded day, as discrete bars — the one per-day chart shared
 * by Overview, History, Timeline, Downloads and Cache, so the same kind of
 * data never reads two different ways. Each day is one recorded bucket, not
 * a sample on a continuous curve. One emphasis at full ink: the picked days
 * when there is a range, else the peak.
 *
 * With `onRangeChange` the chart drives the page's date range (the same
 * value its date picker shows), one behaviour everywhere, by mouse, touch
 * or keyboard (`chart-keys.ts`):
 *  - press and release on a day (tap, click, Enter/Space on the keyboard
 *    cursor): the range becomes that day; again: the full span;
 *  - drag across days (or Shift+arrows): the range becomes those days;
 *  - Escape clears the range;
 *  - an active range is a wash behind the bars with a baseline under it
 *    (so a picked day that drew nothing still shows), its bars at full
 *    ink and the days outside at rest.
 * Without `onRangeChange` the chart is a plain read-only reading (the
 * keyboard still browses it).
 *
 * The chart is one tab stop named by `title` and a summary (span, total,
 * busiest day), with a visually hidden day table beside it.
 *
 *   <DayBars days={days} value={(day) => day.bytes} tokens={tokens}
 *     title="Bytes downloaded per day" formatValue={formatBytes}
 *     axis={{ width: 56, ticks, domain, tickFormatter: formatBytes }}
 *     tooltip={(day, note) => …} range={range} onRangeChange={setRange} />
 */
export function DayBars<Day extends DayBar>({
  days,
  value,
  tokens,
  title,
  formatValue,
  tooltip,
  axis,
  range,
  onRangeChange,
  emptyMessage,
}: {
  readonly days: readonly Day[];
  /** The drawn value of a day (a count, bytes…). */
  readonly value: (day: Day) => number;
  readonly tokens: ChartTokens;
  /** What a bar is, for the accessible name and the day table: "Page
   *  visits per day". */
  readonly title: string;
  /** A value in words for speech and the day table ("3 page visits",
   *  "12.4 MB"). */
  readonly formatValue: (value: number) => string;
  /** The tooltip body for a day under the pointer or the keyboard cursor;
   *  `note` is "Selected day" / "Busiest day" when it applies. */
  readonly tooltip: (day: Day, note: string | null) => ReactNode;
  /** The value axis. @default whole counts, 40px */
  readonly axis?: DayBarsAxis;
  /** The page's date range (`""` = an open bound). */
  readonly range?: DaySpan;
  /** Makes the chart drive the range (see above). */
  readonly onRangeChange?: (range: { from: string; to: string }) => void;
  /** Words when there is no day to draw. */
  readonly emptyMessage: string;
}) {
  const reduced = usePrefersReducedMotion();
  const dates = useMemo(() => days.map((day) => day.date), [days]);
  const values = useMemo(() => days.map((day) => value(day)), [days, value]);
  // One function identity per `value`: Recharts derives its bar geometry
  // from the dataKey, so a fresh arrow each render rebuilt it every render.
  const dataKey = useCallback((day: Day) => value(day), [value]);
  const peak = values.reduce((max, current) => Math.max(max, current), 0);
  const selectedDate =
    range !== undefined && range.from !== "" && range.from === range.to
      ? range.from
      : null;
  const noteFor = useCallback(
    (day: Day, dayValue: number): string | null =>
      day.date === selectedDate
        ? "Selected day"
        : peak > 0 && dayValue === peak
          ? "Busiest day"
          : null,
    [selectedDate, peak],
  );
  const describe = useCallback(
    (index: number) => {
      const day = days[index];
      const dayValue = values[index] ?? 0;
      if (day === undefined) {
        return "";
      }
      const note = noteFor(day, dayValue);
      return `${formatDayLong(day.date)}: ${formatValue(dayValue)}${note === null ? "" : `, ${note.toLowerCase()}`}`;
    },
    [days, values, formatValue, noteFor],
  );
  const input = useChartInput({
    dates,
    values,
    range,
    onRangeChange,
    describe,
    describeSpan,
  });
  const plotWidth = input.plot?.width ?? 0;
  const tickDates = useMemo(
    () =>
      plotWidth > 0
        ? dayTickIndices(values, plotWidth).flatMap((index) => {
            const date = dates[index];
            return date === undefined ? [] : [date];
          })
        : undefined,
    [values, dates, plotWidth],
  );
  const summary = useMemo(() => {
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first === undefined || last === undefined) {
      return title;
    }
    const total = values.reduce((sum, current) => sum + current, 0);
    const busiest = dates.filter((_, index) => values[index] === peak);
    const busiestWords =
      peak > 0
        ? busiest.length === 1
          ? `, busiest ${formatDayLong(busiest[0] ?? "")} with ${formatValue(peak)}`
          : `, busiest ${formatValue(peak)} on ${String(busiest.length)} days`
        : "";
    const span =
      first === last
        ? formatDayLong(first)
        : `${formatDayLong(first)} to ${formatDayLong(last)}`;
    return `${title}, ${span}: ${formatValue(total)} in total${busiestWords}`;
  }, [dates, values, peak, title, formatValue]);
  const tableRows = useMemo(
    () =>
      days.flatMap((day, index) => {
        const dayValue = values[index] ?? 0;
        return dayValue > 0
          ? [
              {
                key: day.date,
                label: formatDayLong(day.date),
                value: formatValue(dayValue),
              },
            ]
          : [];
      }),
    [days, values, formatValue],
  );
  if (days.length === 0) {
    return <ChartEmpty>{emptyMessage}</ChartEmpty>;
  }
  const { highlight } = input;
  // One emphasis: the selection when there is one (the picked day, or every
  // day of the picked or dragged span), else the peak.
  const emphasisOf = (date: string, dayValue: number) =>
    highlight !== null
      ? dayValue > 0 && date >= highlight.from && date <= highlight.to
      : peak > 0 && dayValue === peak;
  const dimmedOf = (date: string) =>
    highlight !== null && (date < highlight.from || date > highlight.to);
  const cursorDay = input.cursor === null ? undefined : days[input.cursor];
  // The wash's bands: the first and last drawn day inside the highlight.
  const washFrom =
    highlight === null
      ? null
      : dates.findIndex((date) => date >= highlight.from);
  const washTo =
    highlight === null
      ? null
      : dates.findLastIndex((date) => date <= highlight.to);
  const scale =
    axis === undefined
      ? { ...countScale(peak), tickFormatter: formatCount }
      : {
          ...(axis.ticks === undefined
            ? {}
            : { ticks: axis.ticks as number[], interval: 0 as const }),
          ...(axis.domain === undefined
            ? {}
            : { domain: axis.domain as [number, number] }),
          ...(axis.tickFormatter === undefined
            ? {}
            : { tickFormatter: axis.tickFormatter }),
        };
  return (
    <ChartFrame
      input={input}
      label={summary}
      count={days.length}
      selectable={onRangeChange !== undefined}
      tip={
        cursorDay === undefined ? null : (
          <ChartTooltipCard label={formatDayLong(cursorDay.date)}>
            {tooltip(
              cursorDay,
              noteFor(cursorDay, values[input.cursor ?? 0] ?? 0),
            )}
          </ChartTooltipCard>
        )
      }
      table={{
        caption: `${title} (days with none are left out)`,
        columns: ["Day", capitalise(title.split(" per ")[0] ?? "Value")],
        rows: tableRows,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={days as Day[]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="18%"
          accessibilityLayer={false}
        >
          <ChartPlotProbe onPlot={input.setPlot} />
          <CartesianGrid {...chartGrid(tokens)} />
          <XAxis
            dataKey="date"
            {...chartAxis(tokens)}
            {...(tickDates === undefined
              ? { minTickGap: 40 }
              : { ticks: tickDates, interval: 0 as const })}
            tickFormatter={formatDayTick}
          />
          <YAxis
            width={axis?.width ?? 40}
            {...chartAxis(tokens)}
            allowDecimals={false}
            {...scale}
          />
          <Tooltip
            {...chartTooltipMotion(reduced)}
            active={input.tooltipActive}
            cursor={<FluidBandCursor fill={tokens["--hover"]} />}
            content={({ payload }) => {
              const row = tooltipEntry(payload) as unknown as Day | null;
              if (row === null) {
                return null;
              }
              return (
                <ChartTooltipCard label={formatDayLong(row.date)}>
                  {tooltip(row, noteFor(row, value(row)))}
                </ChartTooltipCard>
              );
            }}
          />
          {input.cursor === null ? null : (
            <ChartCursorBand
              index={input.cursor}
              count={days.length}
              fill={tokens["--hover"]}
            />
          )}
          <ChartRangeWash
            from={washFrom}
            to={washTo}
            count={days.length}
            fill={chartRange(tokens).fill}
            opacity={chartRange(tokens).fillOpacity}
            markOpacity={SERIES.rest}
          />
          <Bar
            dataKey={dataKey}
            radius={[3, 3, 0, 0]}
            {...CHART_STATIC}
            fill={seriesColor(tokens)}
            shape={(props: BarShapeProps) => {
              const day = days[props.originalDataIndex];
              const dayValue = values[props.originalDataIndex] ?? 0;
              return (
                <SeriesBar
                  {...props}
                  tokens={tokens}
                  emphasis={day !== undefined && emphasisOf(day.date, dayValue)}
                  dimmed={day !== undefined && dimmedOf(day.date)}
                  hovered={props.originalDataIndex === input.hoverIndex}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * Counts per recorded day: `DayBars` with a count, the tooltip "3 page
 * visits" and whole-count ticks. Overview, History, Timeline and Cache.
 */
export function ActivityBars({
  days,
  tokens,
  range,
  onRangeChange,
  unit = VISITS_UNIT,
  title,
  emptyMessage = "No dated visits to draw.",
}: {
  readonly days: readonly DayCount[];
  readonly tokens: ChartTokens;
  /** The page's date range (`""` = an open bound). */
  readonly range?: { readonly from: string; readonly to: string };
  /** Makes the chart drive the range (see `DayBars`). */
  readonly onRangeChange?: (range: { from: string; to: string }) => void;
  /** The unit the tooltip prints after the count. @default page visit(s) */
  readonly unit?: ChartUnit;
  /** What a bar is, for the accessible name. @default "<Unit many> per
   *  day" */
  readonly title?: string;
  /** Words when there is no day to draw. */
  readonly emptyMessage?: string;
}) {
  const formatValue = useCallback(
    (count: number) => `${formatCount(count)} ${unitFor(count, unit)}`,
    [unit],
  );
  return (
    <DayBars
      days={days}
      value={countOf}
      tokens={tokens}
      title={title ?? `${capitalise(unit.many)} per day`}
      formatValue={formatValue}
      range={range}
      onRangeChange={onRangeChange}
      emptyMessage={emptyMessage}
      tooltip={(day, note) => (
        <>
          <ChartTooltipValue
            value={formatCount(day.count)}
            unit={unitFor(day.count, unit)}
          />
          {note === null ? null : <ChartTooltipNote>{note}</ChartTooltipNote>}
        </>
      )}
    />
  );
}

function countOf(day: DayCount): number {
  return day.count;
}

/** "9 AM - 10 AM": one hour-of-day bucket. */
function spanOfHour(hour: number): string {
  return `${formatHour(hour)} - ${formatHour((hour + 1) % 24)}`;
}

/**
 * Visits by hour of day. The busiest hour is the only one held at full
 * strength; the hovered (or keyboard-browsed) hour rises toward it on the
 * same spring as every other fluid hover in the app. Read-only.
 */
export function HourBars({
  hours,
  tokens,
}: {
  readonly hours: readonly number[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const total = hours.reduce((sum, count) => sum + count, 0);
  const peak = Math.max(0, ...hours);
  const rows = useMemo(
    () =>
      hours.map((count, hour) => ({
        hour,
        count,
        label: formatHour(hour),
      })),
    [hours],
  );
  const keys = useMemo(() => rows.map((row) => String(row.hour)), [rows]);
  const describe = useCallback(
    (index: number) => {
      const count = hours[index] ?? 0;
      return `${spanOfHour(index)}: ${formatCount(count)} ${unitFor(count, VISITS_UNIT)}${count === peak && peak > 0 ? ", busiest hour" : ""}`;
    },
    [hours, peak],
  );
  const input = useChartInput({ dates: keys, values: hours, describe });
  if (total === 0) {
    return <ChartEmpty>No timed visits to draw.</ChartEmpty>;
  }
  const busiest = rows.filter((row) => row.count === peak);
  const summary = `Page visits by hour of day: ${formatCount(total)} in total, busiest ${
    busiest.length === 1
      ? spanOfHour(busiest[0]?.hour ?? 0)
      : `${String(busiest.length)} hours`
  } with ${formatCount(peak)}`;
  const tipFor = (hour: number, count: number) => (
    <ChartTooltipCard label={spanOfHour(hour)}>
      <ChartTooltipValue
        value={formatCount(count)}
        unit={unitFor(count, VISITS_UNIT)}
      />
      {count === peak ? (
        <ChartTooltipNote>Busiest hour</ChartTooltipNote>
      ) : null}
    </ChartTooltipCard>
  );
  return (
    <ChartFrame
      input={input}
      label={summary}
      count={rows.length}
      selectable={false}
      tip={
        input.cursor === null
          ? null
          : tipFor(input.cursor, hours[input.cursor] ?? 0)
      }
      table={{
        caption: "Page visits by hour of day (hours with none are left out)",
        columns: ["Hour", "Page visits"],
        rows: rows
          .filter((row) => row.count > 0)
          .map((row) => ({
            key: String(row.hour),
            label: spanOfHour(row.hour),
            value: formatCount(row.count),
          })),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          barCategoryGap="18%"
          accessibilityLayer={false}
        >
          <ChartPlotProbe onPlot={input.setPlot} />
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
            active={input.tooltipActive}
            cursor={<FluidBandCursor fill={tokens["--hover"]} />}
            content={({ payload }) => {
              const row = tooltipEntry(payload);
              if (row === null) {
                return null;
              }
              return tipFor(Number(row["hour"]), Number(row["count"]));
            }}
          />
          {input.cursor === null ? null : (
            <ChartCursorBand
              index={input.cursor}
              count={rows.length}
              fill={tokens["--hover"]}
            />
          )}
          <Bar
            dataKey="count"
            radius={[3, 3, 0, 0]}
            {...CHART_STATIC}
            fill={seriesColor(tokens)}
            shape={(props: BarShapeProps) => {
              const row = rows[props.originalDataIndex];
              return (
                <SeriesBar
                  {...props}
                  tokens={tokens}
                  emphasis={row !== undefined && row.count === peak}
                  hovered={props.originalDataIndex === input.hoverIndex}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
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
      {/* A group, not an image: each segment is its own tab stop with its
          own name, which `role="img"` would hide. */}
      <div
        ref={containerRef}
        role="group"
        aria-label={label}
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
