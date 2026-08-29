/**
 * The Timeline page's interactive activity widget.
 *
 * A per-day histogram of recorded page visits drawn above the chronological
 * table. Dragging across the chart (or clicking a single day) focuses the
 * table on that date range; the calendar picker offers the same range with
 * keyboard/exact-date precision. The chart states only what the evidence
 * contains: recorded visit counts per local date from the `activity` view,
 * with no smoothing and no projection past the recorded span.
 */
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type { FieldState, Finding, PageOf } from "../types.js";
import { useChartTokens, usePrefersReducedMotion } from "./charts.js";
import { DateRangePicker } from "./date-range-picker.js";
import { Skeleton } from "./ui/misc.js";

export interface DayRange {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
}

interface ActivityDay {
  readonly date: string;
  readonly count: number;
}

function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "string" ? field.value : null;
}

/** Same bounded read the Overview uses; see its `ACTIVITY_PAGE_CAP` note. */
const ACTIVITY_PAGE_CAP = 150;

/** Above this many days, gap-filling would draw more bars than pixels. */
const GAP_FILL_LIMIT = 550;

function useActivityDays() {
  const [days, setDays] = useState<readonly ActivityDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows: Finding[] = [];
      let after: string | null = null;
      for (let page = 0; page < ACTIVITY_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["view", "activity"],
          ["sort", "local-time"],
          ["direction", "asc"],
          ["limit", "100"],
        ];
        if (after !== null) {
          parameters.push(["after", after]);
        }
        const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
          "history",
          parameters,
        );
        rows.push(...result.items);
        after = result.nextCursor;
        if (after === null) {
          break;
        }
      }
      if (cancelled) {
        return;
      }
      const byDate = new Map<string, number>();
      for (const row of rows) {
        const date = fieldString(row.fields.localDate);
        const count = Number(
          fieldString(row.fields.supportingVisitCount) ?? "0",
        );
        if (date === null || Number.isNaN(count)) {
          continue;
        }
        byDate.set(date, (byDate.get(date) ?? 0) + count);
      }
      const recorded = [...byDate.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((left, right) => left.date.localeCompare(right.date));
      setDays(fillGaps(recorded));
    })().catch((requestError: unknown) => {
      if (!cancelled) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { days, error };
}

/**
 * Zero-count days between the first and last recorded day, so the x-axis is
 * continuous time and a drag maps 1:1 to calendar days. Skipped when the span
 * is so long the extra bars would cost more than the continuity is worth.
 */
function fillGaps(recorded: readonly ActivityDay[]): readonly ActivityDay[] {
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  if (first === undefined || last === undefined) {
    return recorded;
  }
  const start = new Date(`${first.date}T00:00:00Z`).getTime();
  const end = new Date(`${last.date}T00:00:00Z`).getTime();
  const span = Math.round((end - start) / 86_400_000) + 1;
  if (span <= recorded.length || span > GAP_FILL_LIMIT) {
    return recorded;
  }
  const byDate = new Map(recorded.map((day) => [day.date, day.count]));
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(start + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, count: byDate.get(date) ?? 0 };
  });
}

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

function StatBlock({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[17px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {detail === undefined ? null : (
        <span className="truncate text-[11.5px] text-muted-foreground">
          {detail}
        </span>
      )}
    </div>
  );
}

/**
 * The widget. `range` is owned by the page so the table below can filter on
 * it; the chart, the picker, and the clear pill all read and write the same
 * value.
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

  const clear = useCallback(() => {
    onRangeChange({ from: "", to: "" });
  }, [onRangeChange]);

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

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[13px] font-semibold">Activity</h2>
          <p className="text-[12px] text-muted-foreground">
            Recorded page visits per day. Drag across the chart to focus the
            table below.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {days !== null && days.length > 0 ? (
            <DateRangePicker
              from={range.from}
              to={range.to}
              min={days[0]?.date ?? null}
              max={days[days.length - 1]?.date ?? null}
              triggerLabel="All recorded days"
              formatDate={formatDay}
              onChange={onRangeChange}
            />
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {error !== null ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            The activity chart could not be loaded: {error}
          </p>
        ) : days === null ? (
          <Skeleton className="h-[168px] w-full" />
        ) : days.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No dated visits to draw.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
              {stats === null ? null : (
                <>
                  <StatBlock
                    label={hasRange ? "Visits in range" : "Recorded visits"}
                    value={stats.visits.toLocaleString("en-US")}
                  />
                  <StatBlock
                    label="Active days"
                    value={stats.active.toLocaleString("en-US")}
                  />
                  {stats.busiest === null ? null : (
                    <StatBlock
                      label="Busiest day"
                      value={stats.busiest.count.toLocaleString("en-US")}
                      detail={formatDay(stats.busiest.date)}
                    />
                  )}
                </>
              )}
              {hasRange ? (
                <button
                  type="button"
                  onClick={clear}
                  className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 self-center rounded-full border border-border bg-muted px-2.5 text-[12px] font-medium text-foreground/80 transition-colors duration-150 hover:text-foreground"
                >
                  {range.from === "" ? "…" : formatTick(range.from)} —{" "}
                  {range.to === "" ? "…" : formatTick(range.to)}
                  <X aria-hidden="true" className="size-3" />
                  <span className="sr-only">Clear the date range</span>
                </button>
              ) : null}
            </div>

            <div
              className={cn("h-[150px] w-full", dragging && "cursor-crosshair")}
              aria-label="Recorded page visits per day"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={days as ActivityDay[]}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                  onMouseDown={(state) => {
                    if (typeof state?.activeLabel === "string") {
                      setDragStart(state.activeLabel);
                      setDragCurrent(state.activeLabel);
                    }
                  }}
                  onMouseMove={(state) => {
                    if (
                      dragStart !== null &&
                      typeof state?.activeLabel === "string"
                    ) {
                      setDragCurrent(state.activeLabel);
                    }
                  }}
                  onMouseUp={commitDrag}
                  onMouseLeave={commitDrag}
                >
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={48}
                    tickFormatter={formatTick}
                    tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                  />
                  <YAxis
                    width={34}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: tokens["--muted"], opacity: 0.5 }}
                    content={({ payload }) => {
                      const entry = Array.isArray(payload)
                        ? (payload[0] as
                            | { payload?: ActivityDay }
                            | undefined)
                        : undefined;
                      const row = entry?.payload;
                      return row === undefined ? null : (
                        <div
                          className="rounded-md border px-3 py-2 text-[12px] shadow-md"
                          style={{
                            backgroundColor: tokens["--card"],
                            borderColor: tokens["--border"],
                            color: tokens["--foreground"],
                          }}
                        >
                          <p className="font-medium">{formatDay(row.date)}</p>
                          <p
                            className="tabular-nums"
                            style={{ color: tokens["--muted-foreground"] }}
                          >
                            {row.count.toLocaleString("en-US")} page visits
                          </p>
                        </div>
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
                      fillOpacity={0.08}
                      stroke={tokens["--primary"]}
                      strokeOpacity={0.25}
                    />
                  ) : null}
                  <Bar
                    dataKey="count"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={!reduced}
                    animationDuration={500}
                    minPointSize={1}
                  >
                    {days.map((day) => (
                      <Cell
                        key={day.date}
                        fill={tokens["--primary"]}
                        fillOpacity={inHighlight(day.date) ? 0.9 : 0.18}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
