/**
 * The History page.
 *
 * Chrome's recorded page visits, read as browsing *behavior* rather than a
 * generic evidence dump. The page is a column of FF Panels, read top-down:
 *
 *  1. Evidence coverage — the Completeness Statement, before any row.
 *  2. Four headline figures (saved visits, active days, recorded span,
 *     distinct sites) in one MetricBand: direct reads of what the analyzer
 *     produced — never a smoothed trend, a projection, or an invented figure.
 *     They count saved (committed) visits; recovered visits are named beside
 *     them, never summed in. While a read is in flight a figure is a
 *     skeleton; when its read failed it reads "unavailable", never "0".
 *  3. An activity-over-time bar chart (saved visits per local day) — the
 *     shared `ActivityBars`, so the same dataset never reads two different
 *     shapes. Clicking a bar pins the visit table (and the date-range
 *     control in the chart's own header) to that one day; clicking it again
 *     clears back to the whole recorded span.
 *  4. The raw visit table, on FF's Table, as two server reads kept apart
 *     (forensic rule 4): "Saved" (committed rows) and "Recovered" (WAL then
 *     journal rows), switched with `CommitStateSplit`. The toolbar — Sort
 *     (FF Select + a direction toggle), Arrived via, Profiles, and a search
 *     field that commits on Enter/blur — drives real server parameters for
 *     both lists. Curated columns: Time, Page (title over URL), Arrived via
 *     (the worded transition), Dwell (recorded `visitDuration`, "not
 *     recorded" when Chrome kept none — never zero), and the Commit State
 *     word. Every wire field stays reachable through the row detail sheet.
 *
 * Presentation rules kept: the Completeness Statement renders before any
 * row; the four value states stay worded, never colour alone; the two
 * recovered Commit States keep their own hue *and* word; no axis is
 * projected past the last recorded day and no cell invents a count the
 * evidence does not contain.
 */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { FieldState, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import {
  bucketsToDays,
  fillGaps,
  useActivity,
  visitTotal,
  type SplitActivity,
} from "./activity-data.js";
import { ActivityBars, useChartTokens } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { EmptyRows } from "./data-table.js";
import { DateRangePicker } from "./date-range-picker.js";
import {
  FieldCell,
  fieldString,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows, ListBlock, RevealSwap } from "./list-states.js";
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
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/* ------------------------------- data reads ------------------------------- */

/** How many visit rows each list loads per request. */
const VISITS_PAGE_LIMIT = 100;

/** The filters the visit lists and their queries both read — every one of
 *  them a real server-side parameter `queryHistory` already accepts, not a
 *  client-side narrowing of an already-loaded page. */
interface VisitFilters {
  readonly search: string;
  readonly sort: string;
  readonly direction: "asc" | "desc";
  readonly transition: string;
  readonly from: string;
  readonly to: string;
  readonly profiles: readonly string[];
}

const DEFAULT_VISIT_FILTERS: VisitFilters = {
  search: "",
  sort: "visit-time",
  direction: "desc",
  transition: "",
  from: "",
  to: "",
  profiles: [],
};

function visitsAreFiltered(filters: VisitFilters): boolean {
  return (
    filters.search !== "" ||
    filters.transition !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.profiles.length > 0
  );
}

/** The `history` `view=visits` query for the filters (Commit State is added
 *  per list by `useCommitStateLists`). */
function visitParameters(filters: VisitFilters): QueryParameters {
  const parameters: (readonly [string, string])[] = [
    ["view", "visits"],
    ["sort", filters.sort],
    ["direction", filters.direction],
    ["limit", String(VISITS_PAGE_LIMIT)],
  ];
  if (filters.search !== "") {
    parameters.push(["search", filters.search]);
  }
  if (filters.transition !== "") {
    parameters.push(["transition", filters.transition]);
  }
  if (filters.from !== "") {
    parameters.push(["from", `${filters.from}T00:00:00Z`]);
  }
  if (filters.to !== "") {
    parameters.push(["to", `${filters.to}T23:59:59.999999Z`]);
  }
  for (const profile of filters.profiles) {
    parameters.push(["profile", profile]);
  }
  return parameters;
}

/* ------------------------------ small format ------------------------------ */

/**
 * A recorded `visitDuration` (microseconds, as a string field) read as a
 * compact human dwell — "4m 12s", "38s", "2h 05m". Returns null for a
 * non-positive value: Chrome writes 0 when it kept no dwell, so the caller
 * renders the words "not recorded" rather than a fabricated "0s".
 */
function formatDwell(field: FieldState | undefined): string | null {
  const raw = fieldString(field);
  if (raw === null) {
    return null;
  }
  const micros = Number(raw);
  if (!Number.isFinite(micros) || micros <= 0) {
    return null;
  }
  const totalSeconds = Math.round(micros / 1_000_000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The recorded Chrome core transition, as a plain-language label. An unknown
 * value passes through verbatim; a missing one keeps its own state word.
 */
const TRANSITION_LABELS: Readonly<Record<string, string>> = {
  link: "Followed a link",
  typed: "Typed the address",
  auto_bookmark: "Opened a bookmark",
  auto_subframe: "Subframe (auto)",
  manual_subframe: "Subframe (manual)",
  generated: "Address-bar suggestion",
  auto_toplevel: "Auto top-level",
  form_submit: "Submitted a form",
  reload: "Reloaded the page",
  keyword: "Keyword search",
  keyword_generated: "Keyword-generated",
};

/** Sort fields the `visits` view accepts, matching `VIEW_SORTS.visits` in
 *  `core/src/history-query.ts` exactly — a value outside this list is a
 *  request the server would reject. */
const VISIT_SORTS = ["visit-time", "url", "duration", "profile"] as const;

const SORT_LABELS: Readonly<Record<string, string>> = {
  "visit-time": "Time",
  url: "URL",
  duration: "Dwell",
  profile: "Profile",
};

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
  readonly recoveredVisits: number;
  readonly activeDays: number;
  readonly span: { readonly first: string; readonly last: string } | null;
}

/**
 * The four headline figures. Saved visits and active days come from the
 * committed rows of the `activity` set (the same days the chart draws);
 * recovered visits are named in the detail, never added in. The recorded
 * span is the calendar distance between the first and last saved day;
 * distinct sites is a floor read off the loaded saved visit rows and
 * labelled as such.
 */
function HistoryFigures({
  activity,
  distinctHosts,
}: {
  readonly activity: Read<ActivityFigures>;
  readonly distinctHosts: Read<{ count: number; more: boolean }>;
}) {
  const activityDetail = (text: (value: ActivityFigures) => string) =>
    activity.state === "ready"
      ? text(activity.value)
      : activity.state === "failed"
        ? "the activity read failed"
        : "reading activity";
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Saved visits"
        value={figure(activity, (value) =>
          value.savedVisits.toLocaleString("en-US"),
        )}
        detail={activityDetail((value) =>
          value.recoveredVisits === 0
            ? "none recovered"
            : `${value.recoveredVisits.toLocaleString("en-US")} recovered, not counted`,
        )}
      />
      <MetricBandItem
        label="Active days"
        value={figure(activity, (value) =>
          value.activeDays.toLocaleString("en-US"),
        )}
        detail={activityDetail(() => "days with a saved visit")}
      />
      <MetricBandItem
        label="Recorded span"
        value={figure(activity, (value) => {
          const days =
            value.span === null
              ? null
              : spanDays(value.span.first, value.span.last);
          return days === null ? "none" : plural(days, "day", "days");
        })}
        detail={activityDetail((value) =>
          value.span === null
            ? "no dated saved visits"
            : value.span.first === value.span.last
              ? formatDay(value.span.first)
              : `${formatDay(value.span.first)} to ${formatDay(value.span.last)}`,
        )}
      />
      <MetricBandItem
        label="Distinct sites"
        value={figure(distinctHosts, (value) =>
          value.count.toLocaleString("en-US"),
        )}
        detail={
          distinctHosts.state === "failed"
            ? "the visit read failed"
            : distinctHosts.state === "ready" && !distinctHosts.value.more
              ? "in saved visits"
              : "in loaded saved visits"
        }
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
  selectedDate,
  onSelectDay,
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
  readonly selectedDate: string | null;
  readonly onSelectDay: (date: string) => void;
}) {
  const tokens = useChartTokens();
  const size = useSize();
  // Saved days, gap-filled so the x-axis is real calendar time.
  const days = useMemo(
    () => (activity === null ? [] : fillGaps(bucketsToDays(activity.saved))),
    [activity],
  );
  const recovered = activity === null ? 0 : visitTotal(activity.recovered);
  const notes: string[] = [];
  if (recovered > 0) {
    notes.push(
      `${plural(recovered, "recovered visit is", "recovered visits are")} not drawn; they are listed under Recovered below.`,
    );
  }
  if (activity !== null && !activity.complete) {
    notes.push(
      "Drawn from the first activity rows read; more exist in the Case.",
    );
  }
  return (
    <ChartSection
      title="Browsing activity"
      description="Saved page visits per day. Choose a range or select a bar."
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
        notes.length === 0 ? undefined : (
          <p className={cn(size.type.caption, "text-muted-foreground")}>
            {notes.join(" ")}
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
              <div role="status" aria-label="Loading activity">
                <Skeleton className={cn(CHART_HEIGHT, "w-full rounded-lg")} />
              </div>
            }
          >
            <div className={cn(CHART_HEIGHT, "w-full")}>
              <ActivityBars
                days={days}
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
  );
}

/* ------------------------------- toolbar ---------------------------------- */

/** Select can't hold an empty value; this stands for "any transition". */
const ANY_TRANSITION = "\u0000any";

/** What the direction toggle says, per sort field, so the tooltip reads as
 *  what the order is ("newest first"), not as an abstract "descending". */
const DIRECTION_WORDS: Readonly<
  Record<string, { readonly desc: string; readonly asc: string }>
> = {
  "visit-time": { desc: "newest first", asc: "oldest first" },
  url: { desc: "Z to A", asc: "A to Z" },
  duration: { desc: "longest first", asc: "shortest first" },
  profile: { desc: "Z to A", asc: "A to Z" },
};

/**
 * The visit filters, laid out by the list's `Toolbar` (right of the
 * Saved / Recovered switch): Sort, Arrived via, Profiles, then the search
 * field last. Every control maps to a real server-side parameter
 * `queryHistory` accepts, so the search commits on Enter/blur.
 */
function VisitFilterControls({
  filters,
  setFilters,
  profiles,
}: {
  readonly filters: VisitFilters;
  readonly setFilters: (filters: VisitFilters) => void;
  readonly profiles: readonly string[];
}) {
  const descending = filters.direction === "desc";
  const words = DIRECTION_WORDS[filters.sort] ?? {
    desc: "descending",
    asc: "ascending",
  };
  const DirectionIcon = descending ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  const flip = `Sorted ${descending ? words.desc : words.asc}. Switch to ${
    descending ? words.asc : words.desc
  }`;

  return (
    <>
      <FilterField label="Sort" htmlFor="history-visits-sort">
        <Select
          value={filters.sort}
          onValueChange={(sort) => {
            setFilters({ ...filters, sort });
          }}
        >
          <SelectTrigger id="history-visits-sort" className="min-w-[120px]" />
          <SelectContent>
            {VISIT_SORTS.map((sort, index) => (
              <SelectItem key={sort} index={index} value={sort}>
                {SORT_LABELS[sort] ?? sort}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip content={flip}>
          <Button
            variant="ghost"
            size="icon-compact"
            aria-label={flip}
            onClick={() => {
              setFilters({
                ...filters,
                direction: descending ? "asc" : "desc",
              });
            }}
          >
            <DirectionIcon />
          </Button>
        </Tooltip>
      </FilterField>

      <FilterField label="Arrived via" htmlFor="history-visits-transition">
        <Select
          value={
            filters.transition === "" ? ANY_TRANSITION : filters.transition
          }
          onValueChange={(value) => {
            setFilters({
              ...filters,
              transition: value === ANY_TRANSITION ? "" : value,
            });
          }}
        >
          <SelectTrigger
            id="history-visits-transition"
            className="min-w-[168px]"
          />
          <SelectContent>
            <SelectItem index={0} value={ANY_TRANSITION}>
              Any transition
            </SelectItem>
            {Object.entries(TRANSITION_LABELS).map(([value, label], index) => (
              <SelectItem key={value} index={index + 1} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      {profiles.length === 0 ? null : (
        <FilterField label="Profiles" htmlFor="history-visits-profiles">
          <ProfilePicker
            id="history-visits-profiles"
            profiles={profiles}
            selected={filters.profiles}
            onChange={(selected) => {
              setFilters({ ...filters, profiles: selected });
            }}
          />
        </FilterField>
      )}

      <FilterTextField
        id="history-visits-search"
        label="Search recorded visits"
        icon={Search}
        value={filters.search}
        placeholder="Search page or URL…"
        onCommit={(search) => {
          setFilters({ ...filters, search });
        }}
      />
    </>
  );
}

/* ------------------------------- visit table ------------------------------- */

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** A visit's page: its title over its URL (mono, caption). */
function VisitPage({ row }: { readonly row: Finding }) {
  const size = useSize();
  const url = fieldText(row.fields.url);
  const title = fieldText(row.fields.title);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="min-w-0" title={title ?? undefined}>
        <FieldCell
          field={row.fields.title}
          format={asText}
          className="text-foreground"
        />
      </span>
      <span className="min-w-0" title={url ?? undefined}>
        <FieldCell
          field={row.fields.url}
          format={asText}
          className={cn(size.type.caption, "font-mono")}
        />
      </span>
    </span>
  );
}

/** The visit table's columns, and where each sits in the stacked card on a
 *  phone (`ResponsiveRows`): time and State on the first line, the page as
 *  the card's title, transition and dwell under it. */
const VISIT_COLUMNS: readonly RowColumn<Finding>[] = [
  {
    key: "time",
    header: "Time",
    className: "whitespace-nowrap",
    stack: "lead",
    cell: (row) => <TimeCell field={row.fields.visitTime} />,
  },
  {
    key: "page",
    header: "Page",
    className: "max-w-[440px]",
    stack: "title",
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <SiteAvatar host={hostOf(fieldText(row.fields.url))} />
        <VisitPage row={row} />
      </span>
    ),
    stackedCell: (row) => <VisitPage row={row} />,
  },
  {
    key: "transition",
    header: "Arrived via",
    className: "whitespace-nowrap",
    cell: (row) => (
      <FieldCell
        field={row.fields.transitionCore}
        format={(value) => TRANSITION_LABELS[asText(value)] ?? asText(value)}
      />
    ),
  },
  {
    key: "dwell",
    header: "Dwell",
    className: "whitespace-nowrap tabular-nums",
    labelled: true,
    cell: (row) => {
      const dwellField = row.fields.visitDuration;
      return dwellField?.state === "value" ? (
        (formatDwell(dwellField) ?? "not recorded")
      ) : (
        <FieldCell field={dwellField} />
      );
    },
  },
  {
    key: "state",
    header: "State",
    stack: "aside",
    cell: (row) => <StateWord state={row.commitState} />,
  },
];

function VisitTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={VISIT_COLUMNS}
      rowKey={(row, index) => `${row.commitState}-${String(index)}`}
      rowLabel={(row) =>
        `Open visit row detail: ${fieldText(row.fields.title) ?? fieldText(row.fields.url) ?? "page visit"}`
      }
      onSelect={onSelect}
      tableClassName="min-w-[760px]"
    />
  );
}

/** One of the two visit lists (Saved or Recovered): skeleton, rows, empty,
 *  errors and footer from the shared list block. */
function VisitList({
  list,
  recovered,
  filtersActive,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  readonly filtersActive: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  return (
    <ListBlock
      list={list}
      noun={
        recovered
          ? { one: "recovered visit", many: "recovered visits" }
          : { one: "saved visit", many: "saved visits" }
      }
      skeletonRows={recovered ? 3 : 8}
      filtered={filtersActive}
      filteredMessage={`No ${recovered ? "recovered" : "saved"} visits match these filters.`}
      onClearFilters={onClearFilters}
      empty={
        <EmptyRows
          title={recovered ? "No recovered visits" : "No saved visits"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a visit row."
              : "The History database holds no committed visit rows."
          }
        />
      }
    >
      <VisitTable rows={list.rows} onSelect={onSelect} />
    </ListBlock>
  );
}

/* --------------------------------- page ----------------------------------- */

function countOf(list: PaginatedList<unknown>): number | null {
  return list.loading && list.rows.length === 0 ? null : list.rows.length;
}

export function HistoryPage({
  profiles = [],
}: {
  /** Every Profile the Case has, for the toolbar's Profiles menu. Omitted (or
   *  empty) simply hides the Profiles filter — a single-Profile Case has
   *  nothing to filter there. */
  readonly profiles?: readonly string[];
}) {
  const { activity, error: activityError, retry } = useActivity();
  const [filters, setFilters] = useState<VisitFilters>(DEFAULT_VISIT_FILTERS);
  const parameters = useMemo(() => visitParameters(filters), [filters]);
  const visits = useCommitStateLists<Finding>("history", parameters);
  const [view, setView] = useState<CommitView>("saved");
  const [selected, setSelected] = useState<SelectedRow | null>(null);

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
    const days = bucketsToDays(activity.saved);
    const first = days[0]?.date;
    const last = days[days.length - 1]?.date;
    return {
      state: "ready",
      value: {
        savedVisits: visitTotal(activity.saved),
        recoveredVisits: visitTotal(activity.recovered),
        activeDays: days.length,
        span:
          first === undefined || last === undefined ? null : { first, last },
      },
    };
  }, [activity, activityError]);

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

  // Distinct sites: a floor read off the loaded saved visit rows, labelled
  // as such rather than claimed as the Case total.
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
      const host = hostOf(fieldText(row.fields.url));
      if (host !== null) {
        hosts.add(host.replace(/^www\./, ""));
      }
    }
    return {
      state: "ready",
      value: { count: hosts.size, more: saved.cursor !== null },
    };
  }, [saved.rows, saved.loading, saved.error, saved.cursor]);

  const filtersActive = visitsAreFiltered(filters);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_VISIT_FILTERS);
  }, []);

  // A bar is "selected" only when the filter is pinned to that one exact
  // day — a wider picked range highlights no single bar, since no one bar
  // speaks for it. Clicking the already-selected day clears back to the
  // whole span; clicking any other day pins to it.
  const selectedDate =
    filters.from !== "" && filters.from === filters.to ? filters.from : null;
  const onSelectDay = useCallback((date: string) => {
    setFilters((current) =>
      current.from === date && current.to === date
        ? { ...current, from: "", to: "" }
        : { ...current, from: date, to: date },
    );
  }, []);

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
        range={{ from: filters.from, to: filters.to }}
        onRangeChange={({ from, to }) => {
          setFilters((current) => ({ ...current, from, to }));
        }}
        rangeMin={pickerSpan.min}
        rangeMax={pickerSpan.max}
        selectedDate={selectedDate}
        onSelectDay={onSelectDay}
      />

      {/* The raw visit stream, saved and recovered as two server reads.
          Curated columns; every wire field stays reachable through the row
          detail sheet. */}
      <SectionPanel
        id="history-visits-title"
        title="Recorded visits"
        description="Every page visit Chrome recorded, filtered on the server."
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
          savedCount={countOf(visits.saved)}
          recoveredCount={countOf(visits.recovered)}
          savedMore={visits.saved.cursor !== null}
          recoveredMore={visits.recovered.cursor !== null}
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
              filtersActive={filtersActive}
              onSelect={select}
              onClearFilters={clearFilters}
            />
          }
          recovered={
            <VisitList
              list={visits.recovered}
              recovered
              filtersActive={filtersActive}
              onSelect={select}
              onClearFilters={clearFilters}
            />
          }
        />
      </SectionPanel>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={fieldText(selected.row.fields.title) ?? "Page visit"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
