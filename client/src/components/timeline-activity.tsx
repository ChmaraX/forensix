/**
 * The Timeline page's activity chart: saved page visits per day, above the
 * chronological records. It is the records' date filter.
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

import { bucketsToDays, fillGaps, useActivity } from "./activity-data.js";
import { ActivityBars, type DayCount, useChartTokens } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { ErrorRows, RevealSwap } from "./list-states.js";
import { Skeleton } from "./ui/misc.js";
import { CHART_HEIGHT, formatDay } from "./page-kit.js";

export interface DayRange {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
}

/**
 * The chart panel. `range` is owned by the page so the records below can
 * filter on it; the chart, the picker, and the picker's clear button all
 * read and write the same value.
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
  const { activity, error, retry } = useActivity();

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
              <div role="status" aria-label="Loading activity">
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
