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
 * counts read straight off the loaded saved rows — nothing is inferred, no
 * axis is projected past the last recorded icon, and every wire field stays
 * reachable through the row detail sheet.
 *
 * Drawn with Fluid Functionalism: page-kit SectionPanels for each section,
 * meter lists for the two distributions, and one "Cached icons" panel whose
 * Saved / Recovered switch (CommitStateSplit) shows one FF Table at a time,
 * with the profile picker and a live search on the same toolbar.
 *
 * Presentation rules kept: a cell without its own recorded value reads as the
 * word "(empty)", "absent" or "unavailable", never colour alone; saved rows
 * and rows recovered from the WAL / rollback journal are separate server
 * reads (`useCommitStateLists`) and separate lists, never sorted together;
 * the figures count saved rows only; nothing here is presented as an
 * inference.
 */
import { ImageOff, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Panel, PanelContent } from "@/components/panel";
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

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, CaseCompleteness, Finding } from "../types.js";
import {
  type PaginatedList,
  type RecoveredList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { useChartTokens } from "./charts.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
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
import {
  CommitStateSplit,
  type CommitView,
  formatBytes,
  MeterList,
  type MeterRow,
  plural,
  SectionPanel,
  TimeCell,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/** Newest refresh first; each Commit State is its own read. */
const FAVICON_PARAMETERS: QueryParameters = [
  ["sort", "last-updated"],
  ["direction", "desc"],
];

/* ------------------------------- data loading ------------------------------ */

/** Retry only what failed: a failed first read starts that list over; a
 *  failed "Load more" asks for the same page again and keeps every row
 *  already loaded. */
function retryFailedPage<Row>(list: PaginatedList<Row>) {
  if (list.error === null) {
    return;
  }
  if (list.rows.length > 0 && list.cursor !== null) {
    list.loadMore();
  } else {
    list.retry();
  }
}

function retryList<Row>(list: PaginatedList<Row> | RecoveredList<Row>) {
  if ("wal" in list) {
    retryFailedPage(list.wal);
    retryFailedPage(list.journal);
  } else {
    retryFailedPage(list);
  }
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

/* --------------------------------- widgets --------------------------------- */

/**
 * The read-at-a-glance summary of the saved icons: how many there are, how
 * many distinct hosts they cover, how many distinct stored bitmaps there
 * truly are (identical hashes across hosts are the browser reusing one
 * image), and the total on-disk footprint. Every figure is a plain count of
 * the loaded saved rows; recovered rows are named apart, never added in.
 */
function SummaryBand({
  rows,
  recovered,
  more,
}: {
  readonly rows: readonly Finding[];
  /** Loaded recovered rows (`null` while that read is in flight). */
  readonly recovered: number | null;
  /** More saved rows stand on the server. */
  readonly more: boolean;
}) {
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
        label="Saved icons"
        value={`${stats.icons.toLocaleString("en-US")}${more ? "+" : ""}`}
        detail={
          recovered === null || recovered === 0
            ? "site icons in the database"
            : `${plural(recovered, "recovered icon", "recovered icons")} listed apart`
        }
      />
      <MetricBandItem
        label="Distinct hosts"
        value={stats.hosts.toLocaleString("en-US")}
        detail="hosts with a saved icon"
      />
      <MetricBandItem
        label="Unique bitmaps"
        value={stats.distinctBitmaps.toLocaleString("en-US")}
        detail={
          stats.distinctBitmaps < stats.icons
            ? `${String(stats.icons - stats.distinctBitmaps)} share or lack a hash`
            : "no reused images"
        }
      />
      <MetricBandItem
        label="Stored size"
        value={
          stats.sizedRows === 0 ? "not recorded" : formatBytes(stats.totalBytes)
        }
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
 * Saved icons grouped by the largest edge Chrome stored them at. Favicon
 * fidelity is evidence in its own right: a site the browser rendered at 48px
 * was pinned, tabbed, or bookmarked, where a bare 16px icon was only ever a
 * list entry.
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
    <SectionPanel
      id="favicons-resolution"
      title="Stored resolution"
      description="Saved icons by their largest stored edge. Higher fidelity marks a more prominent site."
      className="h-full"
    >
      <PanelContent className="pt-2">
        {meters.length === 0 ? (
          <EmptyRows
            className="py-8"
            message="No saved icons carry a recorded resolution."
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
    </SectionPanel>
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
 * When each saved icon was last refreshed, bucketed by age. A favicon's
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
    <SectionPanel
      id="favicons-freshness"
      title="Icon freshness"
      description="How long ago each saved icon was last refreshed. A coarse recency signal for the site, independent of History."
      className="h-full"
    >
      <PanelContent className="pt-2">
        {dated === 0 ? (
          <EmptyRows
            className="py-8"
            message="No saved icons carry a recorded update time."
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
    </SectionPanel>
  );
}

/* ---------------------------------- table ---------------------------------- */

/** The site column: the icon's host, else the icon URL's own state word
 *  (unavailable, absent, (empty)); a recorded URL with no host reads
 *  "absent". */
function HostCell({ row }: { readonly row: Finding }) {
  const host = faviconHost(row);
  if (host === null) {
    const iconUrl = row.fields.iconUrl;
    return iconUrl === undefined ||
      (iconUrl.state === "value" && iconUrl.value !== "") ? (
      <AbsentWord />
    ) : (
      <FieldCell field={iconUrl} />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={host} />
      <span className="truncate" title={host}>
        {host}
      </span>
    </span>
  );
}

/** "32×32", else the word of whichever edge was not recorded as a number. */
function ResolutionCell({ row }: { readonly row: Finding }) {
  const label = resolutionLabel(row);
  if (label !== null) {
    return label;
  }
  const missing =
    fieldInteger(row.fields.width) === null
      ? row.fields.width
      : row.fields.height;
  return <FieldCell field={missing} />;
}

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
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
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
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const host = faviconHost(row);
            const bytes = faviconBytes(row);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                // A WAL and a journal copy of one bitmap share its id, so the
                // Commit State (and the position) keep the key unique.
                key={`${row.commitState}:${row.profile}:${fieldText(row.fields.bitmapId) ?? ""}:${String(index)}`}
                index={index}
                tabIndex={0}
                aria-label={`Open favicon row detail for ${host ?? "a host not recorded"}`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="max-w-[260px] text-foreground">
                  <HostCell row={row} />
                </TableCell>
                <TableCell className="max-w-[320px]">
                  <FieldCell field={row.fields.iconUrl} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <ResolutionCell row={row} />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {bytes === null ? (
                    <FieldCell field={row.fields.payloadBytes} />
                  ) : (
                    <span title={`${bytes.toLocaleString("en-US")} bytes`}>
                      {formatBytes(bytes)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <TimeCell field={row.fields.lastUpdated} />
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
 * One list (saved or recovered): its loading rows, its read error, its empty
 * state, the table, a load-more failure (Retry asks for that page again and
 * keeps the loaded rows), and the "N shown / Load more" footer.
 */
function IconList({
  list,
  visible,
  noun,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding> | RecoveredList<Finding>;
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const rows = list.rows;
  const firstLoad = list.loading && rows.length === 0;
  const retry = () => {
    retryList(list);
  };
  if (list.error !== null && rows.length === 0) {
    return (
      <ErrorRows
        title={`The ${noun} icons could not be loaded.`}
        message={list.error}
        onRetry={retry}
      />
    );
  }
  const filtered = visible.length !== rows.length;
  return (
    <>
      <div className="reveal-swap">
        <LoadingRows label={`Loading ${noun} icons`} />
        {firstLoad ? null : visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No loaded ${noun} icons match these filters.`
                : noun === "saved"
                  ? "No saved Favicons rows in this Case."
                  : "No icons were recovered from WAL or journal sidecars."
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
          <IconsTable
            rows={visible}
            showState={noun === "recovered"}
            onSelect={onSelect}
          />
        )}
      </div>
      {list.error !== null ? (
        <ErrorRows
          title={`More ${noun} icons could not be loaded.`}
          message={list.error}
          onRetry={retry}
        />
      ) : null}
      {firstLoad ? null : (
        <ListFooter
          count={visible.length}
          cursor={list.cursor}
          loading={list.loading}
          onLoadMore={list.loadMore}
          summary={
            filtered
              ? `${visible.length.toLocaleString("en-US")} of ${plural(rows.length, `loaded ${noun} icon`, `loaded ${noun} icons`)} shown`
              : `${plural(rows.length, `${noun} icon`, `${noun} icons`)} shown`
          }
        />
      )}
    </>
  );
}

/* --------------------------------- loading --------------------------------- */

/** Stands in for the summary band and the two distributions while the first
 *  saved page loads, at their size. */
function FiguresSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading favicon figures"
    >
      <Skeleton className="h-[78px] w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[248px] w-full rounded-xl" />
        <Skeleton className="h-[248px] w-full rounded-xl" />
      </div>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function FaviconsPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
  const lists = useCommitStateLists<Finding>(config.route, FAVICON_PARAMETERS);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);

  const savedRows = lists.saved.rows;
  const recoveredRows = lists.recovered.rows;

  const profiles = useMemo(
    () =>
      [
        ...new Set([...savedRows, ...recoveredRows].map((row) => row.profile)),
      ].sort(),
    [savedRows, recoveredRows],
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
          faviconHost(row) ?? "",
          fieldText(row.fields.iconUrl) ?? "",
        ]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, profileFilter],
  );
  const savedVisible = useMemo(() => narrow(savedRows), [narrow, savedRows]);
  const recoveredVisible = useMemo(
    () => narrow(recoveredRows),
    [narrow, recoveredRows],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const savedFirst = lists.saved.loading && savedRows.length === 0;
  const recoveredFirst = lists.recovered.loading && recoveredRows.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    savedRows.length === 0 &&
    recoveredRows.length === 0;
  // The figures read the saved rows only; with none (or a failed read) they
  // step aside and the Saved tab carries the reason.
  const showFigures =
    savedFirst || (lists.saved.error === null && savedRows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ImageOff}
            title="No cached icons"
            message="No Favicons rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <FiguresSkeleton />
              {savedFirst ? null : (
                <div className="flex flex-col gap-5">
                  <SummaryBand
                    rows={savedRows}
                    recovered={recoveredFirst ? null : recoveredRows.length}
                    more={lists.saved.cursor !== null}
                  />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ResolutionPanel rows={savedRows} />
                    <FreshnessPanel rows={savedRows} />
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <SectionPanel
            id="favicons-list"
            title="Cached icons"
            description="Saved icons and icons recovered from the WAL or rollback journal are separate lists."
          >
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered icons"
              savedCount={
                savedFirst ||
                (lists.saved.error !== null && savedRows.length === 0)
                  ? null
                  : savedRows.length
              }
              recoveredCount={
                recoveredFirst ||
                (lists.recovered.error !== null && recoveredRows.length === 0)
                  ? null
                  : recoveredRows.length
              }
              savedMore={lists.saved.cursor !== null}
              recoveredMore={lists.recovered.cursor !== null}
              toolbar={
                <>
                  {profiles.length > 1 ? (
                    <FilterField label="Profiles" htmlFor="favicons-profiles">
                      <ProfilePicker
                        id="favicons-profiles"
                        profiles={profiles}
                        selected={profileFilter}
                        onChange={setProfileFilter}
                      />
                    </FilterField>
                  ) : null}
                  <FilterTextField
                    commit="change"
                    label="Search loaded favicons"
                    icon={Search}
                    placeholder="Search host or icon URL"
                    value={search}
                    onCommit={setSearch}
                  />
                </>
              }
              saved={
                <IconList
                  list={lists.saved}
                  visible={savedVisible}
                  noun="saved"
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
              recovered={
                <IconList
                  list={lists.recovered}
                  visible={recoveredVisible}
                  noun="recovered"
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
            />
          </SectionPanel>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title="Favicon"
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
