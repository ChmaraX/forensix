/**
 * Overview charts, drawn with Recharts and dressed in Fluid Functionalism.
 *
 * Every series here is analyzer output rendered directly: visit counts per day,
 * visit counts per hour, and the Completeness Statement's produced/attempted
 * ratio. Nothing is smoothed into a trend the evidence does not contain, and no
 * axis is projected past the last recorded day.
 *
 * Recharts writes its colours as SVG presentation attributes, and Chrome does
 * not resolve `var()` inside those. The theme tokens are therefore read off
 * `<html>` and passed down as resolved values, re-read whenever `data-theme`
 * changes, so charts follow light and dark without components branching on the
 * mode themselves.
 *
 * The FF layer, shared by every chart in the app (page-local charts import the
 * same parts):
 *
 *  - quiet axes: no axis or tick lines, Inter at the caption size (12px) in the
 *    muted colour, one hairline horizontal grid in `--border` (`chartTick`,
 *    `chartGrid`);
 *  - a tooltip drawn as an FF popup surface, `Elevated offset={2}
 *    shadowLevel={3}`, caption label over a body value (`ChartTooltipCard`);
 *  - fluid hover on bars: one `--hover` band glides between categories on
 *    `spring.fast` (`FluidBandCursor`, the chart's analogue of
 *    `FluidHoverHighlight`), and the bar under it gains strength on the same
 *    spring (`FluidBar`);
 *  - entrance animation on the `spring.slow` tier's duration, off under reduced
 *    motion (`chartAnimation`).
 *
 * One series style (`SERIES`, `seriesColor`, `SeriesBar`), the same in light
 * and dark: the series is ink (`--foreground`) — FF's palette is neutral, so
 * a chart reads as part of the page rather than a coloured widget. Every bar
 * rests at one light step; exactly one thing is emphasised at full ink: the
 * selection when there is one, else the peak (ties share it). Bars outside
 * an active range dim further; the hovered bar lifts on `spring.fast`. A
 * zero draws nothing — no stub. Counts are integers, so they are drawn as
 * bars (or steps), never a smoothed line or area that invents values
 * between buckets. Evidence hues (`--wal`, `--violet`, …) appear only on
 * evidence series, always with their word.
 */
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type MouseHandlerDataParam,
  type RectangleProps,
} from "recharts";

import { EvidenceDot, type EvidenceState } from "@/components/evidence";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Tooltip as UiTooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

export interface DayCount {
  readonly date: string;
  readonly count: number;
}

const TOKENS = [
  "--primary",
  "--muted-foreground",
  "--border",
  "--card",
  "--foreground",
  "--background",
  "--muted",
  "--accent",
  "--hover",
  "--active",
  "--success",
  "--destructive",
  "--warning",
  "--wal",
  "--violet",
] as const;

type ChartToken = (typeof TOKENS)[number];
export type ChartTokens = Readonly<Record<ChartToken, string>>;

function readTokens(): ChartTokens {
  const styles = getComputedStyle(document.documentElement);
  const entries = TOKENS.map(
    (token) => [token, styles.getPropertyValue(token).trim()] as const,
  );
  return Object.fromEntries(entries) as ChartTokens;
}

/** Resolved theme colours for Recharts, kept in step with `<html data-theme>`. */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(readTokens);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTokens(readTokens());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return tokens;
}

/**
 * Recharts animates through JavaScript, so the stylesheet's reduced-motion
 * guard cannot reach it. Charts ask for the preference and switch animation off
 * themselves.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);
  return reduced;
}

/* ───────────────────────── Shared FF chart parts ───────────────────────── */

/**
 * The one series style. Opacities of the ink series: `rest` for every bar,
 * `emphasis` for the selection (else the peak), `dimmed` outside an active
 * range. `range` is the wash behind an active range.
 */
export const SERIES = {
  rest: 0.3,
  emphasis: 1,
  dimmed: 0.1,
  range: 0.06,
} as const;

/** The series colour: ink, resolved for Recharts. */
export function seriesColor(tokens: ChartTokens): string {
  return tokens["--foreground"];
}

/**
 * A bar's opacity under the series rule: dimmed outside an active range,
 * else full when it is the emphasised bar (the selection, else the peak),
 * else at rest.
 */
export function seriesOpacity({
  emphasis,
  dimmed = false,
}: {
  readonly emphasis: boolean;
  readonly dimmed?: boolean;
}): number {
  if (dimmed) {
    return SERIES.dimmed;
  }
  return emphasis ? SERIES.emphasis : SERIES.rest;
}

/** Props for the wash behind an active range. Spread onto `ReferenceArea`. */
export function chartRange(tokens: ChartTokens): {
  readonly fill: string;
  readonly fillOpacity: number;
  readonly strokeOpacity: 0;
  readonly radius: number;
} {
  return {
    fill: seriesColor(tokens),
    fillOpacity: SERIES.range,
    strokeOpacity: 0,
    radius: 6,
  };
}

/** The font Recharts writes into its SVG text: the app's Inter. */
const CHART_FONT_FAMILY = "Inter, system-ui, sans-serif";

/** Axis tick style: caption size (12px), muted, Inter. Pass to `tick`. */
function chartTick(tokens: ChartTokens): {
  readonly fill: string;
  readonly fontSize: number;
  readonly fontFamily: string;
} {
  return {
    fill: tokens["--muted-foreground"],
    fontSize: 12,
    fontFamily: CHART_FONT_FAMILY,
  };
}

/** Axis props with the quiet FF look: no axis line, no tick marks. Spread
 *  onto `XAxis` / `YAxis`. */
export function chartAxis(tokens: ChartTokens): {
  readonly axisLine: false;
  readonly tickLine: false;
  readonly tick: ReturnType<typeof chartTick>;
} {
  return { axisLine: false, tickLine: false, tick: chartTick(tokens) };
}

/** One hairline horizontal grid. Spread onto `CartesianGrid`. */
export function chartGrid(tokens: ChartTokens): {
  readonly vertical: false;
  readonly stroke: string;
} {
  return { vertical: false, stroke: tokens["--border"] };
}

/**
 * Entrance animation for a Recharts series: the duration of the `spring.slow`
 * tier (the tier for large surfaces, 240ms), off under reduced motion. Spread
 * onto `Bar` / `Area` / `Line` / `Scatter` / `RadialBar`.
 */
export function chartAnimation(reduced: boolean): {
  readonly isAnimationActive: boolean;
  readonly animationDuration: number;
  readonly animationEasing: "ease-out";
} {
  return {
    isAnimationActive: !reduced,
    animationDuration: Math.round(spring.slow.duration * 1000),
    animationEasing: "ease-out",
  };
}

/**
 * Tooltip wrapper motion: the box follows the pointer on the `spring.moderate`
 * tier's duration (short travel), still under reduced motion. Spread onto
 * `Tooltip` next to `content` and `cursor`.
 */
export function chartTooltipMotion(reduced: boolean): {
  readonly isAnimationActive: boolean;
  readonly animationDuration: number;
  readonly animationEasing: "ease-out";
  readonly wrapperStyle: { readonly outline: "none" };
} {
  return {
    isAnimationActive: !reduced,
    animationDuration: Math.round(spring.moderate.duration * 1000),
    animationEasing: "ease-out",
    wrapperStyle: { outline: "none" },
  };
}

/**
 * The chart tooltip as an FF popup surface: two steps above the panel it opens
 * from, with the constant popup shadow, a caption label and body rows. Use as
 * the `content` of a Recharts `Tooltip`.
 */
export function ChartTooltipCard({
  label,
  children,
  className,
}: {
  /** The category the pointer is on (a day, an hour, a site). */
  readonly label: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <Elevated
      offset={2}
      shadowLevel={3}
      className={cn(
        "pointer-events-none flex max-w-[280px] min-w-[132px] flex-col gap-0.5 rounded-xl px-3 py-2 text-foreground",
        className,
      )}
    >
      <p className={cn(typeClass("caption"), "text-muted-foreground")}>
        {label}
      </p>
      {children}
    </Elevated>
  );
}

/**
 * One value row inside `ChartTooltipCard`: the figure in semibold body, its
 * unit in muted body. A series colour, when given, sits before it as a dot
 * (a series name or state word must still follow in `unit`).
 */
export function ChartTooltipValue({
  value,
  unit,
  color,
  state,
}: {
  readonly value: ReactNode;
  readonly unit?: ReactNode;
  /** Resolved series colour for the leading dot. */
  readonly color?: string;
  /** Evidence state for the leading dot; the word goes in `unit`. */
  readonly state?: EvidenceState;
}) {
  return (
    <p
      className={cn(
        typeClass("body"),
        "flex items-center gap-1.5 text-foreground tabular-nums",
      )}
    >
      {state === undefined ? null : <EvidenceDot state={state} />}
      {state === undefined && color !== undefined ? (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span style={{ fontVariationSettings: fontWeights.semibold }}>
        {value}
      </span>
      {unit === undefined ? null : (
        <span className="text-muted-foreground">{unit}</span>
      )}
    </p>
  );
}

/** A plain secondary line inside `ChartTooltipCard` (caption, muted). */
export function ChartTooltipNote({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <p
      className={cn(typeClass("caption"), "text-muted-foreground tabular-nums")}
    >
      {children}
    </p>
  );
}

/**
 * The chart's fluid hover: one `--hover` band, rounded like an FF item, that
 * glides to the category under the pointer on `spring.fast` and fades in where
 * the pointer enters instead of sliding over from the last spot. Pass as the
 * Bar/Area chart Tooltip's `cursor` element: Recharts clones it with the
 * band's geometry each move.
 */
export function FluidBandCursor({
  fill,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
}: {
  /** Resolved `--hover` colour. */
  readonly fill: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}) {
  return (
    <motion.rect
      initial={{ opacity: 0, x }}
      animate={{ opacity: 1, x }}
      transition={{ ...spring.fast, opacity: spring.fast }}
      y={y}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      rx={Math.min(6, Math.max(0, width) / 2)}
      fill={fill}
      pointerEvents="none"
    />
  );
}

/**
 * A bar whose strength springs with hover: the resting `opacity` (the
 * peak-at-full / others-reduced reading) rises toward full while the bar is
 * under the pointer, on `spring.fast`. Use from a Bar's `shape` render
 * function, passing the per-bar `opacity` and whether it is `hovered`.
 */
export function FluidBar({
  opacity,
  hovered,
  ...props
}: BarShapeProps & {
  readonly opacity: number;
  readonly hovered: boolean;
}) {
  const target = hovered ? Math.min(1, opacity + 0.3) : opacity;
  // Recharts hands the shape its whole entry (payload, tooltip position,
  // indices…); Rectangle reads only the geometry and SVG props it knows.
  const rectangle = props as unknown as RectangleProps;
  // A zero draws nothing: no 1px stub that reads as "some".
  if (!(Number(rectangle.height) > 0) || !(Number(rectangle.width) > 0)) {
    return <g />;
  }
  return (
    <motion.g
      initial={false}
      animate={{ opacity: target }}
      transition={spring.fast}
    >
      <Rectangle {...rectangle} fillOpacity={1} />
    </motion.g>
  );
}

/**
 * A bar in the one series style: ink, at the opacity `seriesOpacity` gives
 * it, lifting while hovered. Use from a Bar's `shape` render function:
 *
 *   shape={(props: BarShapeProps) => (
 *     <SeriesBar {...props} tokens={tokens}
 *       emphasis={isPeakOrSelected(props.originalDataIndex)}
 *       hovered={props.originalDataIndex === hoverIndex} />
 *   )}
 */
export function SeriesBar({
  tokens,
  emphasis,
  dimmed = false,
  hovered,
  ...props
}: BarShapeProps & {
  readonly tokens: ChartTokens;
  readonly emphasis: boolean;
  readonly dimmed?: boolean;
  readonly hovered: boolean;
}) {
  return (
    <FluidBar
      {...props}
      fill={seriesColor(tokens)}
      opacity={seriesOpacity({ emphasis, dimmed })}
      hovered={hovered}
    />
  );
}

/** The hovered category index from a Recharts mouse event, or null. */
export function activeIndexOf(
  state: MouseHandlerDataParam | undefined,
): number | null {
  const index = state?.activeTooltipIndex;
  if (index === undefined || index === null) {
    return null;
  }
  const parsed = typeof index === "number" ? index : Number(index);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Recharts 3 makes the plot focusable (its keyboard accessibility layer), and
 * the browser then draws its default outline on a mouse press. This keeps the
 * outline for keyboard focus only, as an FF focus ring. Put it on the
 * `ResponsiveContainer` (or any wrapper around a chart).
 */
export const CHART_FOCUS_CLASS =
  "[&_:focus]:outline-none [&_:focus-visible]:rounded-lg [&_:focus-visible]:outline-1 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-focus-ring";

/** Centred note for a chart with nothing to draw (body, muted). */
export function ChartEmpty({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className={cn(
        typeClass("body"),
        "flex h-full min-h-[120px] items-center justify-center px-4 text-center text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/* ───────────────────────────── Formatting ───────────────────────────── */

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

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

/** "12 AM" / "9 PM" style hour label, shared with the Overview's highlight strip. */
export function formatHour(hour: number): string {
  if (hour === 0) {
    return "12 AM";
  }
  if (hour === 12) {
    return "12 PM";
  }
  return hour < 12 ? `${String(hour)} AM` : `${String(hour - 12)} PM`;
}

/**
 * Recharts types its tooltip payload loosely and differently per chart, so the
 * one datum a tooltip needs is pulled out here behind a single narrow check
 * rather than casting at each call site.
 */
export function tooltipEntry(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  const first: unknown = payload[0];
  if (typeof first !== "object" || first === null || !("payload" in first)) {
    return null;
  }
  const row = (first as { payload: unknown }).payload;
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : null;
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
  // A drag across days ends in a click event too; that click must not undo
  // the range the drag just set.
  const dragged = useRef(false);
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
  const commitDrag = () => {
    if (
      dragStart !== null &&
      dragCurrent !== null &&
      dragStart !== dragCurrent &&
      onRangeChange !== undefined
    ) {
      dragged.current = true;
      onRangeChange(
        dragStart <= dragCurrent
          ? { from: dragStart, to: dragCurrent }
          : { from: dragCurrent, to: dragStart },
      );
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
        onMouseUp={commitDrag}
        onMouseLeave={() => {
          setHoverIndex(null);
          commitDrag();
        }}
        onClick={(state) => {
          // The whole lit band is the click target, not only the bar inside
          // it: what the hover band lights is what a click selects.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          const date = dateAt(state);
          if (date !== null) {
            selectDay(date);
          }
        }}
      >
        <CartesianGrid {...chartGrid(tokens)} />
        <XAxis
          dataKey="date"
          {...chartAxis(tokens)}
          minTickGap={40}
          tickFormatter={formatDay}
        />
        <YAxis
          width={40}
          {...chartAxis(tokens)}
          allowDecimals={false}
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
