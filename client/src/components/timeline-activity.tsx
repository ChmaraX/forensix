/**
 * The Timeline page's activity widget: a figure strip and the per-day
 * histogram of saved page visits, above the chronological records.
 *
 * The chart is the shared `ActivityBars` (the one chart for "visits per
 * day", the same as Overview and History). Dragging across it picks a date
 * range, clicking a bar focuses that one day (clicking it again clears),
 * and the calendar picker offers the same range with keyboard/exact-date
 * precision; the records below filter on it. The figures restate the chart
 * for the focused range.
 *
 * Saved and recovered visits are counted apart (forensic rule 4): the chart
 * and figures count saved (committed) activity rows; recovered visits are
 * named in a note, never summed in. A figure still being read is a
 * skeleton, a failed read reads "unavailable" — never a zero or a dash.
 */
import { useCallback, useMemo } from "react";

import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { bucketsToDays, fillGaps } from "./activity-data.js";
import { ActivityBars, type DayCount, useChartTokens } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { figure, type Read } from "./history-figures.js";
import { useSplitActivity, visitTotal } from "./history-activity-data.js";
import { RevealSwap } from "./history-list-block.js";
import { ErrorRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Skeleton } from "./ui/misc.js";
import { CHART_HEIGHT, formatDay, plural } from "./page-kit.js";

export interface DayRange {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
}

function inRange(date: string, range: DayRange): boolean {
  return (
    (range.from === "" || date >= range.from) &&
    (range.to === "" || date <= range.to)
  );
}

interface RangeFigures {
  readonly visits: number;
  readonly active: number;
  readonly busiest: DayCount | null;
  readonly recovered: number;
}

/**
 * The widget. `range` is owned by the page so the records below can filter
 * on it; the chart, the picker, and the picker's clear button all read and
 * write the same value.
 */
export function TimelineActivityCard({
  range,
  onRangeChange,
}: {
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
}) {
  const tokens = useChartTokens();
  const size = useSize();
  const { activity, error, retry } = useSplitActivity();
  const hasRange = range.from !== "" || range.to !== "";

  // Saved days, gap-filled so the x-axis is real calendar time.
  const days = useMemo<readonly DayCount[] | null>(
    () => (activity === null ? null : fillGaps(bucketsToDays(activity.saved))),
    [activity],
  );

  // The picker spans every recorded day, saved or recovered: its range
  // filters the records below, which hold both.
  const span = useMemo(() => {
    if (activity === null) {
      return { min: null, max: null };
    }
    const all = bucketsToDays([...activity.saved, ...activity.recovered]);
    return {
      min: all[0]?.date ?? null,
      max: all[all.length - 1]?.date ?? null,
    };
  }, [activity]);

  const figures = useMemo<Read<RangeFigures>>(() => {
    if (error !== null) {
      return { state: "failed" };
    }
    if (days === null || activity === null) {
      return { state: "loading" };
    }
    const focused = days.filter((day) => inRange(day.date, range));
    const busiest = focused.reduce<DayCount | null>(
      (best, day) =>
        day.count > 0 && (best === null || day.count > best.count) ? day : best,
      null,
    );
    return {
      state: "ready",
      value: {
        visits: focused.reduce((sum, day) => sum + day.count, 0),
        active: focused.filter((day) => day.count > 0).length,
        busiest,
        recovered: visitTotal(
          activity.recovered.filter((bucket) => inRange(bucket.date, range)),
        ),
      },
    };
  }, [days, activity, error, range]);

  // A bar is "selected" only when the range is pinned to that one day.
  const selectedDate =
    range.from !== "" && range.from === range.to ? range.from : null;
  const onSelectDay = useCallback(
    (date: string) => {
      onRangeChange(
        range.from === date && range.to === date
          ? { from: "", to: "" }
          : { from: date, to: date },
      );
    },
    [range, onRangeChange],
  );

  const detail = (text: (value: RangeFigures) => string) =>
    figures.state === "ready"
      ? text(figures.value)
      : figures.state === "failed"
        ? "the activity read failed"
        : "reading activity";

  const recovered = figures.state === "ready" ? figures.value.recovered : 0;

  return (
    <>
      <MetricBand className="grid-cols-2 lg:grid-cols-4">
        <MetricBandItem
          label={hasRange ? "Saved visits in range" : "Saved visits"}
          value={figure(figures, (value) =>
            value.visits.toLocaleString("en-US"),
          )}
          detail={detail((value) =>
            value.recovered === 0
              ? "none recovered"
              : `${value.recovered.toLocaleString("en-US")} recovered, not counted`,
          )}
        />
        <MetricBandItem
          label="Active days"
          value={figure(figures, (value) =>
            value.active.toLocaleString("en-US"),
          )}
          detail={detail(() =>
            hasRange ? "with a saved visit, in range" : "with a saved visit",
          )}
        />
        <MetricBandItem
          label="Busiest day"
          value={figure(figures, (value) =>
            value.busiest === null ? "none" : formatDay(value.busiest.date),
          )}
          detail={detail((value) =>
            value.busiest === null
              ? "no saved visits in view"
              : plural(value.busiest.count, "saved visit", "saved visits"),
          )}
        />
        <MetricBandItem
          label="Recorded span"
          value={figure(figures, () =>
            span.min === null || span.max === null
              ? "none"
              : plural(
                  Math.round(
                    (Date.parse(`${span.max}T00:00:00Z`) -
                      Date.parse(`${span.min}T00:00:00Z`)) /
                      86_400_000,
                  ) + 1,
                  "day",
                  "days",
                ),
          )}
          detail={detail(() =>
            span.min === null || span.max === null
              ? "no dated visits"
              : span.min === span.max
                ? formatDay(span.min)
                : `${formatDay(span.min)} to ${formatDay(span.max)}`,
          )}
        />
      </MetricBand>

      <ChartSection
        title="Activity"
        description="Saved page visits per day. Choose a range, drag across the chart, or select a bar."
        action={
          span.min === null ? undefined : (
            <DateRangePicker
              from={range.from}
              to={range.to}
              min={span.min}
              max={span.max}
              triggerLabel="All recorded days"
              formatDate={formatDay}
              onChange={onRangeChange}
              presets
            />
          )
        }
        footer={
          recovered === 0 && activity?.complete !== false ? undefined : (
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              {recovered === 0
                ? ""
                : `${plural(recovered, "recovered visit is", "recovered visits are")} not drawn; they are listed under Recovered below. `}
              {activity?.complete === false
                ? "Drawn from the first activity rows read; more exist in the Case."
                : ""}
            </p>
          )
        }
      >
        {error !== null ? (
          <ErrorRows
            title="The activity chart could not be loaded."
            message={error}
            onRetry={retry}
          />
        ) : (
          <div className="px-2 pt-2 pb-3">
            <RevealSwap
              loading={days === null}
              skeleton={
                <div role="status" aria-label="Loading activity">
                  <Skeleton className={cn(CHART_HEIGHT, "w-full rounded-lg")} />
                </div>
              }
            >
              <div className={cn(CHART_HEIGHT, "w-full select-none")}>
                <ActivityBars
                  days={days ?? []}
                  tokens={tokens}
                  selectedDate={selectedDate}
                  onSelectDay={onSelectDay}
                  range={range}
                  onRangeChange={onRangeChange}
                />
              </div>
            </RevealSwap>
          </div>
        )}
      </ChartSection>
    </>
  );
}
