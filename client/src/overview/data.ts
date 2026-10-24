/**
 * Overview data: the reads the page makes and the small, pure helpers that
 * turn their Findings into what the panels print. Nothing here invents a
 * value: every figure is a recorded field or a count of recorded rows.
 */
import { callApi } from "@/api";
import {
  fetchActivityBuckets,
  type ActivityBucket,
} from "@/components/activity-data";
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
  readonly activity: readonly ActivityBucket[];
  /** True when every activity row for this Case was read, not just the first
   *  page cap (`fetchActivityBuckets`'s `ACTIVITY_PAGE_CAP`). When `false`
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
  return {
    first: fieldTimestampUtc(earliest.items[0]?.fields.visitTime),
    last: fieldTimestampUtc(latest.items[0]?.fields.visitTime),
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
    { buckets: activity, complete: activityComplete },
    recordedSpan,
    mostVisitedPage,
    completeness,
    caseProfiles,
    metadataPage,
    downloadsPage,
  ] = await Promise.all([
    fetchActivityBuckets(),
    fetchRecordedSpan(),
    callApi<PageOf<Finding>>("history", [
      ["view", "most-visited"],
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

export function formatDay(date: string): string {
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
