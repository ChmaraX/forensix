/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import { ARTIFACTS } from "@/artifacts";
import { caseSiteHosts } from "@/case-reads";
import { formatDay } from "@/components/page-kit";
import { caseActivity, type ActivityBucket } from "@/components/activity-data";
import { dayRangeParameters, localDayOf } from "@/components/day-bounds";
import { fetchSiteFavicons } from "@/components/site-favicons";
import { fieldString, fieldUtc } from "@/components/finding-fields";
import { siteKeyOf } from "@/related";
import { EVIDENCE_ORDER } from "@/router";
import type { FieldState, Finding, PageOf } from "@/types";

export { fieldString };

/**
 * One Most visited sites row: a host as the Sites page keys it
 * (`siteKeyOf`: the hostname, lower case) and its saved visit rows - the same
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
async function fetchRecordedSpan(): Promise<{
  readonly first: string | null;
  readonly last: string | null;
}> {
  const [earliest, latest] = await Promise.all([
    callApi<PageOf<Finding>>("history", [
      ["view", "visits"],
      ["commit-state", "committed"],
      ["sort", "visit-time"],
      ["direction", "asc"],
      ["limit", "1"],
    ]),
    callApi<PageOf<Finding>>("history", [
      ["view", "visits"],
      ["commit-state", "committed"],
      ["sort", "visit-time"],
      ["direction", "desc"],
      ["limit", "1"],
    ]),
  ]);
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

/** The local day (`YYYY-MM-DD`) of a timestamp field in the Case's declared
 *  timezone (UTC without one), or null. */
export function fieldDay(
  field: FieldState | undefined,
  timeZone: string | null,
): string | null {
  return localDayOf(fieldUtc(field), timeZone);
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
 * and counts them per host as Sites keys it - one visit row, one count,
 * the measure Sites uses. `complete` is false when the read stopped at that
 * cap; a failed read rejects (the panel shows it, never "no visits"). The
 * ranged hosts' recovered favicons are read alongside.
 */
export async function loadMostVisitedIn(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
): Promise<{
  readonly sites: readonly TopSite[];
  readonly complete: boolean;
  readonly favicons: ReadonlyMap<string, string | null>;
}> {
  const parameters: (readonly [string, string])[] = [
    ["view", "visits"],
    ["commit-state", "committed"],
    ["limit", String(PAGE_LIMIT)],
    ...dayRangeParameters(range, timeZone),
  ];
  const byHost = new Map<string, number>();
  let cursor: string | null = null;
  for (let page = 0; page < RANGE_VISIT_PAGES; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      "history",
      cursor === null ? parameters : [...parameters, ["after", cursor]],
    );
    for (const row of result.items) {
      const host = siteKeyOf(fieldString(row.fields.url));
      if (host !== null) {
        byHost.set(host, (byHost.get(host) ?? 0) + 1);
      }
    }
    cursor = result.nextCursor;
    if (cursor === null) {
      break;
    }
  }
  const sites = topHosts(byHost);
  const favicons = await fetchSiteFavicons(sites.map((site) => site.host));
  return { sites, complete: cursor === null, favicons };
}

/** Pages of saved downloads read for a narrowed Recent downloads (2,000). */
const RANGE_DOWNLOAD_PAGES = 20;

/**
 * The newest `RECENT_DOWNLOADS` saved downloads that started inside a date
 * range. The downloads route has no time filter, so this follows the saved
 * list newest first, page by page, keeping rows whose start day (in the
 * declared timezone) is in range, and stops once it has enough, once a page
 * reaches days before the range, or at `RANGE_DOWNLOAD_PAGES`. `complete` is
 * false when that cap stopped it before it could tell.
 */
export async function loadDownloadsIn(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
): Promise<{
  readonly downloads: readonly Finding[];
  readonly complete: boolean;
}> {
  const parameters: (readonly [string, string])[] = [
    ["commit-state", "committed"],
    ["sort", "start-time"],
    ["direction", "desc"],
    ["limit", String(PAGE_LIMIT)],
  ];
  const found: Finding[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < RANGE_DOWNLOAD_PAGES; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      "downloads",
      cursor === null ? parameters : [...parameters, ["after", cursor]],
    );
    let older = false;
    for (const row of result.items) {
      const day = fieldDay(row.fields.startTime, timeZone);
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
    cursor = result.nextCursor;
    if (cursor === null || older || found.length >= RECENT_DOWNLOADS) {
      return { downloads: found, complete: true };
    }
  }
  return { downloads: found, complete: false };
}

export async function loadOverview(): Promise<OverviewData> {
  const [
    { saved: activity, recovered, complete: activityComplete, timeZone },
    recordedSpan,
    siteHosts,
    metadataPage,
    downloadsPage,
  ] = await Promise.all([
    caseActivity(),
    fetchRecordedSpan(),
    // The Sites host list (read once per session, shared with ⌘K): each
    // host's saved visit rows rank Most visited sites, so the panel and
    // Sites print the same number for the same host.
    caseSiteHosts(),
    callApi<PageOf<Finding>>("metadata", [
      ["sort", "type"],
      ["direction", "asc"],
      ["limit", "100"],
    ]),
    callApi<PageOf<Finding>>("downloads", [
      // Saved rows only: recovered downloads stay their own list on the
      // Downloads page, never mixed into this one.
      ["commit-state", "committed"],
      ["sort", "start-time"],
      ["direction", "desc"],
      // The newest five; a narrowed range reads its own (`loadDownloadsIn`).
      ["limit", String(RECENT_DOWNLOADS)],
    ]),
  ]);

  const mostVisited = topHosts(
    new Map(
      siteHosts.hosts.map((host) => [host.host, host.savedCounts.visits]),
    ),
  );

  const favicons = await fetchSiteFavicons(
    mostVisited.map((site) => site.host),
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
    favicons,
    downloads: downloadsPage.items,
  };
}

/* -------------------------------- recovered ------------------------------- */

/** One evidence page's recovered rows: write-ahead-log rows (unsaved) and
 *  rollback-journal rows (overwritten), counted apart. */
export interface RecoveredCount {
  /** The page (`ArtifactConfig.key`) whose Recovered tab lists them. */
  readonly page: string;
  readonly label: string;
  /** The Completeness artifact, for the page's coverage. */
  readonly artifact: string;
  readonly wal: number;
  readonly journal: number;
  /** A read stopped at its cap: the counts are lower bounds ("1,000+"). */
  readonly more: boolean;
}

/** Pages read per Commit State per artifact (1,000 rows). */
const RECOVERED_PAGES = 10;
/** Pages of Cache's mixed list read (2,000 rows; its route cannot filter by
 *  Commit State, so the recovered rows are counted out of it). */
const RECOVERED_CACHE_PAGES = 20;

/** Rows of one route page by page, up to `pages`, each handed to `visit`;
 *  true when the cap stopped the read before the list ran out. */
async function readPages(
  route: string,
  parameters: readonly (readonly [string, string])[],
  pages: number,
  visit: (rows: readonly Finding[]) => void,
): Promise<boolean> {
  let cursor: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      route,
      cursor === null ? parameters : [...parameters, ["after", cursor]],
    );
    visit(result.items);
    cursor = result.nextCursor;
    if (cursor === null) {
      return false;
    }
  }
  return true;
}

async function countRecovered(page: string): Promise<RecoveredCount | null> {
  const config = ARTIFACTS.find((artifact) => artifact.key === page);
  if (config === undefined) {
    return null;
  }
  const base: (readonly [string, string])[] = [
    ...(page === "history" ? [["view", "visits"] as const] : []),
    ["limit", String(PAGE_LIMIT)],
  ];
  let wal = 0;
  let journal = 0;
  let more: boolean;
  if (config.combinedFindingList === true) {
    more = await readPages(
      config.route,
      base,
      RECOVERED_CACHE_PAGES,
      (rows) => {
        for (const row of rows) {
          if (row.commitState === "wal_resident") {
            wal += 1;
          } else if (row.commitState === "journal_resident") {
            journal += 1;
          }
        }
      },
    );
  } else {
    const [walMore, journalMore] = await Promise.all([
      readPages(
        config.route,
        [...base, ["commit-state", "wal_resident"]],
        RECOVERED_PAGES,
        (rows) => {
          wal += rows.length;
        },
      ),
      readPages(
        config.route,
        [...base, ["commit-state", "journal_resident"]],
        RECOVERED_PAGES,
        (rows) => {
          journal += rows.length;
        },
      ),
    ]);
    more = walMore || journalMore;
  }
  return {
    page,
    label: config.label,
    artifact: config.completenessArtifact,
    wal,
    journal,
    more,
  };
}

/**
 * Recovered rows per evidence page, in the sidebar's order: the rows each
 * page's Recovered tab lists, whole Case (every day, every profile). Counted
 * per Commit State and never summed into a figure. A failed read rejects:
 * the panel says so rather than show a short count.
 */
export async function loadRecovered(): Promise<readonly RecoveredCount[]> {
  const counts = await Promise.all(EVIDENCE_ORDER.map(countRecovered));
  return counts.filter((count): count is RecoveredCount => count !== null);
}

/** "4 Mar 2024" (UTC) — the shared page-kit day label. */
export { formatDay };

/** The full recorded span with years, "4 Mar 2024 - 17 Apr 2024" (one day:
 *  "4 Mar 2024"), or `null` with no dated bound. The masthead keeps the
 *  years that page-kit's shorter `formatDaySpan` drops within one year. */
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
