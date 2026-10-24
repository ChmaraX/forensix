/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import { formatDay } from "@/components/page-kit";
import { fetchActivity, type ActivityBucket } from "@/components/activity-data";
import { dayRangeParameters, localDayOf } from "@/components/day-bounds";
import { fetchSiteFavicons } from "@/components/site-favicons";
import { fieldString, fieldUtc } from "@/components/finding-fields";
import type { CaseProfiles, FieldState, Finding, PageOf } from "@/types";

export { fieldString };

export interface TopSite {
  readonly url: string;
  readonly title: string;
  readonly count: number;
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
  /** The declared timezone the activity days are in (`fetchActivity`), or
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
  readonly profiles: readonly string[];
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
 * Most visited sites within a date range: the `most-visited` view is a
 * whole-Case summary, so a narrowed range reads the saved visits in it
 * (`from` / `to` in the declared timezone, followed page by page up to
 * `RANGE_VISIT_PAGES`) and counts them per URL. `complete` is false when the
 * read stopped at that cap; a failed read rejects (the panel shows it, never
 * "no visits").
 */
export async function loadMostVisitedIn(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
): Promise<{
  readonly sites: readonly TopSite[];
  readonly complete: boolean;
}> {
  const parameters: (readonly [string, string])[] = [
    ["view", "visits"],
    ["commit-state", "committed"],
    ["limit", String(PAGE_LIMIT)],
    ...dayRangeParameters(range, timeZone),
  ];
  const byUrl = new Map<string, { title: string; count: number }>();
  let cursor: string | null = null;
  for (let page = 0; page < RANGE_VISIT_PAGES; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      "history",
      cursor === null ? parameters : [...parameters, ["after", cursor]],
    );
    for (const row of result.items) {
      const url = fieldString(row.fields.url);
      if (url === null) {
        continue;
      }
      const entry = byUrl.get(url) ?? {
        title: fieldString(row.fields.title) ?? "",
        count: 0,
      };
      entry.count += 1;
      byUrl.set(url, entry);
    }
    cursor = result.nextCursor;
    if (cursor === null) {
      break;
    }
  }
  const sites = [...byUrl.entries()]
    .map(([url, entry]) => ({ url, title: entry.title, count: entry.count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
  return { sites, complete: cursor === null };
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
    mostVisitedPage,
    caseProfiles,
    metadataPage,
    downloadsPage,
  ] = await Promise.all([
    fetchActivity(),
    fetchRecordedSpan(),
    callApi<PageOf<Finding>>("history", [
      ["view", "most-visited"],
      // Saved rows only: a leaderboard never silently sums saved and
      // recovered (WAL / journal) visits; the panel says "saved visits".
      ["commit-state", "committed"],
      ["sort", "visit-count"],
      ["direction", "desc"],
      ["limit", "6"],
    ]),
    callApi<CaseProfiles>("profiles", []),
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

  const mostVisited = mostVisitedPage.items
    .map((row) => ({
      url: fieldString(row.fields.url) ?? "",
      title: fieldString(row.fields.title) ?? "",
      count: Number(fieldString(row.fields.supportingVisitCount) ?? "0"),
    }))
    .filter((site) => site.url.length > 0);

  const favicons = await fetchSiteFavicons([
    ...new Set(mostVisited.map((site) => domainOf(site.url))),
  ]);

  return {
    activity,
    recoveredActivity: recovered,
    activityComplete,
    timeZone,
    recordedSpan,
    mostVisited,
    profiles: caseProfiles.profiles,
    metadata: metadataPage.items,
    favicons,
    downloads: downloadsPage.items,
  };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
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

/** The last path segment of a target-path Field's recorded value — the plain
 *  filename an examiner scans for, never a rewrite of the value itself: the
 *  full path stays reachable on the Downloads page, byte-for-byte. */
export function downloadFileName(field: FieldState | undefined): string | null {
  const text = fieldString(field);
  if (text === null || text.length === 0) {
    return null;
  }
  const segments = text.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? null;
}
