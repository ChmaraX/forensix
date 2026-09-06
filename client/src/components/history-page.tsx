/**
 * The History page.
 *
 * Chrome's recorded page visits, read as browsing *behavior* rather than a
 * generic evidence dump. One activity band sits above the raw visit table,
 * a direct reading of what the analyzer produced — never a smoothed trend, a
 * projection, or an invented figure:
 *
 *  1. An activity-over-time bar chart (visits per local day) — the same
 *     chart component the Overview masthead uses for the identical dataset,
 *     so the two pages never draw the same evidence two different shapes.
 *     Clicking a bar pins the visit table (and the date-range control in the
 *     chart's own header) to that one day; clicking it again clears back to
 *     the whole recorded span.
 *  2. Four headline figures (recorded visits, active days, recorded span,
 *     distinct sites) dock on the chart panel's bottom edge as attached
 *     subcards, echoing the Overview masthead's own layout (see
 *     `ActivityHero`).
 *
 * The raw visit table underneath keeps every wire field reachable through the
 * row detail sheet. Its columns are curated, not the sparse union grid: Time,
 * Page (title over URL), Arrived via (the worded transition), Dwell (recorded
 * `visitDuration`, shown as the word "not recorded" when absent — never zero),
 * and the Commit State word.
 *
 * Presentation rules kept: the Completeness Statement ("Evidence coverage")
 * renders before any row; the four value states stay worded, never colour
 * alone; the two recovered Commit States keep their own hue *and* word; no
 * axis is projected past the last recorded day and no cell invents a count the
 * evidence does not contain.
 */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import type { FieldState, Finding, PageOf } from "../types.js";
import { bucketsToDays, fillGaps, useActivityBuckets } from "./activity-data.js";
import { ActivityBars, type DayCount, useChartTokens } from "./charts.js";
import { EmptyRows } from "./data-table.js";
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
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { StatTile } from "./stat-tile.js";
import { Button } from "./ui/button.js";
import { Chip, Input, Labeled, SelectNative, Skeleton } from "./ui/misc.js";

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


/* --------------------------- activity + figures ---------------------------- */

/**
 * The chart-and-headline-figures band, styled after the Overview masthead's
 * own trick: the four headline figures dock on the chart panel's bottom edge
 * as attached subcards, instead of sitting in a separate band above it. The
 * panel itself stays this app's plain evidentiary white card — Overview's
 * blue "Punctuation Tile" is deliberately the one saturated panel in the app
 * (DESIGN.md), so this borrows its docking layout, not its colour.
 */
function ActivityHero({
  days,
  loading,
  error,
  figures,
  spanLabel,
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
  readonly figures: {
    readonly totalVisits: number;
    readonly activeDays: number;
    readonly distinctHosts: number;
  };
  readonly spanLabel: string;
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
    <div className="flex flex-col">
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
            Browsing activity
          </h2>
          <DateRangePicker
            from={range.from}
            to={range.to}
            min={rangeMin}
            max={rangeMax}
            triggerLabel="Whole recorded span"
            formatDate={formatDayShort}
            onChange={onRangeChange}
            className="h-8 rounded-md"
          />
        </header>
        {/* Extra bottom padding is the ledge the figure tiles sit on. */}
        <div className="px-2 pt-3 pb-16">
          {error !== null ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              The activity chart could not be loaded: {error}
            </p>
          ) : loading ? (
            <Skeleton className="mx-2 h-[220px] w-[calc(100%-1rem)]" />
          ) : (
            <div className="h-[220px] w-full">
              <ActivityBars
                days={days}
                tokens={tokens}
                selectedDate={selectedDate}
                onSelectDay={onSelectDay}
              />
            </div>
          )}
        </div>
      </section>

      <div className="relative z-10 -mt-10 grid grid-cols-2 gap-3 px-3 sm:grid-cols-4 sm:px-4">
        <StatTile
          label="Recorded visits"
          delay={0}
          value={loading ? "—" : figures.totalVisits.toLocaleString("en-US")}
        />
        <StatTile
          label="Active days"
          delay={1}
          value={loading ? "—" : figures.activeDays.toLocaleString("en-US")}
        />
        <StatTile
          label="Recorded span"
          delay={2}
          value={loading ? "—" : spanLabel}
        />
        <StatTile
          label="Distinct sites"
          delay={3}
          value={figures.distinctHosts.toLocaleString("en-US")}
          note="in loaded visits"
        />
      </div>
    </div>
  );
}

/* ------------------------------- visit table ------------------------------- */

function VisitTable({
  rows,
  filtersActive,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly filtersActive: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyRows
        message={
          filtersActive
            ? "No recorded visits match these filters."
            : "No recorded visits in this Case."
        }
      />
    );
  }
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {["Time", "Page", "Arrived via", "Dwell", "State"].map((label) => (
              <th
                key={label}
                className="sticky top-0 z-10 border-b border-border bg-muted/60 px-3 py-2.5 text-left text-[11.5px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const utc = fieldUtc(row.fields.visitTime);
            const parts = utc === null ? null : formatInstant(utc);
            const url = fieldText(row.fields.url);
            const host = hostOf(url);
            const title = fieldText(row.fields.title);
            const transition = fieldText(row.fields.transitionCore);
            const dwell = formatDwell(row.fields.visitDuration);
            return (
              <tr
                key={index}
                tabIndex={0}
                aria-label="Open visit row detail"
                onClick={() => {
                  onSelect(row);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row);
                  }
                }}
                className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
              >
                <td
                  className="px-3 py-2.5 whitespace-nowrap tabular-nums"
                  title={utc === null ? undefined : `${utc} (UTC)`}
                >
                  {parts === null ? (
                    <AbsentWord />
                  ) : (
                    <>
                      <span className="text-[12.5px] font-medium">
                        {parts.date}
                      </span>
                      <span className="ml-2 text-[12px] text-muted-foreground">
                        {parts.time}
                      </span>
                    </>
                  )}
                </td>
                <td className="max-w-[440px] px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <SiteAvatar host={host} />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate text-[13px] text-foreground/90"
                        title={title ?? undefined}
                      >
                        {title ?? host ?? "(untitled)"}
                      </span>
                      <span
                        className="truncate font-mono text-[11.5px] text-muted-foreground"
                        title={url ?? undefined}
                      >
                        {url ?? ""}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px]">
                  {transition === null ? (
                    <AbsentWord />
                  ) : (
                    <span className="text-foreground/80">
                      {TRANSITION_LABELS[transition] ?? transition}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] tabular-nums">
                  {dwell === null ? (
                    <span className="text-muted-foreground italic">
                      not recorded
                    </span>
                  ) : (
                    <span className="text-foreground/80">{dwell}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StateWord state={row.commitState} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */

export function HistoryPage({
  profiles = [],
}: {
  /** Every Profile the Case has, for the filter row's chips. Omitted (or
   *  empty) simply hides the Profiles filter — a single-Profile Case has
   *  nothing to filter there. */
  readonly profiles?: readonly string[];
}) {
  const { buckets, error: activityError } = useActivityBuckets();
  const [filters, setFilters] = useState<VisitFilters>(DEFAULT_VISIT_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
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
    const span =
      days.length === 0
        ? null
        : {
            first: days[0]?.date ?? null,
            last: days[days.length - 1]?.date ?? null,
          };
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

  // A bar is "selected" only when the filter is pinned to that one exact
  // day — a wider picked range highlights no single bar, since no one bar
  // speaks for it. Clicking the already-selected day clears back to the
  // whole span; clicking any other day pins to it.
  const selectedDate =
    filters.from !== "" && filters.from === filters.to ? filters.from : null;
  const onSelectDay = useCallback(
    (date: string) => {
      setFilters((current) =>
        current.from === date && current.to === date
          ? { ...current, from: "", to: "" }
          : { ...current, from: date, to: date },
      );
    },
    [setFilters],
  );

  const spanLabel =
    figures.span === null ||
    figures.span.first === null ||
    figures.span.last === null
      ? "No dated activity"
      : figures.span.first === figures.span.last
        ? formatDayShort(figures.span.first)
        : `${formatDayShort(figures.span.first)} — ${formatDayShort(figures.span.last)}`;

  const DirectionIcon =
    filters.direction === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;

  return (
    <div className="flex flex-col gap-4">

      {/* Activity + figures — the Case's browsing at a glance. The four
          headline figures dock on the chart panel's bottom edge, echoing the
          Overview masthead's own layout (see ActivityHero). Every figure is
          a direct read of the activity/visit sets below, never a new query
          or an invented number. */}
      <ActivityHero
        days={chartDays}
        loading={activityLoading}
        error={activityError}
        figures={figures}
        range={{ from: filters.from, to: filters.to }}
        onRangeChange={({ from, to }) => {
          setFilters({ ...filters, from, to });
        }}
        rangeMin={figures.span?.first ?? null}
        rangeMax={figures.span?.last ?? null}
        selectedDate={selectedDate}
        onSelectDay={onSelectDay}
        spanLabel={spanLabel}
      />

      {/* The raw visit stream. Curated columns; every wire field stays
          reachable through the row detail sheet. */}
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="flex flex-col gap-4 border-b border-border px-4 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em]">
              Recorded visits
            </h2>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setFilters(DEFAULT_VISIT_FILTERS);
                  setDraftSearch("");
                }}
                className="cursor-pointer text-[12px] font-medium text-primary transition-colors duration-150 hover:text-primary/80"
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3.5">
            <Labeled label="Search" htmlFor="history-visits-search">
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
                />
                <Input
                  id="history-visits-search"
                  type="search"
                  value={draftSearch}
                  placeholder="Search page or URL"
                  aria-label="Search recorded visits"
                  onChange={(event) => {
                    setDraftSearch(event.target.value);
                  }}
                  onBlur={() => {
                    if (draftSearch !== filters.search) {
                      setFilters({ ...filters, search: draftSearch });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && draftSearch !== filters.search) {
                      setFilters({ ...filters, search: draftSearch });
                    }
                  }}
                  className="w-52 pl-8"
                />
              </div>
            </Labeled>

            <Labeled label="Sort" htmlFor="history-visits-sort">
              <div className="flex items-center gap-1">
                <SelectNative
                  id="history-visits-sort"
                  value={filters.sort}
                  onChange={(event) => {
                    setFilters({ ...filters, sort: event.target.value });
                  }}
                >
                  {VISIT_SORTS.map((sort) => (
                    <option key={sort} value={sort}>
                      {SORT_LABELS[sort] ?? sort}
                    </option>
                  ))}
                </SelectNative>
                <button
                  type="button"
                  aria-label={
                    filters.direction === "desc"
                      ? "Sorted descending — switch to ascending"
                      : "Sorted ascending — switch to descending"
                  }
                  onClick={() => {
                    setFilters({
                      ...filters,
                      direction: filters.direction === "desc" ? "asc" : "desc",
                    });
                  }}
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors duration-150 hover:border-muted-foreground/40 hover:text-foreground"
                >
                  <DirectionIcon aria-hidden="true" className="size-4" />
                </button>
              </div>
            </Labeled>

            <Labeled label="Transition" htmlFor="history-visits-transition">
              <SelectNative
                id="history-visits-transition"
                value={filters.transition}
                onChange={(event) => {
                  setFilters({ ...filters, transition: event.target.value });
                }}
              >
                <option value="">any</option>
                {Object.entries(TRANSITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectNative>
            </Labeled>

            {profiles.length === 0 ? null : (
              <Labeled label="Profiles">
                <div className="flex min-h-8 flex-wrap items-center gap-1.5">
                  {profiles.map((profile) => {
                    const active = filters.profiles.includes(profile);
                    return (
                      <Chip
                        key={profile}
                        active={active}
                        onClick={() => {
                          setFilters({
                            ...filters,
                            profiles: active
                              ? filters.profiles.filter(
                                  (entry) => entry !== profile,
                                )
                              : [...filters.profiles, profile],
                          });
                        }}
                      >
                        {profile}
                      </Chip>
                    );
                  })}
                </div>
              </Labeled>
            )}
          </div>
        </header>

        {visits.error !== null ? (
          <div
            role="alert"
            className="mx-4 my-4 flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
          >
            <div className="flex-1">
              <p className="text-[13px] font-medium text-destructive">
                The rows could not be loaded.
              </p>
              <p className="text-[12.5px] text-destructive/80">
                {visits.error}
              </p>
            </div>
            <Button onClick={visits.retry} size="sm" className="shrink-0">
              Retry
            </Button>
          </div>
        ) : visits.loading && visits.rows.length === 0 ? (
          <div
            className="flex flex-col gap-2 px-4 py-4"
            aria-label="Loading rows"
          >
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : (
          <VisitTable
            rows={visits.rows}
            filtersActive={filtersActive}
            onSelect={select}
          />
        )}

        {visits.rows.length === 0 && visits.cursor === null ? null : (
          <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
            <p
              className="text-[12.5px] text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {visits.rows.length.toLocaleString("en-US")} row
              {visits.rows.length === 1 ? "" : "s"} shown
              {visits.cursor === null ? "" : " · more available"}
            </p>
            {visits.cursor !== null ? (
              <Button
                onClick={visits.loadMore}
                disabled={visits.loading}
                size="sm"
              >
                {visits.loading ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
