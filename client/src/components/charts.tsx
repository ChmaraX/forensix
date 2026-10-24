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
 *  - no entrance animation of their own: bars draw in the frame their data
 *    and layout land, and the panel's `reveal-swap` is the entrance
 *    (`CHART_STATIC`).
 *
 * One series style (`SERIES`, `seriesColor`, `SeriesBar`), the same in light
 * and dark: the series is ink (`--foreground`) — FF's palette is neutral, so
 * a chart reads as part of the page rather than a coloured widget. Every bar
 * rests at one step (half ink, still 3:1 on its panel); exactly one thing is
 * emphasised at full ink: the
 * selection when there is one, else the peak (ties share it). Bars outside
 * an active range stay at rest (the range wash and its baseline mark the
 * range); the hovered bar lifts on `spring.fast`. A
 * zero draws nothing — no stub. Counts are integers, so they are drawn as
 * bars (or steps), never a smoothed line or area that invents values
 * between buckets. Evidence hues (`--wal`, `--violet`, …) appear only on
 * evidence series, always with their word.
 */
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Rectangle,
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
 *
 * `rest` is the lightest step a bar can take and still be seen: ink at 0.5
 * is 3.4:1 on a light panel and 4.6:1 on a dark one (WCAG 1.4.11 asks 3:1
 * of a graphic that carries the data's shape). `dimmed` (outside an active
 * range) is the same step on purpose: a picked day that drew nothing must
 * not fade every other bar to near-invisible. The range reads from its
 * wash, its baseline and the full-ink bars inside it.
 */
export const SERIES = {
  rest: 0.5,
  emphasis: 1,
  dimmed: 0.5,
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
 * Recharts' own entrance animation is off for every series. It is a
 * JavaScript tween keyed to the identity of the series' derived geometry,
 * so each re-render that rebuilds it (a page loading its lists, a pointer
 * resting on the chart) restarts the tween from where it stood - on a busy
 * page the bars sat near zero for seconds. Bars therefore draw in the
 * frame their data and layout land; the panel's `reveal-swap` fade is the
 * entrance (and respects reduced motion). Spread onto `Bar` / `Area` /
 * `Line` / `Scatter` / `RadialBar`.
 */
export const CHART_STATIC = { isAnimationActive: false } as const;

/**
 * FF's `spring.moderate` as a CSS timing: the same `linear()` curve and
 * length app.css's `reveal-product` writes in `--reveal-motion`, for motion
 * only CSS can run (the Recharts tooltip box). One easing system: springs
 * in motion code, their `linear()` form in CSS.
 */
const MODERATE_CSS = {
  duration: 200,
  easing: "linear(0, 0.5729, 0.8966, 0.9789, 0.996, 1, 1)",
} as const;

/**
 * Tooltip wrapper motion: the box follows the pointer on the
 * `spring.moderate` tier (short travel, `MODERATE_CSS`), still under
 * reduced motion. Spread onto `Tooltip` next to `content` and `cursor`.
 */
export function chartTooltipMotion(reduced: boolean): {
  readonly isAnimationActive: boolean;
  readonly animationDuration: number;
  readonly animationEasing: "ease-out";
  readonly wrapperStyle: { readonly outline: "none" };
} {
  return {
    isAnimationActive: !reduced,
    animationDuration: MODERATE_CSS.duration,
    // Recharts types its easing as the CSS keywords but writes any string
    // into the box's `transition` as is.
    animationEasing: MODERATE_CSS.easing as unknown as "ease-out",
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
 * For a chart that keeps Recharts' own keyboard layer (a focusable plot):
 * the browser's outline is dropped on a pointer press and kept, as the 2px
 * FF focus ring, for keyboard focus. Put it on the `ResponsiveContainer`
 * (or any wrapper around a chart). The ready charts (`DayBars`,
 * `ActivityBars`, `HourBars`) don't need it: their `ChartFrame` is the
 * focusable element and draws the ring itself.
 *
 * (`:focus` and `:focus-visible` both match a keyboard-focused plot, so the
 * outline is removed only for focus that is *not* focus-visible.)
 */
export const CHART_FOCUS_CLASS =
  "[&_:focus:not(:focus-visible)]:outline-none [&_:focus-visible]:rounded-lg [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-solid [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-focus-ring";

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
