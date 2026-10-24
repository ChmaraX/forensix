/**
 * Overview — the Case at a glance: the first ten seconds of an examination.
 *
 * The page answers an examiner's first questions in reading order: whose
 * browser is this (the masthead, from Metadata Findings) and is the evidence
 * complete (the coverage indicator beside it); how much and when (the
 * figures and Browsing activity); where and what (Most visited sites,
 * Recent downloads); who exactly and at what hour (Subject, Time of day);
 * and was anything deleted or overwritten (Recovered). Nothing here is
 * invented: a Metadata value renders through the same Field State text
 * every list page uses, so `absent` and `unavailable` stay visibly distinct
 * from a value. The one Candidate-backed panel (Topic categorization) is
 * labelled Candidate and never feeds a figure.
 *
 * Layout: an unframed masthead on the page substrate, one `MetricBand` of
 * four figures, then a two-column grid - the evidence on the left (8 of 12
 * columns: activity, sites, downloads) and its context on the right
 * (subject, time of day, recovered rows).
 *
 * Saved and recovered rows: every figure and chart counts saved rows only
 * (Most visited sites and Recent downloads read `commit-state=committed`; the
 * shared activity read keeps recovered rows apart). Recovered rows are
 * named in their own panel, per page, and never summed into a figure.
 *
 * Every row and jump link is a real link that carries the Case's lens: a
 * host opens Sites on it, a download opens its own row on Downloads, the
 * picked days open on the Timeline, a Recovered row opens that page's
 * Recovered tab.
 *
 * The date range (the masthead's picker, or a day clicked / a span dragged
 * on Browsing activity) narrows every panel but Recovered: the figures,
 * Time of day, Most visited sites (re-read from the saved visits in range)
 * and Recent downloads.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  bucketsToDays,
  bucketsToHourTotals,
  fillGaps,
} from "@/components/activity-data";
import { useChartTokens } from "@/components/charts";
import { ActivityBars, HourBars } from "@/components/charts-ready";
import { ChartSection } from "@/components/chart-section";
import { DateRangePicker } from "@/components/date-range-picker";
import { coverageOf } from "@/components/completeness";
import { ErrorRows, LoadingRows, RevealSwap } from "@/components/list-states";
import { formatDaySpan, plural, SectionPanel } from "@/components/page-kit";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

// Topic categorization: a one-line "unavailable" state with an "enable the
// model" Sheet, until the topic-status route exists.
import { TopicCategorizationLine } from "./overview-topic-widget.js";
import { localDayOf } from "./components/day-bounds.js";
import { profileLabel } from "./components/finding-fields.js";
import { rowRefOf } from "./router.js";
import { hrefFor, useViewRange } from "./view-state.js";
import {
  fieldString,
  formatDay,
  formatSpan,
  loadDownloadsIn,
  loadMostVisitedIn,
  loadOverview,
  loadRecovered,
  shiftDay,
  type OverviewData,
  type RecoveredCount,
  type TopSite,
} from "./overview/data";
import type { Finding } from "./types.js";
import {
  CaseFigures,
  DownloadsList,
  JumpLink,
  LoadingOverview,
  LoadingRecovered,
  Masthead,
  RecoveredList,
  RecoveredTitle,
  SubjectList,
  TopSitesList,
  type ArtifactCoverage,
  type CaseFigure,
} from "./overview/parts";

export function OverviewPage({
  coverage,
  caseProfiles,
}: {
  /** Every profile the Case knows (`caseProfilesOf`: the profiles route
   *  plus any the Completeness Statement names), so the Profiles figure
   *  agrees with the coverage detail. Omitted: the profiles route's list. */
  readonly caseProfiles?: readonly string[];
  /** The shell's whole-Case coverage indicator, for the masthead's right.
   *  Overview carries no coverage banner. */
  readonly coverage?: ReactNode;
  /** Unused: every link on the page is a real `<a href>` built with
   *  `hrefFor` (a new tab works, Back returns here). Kept so the shell's
   *  call still type-checks; the shell can stop passing it. */
  readonly onOpen?: (key: string, param?: string) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Retry: re-runs the read from scratch.
  const [attempt, setAttempt] = useState(0);

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
  }, [attempt]);

  if (error !== null) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorRows
          title="The overview could not be loaded."
          message={error}
          onRetry={() => {
            setError(null);
            setData(null);
            setAttempt((count) => count + 1);
          }}
          className="p-0"
        />
      </div>
    );
  }

  // The skeleton and the page share one `reveal-swap` cell: when the data
  // lands the page is added after the skeleton, which fades out as the page's
  // blocks fade in one by one.
  return (
    <div className="reveal-swap">
      <LoadingOverview className="reveal-items" />
      {data === null ? null : (
        <OverviewContent
          data={data}
          coverage={coverage}
          caseProfiles={caseProfiles}
        />
      )}
    </div>
  );
}

function OverviewContent({
  data,
  coverage,
  caseProfiles,
}: {
  readonly coverage?: ReactNode;
  readonly caseProfiles?: readonly string[];
  readonly data: OverviewData;
}) {
  const tokens = useChartTokens();
  const subjectId = useId();
  const topSitesId = useId();
  const downloadsId = useId();
  const recoveredId = useId();
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
  // The Case-wide range (the shell's lens, in the URL): it travels to the
  // pages the Overview links to.
  const [viewRange, setViewRange] = useViewRange();
  const rangeFrom = viewRange.from;
  const rangeTo = viewRange.to;

  // The true recorded span, read directly from the Case (not from the
  // possibly-truncated `activity` set). `recordedSpan` carries UTC instants,
  // read here as days in the declared timezone: the same days the activity
  // chart draws (UTC days when the Case has no single declared timezone).
  //
  // Every day the loaded activity rows cover is recorded evidence too, so the
  // span always contains them: "full span" can never read narrower than the
  // chart drawn under it (it once read a single day when both bound reads
  // returned the same row).
  const fullSpan = useMemo(() => {
    const first = localDayOf(data.recordedSpan.first, data.timeZone);
    const last = localDayOf(data.recordedSpan.last, data.timeZone);
    const days = [
      ...(first === null ? [] : [first]),
      ...(last === null ? [] : [last]),
      ...data.activity.map((bucket) => bucket.date),
    ].sort();
    return {
      first: days[0] ?? null,
      last: days[days.length - 1] ?? null,
    };
  }, [data]);

  // The span the loaded `activity` rows actually cover. When the read was
  // truncated by the page cap, this is shorter than `fullSpan`, and the charts
  // built from `activity` must say so instead of silently covering less than
  // what the header promises.
  const chartsCover = useMemo(() => {
    const dates = data.activity.map((bucket) => bucket.date).sort();
    return {
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    };
  }, [data]);

  const truncated = !data.activityComplete;

  // Sparse per-day totals restricted to the picked range — "active days"
  // below (`windowed.days.length`) and `quietGap` both depend on this array
  // never being gap-filled: a continuous run of every calendar day would
  // always read as zero active-day gaps, silently hiding real quiet stretches.
  // `chartDays` (below) is the gap-filled reading, used only by the chart.
  const windowed = useMemo(() => {
    const range = { from: rangeFrom, to: rangeTo };
    const days = bucketsToDays(data.activity, range);
    const hourTotals = bucketsToHourTotals(data.activity, range);
    const totalVisits = days.reduce((sum, day) => sum + day.count, 0);
    const recoveredVisits = bucketsToDays(data.recoveredActivity, range).reduce(
      (sum, day) => sum + day.count,
      0,
    );
    return { days, hourTotals, totalVisits, recoveredVisits };
  }, [data, rangeFrom, rangeTo]);

  // Every saved day, continuous: zero-count days fill the gaps between them
  // so the chart's x-axis is real calendar time — the same shared reading
  // History's and Timeline's "page visits per day" charts draw. The chart
  // always draws the whole span and drives the masthead's range: a clicked
  // day or a dragged span narrows every panel; the range is washed in.
  const chartDays = useMemo(
    () => fillGaps(bucketsToDays(data.activity)),
    [data.activity],
  );
  const rangeActive = rangeFrom !== "" || rangeTo !== "";

  // Under a narrowed range, Most visited sites and Recent downloads re-read
  // the saved rows in it (in the declared timezone's days). Each read keeps
  // its own state: a failed read shows its error with Retry, never "nothing
  // in this range"; a read that stopped at its cap says the list is partial.
  const range = useMemo(
    () => ({ from: rangeFrom, to: rangeTo }),
    [rangeFrom, rangeTo],
  );
  const loadSites = useCallback(
    () => loadMostVisitedIn(range, data.timeZone),
    [range, data.timeZone],
  );
  const loadDownloads = useCallback(
    () =>
      loadDownloadsIn(range, data.timeZone).then((result) => ({
        items: result.downloads,
        complete: result.complete,
      })),
    [range, data.timeZone],
  );
  // A narrowed range's hosts bring their own recovered favicons.
  const [rangedFavicons, setRangedFavicons] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const rangedSites = useRangedRead<TopSite>(
    rangeActive,
    useCallback(
      () =>
        loadSites().then((result) => {
          setRangedFavicons(result.favicons);
          return { items: result.sites, complete: result.complete };
        }),
      [loadSites],
    ),
  );
  const rangedDownloads = useRangedRead<Finding>(rangeActive, loadDownloads);
  const mostVisited: RangedState<TopSite> = rangeActive
    ? rangedSites
    : {
        state: "ready",
        items: data.mostVisited,
        complete: data.mostVisitedComplete,
      };
  const favicons = rangeActive ? rangedFavicons : data.favicons;

  // Recovered rows per page: whole Case, read once the page is up (its own
  // block, its own skeleton), never narrowed by the range and never summed
  // into a figure.
  const recovered = useRecovered();
  const recentDownloads: RangedState<Finding> = rangeActive
    ? rangedDownloads
    : { state: "ready", items: data.downloads, complete: true };

  // The longest stretch of consecutive days with no recorded visits between
  // two active days — a derived reading of the same `days` set the activity
  // chart draws, never a new query. `from` / `to` are the quiet days
  // themselves (the day after one active day to the day before the next).
  // `null` when fewer than two active days exist or no day-long gap does.
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
        best = {
          days: gap,
          from: shiftDay(previous.date, 1),
          to: shiftDay(next.date, -1),
        };
      }
    }
    return best;
  }, [windowed.days]);

  const activeSpan =
    windowed.days.length === 0
      ? null
      : {
          first: windowed.days[0]?.date ?? "",
          last: windowed.days[windowed.days.length - 1]?.date ?? "",
        };
  // Metadata carries one browser_metadata Finding per Source and one
  // profile_metadata Finding per Profile. The subject readout takes the first
  // of each: multi-Profile and multi-Source Cases still get a single, legible
  // subject readout, and the Metadata page keeps the full, per-Profile table.
  const browserMetadata = data.metadata.find(
    (row) => row.findingKind === "browser_metadata",
  );
  const profileMetadata = data.metadata.find(
    (row) => row.findingKind === "profile_metadata",
  );

  const spanLabel = formatSpan(fullSpan.first, fullSpan.last);
  const chartsCoverLabel =
    formatSpan(chartsCover.first, chartsCover.last) ?? "no dated activity";
  const subjectName =
    fieldString(profileMetadata?.fields.accountFullName) ??
    fieldString(profileMetadata?.fields.accountEmail) ??
    fieldString(profileMetadata?.fields.profileName);

  // The masthead's identity line under the subject name: the recorded e-mail
  // (unless it already is the headline) and the Chrome build — values only,
  // never invented; a missing value is simply not a segment. The Subject
  // panel leaves these two out rather than repeat them.
  const accountEmail = fieldString(profileMetadata?.fields.accountEmail);
  const chromeVersion = fieldString(browserMetadata?.fields.chromeVersion);
  const heroMeta = [
    accountEmail !== null && accountEmail !== subjectName ? accountEmail : null,
    chromeVersion === null ? null : `Chrome ${chromeVersion}`,
  ]
    .filter((segment): segment is string => segment !== null)
    .join("  ·  ");

  // The figures: each a plain reading of a number the page already computed
  // above, never a new query, and no caption — a sub-line appears only when
  // it is itself data (the active days' span, the quiet stretch's dates,
  // the profiles with nothing read). A Case (or range) with nothing of that
  // shape says so in words, muted and at body size, rather than hiding the
  // reading. Everything read from `activity` counts saved visits only.
  // Every profile the Case knows, so the figure agrees with the coverage;
  // a profile none of whose databases was read is named as such.
  const profiles = caseProfiles ?? data.profiles;
  const unreadProfiles = profiles.filter(
    (profile) =>
      !data.completeness.statements.some((statement) =>
        statement.artifacts.some(
          (database) =>
            database.profile === profile && database.outcome === "produced",
        ),
      ),
  );
  const figures: readonly CaseFigure[] = [
    {
      key: "visits",
      label: "Page visits",
      value: windowed.totalVisits,
      recorded: true,
    },
    {
      key: "active-days",
      label: "Active days",
      value: windowed.days.length,
      recorded: true,
      // When: the first to the last active day (in the range).
      detail:
        activeSpan === null
          ? undefined
          : formatDaySpan(activeSpan.first, activeSpan.last),
    },
    {
      key: "quiet",
      label: "Longest quiet stretch",
      recorded: quietGap !== null,
      value:
        quietGap === null
          ? windowed.days.length === 0
            ? "No dated activity"
            : windowed.days.length === 1
              ? "One active day"
              : "No quiet days"
          : plural(quietGap.days, "day", "days"),
      detail:
        quietGap === null
          ? undefined
          : formatDaySpan(quietGap.from, quietGap.to),
    },
    {
      key: "profiles",
      label: profiles.length === 1 ? "Profile" : "Profiles",
      value: profiles.length,
      recorded: true,
      detail:
        unreadProfiles.length === 0
          ? undefined
          : `${String(unreadProfiles.length)} with nothing read`,
      valueTooltip:
        profiles.length === 0
          ? undefined
          : profiles
              .map(
                (profile) =>
                  `${profileLabel(profile)}${
                    unreadProfiles.includes(profile) ? " - nothing read" : ""
                  }`,
              )
              .join(", "),
    },
  ];

  // How much of each artifact was read, for the Recovered rows: `null`
  // when every database was (the row then needs no note).
  const artifactCoverage = (artifact: string): ArtifactCoverage | null => {
    const scope = coverageOf(data.completeness, [artifact]);
    return scope.degraded
      ? { produced: scope.produced, attempted: scope.attempted }
      : null;
  };

  // The day or span picked on the chart, as the Timeline link names it.
  const pickedDays = rangeActive
    ? formatSpan(
        rangeFrom === "" ? (fullSpan.first ?? rangeTo) : rangeFrom,
        rangeTo === "" ? (fullSpan.last ?? rangeFrom) : rangeTo,
      )
    : null;

  // The activity read stopped at its page cap: both charts drawn from it say
  // so in their footer instead of silently covering less than the span.
  const truncationNote = truncated ? (
    <Banner status="warning" contrast="high" size="compact" className="w-full">
      <BannerTitle>
        This chart stops short of the full recorded span
      </BannerTitle>
      <BannerDescription>
        The recorded span is {spanLabel ?? "undated"}; the chart covers only{" "}
        {chartsCoverLabel}, the most this page could read.
      </BannerDescription>
    </Banner>
  ) : undefined;

  // Links carry the lens (`hrefFor`), so a page opens on the same days.
  const sitesHref = (host: string) => hrefFor("sites", { host });
  const downloadHref = (download: Finding) => {
    const row = rowRefOf(download);
    return hrefFor("downloads", row === null ? {} : { row, tab: "saved" });
  };
  // Recovered counts cover every day and every profile, so their links open
  // the page without the lens: the Recovered tab then lists the rows
  // counted here.
  const recoveredHref = (page: string) =>
    hrefFor(page, { from: "", to: "", profiles: [], tab: "recovered" });

  return (
    <div className="reveal-items flex flex-col gap-5">
      <Masthead
        subjectName={subjectName}
        meta={heroMeta}
        coverage={coverage}
        picker={
          <DateRangePicker
            size="compact"
            from={rangeFrom}
            to={rangeTo}
            min={fullSpan.first}
            max={fullSpan.last}
            // One wording on every date picker for the cleared range.
            triggerLabel="All recorded days"
            formatDate={formatDay}
            onChange={setViewRange}
          />
        }
      />

      <CaseFigures items={figures} />

      {/* Two columns from `lg`: the evidence on the left (8), its context
          on the right (4). Each row pairs blocks of a similar height. */}
      <div className="grid grid-cols-12 gap-4">
        {/* Activity — the page's main chart. A picked day or span gets a
            footer naming it, with the way to that day on the Timeline. */}
        <ChartSection
          title="Browsing activity"
          action={<JumpLink label="History" href={hrefFor("history")} />}
          footer={
            pickedDays === null && truncationNote === undefined ? undefined : (
              <div className="flex w-full flex-col gap-2">
                {truncationNote}
                {pickedDays === null ? null : (
                  <div className="flex min-h-7 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <p
                      className={cn(
                        typeClass("body"),
                        "min-w-0 text-foreground tabular-nums",
                      )}
                    >
                      {pickedDays}
                      <span className="text-muted-foreground">
                        {"  ·  "}
                        {plural(
                          windowed.totalVisits,
                          "page visit",
                          "page visits",
                        )}
                      </span>
                    </p>
                    <JumpLink
                      label={
                        rangeFrom !== "" && rangeFrom === rangeTo
                          ? "This day in Timeline"
                          : "These days in Timeline"
                      }
                      href={hrefFor("timeline")}
                      description={`Open ${pickedDays} in Timeline`}
                      // Flush left when it wraps under the days (a phone).
                      className="max-sm:-ml-3"
                    />
                  </div>
                )}
              </div>
            )
          }
          className="col-span-12 lg:col-span-8"
        >
          {/* Recharts measures its parent, and a bare flex child resolves to
              zero height — so the plot fills an absolutely positioned box
              inside a `flex-1` content area, and stretches to the grid row's
              real height (set by the Subject panel beside it). */}
          <div className="relative min-h-[240px] flex-1">
            <div className="absolute inset-0 px-2 pt-2 pb-3">
              <ActivityBars
                days={chartDays}
                tokens={tokens}
                range={viewRange}
                onRangeChange={setViewRange}
              />
            </div>
          </div>
        </ChartSection>

        {/* Subject — the identity readout, beside the activity it belongs
            next to. E-mail and Chrome version already read in the masthead. */}
        <SectionPanel
          id={subjectId}
          title="Subject"
          aside={
            <JumpLink label="Browser profile" href={hrefFor("metadata")} />
          }
          className="col-span-12 lg:col-span-4"
        >
          <SubjectList
            fields={[
              {
                label: "Account name",
                field: profileMetadata?.fields.accountFullName,
              },
              {
                label: "Profile name",
                field: profileMetadata?.fields.profileName,
              },
              {
                label: "Hosted domain",
                field: profileMetadata?.fields.accountHostedDomain,
              },
              {
                label: "Locale",
                field: profileMetadata?.fields.accountLocale,
              },
              {
                label: "Variations country",
                field: browserMetadata?.fields.variationsCountry,
              },
              {
                label: "Screen work area",
                field: profileMetadata?.fields.screenWorkArea,
              },
            ]}
          />
        </SectionPanel>

        {/* Ranked by saved visit rows per host - the count Sites prints
            beside each host - so the panel opens Sites. */}
        <SectionPanel
          id={topSitesId}
          title="Most visited sites"
          aside={<JumpLink label="Sites" href={hrefFor("sites")} />}
          className="col-span-12 md:col-span-6 lg:col-span-8"
        >
          {mostVisited.state === "failed" ? (
            <ErrorRows
              title="The most visited sites in this range could not be loaded."
              message={mostVisited.error}
              onRetry={mostVisited.retry}
            />
          ) : (
            <RevealSwap
              loading={mostVisited.state === "loading"}
              skeleton={
                <LoadingRows rows={6} label="Loading most visited sites" />
              }
              className="flex-1"
            >
              {mostVisited.state === "ready" ? (
                <div className="flex h-full flex-col">
                  <TopSitesList
                    sites={mostVisited.items}
                    emptyMessage={
                      rangeActive
                        ? "No saved page visit falls in this range."
                        : undefined
                    }
                    favicons={favicons}
                    hrefOf={sitesHref}
                  />
                  {mostVisited.complete ? null : (
                    <PartialNote>
                      {rangeActive
                        ? "Counted from the first 1,000 saved visits in this range; History lists them all."
                        : "Ranked from the first 2,000 hosts Sites lists; Sites lists them all."}
                    </PartialNote>
                  )}
                </div>
              ) : null}
            </RevealSwap>
          )}
        </SectionPanel>

        <ChartSection
          title="Time of day"
          action={<JumpLink label="Timeline" href={hrefFor("timeline")} />}
          footer={truncationNote}
          className="col-span-12 md:col-span-6 lg:col-span-4"
        >
          <div className="relative min-h-[220px] flex-1">
            <div className="absolute inset-0 px-2 pt-2 pb-3">
              <HourBars hours={windowed.hourTotals} tokens={tokens} />
            </div>
          </div>
        </ChartSection>

        <SectionPanel
          id={downloadsId}
          title="Recent downloads"
          aside={<JumpLink label="Downloads" href={hrefFor("downloads")} />}
          className="col-span-12 lg:col-span-8"
        >
          {recentDownloads.state === "failed" ? (
            <ErrorRows
              title="The downloads in this range could not be loaded."
              message={recentDownloads.error}
              onRetry={recentDownloads.retry}
            />
          ) : (
            <RevealSwap
              loading={recentDownloads.state === "loading"}
              skeleton={
                <LoadingRows rows={5} label="Loading recent downloads" />
              }
            >
              {recentDownloads.state === "ready" ? (
                <>
                  <DownloadsList
                    downloads={recentDownloads.items}
                    hrefOf={downloadHref}
                    emptyMessage={
                      recentDownloads.complete
                        ? rangeActive
                          ? "No saved download started in this range."
                          : undefined
                        : "No saved download in this range among the newest 2,000."
                    }
                  />
                  {recentDownloads.complete ||
                  recentDownloads.items.length === 0 ? null : (
                    <PartialNote>
                      Read from the newest 2,000 saved downloads; the Downloads
                      page lists them all.
                    </PartialNote>
                  )}
                </>
              ) : null}
            </RevealSwap>
          )}
        </SectionPanel>

        {/* Recovered — was anything deleted or overwritten? One row per
            page holding recovered rows, opening its Recovered tab. Whole
            Case: the date range does not narrow it (said when one is
            picked). */}
        <SectionPanel
          id={recoveredId}
          title={<RecoveredTitle />}
          description={rangeActive ? "Every day, every profile" : undefined}
          className="col-span-12 lg:col-span-4"
        >
          {recovered.state === "failed" ? (
            <ErrorRows
              title="The recovered rows could not be counted."
              message={recovered.error}
              onRetry={recovered.retry}
            />
          ) : (
            <RevealSwap
              loading={recovered.state === "loading"}
              skeleton={<LoadingRecovered />}
              className="flex flex-1 flex-col"
            >
              {recovered.state === "ready" ? (
                <RecoveredList
                  counts={recovered.counts}
                  coverageOf={artifactCoverage}
                  hrefOf={recoveredHref}
                />
              ) : null}
            </RevealSwap>
          )}
        </SectionPanel>

        {/* TODO: wire to the real topic-candidates / topic-status routes
            once they exist; until then the panel states it is unavailable. */}
        <TopicCategorizationLine className="col-span-12" />
      </div>
    </div>
  );
}

/** The Recovered panel's read: once per page view, with Retry. */
function useRecovered():
  | { readonly state: "loading" }
  | {
      readonly state: "failed";
      readonly error: string;
      readonly retry: () => void;
    }
  | { readonly state: "ready"; readonly counts: readonly RecoveredCount[] } {
  const [answer, setAnswer] = useState<
    | { readonly ok: true; readonly counts: readonly RecoveredCount[] }
    | { readonly ok: false; readonly error: string }
    | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAnswer(null);
    setAttempt((count) => count + 1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadRecovered()
      .then((counts) => {
        if (!cancelled) {
          setAnswer({ ok: true, counts });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAnswer({
            ok: false,
            error:
              requestError instanceof Error
                ? requestError.message
                : "Request failed.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  if (answer === null) {
    return { state: "loading" };
  }
  return answer.ok
    ? { state: "ready", counts: answer.counts }
    : { state: "failed", error: answer.error, retry };
}

/** A ranged read: loading, failed (with Retry), or its rows and whether the
 *  read covered the whole range. */
type RangedState<Item> =
  | { readonly state: "loading" }
  | {
      readonly state: "failed";
      readonly error: string;
      readonly retry: () => void;
    }
  | {
      readonly state: "ready";
      readonly items: readonly Item[];
      readonly complete: boolean;
    };

/** Runs `load` whenever it changes while `enabled`; a stale answer (the
 *  range moved on) is dropped. */
function useRangedRead<Item>(
  enabled: boolean,
  load: () => Promise<{
    readonly items: readonly Item[];
    readonly complete: boolean;
  }>,
): RangedState<Item> {
  // Each answer is kept with the `load` it came from, so a render after the
  // range moved on never shows the previous range's rows.
  const [answer, setAnswer] = useState<{
    readonly load: typeof load;
    readonly state: RangedState<Item>;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    setAnswer(null);
    load()
      .then(({ items, complete }) => {
        if (!cancelled) {
          setAnswer({ load, state: { state: "ready", items, complete } });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setAnswer({
            load,
            state: {
              state: "failed",
              error:
                requestError instanceof Error
                  ? requestError.message
                  : "Request failed.",
              retry,
            },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, load, attempt, retry]);
  return answer !== null && answer.load === load
    ? answer.state
    : { state: "loading" };
}

/** A one-line caption under a list that is not the whole set. */
function PartialNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className={cn(typeClass("caption"), "px-4 pb-3 text-muted-foreground")}>
      {children}
    </p>
  );
}
