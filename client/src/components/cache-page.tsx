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
import { Tooltip } from "@/components/ui/tooltip";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { ArtifactConfig, FieldState, Finding, PageOf } from "../types.js";
import { fillGaps } from "./activity-data.js";
import {
  ActivityBars,
  ChartEmpty,
  useChartTokens,
  type ChartTokens,
  type DayCount,
} from "./charts.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import {
  ErrorRows,
  ListFooter,
  LoadingRows,
  RevealSwap,
} from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import {
  CHART_HEIGHT,
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

/** A figure with its exact fraction on hover and focus ("16 of 16
 *  entries"), so the tile itself stays label + value. */
function FractionFigure({
  value,
  detail,
}: {
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <Tooltip content={detail}>
      <span tabIndex={0} className="cursor-help rounded-sm outline-none">
        {value}
      </span>
    </Tooltip>
  );
}

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
            <FractionFigure
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
            <FractionFigure
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

/** The quiet "Saved only" mark on a chart that draws saved rows only; its
 *  tooltip names what was left out. */
function SavedOnlyTag({ left }: { readonly left: string }) {
  return (
    <Tooltip content={left}>
      <span
        tabIndex={0}
        className={cn(
          typeClass("caption"),
          "cursor-help rounded-sm whitespace-nowrap text-muted-foreground outline-none",
        )}
      >
        Saved only
      </span>
    </Tooltip>
  );
}

/**
 * "Last used over time" — saved entries per day of their `lastUsed`
 * instant, on the shared `ActivityBars` (gap-filled calendar time). Entries
 * without a last-used time land on no bar; the chart's tag names them with
 * the recovered entries it leaves out.
 */
function LastUsedPanel({
  rows,
  recovered,
  tokens,
}: {
  readonly rows: readonly Finding[];
  /** Loaded recovered entries, not drawn. */
  readonly recovered: number;
  readonly tokens: ChartTokens;
}) {
  const { days, undated } = useMemo(() => {
    const byDate = new Map<string, number>();
    let missing = 0;
    for (const row of rows) {
      const utc = fieldUtc(row.fields.lastUsed);
      if (utc === null) {
        missing += 1;
        continue;
      }
      const date = utc.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + 1);
    }
    const recorded = [...byDate.entries()]
      .map(([date, count]): DayCount => ({ date, count }))
      .sort((left, right) => left.date.localeCompare(right.date));
    return { days: fillGaps(recorded), undated: missing };
  }, [rows]);

  const left = [
    recovered === 0
      ? null
      : `${plural(recovered, "recovered entry", "recovered entries")} not drawn`,
    undated === 0
      ? null
      : `${plural(undated, "saved entry", "saved entries")} with no last-used time`,
  ].filter((part): part is string => part !== null);

  return (
    <SectionPanel
      id="cache-last-used"
      title="Last used over time"
      aside={left.length === 0 ? null : <SavedOnlyTag left={left.join("; ")} />}
    >
      <div className="px-2 pt-2 pb-3">
        <div className={cn(CHART_HEIGHT, "w-full")}>
          {days.length === 0 ? (
            <ChartEmpty>No saved entries carry a last-used time.</ChartEmpty>
          ) : (
            <ActivityBars days={days} tokens={tokens} unit={CACHE_ENTRY_UNIT} />
          )}
        </div>
      </div>
    </SectionPanel>
  );
}

const CACHE_ENTRY_UNIT = { one: "cache entry", many: "cache entries" };

/* ---------------------------------- table --------------------------------- */

/** The integrity word for the table: verified / failed / not recorded — the
 *  three states worded apart, the dot only repeating the word (warning for
 *  failed, neutral for not recorded). */
function integrityWord(row: Finding): {
  readonly label: string;
  readonly state: EvidenceState;
} {
  const keyHashValid = fieldBoolean(row.fields.keyHashValid);
  const crc = fieldBoolean(row.fields.stream1Crc32Valid);
  if (keyHashValid === false || crc === false) {
    return { label: "failed", state: "warning" };
  }
  if (keyHashValid === true) {
    return { label: "verified", state: "produced" };
  }
  return { label: "not recorded", state: "absent" };
}

/** Integrity: the verdict word, or — when the key-hash signal itself could
 *  not be read — that field's own "unavailable" word and reason. */
function IntegrityCell({ row }: { readonly row: Finding }) {
  const integrity = integrityWord(row);
  if (
    integrity.label === "not recorded" &&
    row.fields.keyHashValid?.state === "unavailable"
  ) {
    return <FieldCell field={row.fields.keyHashValid} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <EvidenceDot state={integrity.state} />
      {integrity.label}
    </span>
  );
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
  const key = <FieldCell field={row.fields.key} mono />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <SiteAvatar host={host} /> : null}
      {host === null ? (
        <span className="min-w-0 flex-1">{key}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-foreground" title={host}>
            {host.replace(/^www\./, "")}
          </span>
          <SizeProvider size="compact">
            <span className="min-w-0 text-muted-foreground">{key}</span>
          </SizeProvider>
        </span>
      )}
    </span>
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
  className: "text-right whitespace-nowrap tabular-nums",
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
  className: "whitespace-nowrap",
  stack: "lead",
  cell: (row) => <TimeCell field={row.fields.lastUsed} />,
};

const PROFILE_COLUMN: RowColumn<Finding> = {
  key: "profile",
  header: "Profile",
  className: "whitespace-nowrap",
  cell: (row) => row.profile,
};

const integrityColumn = (stack: "aside" | "meta"): RowColumn<Finding> => ({
  key: "integrity",
  header: "Integrity",
  className: "whitespace-nowrap",
  stack,
  cell: (row) => <IntegrityCell row={row} />,
});

const STATE_COLUMN: RowColumn<Finding> = {
  key: "state",
  header: "State",
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
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={recovered ? RECOVERED_COLUMNS : SAVED_COLUMNS}
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
            onSelect={onSelect}
          />
        )}
      </RevealSwap>
      {loading || (!filtered && complete) || visible.length === 0 ? null : (
        <ListFooter
          count={visible.length}
          cursor={null}
          loading={false}
          onLoadMore={() => undefined}
          summary={
            <>
              {filtered
                ? `${visible.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`
                : plural(rows.length, `${noun} entry`, `${noun} entries`)}
              {complete
                ? ""
                : ` · reading stopped at ${(CACHE_PAGE_CAP * 100).toLocaleString("en-US")} entries; more stand in the Case`}
            </>
          }
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
    [search, profileFilter],
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
                <CacheSummary rows={all.saved} complete={list.complete} />
                <LastUsedPanel
                  rows={all.saved}
                  recovered={all.recovered.length}
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
