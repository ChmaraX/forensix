/**
 * The Timeline page's interactive activity widget.
 *
 * A per-day histogram of recorded page visits drawn above the chronological
 * table. Dragging across the chart (or clicking a single day) focuses the
 * table on that date range; the calendar picker offers the same range with
 * keyboard/exact-date precision. The chart states only what the evidence
 * contains: recorded visit counts per local date from the `activity` view,
 * with no smoothing and no projection past the recorded span.
 *
 * Drawn from the shared FF chart parts in `charts.tsx`: quiet axes, the
 * gliding hover band, bars that gain strength under the pointer, and the FF
 * surface tooltip.
 */
import { useCallback, useMemo, useState } from "react";
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

import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { useActivityDays } from "./activity-data.js";
import {
  activeIndexOf,
  chartAnimation,
  chartAxis,
  chartGrid,
  ChartTooltipCard,
  ChartTooltipNote,
  ChartTooltipValue,
  FluidBandCursor,
  FluidBar,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
  chartTooltipMotion,
  CHART_FOCUS_CLASS,
} from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Skeleton } from "./ui/misc.js";

export interface DayRange {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
}

/** Same shape as `charts.js`'s `DayCount` — aliased here so the rest of this
 *  file (written before the two were unified) doesn't need a rename. */
type ActivityDay = import("./charts.js").DayCount;

const CHART_HEIGHT = "h-[220px]";

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTick(date: string): string {
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

/**
 * The widget. `range` is owned by the page so the table below can filter on
 * it; the chart, the picker, and the picker's clear button all read and write
 * the same value.
 */
export function TimelineActivityCard({
  range,
  onRangeChange,
}: {
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
}) {
  const tokens = useChartTokens();
  const reduced = usePrefersReducedMotion();
  const { days, error } = useActivityDays();
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const hasRange = range.from !== "" || range.to !== "";
  const dragging = dragStart !== null;

  // While dragging, the highlight follows the pointer; once committed it is
  // the page's own range. Bounds are kept sorted so a right-to-left drag
  // works the same as a left-to-right one.
  const highlight = useMemo(() => {
    if (dragStart !== null && dragCurrent !== null) {
      return dragStart <= dragCurrent
        ? { from: dragStart, to: dragCurrent }
        : { from: dragCurrent, to: dragStart };
    }
    if (dragStart !== null) {
      return { from: dragStart, to: dragStart };
    }
    return hasRange ? range : null;
  }, [dragStart, dragCurrent, hasRange, range]);

  const commitDrag = useCallback(() => {
    if (dragStart === null) {
      return;
    }
    const end = dragCurrent ?? dragStart;
    onRangeChange(
      dragStart <= end
        ? { from: dragStart, to: end }
        : { from: end, to: dragStart },
    );
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent, onRangeChange]);

  const inHighlight = useCallback(
    (date: string) =>
      highlight === null ||
      ((highlight.from === "" || date >= highlight.from) &&
        (highlight.to === "" || date <= highlight.to)),
    [highlight],
  );

  const stats = useMemo(() => {
    if (days === null) {
      return null;
    }
    const focused = days.filter((day) => inHighlight(day.date));
    const visits = focused.reduce((sum, day) => sum + day.count, 0);
    const active = focused.filter((day) => day.count > 0).length;
    const busiest = focused.reduce<ActivityDay | null>(
      (best, day) =>
        day.count > 0 && (best === null || day.count > best.count) ? day : best,
      null,
    );
    return { visits, active, busiest };
  }, [days, inHighlight]);

  const busiestNote =
    stats?.busiest === null || stats?.busiest === undefined
      ? undefined
      : `${stats.busiest.count.toLocaleString("en-US")} page visit${
          stats.busiest.count === 1 ? "" : "s"
        }`;

  const dateAt = (state: MouseHandlerDataParam | undefined) => {
    const index = activeIndexOf(state);
    return index === null || days === null ? null : (days[index]?.date ?? null);
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartSection
        title="Activity"
        description="Recorded page visits per day. Choose a range or drag across the chart."
        action={
          days !== null && days.length > 0 ? (
            <DateRangePicker
              from={range.from}
              to={range.to}
              min={days[0]?.date ?? null}
              max={days[days.length - 1]?.date ?? null}
              triggerLabel="All recorded days"
              formatDate={formatDay}
              onChange={onRangeChange}
              presets
            />
          ) : undefined
        }
      >
        <div className="px-2 pt-2 pb-3">
          {error !== null ? (
            <div className="px-2 pb-1">
              <Banner status="error" contrast="high">
                <BannerTitle>
                  The activity chart could not be loaded
                </BannerTitle>
                <BannerDescription>{error}</BannerDescription>
              </Banner>
            </div>
          ) : (
            <div className="reveal-swap">
              <div aria-hidden="true" className="px-2">
                <Skeleton className={cn(CHART_HEIGHT, "w-full rounded-lg")} />
              </div>
              {days === null ? null : days.length === 0 ? (
                <p
                  className={cn(
                    typeClass("body"),
                    CHART_HEIGHT,
                    "flex items-center justify-center text-muted-foreground",
                  )}
                >
                  No dated visits to draw.
                </p>
              ) : (
                <div
                  className={cn(
                    CHART_HEIGHT,
                    "w-full select-none",
                    dragging ? "cursor-col-resize" : "cursor-pointer",
                  )}
                  role="img"
                  aria-label="Recorded page visits per day"
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    className={CHART_FOCUS_CLASS}
                  >
                    <BarChart
                      data={days as ActivityDay[]}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                      barCategoryGap="18%"
                      onMouseDown={(state) => {
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
                    >
                      <CartesianGrid {...chartGrid(tokens)} />
                      <XAxis
                        dataKey="date"
                        {...chartAxis(tokens)}
                        minTickGap={48}
                        tickFormatter={formatTick}
                      />
                      <YAxis
                        width={40}
                        {...chartAxis(tokens)}
                        allowDecimals={false}
                        tickFormatter={(value: number) =>
                          value.toLocaleString("en-US")
                        }
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
                          const date = String(row["date"]);
                          return (
                            <ChartTooltipCard label={formatDay(date)}>
                              <ChartTooltipValue
                                value={count.toLocaleString("en-US")}
                                unit={
                                  count === 1 ? "page visit" : "page visits"
                                }
                              />
                              {dragging ? null : (
                                <ChartTooltipNote>
                                  Click to focus this day, drag for a range
                                </ChartTooltipNote>
                              )}
                            </ChartTooltipCard>
                          );
                        }}
                      />
                      {dragging &&
                      highlight !== null &&
                      highlight.from !== highlight.to ? (
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
                        minPointSize={1}
                        fill={tokens["--primary"]}
                        shape={(props: BarShapeProps) => {
                          const day = days[props.originalDataIndex];
                          return (
                            <FluidBar
                              {...props}
                              fill={tokens["--primary"]}
                              opacity={
                                day === undefined || inHighlight(day.date)
                                  ? 0.9
                                  : 0.18
                              }
                              hovered={props.originalDataIndex === hoverIndex}
                            />
                          );
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      </ChartSection>

      {days !== null && days.length > 0 && stats !== null ? (
        <MetricBand className="grid-cols-2 sm:grid-cols-3">
          <MetricBandItem
            label={hasRange ? "Visits in range" : "Recorded visits"}
            value={stats.visits.toLocaleString("en-US")}
          />
          <MetricBandItem
            label="Active days"
            value={stats.active.toLocaleString("en-US")}
          />
          <MetricBandItem
            label="Busiest day"
            value={stats.busiest === null ? "—" : formatDay(stats.busiest.date)}
            detail={busiestNote}
          />
        </MetricBand>
      ) : null}
    </div>
  );
}
