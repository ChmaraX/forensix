/**
 * The History page.
 *
 * Chrome's recorded page visits, read as browsing *behavior* rather than a
 * generic evidence dump. The page is a column of FF Panels, read top-down:
 *
 *  1. Evidence coverage — the Completeness Statement, before any row.
 *  2. Four headline figures (recorded visits, active days, recorded span,
 *     distinct sites) in one MetricBand: direct reads of what the analyzer
 *     produced — never a smoothed trend, a projection, or an invented figure.
 *  3. An activity-over-time bar chart (visits per local day) — the same
 *     chart component the Overview masthead uses for the identical dataset,
 *     so the two pages never draw the same evidence two different shapes.
 *     Clicking a bar pins the visit table (and the date-range control in the
 *     chart's own header) to that one day; clicking it again clears back to
 *     the whole recorded span.
 *  4. The raw visit table, on FF's Table (one fluid hover highlight; the lit
 *     row is the row a click opens), with the app's shared toolbar parts:
 *     a search field that commits on Enter/blur, Sort (FF Select + a
 *     direction toggle), Arrived via (FF Select), and the Profiles picker.
 *     Its columns are curated, not the sparse
 *     union grid: Time, Page (title over URL), Arrived via (the worded
 *     transition), Dwell (recorded `visitDuration`, shown as the words "not
 *     recorded" when absent — never zero), and the Commit State word. Every
 *     wire field stays reachable through the row detail sheet.
 *
 * Presentation rules kept: the Completeness Statement ("Evidence coverage")
 * renders before any row; the four value states stay worded, never colour
 * alone; the two recovered Commit States keep their own hue *and* word; no
 * axis is projected past the last recorded day and no cell invents a count the
 * evidence does not contain.
 */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { FieldState, Finding, PageOf } from "../types.js";
import {
  bucketsToDays,
  fillGaps,
  useActivityBuckets,
} from "./activity-data.js";
import { ActivityBars, type DayCount, useChartTokens } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { DateRangePicker } from "./date-range-picker.js";
import {
  AbsentWord,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { Coverage } from "./history-coverage.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/* ------------------------------- data reads ------------------------------- */

/** `"value"`-state field as a plain string (numbers included), or null. */
function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value === "" ? null : field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
}

/** How many visit rows the arrival breakdown and the table load per request. */
const VISITS_PAGE_LIMIT = 100;

/** The filters the visit table and its query both read — every one of them a
 *  real server-side parameter `queryHistory` already accepts, not a
 *  client-side narrowing of an already-loaded page. */
export interface VisitFilters {
  readonly search: string;
  readonly sort: string;
  readonly direction: "asc" | "desc";
  readonly transition: string;
  readonly from: string;
  readonly to: string;
  readonly profiles: readonly string[];
}

export const DEFAULT_VISIT_FILTERS: VisitFilters = {
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

/** One keyset page of `visits` rows plus its "Load more" continuation. */
function useVisits(filters: VisitFilters) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const baseParameters = useMemo<(readonly [string, string])[]>(() => {
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
  }, [
    filters.search,
    filters.sort,
    filters.direction,
    filters.transition,
    filters.from,
    filters.to,
    filters.profiles,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Finding>>("history", baseParameters)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseParameters, nonce]);

  const loadMore = useCallback(() => {
    if (cursor === null) {
      return;
    }
    setLoading(true);
    callApi<PageOf<Finding>>("history", [...baseParameters, ["after", cursor]])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
  }, [cursor, baseParameters]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return {
    rows,
    cursor,
    loading,
    error,
    loadMore,
    retry,
  };
}

/* ------------------------------ small format ------------------------------ */

function formatDayShort(date: string): string {
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
 * A recorded `visitDuration` (microseconds, as a string field) read as a
 * compact human dwell — "4m 12s", "38s", "2h 05m". Returns null for a missing
 * or non-positive value, so the caller renders the word "not recorded" rather
 * than a fabricated "0s".
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
 * The recorded Chrome core transition, as a plain-language label. Unknown or
 * absent values fall through to `null`, rendered as the word "absent" — the
 * evidence's own gap, never guessed.
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

/**
 * The four headline figures. Recorded visits and active days come from the
 * authoritative `activity` set (the same one the chart draws); the recorded
 * span is the calendar distance between its first and last day; distinct
 * sites is a floor read off the loaded visit rows and labelled as such.
 */
function HistoryFigures({
  loading,
  totalVisits,
  activeDays,
  span,
  distinctHosts,
}: {
  readonly loading: boolean;
  readonly totalVisits: number;
  readonly activeDays: number;
  readonly span: { readonly first: string; readonly last: string } | null;
  readonly distinctHosts: number;
}) {
  const days = span === null ? null : spanDays(span.first, span.last);
  const spanDetail =
    span === null
      ? "no dated activity"
      : span.first === span.last
        ? formatDayShort(span.first)
        : `${formatDayShort(span.first)} — ${formatDayShort(span.last)}`;
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Recorded visits"
        value={loading ? "—" : totalVisits.toLocaleString("en-US")}
        detail="page visits in the activity set"
      />
      <MetricBandItem
        label="Active days"
        value={loading ? "—" : activeDays.toLocaleString("en-US")}
        detail="days with at least one visit"
      />
      <MetricBandItem
        label="Recorded span"
        value={
          loading
            ? "—"
            : days === null
              ? "none"
              : `${days.toLocaleString("en-US")} day${days === 1 ? "" : "s"}`
        }
        detail={loading ? "\u00a0" : spanDetail}
      />
      <MetricBandItem
        label="Distinct sites"
        value={distinctHosts.toLocaleString("en-US")}
        detail="in loaded visits"
      />
    </MetricBand>
  );
}

/* ------------------------------- activity --------------------------------- */

/** Height of the plot, shared by the chart and its skeleton. */
const CHART_HEIGHT = "h-[220px]";

function ActivityPanel({
  days,
  loading,
  error,
  range,
  onRangeChange,
  rangeMin,
  rangeMax,
  selectedDate,
  onSelectDay,
}: {
  readonly days: readonly DayCount[];
  readonly loading: boolean;
  readonly error: string | null;
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset — the same filter
   *  state the visit table below reads, so this is the one date control for
   *  the whole page, not a second one competing with it. */
  readonly range: { readonly from: string; readonly to: string };
  readonly onRangeChange: (range: { from: string; to: string }) => void;
  readonly rangeMin: string | null;
  readonly rangeMax: string | null;
  readonly selectedDate: string | null;
  readonly onSelectDay: (date: string) => void;
}) {
  const tokens = useChartTokens();
  return (
    <ChartSection
      title="Browsing activity"
      description="Recorded page visits per day. Choose a range or select a bar."
      action={
        <DateRangePicker
          from={range.from}
          to={range.to}
          min={rangeMin}
          max={rangeMax}
          triggerLabel="All recorded days"
          formatDate={formatDayShort}
          onChange={onRangeChange}
          presets
        />
      }
    >
      <div className="px-2 pt-2 pb-3">
        {error !== null ? (
          <div className="px-2 py-2">
            <Banner status="error" contrast="high">
              <BannerTitle>The activity chart could not be loaded.</BannerTitle>
              <BannerDescription>{error}</BannerDescription>
            </Banner>
          </div>
        ) : (
          <div className="reveal-swap">
            <Skeleton
              className={cn(
                CHART_HEIGHT,
                "mx-2 w-[calc(100%-1rem)] rounded-lg",
              )}
            />
            {loading ? null : (
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
            )}
          </div>
        )}
      </div>
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
 * The visit toolbar, from the same shared parts as every artifact page's
 * FilterBar (FilterTextField, FilterField + FF Select, ProfilePicker), so all
 * toolbars in the app read and behave alike. Every control maps to a real
 * server-side parameter `queryHistory` accepts.
 */
function VisitToolbar({
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
  const flip = `Sorted ${descending ? words.desc : words.asc} — switch to ${
    descending ? words.asc : words.desc
  }`;

  return (
    <div
      role="group"
      aria-label="Filter recorded visits"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3"
    >
      <FilterTextField
        id="history-visits-search"
        label="Search recorded visits"
        icon={Search}
        value={filters.search}
        placeholder="Search page or URL…"
        onCommit={(search) => {
          setFilters({ ...filters, search });
        }}
        className="w-60 max-sm:w-full"
      />

      <FilterField label="Sort" htmlFor="history-visits-sort">
        <div className="flex items-center gap-1 max-sm:[&>*:first-child]:flex-1">
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
        </div>
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
    </div>
  );
}

/* ------------------------------- visit table ------------------------------- */

const VISIT_COLUMNS = ["Time", "Page", "Arrived via", "Dwell", "State"];

function VisitTable({
  rows,
  filtersActive,
  onSelect,
  onClearFilters,
}: {
  readonly rows: readonly Finding[];
  readonly filtersActive: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const size = useSize();
  if (rows.length === 0) {
    return (
      <EmptyRows
        message={
          filtersActive
            ? "No recorded visits match these filters."
            : "No recorded visits in this Case."
        }
        action={
          filtersActive ? (
            <Button variant="tertiary" size="compact" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            {VISIT_COLUMNS.map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const utc = fieldUtc(row.fields.visitTime);
            const parts = utc === null ? null : formatInstant(utc);
            const url = fieldText(row.fields.url);
            const host = hostOf(url);
            const title = fieldText(row.fields.title);
            const transition = fieldText(row.fields.transitionCore);
            const dwell = formatDwell(row.fields.visitDuration);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label="Open visit row detail"
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell
                  className="whitespace-nowrap tabular-nums"
                  title={utc === null ? undefined : `${utc} (UTC)`}
                >
                  {parts === null ? (
                    <AbsentWord />
                  ) : (
                    <>
                      <span className="text-foreground">{parts.date}</span>
                      <span className="ml-2">{parts.time}</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="max-w-[440px]">
                  <span className="flex items-center gap-2.5">
                    <SiteAvatar host={host} />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate text-foreground"
                        title={title ?? undefined}
                      >
                        {title ?? host ?? "(untitled)"}
                      </span>
                      <span
                        className={cn(size.type.caption, "truncate font-mono")}
                        title={url ?? undefined}
                      >
                        {url ?? ""}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {transition === null ? (
                    <AbsentWord />
                  ) : (
                    (TRANSITION_LABELS[transition] ?? transition)
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {dwell ?? "not recorded"}
                </TableCell>
                <TableCell>
                  <StateWord state={row.commitState} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */

export function HistoryPage({
  profiles = [],
}: {
  /** Every Profile the Case has, for the toolbar's Profiles menu. Omitted (or
   *  empty) simply hides the Profiles filter — a single-Profile Case has
   *  nothing to filter there. */
  readonly profiles?: readonly string[];
}) {
  const { buckets, error: activityError } = useActivityBuckets();
  const [filters, setFilters] = useState<VisitFilters>(DEFAULT_VISIT_FILTERS);
  const visits = useVisits(filters);
  const [selected, setSelected] = useState<SelectedRow | null>(null);

  // Per-day totals for the activity area, summed across every hour bucket.
  // Sparse — only days with recorded activity — because "active days" below
  // literally counts this array's length; it must never be gap-filled.
  const days = useMemo<readonly DayCount[]>(
    () => (buckets === null ? [] : bucketsToDays(buckets)),
    [buckets],
  );

  // The same days, continuous: zero-count bars fill the gaps between them so
  // the chart's x-axis is real calendar time — the same shared reading
  // Overview's and Timeline's identical "page visits per day" charts draw.
  // Never used for the stats below; those stay on the sparse `days`.
  const chartDays = useMemo(() => fillGaps(days), [days]);

  // Figure strip: recorded visits and active days come from the authoritative
  // `activity` set (the same one the charts draw), not from the truncatable
  // visit page; distinct sites is a floor read off the loaded visit rows and
  // is labelled as such rather than claimed as the Case total.
  const figures = useMemo(() => {
    const totalVisits = days.reduce((sum, day) => sum + day.count, 0);
    const activeDays = days.length;
    const first = days[0]?.date;
    const last = days[days.length - 1]?.date;
    const span =
      first === undefined || last === undefined ? null : { first, last };
    const hosts = new Set<string>();
    for (const row of visits.rows) {
      const host = hostOf(fieldText(row.fields.url));
      if (host !== null) {
        hosts.add(host.replace(/^www\./, ""));
      }
    }
    return { totalVisits, activeDays, span, distinctHosts: hosts.size };
  }, [days, visits.rows]);

  const filtersActive = visitsAreFiltered(filters);
  const activityLoading = buckets === null && activityError === null;

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
      <Coverage artifact="History" />

      {/* The Case's browsing at a glance: four figures, then the per-day
          chart. Every figure is a direct read of the activity/visit sets
          below, never a new query or an invented number. */}
      <HistoryFigures
        loading={activityLoading}
        totalVisits={figures.totalVisits}
        activeDays={figures.activeDays}
        span={figures.span}
        distinctHosts={figures.distinctHosts}
      />

      <ActivityPanel
        days={chartDays}
        loading={activityLoading}
        error={activityError}
        range={{ from: filters.from, to: filters.to }}
        onRangeChange={({ from, to }) => {
          setFilters((current) => ({ ...current, from, to }));
        }}
        rangeMin={figures.span?.first ?? null}
        rangeMax={figures.span?.last ?? null}
        selectedDate={selectedDate}
        onSelectDay={onSelectDay}
      />

      {/* The raw visit stream. Curated columns; every wire field stays
          reachable through the row detail sheet. */}
      <Panel
        role="region"
        aria-labelledby="history-visits-title"
        className="overflow-clip"
      >
        <PanelHeader className="items-center pb-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <PanelTitle id="history-visits-title">Recorded visits</PanelTitle>
            <VisitCount
              count={visits.rows.length}
              more={visits.cursor !== null}
              loading={visits.loading && visits.rows.length === 0}
            />
          </div>
          {filtersActive ? (
            <Button variant="ghost" size="compact" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </PanelHeader>

        <SizeProvider size="compact">
          <VisitToolbar
            filters={filters}
            setFilters={setFilters}
            profiles={profiles}
          />
        </SizeProvider>

        <div className="border-t border-border">
          {visits.error !== null ? (
            <ErrorRows message={visits.error} onRetry={visits.retry} />
          ) : visits.loading && visits.rows.length === 0 ? (
            <LoadingRows rows={8} />
          ) : (
            <VisitTable
              rows={visits.rows}
              filtersActive={filtersActive}
              onSelect={select}
              onClearFilters={clearFilters}
            />
          )}
        </div>

        <ListFooter
          count={visits.rows.length}
          cursor={visits.cursor}
          loading={visits.loading}
          onLoadMore={visits.loadMore}
        />
      </Panel>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            fieldText(selected.row.fields.title) ??
            hostOf(fieldText(selected.row.fields.url)) ??
            "Page visit"
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function VisitCount({
  count,
  more,
  loading,
}: {
  readonly count: number;
  readonly more: boolean;
  readonly loading: boolean;
}) {
  const size = useSize();
  if (loading) {
    return null;
  }
  return (
    <span
      className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
      style={{ fontVariationSettings: fontWeights.normal }}
    >
      {count.toLocaleString("en-US")}
      {more ? " loaded" : ""}
    </span>
  );
}
