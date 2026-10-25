/**
 * The History page.
 *
 * Chrome's recorded page visits, read as browsing *behavior* rather than a
 * generic evidence dump. The page is a column of FF Panels, read top-down:
 *
 *  1. Four headline figures (saved visits, active days, recorded span,
 *     distinct sites) in one MetricBand: label and value, no caption; the
 *     span's dates are its one data line. Direct reads of what the analyzer
 *     produced — never a smoothed trend, a projection, or an invented figure.
 *     They count saved (committed) visits; recovered visits are the
 *     Recovered tab's count, never summed in. While a read is in flight a
 *     figure is a skeleton; when its read failed it reads "unavailable",
 *     never "0".
 *  2. An activity-over-time bar chart (saved visits per local day) — the
 *     shared `ActivityBars`, so the same dataset never reads two different
 *     shapes. The chart drives the page's date range with the picker in
 *     its header: click a day to pin the figures and both lists to it
 *     (again to clear), drag across days for a range.
 *  3. The raw visit table, as two server reads kept apart
 *     (forensic rule 4): "Saved" (committed rows) and "Recovered" (WAL then
 *     journal rows), switched with `CommitStateSplit`. The toolbar — Sort
 *     (FF Select + a direction toggle), Arrived via, Profiles, and a search
 *     field that commits on Enter/blur — drives real server parameters for
 *     both lists. Curated columns: Time, Page (title over URL), Arrived via
 *     (the worded transition), Dwell (recorded `visitDuration`, "not
 *     recorded" when Chrome kept none — never zero), and — in the Recovered
 *     list only — the Commit State word (every saved row would say
 *     "saved"). `ResponsiveRows` stacks each row into a card below `sm`.
 *     Every wire field stays reachable through the row detail sheet.
 *
 * Presentation rules kept: the shell's coverage indicator sits by the
 * title, before any row; the four value states stay worded, never colour alone; the two
 * recovered Commit States keep their own hue *and* word; no axis is
 * projected past the last recorded day and no cell invents a count the
 * evidence does not contain.
 */
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { useCaseContext } from "../case-context.js";
import { siteHostKey } from "../site-host-key.js";
import type { Finding } from "../types.js";
import {
  commitStateStatus,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { useRowSelection, useViewTab } from "../view-state.js";
import {
  bucketsOfProfiles,
  bucketsToDays,
  fillGaps,
  useActivity,
  type SplitActivity,
} from "./activity-data.js";
import { useChartTokens } from "./charts.js";
import { ActivityBars } from "./charts-ready.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { fieldText } from "./finding-fields.js";
import {
  DEFAULT_VISIT_FILTERS,
  useVisitFilters,
  VISIT_LOOKUP,
  VisitFilterControls,
  visitParameters,
  visitsAreFiltered,
} from "./history-filters.js";
import { VisitList } from "./history-visits.js";
import { ErrorRows, RevealSwap } from "./list-states.js";
import {
  figure,
  MetricBand,
  MetricBandItem,
  type Read,
} from "./metric-band.js";
import {
  CHART_HEIGHT,
  CommitStateSplit,
  formatDay,
  formatDaySpan,
  plural,
  SectionPanel,
} from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";

const NO_PROFILES: readonly string[] = [];

/* ------------------------------- figures ---------------------------------- */

function spanDays(first: string, last: string): number | null {
  const start = new Date(`${first}T00:00:00Z`).getTime();
  const end = new Date(`${last}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.round((end - start) / 86_400_000) + 1;
}

interface ActivityFigures {
  readonly savedVisits: number;
  readonly activeDays: number;
  readonly span: { readonly first: string; readonly last: string } | null;
  /** The activity read ran out (false: stopped at its page cap, so each
   *  figure is a floor and reads "+"). */
  readonly complete: boolean;
}

/**
 * The four headline figures, label and value only. Saved visits and active
 * days come from the committed rows of the `activity` set (the same days the
 * chart draws); recovered visits are the Recovered tab's count, never added
 * in. The recorded span is the calendar distance between the first and last
 * saved day, with those days as its one data line. Distinct sites is read
 * off the loaded saved visit rows; while more rows exist it reads "N+".
 * An activity read cut off at its page cap marks its three figures "+" too.
 */
function HistoryFigures({
  activity,
  distinctHosts,
}: {
  readonly activity: Read<ActivityFigures>;
  readonly distinctHosts: Read<{ count: number; more: boolean }>;
}) {
  const span = activity.state === "ready" ? activity.value.span : null;
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Saved visits"
        value={figure(
          activity,
          (value) =>
            `${value.savedVisits.toLocaleString("en-US")}${value.complete ? "" : "+"}`,
        )}
      />
      <MetricBandItem
        label="Active days"
        value={figure(
          activity,
          (value) =>
            `${value.activeDays.toLocaleString("en-US")}${value.complete ? "" : "+"}`,
        )}
      />
      <MetricBandItem
        label="Recorded span"
        value={figure(activity, (value) => {
          const days =
            value.span === null
              ? null
              : spanDays(value.span.first, value.span.last);
          if (days === null) {
            return value.complete ? "none" : "none loaded";
          }
          return value.complete
            ? plural(days, "day", "days")
            : `${days.toLocaleString("en-US")}+ days`;
        })}
        detail={
          span === null ? undefined : formatDaySpan(span.first, span.last)
        }
      />
      <MetricBandItem
        label="Distinct sites"
        value={figure(
          distinctHosts,
          (value) =>
            `${value.count.toLocaleString("en-US")}${value.more ? "+" : ""}`,
        )}
      />
    </MetricBand>
  );
}

/* ------------------------------- activity --------------------------------- */

function ActivityPanel({
  activity,
  error,
  onRetry,
  range,
  onRangeChange,
  rangeMin,
  rangeMax,
}: {
  readonly activity: SplitActivity | null;
  readonly error: string | null;
  readonly onRetry: () => void;
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset — the same filter
   *  state the visit lists below read, so this is the one date control for
   *  the whole page, not a second one competing with it. */
  readonly range: { readonly from: string; readonly to: string };
  readonly onRangeChange: (range: { from: string; to: string }) => void;
  readonly rangeMin: string | null;
  readonly rangeMax: string | null;
}) {
  const tokens = useChartTokens();
  const size = useSize();
  // Saved days, gap-filled so the x-axis is real calendar time.
  const days = useMemo(
    () => (activity === null ? [] : fillGaps(bucketsToDays(activity.saved))),
    [activity],
  );
  return (
    <ChartSection
      title="Browsing activity"
      action={
        <DateRangePicker
          from={range.from}
          to={range.to}
          min={rangeMin}
          max={rangeMax}
          triggerLabel="All recorded days"
          formatDate={formatDay}
          onChange={onRangeChange}
          presets
        />
      }
      footer={
        activity === null || activity.complete ? undefined : (
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
          onRetry={onRetry}
        />
      ) : (
        <div className="px-2 pt-2 pb-3">
          <RevealSwap
            loading={activity === null}
            skeleton={
              <div role="status">
                <span className="sr-only">Loading activity</span>
                <Skeleton className={cn(CHART_HEIGHT, "w-full rounded-lg")} />
              </div>
            }
          >
            <div className={cn(CHART_HEIGHT, "w-full")}>
              <ActivityBars
                days={days}
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

/* --------------------------------- page ----------------------------------- */

export function HistoryPage() {
  // Every Profile the Case has, for the toolbar's Profiles menu (the
  // shell's one read); none hides the Profiles filter.
  const profiles = useCaseContext().context?.profiles ?? NO_PROFILES;
  const {
    activity: caseWideActivity,
    error: activityError,
    retry,
  } = useActivity();
  const [filters, setFilters] = useVisitFilters();
  // The figures and the chart follow the profile pick as the lists do:
  // each activity row records its profile.
  const activity = useMemo(
    () =>
      caseWideActivity === null || filters.profiles.length === 0
        ? caseWideActivity
        : {
            ...caseWideActivity,
            saved: bucketsOfProfiles(caseWideActivity.saved, filters.profiles),
            recovered: bucketsOfProfiles(
              caseWideActivity.recovered,
              filters.profiles,
            ),
          },
    [caseWideActivity, filters.profiles],
  );
  const timeZone = activity?.timeZone ?? null;
  const parameters = useMemo(
    () => visitParameters(filters, timeZone),
    [filters, timeZone],
  );
  const visits = useCommitStateLists<Finding>("history", parameters);
  const [view, setView] = useViewTab();
  // The open row lives in the URL: Back and a refresh re-open it.
  const loadedVisits = useMemo(
    () => [...visits.saved.rows, ...visits.recovered.rows],
    [visits.saved.rows, visits.recovered.rows],
  );
  // A URL-named visit this page has not loaded is read by its reference.
  const sheet = useRowSelection(loadedVisits, VISIT_LOOKUP);

  // Figures from the saved activity rows. `days` is sparse — only days with
  // a saved visit — because "active days" literally counts its length; it
  // is never gap-filled.
  const activityFigures = useMemo<Read<ActivityFigures>>(() => {
    if (activityError !== null) {
      return { state: "failed" };
    }
    if (activity === null) {
      return { state: "loading" };
    }
    // The page's date range narrows the figures as it narrows the lists.
    const days = bucketsToDays(activity.saved, {
      from: filters.from,
      to: filters.to,
    });
    const first = days[0]?.date;
    const last = days[days.length - 1]?.date;
    return {
      state: "ready",
      value: {
        savedVisits: days.reduce((sum, day) => sum + day.count, 0),
        activeDays: days.length,
        span:
          first === undefined || last === undefined ? null : { first, last },
        complete: activity.complete,
      },
    };
  }, [activity, activityError, filters.from, filters.to]);

  // The date picker spans every recorded day, saved or recovered: its range
  // filters both visit lists.
  const pickerSpan = useMemo(() => {
    if (activity === null) {
      return { min: null, max: null };
    }
    const days = bucketsToDays([...activity.saved, ...activity.recovered]);
    return {
      min: days[0]?.date ?? null,
      max: days[days.length - 1]?.date ?? null,
    };
  }, [activity]);

  // Distinct sites: a floor read off the loaded saved visit rows, marked
  // "N+" while more exist rather than claimed as the Case total.
  const saved = visits.saved;
  const distinctHosts = useMemo<Read<{ count: number; more: boolean }>>(() => {
    if (saved.error !== null && saved.rows.length === 0) {
      return { state: "failed" };
    }
    if (saved.loading && saved.rows.length === 0) {
      return { state: "loading" };
    }
    const hosts = new Set<string>();
    for (const row of saved.rows) {
      // Keyed as Sites keys a host, so the figure and Sites agree.
      const host = siteHostKey(fieldText(row.fields.url));
      if (host !== null) {
        hosts.add(host);
      }
    }
    return {
      state: "ready",
      value: { count: hosts.size, more: saved.cursor !== null },
    };
  }, [saved.rows, saved.loading, saved.error, saved.cursor]);

  const filtersActive = visitsAreFiltered(filters);
  // The tabs count every loaded visit (the filters are server parameters).
  const { split } = commitStateStatus(visits, {
    saved: visits.saved.rows.length,
    recovered: visits.recovered.rows.length,
  });
  const chartRange = useMemo(
    () => ({ from: filters.from, to: filters.to }),
    [filters.from, filters.to],
  );
  const onRangeChange = useCallback(
    ({ from, to }: { from: string; to: string }) => {
      setFilters((current) => ({ ...current, from, to }));
    },
    [setFilters],
  );

  const select = sheet.select;

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_VISIT_FILTERS);
  }, [setFilters]);

  return (
    <div className="flex flex-col gap-5">
      <HistoryFigures
        activity={activityFigures}
        distinctHosts={distinctHosts}
      />

      <ActivityPanel
        activity={activity}
        error={activityError}
        onRetry={retry}
        range={chartRange}
        onRangeChange={onRangeChange}
        rangeMin={pickerSpan.min}
        rangeMax={pickerSpan.max}
      />

      {/* The raw visit stream, saved and recovered as two server reads.
          Curated columns; every wire field stays reachable through the row
          detail sheet. */}
      <SectionPanel
        id="history-visits-title"
        title="Recorded visits"
        aside={
          filtersActive ? (
            <Button
              variant="ghost"
              size="compact"
              className="ml-auto"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          ) : undefined
        }
      >
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered visits"
          {...split}
          toolbar={
            <VisitFilterControls
              filters={filters}
              setFilters={setFilters}
              profiles={profiles}
            />
          }
          saved={
            <VisitList
              list={visits.saved}
              recovered={false}
              filters={filters}
              filtersActive={filtersActive}
              onSelect={select}
              onClearFilters={clearFilters}
            />
          }
          recovered={
            <VisitList
              list={visits.recovered}
              recovered
              filters={filters}
              filtersActive={filtersActive}
              onSelect={select}
              onClearFilters={clearFilters}
            />
          }
        />
      </SectionPanel>

      {sheet.selected !== null ? (
        <RowSheet
          selected={sheet.selected}
          title={fieldText(sheet.selected.row.fields.title) ?? "Page visit"}
          onClose={sheet.close}
        />
      ) : null}
    </div>
  );
}
