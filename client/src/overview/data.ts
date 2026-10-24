/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import { formatDay } from "@/components/page-kit";
import { fetchActivity, type ActivityBucket } from "@/components/activity-data";
import type {
  CaseCompleteness,
  CaseProfiles,
  FieldState,
  Finding,
  PageOf,
} from "@/types";

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
  readonly completeness: CaseCompleteness;
  readonly metadata: readonly Finding[];
  readonly downloads: readonly Finding[];
  /** Recovered favicon for each Top sites host, as an inline `data:` URI —
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

export async function loadOverview(): Promise<OverviewData> {
  const [
    { saved: activity, recovered, complete: activityComplete },
    recordedSpan,
    mostVisitedPage,
    completeness,
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
    callApi<CaseCompleteness>("completeness", []),
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
      ["limit", "5"],
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
    completeness,
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
    : `${formatDay(first)} — ${formatDay(last)}`;
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
