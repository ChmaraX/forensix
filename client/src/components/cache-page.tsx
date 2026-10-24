/**
 * The Cache page.
 *
 * Chrome's disk cache is a store of resource bodies, not browsing events, so
 * it is read the way an examiner reads a store: what was cached, how much disk
 * it took, which hosts left the biggest footprint, when each entry was last
 * touched, and whether the recovered bytes still verify. Derived readings sit
 * above the entry lists:
 *
 *  - a summary band (entries, total cached bytes, integrity-verified share,
 *    distinct hosts) — each a plain reading of a figure summed from the loaded
 *    rows, never a new query;
 *  - "Last used over time" — a per-day bar chart of the `lastUsed` instants,
 *    the cache's own activity shape (distinct from browsing History);
 *  - "Disk footprint by host" — top hosts ranked by summed payload bytes, the
 *    cache-specific metric the entry counts alone do not show;
 *  - "Entry sizes" — the size distribution, so a mostly-headers cache reads
 *    apart from a mostly-media one at a glance.
 *
 * Drawn with Fluid Functionalism: page-kit SectionPanels and a ChartSection,
 * the shared chart parts (FF tooltip surface, fluid band cursor), meter lists,
 * and one "Cache entries" panel whose Saved / Recovered switch
 * (CommitStateSplit) shows one FF Table at a time, with the profile picker
 * and a live search on the same toolbar. The backend each saved entry was
 * read from (Simple Cache, blockfile) and its format version are stated in
 * that panel's header, read from the rows.
 *
 * Presentation rules kept: the four value states stay worded, never colour
 * alone; every derived figure is summed from real Finding fields, and a row
 * whose size or key is `unavailable`/`absent` is never counted as zero — it is
 * excluded from the sum and shown as its own word in the table. Saved entries
 * and entries recovered from a sidecar are two separate lists, never sorted
 * together; the Cache route cannot filter by Commit State, so the one loaded
 * set is split with `splitByCommit`, and every figure counts the saved
 * entries only. Nothing here is inferred or projected: no trend line, no
 * total beyond what the loaded bytes add up to.
 */
import { Database, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, PanelContent, PanelFooter } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import { ChartSection } from "./chart-section.js";
import { CompletenessPanel } from "./completeness.js";
import {
  CHART_HEIGHT,
  CommitStateSplit,
  type CommitView,
  formatBytes,
  MeterList,
  type MeterRow,
  plural,
  SectionPanel,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { fillGaps } from "./activity-data.js";
import {
  ActivityBars,
  ChartEmpty,
  useChartTokens,
  type ChartTokens,
  type DayCount,
} from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import {
  AbsentWord,
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
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

/**
 * The summary band: four derived readings of the loaded saved entries. Every
 * figure is summed from real fields — entries counted, bytes added only when
 * a size was recorded, integrity share over the entries that carry the
 * signal — so an examiner reads the store's shape before any row. Recovered
 * entries are named apart, never added in.
 */
function CacheSummary({
  rows,
  recovered,
  complete,
}: {
  readonly rows: readonly Finding[];
  /** Loaded recovered entries, listed apart. */
  readonly recovered: number;
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
        detail={
          recovered === 0
            ? "cache entries read"
            : `${plural(recovered, "recovered entry", "recovered entries")} listed apart`
        }
      />
      <MetricBandItem
        label="Cached on disk"
        value={
          summary.sizedEntries === 0
            ? "not recorded"
            : formatBytes(summary.totalBytes)
        }
        detail={
          summary.sizedEntries === 0
            ? "no recorded sizes"
            : `across ${plural(summary.sizedEntries, "sized entry", "sized entries")}`
        }
      />
      <MetricBandItem
        label="Integrity verified"
        value={rows.length === 0 ? "not recorded" : `${String(verifiedShare)}%`}
        detail={
          rows.length === 0
            ? "no saved entries"
            : `${summary.verified.toLocaleString("en-US")} of ${plural(rows.length, "entry", "entries")}`
        }
        progress={{
          value: summary.verified,
          max: rows.length,
          tone: "success",
        }}
      />
      <MetricBandItem
        label="Distinct hosts"
        value={summary.hosts.toLocaleString("en-US")}
        detail="with a readable key"
      />
    </MetricBand>
  );
}

/**
 * "Last used over time" — saved entries per day of their `lastUsed` instant,
 * on the shared `ActivityBars` (gap-filled, continuous calendar time).
 * Entries whose `lastUsed` is absent land on no bar and are counted in the
 * footer.
 */
function LastUsedPanel({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
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

  return (
    <ChartSection
      title="Last used over time"
      description="Saved cache entries by the day each was last read back."
      className="h-full"
      footer={
        undated > 0 ? (
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            {plural(undated, "entry", "entries")} with no last-used time not
            shown.
          </p>
        ) : undefined
      }
    >
      <div className="flex-1 px-2 pt-2 pb-3">
        <div className={cn(CHART_HEIGHT, "w-full")}>
          {days.length === 0 ? (
            <ChartEmpty>No saved entries carry a last-used time.</ChartEmpty>
          ) : (
            <ActivityBars days={days} tokens={tokens} unit={CACHE_ENTRY_UNIT} />
          )}
        </div>
      </div>
    </ChartSection>
  );
}

const CACHE_ENTRY_UNIT = { one: "cache entry", many: "cache entries" };

/** How many host rows the footprint list shows before "and N more". */
const FOOTPRINT_LIMIT = 8;

/**
 * "Disk footprint by host" — the hosts whose cached bodies took the most disk,
 * ranked by summed payload bytes rather than by entry count. This is the one
 * reading the raw table cannot give at a glance: a single large media entry
 * outweighs a hundred small ones, and the cache is where that shows.
 */
function FootprintPanel({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ChartTokens;
}) {
  const hosts = useMemo(() => {
    const byHost = new Map<string, { bytes: number; entries: number }>();
    for (const row of rows) {
      const host = keyHost(row);
      const bytes = entryBytes(row);
      if (host === null || bytes === null) {
        continue;
      }
      const existing = byHost.get(host) ?? { bytes: 0, entries: 0 };
      byHost.set(host, {
        bytes: existing.bytes + bytes,
        entries: existing.entries + 1,
      });
    }
    return [...byHost.entries()]
      .map(([host, agg]) => ({ host, ...agg }))
      .sort((left, right) => right.bytes - left.bytes);
  }, [rows]);

  const meters: MeterRow[] = hosts.slice(0, FOOTPRINT_LIMIT).map((entry) => ({
    key: entry.host,
    label: (
      <>
        <SiteAvatar host={entry.host} />
        <span className="truncate" title={entry.host}>
          {entry.host.replace(/^www\./, "")}
        </span>
      </>
    ),
    value: entry.bytes,
    display: formatBytes(entry.bytes),
    title: `${entry.bytes.toLocaleString("en-US")} bytes in ${plural(entry.entries, "entry", "entries")}`,
  }));
  const more = hosts.length - FOOTPRINT_LIMIT;

  return (
    <SectionPanel
      id="cache-footprint"
      title="Disk footprint by host"
      description="Saved cached bytes summed per host, largest first."
    >
      <PanelContent className="flex-1 pt-2">
        {meters.length === 0 ? (
          <EmptyRows
            className="py-8"
            message="No saved entries carry both a readable host and a recorded size."
          />
        ) : (
          <MeterList rows={meters} tokens={tokens} labelWidth="16rem" />
        )}
      </PanelContent>
      {more > 0 ? (
        <PanelFooter>
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            and {plural(more, "more host", "more hosts")} in the saved entries
            below
          </p>
        </PanelFooter>
      ) : null}
    </SectionPanel>
  );
}

/**
 * Size buckets for the distribution. The edges are the round figures an
 * examiner reasons in — a header-sized entry vs. a document vs. a media blob —
 * so the shape of the store reads without a log scale to decode.
 */
const SIZE_BUCKETS: readonly {
  readonly label: string;
  readonly max: number;
}[] = [
  { label: "Under 1 KB", max: 1024 },
  { label: "1 to 10 KB", max: 10 * 1024 },
  { label: "10 to 100 KB", max: 100 * 1024 },
  { label: "100 KB to 1 MB", max: 1024 * 1024 },
  { label: "Over 1 MB", max: Number.POSITIVE_INFINITY },
];

/**
 * "Entry sizes" — the size distribution across fixed buckets. Entries without
 * a recorded size are excluded from the bars and reported as a plain count
 * beneath, never bucketed as zero.
 */
function SizesPanel({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ChartTokens;
}) {
  const { meters, unsized } = useMemo(() => {
    const counts = SIZE_BUCKETS.map(() => 0);
    let missing = 0;
    for (const row of rows) {
      const bytes = entryBytes(row);
      if (bytes === null) {
        missing += 1;
        continue;
      }
      const index = SIZE_BUCKETS.findIndex((bucket) => bytes < bucket.max);
      const target = index === -1 ? SIZE_BUCKETS.length - 1 : index;
      counts[target] = (counts[target] ?? 0) + 1;
    }
    return {
      meters: SIZE_BUCKETS.map(
        (bucket, index): MeterRow => ({
          key: bucket.label,
          label: bucket.label,
          value: counts[index] ?? 0,
          display: (counts[index] ?? 0).toLocaleString("en-US"),
          title: plural(counts[index] ?? 0, "entry", "entries"),
        }),
      ),
      unsized: missing,
    };
  }, [rows]);

  const sized = rows.length - unsized;

  return (
    <SectionPanel
      id="cache-sizes"
      title="Entry sizes"
      description="How the saved cache entries spread across size bands."
      className="h-full"
    >
      <PanelContent className="flex-1 pt-2">
        {sized === 0 ? (
          <EmptyRows
            className="py-8"
            message="No saved entries carry a recorded size."
          />
        ) : (
          <MeterList rows={meters} tokens={tokens} labelWidth="8rem" />
        )}
      </PanelContent>
      {unsized > 0 ? (
        <PanelFooter>
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            {plural(unsized, "entry carries", "entries carry")} no recorded size
          </p>
        </PanelFooter>
      ) : null}
    </SectionPanel>
  );
}

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

/** The host column: the key's host, else the key's own state word; a
 *  recorded key that names no URL host reads "absent". */
function HostCell({ row }: { readonly row: Finding }) {
  const host = keyHost(row);
  if (host === null) {
    const key = row.fields.key;
    return key === undefined || (key.state === "value" && key.value !== "") ? (
      <AbsentWord />
    ) : (
      <FieldCell field={key} />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SiteAvatar host={host} />
      <span className="truncate" title={host}>
        {host.replace(/^www\./, "")}
      </span>
    </span>
  );
}

function EntriesTable({
  rows,
  showState,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly showState: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Resource</TableHead>
            <TableHead className="whitespace-nowrap">Host</TableHead>
            <TableHead className="whitespace-nowrap text-right">Size</TableHead>
            <TableHead className="whitespace-nowrap">Last used</TableHead>
            <TableHead className="whitespace-nowrap">Integrity</TableHead>
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            {showState ? (
              <TableHead className="whitespace-nowrap">State</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const host = keyHost(row);
            const bytes = entryBytes(row);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={`${row.commitState}:${row.profile}:${fieldText(row.fields.entryHash) ?? ""}:${String(index)}`}
                index={index}
                tabIndex={0}
                aria-label={`Open cache entry detail${host === null ? "" : ` for ${host}`}`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="max-w-[380px] min-w-[220px] text-foreground">
                  <FieldCell field={row.fields.key} />
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <HostCell row={row} />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {bytes !== null ? (
                    <span title={`${bytes.toLocaleString("en-US")} bytes`}>
                      {formatBytes(bytes)}
                    </span>
                  ) : (
                    <FieldCell field={row.fields.entrySizeBytes} />
                  )}
                </TableCell>
                <TableCell>
                  <TimeCell field={row.fields.lastUsed} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <IntegrityCell row={row} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.profile}
                </TableCell>
                {showState ? (
                  <TableCell>
                    <StateWord state={row.commitState} />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The backends the loaded saved entries were read from, each with its format
 * versions — a reading of the `backend` and `version` fields, never assumed.
 * Plain Badges: these are labels, not states.
 */
function BackendBadges({ rows }: { readonly rows: readonly Finding[] }) {
  const backends = useMemo(() => {
    const byBackend = new Map<
      string,
      { count: number; versions: Set<string> }
    >();
    for (const row of rows) {
      const backend = fieldText(row.fields.backend);
      if (backend === null) {
        continue;
      }
      const entry = byBackend.get(backend) ?? { count: 0, versions: new Set() };
      entry.count += 1;
      const version = fieldText(row.fields.version);
      if (version !== null) {
        entry.versions.add(version);
      }
      byBackend.set(backend, entry);
    }
    return [...byBackend.entries()].sort(
      ([, left], [, right]) => right.count - left.count,
    );
  }, [rows]);

  if (backends.length === 0) {
    return null;
  }
  return (
    // Spans only: this sits inside the panel's description paragraph.
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {backends.map(([backend, entry]) => (
        <Badge key={backend} size="compact">
          <span className="font-mono">{backend}</span>
          {entry.versions.size > 0
            ? ` · format ${[...entry.versions].sort().join(", ")}`
            : ""}
          {` · ${plural(entry.count, "saved entry", "saved entries")}`}
        </Badge>
      ))}
    </span>
  );
}

/**
 * One list (saved or recovered) of the loaded cache: its loading rows, the
 * read's error, its empty state, the table, and the "N shown" footer. The
 * whole cache is one capped read, so there is no per-list "Load more".
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
      <div className="reveal-swap">
        <LoadingRows label={`Loading ${noun} cache entries`} />
        {loading ? null : visible.length === 0 ? (
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
            showState={noun === "recovered"}
            onSelect={onSelect}
          />
        )}
      </div>
      {loading ? null : (
        <ListFooter
          count={visible.length}
          cursor={null}
          loading={false}
          onLoadMore={() => undefined}
          summary={
            <>
              {filtered
                ? `${visible.length.toLocaleString("en-US")} of ${plural(rows.length, `loaded ${noun} entry`, `loaded ${noun} entries`)} shown`
                : `${plural(rows.length, `${noun} entry`, `${noun} entries`)} shown`}
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

/** Stands in for the summary band and the charts while the cache loads, at
 *  their size. */
function FiguresSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading cache figures"
    >
      <Skeleton className="h-[78px] w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-[318px] w-full rounded-xl lg:col-span-7" />
        <Skeleton className="h-[318px] w-full rounded-xl lg:col-span-5" />
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CachePage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
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
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={Database}
            title="No cache entries"
            message="No cache entries in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <FiguresSkeleton />
              {list.loading ? null : (
                <div className="flex flex-col gap-5">
                  <CacheSummary
                    rows={all.saved}
                    recovered={all.recovered.length}
                    complete={list.complete}
                  />
                  <div className="grid gap-4 lg:grid-cols-12">
                    <div className="flex min-w-0 flex-col lg:col-span-7">
                      <LastUsedPanel rows={all.saved} tokens={tokens} />
                    </div>
                    <div className="flex min-w-0 flex-col lg:col-span-5">
                      <SizesPanel rows={all.saved} tokens={tokens} />
                    </div>
                  </div>
                  <FootprintPanel rows={all.saved} tokens={tokens} />
                </div>
              )}
            </div>
          ) : null}

          <SectionPanel
            id="cache-entries"
            title="Cache entries"
            description={
              <>
                Saved entries and entries recovered by the analyzer are separate
                lists.
                <BackendBadges rows={all.saved} />
              </>
            }
          >
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
                    icon={Search}
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
