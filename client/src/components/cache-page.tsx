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

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import { fillGaps } from "./activity-data.js";
import { cacheResourceHost, cacheSiteKey } from "./cache-keys.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { useChartTokens, type ChartTokens, type DayCount } from "./charts.js";
import { ActivityBars } from "./charts-ready.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  SiteAvatar,
  StateWord,
  profileLabel,
} from "./finding-fields.js";
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
  ProfilePicker,
} from "./filters.js";
import {
  DrainNote,
  ErrorRows,
  ListFooter,
  ListStatus,
  listStatusMessage,
  LoadingRows,
  RevealSwap,
} from "./list-states.js";
import { MetricBand, MetricBandItem, TooltipFigure } from "./metric-band.js";
import {
  CHART_HEIGHT,
  formatDay,
  formatDaySpan,
  CommitStateSplit,
  formatBytes,
  plural,
  ResponsiveRows,
  type RowColumn,
  SectionPanel,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";
import { SiteHostLink } from "./host-link.js";
import { useDrainedRead } from "./use-drained-read.js";

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

/* ------------------------------- field reads ------------------------------- */

/**
 * The payload size an entry stores on disk, in bytes, or `null` when the
 * evidence does not carry it. Prefers the whole-entry figure the index
 * records (`entrySizeBytes`); falls back to the recovered body stream
 * (`stream1Size`). A field that is `absent`/`unavailable`/non-integer returns
 * `null` and is never coerced to zero, so a missing size never quietly shrinks
 * a total.
 */
function entryBytes(row: Finding): number | null {
  return (
    fieldInteger(row.fields.entrySizeBytes) ??
    fieldInteger(row.fields.stream1Size)
  );
}

/**
 * A boolean-valued field read as `true` / `false` / `null`. The analyzer core
 * writes these flags as the strings `"true"`/`"false"` (`booleanField` in
 * `core/src/cache.ts`), while the design mock writes a JSON boolean; reading
 * both keeps the integrity words honest against real evidence and against the
 * mock the surface is iterated on. `absent`/`unavailable` (and any other
 * shape) read as `null`, never coerced to a verdict.
 */
function fieldBoolean(field: FieldState | undefined): boolean | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "boolean") {
    return field.value;
  }
  if (field.value === "true") {
    return true;
  }
  if (field.value === "false") {
    return false;
  }
  return null;
}

/** True when this entry carries an explicit "verified" integrity signal —
 *  a valid key hash and (when present) a valid stream-1 CRC. A missing signal
 *  is not verified; the table words the three apart, this only drives the
 *  summary share. */
function integrityVerified(row: Finding): boolean {
  const keyHashValid = fieldBoolean(row.fields.keyHashValid) === true;
  const crc = fieldBoolean(row.fields.stream1Crc32Valid);
  return keyHashValid && crc !== false;
}

/** The resource host a cache key names ("www.example.com"), or `null` when
 *  the key names no URL or is `unavailable`. A scope prefix ("_dk_…") is
 *  read past: the resource is the key's last part (`cacheResourceUrl`). */
function keyHost(row: Finding): string | null {
  return cacheResourceHost(row);
}

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
      // Hosts as Sites keys them (`siteKeyOf`), so the figure and the
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

/* ---------------------------------- table --------------------------------- */

/**
 * The integrity word for the table, from the two recorded checks' own
 * states: "failed" when either check recorded false; "verified" when the key
 * hash recorded true; "CRC verified" when only the stream-1 CRC recorded a
 * result (true); the key-hash field's own word ("unavailable" and its
 * reason, or its raw value) when it holds no verdict; "not recorded" only
 * when neither check was recorded at all. Every dot is a neutral ring
 * (absent for not recorded): amber means "recovered" on this page, not a
 * failed check, so the word alone carries the verdict.
 */
function IntegrityCell({ row }: { readonly row: Finding }) {
  const keyHashField = row.fields.keyHashValid;
  const keyHashValid = fieldBoolean(keyHashField);
  const crc = fieldBoolean(row.fields.stream1Crc32Valid);
  const word = (label: string, state: EvidenceState) => (
    <span className="inline-flex items-center gap-1.5">
      <EvidenceDot state={state} />
      {label}
    </span>
  );
  if (keyHashValid === false || crc === false) {
    return word("failed", "neutral");
  }
  if (keyHashValid === true) {
    return word("verified", "neutral");
  }
  if (keyHashField !== undefined && keyHashField.state !== "absent") {
    // Unavailable, (empty), or a value that is no verdict: as recorded.
    return <FieldCell field={keyHashField} />;
  }
  if (crc === true) {
    return word("CRC verified", "neutral");
  }
  const crcField = row.fields.stream1Crc32Valid;
  if (crcField !== undefined && crcField.state !== "absent") {
    return <FieldCell field={crcField} />;
  }
  return word("not recorded", "absent");
}

/**
 * The resource: the key's host over the cached key (mono, muted, a step
 * smaller), so the list scans by site and still shows the exact key. In the
 * table the host links to Sites when Sites lists it. A key that names no
 * URL host keeps the key alone - its value or its own state word
 * ("unavailable" and the reason).
 */
function ResourceCell({
  row,
  wide = true,
}: {
  readonly row: Finding;
  /** The table cell (avatar and host link); off in a phone card. */
  readonly wide?: boolean;
}) {
  const size = useSize();
  const host = keyHost(row);
  if (host === null) {
    return <FieldCell field={row.fields.key} mono />;
  }
  const lines = (
    <span className="flex min-w-0 flex-col">
      {wide ? (
        <SiteHostLink
          host={cacheSiteKey(row)}
          className={cn(
            size.type.body,
            "max-w-full self-start truncate text-foreground",
          )}
        >
          {host}
        </SiteHostLink>
      ) : (
        <span
          className={cn(size.type.body, "block truncate text-foreground")}
          title={host}
        >
          {host}
        </span>
      )}
      <SizeProvider size="compact">
        <span className="block min-w-0 text-muted-foreground">
          <FieldCell field={row.fields.key} mono />
        </span>
      </SizeProvider>
    </span>
  );
  if (!wide) {
    return lines;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={host} />
      <span className="min-w-0 flex-1">{lines}</span>
    </span>
  );
}

const RESOURCE_COLUMN: RowColumn<Finding> = {
  key: "resource",
  header: "Resource",
  className: "max-w-[400px] min-w-[240px]",
  stack: "title",
  cell: (row) => <ResourceCell row={row} />,
  stackedCell: (row) => <ResourceCell row={row} wide={false} />,
};

const SIZE_COLUMN: RowColumn<Finding> = {
  key: "size",
  header: "Size",
  // Fixed widths on the short columns (Resource takes the rest), so a
  // range, a filter or the Integrity column leaving never shifts them.
  className: "w-[96px] text-right whitespace-nowrap tabular-nums",
  cell: (row) => {
    const bytes = entryBytes(row);
    return bytes === null ? (
      <FieldCell field={row.fields.entrySizeBytes} />
    ) : (
      <span title={`${bytes.toLocaleString("en-US")} bytes`}>
        {formatBytes(bytes)}
      </span>
    );
  },
};

const LAST_USED_COLUMN: RowColumn<Finding> = {
  key: "last-used",
  header: "Last used (UTC)",
  label: "Last used",
  className: "w-[184px] whitespace-nowrap",
  stack: "lead",
  cell: (row) => <TimeCell field={row.fields.lastUsed} />,
};

const PROFILE_COLUMN: RowColumn<Finding> = {
  key: "profile",
  header: "Profile",
  className: "w-[136px] whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

const integrityColumn = (stack: "aside" | "meta"): RowColumn<Finding> => ({
  key: "integrity",
  header: "Integrity",
  className: "w-[136px] whitespace-nowrap",
  stack,
  cell: (row) => <IntegrityCell row={row} />,
});

const STATE_COLUMN: RowColumn<Finding> = {
  key: "state",
  header: "State",
  className: "w-[184px]",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** Saved entries: no State column (every row is saved), so the integrity
 *  word holds the stacked row's state slot. Recovered entries: the State
 *  word does, and integrity joins the meta line. */
const SAVED_COLUMNS: readonly RowColumn<Finding>[] = [
  RESOURCE_COLUMN,
  SIZE_COLUMN,
  LAST_USED_COLUMN,
  integrityColumn("aside"),
  PROFILE_COLUMN,
];

/** Saved entries that all read "verified": the Integrity column would say
 *  the same word on every row, and the "Integrity verified 100%" figure
 *  already does, so the list leaves it out (the sheet keeps both checks). */
const SAVED_COLUMNS_ALL_VERIFIED: readonly RowColumn<Finding>[] =
  SAVED_COLUMNS.filter((column) => column.key !== "integrity");

const RECOVERED_COLUMNS: readonly RowColumn<Finding>[] = [
  RESOURCE_COLUMN,
  SIZE_COLUMN,
  LAST_USED_COLUMN,
  integrityColumn("meta"),
  PROFILE_COLUMN,
  STATE_COLUMN,
];

/** A row's identity within its list: its source row (the Commit State
 *  keeps a WAL copy of a saved entry apart). Stable across a sort or a
 *  filter, so rows keep their memoised render. */
const entryKey = (row: Finding) =>
  `${row.commitState}:${row.profile}:${row.provenance.manifestPath ?? ""}:${row.provenance.table ?? ""}:${row.provenance.rowId ?? fieldText(row.fields.entryHash) ?? ""}`;

const entryLabel = (row: Finding) => {
  const host = keyHost(row);
  return `Open cache entry detail${host === null ? "" : ` for ${host}`}`;
};

function EntriesTable({
  rows,
  recovered,
  allVerified,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  /** Every saved entry of the list reads "verified". */
  readonly allVerified: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={
        recovered
          ? RECOVERED_COLUMNS
          : allVerified
            ? SAVED_COLUMNS_ALL_VERIFIED
            : SAVED_COLUMNS
      }
      rowKey={entryKey}
      rowLabel={entryLabel}
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One list (saved or recovered) of the loaded cache: its loading rows, the
 * read's error, its empty state, the rows, and — only while a filter
 * narrows it or the read stopped at its cap — a footer saying so. The whole
 * cache is one capped read, so there is no per-list "Load more".
 */
function EntryList({
  rows,
  inLens,
  visible,
  noun,
  loading,
  draining,
  error,
  complete,
  filteredMessage,
  onRetry,
  onSelect,
  onClearFilters,
}: {
  readonly rows: readonly Finding[];
  /** The rows in the lens (range, profiles): the base the tab counts and
   *  the footer reads "3 of 12" against. */
  readonly inLens: number;
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly loading: boolean;
  /** The rest of the cache is still being read. */
  readonly draining: boolean;
  readonly error: string | null;
  readonly complete: boolean;
  /** What a filtered-empty list says ("No saved cache entries last used
   *  12 Mar 2024."). */
  readonly filteredMessage: string;
  readonly onRetry: () => void;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  if (error !== null) {
    return (
      <ErrorRows
        title="The cache entries could not be loaded."
        message={error}
        onRetry={onRetry}
      />
    );
  }
  const filtered = visible.length !== rows.length;
  return (
    <>
      <ListStatus
        message={listStatusMessage({
          noun: { one: `${noun} cache entry`, many: `${noun} cache entries` },
          loading,
          failed: false,
          shown: visible.length,
          total: inLens,
          more: !complete,
          filtered,
        })}
      />
      <RevealSwap
        loading={loading}
        skeleton={
          <LoadingRows
            label={`Loading ${noun} cache entries`}
            announce={false}
          />
        }
      >
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? filteredMessage
                : noun === "saved"
                  ? "No saved cache entries. Every loaded entry was recovered."
                  : "No cache entries were recovered."
            }
            action={
              filtered ? (
                <Button
                  variant="tertiary"
                  size="compact"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EntriesTable
            rows={visible}
            recovered={noun === "recovered"}
            // Read over the whole list, not the filtered rows, so a filter
            // never adds or drops the column.
            allVerified={rows.length > 0 && rows.every(integrityVerified)}
            onSelect={onSelect}
          />
        )}
      </RevealSwap>
      {loading || visible.length === 0 ? null : (
        <ListFooter
          shown={visible.length}
          total={inLens}
          more={!complete && !draining}
          draining={draining}
        />
      )}
    </>
  );
}

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

export function CachePage({ config }: { readonly config: ArtifactConfig }) {
  const list = useCacheEntries(config.route);
  const tokens = useChartTokens();
  // Saved / Recovered, the search, the open row, and the Case-wide range
  // and profile pick live in the URL: Back and a refresh keep them.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  const [profileFilter, setProfileFilter] = useViewProfiles();
  const [range, setRange] = useViewRange();
  const [sort, setSort] = useState<EntrySort>("last-used-desc");
  // A URL-named entry this page has not loaded is read by its reference
  // (the cache route has no Commit State filter).
  const sheet = useRowSelection(list.rows, {
    route: config.route,
    byCommitState: false,
  });

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
    (rows: readonly Finding[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return sortEntries(
        rows.filter((row) => {
          if (!inLens(row)) {
            return false;
          }
          if (query === "") {
            return true;
          }
          const haystack = [
            fieldText(row.fields.key) ?? "",
            keyHost(row) ?? "",
            fieldText(row.fields.entryHash) ?? "",
          ]
            .join("\n")
            .toLocaleLowerCase("en-US");
          return haystack.includes(query);
        }),
        sort,
      );
    },
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

  // A page has landed without error: the counts are known (with "+"
  // while the rest drains).
  const settled = !list.loading && list.error === null;
  const pageEmpty = settled && !list.draining && list.rows.length === 0;
  // The figures read the saved entries only; with none (or a failed read)
  // they step aside and the lists carry the reason.
  const showFigures =
    list.loading || (list.error === null && all.saved.length > 0);

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
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ARTIFACT_ICONS.cache}
            title="No cache entries"
            message="No cache entries in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap loading={list.loading} skeleton={<FiguresSkeleton />}>
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
            </RevealSwap>
          ) : null}

          <SectionPanel id="cache-entries" title="Cache entries">
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered cache entries"
              savedCount={settled ? savedInLens : null}
              recoveredCount={settled ? recoveredInLens : null}
              savedMore={settled && !list.complete}
              recoveredMore={settled && !list.complete}
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
        </>
      )}

      {sheet.selected === null ? null : (
        <RowSheet
          selected={sheet.selected}
          title="Cache entry"
          onClose={sheet.close}
        />
      )}
    </div>
  );
}
