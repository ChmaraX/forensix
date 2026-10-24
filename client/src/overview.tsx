/**
 * Overview — the Case at a glance.
 *
 * The page answers an examiner's first two questions before anything else:
 * whose browser is this (the subject fields, read from Metadata Findings) and
 * what does the evidence cover (the coverage strip, read from the
 * Completeness Statement). Every other panel — activity, downloads, top
 * sites — is derived analyzer output. Nothing here is invented: a Metadata
 * value renders through the same Field State text every list page uses, so
 * `absent` and `unavailable` stay visibly distinct from a value. The three
 * highlight tiles are the one exception to "every card looks the same" — they
 * are still read straight off `activity` and `most-visited`, just framed as
 * the surface's own commentary rather than as an evidence outcome.
 */
import { ArrowUpRight, FileDown, Fingerprint, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { callApi } from "./api.js";
import {
  bucketsToDays,
  bucketsToHourTotals,
  fetchActivityBuckets,
  fillGaps,
  type ActivityBucket,
} from "./components/activity-data.js";
import {
  ActivityBars,
  formatHour,
  HourBars,
  useChartTokens,
  usePrefersReducedMotion,
  type DayCount,
} from "./components/charts.js";
import { DateRangePicker } from "./components/date-range-picker.js";
import { MaybeFieldStateText } from "./components/field-state.js";
import { riseDelay, StatTile as HighlightTile } from "./components/stat-tile.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/compat/card.js";
import { Skeleton } from "./components/ui/misc.js";
import { cn } from "./lib.js";
import type {
  CaseCompleteness,
  CaseProfiles,
  FieldState,
  Finding,
  PageOf,
} from "./types.js";

// The "Topic categorization" Overview widget: donut + legend, with a locked/
// blurred preview and an "enable the model" Sheet when the local classifier
// isn't available. See overview-topic-widget.tsx for the still-mock-data note.
import {
  TopicCategorizationCard as TopicWidget,
  type TopicState,
} from "./overview-topic-widget.js";

function fieldString(field: FieldState | undefined): string | null {
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

interface OverviewData {
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
  readonly mostVisited: readonly {
    readonly url: string;
    readonly title: string;
    readonly count: number;
  }[];
  readonly profiles: readonly string[];
  readonly completeness: CaseCompleteness;
  readonly metadata: readonly Finding[];
  readonly downloads: readonly Finding[];
  /** Recovered favicon for each Top sites host, as an inline `data:` URI —
   *  the dashboard's CSP admits no other image source, so a favicon is never
   *  fetched live off this machine, only read back from the Case's own
   *  recovered `favicon_bitmaps` payloads. A host with no recovered favicon
   *  maps to `null`; the card falls back to its own letter tile for it. */
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

async function loadOverview(): Promise<OverviewData> {
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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Deterministic tint for a site's fallback letter tile, drawn from the theme
 *  washes — used only when the Case has no recovered favicon for that host. */
const SITE_TINTS = [
  "bg-accent text-accent-foreground",
  "bg-success-wash text-success",
  "bg-warning-wash text-warning",
  "bg-violet-wash text-violet",
  "bg-destructive-wash text-destructive",
  "bg-muted text-muted-foreground",
] as const;

/**
 * A site's identity mark: the actual favicon recovered from the Case's
 * `Favicons` database, rendered as the inline `data:` URI the server already
 * resolved — never a live-fetched icon, the dashboard's CSP forbids that.
 * `favicon === null` distinguishes "no recovered favicon for this host"
 * (render the letter fallback) from `undefined`, which the Overview never
 * hands this component (the favicon lookup always resolves every host it was
 * asked about, to either a `data:` URI or `null`).
 */
function SiteMark({
  domain,
  favicon,
  className,
}: {
  readonly domain: string;
  readonly favicon: string | null | undefined;
  readonly className?: string;
}) {
  if (favicon !== null && favicon !== undefined) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted",
          className,
        )}
      >
        <img
          src={favicon}
          alt=""
          aria-hidden="true"
          className="size-[60%] object-contain"
        />
      </span>
    );
  }
  let hash = 0;
  for (const char of domain) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  const tint = SITE_TINTS[hash % SITE_TINTS.length] ?? SITE_TINTS[0];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-[12px] font-semibold",
        tint,
        className,
      )}
    >
      {domain.charAt(0).toUpperCase()}
    </span>
  );
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

/**
 * A panel header: title over description, with an optional jump link on the
 * right edge that opens the section the panel summarizes. The stacked type
 * pair alone identifies the panel — the old per-card icon chips repeated one
 * decoration eight times and were dropped on request. The link is a real
 * navigation control, so it takes the interactive blue and nothing else in
 * the header does; the whole card stays a plain reading surface (values can
 * be selected, chart tooltips can be hovered) rather than one big button.
 */
function PanelHeader({
  title,
  description,
  linkLabel,
  onOpen,
}: {
  readonly title: string;
  readonly description: string;
  readonly linkLabel?: string;
  readonly onOpen?: () => void;
}) {
  return (
    <CardHeader>
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {linkLabel !== undefined && onOpen !== undefined ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-[12.5px] font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline"
        >
          {linkLabel}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </CardHeader>
  );
}

/**
 * Eases a figure from 0 to its true value on mount and whenever the value
 * changes (a range edit re-runs it, so the masthead visibly re-counts).
 * Under prefers-reduced-motion the true value renders immediately.
 */
function useCountUp(target: number, duration = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, duration, reduced]);
  return value;
}

/**
 * One figure in the masthead readout: a tiny bold-caps label over a large,
 * deliberately thin numeral — the type-contrast counterweight to the bold
 * subject name beside it. Secondary ink on the blue ground is always tinted
 * from the hue (blue-100/blue-200), never gray.
 */
function HeroFigure({
  label,
  value,
  note,
  big = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] leading-none font-semibold tracking-[0.1em] text-blue-200 uppercase">
        {label}
      </dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "leading-none font-light tracking-[-0.02em] text-white tabular-nums",
            big ? "text-[38px]" : "text-[27px]",
          )}
        >
          {value}
        </span>
        {note === undefined ? null : (
          <span className="truncate text-[12px] text-blue-200">{note}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * A 24-hour micro-histogram for the busiest-hour tile: the same `hourTotals`
 * the Time-of-day chart draws below, restated as a glanceable strip. Purely
 * decorative restatement of numbers already printed, hence aria-hidden.
 */
function HourSpark({ hours }: { readonly hours: readonly number[] }) {
  const peak = Math.max(...hours, 0);
  if (peak === 0) {
    return null;
  }
  return (
    <div aria-hidden="true" className="flex h-7 items-end gap-[2px]">
      {hours.map((count, hour) => (
        <span
          key={hour}
          className={cn(
            "flex-1 rounded-full",
            count === peak
              ? "bg-primary"
              : count > 0
                ? "bg-primary/30"
                : "bg-primary/10",
          )}
          style={{
            height:
              count === 0
                ? "2px"
                : `${String(Math.max(14, Math.round((count / peak) * 100)))}%`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * One line in the subject card: a plain-language label, then the Metadata
 * value rendered through the shared Field State text. `absent` and
 * `unavailable` render exactly as they do on every list page — never as a
 * blank, and never silently skipped.
 */
function SubjectField({
  label,
  field,
}: {
  readonly label: string;
  readonly field: FieldState | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-none font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1.5">
        <MaybeFieldStateText field={field} truncate />
      </dd>
    </div>
  );
}

/** The last path segment of a target-path Field's recorded value — the plain
 *  filename an examiner scans for, never a rewrite of the value itself: the
 *  full path stays reachable in the row below, byte-for-byte, in mono. */
function downloadFileName(field: FieldState | undefined): string | null {
  const text = fieldString(field);
  if (text === null || text.length === 0) {
    return null;
  }
  const segments = text.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? null;
}

/** One recorded download: a plain filename headline (when one can be read
 *  from the path) over its source URL and start time, each still the exact
 *  Field State text every list page uses. */
function DownloadRow({ download }: { readonly download: Finding }) {
  const name = downloadFileName(download.fields.targetPath);
  return (
    <div className="flex items-start gap-3 border-b border-border/70 pb-3 last:border-0 last:pb-0">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileDown aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {name === null ? (
          <MaybeFieldStateText field={download.fields.targetPath} truncate />
        ) : (
          <p className="truncate text-[13px] font-medium" title={name}>
            {name}
          </p>
        )}
        <MaybeFieldStateText field={download.fields.originalUrl} truncate />
        <MaybeFieldStateText field={download.fields.startTime} />
      </div>
    </div>
  );
}

function LoadingOverview() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading overview">
      <Skeleton className="h-[212px] rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-[118px] rounded-xl" />
        <Skeleton className="h-[118px] rounded-xl" />
        <Skeleton className="h-[118px] rounded-xl" />
        <Skeleton className="h-[118px] rounded-xl" />
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[300px] rounded-lg lg:col-span-8" />
        <Skeleton className="col-span-12 h-[300px] rounded-lg lg:col-span-4" />
        <Skeleton className="col-span-12 h-[220px] rounded-lg" />
        <Skeleton className="col-span-12 h-[260px] rounded-lg sm:col-span-6 lg:col-span-4" />
        <Skeleton className="col-span-12 h-[260px] rounded-lg sm:col-span-6 lg:col-span-4" />
        <Skeleton className="col-span-12 h-[260px] rounded-lg lg:col-span-4" />
      </div>
    </div>
  );
}

export function OverviewPage({
  onOpen,
}: {
  /** Opens a nav section by key — the per-panel jump links in card headers,
   *  and the Top sites row click, which passes a second argument: the host
   *  to preselect once the Sites tab is open. */
  readonly onOpen?: (key: string, param?: string) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokens = useChartTokens();
  // The date range narrows the activity panels client-side. History's `from`
  // / `to` bounds apply only to the `visits` view server-side (per-day and
  // per-hour activity is a precomputed summary), so `activity` is fetched
  // once, up to `ACTIVITY_PAGE_CAP` pages, and the range is applied here. The
  // recorded span shown and used as the range bounds always comes from a
  // direct, two-row `visits` read (`fetchRecordedSpan`), never from the
  // `activity` set — which the page cap can leave incomplete for a very
  // active Case. When that happens the charts built from `activity` carry
  // their own visible notice instead of silently covering less than the span
  // they sit under. The unset default keeps the full recorded span visible:
  // a rolling-window default would hide older evidence, which breaks the
  // promise that absence is data.
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  // TODO: replace with the real `topic-status` route once it exists (see
  // topic-candidates-onnx.ts's TopicClassifierUnavailableReason). Hardcoded
  // to "unavailable" — the honest default until the model-status API lands —
  // rather than claiming the classifier ran when nothing backs that yet.
  const topicState: TopicState = "unavailable";

  useEffect(() => {
    let cancelled = false;
    loadOverview()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Request failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const coverage = useMemo(() => {
    let attempted = 0;
    let produced = 0;
    for (const statement of data?.completeness.statements ?? []) {
      attempted += statement.attempted;
      produced += statement.produced;
    }
    return { attempted, produced };
  }, [data]);

  // The true recorded span, read directly from the Case (not from the
  // possibly-truncated `activity` set). `recordedSpan` carries UTC instants;
  // a plain UTC calendar-date slice can read up to a day later than the true
  // local date at the boundaries, which only ever widens the shown span or
  // range bounds by a day — it can never hide evidence, unlike a value derived
  // from a capped read.
  const fullSpan = useMemo(() => {
    const { first, last } = data?.recordedSpan ?? { first: null, last: null };
    return {
      first: first === null ? null : first.slice(0, 10),
      last: last === null ? null : last.slice(0, 10),
    };
  }, [data]);

  // The span the loaded `activity` rows actually cover. When the read was
  // truncated by the page cap, this is shorter than `fullSpan`, and the charts
  // built from `activity` must say so instead of silently covering less than
  // what the header promises.
  const chartsCover = useMemo(() => {
    const dates = (data?.activity ?? []).map((bucket) => bucket.date).sort();
    return {
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    };
  }, [data]);

  const truncated = data !== null && !data.activityComplete;

  // Sparse per-day totals restricted to the picked range — "active days"
  // below (`windowed.days.length`) and `quietGap` both depend on this array
  // never being gap-filled: a continuous run of every calendar day would
  // always read as zero active-day gaps, silently hiding real quiet stretches.
  // `chartDays` (below) is the gap-filled reading, used only by the chart.
  const windowed = useMemo(() => {
    const range = { from: rangeFrom, to: rangeTo };
    const buckets = data?.activity ?? [];
    const days = bucketsToDays(buckets, range);
    const hourTotals = bucketsToHourTotals(buckets, range);
    const totalVisits = days.reduce((sum, day) => sum + day.count, 0);
    const busiest = days.reduce<DayCount | null>(
      (best, day) => (best === null || day.count > best.count ? day : best),
      null,
    );
    return { days, hourTotals, totalVisits, busiest };
  }, [data, rangeFrom, rangeTo]);

  // The same days, continuous: zero-count bars fill the gaps between them so
  // the chart's x-axis is real calendar time — the same shared reading
  // History's and Timeline's identical "page visits per day" charts draw.
  const chartDays = useMemo(() => fillGaps(windowed.days), [windowed.days]);

  // The longest stretch of consecutive days with no recorded visits between
  // two active days — a derived reading of the same `days` set the activity
  // chart draws, never a new query. `null` when fewer than two active days
  // exist or no day-long gap does.
  const quietGap = useMemo(() => {
    let best: { days: number; from: string; to: string } | null = null;
    for (let index = 1; index < windowed.days.length; index += 1) {
      const previous = windowed.days[index - 1];
      const next = windowed.days[index];
      if (previous === undefined || next === undefined) {
        continue;
      }
      const gap =
        Math.round(
          (new Date(`${next.date}T00:00:00Z`).getTime() -
            new Date(`${previous.date}T00:00:00Z`).getTime()) /
            86_400_000,
        ) - 1;
      if (gap > 0 && (best === null || gap > best.days)) {
        best = { days: gap, from: previous.date, to: next.date };
      }
    }
    return best;
  }, [windowed.days]);

  // Masthead figures ease up from zero on load and re-count on a range edit.
  const visitsShown = useCountUp(windowed.totalVisits);
  const daysShown = useCountUp(windowed.days.length);

  if (error !== null) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive-border bg-destructive-wash px-4 py-3 text-[13px] text-destructive"
      >
        The overview could not be loaded: {error}
      </div>
    );
  }
  if (data === null) {
    return <LoadingOverview />;
  }

  // Metadata carries one browser_metadata Finding per Source and one
  // profile_metadata Finding per Profile. The subject card reads the first
  // of each: multi-Profile and multi-Source Cases still get a single, legible
  // subject readout, and every list page keeps the full, per-Profile table.
  const browserMetadata = data.metadata.find(
    (row) => row.findingKind === "browser_metadata",
  );
  const profileMetadata = data.metadata.find(
    (row) => row.findingKind === "profile_metadata",
  );

  const topSitePeak = Math.max(
    ...data.mostVisited.map((site) => site.count),
    0,
  );
  const spanLabel =
    fullSpan.first === null || fullSpan.last === null
      ? "No dated activity"
      : fullSpan.first === fullSpan.last
        ? formatDay(fullSpan.first)
        : `${formatDay(fullSpan.first)} — ${formatDay(fullSpan.last)}`;
  const chartsCoverLabel =
    chartsCover.first === null || chartsCover.last === null
      ? "no dated activity"
      : chartsCover.first === chartsCover.last
        ? formatDay(chartsCover.first)
        : `${formatDay(chartsCover.first)} — ${formatDay(chartsCover.last)}`;
  const rangeActive = rangeFrom !== "" || rangeTo !== "";
  const subjectName =
    fieldString(profileMetadata?.fields.accountFullName) ??
    fieldString(profileMetadata?.fields.accountEmail) ??
    fieldString(profileMetadata?.fields.profileName);

  // The masthead's one-line descriptor under the subject name: the recorded
  // e-mail (unless it already is the headline) and the Chrome build — values
  // only, never invented; a missing value is simply not a segment.
  const accountEmail = fieldString(profileMetadata?.fields.accountEmail);
  const chromeVersion = fieldString(browserMetadata?.fields.chromeVersion);
  const heroMeta = [
    accountEmail !== null && accountEmail !== subjectName ? accountEmail : null,
    chromeVersion === null ? null : `Chrome ${chromeVersion}`,
  ]
    .filter((segment): segment is string => segment !== null)
    .join("  ·  ");

  // The three highlight tiles: each a plain reading of a number the page
  // already computed above, never a new query. `null` when the Case (or the
  // selected range) has nothing of that shape — shown as its own muted state,
  // not hidden, so an empty Case still tells the truth about being empty.
  const topSite = data.mostVisited[0] ?? null;
  const peakHour = windowed.hourTotals.reduce<{
    hour: number;
    count: number;
  } | null>(
    (best, count, hour) =>
      count > 0 && (best === null || count > best.count)
        ? { hour, count }
        : best,
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Masthead — the one saturated panel in the app: the Case subject and
          the range readout on the brand blue, so the page opens with the
          surface's own voice before any evidence card. Every figure in it is
          the same derived number the old header carried; only the frame is
          new. The bold headline against deliberately thin numerals is the
          page's type contrast; secondary ink is tinted from the hue.
          The highlight strip docks over the masthead's bottom edge — the
          tiles are the masthead's own commentary, so they overlap it as
          attached subcards rather than floating below as a second, separate
          band. The extra bottom padding is the ledge they sit on. */}
      <div className="flex flex-col">
        <section
          aria-label="Case masthead"
          className="fx-rise fx-hero relative overflow-hidden rounded-2xl text-white"
          style={riseDelay(0)}
        >
          <Fingerprint
            aria-hidden="true"
            className="pointer-events-none absolute -right-7 -bottom-12 size-52 rotate-12 text-white/[0.07]"
          />
          <div className="relative flex flex-col gap-7 px-6 pt-6 pb-16 md:px-8 md:pt-7 md:pb-[72px]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
              <div className="flex min-w-0 items-start gap-4">
                <span className="mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
                  <UserRound aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-[30px] leading-tight font-bold tracking-[-0.03em]">
                    {subjectName ?? (
                      <span className="font-semibold text-blue-100 italic">
                        Subject not recorded
                      </span>
                    )}
                  </h1>
                  {heroMeta.length > 0 ? (
                    <p className="mt-1 truncate text-[13px] font-medium text-blue-100">
                      {heroMeta}
                    </p>
                  ) : null}
                  {/* Only worth a line when a range is narrowing the page —
                    the full span already reads verbatim in the pill. */}
                  {rangeActive ? (
                    <p className="mt-2 max-w-[52ch] text-[12.5px] text-blue-100">
                      {windowed.busiest === null
                        ? "No activity in the selected range."
                        : `${String(windowed.days.length)} day${windowed.days.length === 1 ? "" : "s"} in range, of a recorded span of ${spanLabel}.`}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0">
                {/* The trigger reads the actual span, not a generic "Full
                  recorded span" phrase — the interval is the one control an
                  examiner reaches for first, so it carries the dates and a
                  raised, taller frame on the blue. */}
                <DateRangePicker
                  from={rangeFrom}
                  to={rangeTo}
                  min={fullSpan.first}
                  max={fullSpan.last}
                  triggerLabel={
                    spanLabel === "No dated activity"
                      ? "Full recorded span"
                      : `${spanLabel}  ·  full span`
                  }
                  formatDate={formatDay}
                  onChange={({ from, to }) => {
                    setRangeFrom(from);
                    setRangeTo(to);
                  }}
                  className="h-10 rounded-lg text-[13px] font-medium text-foreground shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)]"
                />
              </div>
            </div>
            <dl className="flex flex-wrap items-end gap-x-10 gap-y-5">
              <HeroFigure
                big
                label="Page visits"
                value={visitsShown.toLocaleString("en-US")}
              />
              <HeroFigure
                label="Active days"
                value={daysShown.toLocaleString("en-US")}
              />
              <HeroFigure
                label="Readable"
                value={
                  coverage.attempted === 0
                    ? "—"
                    : `${String(Math.round((coverage.produced / coverage.attempted) * 100))}%`
                }
                note={
                  coverage.attempted === 0
                    ? undefined
                    : `of ${String(coverage.attempted)} artifacts`
                }
              />
              <HeroFigure
                label="Profiles"
                value={String(data.profiles.length)}
                note={data.profiles.length === 1 ? "profile" : "profiles"}
              />
            </dl>
          </div>
        </section>

        {/* Highlights — the one place this page reads the evidence back as a
            sentence instead of a figure: the busiest day, the busiest local
            hour, the site visited most, and the longest quiet stretch — each
            a plain reading of a number computed above, never a new query.
            The strip pulls up over the masthead's padded bottom edge, so the
            four read as subcards docked to it, not as a separate band. */}
        <div className="relative z-10 -mt-10 grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-4">
          <HighlightTile
            label="Busiest day"
            delay={1}
            value={
              windowed.busiest === null
                ? "No dated activity"
                : formatDay(windowed.busiest.date)
            }
            note={
              windowed.busiest === null
                ? "No page visits recorded in range."
                : `${windowed.busiest.count.toLocaleString("en-US")} page visits`
            }
          />
          <HighlightTile
            label="Busiest hour"
            delay={2}
            value={
              peakHour === null
                ? "No timed activity"
                : formatHour(peakHour.hour)
            }
            note={
              peakHour === null
                ? "No hourly data recorded."
                : `${peakHour.count.toLocaleString("en-US")} page visits, local time`
            }
          >
            <HourSpark hours={windowed.hourTotals} />
          </HighlightTile>
          <HighlightTile
            label="Most visited site"
            delay={3}
            value={
              topSite === null ? "No visited sites" : domainOf(topSite.url)
            }
            note={
              topSite === null
                ? "No sites recorded yet."
                : `${topSite.count.toLocaleString("en-US")} recorded visits`
            }
          />
          <HighlightTile
            label="Longest quiet stretch"
            delay={4}
            value={
              quietGap === null
                ? windowed.days.length === 0
                  ? "No dated activity"
                  : "No quiet days"
                : `${String(quietGap.days)} day${quietGap.days === 1 ? "" : "s"}`
            }
            note={
              quietGap === null
                ? windowed.days.length === 0
                  ? "No page visits recorded in range."
                  : "No day-long gaps inside the active span."
                : `No visits between ${formatDay(quietGap.from)} and ${formatDay(quietGap.to)}`
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Activity — the hero. */}
        <Card
          className="fx-rise col-span-12 overflow-hidden lg:col-span-8"
          style={riseDelay(5)}
        >
          <PanelHeader
            title="Browsing activity"
            description="Page visits recorded in this Case, per day."
            linkLabel="History"
            onOpen={
              onOpen === undefined
                ? undefined
                : () => {
                    onOpen("history");
                  }
            }
          />
          {truncated ? (
            <div
              role="alert"
              className="mx-4 mb-1 rounded-md border border-warning-border bg-warning-wash px-3 py-2 text-[12.5px] text-warning"
            >
              These charts stop short of the full recorded span ({spanLabel}).
              They cover only {chartsCoverLabel}, the most this page could read.
            </div>
          ) : null}
          {/* Recharts measures its parent, and a bare flex child resolves to
              zero height — so the plot fills an absolutely positioned box
              inside a `flex-1` content area. The chart then stretches to the
              grid row's real height (set by the taller neighbor card) instead
              of a fixed figure that left a dead band under the plot. */}
          <CardContent className="relative min-h-[240px] flex-1 p-0">
            <div className="absolute inset-0 pt-2 pr-4 pb-3 pl-3">
              <ActivityBars days={chartDays} tokens={tokens} />
            </div>
          </CardContent>
        </Card>

        {/* Subject — the full identity readout, promoted out of the header
            and given a card of its own beside the activity it belongs next
            to, rather than a duplicate full-width band above everything. */}
        <Card
          className="fx-rise col-span-12 overflow-hidden lg:col-span-4"
          style={riseDelay(6)}
        >
          <PanelHeader
            title="Subject"
            description="Read from Preferences and Local State."
            linkLabel="Metadata"
            onOpen={
              onOpen === undefined
                ? undefined
                : () => {
                    onOpen("metadata");
                  }
            }
          />
          <CardContent className="grid flex-1 grid-cols-2 content-start gap-x-5 gap-y-4 pt-3">
            <SubjectField
              label="Account e-mail"
              field={profileMetadata?.fields.accountEmail}
            />
            <SubjectField
              label="Account name"
              field={profileMetadata?.fields.accountFullName}
            />
            <SubjectField
              label="Profile name"
              field={profileMetadata?.fields.profileName}
            />
            <SubjectField
              label="Hosted domain"
              field={profileMetadata?.fields.accountHostedDomain}
            />
            <SubjectField
              label="Locale"
              field={profileMetadata?.fields.accountLocale}
            />
            <SubjectField
              label="Variations country"
              field={browserMetadata?.fields.variationsCountry}
            />
            <SubjectField
              label="Chrome version"
              field={browserMetadata?.fields.chromeVersion}
            />
            <SubjectField
              label="Screen work area"
              field={profileMetadata?.fields.screenWorkArea}
            />
          </CardContent>
        </Card>

      </div>

      {/* Top sites + Topic categorization — a matched pair right under
          Activity/Subject, so the new widget lands near the top of the page
          instead of at the bottom, next to the card it's most often read
          alongside. */}
      <div className="grid grid-cols-12 gap-4">
        {/* Top sites. */}
        <Card
          className="fx-rise col-span-12 sm:col-span-6"
          style={riseDelay(7)}
        >
          <PanelHeader
            title="Top sites"
            description="By recorded visits."
            linkLabel="Top sites"
            onOpen={
              onOpen === undefined
                ? undefined
                : () => {
                    onOpen("top-sites");
                  }
            }
          />
          {/* `justify-evenly` spreads the six rows across whatever height
              the row's tallest neighbor sets, so the card never ends in a
              dead band below the last site. Each row is its own button: a
              favicon + domain label (real, Case-recovered icons — CSP admits
              no other image source, so a missing one falls back to the
              letter tile, never a live fetch), a bar sized to the busiest
              site, and the count. Clicking a row is the same jump the
              card's own "Top sites" link makes, just pre-aimed at that one
              host on the Sites tab instead of landing on the tab empty. */}
          <CardContent className="flex flex-1 flex-col justify-evenly gap-1 py-3">
            {data.mostVisited.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">
                No visited sites recorded.
              </p>
            ) : (
              data.mostVisited.map((site) => {
                const domain = domainOf(site.url);
                const share =
                  topSitePeak === 0
                    ? 0
                    : Math.round((site.count / topSitePeak) * 100);
                return (
                  <button
                    key={site.url}
                    type="button"
                    onClick={
                      onOpen === undefined
                        ? undefined
                        : () => {
                            onOpen("sites", domain);
                          }
                    }
                    title={`Open Sites → ${domain}`}
                    className="grid w-full grid-cols-[minmax(0,132px)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <SiteMark
                        domain={domain}
                        favicon={data.favicons.get(domain)}
                        className="size-5"
                      />
                      <span className="truncate text-[12.5px] font-medium">
                        {domain}
                      </span>
                    </span>
                    <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          "block h-full rounded-full transition-[width] duration-500",
                          site.url === data.mostVisited[0]?.url
                            ? "bg-primary"
                            : "bg-primary/45",
                        )}
                        style={{ width: `${String(share)}%` }}
                      />
                    </span>
                    <span className="font-mono text-[12px] tabular-nums">
                      {site.count.toLocaleString("en-US")}
                    </span>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* TODO: still backed by mock data — wire to the real
            topic-candidates / topic-status routes once they exist. */}
        <TopicWidget state={topicState} />
      </div>

      {/* Time of day. No Overview-level coverage card: coverage lives in
          the masthead's "Readable" figure here, and in full detail as the
          Completeness panel every artifact page still opens with. */}
      <div className="grid grid-cols-12 gap-4">
        <Card
          className="fx-rise col-span-12 overflow-hidden sm:col-span-6"
          style={riseDelay(9)}
        >
          <PanelHeader
            title="Time of day"
            description="When the visits happened, by local hour."
            linkLabel="Timeline"
            onOpen={
              onOpen === undefined
                ? undefined
                : () => {
                    onOpen("timeline");
                  }
            }
          />
          <CardContent className="relative min-h-[190px] flex-1 p-0">
            <div className="absolute inset-0 pt-2 pr-4 pb-3 pl-3">
              <HourBars hours={windowed.hourTotals} tokens={tokens} />
            </div>
          </CardContent>
        </Card>

        {/* Recent downloads — paired with Time of day as two even halves. */}
        <Card
          className="fx-rise col-span-12 sm:col-span-6"
          style={riseDelay(10)}
        >
          <PanelHeader
            title="Recent downloads"
            description="Target path and source."
            linkLabel="Downloads"
            onOpen={
              onOpen === undefined
                ? undefined
                : () => {
                    onOpen("downloads");
                  }
            }
          />
          <CardContent className="flex max-h-[248px] flex-1 flex-col gap-3 overflow-y-auto py-3">
            {data.downloads.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">
                No downloads recorded.
              </p>
            ) : (
              data.downloads.map((download, index) => (
                <DownloadRow
                  key={`${download.profile}-${String(index)}`}
                  download={download}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


