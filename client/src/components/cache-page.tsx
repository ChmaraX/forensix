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
 * time (a table from `sm` up, stacked rows below), with the profile picker
 * and a live search on the same toolbar.
 *
 * Presentation rules kept: the four value states stay worded, never colour
 * alone; a row whose size or key is `unavailable`/`absent` is never counted
 * as zero — it is left out of the sum and shown as its own word in the
 * table. Saved entries and entries recovered from a sidecar are two separate
 * lists, never sorted together; the Cache route cannot filter by Commit
 * State, so the one loaded set is split with `splitByCommit`, and every
 * figure counts the saved entries only. Nothing here is inferred.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { ArtifactConfig, FieldState, Finding, PageOf } from "../types.js";
import { fillGaps } from "./activity-data.js";
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
  hostOf,
  StateWord,
  TwoLineCell,
  profileLabel,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import {
  ErrorRows,
  ListFooter,
  LoadingRows,
  RevealSwap,
} from "./list-states.js";
import { MetricBand, MetricBandItem, TooltipFigure } from "./metric-band.js";
import {
  CHART_HEIGHT,
  formatDay,
  CommitStateSplit,
  type CommitView,
  formatBytes,
  plural,
  ResponsiveRows,
  type RowColumn,
  SectionPanel,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/**
 * Reads the whole Cache list for this Case, up to a bounded number of pages.
 * The widgets sum over what is loaded; a cache with more entries than the cap
 * covers shows a plain "more available" note in the footer rather than
 * silently under-reporting a total. Cache rows arrive with committed and
 * recovered Commit States already mixed (the route cannot filter it), so a
 * single rank-neutral read is the whole set; the page splits them for display.
 */
const CACHE_PAGE_CAP = 60;

function useCacheEntries(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setComplete(false);
    (async () => {
      const collected: Finding[] = [];
      let after: string | null = null;
      let ranOut = false;
      for (let page = 0; page < CACHE_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["sort", "last-used"],
          ["direction", "desc"],
          ["limit", "100"],
        ];
        if (after !== null) {
          parameters.push(["after", after]);
        }
        const result = await callApi<PageOf<Finding>>(route, parameters);
        // Unmounted, or Retry started a new read: stop following pages.
        if (cancelled) {
          return;
        }
        collected.push(...result.items);
        after = result.nextCursor;
        if (after === null) {
          ranOut = true;
          break;
        }
      }
      if (cancelled) {
        return;
      }
      setRows(collected);
      setComplete(ranOut);
      setLoading(false);
    })().catch((requestError: unknown) => {
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
  }, [route, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, complete, loading, error, retry };
}

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

/** The resource host a cache key names, or `null` when the key is not a URL
 *  or is `unavailable`. Cache keys can carry a scope prefix; the URL inside is
 *  what identifies the resource, so a bare parse is enough for grouping. */
function keyHost(row: Finding): string | null {
  return hostOf(fieldText(row.fields.key));
}

/* --------------------------------- widgets -------------------------------- */

/**
 * The figure strip: four readings of the loaded saved entries. Bytes are
 * added only when a size was recorded; the integrity share is over every
 * saved entry, a missing signal counting as not verified.
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
      const host = keyHost(row);
      if (host !== null) {
        hosts.add(host);
      }
    }
    return { totalBytes, sizedEntries, verified, hosts: hosts.size };
  }, [rows]);

  const verifiedShare =
    rows.length === 0 ? 0 : Math.round((summary.verified / rows.length) * 100);

  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Saved entries"
        value={`${rows.length.toLocaleString("en-US")}${complete ? "" : "+"}`}
      />
      <MetricBandItem
        label="Cached on disk"
        value={
          summary.sizedEntries === 0 ? (
            "not recorded"
          ) : summary.sizedEntries === rows.length ? (
            formatBytes(summary.totalBytes)
          ) : (
            <TooltipFigure
              value={formatBytes(summary.totalBytes)}
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
      />
      <MetricBandItem
        label="Distinct hosts"
        value={summary.hosts.toLocaleString("en-US")}
      />
    </MetricBand>
  );
}

/** The page's date range on the last-used day (`""` = an open bound). */
interface DayRange {
  readonly from: string;
  readonly to: string;
}

const FULL_SPAN: DayRange = { from: "", to: "" };

/** An entry's last-used day falls in the range; with a range set, an entry
 *  with no last-used time falls outside it. */
function lastUsedIn(row: Finding, range: DayRange): boolean {
  if (range.from === "" && range.to === "") {
    return true;
  }
  const utc = fieldUtc(row.fields.lastUsed);
  if (utc === null) {
    return false;
  }
  const day = utc.slice(0, 10);
  return (
    (range.from === "" || day >= range.from) &&
    (range.to === "" || day <= range.to)
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
  const days = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of rows) {
      const utc = fieldUtc(row.fields.lastUsed);
      if (utc !== null) {
        const date = utc.slice(0, 10);
        byDate.set(date, (byDate.get(date) ?? 0) + 1);
      }
    }
    const recorded = [...byDate.entries()]
      .map(([date, count]): DayCount => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));
    return fillGaps(recorded);
  }, [rows]);

  return (
    <ChartSection
      title="Last used over time"
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
 * The resource: the key's host over the cached URL (mono, muted, a step
 * smaller), so the list scans by site and still shows the exact key. A key
 * that names no URL host keeps the key alone — its value or its own state
 * word ("unavailable" and the reason).
 */
function ResourceCell({
  row,
  avatar = true,
}: {
  readonly row: Finding;
  readonly avatar?: boolean;
}) {
  const host = keyHost(row);
  return (
    <TwoLineCell
      primary={host === null ? row.fields.key : host.replace(/^www\./, "")}
      secondary={host === null ? null : row.fields.key}
      mono={host === null}
      avatar={avatar ? host : undefined}
    />
  );
}

const RESOURCE_COLUMN: RowColumn<Finding> = {
  key: "resource",
  header: "Resource",
  className: "max-w-[400px] min-w-[240px]",
  stack: "title",
  cell: (row) => <ResourceCell row={row} />,
  stackedCell: (row) => <ResourceCell row={row} avatar={false} />,
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
  header: "Last used",
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
      rowKey={(row, index) =>
        `${row.commitState}:${row.profile}:${fieldText(row.fields.entryHash) ?? ""}:${String(index)}`
      }
      rowLabel={(row) => {
        const host = keyHost(row);
        return `Open cache entry detail${host === null ? "" : ` for ${host}`}`;
      }}
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
  visible,
  noun,
  loading,
  error,
  complete,
  onRetry,
  onSelect,
  onClearFilters,
}: {
  readonly rows: readonly Finding[];
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly loading: boolean;
  readonly error: string | null;
  readonly complete: boolean;
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
      <RevealSwap
        loading={loading}
        skeleton={<LoadingRows label={`Loading ${noun} cache entries`} />}
      >
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No loaded ${noun} cache entries match these filters.`
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
          total={rows.length}
          more={!complete}
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
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading cache figures"
    >
      <Skeleton className="h-[148px] w-full rounded-xl lg:h-[74px]" />
      <Skeleton className="h-[290px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CachePage({ config }: { readonly config: ArtifactConfig }) {
  const list = useCacheEntries(config.route);
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);
  const [range, setRange] = useState<DayRange>(FULL_SPAN);

  // The Cache route cannot filter by Commit State: split the one loaded set.
  const all = useMemo(() => splitByCommit(list.rows), [list.rows]);

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.profile))].sort(),
    [list.rows],
  );

  const narrow = useCallback(
    (rows: readonly Finding[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return rows.filter((row) => {
        if (!lastUsedIn(row, range)) {
          return false;
        }
        if (profileFilter.length > 0 && !profileFilter.includes(row.profile)) {
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
      });
    },
    [search, profileFilter, range],
  );
  // The figures follow the date range (not the search or profile filter,
  // which only narrow the lists).
  const savedInRange = useMemo(
    () => all.saved.filter((row) => lastUsedIn(row, range)),
    [all.saved, range],
  );
  const savedVisible = useMemo(() => narrow(all.saved), [narrow, all.saved]);
  const recoveredVisible = useMemo(
    () => narrow(all.recovered),
    [narrow, all.recovered],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
    setRange(FULL_SPAN);
  }, []);

  // Read finished without error: the counts are known.
  const settled = !list.loading && list.error === null;
  const pageEmpty = settled && list.rows.length === 0;
  // The figures read the saved entries only; with none (or a failed read)
  // they step aside and the lists carry the reason.
  const showFigures =
    list.loading || (list.error === null && all.saved.length > 0);

  const entryList = (noun: "saved" | "recovered") => (
    <EntryList
      rows={noun === "saved" ? all.saved : all.recovered}
      visible={noun === "saved" ? savedVisible : recoveredVisible}
      noun={noun}
      loading={list.loading}
      error={list.error}
      complete={list.complete}
      onRetry={list.retry}
      onSelect={select}
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
                <CacheSummary rows={savedInRange} complete={list.complete} />
                <LastUsedPanel
                  rows={all.saved}
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
              savedCount={settled ? all.saved.length : null}
              recoveredCount={settled ? all.recovered.length : null}
              savedMore={settled && !list.complete}
              recoveredMore={settled && !list.complete}
              toolbar={
                <>
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

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title="Cache entry"
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
