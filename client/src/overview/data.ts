/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import { ARTIFACTS, EVIDENCE_ORDER, type EvidenceKey } from "@/artifacts";
import { caseSiteHosts } from "@/case-reads";
import { caseActivity, type ActivityBucket } from "@/components/activity-data";
import {
  dayRangeParameters,
  fieldZone,
  localDayOf,
} from "@/components/day-bounds";
import { fetchSiteFavicons } from "@/components/site-favicons";
import { siteHostKey } from "@/site-host-key";
import { readPages } from "@/read-pages";
import type {
  CountResult,
  FieldState,
  Finding,
  OverviewArtifact,
  PageOf,
  SummaryResult,
} from "@/types";
import { fieldString, fieldUtc } from "@/field-readers";
import { formatDay } from "@/day-format";

/**
 * One Most visited sites row: a host as the Sites page keys it
 * (`siteHostKey`: the hostname, lower case) and its saved visit rows - the same
 * measure, and the same number, Sites prints beside the host ("4 visits").
 * Never Chrome's own per-URL `visit_count`, which Sites does not show.
 */
export interface TopSite {
  readonly host: string;
  readonly count: number;
}

/** Hosts the Most visited sites panel lists. */
export const MOST_VISITED = 6;

/** Ranks hosts by saved visits (ties by name, so the order is stable). */
function topHosts(counts: ReadonlyMap<string, number>): readonly TopSite[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([host, count]) => ({ host, count }))
    .sort(
      (left, right) =>
        right.count - left.count || (left.host < right.host ? -1 : 1),
    )
    .slice(0, MOST_VISITED);
}

export interface OverviewData {
  /** Saved (committed) activity buckets: every figure and chart counts these. */
  readonly activity: readonly ActivityBucket[];
  /** Recovered (WAL / journal) activity buckets, named beside the saved
   *  figures, never summed in. */
  readonly recoveredActivity: readonly ActivityBucket[];
  /** True when every activity row for this Case was read, not just the first
   *  page cap (`ACTIVITY_PAGE_CAP`). When `false`
   *  the charts below cover less than the full recorded span, and the screen
   *  must say so. */
  readonly activityComplete: boolean;
  /** The declared timezone the activity days are in (`caseActivity`), or
   *  null (then days are UTC days). Day ranges and row days use it. */
  readonly timeZone: string | null;
  /** The Case's true first and last saved visit, read directly from the
   *  `visits` view (one committed row each way) rather than derived from the
   *  — possibly truncated — `activity` set. This is the span the range control and the
   *  span label promise the examiner, so it must never come from a set that
   *  can itself be incomplete. */
  readonly recordedSpan: {
    readonly first: string | null;
    readonly last: string | null;
  };
  readonly mostVisited: readonly TopSite[];
  /** False when the host list stopped at its page cap, so a busier host
   *  may be missing from Most visited sites. */
  readonly mostVisitedComplete: boolean;
  readonly metadata: readonly Finding[];
  /** The Case's `summary`: its id, Sources and Profiles (the masthead). */
  readonly summary: SummaryResult;
  /** The newest saved downloads (up to `RECENT_DOWNLOADS`). */
  readonly downloads: readonly Finding[];
  /** Recovered favicon for each Most visited sites host, as an inline `data:` URI —
   *  the dashboard's CSP admits no other image source, so a favicon is never
   *  fetched live off this machine, only read back from the Case's own
   *  recovered `favicon_bitmaps` payloads. A host with no recovered favicon
   *  maps to `null`; the row falls back to its own letter tile for it. */
  readonly favicons: ReadonlyMap<string, string | null>;
}

/**
 * The Case's true first and last saved visit. Reads the `visits` view
 * directly — one committed row from each end, the same rows History's
 * "Recorded span" counts — rather than deriving the span from the (possibly
 * page-capped) `activity` set, so the span the screen promises is never
 * itself truncated. An empty Case (no saved visits) returns two empty pages
 * and both bounds resolve to `null`; nothing is invented.
 */
async function fetchRecordedSpan(signal?: AbortSignal): Promise<{
  readonly first: string | null;
  readonly last: string | null;
}> {
  const [earliest, latest] = await Promise.all(
    (["asc", "desc"] as const).map((direction) =>
      callApi<PageOf<Finding>>(
        "history",
        [
          ["view", "visits"],
          ["commit-state", "committed"],
          ["sort", "visit-time"],
          ["direction", direction],
          ["limit", "1"],
        ],
        { signal },
      ),
    ),
  );
  // Both reads' instants bound the span, whichever way the route ordered
  // them: a route (or the design mock) that ignores `direction` must not
  // collapse the span onto one row's day.
  const instants = [
    fieldUtc(earliest.items[0]?.fields.visitTime),
    fieldUtc(latest.items[0]?.fields.visitTime),
  ]
    .filter((instant): instant is string => instant !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    first: instants[0] ?? null,
    last: instants[instants.length - 1] ?? null,
  };
}

/** Rows per page on every Overview read (the routes' maximum is 100). */
const PAGE_LIMIT = 100;

/** Downloads the Recent downloads panel lists. */
export const RECENT_DOWNLOADS = 5;

/** The local day (`YYYY-MM-DD`) of a timestamp field in the zone the
 *  timestamp itself declares (UTC without one), or null - the day the
 *  Downloads page buckets the same row on. */
export function fieldDay(field: FieldState | undefined): string | null {
  return localDayOf(fieldUtc(field), fieldZone(field));
}

/** A day lies in a range (`""` = an open bound). */
export function dayInRange(
  day: string,
  range: { readonly from: string; readonly to: string },
): boolean {
  return (
    (range.from === "" || day >= range.from) &&
    (range.to === "" || day <= range.to)
  );
}

/** Pages of saved visits read for a narrowed Most visited sites (1,000
 *  visits). */
const RANGE_VISIT_PAGES = 10;

/**
 * Most visited sites within a date range. Sites' per-host counts cover the
 * whole Case, so a narrowed range reads the saved visits in it (`from` /
 * `to` in the declared timezone, page by page up to `RANGE_VISIT_PAGES`)
 * and counts them per host as Sites keys it (`siteHostKey`) - one visit row, one count,
 * the measure Sites uses. `complete` is false when the read stopped at that
 * cap; a failed read rejects (the panel shows it, never "no visits"). The
 * ranged hosts' recovered favicons are read alongside.
 */
export async function loadMostVisitedIn(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
  signal?: AbortSignal,
): Promise<{
  readonly sites: readonly TopSite[];
  readonly complete: boolean;
  readonly favicons: ReadonlyMap<string, string | null>;
}> {
  const byHost = new Map<string, number>();
  const { complete } = await readPages<Finding>(
    "history",
    [
      ["view", "visits"],
      ["commit-state", "committed"],
      ["limit", String(PAGE_LIMIT)],
      ...dayRangeParameters(range, timeZone),
    ],
    {
      cap: RANGE_VISIT_PAGES,
      signal,
      onPage: (rows) => {
        for (const row of rows) {
          const host = siteHostKey(fieldString(row.fields.url));
          if (host !== null) {
            byHost.set(host, (byHost.get(host) ?? 0) + 1);
          }
        }
      },
    },
  );
  const sites = topHosts(byHost);
  const favicons = await fetchSiteFavicons(
    sites.map((site) => site.host),
    signal,
  );
  return { sites, complete, favicons };
}

/** Pages of saved downloads read for a narrowed Recent downloads (2,000). */
const RANGE_DOWNLOAD_PAGES = 20;

/**
 * The newest `RECENT_DOWNLOADS` saved downloads that started inside a date
 * range. The downloads route has no time filter, so this follows the saved
 * list newest first, page by page, keeping rows whose start day (in the
 * zone each start time declares, `fieldDay`) is in range, and stops once it has enough, once a page
 * reaches days before the range, or at `RANGE_DOWNLOAD_PAGES`. `complete` is
 * false when that cap stopped it before it could tell.
 */
export async function loadDownloadsIn(
  range: { readonly from: string; readonly to: string },
  signal?: AbortSignal,
): Promise<{
  readonly downloads: readonly Finding[];
  readonly complete: boolean;
}> {
  const found: Finding[] = [];
  // Stopped on enough rows or on days before the range: nothing later in
  // the list could change the answer.
  const told = { early: false };
  const read = await readPages<Finding>(
    "downloads",
    [
      ["commit-state", "committed"],
      ["sort", "start-time"],
      ["direction", "desc"],
      ["limit", String(PAGE_LIMIT)],
    ],
    {
      cap: RANGE_DOWNLOAD_PAGES,
      signal,
      onPage: (rows) => {
        let older = false;
        for (const row of rows) {
          const day = fieldDay(row.fields.startTime);
          if (day === null) {
            continue;
          }
          if (range.from !== "" && day < range.from) {
            older = true;
            continue;
          }
          if (dayInRange(day, range) && found.length < RECENT_DOWNLOADS) {
            found.push(row);
          }
        }
        told.early = older || found.length >= RECENT_DOWNLOADS;
        return told.early ? "stop" : undefined;
      },
    },
  );
  return { downloads: found, complete: read.complete || told.early };
}

export async function loadOverview(
  signal?: AbortSignal,
): Promise<OverviewData> {
  const [
    { saved: activity, recovered, complete: activityComplete, timeZone },
    recordedSpan,
    siteHosts,
    metadataPage,
    downloadsPage,
    summary,
  ] = await Promise.all([
    caseActivity(),
    fetchRecordedSpan(signal),
    // The Sites host list (read once per session, shared with ⌘K): each
    // host's saved visit rows rank Most visited sites, so the panel and
    // Sites print the same number for the same host.
    caseSiteHosts(),
    callApi<PageOf<Finding>>(
      "metadata",
      [
        ["sort", "type"],
        ["direction", "asc"],
        ["limit", "100"],
      ],
      { signal },
    ),
    callApi<PageOf<Finding>>(
      "downloads",
      [
        // Saved rows only: recovered downloads stay their own list on the
        // Downloads page, never mixed into this one.
        ["commit-state", "committed"],
        ["sort", "start-time"],
        ["direction", "desc"],
        // The newest five; a narrowed range reads its own
        // (`loadDownloadsIn`).
        ["limit", String(RECENT_DOWNLOADS)],
      ],
      { signal },
    ),
    callApi<SummaryResult>("summary", [], { signal }),
  ]);

  const mostVisited = topHosts(
    new Map(
      siteHosts.hosts.map((host) => [host.host, host.savedCounts.visits]),
    ),
  );

  const favicons = await fetchSiteFavicons(
    mostVisited.map((site) => site.host),
    signal,
  );

  return {
    activity,
    recoveredActivity: recovered,
    activityComplete,
    timeZone,
    recordedSpan,
    mostVisited,
    mostVisitedComplete: siteHosts.complete,
    metadata: metadataPage.items,
    summary,
    favicons,
    downloads: downloadsPage.items,
  };
}

/* -------------------------------- recovered ------------------------------- */

/** One evidence page's recovered rows: write-ahead-log rows (unsaved) and
 *  rollback-journal rows (overwritten), counted apart. */
export interface RecoveredCount {
  /** The page whose Recovered tab lists them. */
  readonly page: EvidenceKey;
  readonly label: string;
  /** The Completeness artifact, for the page's coverage. */
  readonly artifact: OverviewArtifact;
  readonly wal: number;
  readonly journal: number;
}

/** The Finding kinds each evidence page's Recovered tab lists. */
const PAGE_KINDS: Readonly<Record<EvidenceKey, readonly string[]>> = {
  history: ["history_visit"],
  downloads: ["download"],
  bookmarks: ["bookmark"],
  "top-sites": ["top_site"],
  cookies: ["cookie"],
  credentials: ["login_credential"],
  autofill: ["autofill_entry"],
  cache: ["cache_entry"],
  favicons: ["favicon"],
  metadata: ["browser_metadata", "profile_metadata"],
};

/** WAL- and journal-resident records in a `by=commitState` count. */
function sidecarCounts(result: CountResult): {
  readonly wal: number;
  readonly journal: number;
} {
  const of = (state: string) =>
    result.buckets.find((bucket) => bucket.key === state)?.count ?? 0;
  return { wal: of("wal_resident"), journal: of("journal_resident") };
}

/**
 * Recovered rows per evidence page, in the sidebar's order: the rows each
 * page's Recovered tab lists, whole Case (every day, every profile). The
 * server counts them: `summary` names the kinds with recovered records,
 * and one `count by=commitState` per such kind splits them into WAL- and
 * journal-resident - exact, never a reading of downloaded rows. Counted
 * per Commit State and never summed into a figure. A failed read rejects:
 * the panel says so rather than show a short count.
 */
export async function loadRecovered(
  signal?: AbortSignal,
): Promise<readonly RecoveredCount[]> {
  const summary = await callApi<SummaryResult>("summary", [], { signal });
  const withRecovered = new Set(
    summary.records
      .filter(
        (record) =>
          record.recordType === "finding" && (record.recovered ?? 0) > 0,
      )
      .map((record) => record.kind),
  );
  return Promise.all(
    EVIDENCE_ORDER.map(async (page) => {
      const config = ARTIFACTS[page];
      const counts = await Promise.all(
        PAGE_KINDS[page]
          .filter((kind) => withRecovered.has(kind))
          .map((kind) =>
            callApi<CountResult>(
              "count",
              [
                ["kind", kind],
                ["by", "commitState"],
              ],
              { signal },
            ).then(sidecarCounts),
          ),
      );
      return {
        page,
        label: config.label,
        artifact: config.completenessArtifact,
        wal: counts.reduce((sum, count) => sum + count.wal, 0),
        journal: counts.reduce((sum, count) => sum + count.journal, 0),
      };
    }),
  );
}

/** The full recorded span with years, "4 Mar 2024 - 17 Apr 2024" (one day:
 *  "4 Mar 2024"), or `null` with no dated bound. The masthead keeps the
 *  years that the shorter `formatDaySpan` drops within one year. */
export function formatSpan(
  first: string | null,
  last: string | null,
): string | null {
  if (first === null || last === null) {
    return null;
  }
  return first === last
    ? formatDay(first)
    : `${formatDay(first)} - ${formatDay(last)}`;
}

/** A `YYYY-MM-DD` day moved by `days` (UTC calendar arithmetic). */
export function shiftDay(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
