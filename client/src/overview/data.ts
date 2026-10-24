/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import { formatDay, formatDayTick } from "@/components/page-kit";
import { fetchActivity, type ActivityBucket } from "@/components/activity-data";
import type { CaseProfiles, FieldState, Finding, PageOf } from "@/types";

export function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
}

/**
 * The UTC instant carried by a timestamp Finding field (for example
 * `history_visit.visitTime`). Timestamp fields hold a `ForensicTimestamp`
 * object with a `utc` string; every other value shape returns `null`, the
 * same rule `formatValue` in `lib.ts` uses to detect a timestamp object.
 */
function fieldTimestampUtc(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value !== "object" || field.value === null) {
    return null;
  }
  const utc = (field.value as Record<string, unknown>).utc;
  return typeof utc === "string" ? utc : null;
}

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
  /** The Case's true first and last recorded visit, read directly from the
   *  `visits` view (one row each way) rather than derived from the — possibly
   *  truncated — `activity` set. This is the span the range control and the
   *  span label promise the examiner, so it must never come from a set that
   *  can itself be incomplete. */
  readonly recordedSpan: {
    readonly first: string | null;
    readonly last: string | null;
  };
  readonly mostVisited: readonly TopSite[];
  readonly profiles: readonly string[];
  readonly metadata: readonly Finding[];
  readonly downloads: readonly Finding[];
  /** Recovered favicon for each Most visited sites host, as an inline `data:` URI —
   *  the dashboard's CSP admits no other image source, so a favicon is never
   *  fetched live off this machine, only read back from the Case's own
   *  recovered `favicon_bitmaps` payloads. A host with no recovered favicon
   *  maps to `null`; the row falls back to its own letter tile for it. */
  readonly favicons: ReadonlyMap<string, string | null>;
}

/**
 * The Case's true first and last recorded visit. Reads the `visits` view
 * directly — one row from each end — rather than deriving the span from the
 * (possibly page-capped) `activity` set, so the span the screen promises is
 * never itself truncated. An empty Case (no visits at all) returns two empty
 * pages and both bounds resolve to `null`; nothing is invented.
 */
async function fetchRecordedSpan(): Promise<{
  readonly first: string | null;
  readonly last: string | null;
}> {
  const [earliest, latest] = await Promise.all([
    callApi<PageOf<Finding>>("history", [
      ["view", "visits"],
      ["sort", "visit-time"],
      ["direction", "asc"],
      ["limit", "1"],
    ]),
    callApi<PageOf<Finding>>("history", [
      ["view", "visits"],
      ["sort", "visit-time"],
      ["direction", "desc"],
      ["limit", "1"],
    ]),
  ]);
  // Both reads' instants bound the span, whichever way the route ordered
  // them: a route (or the design mock) that ignores `direction` must not
  // collapse the span onto one row's day.
  const instants = [
    fieldTimestampUtc(earliest.items[0]?.fields.visitTime),
    fieldTimestampUtc(latest.items[0]?.fields.visitTime),
  ]
    .filter((instant): instant is string => instant !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    first: instants[0] ?? null,
    last: instants[instants.length - 1] ?? null,
  };
}

/**
 * Recovered favicons for a set of hosts, read from the Case's own evidence
 * via the `site-favicons` route — never fetched live. Empty input skips the
 * request rather than asking the route to resolve nothing.
 */
async function fetchFavicons(
  hosts: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (hosts.length === 0) {
    return new Map();
  }
  const result = await callApi<{
    readonly status: "ok";
    readonly icons: Readonly<Record<string, string | null>>;
  }>(
    "site-favicons",
    hosts.map((host) => ["host", host] as const),
  );
  return new Map(Object.entries(result.icons));
}

/** Saved downloads the Overview reads, newest first. */
const DOWNLOADS_READ = 200;

/** The day of a timestamp field (`YYYY-MM-DD`, UTC), or null. */
export function fieldDay(field: FieldState | undefined): string | null {
  return fieldTimestampUtc(field)?.slice(0, 10) ?? null;
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

/** Pages of saved visits read for a narrowed Most visited sites. */
const RANGE_VISIT_PAGES = 10;

/**
 * Most visited sites within a date range: the `most-visited` view is a
 * whole-Case summary, so a narrowed range reads the saved visits in it
 * (`from` / `to`, followed page by page up to `RANGE_VISIT_PAGES`) and counts
 * them per URL. `complete` is false when the read stopped at that cap.
 */
export async function loadMostVisitedIn(range: {
  readonly from: string;
  readonly to: string;
}): Promise<{
  readonly sites: readonly TopSite[];
  readonly complete: boolean;
}> {
  const parameters: [string, string][] = [
    ["view", "visits"],
    ["commit-state", "committed"],
    ["limit", "500"],
  ];
  if (range.from !== "") {
    parameters.push(["from", `${range.from}T00:00:00Z`]);
  }
  if (range.to !== "") {
    parameters.push(["to", `${range.to}T23:59:59.999999Z`]);
  }
  const byUrl = new Map<string, { title: string; count: number }>();
  let cursor: string | null = null;
  for (let page = 0; page < RANGE_VISIT_PAGES; page += 1) {
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      "history",
      cursor === null ? parameters : [...parameters, ["after", cursor]],
    );
    for (const row of result.items) {
      const day = fieldDay(row.fields.visitTime);
      const url = fieldString(row.fields.url);
      if (day === null || url === null || !dayInRange(day, range)) {
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

export async function loadOverview(): Promise<OverviewData> {
  const [
    { saved: activity, recovered, complete: activityComplete },
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
      // Enough to fill the five-row panel under a narrowed date range too;
      // the page keeps the newest five in range.
      ["limit", String(DOWNLOADS_READ)],
    ]),
  ]);

  const mostVisited = mostVisitedPage.items
    .map((row) => ({
      url: fieldString(row.fields.url) ?? "",
      title: fieldString(row.fields.title) ?? "",
      count: Number(fieldString(row.fields.supportingVisitCount) ?? "0"),
    }))
    .filter((site) => site.url.length > 0);

  const favicons = await fetchFavicons([
    ...new Set(mostVisited.map((site) => domainOf(site.url))),
  ]);

  return {
    activity,
    recoveredActivity: recovered,
    activityComplete,
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

/** "4 Mar 2024 — 17 Apr 2024", one day, or `null` with no dated bound. */
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

/** A short day range: "6 Apr", "6–10 Apr", "28 Mar – 2 Apr", or with years
 *  when the two days fall in different years ("28 Dec 2023 – 2 Jan 2024"). */
export function formatDayRange(from: string, to: string): string {
  if (from === to) {
    return formatDayTick(from);
  }
  const [fromYear, fromMonth] = from.split("-");
  const [toYear, toMonth] = to.split("-");
  if (fromYear !== toYear) {
    return `${formatDay(from)} - ${formatDay(to)}`;
  }
  if (fromMonth !== toMonth) {
    return `${formatDayTick(from)} - ${formatDayTick(to)}`;
  }
  const [toDay, ...toRest] = formatDayTick(to).split(" ");
  const fromDay = formatDayTick(from).split(" ")[0] ?? from;
  return `${fromDay}-${toDay ?? ""} ${toRest.join(" ")}`.trim();
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
