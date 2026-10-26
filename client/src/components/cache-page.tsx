/**
 * The Cache page.
 *
 * Chrome's disk cache is a store of resource bodies, not browsing events, so
 * it is read the way an examiner reads a store: how many entries, how much
 * disk they took, whether their keys still verify, and when each was last
 * read back. Above the entry lists sit one figure strip (entries, cached
 * bytes, integrity-verified share, distinct hosts — each summed from the
 * loaded rows, never a new query) and "Last used over time", the cache's own
 * activity shape (distinct from browsing History).
 *
 * Drawn with Fluid Functionalism: a MetricBand, a SectionPanel holding the
 * shared `ActivityBars`, and one "Cache entries" panel whose Saved /
 * Recovered switch (CommitStateSplit) shows one `ResponsiveRows` list at a
 * time (a table from `sm` up, stacked rows below), with the sort, the
 * profile picker and a live search on the same toolbar.
 *
 * Days are Case days (the declared timezone, as on History and Timeline).
 * The date range and the profile pick are the Case-wide lens
 * (`useViewRange` / `useViewProfiles`); the search, the tab and the open
 * row are in the URL too, so Back and a refresh keep the view. A resource
 * host Sites lists links to it (`SiteHostLink`).
 *
 * Presentation rules kept: the four value states stay worded, never colour
 * alone; a row whose size or key is `unavailable`/`absent` is never counted
 * as zero — it is left out of the sum and shown as its own word in the
 * table. Saved entries and entries recovered from a sidecar are two separate
 * lists, never sorted together; the Cache route cannot filter by Commit
 * State, so the one loaded set is split with `splitByCommit`, and every
 * figure counts the saved entries only. Nothing here is inferred.
 */
import { useCallback, useMemo, useState } from "react";

import {
  updateView,
  useRowSelection,
  useViewProfiles,
  useViewRange,
  useViewSearch,
  useViewTab,
  type DayRange,
} from "../view-state.js";

import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import type { RowLookupSource } from "../row-lookup.js";
import { fillGaps } from "./activity-data.js";
import { cacheResourceHost, cacheSiteKey } from "./cache-keys.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { useChartTokens, type ChartTokens, type DayCount } from "./charts.js";
import { ActivityBars } from "./charts-ready.js";
import { EmptyRows } from "./data-table.js";
import { profileLabel } from "./finding-fields.js";
import {
  caseDayTotals,
  fieldZone,
  inCaseDays,
  zonesNote,
} from "./day-bounds.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  matchesSearch,
  ProfilePicker,
} from "./filters.js";
import { DrainNote } from "./list-states.js";
import { MetricBand, MetricBandItem, TooltipFigure } from "./metric-band.js";
import {
  CHART_HEIGHT,
  CommitStateSplit,
  plural,
  SectionPanel,
  splitByCommit,
} from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";
import { mixedReadStatus } from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { entryBytes, EntryList, integrityVerified } from "./cache-table.js";
import { useDrainedRead } from "./use-drained-read.js";
import { fieldText, fieldUtc } from "../field-readers.js";
import { formatBytes } from "./bytes.js";
import { formatDay, formatDaySpan } from "../day-format.js";

/**
 * Reads the whole Cache list for this Case, up to a bounded number of pages.
 * The widgets sum over what is loaded; a cache with more entries than the cap
 * covers shows a plain "more available" note in the footer rather than
 * silently under-reporting a total. Cache rows arrive with committed and
 * recovered Commit States already mixed (the route cannot filter it), so a
 * single rank-neutral read is the whole set; the page splits them for display.
 * The first page paints at once; the rest drain in the background
 * (`useDrainedRead`, every request abortable).
 */
const CACHE_PAGE_CAP = 60;

function useCacheEntries(route: string) {
  const read = useDrainedRead(
    route,
    [
      ["sort", "last-used"],
      ["direction", "desc"],
      ["limit", "100"],
    ],
    CACHE_PAGE_CAP,
  );
  return {
    rows: read.rows ?? NO_ROWS,
    complete: read.complete,
    // No page yet: the skeletons stand in.
    loading: read.rows === null && read.error === null,
    draining: read.draining && read.error === null,
    error: read.error,
    retry: read.retry,
  };
}

const NO_ROWS: readonly Finding[] = [];

/* --------------------------------- widgets -------------------------------- */

/**
 * The figure strip: four readings of the loaded saved entries. Bytes are
 * added only when a size was recorded; the integrity share is over every
 * saved entry, a missing signal counting as not verified. While the list is
 * not wholly read the counts and the byte sum are floors ("+") and the
 * share names its base ("of the first N loaded").
 */
function CacheSummary({
  rows,
  complete,
}: {
  readonly rows: readonly Finding[];
  /** Every page of the Cache list was read. */
  readonly complete: boolean;
}) {
  const summary = useMemo(() => {
    let totalBytes = 0;
    let sizedEntries = 0;
    let verified = 0;
    const hosts = new Set<string>();
    for (const row of rows) {
      const bytes = entryBytes(row);
      if (bytes !== null) {
        totalBytes += bytes;
        sizedEntries += 1;
      }
      if (integrityVerified(row)) {
        verified += 1;
      }
      // Hosts as Sites keys them (`siteHostKey`), so the figure and the
      // Sites view count one host once.
      const host = cacheSiteKey(row);
      if (host !== null) {
        hosts.add(host);
      }
    }
    return { totalBytes, sizedEntries, verified, hosts: hosts.size };
  }, [rows]);

  const verifiedShare =
    rows.length === 0 ? 0 : Math.round((summary.verified / rows.length) * 100);
  const floor = complete ? "" : "+";
  const loaded = rows.length.toLocaleString("en-US");

  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem label="Saved entries" value={`${loaded}${floor}`} />
      <MetricBandItem
        label="Cached on disk"
        value={
          summary.sizedEntries === 0 ? (
            "not recorded"
          ) : summary.sizedEntries === rows.length ? (
            `${formatBytes(summary.totalBytes)}${floor}`
          ) : (
            <TooltipFigure
              value={`${formatBytes(summary.totalBytes)}${floor}`}
              detail={`Summed over ${summary.sizedEntries.toLocaleString("en-US")} of ${plural(rows.length, "entry", "entries")}; the rest carry no recorded size`}
            />
          )
        }
      />
      <MetricBandItem
        label="Integrity verified"
        value={
          rows.length === 0 ? (
            "not recorded"
          ) : (
            <TooltipFigure
              value={`${String(verifiedShare)}%`}
              detail={`${summary.verified.toLocaleString("en-US")} of ${plural(rows.length, "entry", "entries")}`}
            />
          )
        }
        detail={
          complete || rows.length === 0
            ? undefined
            : `of the first ${loaded} loaded`
        }
      />
      <MetricBandItem
        label="Distinct hosts"
        value={`${summary.hosts.toLocaleString("en-US")}${floor}`}
      />
    </MetricBand>
  );
}

/** An entry's last-used day falls in the range; with a range set, an entry
 *  with no last-used time falls outside it. */
function lastUsedIn(row: Finding, range: DayRange): boolean {
  // Days are Case days: read on the clock the entry's own last-used time
  // declares.
  return inCaseDays(
    fieldUtc(row.fields.lastUsed),
    range,
    fieldZone(row.fields.lastUsed),
  );
}

/**
 * "Last used over time" — saved entries per day of their `lastUsed`
 * instant, on the shared `ActivityBars` (gap-filled calendar time). It
 * drives the page's date range with the picker in its header: a day or a
 * dragged span narrows the figures and both lists to entries last used
 * then.
 */
function LastUsedPanel({
  rows,
  range,
  onRangeChange,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
  readonly tokens: ChartTokens;
}) {
  const days = useMemo(
    () =>
      fillGaps(
        caseDayTotals(
          rows,
          (row) => fieldUtc(row.fields.lastUsed),
          (row) => fieldZone(row.fields.lastUsed),
        ).map(({ date, count }): DayCount => ({ date, count })),
      ),
    [rows],
  );
  // More than one declared zone among the entries: one quiet line says so.
  const zoneNote = useMemo(
    () =>
      zonesNote(
        rows.flatMap((row) =>
          fieldUtc(row.fields.lastUsed) === null
            ? []
            : [fieldZone(row.fields.lastUsed)],
        ),
      ),
    [rows],
  );

  return (
    <ChartSection
      title="Last used over time"
      footer={
        zoneNote === null ? undefined : (
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            {zoneNote}
          </p>
        )
      }
      action={
        days.length === 0 ? undefined : (
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
        )
      }
    >
      <div className="px-2 pt-2 pb-3">
        <div className={cn(CHART_HEIGHT, "w-full")}>
          <ActivityBars
            days={days}
            tokens={tokens}
            unit={CACHE_ENTRY_UNIT}
            title="Saved cache entries by day last used"
            range={range}
            onRangeChange={onRangeChange}
            emptyMessage="No saved entries carry a last-used time."
          />
        </div>
      </div>
    </ChartSection>
  );
}

const CACHE_ENTRY_UNIT = { one: "cache entry", many: "cache entries" };

/* --------------------------------- loading --------------------------------- */

/** Stands in for the figure strip and the chart while the cache loads, at
 *  their size. */
function FiguresSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status">
      <span className="sr-only">Loading cache figures</span>
      <Skeleton className="h-[148px] w-full rounded-xl lg:h-[74px]" />
      <Skeleton className="h-[290px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

/** The list orders: most recently used first (the default), oldest used
 *  first, or largest first. Rows without the value sort last either way,
 *  never as a zero. */
type EntrySort = "last-used-desc" | "last-used-asc" | "size-desc";

const SORT_OPTIONS: readonly {
  readonly value: EntrySort;
  readonly label: string;
}[] = [
  { value: "last-used-desc", label: "Last used, newest" },
  { value: "last-used-asc", label: "Last used, oldest" },
  { value: "size-desc", label: "Size, largest" },
];

function sortEntries(
  rows: readonly Finding[],
  sort: EntrySort,
): readonly Finding[] {
  // Sorted here as well as asked of the route, so the order holds on any
  // server (ties keep the route's order).
  const valueOf =
    sort === "size-desc"
      ? (row: Finding) => entryBytes(row)
      : (row: Finding) => fieldUtc(row.fields.lastUsed);
  const sign = sort === "last-used-asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        return a.value === b.value
          ? a.index - b.index
          : a.value === null
            ? 1
            : -1;
      }
      const order = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      return order === 0 ? a.index - b.index : order * sign;
    })
    .map((entry) => entry.row);
}

/** "last used 12 Mar 2024", "last used from 4 Mar 2024": the range as the
 *  empty-list sentence says it; null for every day. */
function rangePhrase(range: DayRange): string | null {
  if (range.from !== "" && range.to !== "") {
    return `last used ${formatDaySpan(range.from, range.to)}`;
  }
  if (range.from !== "") {
    return `last used from ${formatDay(range.from)}`;
  }
  if (range.to !== "") {
    return `last used until ${formatDay(range.to)}`;
  }
  return null;
}

const config = ARTIFACTS.cache;
/** A URL-named entry this page has not loaded is read by its reference
 *  (the cache route has no Commit State filter). */
const ROW_LOOKUP: RowLookupSource = {
  route: config.route,
  byCommitState: false,
};

export function CachePage() {
  const list = useCacheEntries(config.route);
  const tokens = useChartTokens();
  // Saved / Recovered, the search, the open row, and the Case-wide range
  // and profile pick live in the URL: Back and a refresh keep them.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  const [profileFilter, setProfileFilter] = useViewProfiles();
  const [range, setRange] = useViewRange();
  const [sort, setSort] = useState<EntrySort>("last-used-desc");
  const sheet = useRowSelection(list.rows, ROW_LOOKUP);

  // The Cache route cannot filter by Commit State: split the one loaded set.
  const all = useMemo(() => splitByCommit(list.rows), [list.rows]);

  // The picker lists the profiles the loaded entries carry, plus any the
  // lens already picked elsewhere (so it can be unpicked here).
  const profiles = useMemo(
    () =>
      [
        ...new Set([...list.rows.map((row) => row.profile), ...profileFilter]),
      ].sort(),
    [list.rows, profileFilter],
  );

  const inLens = useCallback(
    (row: Finding) =>
      lastUsedIn(row, range) &&
      (profileFilter.length === 0 || profileFilter.includes(row.profile)),
    [range, profileFilter],
  );

  const narrow = useCallback(
    (rows: readonly Finding[]) =>
      sortEntries(
        rows.filter(
          (row) =>
            inLens(row) &&
            matchesSearch(search, [
              fieldText(row.fields.key),
              cacheResourceHost(row),
              fieldText(row.fields.entryHash),
            ]),
        ),
        sort,
      ),
    [search, inLens, sort],
  );
  // The figures follow the lens (range and profiles); the search only
  // narrows the lists. The chart draws every day of the picked profiles,
  // the range washed in.
  const savedOfProfiles = useMemo(
    () =>
      profileFilter.length === 0
        ? all.saved
        : all.saved.filter((row) => profileFilter.includes(row.profile)),
    [all.saved, profileFilter],
  );
  const savedInRange = useMemo(
    () => savedOfProfiles.filter((row) => lastUsedIn(row, range)),
    [savedOfProfiles, range],
  );
  const savedVisible = useMemo(() => narrow(all.saved), [narrow, all.saved]);
  const recoveredVisible = useMemo(
    () => narrow(all.recovered),
    [narrow, all.recovered],
  );
  // The tabs and footers count the entries in the lens (range, profiles) -
  // the base the figures use - never an all-days total beside a day's rows.
  const savedInLens = useMemo(
    () => all.saved.filter(inLens).length,
    [all.saved, inLens],
  );
  const recoveredInLens = useMemo(
    () => all.recovered.filter(inLens).length,
    [all.recovered, inLens],
  );

  const clearFilters = useCallback(() => {
    // One history entry: Back restores the filters as they were.
    updateView({ from: "", to: "", profiles: [], q: null });
  }, []);

  // What a filtered-empty list says it looked for, in words.
  const lookedFor = (noun: "saved" | "recovered") => {
    const parts = [
      rangePhrase(range),
      profileFilter.length === 0
        ? null
        : `in ${profileFilter.map(profileLabel).join(" or ")}`,
      search.trim() === "" ? null : `matching "${search.trim()}"`,
    ].filter((part): part is string => part !== null);
    return `No ${list.complete ? "" : "loaded "}${noun} cache entries ${parts.join(" ")}.`;
  };

  // The figures read the saved entries only; with none (or a failed read)
  // they step aside and the lists carry the reason.
  const status = mixedReadStatus(
    { ...list, loaded: list.rows.length },
    {
      saved: savedInLens,
      recovered: recoveredInLens,
      savedLoaded: all.saved.length,
    },
  );

  const entryList = (noun: "saved" | "recovered") => (
    <EntryList
      rows={noun === "saved" ? all.saved : all.recovered}
      inLens={noun === "saved" ? savedInLens : recoveredInLens}
      visible={noun === "saved" ? savedVisible : recoveredVisible}
      noun={noun}
      loading={list.loading}
      draining={list.draining}
      error={list.error}
      complete={list.complete}
      filteredMessage={lookedFor(noun)}
      onRetry={list.retry}
      onSelect={sheet.select}
      onClearFilters={clearFilters}
    />
  );

  return (
    <CommitStatePage
      status={status}
      empty={
        <EmptyRows
          icon={ARTIFACT_ICONS.cache}
          title="No cache entries"
          message="No cache entries in this Case, saved or recovered."
        />
      }
      figuresSkeleton={<FiguresSkeleton />}
      figures={
        <div className="flex flex-col gap-5">
          <DrainNote
            draining={list.draining}
            message={`Reading the rest of the cache - ${list.rows.length.toLocaleString("en-US")} entries read so far. The figures grow as entries arrive.`}
          />
          <CacheSummary rows={savedInRange} complete={list.complete} />
          <LastUsedPanel
            rows={savedOfProfiles}
            range={range}
            onRangeChange={setRange}
            tokens={tokens}
          />
        </div>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            title="Cache entry"
            onClose={sheet.close}
          />
        )
      }
    >
      <SectionPanel id="cache-entries" title="Cache entries">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered cache entries"
          {...status.split}
          toolbar={
            <>
              <CompactFilters active={profileFilter.length > 0 ? 1 : 0}>
                <FilterField label="Sort" htmlFor="cache-sort">
                  <Select
                    value={sort}
                    onValueChange={(next) => {
                      setSort(
                        SORT_OPTIONS.find((option) => option.value === next)
                          ?.value ?? "last-used-desc",
                      );
                    }}
                  >
                    <SelectTrigger id="cache-sort" />
                    <SelectContent>
                      {SORT_OPTIONS.map((option, index) => (
                        <SelectItem
                          key={option.value}
                          index={index}
                          value={option.value}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
                {profiles.length > 1 ? (
                  <FilterField label="Profiles" htmlFor="cache-profiles">
                    <ProfilePicker
                      id="cache-profiles"
                      profiles={profiles}
                      selected={profileFilter}
                      onChange={setProfileFilter}
                    />
                  </FilterField>
                ) : null}
              </CompactFilters>
              <FilterTextField
                commit="change"
                label="Search loaded cache entries"
                icon={SearchIcon}
                placeholder="Search resource or host"
                value={search}
                onCommit={setSearch}
              />
            </>
          }
          saved={entryList("saved")}
          recovered={entryList("recovered")}
        />
      </SectionPanel>
    </CommitStatePage>
  );
}
