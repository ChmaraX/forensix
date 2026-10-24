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
 *    motion (`chartAnimation`);
 *  - a legend where every colour sits beside its word (`ChartLegend`).
 */
import { motion } from "motion/react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  Rectangle,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type BarShapeProps,
  type MouseHandlerDataParam,
  type RectangleProps,
} from "recharts";

import { EvidenceDot, type EvidenceState } from "@/components/evidence";
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

export type ChartToken = (typeof TOKENS)[number];
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

/** The font Recharts writes into its SVG text: the app's Inter. */
export const CHART_FONT_FAMILY = "Inter, system-ui, sans-serif";

/** Axis tick style: caption size (12px), muted, Inter. Pass to `tick`. */
export function chartTick(tokens: ChartTokens): {
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

export interface ChartLegendItem {
  /** The word the colour stands for. Required: colour never stands alone. */
  readonly label: ReactNode;
  /** Resolved series colour (from `useChartTokens`). */
  readonly color?: string;
  /** Evidence state: draws the shared `EvidenceDot` instead of `color`. */
  readonly state?: EvidenceState;
  /** Mark drawn before the word. Defaults to a dot. */
  readonly shape?: "dot" | "diamond" | "bar";
}

/**
 * Chart legend: each series mark beside its word, caption size. Evidence
 * series pass `state` so the dot matches every other state mark in the app.
 */
export function ChartLegend({
  items,
  className,
}: {
  readonly items: readonly ChartLegendItem[];
  readonly className?: string;
}) {
  return (
    <ul
      className={cn(
        typeClass("caption"),
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground",
        className,
      )}
    >
      {items.map((item, index) => (
        <li key={index} className="inline-flex items-center gap-1.5">
          {item.state === undefined ? (
            <span
              aria-hidden="true"
              className={cn(
                "inline-block shrink-0",
                item.shape === "diamond"
                  ? "size-2 rotate-45 rounded-[1px]"
                  : item.shape === "bar"
                    ? "h-2 w-1 rounded-[1px]"
                    : "size-1.5 rounded-full",
              )}
              style={{ backgroundColor: item.color }}
            />
          ) : (
            <EvidenceDot state={item.state} />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
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

function visitsUnit(count: number): string {
  return count === 1 ? "page visit" : "page visits";
}

/* ─────────────────────────────── Charts ─────────────────────────────── */

/**
 * Visits per recorded day, as discrete bars — the one activity chart shared
 * by Overview and History so the same dataset never reads two different ways
 * in the same app. Each day is one recorded bucket, not a sample on a
 * continuous curve: bars are the honest reading here, an interpolated area
 * would imply a continuity between days the evidence doesn't contain. The
 * busiest day is held at full strength; every other day sits at reduced
 * opacity, so the peak reads at a glance without a second legend.
 */
export function ActivityBars({
  days,
  tokens,
  selectedDate = null,
  onSelectDay,
  range,
  onRangeChange,
  unit = "page visits",
}: {
  readonly days: readonly DayCount[];
  readonly tokens: ChartTokens;
  /** The one day currently filtered to, if any — drawn with an outline
   *  distinct from the busiest-day fill so "selected" and "peak" never read
   *  as the same signal. */
  readonly selectedDate?: string | null;
  /** Present only where a click can act on it (e.g. History); omitted, the
   *  chart stays the plain read-only reading it always was (e.g. Overview). */
  readonly onSelectDay?: (date: string) => void;
  readonly range?: { readonly from: string; readonly to: string };
  readonly onRangeChange?: (range: { from: string; to: string }) => void;
  /** Optional: the plural unit the tooltip prints after the count.
   *  Defaults to "page visits" (singular "page visit" for 1). */
  readonly unit?: string;
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
      return {
        from: range.from === "" ? range.to : range.from,
        to: range.to === "" ? range.from : range.to,
      };
    }
    return null;
  }, [dragCurrent, dragStart, range]);
  const commitDrag = () => {
    if (
      dragStart === null ||
      dragCurrent === null ||
      dragStart === dragCurrent ||
      onRangeChange === undefined
    ) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    onRangeChange(
      dragStart <= dragCurrent
        ? { from: dragStart, to: dragCurrent }
        : { from: dragCurrent, to: dragStart },
    );
    setDragStart(null);
    setDragCurrent(null);
  };
  if (days.length === 0) {
    return <ChartEmpty>No dated visits to draw.</ChartEmpty>;
  }
  const rows = days;
  const peak = rows.reduce((max, row) => Math.max(max, row.count), 0);
  const interactive = onSelectDay !== undefined || onRangeChange !== undefined;
  const dateAt = (state: MouseHandlerDataParam | undefined) => {
    const index = activeIndexOf(state);
    return index === null ? null : (rows[index]?.date ?? null);
  };
  const strengthOf = (row: DayCount) => {
    const inRange =
      highlight === null ||
      (row.date >= highlight.from && row.date <= highlight.to);
    if (!inRange) {
      return 0.2;
    }
    if (row.date === selectedDate) {
      return 1;
    }
    return peak > 0 && row.count === peak ? 1 : 0.55;
  };
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
          if (onSelectDay === undefined) {
            return;
          }
          const date = dateAt(state);
          if (date !== null) {
            onSelectDay(date);
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
                  unit={unit === "page visits" ? visitsUnit(count) : unit}
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
        {highlight !== null && highlight.from !== highlight.to ? (
          <ReferenceArea
            x1={highlight.from}
            x2={highlight.to}
            fill={tokens["--primary"]}
            fillOpacity={0.07}
            strokeOpacity={0}
            radius={6}
          />
        ) : null}
        <Bar
          dataKey="count"
          radius={[3, 3, 0, 0]}
          {...chartAnimation(reduced)}
          minPointSize={2}
          fill={tokens["--primary"]}
          shape={(props: BarShapeProps) => {
            const row = rows[props.originalDataIndex];
            const selected = row !== undefined && row.date === selectedDate;
            return (
              <FluidBar
                {...props}
                fill={tokens["--primary"]}
                stroke={selected ? tokens["--foreground"] : undefined}
                strokeWidth={selected ? 1.5 : 0}
                opacity={row === undefined ? 0.55 : strengthOf(row)}
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
                label={`${formatHour(hour)} – ${formatHour((hour + 1) % 24)}`}
              >
                <ChartTooltipValue
                  value={formatCount(count)}
                  unit={visitsUnit(count)}
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
          radius={[4, 4, 0, 0]}
          {...chartAnimation(reduced)}
          fill={tokens["--primary"]}
          shape={(props: BarShapeProps) => {
            const row = rows[props.originalDataIndex];
            return (
              <FluidBar
                {...props}
                fill={tokens["--primary"]}
                opacity={row !== undefined && row.count === peak ? 1 : 0.35}
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
 * The share of attempted artifacts the analyzer could actually read. The dial
 * is a ratio of two counts the Completeness Statement already reports; the
 * figures stay printed beside it, because a ring alone is not a statement.
 */
export function CoverageDial({
  produced,
  attempted,
  tokens,
}: {
  readonly produced: number;
  readonly attempted: number;
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  if (attempted === 0) {
    return <ChartEmpty>Nothing analyzed yet.</ChartEmpty>;
  }
  const percent = Math.round((produced / attempted) * 100);
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer
        width="100%"
        height="100%"
        className={CHART_FOCUS_CLASS}
      >
        <RadialBarChart
          data={[{ name: "readable", value: percent }]}
          innerRadius="76%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            dataKey="value"
            cornerRadius={999}
            background={{ fill: tokens["--active"] }}
            fill={tokens["--primary"]}
            {...chartAnimation(reduced)}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span
          className={cn(typeClass("title"), "text-foreground tabular-nums")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {percent}%
        </span>
        <span
          className={cn(
            typeClass("caption"),
            "text-muted-foreground tabular-nums",
          )}
        >
          {produced} of {attempted} readable
        </span>
      </div>
    </div>
  );
}

/** One credential plotted on the saved-login age chart: age since created
 *  (x, days) against dormancy since last used (y, days). Both are derived
 *  from recorded timestamps — never invented; a credential with no recorded
 *  last-use is dropped from the plot, not placed at zero. */
export interface CredentialAgePoint {
  readonly site: string;
  readonly username: string;
  /** Whole days between the recorded creation instant and now. */
  readonly ageDays: number;
  /** Whole days between the recorded last-use instant and now. */
  readonly idleDays: number;
  /** Recorded `timesUsed`, sizing the dot; `null` when the column was absent. */
  readonly timesUsed: number | null;
  /** True when the row was recovered from a sidecar, not committed storage. */
  readonly recovered: boolean;
  /** Which sidecar a recovered row came from: WAL (`--wal`, the default) or
   *  the rollback journal (`--violet`). Ignored for saved rows. */
  readonly sidecar?: "wal" | "journal";
}

/** Diamond mark for recovered points: a shape as well as a colour, and the
 *  legend word beside it, so "recovered" never rests on colour alone. */
function DiamondMark(props: unknown): ReactElement {
  const { cx, cy, size, fill } = props as {
    cx?: number;
    cy?: number;
    size?: number;
    fill?: string;
  };
  const x = cx ?? 0;
  const y = cy ?? 0;
  const r = Math.sqrt(size ?? 64) / 1.6;
  return (
    <path
      d={`M${String(x)} ${String(y - r)}L${String(x + r)} ${String(y)}L${String(x)} ${String(y + r)}L${String(x - r)} ${String(y)}Z`}
      fill={fill}
      fillOpacity={0.7}
    />
  );
}

/**
 * Saved-login age scatter. Each dot is one credential: how long ago Chrome
 * first stored it (x) against how long since it was last used (y). Dots near
 * the diagonal were saved and then left; dots low on the y-axis are recently
 * used regardless of age. Every coordinate is read straight off the recorded
 * `dateCreated` / `dateLastUsed` instants — the chart derives distances in
 * days, it does not model or predict anything the evidence does not contain.
 */
export function CredentialAgeScatter({
  points,
  tokens,
  legend = true,
}: {
  readonly points: readonly CredentialAgePoint[];
  readonly tokens: ChartTokens;
  /** Optional: the word legend under the plot (Saved / Recovered from
   *  sidecar). On by default; pass `false` when the host prints its own. */
  readonly legend?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  if (points.length === 0) {
    return <ChartEmpty>No dated logins to plot.</ChartEmpty>;
  }
  const committed = points.filter((point) => !point.recovered);
  // Recovered points take their sidecar's evidence hue (FLUID.md: WAL is
  // --wal, the rollback journal --violet), always with the legend word and
  // the diamond shape, never on colour alone.
  const wal = points.filter(
    (point) => point.recovered && point.sidecar !== "journal",
  );
  const journal = points.filter(
    (point) => point.recovered && point.sidecar === "journal",
  );
  const legendItems: ChartLegendItem[] = [
    ...(committed.length > 0
      ? [{ label: "Saved login", color: tokens["--primary"] }]
      : []),
    ...(wal.length > 0
      ? [
          {
            label:
              journal.length > 0
                ? "Recovered from WAL"
                : "Recovered from sidecar",
            color: tokens["--wal"],
            shape: "diamond" as const,
          },
        ]
      : []),
    ...(journal.length > 0
      ? [
          {
            label: "Recovered from journal",
            color: tokens["--violet"],
            shape: "diamond" as const,
          },
        ]
      : []),
  ];
  const axisLabel = {
    fill: tokens["--muted-foreground"],
    fontSize: 12,
    fontFamily: CHART_FONT_FAMILY,
  };
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer
          width="100%"
          height="100%"
          className={CHART_FOCUS_CLASS}
        >
          <ScatterChart margin={{ top: 10, right: 12, bottom: 20, left: 4 }}>
            <CartesianGrid {...chartGrid(tokens)} />
            <XAxis
              type="number"
              dataKey="ageDays"
              name="Age"
              {...chartAxis(tokens)}
              tickFormatter={(value: number) => `${String(value)}d`}
              label={{
                value: "Days since first saved",
                position: "bottom",
                offset: 4,
                ...axisLabel,
              }}
            />
            <YAxis
              type="number"
              dataKey="idleDays"
              name="Idle"
              width={64}
              {...chartAxis(tokens)}
              tickFormatter={(value: number) => `${String(value)}d`}
              label={{
                value: "Days idle",
                angle: -90,
                position: "insideLeft",
                ...axisLabel,
              }}
            />
            <ZAxis
              type="number"
              dataKey="timesUsed"
              range={[40, 320]}
              name="Uses"
            />
            <Tooltip
              {...chartTooltipMotion(reduced)}
              cursor={{
                stroke: tokens["--border"],
                strokeWidth: 1,
                strokeDasharray: "0",
              }}
              content={({ payload }) => {
                const row = tooltipEntry(payload);
                if (row === null) {
                  return null;
                }
                const uses = row["timesUsed"];
                return (
                  <ChartTooltipCard label={String(row["site"])}>
                    <p
                      className={cn(
                        typeClass("body"),
                        "truncate font-mono text-foreground",
                      )}
                    >
                      {String(row["username"])}
                    </p>
                    <ChartTooltipNote>
                      saved {String(row["ageDays"])}d ago · idle{" "}
                      {String(row["idleDays"])}d
                      {typeof uses === "number"
                        ? ` · used ${String(uses)}×`
                        : ""}
                    </ChartTooltipNote>
                    {row["recovered"] === true ? (
                      <ChartTooltipNote>
                        Recovered from sidecar
                      </ChartTooltipNote>
                    ) : null}
                  </ChartTooltipCard>
                );
              }}
            />
            <Scatter
              data={committed}
              fill={tokens["--primary"]}
              fillOpacity={0.7}
              {...chartAnimation(reduced)}
            />
            <Scatter
              data={wal}
              fill={tokens["--wal"]}
              shape={DiamondMark}
              {...chartAnimation(reduced)}
            />
            <Scatter
              data={journal}
              fill={tokens["--violet"]}
              shape={DiamondMark}
              {...chartAnimation(reduced)}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {legend ? (
        <ChartLegend items={legendItems} className="shrink-0 px-2 pb-1" />
      ) : null}
    </div>
  );
}
