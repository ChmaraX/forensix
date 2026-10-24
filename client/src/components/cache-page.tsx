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
 * Drawn with Fluid Functionalism: Panels per section, the shared chart parts
 * (FF tooltip surface, fluid band cursor), meter lists, an FF Table per list
 * with fluid row hover, and a compact toolbar (FF Select + InputGroup search).
 * The backend each entry was read from (Simple Cache, blockfile) and its
 * format version are stated beside the entry lists, read from the rows.
 *
 * Presentation rules kept: the four value states stay worded, never colour
 * alone; every derived figure is summed from real Finding fields, and a row
 * whose size or key is `unavailable`/`absent` is never counted as zero — it is
 * excluded from the sum and shown as its own word in the table. Saved entries
 * and entries recovered from a sidecar are two separate lists, never sorted
 * together. Nothing here is inferred or projected: no trend line, no total
 * beyond what the loaded bytes add up to.
 */
import { Database, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
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
import { CompletenessPanel } from "./completeness.js";
import {
  Count,
  formatBytes,
  MeterList,
  type MeterRow,
  plural,
  SectionHeading,
  splitByCommit,
  TimeText,
  Toolbar,
} from "./page-kit.js";
import {
  activeIndexOf,
  CHART_FOCUS_CLASS,
  chartAnimation,
  chartAxis,
  chartGrid,
  chartTooltipMotion,
  ChartEmpty,
  ChartTooltipCard,
  ChartTooltipNote,
  ChartTooltipValue,
  FluidBandCursor,
  FluidBar,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
  type ChartTokens,
} from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import { MaybeFieldStateText } from "./field-state.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows } from "./list-states.js";
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

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTick(date: string): string {
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

/* --------------------------------- widgets -------------------------------- */

/**
 * The summary band: four derived readings of the loaded set. Every figure is
 * summed from real fields — entries counted, bytes added only when a size was
 * recorded, integrity share over the entries that carry the signal — so an
 * examiner reads the store's shape before any row.
 */
function CacheSummary({ rows }: { readonly rows: readonly Finding[] }) {
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
        label="Entries loaded"
        value={rows.length.toLocaleString("en-US")}
        detail="cache entries read"
      />
      <MetricBandItem
        label="Cached on disk"
        value={
          summary.sizedEntries === 0
            ? "absent"
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
        value={rows.length === 0 ? "—" : `${String(verifiedShare)}%`}
        detail={
          rows.length === 0
            ? undefined
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

interface DayCount {
  readonly date: string;
  readonly count: number;
}

/**
 * "Last used over time" — a per-day bar chart of the entries' `lastUsed`
 * instants. This is the cache's own activity shape: when cached content was
 * last read back, which an examiner reads alongside (not instead of) the
 * browsing Timeline. Days with no last-used entry between two active days are
 * filled with zero so the axis is continuous calendar time; entries whose
 * `lastUsed` is absent simply do not land on any bar.
 */
function LastUsedPanel({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
    const first = recorded[0];
    const last = recorded[recorded.length - 1];
    if (first === undefined || last === undefined) {
      return { days: recorded, undated: missing };
    }
    const start = new Date(`${first.date}T00:00:00Z`).getTime();
    const end = new Date(`${last.date}T00:00:00Z`).getTime();
    const span = Math.round((end - start) / 86_400_000) + 1;
    // Cap gap-filling so a wide-but-sparse span never draws more bars than
    // pixels; past the cap the recorded days stand on their own.
    if (span <= recorded.length || span > 400) {
      return { days: recorded, undated: missing };
    }
    const filled = new Map(recorded.map((day) => [day.date, day.count]));
    return {
      days: Array.from({ length: span }, (_, index): DayCount => {
        const date = new Date(start + index * 86_400_000)
          .toISOString()
          .slice(0, 10);
        return { date, count: filled.get(date) ?? 0 };
      }),
      undated: missing,
    };
  }, [rows]);

  const peak = days.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Last used over time</PanelTitle>
          <PanelDescription>
            Cache entries by the day each was last read back.
          </PanelDescription>
        </div>
      </PanelHeader>
      <PanelContent className="pt-2">
        <div className="h-[180px] w-full">
          {days.length === 0 ? (
            <ChartEmpty>No entries carry a last-used time.</ChartEmpty>
          ) : (
            <ResponsiveContainer
              width="100%"
              height="100%"
              className={CHART_FOCUS_CLASS}
            >
              <BarChart
                data={days as DayCount[]}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onMouseMove={(state) => {
                  setHoverIndex(activeIndexOf(state));
                }}
                onMouseLeave={() => {
                  setHoverIndex(null);
                }}
              >
                <CartesianGrid {...chartGrid(tokens)} />
                <XAxis
                  dataKey="date"
                  {...chartAxis(tokens)}
                  minTickGap={40}
                  tickFormatter={formatTick}
                />
                <YAxis
                  width={32}
                  {...chartAxis(tokens)}
                  allowDecimals={false}
                />
                <Tooltip
                  {...chartTooltipMotion(reduced)}
                  cursor={<FluidBandCursor fill={tokens["--hover"]} />}
                  content={({ payload }) => {
                    const row = tooltipEntry(payload);
                    if (row === null) {
                      return null;
                    }
                    const count = Number(row["count"]);
                    return (
                      <ChartTooltipCard label={formatDay(String(row["date"]))}>
                        <ChartTooltipValue
                          value={count.toLocaleString("en-US")}
                          unit={count === 1 ? "cache entry" : "cache entries"}
                        />
                        {peak > 0 && count === peak ? (
                          <ChartTooltipNote>Busiest day</ChartTooltipNote>
                        ) : null}
                      </ChartTooltipCard>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[3, 3, 0, 0]}
                  {...chartAnimation(reduced)}
                  minPointSize={1}
                  fill={tokens["--primary"]}
                  shape={(props: BarShapeProps) => {
                    const day = days[props.originalDataIndex];
                    return (
                      <FluidBar
                        {...props}
                        fill={tokens["--primary"]}
                        opacity={
                          day !== undefined && peak > 0 && day.count === peak
                            ? 1
                            : 0.55
                        }
                        hovered={props.originalDataIndex === hoverIndex}
                      />
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {undated > 0 ? (
          <p className={cn(typeClass("caption"), "mt-2 text-muted-foreground")}>
            {plural(undated, "entry", "entries")} with no recorded last-used
            time not shown.
          </p>
        ) : null}
      </PanelContent>
    </Panel>
  );
}

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
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Disk footprint by host</PanelTitle>
          <PanelDescription>
            Cached bytes summed per host, largest first.
          </PanelDescription>
        </div>
      </PanelHeader>
      <PanelContent className="flex-1 pt-2">
        {meters.length === 0 ? (
          <EmptyRows
            className="py-8"
            message="No entries carry both a readable host and a recorded size."
          />
        ) : (
          <MeterList rows={meters} tokens={tokens} labelWidth="16rem" />
        )}
      </PanelContent>
      {more > 0 ? (
        <PanelFooter>
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            and {plural(more, "more host", "more hosts")} in the entry lists
            below
          </p>
        </PanelFooter>
      ) : null}
    </Panel>
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
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Entry sizes</PanelTitle>
          <PanelDescription>
            How the cached entries spread across size bands.
          </PanelDescription>
        </div>
      </PanelHeader>
      <PanelContent className="flex-1 pt-2">
        {sized === 0 ? (
          <EmptyRows
            className="py-8"
            message="No entries carry a recorded size."
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
    </Panel>
  );
}

/* ---------------------------------- table --------------------------------- */

/** The integrity word for the table: verified / failed / not recorded — the
 *  three states worded apart, the dot only repeating the word. */
function integrityWord(row: Finding): {
  readonly label: string;
  readonly state: EvidenceState;
} {
  const keyHashValid = fieldBoolean(row.fields.keyHashValid);
  const crc = fieldBoolean(row.fields.stream1Crc32Valid);
  if (keyHashValid === false || crc === false) {
    return { label: "failed", state: "unavailable" };
  }
  if (keyHashValid === true) {
    return { label: "verified", state: "produced" };
  }
  return { label: "not recorded", state: "absent" };
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
    <div className="scroll-fade-x overflow-x-auto px-2 py-1">
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
        <TableBody>
          {rows.map((row, index) => {
            const key = fieldText(row.fields.key);
            const host = keyHost(row);
            const bytes = entryBytes(row);
            const integrity = integrityWord(row);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={`${row.profile}-${fieldText(row.fields.entryHash) ?? String(index)}`}
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
                  {key !== null ? (
                    <span className="block truncate font-mono" title={key}>
                      {key}
                    </span>
                  ) : (
                    <MaybeFieldStateText field={row.fields.key} truncate />
                  )}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  {host !== null ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <SiteAvatar host={host} />
                      <span className="truncate" title={host}>
                        {host.replace(/^www\./, "")}
                      </span>
                    </span>
                  ) : (
                    <AbsentWord />
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {bytes !== null ? (
                    <span title={`${bytes.toLocaleString("en-US")} bytes`}>
                      {formatBytes(bytes)}
                    </span>
                  ) : (
                    <AbsentWord />
                  )}
                </TableCell>
                <TableCell>
                  <TimeText utc={fieldUtc(row.fields.lastUsed)} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <EvidenceDot state={integrity.state} />
                    {integrity.label}
                  </span>
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
 * The backends the loaded entries were read from, each with its format
 * versions — a reading of the `backend` and `version` fields, never assumed.
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
    <div className="flex flex-wrap items-center gap-1.5">
      {backends.map(([backend, entry]) => (
        <Badge key={backend} size="compact">
          <span className="font-mono">{backend}</span>
          {entry.versions.size > 0
            ? ` · format ${[...entry.versions].sort().join(", ")}`
            : ""}
          {` · ${plural(entry.count, "entry", "entries")}`}
        </Badge>
      ))}
    </div>
  );
}

/* --------------------------------- loading --------------------------------- */

/** Stands in for the summary band, the charts and the first rows while the
 *  cache loads. Built no taller than the real blocks. */
function CacheSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-[280px] w-full rounded-xl lg:col-span-7" />
        <Skeleton className="h-[280px] w-full rounded-xl lg:col-span-5" />
      </div>
      <Skeleton className="h-[360px] w-full rounded-xl" />
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
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.profile))].sort(),
    [list.rows],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return list.rows.filter((row) => {
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
  }, [list.rows, search, profileFilter]);

  const filtered = visible.length !== list.rows.length;
  const all = useMemo(() => splitByCommit(list.rows), [list.rows]);
  const shown = useMemo(() => splitByCommit(visible), [visible]);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const filteredEmpty = (
    <EmptyRows
      message="No loaded cache entries match this filter."
      action={
        <Button variant="tertiary" size="compact" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  );

  const ready = !list.loading;

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {list.error !== null ? (
        <Panel>
          <ErrorRows
            title="The cache entries could not be loaded."
            message={list.error}
            onRetry={list.retry}
          />
        </Panel>
      ) : ready && list.rows.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={Database}
            title="No cache entries"
            message="No cache entries in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <CacheSkeleton />
          {ready ? (
            <div className="flex flex-col gap-5">
              <CacheSummary rows={list.rows} />

              <div className="grid gap-5 lg:grid-cols-12">
                <div className="flex min-w-0 flex-col lg:col-span-7 [&>*]:flex-1">
                  <LastUsedPanel rows={list.rows} tokens={tokens} />
                </div>
                <div className="flex min-w-0 flex-col lg:col-span-5 [&>*]:flex-1">
                  <SizesPanel rows={list.rows} tokens={tokens} />
                </div>
              </div>

              <FootprintPanel rows={list.rows} tokens={tokens} />

              <section
                aria-label="Cache entries"
                className="flex flex-col gap-3"
              >
                <SectionHeading
                  title="Cache entries"
                  count={
                    filtered
                      ? `${String(visible.length)} of ${String(list.rows.length)}`
                      : list.rows.length
                  }
                  description={<BackendBadges rows={list.rows} />}
                  className="mt-3"
                >
                  <Toolbar placement="inline">
                    {profiles.length > 1 ? (
                      <FilterField label="Profile">
                        <ProfilePicker
                          profiles={profiles}
                          selected={profileFilter}
                          onChange={setProfileFilter}
                        />
                      </FilterField>
                    ) : null}
                    <FilterTextField
                      label="Search loaded cache entries"
                      icon={Search}
                      placeholder="Search resource or host…"
                      value={search}
                      onCommit={setSearch}
                    />
                  </Toolbar>
                </SectionHeading>

                <Panel className="overflow-clip">
                  <PanelHeader className="pb-1">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <PanelTitle>Saved</PanelTitle>
                        <Count>{shown.saved.length}</Count>
                      </div>
                      <PanelDescription>
                        Entries read from the cache index and its entry files.
                      </PanelDescription>
                    </div>
                  </PanelHeader>
                  {shown.saved.length === 0 ? (
                    filtered ? (
                      filteredEmpty
                    ) : (
                      <EmptyRows message="No saved entries. Every loaded entry was recovered." />
                    )
                  ) : (
                    <EntriesTable
                      rows={shown.saved}
                      showState={false}
                      onSelect={select}
                    />
                  )}
                  <PanelFooter>
                    <p
                      className={cn(
                        typeClass("caption"),
                        "text-muted-foreground tabular-nums",
                      )}
                      aria-live="polite"
                    >
                      {plural(list.rows.length, "entry", "entries")} loaded
                      {all.recovered.length > 0
                        ? ` · ${String(all.saved.length)} saved, ${String(all.recovered.length)} recovered`
                        : ""}
                      {list.complete ? "" : " · more available"}
                    </p>
                  </PanelFooter>
                </Panel>

                {all.recovered.length > 0 ? (
                  <Panel className="overflow-clip">
                    <PanelHeader className="pb-1">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <RotateCcw
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.5}
                            className="text-muted-foreground"
                          />
                          <PanelTitle>Recovered</PanelTitle>
                          <Count>{shown.recovered.length}</Count>
                        </div>
                        <PanelDescription>
                          Entries recovered by the analyzer rather than read as
                          saved, kept apart from the saved list.
                        </PanelDescription>
                      </div>
                    </PanelHeader>
                    {shown.recovered.length === 0 ? (
                      filteredEmpty
                    ) : (
                      <EntriesTable
                        rows={shown.recovered}
                        showState
                        onSelect={select}
                      />
                    )}
                  </Panel>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={"Cache entry"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
