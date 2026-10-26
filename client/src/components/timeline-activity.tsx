/**
 * The Timeline page's activity chart: saved page visits per day, above the
 * chronological records. It is the records' date filter; its axis and its
 * picker span every day the stream records an event on (a download day
 * with no visit is a zero bar that can still be picked).
 *
 * The chart is the shared `ActivityBars` (the one chart for "visits per
 * day", the same as Overview and History). Dragging across it picks a date
 * range, clicking a bar focuses that one day (clicking it again clears),
 * and the calendar picker offers the same range with keyboard/exact-date
 * precision; the records below filter on it.
 *
 * Saved and recovered visits are counted apart (forensic rule 4): the chart
 * draws saved (committed) activity rows only.
 */
import { useMemo } from "react";

import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import {
  bucketsToDays,
  fillGapsAcross,
  type useActivity,
} from "./activity-data.js";
import { type DayCount, useChartTokens } from "./charts.js";
import { ActivityBars } from "./charts-ready.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { ErrorRows, RevealSwap } from "./list-states.js";
import { Skeleton } from "./ui/misc.js";
import { CHART_HEIGHT } from "./page-kit.js";
import { formatDay } from "../day-format.js";

export interface DayRange {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
}

/**
 * The chart panel. `range` is owned by the page so the records below can
 * filter on it; the chart, the picker, and the picker's clear button all
 * read and write the same value. The page also owns the activity read: its
 * declared timezone turns the range into the records' bounds.
 */
export function TimelineActivityCard({
  range,
  onRangeChange,
  read,
  eventSpan,
}: {
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
  readonly read: ReturnType<typeof useActivity>;
  /** The first and last Case day of any recorded event (not only page
   *  visits): the axis and the picker reach them. */
  readonly eventSpan: {
    readonly min: string | null;
    readonly max: string | null;
  };
}) {
  const tokens = useChartTokens();
  const size = useSize();
  const { activity, error, retry } = read;

  // Saved days, gap-filled so the x-axis is real calendar time - across
  // every day the stream records an event on, so a download day without a
  // visit is on the axis (a zero bar) and can be picked.
  const days = useMemo<readonly DayCount[] | null>(
    () =>
      activity === null
        ? null
        : fillGapsAcross(bucketsToDays(activity.saved), eventSpan),
    [activity, eventSpan],
  );

  // The picker spans every recorded day, saved or recovered: its range
  // filters the records below, which hold both.
  const span = useMemo(() => {
    if (activity === null) {
      return { min: null, max: null };
    }
    const all = [
      ...bucketsToDays([...activity.saved, ...activity.recovered]).map(
        (day) => day.date,
      ),
      ...[eventSpan.min, eventSpan.max].filter(
        (date): date is string => date !== null,
      ),
    ].sort();
    return {
      min: all[0] ?? null,
      max: all[all.length - 1] ?? null,
    };
  }, [activity, eventSpan]);

  return (
    <ChartSection
      title="Page visits per day"
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
        activity?.complete !== false ? undefined : (
          <p className={cn(size.type.caption, "text-muted-foreground")}>
            Drawn from the first activity rows read; more exist in the Case.
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
              <div role="status">
                <span className="sr-only">Loading activity</span>
                <Skeleton className={cn(CHART_HEIGHT, "w-full rounded-lg")} />
              </div>
            }
          >
            <div className={cn(CHART_HEIGHT, "w-full select-none")}>
              <ActivityBars
                days={days ?? []}
                tokens={tokens}
                range={range}
                onRangeChange={onRangeChange}
              />
            </div>
          </RevealSwap>
        </div>
      )}
    </ChartSection>
  );
}
