/**
 * Pointer, touch and keyboard input for a per-day chart, and the frame that
 * makes a chart a named, keyboard-reachable control with a text equivalent.
 * The rules themselves are pure, in `chart-keys.ts`; this file wires them to
 * events. Used by `DayBars` / `ActivityBars` / `HourBars` (charts-ready).
 *
 * Why not Recharts' own layer: it is mouse-only for drags (`onMouse*`), its
 * keyboard layer moves a tooltip but cannot pick, and its plot is an unnamed
 * `svg[role=application]`. So the chart's Recharts `accessibilityLayer` is
 * off and this layer owns input:
 *
 *  - Pointer events on the frame (mouse, pen, touch alike). The frame is
 *    `touch-action: pan-y`: a vertical swipe still scrolls the page (the
 *    browser then cancels the pointer, and nothing is committed); a
 *    horizontal drag selects. A press reads its band from the plot area
 *    Recharts reports (`ChartPlotProbe`), clamped to the plot, so a drag
 *    that leaves the chart keeps its edge day. Release commits; cancel,
 *    blur or Escape drops it. After a touch the tooltip is put away.
 *  - The keyboard on the frame (`role="application"`, one tab stop): see
 *    `chartKeyEffect`. The keyboard cursor draws the same `--hover` band as
 *    the pointer (`ChartCursorBand`) and its own tooltip card.
 *  - Text: the frame is named by a summary of the series (span, total,
 *    busiest), a polite live region reads the cursor's day and every
 *    committed range, and a visually hidden table lists every non-zero day
 *    beside the chart.
 */
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DefaultZIndexes, usePlotArea, ZIndexLayer } from "recharts";

import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import { FluidBandCursor } from "./charts.js";
import {
  bandIndexAt,
  chartKeyEffect,
  hasSpan,
  pickDay,
  releaseSpan,
  spanOf,
  startIndex,
  type ChartKeyEffect,
  type DaySpan,
} from "./chart-keys.js";

/** The plot area inside the chart's SVG, as Recharts lays it out. */
export interface ChartPlot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Put inside a Recharts chart: reports its plot area to `onPlot` whenever
 * it changes, so pointer positions map to bands exactly as Recharts draws
 * them. Renders nothing.
 */
export function ChartPlotProbe({
  onPlot,
}: {
  readonly onPlot: (plot: ChartPlot) => void;
}) {
  const plot = usePlotArea();
  const x = plot?.x ?? 0;
  const y = plot?.y ?? 0;
  const width = plot?.width ?? 0;
  const height = plot?.height ?? 0;
  useEffect(() => {
    if (width > 0) {
      onPlot({ x, y, width, height });
    }
  }, [onPlot, x, y, width, height]);
  return null;
}

/**
 * The keyboard cursor's band, inside a Recharts chart: the same `--hover`
 * band the pointer lights (`FluidBandCursor`, gliding on `spring.fast`),
 * drawn behind the bars.
 */
export function ChartCursorBand({
  index,
  count,
  fill,
}: {
  readonly index: number;
  readonly count: number;
  /** Resolved `--hover` colour. */
  readonly fill: string;
}) {
  const plot = usePlotArea();
  if (plot === undefined || count <= 0) {
    return null;
  }
  const band = plot.width / count;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.cursorRectangle}>
      <FluidBandCursor
        fill={fill}
        x={plot.x + index * band}
        y={plot.y}
        width={band}
        height={plot.height}
      />
    </ZIndexLayer>
  );
}

/**
 * The wash behind a picked span, inside a Recharts chart: `chartRange`'s ink
 * at 0.06 over bands `from..to` (indices, inclusive). It fades in on
 * `spring.fast` and, as the span changes (a drag, a Shift-stretch, a
 * picker edit), its edges glide on `spring.moderate`, so a range change
 * reads as the same span moving rather than one block swapped for another.
 * Under reduced motion only the fade remains (MotionConfig).
 */
export function ChartRangeWash({
  from,
  to,
  count,
  fill,
  opacity,
}: {
  /** First and last band of the span, or null for no wash. */
  readonly from: number | null;
  readonly to: number | null;
  readonly count: number;
  /** Resolved series colour. */
  readonly fill: string;
  readonly opacity: number;
}) {
  const plot = usePlotArea();
  const band = plot === undefined || count <= 0 ? 0 : plot.width / count;
  const shown =
    plot !== undefined &&
    from !== null &&
    to !== null &&
    from >= 0 &&
    to > from;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.area}>
      <AnimatePresence>
        {shown ? (
          <motion.rect
            key="wash"
            initial={{
              opacity: 0,
              x: plot.x + from * band,
              width: (to - from + 1) * band,
            }}
            animate={{
              opacity,
              x: plot.x + from * band,
              width: (to - from + 1) * band,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={{ ...spring.moderate, opacity: spring.fast }}
            y={plot.y}
            height={plot.height}
            rx={6}
            fill={fill}
            pointerEvents="none"
          />
        ) : null}
      </AnimatePresence>
    </ZIndexLayer>
  );
}

interface Drag {
  readonly pointerId: number;
  readonly start: number;
  readonly current: number;
}

/** What a chart reads from `useChartInput`. */
export interface ChartInput {
  /** The plot reporter for `ChartPlotProbe`. */
  readonly setPlot: (plot: ChartPlot) => void;
  readonly plot: ChartPlot | null;
  /** The band the pointer is over, or the keyboard cursor's: the bar that
   *  lifts. */
  readonly hoverIndex: number | null;
  /** The keyboard cursor, or null when the keyboard is not driving. */
  readonly cursor: number | null;
  /** The washed span: a press in progress, else the page's range clamped
   *  to the drawn days; null without either. */
  readonly highlight: DaySpan | null;
  /** True while a press is in progress. */
  readonly pending: boolean;
  /** Pass to the Recharts `Tooltip`'s `active`: false while the keyboard
   *  drives (the frame draws its own card) or after a touch. */
  readonly tooltipActive: false | undefined;
  /** Polite live-region text (the cursor's day, a committed range). */
  readonly announcement: string;
  /** Spread onto the focusable frame element. */
  readonly frameProps: {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
    readonly onBlur: () => void;
  };
}

/**
 * Input state for a chart of `dates.length` day bands (or any categories:
 * `dates` are the category keys). With `onRangeChange` the chart picks
 * ranges (see `chart-keys.ts`); without it the keyboard only browses.
 * `describe(index)` is the cursor's reading for the live region;
 * `describeSpan(range)` the words for a committed range.
 */
export function useChartInput({
  dates,
  values,
  range,
  onRangeChange,
  describe,
  describeSpan,
}: {
  readonly dates: readonly string[];
  readonly values: readonly number[];
  readonly range?: DaySpan;
  readonly onRangeChange?: (range: DaySpan) => void;
  readonly describe: (index: number) => string;
  readonly describeSpan?: (range: DaySpan) => string;
}): ChartInput {
  const selectable = onRangeChange !== undefined;
  const count = dates.length;
  const [plot, setPlotState] = useState<ChartPlot | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pointerIndex, setPointerIndex] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const frameRef = useRef<HTMLElement | null>(null);

  const setPlot = useCallback((next: ChartPlot) => {
    setPlotState((current) =>
      current !== null &&
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next,
    );
  }, []);

  // A cursor past the end (the days changed under it) is put back in range.
  const clampedCursor =
    cursor === null || count === 0 ? null : Math.min(cursor, count - 1);

  const commit = useCallback(
    (next: DaySpan) => {
      if (onRangeChange === undefined) {
        return;
      }
      onRangeChange(next);
      setAnnouncement(
        hasSpan(next)
          ? (describeSpan?.(next) ?? `Selected ${next.from} to ${next.to}`)
          : "Showing all recorded days",
      );
    },
    [onRangeChange, describeSpan],
  );

  const indexAt = useCallback(
    (clientX: number): number | null => {
      const frame = frameRef.current;
      if (frame === null || plot === null) {
        return null;
      }
      const left = frame.getBoundingClientRect().left;
      return bandIndexAt(clientX - left, plot.x, plot.width, count);
    },
    [plot, count],
  );

  // A press in progress follows its pointer anywhere on the page and ends
  // on release (commit) or cancel (nothing).
  useEffect(() => {
    if (drag === null) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      const index = indexAt(event.clientX);
      if (index !== null && index !== drag.current) {
        setDrag({ ...drag, current: index });
      }
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      const index = indexAt(event.clientX) ?? drag.current;
      const start = dates[drag.start];
      const end = dates[index];
      setDrag(null);
      if (event.pointerType !== "mouse") {
        setTouched(true);
        setPointerIndex(null);
      }
      if (start !== undefined && end !== undefined) {
        commit(releaseSpan(start, end, range));
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === drag.pointerId) {
        setDrag(null);
        setPointerIndex(null);
      }
    };
    const onWindowBlur = () => {
      setDrag(null);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onCancel);
    globalThis.addEventListener("blur", onWindowBlur);
    return () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onCancel);
      globalThis.removeEventListener("blur", onWindowBlur);
    };
  }, [drag, indexAt, dates, range, commit]);

  const applyKey = (effect: ChartKeyEffect) => {
    switch (effect.kind) {
      case "move": {
        setCursor(effect.cursor);
        setAnchor(effect.anchor);
        const from = effect.anchor === null ? undefined : dates[effect.anchor];
        const to = dates[effect.cursor];
        if (from !== undefined && to !== undefined) {
          // A Shift-stretch commits each step, as a drag's release would.
          commit(spanOf(from, to));
        } else {
          setAnnouncement(describe(effect.cursor));
        }
        return;
      }
      case "pick": {
        const date = dates[effect.index];
        if (date !== undefined) {
          commit(pickDay(date, range));
        }
        return;
      }
      case "commit": {
        const from = dates[effect.from];
        const to = dates[effect.to];
        setAnchor(null);
        if (from !== undefined && to !== undefined) {
          commit(spanOf(from, to));
        }
        return;
      }
      case "clear": {
        setAnchor(null);
        commit({ from: "", to: "" });
        return;
      }
    }
  };

  const start = useMemo(
    () => startIndex(dates, values, range),
    [dates, values, range],
  );

  const frameProps: ChartInput["frameProps"] = {
    onPointerDown: (event) => {
      setTouched(false);
      setCursor(null);
      setAnchor(null);
      if (!selectable || !event.isPrimary) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      const index = indexAt(event.clientX);
      if (index === null) {
        return;
      }
      setDrag({ pointerId: event.pointerId, start: index, current: index });
      setPointerIndex(index);
    },
    onPointerMove: (event) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        if (touched) {
          setTouched(false);
        }
        setCursor(null);
        setPointerIndex(indexAt(event.clientX));
      } else if (drag !== null) {
        setPointerIndex(indexAt(event.clientX));
      }
    },
    onPointerLeave: () => {
      if (drag === null) {
        setPointerIndex(null);
      }
    },
    onKeyDown: (event) => {
      if (event.key === "Escape" && drag !== null) {
        event.preventDefault();
        setDrag(null);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const effect = chartKeyEffect(
        event.key,
        event.shiftKey,
        { cursor: clampedCursor, anchor },
        { count, start, selectable, ranged: hasSpan(range) },
      );
      if (effect === null) {
        return;
      }
      event.preventDefault();
      // Escape here belongs to the chart: it must not also close a sheet.
      event.stopPropagation();
      setTouched(false);
      setPointerIndex(null);
      applyKey(effect);
    },
    onFocus: (event) => {
      frameRef.current = event.currentTarget;
      // Keyboard focus shows where the cursor stands; a pointer press
      // focuses the frame too, and must not.
      if (event.currentTarget.matches(":focus-visible") && count > 0) {
        setCursor(start);
        setAnnouncement(describe(start));
      }
    },
    onBlur: () => {
      setCursor(null);
      setAnchor(null);
    },
  };

  // Each band's highlight: a press in progress, else the page's range with
  // open sides run to the drawn edge.
  const highlight = useMemo((): DaySpan | null => {
    if (drag !== null) {
      const from = dates[drag.start];
      const to = dates[drag.current];
      return from === undefined || to === undefined ? null : spanOf(from, to);
    }
    if (range === undefined || !hasSpan(range)) {
      return null;
    }
    const first = dates[0] ?? "";
    const last = dates[dates.length - 1] ?? "";
    return {
      from: range.from === "" || range.from < first ? first : range.from,
      to: range.to === "" || range.to > last ? last : range.to,
    };
  }, [drag, range, dates]);

  return {
    setPlot,
    plot,
    hoverIndex: clampedCursor ?? (drag !== null ? drag.current : pointerIndex),
    cursor: clampedCursor,
    highlight,
    pending: drag !== null,
    tooltipActive: clampedCursor !== null || touched ? false : undefined,
    announcement,
    frameProps: {
      ...frameProps,
      // The frame element is needed for pointer maths before it is
      // focused; a pointer down always lands on it first.
      onPointerDown: (event) => {
        frameRef.current = event.currentTarget;
        frameProps.onPointerDown(event);
      },
      onPointerMove: (event) => {
        frameRef.current = event.currentTarget;
        frameProps.onPointerMove(event);
      },
    },
  };
}

/** One row of a chart's text equivalent. */
export interface ChartTableRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

/**
 * The chart as a control: one focusable `role="application"` frame named
 * by `label`, with a visually hidden key hint, the keyboard cursor's
 * tooltip card (`tip`, drawn where the band is), a polite live region, and
 * a visually hidden table (`table`) beside it as the text equivalent.
 * `children` is the `ResponsiveContainer`.
 */
export function ChartFrame({
  input,
  label,
  count,
  selectable,
  tip,
  table,
  className,
  children,
}: {
  readonly input: ChartInput;
  /** The series summary, e.g. "Page visits per day, 11 Mar 2024 to 17 Apr
   *  2024: 22 in total, busiest 14 Mar 2024 with 3". */
  readonly label: string;
  /** Number of bands. */
  readonly count: number;
  /** The chart picks ranges (pointer cursor, key hint). */
  readonly selectable: boolean;
  /** The keyboard cursor's tooltip content, or null. */
  readonly tip: ReactNode;
  readonly table: {
    readonly caption: string;
    readonly columns: readonly [string, string];
    readonly rows: readonly ChartTableRow[];
  };
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const hintId = useId();
  const { plot, cursor } = input;
  const band = plot === null || count === 0 ? 0 : plot.width / count;
  const centre =
    plot === null || cursor === null ? null : plot.x + (cursor + 0.5) * band;
  // The card sits beside the band, on the side with room (as Recharts
  // places its own tooltip).
  const flip =
    plot !== null && centre !== null && centre > plot.x + plot.width / 2;
  return (
    <div className={cn("relative h-full w-full", className)}>
      <div
        role="application"
        tabIndex={0}
        aria-label={label}
        aria-describedby={hintId}
        {...input.frameProps}
        onMouseDown={(event) => {
          // A press must not focus a Recharts layer inside the frame (they
          // carry tabindex="-1" and would draw the browser's ring), nor
          // start a text selection. Focus stays where it was: a script
          // focus here would read as keyboard focus and show the ring.
          event.preventDefault();
        }}
        className={cn(
          "relative h-full w-full touch-pan-y rounded-lg outline-none select-none [&_svg_:focus]:outline-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
          selectable && "cursor-pointer",
          input.pending && "cursor-crosshair",
        )}
      >
        {children}
        {tip === null || centre === null || plot === null ? null : (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 z-10"
            initial={{ opacity: 0, x: centre, y: plot.y }}
            animate={{ opacity: 1, x: centre, y: plot.y }}
            transition={spring.moderate}
          >
            <div
              style={{
                transform: flip
                  ? `translateX(calc(-100% - ${String(band / 2 + 8)}px))`
                  : `translateX(${String(band / 2 + 8)}px)`,
              }}
            >
              {tip}
            </div>
          </motion.div>
        )}
      </div>
      <span id={hintId} className="sr-only">
        {selectable
          ? "Left and right arrows move between days, Home and End go to the first and last. Enter picks a day, Shift with the arrows picks a span, Escape clears it."
          : "Left and right arrows move between bars."}
      </span>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {input.announcement}
      </p>
      <table className="sr-only">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{table.columns[0]}</th>
            <th scope="col">{table.columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
