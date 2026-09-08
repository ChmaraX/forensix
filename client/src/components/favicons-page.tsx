/**
 * The Favicons page.
 *
 * Chrome stores one bitmap per site icon it has seen, keyed by an icon URL and
 * carrying the pages that reference it. Read as a generic evidence dump this is
 * a wall of hashes; read as what it *is* — the browser's own visual index of
 * every host it has rendered — it answers three forensic questions a table
 * alone buries: which hosts left a cached icon at all, at what fidelity the
 * browser held them, and when each icon was last refreshed (a visit proxy that
 * survives even when History does not).
 *
 * The three summary tiles, the resolution breakdown, and the freshness strip
 * are all counts read straight off the loaded rows — nothing is inferred, no
 * axis is projected past the last recorded icon, and every wire field stays
 * reachable through the row detail sheet.
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * a row without its own recorded value reads as the word "absent" or
 * "unavailable", never color alone; states are worded; nothing here is
 * presented as an inference.
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
import {
  useChartTokens,
  usePrefersReducedMotion,
  type ChartTokens,
} from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
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

/* ------------------------------- data loading ------------------------------ */

/** One update-time-sorted read across every Commit State, paginated by the route. */
function useFavicons(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Finding>>(route, [
      ["sort", "last-updated"],
      ["direction", "desc"],
    ])
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
  }, [route, nonce]);

  const loadMore = useCallback(() => {
    if (cursor === null) {
      return;
    }
    setLoading(true);
    callApi<PageOf<Finding>>(route, [
      ["sort", "last-updated"],
      ["direction", "desc"],
      ["after", cursor],
    ])
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
  }, [route, cursor]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, cursor, loading, error, loadMore, retry };
}

/* ------------------------------- field reads ------------------------------- */

/** The host a favicon belongs to: its icon URL host, then its first page URL. */
function faviconHost(row: Finding): string | null {
  const fromIcon = hostOf(fieldText(row.fields.iconUrl));
  if (fromIcon !== null) {
    return fromIcon.replace(/^www\./, "");
  }
  const pages = row.fields.pageUrls;
  if (pages !== undefined && pages.state === "value") {
    const list = pages.value;
    if (Array.isArray(list)) {
      const first = list.find((entry): entry is string => typeof entry === "string");
      const host = hostOf(first ?? null);
      if (host !== null) {
        return host.replace(/^www\./, "");
      }
    }
  }
  return null;
}

/** A favicon's stored resolution as a `"32×32"` label, or null when absent. */
function resolutionLabel(row: Finding): string | null {
  const width = fieldInteger(row.fields.width);
  const height = fieldInteger(row.fields.height);
  if (width === null || height === null) {
    return null;
  }
  return `${String(width)}×${String(height)}`;
}

/** The larger stored edge of a favicon, used to bucket resolutions. */
function faviconEdge(row: Finding): number | null {
  const width = fieldInteger(row.fields.width);
  const height = fieldInteger(row.fields.height);
  if (width === null && height === null) {
    return null;
  }
  return Math.max(width ?? 0, height ?? 0);
}

function faviconBytes(row: Finding): number | null {
  return fieldInteger(row.fields.payloadBytes);
}

/* -------------------------------- formatting ------------------------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib < 10 ? kib.toFixed(1) : String(Math.round(kib))} KB`;
  }
  return `${(kib / 1024).toFixed(1)} MB`;
}

/* --------------------------------- widgets --------------------------------- */

/**
 * The read-at-a-glance summary: how many icons the Case holds, how many
 * distinct hosts they cover, how many distinct stored bitmaps there truly are
 * (identical hashes across hosts are the browser reusing one image), and the
 * total on-disk footprint. Every figure is a plain count of the loaded rows.
 */
function SummaryTiles({ rows }: { readonly rows: readonly Finding[] }) {
  const stats = useMemo(() => {
    const hosts = new Set<string>();
    const hashes = new Set<string>();
    let totalBytes = 0;
    let sizedRows = 0;
    for (const row of rows) {
      const host = faviconHost(row);
      if (host !== null) {
        hosts.add(host);
      }
      const hash = fieldText(row.fields.payloadSha256);
      if (hash !== null) {
        hashes.add(hash);
      }
      const bytes = faviconBytes(row);
      if (bytes !== null) {
        totalBytes += bytes;
        sizedRows += 1;
      }
    }
    return {
      icons: rows.length,
      hosts: hosts.size,
      distinctBitmaps: hashes.size,
      totalBytes,
      sizedRows,
    };
  }, [rows]);

  const tiles = [
    {
      label: "Cached icons",
      value: stats.icons.toLocaleString("en-US"),
      detail: "site icons stored",
    },
    {
      label: "Distinct hosts",
      value: stats.hosts.toLocaleString("en-US"),
      detail: "hosts with a cached icon",
    },
    {
      label: "Unique bitmaps",
      value: stats.distinctBitmaps.toLocaleString("en-US"),
      detail:
        stats.distinctBitmaps < stats.icons
          ? `${String(stats.icons - stats.distinctBitmaps)} share an image`
          : "no reused images",
    },
    {
      label: "Stored size",
      value: stats.sizedRows === 0 ? "absent" : formatBytes(stats.totalBytes),
      detail:
        stats.sizedRows === 0
          ? "no recorded byte sizes"
          : `across ${String(stats.sizedRows)} icon${stats.sizedRows === 1 ? "" : "s"}`,
    },
  ];

  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <MetricBandItem
          key={tile.label}
          label={tile.label}
          value={tile.value}
          detail={tile.detail}
        />
      ))}
    </MetricBand>
  );
}

interface ResolutionBucket {
  readonly label: string;
  readonly edge: number;
  readonly count: number;
}

/**
 * Icons grouped by the largest edge Chrome stored them at. Favicon fidelity is
 * evidence in its own right: a site the browser rendered at 48px was pinned,
 * tabbed, or bookmarked, where a bare 16px icon was only ever a list entry.
 * Bars carry the same rounded cap and single-accent grammar as the Overview's
 * hour chart; the tallest bucket is the only one held at full strength.
 */
function ResolutionChart({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const { buckets, absentCount } = useMemo(() => {
    const byEdge = new Map<number, number>();
    let missing = 0;
    for (const row of rows) {
      const edge = faviconEdge(row);
      if (edge === null || edge === 0) {
        missing += 1;
        continue;
      }
      byEdge.set(edge, (byEdge.get(edge) ?? 0) + 1);
    }
    const ordered: ResolutionBucket[] = [...byEdge.entries()]
      .sort(([left], [right]) => left - right)
      .map(([edge, count]) => ({
        edge,
        count,
        label: `${String(edge)}px`,
      }));
    return { buckets: ordered, absentCount: missing };
  }, [rows]);

  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Stored resolution</h2>
        <p className="text-[12px] text-muted-foreground">
          Icons grouped by their largest stored edge — higher fidelity marks a
          more prominent site.
        </p>
      </header>
      <div className="px-4 py-3">
        {buckets.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            No icons carry a recorded resolution.
          </p>
        ) : (
          <div className="h-[168px] w-full" aria-label="Icons per stored resolution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={buckets}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                />
                <YAxis
                  width={32}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: tokens["--muted"], opacity: 0.5 }}
                  content={({ payload }) => {
                    const entry = Array.isArray(payload)
                      ? (payload[0] as { payload?: ResolutionBucket } | undefined)
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
                        <p className="font-medium">{row.edge}×{row.edge} pixels</p>
                        <p
                          className="tabular-nums"
                          style={{ color: tokens["--muted-foreground"] }}
                        >
                          {row.count.toLocaleString("en-US")} icon
                          {row.count === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[5, 5, 5, 5]}
                  isAnimationActive={!reduced}
                  animationDuration={600}
                  minPointSize={2}
                >
                  {buckets.map((bucket) => (
                    <Cell
                      key={bucket.edge}
                      fill={tokens["--primary"]}
                      fillOpacity={bucket.count === peak ? 1 : 0.35}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {absentCount > 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {absentCount.toLocaleString("en-US")} icon
            {absentCount === 1 ? "" : "s"} with no recorded resolution not shown.
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface FreshnessBucket {
  readonly bucket: string;
  readonly label: string;
  readonly count: number;
  readonly order: number;
}

/**
 * When each cached icon was last refreshed, bucketed by age. A favicon's
 * `lastUpdated` is written when the browser last re-fetched the icon, so this
 * strip is a coarse recency signal for the site itself — one that survives even
 * when the visit was cleared from History. Buckets are fixed, evidence-derived
 * age bands, never a smoothed trend.
 */
function FreshnessChart({
  rows,
  tokens,
}: {
  readonly rows: readonly Finding[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const { buckets, absentCount } = useMemo(() => {
    // The final band's `maxDays: Infinity` guarantees every dated icon lands
    // in exactly one band, so the `find` below never falls through.
    const bands: readonly {
      readonly bucket: string;
      readonly label: string;
      readonly order: number;
      readonly maxDays: number;
    }[] = [
      { bucket: "7d", label: "≤ 7 days", order: 0, maxDays: 7 },
      { bucket: "30d", label: "8–30 days", order: 1, maxDays: 30 },
      { bucket: "90d", label: "31–90 days", order: 2, maxDays: 90 },
      { bucket: "older", label: "> 90 days", order: 3, maxDays: Infinity },
    ];
    const counts = new Map<string, number>();
    const now = Date.now();
    let missing = 0;
    for (const row of rows) {
      const utc = fieldUtc(row.fields.lastUpdated);
      if (utc === null) {
        missing += 1;
        continue;
      }
      const parsed = new Date(utc).getTime();
      if (Number.isNaN(parsed)) {
        missing += 1;
        continue;
      }
      const ageDays = (now - parsed) / 86_400_000;
      const band = bands.find((entry) => ageDays <= entry.maxDays);
      if (band === undefined) {
        continue;
      }
      counts.set(band.bucket, (counts.get(band.bucket) ?? 0) + 1);
    }
    const ordered: FreshnessBucket[] = bands
      .map((band) => ({
        bucket: band.bucket,
        label: band.label,
        order: band.order,
        count: counts.get(band.bucket) ?? 0,
      }))
      .filter((band) => band.count > 0);
    return { buckets: ordered, absentCount: missing };
  }, [rows]);

  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Icon freshness</h2>
        <p className="text-[12px] text-muted-foreground">
          How recently each icon was last refreshed — a coarse recency signal
          for the site, independent of History.
        </p>
      </header>
      <div className="px-4 py-3">
        {buckets.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            No icons carry a recorded update time.
          </p>
        ) : (
          <div className="h-[168px] w-full" aria-label="Icons per freshness band">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={buckets}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
              >
                <XAxis
                  type="number"
                  hide
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={82}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: tokens["--muted"], opacity: 0.5 }}
                  content={({ payload }) => {
                    const entry = Array.isArray(payload)
                      ? (payload[0] as { payload?: FreshnessBucket } | undefined)
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
                        <p className="font-medium">{row.label}</p>
                        <p
                          className="tabular-nums"
                          style={{ color: tokens["--muted-foreground"] }}
                        >
                          {row.count.toLocaleString("en-US")} icon
                          {row.count === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[5, 5, 5, 5]}
                  isAnimationActive={!reduced}
                  animationDuration={600}
                  minPointSize={2}
                  barSize={18}
                >
                  {buckets.map((bucket) => (
                    <Cell
                      key={bucket.bucket}
                      fill={tokens["--primary"]}
                      fillOpacity={bucket.count === peak ? 1 : 0.35}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {absentCount > 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {absentCount.toLocaleString("en-US")} icon
            {absentCount === 1 ? "" : "s"} with no recorded update time not shown.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------ time cell (table) ------------------------------ */

function TimeCell({ field }: { readonly field: FieldState | undefined }) {
  const utc = fieldUtc(field);
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className="text-[12.5px] whitespace-nowrap tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span className="font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </span>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function FaviconsPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useFavicons(config.route);
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
        faviconHost(row) ?? "",
        fieldText(row.fields.iconUrl) ?? "",
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
              The rows could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{list.error}</p>
          </div>
          <Button onClick={list.retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : list.loading && list.rows.length === 0 ? (
        <div className="flex flex-col gap-3" aria-label="Loading rows">
          <Skeleton className="h-[104px] w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[240px] w-full" />
            <Skeleton className="h-[240px] w-full" />
          </div>
          <Skeleton className="h-[280px] w-full" />
        </div>
      ) : list.rows.length === 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <EmptyRows message="No Favicons rows in this Case." />
        </section>
      ) : (
        <>
          <SummaryTiles rows={list.rows} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ResolutionChart rows={list.rows} tokens={tokens} />
            <FreshnessChart rows={list.rows} tokens={tokens} />
          </div>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Cached icons</h2>
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
                    placeholder="Search host or icon URL"
                    aria-label="Search loaded favicons"
                    className="h-8 w-[220px] rounded-md border border-input bg-background pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </header>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No loaded rows match this filter."
                    : "No Favicons rows in this Case."
                }
              />
            ) : (
              <div className="fx-scroll-x">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      {["Site", "Resolution", "Size", "Last updated", "Profile", "State"].map(
                        (label) => (
                          <th
                            key={label}
                            className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
                          >
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, index) => {
                      const host = faviconHost(row);
                      const iconUrl = fieldText(row.fields.iconUrl);
                      const resolution = resolutionLabel(row);
                      const bytes = faviconBytes(row);
                      return (
                        <tr
                          key={index}
                          tabIndex={0}
                          aria-label="Open favicon row detail"
                          onClick={() => {
                            select(row);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              select(row);
                            }
                          }}
                          className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
                        >
                          <td className="max-w-[440px] px-3 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <SiteAvatar host={host} />
                              <span className="flex min-w-0 flex-col">
                                <span
                                  className="truncate text-[13px] text-foreground/90"
                                  title={host ?? undefined}
                                >
                                  {host ?? "(unknown host)"}
                                </span>
                                <span
                                  className="truncate font-mono text-[11.5px] text-muted-foreground"
                                  title={iconUrl ?? undefined}
                                >
                                  {iconUrl ?? ""}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] tabular-nums">
                            {resolution === null ? (
                              <AbsentWord />
                            ) : (
                              <span className="text-foreground/90">
                                {resolution}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] tabular-nums">
                            {bytes === null ? (
                              <AbsentWord />
                            ) : (
                              <span className="text-foreground/90">
                                {formatBytes(bytes)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <TimeCell field={row.fields.lastUpdated} />
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] text-muted-foreground">
                            {row.profile}
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
            )}

            {list.rows.length === 0 && list.cursor === null ? null : (
              <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
                <p
                  className="text-[12.5px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  {filtered
                    ? `${String(visible.length)} of ${String(list.rows.length)} loaded rows shown`
                    : `${String(list.rows.length)} row${list.rows.length === 1 ? "" : "s"} shown`}
                  {list.cursor === null ? "" : " · more available"}
                </p>
                {list.cursor !== null ? (
                  <Button
                    onClick={list.loadMore}
                    disabled={list.loading}
                    size="sm"
                  >
                    {list.loading ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </div>
            )}
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
