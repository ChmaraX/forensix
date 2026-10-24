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
 * The summary band, the resolution breakdown, and the freshness bands are all
 * counts read straight off the loaded rows — nothing is inferred, no axis is
 * projected past the last recorded icon, and every wire field stays reachable
 * through the row detail sheet.
 *
 * Drawn with Fluid Functionalism: Panels for each section, meter lists for the
 * two distributions, an FF Table (fluid row hover) per list, and a compact
 * toolbar (FF Select + InputGroup search).
 *
 * Presentation rules kept: a row without its own recorded value reads as the
 * word "absent" or "unavailable", never colour alone; saved rows and rows
 * recovered from the WAL / rollback journal are two separate lists, never
 * sorted together; nothing here is presented as an inference.
 */
import { ImageOff, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Panel,
  PanelContent,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
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
import type { ArtifactConfig, Finding, PageOf } from "../types.js";
import {
  Count,
  formatBytes,
  MeterList,
  SectionHeading,
  splitByCommit,
  TimeText,
  Toolbar,
  type MeterRow,
} from "./cache-kit.js";
import { useChartTokens } from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
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
      const first = list.find(
        (entry): entry is string => typeof entry === "string",
      );
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

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/* --------------------------------- widgets --------------------------------- */

/**
 * The read-at-a-glance summary: how many icons the Case holds, how many
 * distinct hosts they cover, how many distinct stored bitmaps there truly are
 * (identical hashes across hosts are the browser reusing one image), and the
 * total on-disk footprint. Every figure is a plain count of the loaded rows.
 */
function SummaryBand({ rows }: { readonly rows: readonly Finding[] }) {
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

  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Cached icons"
        value={stats.icons.toLocaleString("en-US")}
        detail="site icons stored"
      />
      <MetricBandItem
        label="Distinct hosts"
        value={stats.hosts.toLocaleString("en-US")}
        detail="hosts with a cached icon"
      />
      <MetricBandItem
        label="Unique bitmaps"
        value={stats.distinctBitmaps.toLocaleString("en-US")}
        detail={
          stats.distinctBitmaps < stats.icons
            ? `${String(stats.icons - stats.distinctBitmaps)} share an image`
            : "no reused images"
        }
      />
      <MetricBandItem
        label="Stored size"
        value={stats.sizedRows === 0 ? "absent" : formatBytes(stats.totalBytes)}
        detail={
          stats.sizedRows === 0
            ? "no recorded byte sizes"
            : `across ${plural(stats.sizedRows, "icon", "icons")}`
        }
      />
    </MetricBand>
  );
}

/** A caption under a distribution: how many rows it could not place. */
function LeftOutNote({ children }: { readonly children: string }) {
  return (
    <p className={cn(typeClass("caption"), "mt-2 text-muted-foreground")}>
      {children}
    </p>
  );
}

/**
 * Icons grouped by the largest edge Chrome stored them at. Favicon fidelity is
 * evidence in its own right: a site the browser rendered at 48px was pinned,
 * tabbed, or bookmarked, where a bare 16px icon was only ever a list entry.
 */
function ResolutionPanel({ rows }: { readonly rows: readonly Finding[] }) {
  const tokens = useChartTokens();
  const { meters, absentCount } = useMemo(() => {
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
    const ordered: MeterRow[] = [...byEdge.entries()]
      .sort(([left], [right]) => left - right)
      .map(([edge, count]) => ({
        key: String(edge),
        label: `${String(edge)}×${String(edge)} px`,
        value: count,
        display: count.toLocaleString("en-US"),
        title: plural(count, "icon", "icons"),
      }));
    return { meters: ordered, absentCount: missing };
  }, [rows]);

  return (
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Stored resolution</PanelTitle>
          <PanelDescription>
            Icons by their largest stored edge. Higher fidelity marks a more
            prominent site.
          </PanelDescription>
        </div>
      </PanelHeader>
      <PanelContent className="pt-2">
        {meters.length === 0 ? (
          <EmptyRows
            className="py-8"
            message="No icons carry a recorded resolution."
          />
        ) : (
          <MeterList rows={meters} tokens={tokens} labelWidth="7rem" />
        )}
        {absentCount > 0 ? (
          <LeftOutNote>
            {`${plural(absentCount, "icon", "icons")} with no recorded resolution not shown.`}
          </LeftOutNote>
        ) : null}
      </PanelContent>
    </Panel>
  );
}

/** Fixed, evidence-derived age bands. The last band is open-ended, so every
 *  dated icon lands in exactly one. */
const FRESHNESS_BANDS: readonly {
  readonly key: string;
  readonly label: string;
  readonly maxDays: number;
}[] = [
  { key: "7d", label: "Within 7 days", maxDays: 7 },
  { key: "30d", label: "8 to 30 days", maxDays: 30 },
  { key: "90d", label: "31 to 90 days", maxDays: 90 },
  { key: "older", label: "Over 90 days", maxDays: Infinity },
];

/**
 * When each cached icon was last refreshed, bucketed by age. A favicon's
 * `lastUpdated` is written when the browser last re-fetched the icon, so this
 * is a coarse recency signal for the site itself — one that survives even when
 * the visit was cleared from History. Bands are fixed, never a smoothed trend.
 */
function FreshnessPanel({ rows }: { readonly rows: readonly Finding[] }) {
  const tokens = useChartTokens();
  const { meters, absentCount, dated } = useMemo(() => {
    const counts = new Map<string, number>();
    const now = Date.now();
    let missing = 0;
    for (const row of rows) {
      const utc = fieldUtc(row.fields.lastUpdated);
      const parsed = utc === null ? Number.NaN : new Date(utc).getTime();
      if (Number.isNaN(parsed)) {
        missing += 1;
        continue;
      }
      const ageDays = (now - parsed) / 86_400_000;
      const band = FRESHNESS_BANDS.find((entry) => ageDays <= entry.maxDays);
      if (band !== undefined) {
        counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
      }
    }
    const ordered: MeterRow[] = FRESHNESS_BANDS.map((band) => {
      const count = counts.get(band.key) ?? 0;
      return {
        key: band.key,
        label: band.label,
        value: count,
        display: count.toLocaleString("en-US"),
        title: plural(count, "icon", "icons"),
      };
    });
    return {
      meters: ordered,
      absentCount: missing,
      dated: rows.length - missing,
    };
  }, [rows]);

  return (
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Icon freshness</PanelTitle>
          <PanelDescription>
            How long ago each icon was last refreshed. A coarse recency signal
            for the site, independent of History.
          </PanelDescription>
        </div>
      </PanelHeader>
      <PanelContent className="pt-2">
        {dated === 0 ? (
          <EmptyRows
            className="py-8"
            message="No icons carry a recorded update time."
          />
        ) : (
          <MeterList rows={meters} tokens={tokens} labelWidth="7rem" />
        )}
        {absentCount > 0 ? (
          <LeftOutNote>
            {`${plural(absentCount, "icon", "icons")} with no recorded update time not shown.`}
          </LeftOutNote>
        ) : null}
      </PanelContent>
    </Panel>
  );
}

/* ---------------------------------- table ---------------------------------- */

/**
 * One list of icons. The saved list and the recovered list share columns;
 * only the recovered list carries the State column, since its rows differ in
 * which sidecar they came from (WAL or rollback journal).
 */
function IconsTable({
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
            <TableHead className="whitespace-nowrap">Site</TableHead>
            <TableHead className="whitespace-nowrap">Icon URL</TableHead>
            <TableHead className="whitespace-nowrap">Resolution</TableHead>
            <TableHead className="whitespace-nowrap text-right">Size</TableHead>
            <TableHead className="whitespace-nowrap">Last updated</TableHead>
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            {showState ? (
              <TableHead className="whitespace-nowrap">State</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const host = faviconHost(row);
            const iconUrl = fieldText(row.fields.iconUrl);
            const resolution = resolutionLabel(row);
            const bytes = faviconBytes(row);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={`${row.profile}-${fieldText(row.fields.bitmapId) ?? String(index)}`}
                index={index}
                tabIndex={0}
                aria-label={`Open favicon row detail for ${host ?? "unknown host"}`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="max-w-[260px] text-foreground">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <SiteAvatar host={host} />
                    <span className="truncate" title={host ?? undefined}>
                      {host ?? "(unknown host)"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="max-w-[320px]">
                  {iconUrl === null ? (
                    <AbsentWord />
                  ) : (
                    <span className="block truncate font-mono" title={iconUrl}>
                      {iconUrl}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {resolution === null ? <AbsentWord /> : resolution}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {bytes === null ? (
                    <AbsentWord />
                  ) : (
                    <span title={`${bytes.toLocaleString("en-US")} bytes`}>
                      {formatBytes(bytes)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <TimeText utc={fieldUtc(row.fields.lastUpdated)} />
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

/* --------------------------------- loading --------------------------------- */

/** Stands in for the summary band, the two distributions and the first rows
 *  while the first page loads. Built no taller than the real blocks. */
function FaviconsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[220px] w-full rounded-xl" />
        <Skeleton className="h-[220px] w-full rounded-xl" />
      </div>
      <Skeleton className="h-9 w-64 rounded-lg" />
      <Skeleton className="h-[240px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function FaviconsPage({ config }: { readonly config: ArtifactConfig }) {
  const list = useFavicons(config.route);
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
        faviconHost(row) ?? "",
        fieldText(row.fields.iconUrl) ?? "",
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
      message="No loaded rows match this filter."
      action={
        <Button variant="tertiary" size="compact" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  );

  const ready = !(list.loading && list.rows.length === 0);

  return (
    <div className="flex flex-col gap-5">
      {list.error !== null && list.rows.length === 0 ? (
        <Panel>
          <ErrorRows message={list.error} onRetry={list.retry} />
        </Panel>
      ) : ready && list.rows.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={ImageOff}
            title="No cached icons"
            message="No Favicons rows in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <FaviconsSkeleton />
          {ready ? (
            <div className="flex flex-col gap-5">
              <SummaryBand rows={list.rows} />

              <div className="grid gap-5 lg:grid-cols-2">
                <ResolutionPanel rows={list.rows} />
                <FreshnessPanel rows={list.rows} />
              </div>

              <section
                aria-label="Cached icons"
                className="flex flex-col gap-3"
              >
                <SectionHeading
                  title="Cached icons"
                  count={
                    filtered
                      ? `${String(visible.length)} of ${String(list.rows.length)}`
                      : list.rows.length
                  }
                  className="mt-3"
                >
                  <Toolbar>
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
                      label="Search loaded favicons"
                      icon={Search}
                      placeholder="Search host or icon URL…"
                      value={search}
                      onCommit={setSearch}
                    />
                  </Toolbar>
                </SectionHeading>

                {list.error !== null ? (
                  <Panel>
                    <ErrorRows message={list.error} onRetry={list.retry} />
                  </Panel>
                ) : null}

                <Panel className="overflow-clip">
                  <PanelHeader className="pb-1">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <PanelTitle>Saved</PanelTitle>
                        <Count>{shown.saved.length}</Count>
                      </div>
                      <PanelDescription>
                        Icons committed to the Favicons database.
                      </PanelDescription>
                    </div>
                  </PanelHeader>
                  {shown.saved.length === 0 ? (
                    filtered ? (
                      filteredEmpty
                    ) : (
                      <EmptyRows message="No saved icons. Every loaded row was recovered from a sidecar file." />
                    )
                  ) : (
                    <IconsTable
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
                      {plural(list.rows.length, "row", "rows")} loaded
                      {all.recovered.length > 0
                        ? ` · ${String(all.saved.length)} saved, ${String(all.recovered.length)} recovered`
                        : ""}
                      {list.cursor === null ? "" : " · more available"}
                    </p>
                    {list.cursor !== null ? (
                      <Button
                        variant="tertiary"
                        size="compact"
                        className="ml-auto"
                        onClick={list.loadMore}
                        loading={list.loading}
                        disabled={list.loading}
                      >
                        Load more
                      </Button>
                    ) : null}
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
                          Rows found in the database&apos;s write-ahead log or
                          rollback journal, kept apart from saved icons.
                        </PanelDescription>
                      </div>
                    </PanelHeader>
                    {shown.recovered.length === 0 ? (
                      filteredEmpty
                    ) : (
                      <IconsTable
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
          title={"Favicon"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
