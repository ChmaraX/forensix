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
import { SearchIcon, SortNewestIcon, SortOldestIcon } from "@/lib/app-icons";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import { siteKeyOf } from "../related.js";
import { rowRefOf } from "../router.js";
import type { FieldState, Finding } from "../types.js";
import {
  updateView,
  useRowSelection,
  useViewProfiles,
  useViewRange,
  useViewSearch,
  useViewTab,
} from "../view-state.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
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
import { EmptyRows } from "./data-table.js";
import { DateRangePicker } from "./date-range-picker.js";
import { dayRangeParameters } from "./day-bounds.js";
import {
  FieldCell,
  fieldString,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
  TwoLineCell,
} from "./finding-fields.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  ProfilePicker,
} from "./filters.js";
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
  formatDaySpan,
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type RowColumn,
} from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";
import { Term } from "./term.js";
import { UrlWithSiteLink } from "./host-link.js";

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

/**
 * What an empty filtered list says: the days when the range is the only
 * filter ("No saved visits on 12 Mar 2024."), else the days and "these
 * filters" - so an empty day reads as that day, not as a broken filter.
 */
function filteredEmptyMessage(filters: VisitFilters, noun: string): string {
  const days =
    filters.from !== "" && filters.to !== ""
      ? filters.from === filters.to
        ? `on ${formatDay(filters.from)}`
        : `in ${formatDaySpan(filters.from, filters.to)}`
      : null;
  const others =
    filters.search !== "" ||
    filters.transition !== "" ||
    filters.profiles.length > 0;
  if (days === null) {
    return `No ${noun} match these filters.`;
  }
  return others
    ? `No ${noun} ${days} match these filters.`
    : `No ${noun} ${days}.`;
}

function visitsAreFiltered(filters: VisitFilters): boolean {
  return (
    filters.search !== "" ||
    filters.transition !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.profiles.length > 0
  );
}

/** Where a URL-named visit is looked up (`useRowSelection`). */
const VISIT_LOOKUP = {
  route: "history",
  parameters: [["view", "visits"]],
} as const;

/** The `history` `view=visits` query for the filters (Commit State is added
 *  per list by `useCommitStateLists`). The date range is in Case days (the
 *  chart's days), so its bounds are that day's instants in the declared
 *  timezone (`dayRangeParameters`; UTC days without one). */
function visitParameters(
  filters: VisitFilters,
  timeZone: string | null,
): QueryParameters {
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
  parameters.push(
    ...dayRangeParameters({ from: filters.from, to: filters.to }, timeZone),
  );
  for (const profile of filters.profiles) {
    parameters.push(["profile", profile]);
  }
  return parameters;
}

/* ------------------------------ small format ------------------------------ */

/**
 * A recorded `visitDuration` (microseconds, as a string or number field)
 * read as a compact human dwell — "4m 12s", "38s", "0s", "2h 05m". Returns
 * null for anything that is not a non-negative number (an (empty) or
 * non-numeric value): the caller then shows the field as recorded, its own
 * word or its raw value, never "not recorded" over a recorded value.
 */
function formatDwell(field: FieldState | undefined): string | null {
  const raw = fieldString(field);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const micros = Number(raw);
  if (!Number.isFinite(micros) || micros < 0) {
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
  readonly activeDays: number;
  readonly span: { readonly first: string; readonly last: string } | null;
}

/**
 * The four headline figures, label and value only. Saved visits and active
 * days come from the committed rows of the `activity` set (the same days the
 * chart draws); recovered visits are the Recovered tab's count, never added
 * in. The recorded span is the calendar distance between the first and last
 * saved day, with those days as its one data line. Distinct sites is read
 * off the loaded saved visit rows; while more rows exist it reads "N+".
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
        value={figure(activity, (value) =>
          value.savedVisits.toLocaleString("en-US"),
        )}
      />
      <MetricBandItem
        label="Active days"
        value={figure(activity, (value) =>
          value.activeDays.toLocaleString("en-US"),
        )}
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
  const DirectionIcon = descending ? SortNewestIcon : SortOldestIcon;
  const flip = `Sorted ${descending ? words.desc : words.asc}. Switch to ${
    descending ? words.asc : words.desc
  }`;

  // The transition and the profile pick narrow the list; the sort orders.
  const active =
    (filters.transition === "" ? 0 : 1) + (filters.profiles.length > 0 ? 1 : 0);

  return (
    <>
      <CompactFilters active={active}>
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
              {Object.entries(TRANSITION_LABELS).map(
                ([value, label], index) => (
                  <SelectItem key={value} index={index + 1} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
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
      </CompactFilters>

      <FilterTextField
        id="history-visits-search"
        label="Search recorded visits"
        icon={SearchIcon}
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

/** A visit's page: its title over its URL (the phone card's title). */
function VisitPage({ row }: { readonly row: Finding }) {
  return (
    <TwoLineCell
      primary={row.fields.title}
      secondary={row.fields.url}
      mono={false}
    />
  );
}

/** The table's page cell: the site tile, the title over the URL, and the
 *  URL's host linked to Sites when Sites lists that exact host. */
function VisitPageLinked({ row }: { readonly row: Finding }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={hostOf(fieldText(row.fields.url))} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="block min-w-0 text-foreground">
          <FieldCell field={row.fields.title} mono={false} />
        </span>
        <SizeProvider size="compact">
          <span className="block min-w-0 text-muted-foreground">
            <UrlWithSiteLink field={row.fields.url} />
          </span>
        </SizeProvider>
      </span>
    </span>
  );
}

/** The visit table's columns, and where each sits in the stacked card on a
 *  phone (`ResponsiveRows`): time and (recovered only) State on the first
 *  line, the page as the card's title, transition and dwell under it. Every
 *  column but Page has a fixed width that fits its longest value, so Page
 *  takes the rest and no column moves when a day, a range or a tab changes
 *  the rows. The table links each URL's host to Sites (not a phone card:
 *  it is one button, and the row sheet carries the same link). */
function visitColumns(recovered: boolean): readonly RowColumn<Finding>[] {
  const columns: RowColumn<Finding>[] = [
    {
      key: "time",
      header: "Time (UTC)",
      label: "Time",
      className: "w-[184px] whitespace-nowrap",
      stack: "lead",
      cell: (row) => <TimeCell field={row.fields.visitTime} />,
    },
    {
      key: "page",
      header: "Page",
      className: "max-w-[440px]",
      stack: "title",
      cell: (row) => <VisitPageLinked row={row} />,
      stackedCell: (row) => <VisitPage row={row} />,
    },
    ...VISIT_DETAIL_COLUMNS,
  ];
  if (recovered) {
    columns.push(STATE_COLUMN);
  }
  return columns;
}

/** Arrived via and Dwell: the same in both lists. */
const VISIT_DETAIL_COLUMNS: readonly RowColumn<Finding>[] = [
  {
    key: "transition",
    header: "Arrived via",
    className: "w-[168px] whitespace-nowrap",
    cell: (row) => (
      <FieldCell
        field={row.fields.transitionCore}
        format={(value) => TRANSITION_LABELS[asText(value)] ?? asText(value)}
      />
    ),
  },
  {
    key: "dwell",
    header: (
      <Term label="Dwell">
        How long Chrome recorded the page as open. &quot;absent&quot; means
        Chrome kept no duration for that visit - it is not zero.
      </Term>
    ),
    label: "Dwell",
    className: "w-[96px] whitespace-nowrap tabular-nums",
    labelled: true,
    cell: (row) =>
      formatDwell(row.fields.visitDuration) ?? (
        <FieldCell field={row.fields.visitDuration} />
      ),
  },
];

/** The Recovered list adds the Commit State word (unsaved vs overwritten);
 *  in the Saved list every row would read "saved", so it is left out. */
const STATE_COLUMN: RowColumn<Finding> = {
  key: "state",
  header: "State",
  className: "w-[184px]",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** A visit's stable key: its row reference (file, table, row id, profile,
 *  Commit State), so a re-sort or a new page re-renders no kept row. */
function visitKey(row: Finding, index: number): string {
  return rowRefOf(row) ?? `${row.commitState}-${String(index)}`;
}

function visitLabel(row: Finding): string {
  return `Open visit row detail: ${fieldText(row.fields.title) ?? fieldText(row.fields.url) ?? "page visit"}`;
}

function VisitTable({
  rows,
  recovered,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = useMemo(() => visitColumns(recovered), [recovered]);
  return (
    <ResponsiveRows
      rows={rows}
      columns={columns}
      rowKey={visitKey}
      rowLabel={visitLabel}
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
  filters,
  filtersActive,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  readonly filters: VisitFilters;
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
      filteredMessage={filteredEmptyMessage(
        filters,
        recovered ? "recovered visits" : "saved visits",
      )}
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
      <VisitTable rows={list.rows} recovered={recovered} onSelect={onSelect} />
    </ListBlock>
  );
}

/* --------------------------------- page ----------------------------------- */

function countOf(list: PaginatedList<unknown>): number | null {
  return list.loading && list.rows.length === 0 ? null : list.rows.length;
}

/** The Saved / Recovered switch, the date range, the profile pick and the
 *  search live in the URL (view-state.tsx): Back, a refresh and a link
 *  restore them, and the range and profiles are the Case-wide lens. Sort,
 *  direction and "Arrived via" stay this page's own. */
function useVisitFilters(): readonly [
  VisitFilters,
  (next: VisitFilters | ((current: VisitFilters) => VisitFilters)) => void,
] {
  const [range] = useViewRange();
  const [profiles] = useViewProfiles();
  const [search] = useViewSearch();
  const [own, setOwn] = useState<VisitFilters>(DEFAULT_VISIT_FILTERS);
  const filters = useMemo<VisitFilters>(
    () => ({ ...own, from: range.from, to: range.to, profiles, search }),
    [own, range, profiles, search],
  );
  const setFilters = useCallback(
    (next: VisitFilters | ((current: VisitFilters) => VisitFilters)) => {
      const value = typeof next === "function" ? next(filters) : next;
      setOwn(value);
      const lensChanged =
        value.from !== filters.from ||
        value.to !== filters.to ||
        value.profiles.join("\u0000") !== filters.profiles.join("\u0000");
      if (lensChanged || value.search !== filters.search) {
        updateView(
          {
            from: value.from,
            to: value.to,
            profiles: value.profiles,
            q: value.search === "" ? null : value.search,
          },
          // A search alone replaces the entry; a range or profile is a step.
          { replace: !lensChanged },
        );
      }
    },
    [filters],
  );
  return [filters, setFilters] as const;
}

export function HistoryPage({
  profiles = [],
}: {
  /** Every Profile the Case has, for the toolbar's Profiles menu. Omitted (or
   *  empty) simply hides the Profiles filter — a single-Profile Case has
   *  nothing to filter there. */
  readonly profiles?: readonly string[];
}) {
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
      const host = siteKeyOf(fieldText(row.fields.url));
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
