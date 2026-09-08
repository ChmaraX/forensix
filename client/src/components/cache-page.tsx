/**
 * The Cache page.
 *
 * Chrome's Simple Cache is a store of resource bodies, not browsing events, so
 * it is read the way an examiner reads a store: what was cached, how much disk
 * it took, which hosts left the biggest footprint, when each entry was last
 * touched, and whether the recovered bytes still verify. Four derived widgets
 * sit above a curated table:
 *
 *  - a summary strip (entries, total cached bytes, integrity-verified share,
 *    distinct hosts) — each a plain reading of a figure summed from the loaded
 *    rows, never a new query;
 *  - "Disk footprint by host" — top hosts ranked by summed payload bytes, the
 *    cache-specific metric the entry counts alone do not show;
 *  - "Last used over time" — a per-day histogram of the `lastUsed` instants,
 *    the cache's own activity shape (distinct from browsing History);
 *  - "Entry sizes" — the size distribution, so a mostly-headers cache reads
 *    apart from a mostly-media one at a glance.
 *
 * Presentation rules kept: the Completeness Statement ("Evidence coverage")
 * renders before any row; the four value states stay worded, never colour
 * alone; every derived figure is summed from real Finding fields, and a row
 * whose size or key is `unavailable`/`absent` is never counted as zero — it is
 * excluded from the sum and shown as its own word in the table. Nothing here
 * is inferred or projected: no trend line, no total beyond what the loaded
 * bytes add up to.
 */
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import { useChartTokens, usePrefersReducedMotion } from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";

/**
 * Reads the whole Cache list for this Case, up to a bounded number of pages.
 * The widgets sum over what is loaded; a cache with more entries than the cap
 * covers shows a plain "loaded N of more" note in the footer rather than
 * silently under-reporting a total. Cache rows arrive with committed and
 * recovered Commit States already mixed (the route cannot filter it), so a
 * single rank-neutral read is the whole set.
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

/** A short, human byte size ("1.4 MB", "812 B") — presentation only; the exact
 *  byte count stays reachable, mono, in the row detail sheet. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || value < 10 ? (value < 10 ? 1 : 0) : 1)} ${units[unit] ?? "KB"}`;
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
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

/** The resource host a cache key names, or `null` when the key is not a URL
 *  or is `unavailable`. Cache keys can carry a scope prefix; the URL inside is
 *  what identifies the resource, so a bare parse is enough for grouping. */
function keyHost(row: Finding): string | null {
  return hostOf(fieldText(row.fields.key));
}

/* --------------------------------- widgets -------------------------------- */


/**
 * The summary strip: four derived readings of the loaded set. Every figure is
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
    rows.length === 0
      ? 0
      : Math.round((summary.verified / rows.length) * 100);

  return (
    <MetricBand className="grid-cols-2 sm:grid-cols-4">
      <MetricBandItem
        label="Entries loaded"
        value={rows.length.toLocaleString("en-US")}
      />
      <MetricBandItem
        label="Cached on disk"
        value={
          summary.sizedEntries === 0 ? "—" : formatBytes(summary.totalBytes)
        }
        detail={
          summary.sizedEntries === 0
            ? "no recorded sizes"
            : `across ${summary.sizedEntries.toLocaleString("en-US")} sized ${summary.sizedEntries === 1 ? "entry" : "entries"}`
        }
      />
      <MetricBandItem
        label="Integrity verified"
        value={rows.length === 0 ? "—" : `${String(verifiedShare)}%`}
        detail={
          rows.length === 0
            ? undefined
            : `${summary.verified.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} entries`
        }
        progress={{ value: summary.verified, max: rows.length, tone: "success" }}
      />
      <MetricBandItem
        label="Distinct hosts"
        value={summary.hosts.toLocaleString("en-US")}
        detail="with a readable key"
      />
    </MetricBand>
  );
}

interface HostFootprint {
  readonly host: string;
  readonly bytes: number;
  readonly entries: number;
}

/** How many host rows the footprint board shows before "and N more". */
const FOOTPRINT_LIMIT = 8;

/**
 * "Disk footprint by host" — the hosts whose cached bodies took the most disk,
 * ranked by summed payload bytes rather than by entry count. This is the one
 * reading the raw table cannot give at a glance: a single large media entry
 * outweighs a hundred small ones, and the cache is where that shows.
 */
function HostFootprintCard({ rows }: { readonly rows: readonly Finding[] }) {
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
      .map(([host, agg]): HostFootprint => ({ host, ...agg }))
      .sort((left, right) => right.bytes - left.bytes);
  }, [rows]);

  const peak = hosts[0]?.bytes ?? 0;
  const shown = hosts.slice(0, FOOTPRINT_LIMIT);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Disk footprint by host</h2>
        <p className="text-[12px] text-muted-foreground">
          Cached bytes summed per host, largest first.
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-1 p-2">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No entries carry both a readable host and a recorded size.
          </p>
        ) : (
          shown.map((entry) => {
            const share =
              peak === 0 ? 0 : Math.round((entry.bytes / peak) * 100);
            return (
              <div
                key={entry.host}
                className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SiteAvatar host={entry.host} />
                  <span
                    className="truncate text-[12.5px] font-medium"
                    title={entry.host}
                  >
                    {entry.host.replace(/^www\./, "")}
                  </span>
                </span>
                <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-500",
                      entry.host === shown[0]?.host
                        ? "bg-primary"
                        : "bg-primary/45",
                    )}
                    style={{ width: `${String(Math.max(share, 2))}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums">
                  {formatBytes(entry.bytes)}
                </span>
              </div>
            );
          })
        )}
      </div>
      {hosts.length > FOOTPRINT_LIMIT ? (
        <p className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
          and {hosts.length - FOOTPRINT_LIMIT} more host
          {hosts.length - FOOTPRINT_LIMIT === 1 ? "" : "s"} in the table below
        </p>
      ) : null}
    </section>
  );
}

interface DayCount {
  readonly date: string;
  readonly count: number;
}

/**
 * "Last used over time" — a per-day histogram of the entries' `lastUsed`
 * instants. This is the cache's own activity shape: when cached content was
 * last read back, which an examiner reads alongside (not instead of) the
 * browsing Timeline. Days with no last-used entry between two active days are
 * filled with zero so the axis is continuous calendar time; entries whose
 * `lastUsed` is absent simply do not land on any bar.
 */
function LastUsedCard({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ReturnType<typeof useChartTokens>;
}) {
  const reduced = usePrefersReducedMotion();
  const days = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of rows) {
      const utc = fieldUtc(row.fields.lastUsed);
      if (utc === null) {
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
      return recorded;
    }
    const start = new Date(`${first.date}T00:00:00Z`).getTime();
    const end = new Date(`${last.date}T00:00:00Z`).getTime();
    const span = Math.round((end - start) / 86_400_000) + 1;
    // Cap gap-filling so a wide-but-sparse span never draws more bars than
    // pixels; past the cap the recorded days stand on their own.
    if (span <= recorded.length || span > 400) {
      return recorded;
    }
    const filled = new Map(recorded.map((day) => [day.date, day.count]));
    return Array.from({ length: span }, (_, index): DayCount => {
      const date = new Date(start + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return { date, count: filled.get(date) ?? 0 };
    });
  }, [rows]);

  const peak = days.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Last used over time</h2>
        <p className="text-[12px] text-muted-foreground">
          Cache entries by the day each was last read back.
        </p>
      </header>
      <div className="flex-1 px-4 py-3">
        {days.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            No entries carry a last-used time.
          </p>
        ) : (
          <div className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={days as DayCount[]}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickFormatter={formatTick}
                  tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                />
                <YAxis
                  width={30}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: tokens["--muted"], opacity: 0.5 }}
                  content={({ payload }) => {
                    const entry = Array.isArray(payload)
                      ? (payload[0] as { payload?: DayCount } | undefined)
                      : undefined;
                    const row = entry?.payload;
                    return row === undefined ? null : (
                      <div
                        className="rounded-md border px-3 py-2 text-[12px] shadow-md"
                        style={{
                          backgroundColor: tokens["--card"],
                          borderColor: tokens["--border"],
                          color: tokens["--foreground"],
                        }}
                      >
                        <p className="font-medium">{formatDay(row.date)}</p>
                        <p
                          className="tabular-nums"
                          style={{ color: tokens["--muted-foreground"] }}
                        >
                          {row.count.toLocaleString("en-US")} cache{" "}
                          {row.count === 1 ? "entry" : "entries"}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reduced}
                  animationDuration={500}
                  minPointSize={1}
                >
                  {days.map((day) => (
                    <Cell
                      key={day.date}
                      fill={tokens["--primary"]}
                      fillOpacity={day.count === peak && peak > 0 ? 1 : 0.45}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Size buckets for the distribution card. The edges are the round figures an
 * examiner reasons in — a header-sized entry vs. a document vs. a media blob —
 * so the shape of the store reads without a log scale to decode.
 */
const SIZE_BUCKETS: readonly {
  readonly label: string;
  readonly max: number;
}[] = [
  { label: "< 1 KB", max: 1024 },
  { label: "1–10 KB", max: 10 * 1024 },
  { label: "10–100 KB", max: 100 * 1024 },
  { label: "100 KB – 1 MB", max: 1024 * 1024 },
  { label: "> 1 MB", max: Number.POSITIVE_INFINITY },
];

/**
 * "Entry sizes" — the size distribution across fixed buckets, so a
 * mostly-headers cache reads apart from a mostly-media one at a glance.
 * Entries without a recorded size are excluded from the bars and reported
 * as a plain count beneath, never bucketed as zero.
 */
function SizeDistributionCard({ rows }: { readonly rows: readonly Finding[] }) {
  const { buckets, unsized } = useMemo(() => {
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
    return { buckets: counts, unsized: missing };
  }, [rows]);

  const peak = buckets.reduce((max, count) => Math.max(max, count), 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Entry sizes</h2>
        <p className="text-[12px] text-muted-foreground">
          How the cached entries spread across size bands.
        </p>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-2.5 px-4 py-4">
        {peak === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            No entries carry a recorded size.
          </p>
        ) : (
          SIZE_BUCKETS.map((bucket, index) => {
            const count = buckets[index] ?? 0;
            const share = peak === 0 ? 0 : Math.round((count / peak) * 100);
            return (
              <div
                key={bucket.label}
                className="grid grid-cols-[minmax(0,110px)_1fr_auto] items-center gap-3"
              >
                <span className="truncate text-[12px] text-muted-foreground">
                  {bucket.label}
                </span>
                <span className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/70 transition-[width] duration-500"
                    style={{ width: `${String(count === 0 ? 0 : Math.max(share, 3))}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums">
                  {count.toLocaleString("en-US")}
                </span>
              </div>
            );
          })
        )}
      </div>
      {unsized > 0 ? (
        <p className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
          {unsized.toLocaleString("en-US")} entr
          {unsized === 1 ? "y" : "ies"} carry no recorded size
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------------- table --------------------------------- */

/** The integrity word for the table: verified / failed / not recorded — the
 *  three states worded apart, never a colour-only tick. */
function integrityWord(row: Finding): {
  readonly label: string;
  readonly tone: "ok" | "fail" | "absent";
} {
  const keyHashValid = fieldBoolean(row.fields.keyHashValid);
  const crc = fieldBoolean(row.fields.stream1Crc32Valid);
  if (keyHashValid === false || crc === false) {
    return { label: "failed", tone: "fail" };
  }
  if (keyHashValid === true) {
    return { label: "verified", tone: "ok" };
  }
  return { label: "not recorded", tone: "absent" };
}

const TABLE_COLUMNS = [
  "Resource",
  "Host",
  "Size",
  "Last used",
  "Integrity",
  "State",
] as const;

function CacheTable({
  rows,
  filtered,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly filtered: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyRows
        message={
          filtered
            ? "No loaded cache entries match this filter."
            : "No cache entries in this Case."
        }
      />
    );
  }
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {TABLE_COLUMNS.map((label) => (
              <th
                key={label}
                className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = fieldText(row.fields.key);
            const keyUnavailable = row.fields.key?.state === "unavailable";
            const host = keyHost(row);
            const bytes = entryBytes(row);
            const utc = fieldUtc(row.fields.lastUsed);
            const instant = utc === null ? null : formatInstant(utc);
            const integrity = integrityWord(row);
            return (
              <tr
                key={`${row.profile}-${fieldText(row.fields.entryHash) ?? String(index)}`}
                tabIndex={0}
                aria-label="Open cache entry detail"
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
                <td className="max-w-[420px] px-3 py-2.5">
                  {key !== null ? (
                    <span
                      className="block truncate font-mono text-[12px] text-foreground/90"
                      title={key}
                    >
                      {key}
                    </span>
                  ) : keyUnavailable ? (
                    <span className="text-[12.5px] font-medium text-destructive">
                      unavailable
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      absent
                    </span>
                  )}
                </td>
                <td className="max-w-[180px] px-3 py-2.5">
                  {host !== null ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <SiteAvatar host={host} />
                      <span
                        className="truncate text-[12.5px] text-foreground/90"
                        title={host}
                      >
                        {host.replace(/^www\./, "")}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      absent
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {bytes !== null ? (
                    <span
                      className="font-mono text-[12px] tabular-nums"
                      title={`${bytes.toLocaleString("en-US")} bytes`}
                    >
                      {formatBytes(bytes)}
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      absent
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {instant !== null ? (
                    <span className="flex flex-col">
                      <span className="text-[12.5px] text-foreground/90 tabular-nums">
                        {instant.date}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                        {instant.time}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      absent
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[12px]",
                      integrity.tone === "ok"
                        ? "font-medium text-success"
                        : integrity.tone === "fail"
                          ? "font-medium text-destructive"
                          : "text-muted-foreground italic",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        integrity.tone === "ok"
                          ? "bg-success"
                          : integrity.tone === "fail"
                            ? "bg-destructive"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    {integrity.label}
                  </span>
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

/* ---------------------------------- page ---------------------------------- */

export function CachePage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useCacheEntries(config.route);
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<string | null>(null);

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.profile))].sort(),
    [list.rows],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return list.rows.filter((row) => {
      if (profileFilter !== null && row.profile !== profileFilter) {
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

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  return (
    <div className="flex flex-col gap-4">

      {list.error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The cache entries could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{list.error}</p>
          </div>
          <Button onClick={list.retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : list.loading && list.rows.length === 0 ? (
        <div className="flex flex-col gap-4" aria-label="Loading cache">
          <Skeleton className="h-[96px] w-full" />
          <div className="grid grid-cols-12 gap-4">
            <Skeleton className="col-span-12 h-[280px] lg:col-span-5" />
            <Skeleton className="col-span-12 h-[280px] lg:col-span-7" />
          </div>
          <Skeleton className="h-[320px] w-full" />
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyRows message="No cache entries in this Case." />
      ) : (
        <>
          <CacheSummary rows={list.rows} />

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-5">
              <HostFootprintCard rows={list.rows} />
            </div>
            <div className="col-span-12 lg:col-span-7">
              <LastUsedCard rows={list.rows} tokens={tokens} />
            </div>
          </div>

          <SizeDistributionCard rows={list.rows} />

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Cache entries</h2>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {visible.length}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {profiles.length > 1
                  ? profiles.map((profile) => (
                      <button
                        key={profile}
                        type="button"
                        aria-pressed={profileFilter === profile}
                        onClick={() => {
                          setProfileFilter(
                            profileFilter === profile ? null : profile,
                          );
                        }}
                        className={cn(
                          "inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                          profileFilter === profile
                            ? "border-accent-border bg-accent text-accent-foreground"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {profile}
                      </button>
                    ))
                  : null}
                <label className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                    placeholder="Search resource or host"
                    aria-label="Search loaded cache entries"
                    className="h-8 w-[220px] rounded-md border border-input bg-background pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </header>

            <CacheTable rows={visible} filtered={filtered} onSelect={select} />

            <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
              <p
                className="text-[12.5px] text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {filtered
                  ? `${String(visible.length)} of ${String(list.rows.length)} loaded ${list.rows.length === 1 ? "entry" : "entries"} shown`
                  : `${String(list.rows.length)} ${list.rows.length === 1 ? "entry" : "entries"} shown`}
                {list.complete ? "" : " · more available"}
              </p>
            </div>
          </section>
        </>
      )}

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
