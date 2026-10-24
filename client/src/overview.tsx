/**
 * Overview — the Case at a glance.
 *
 * The page answers an examiner's first two questions before anything else:
 * whose browser is this (the subject fields, read from Metadata Findings) and
 * what does the evidence cover (the "Readable" figure, read from the
 * Completeness Statement). Every other panel — activity, downloads, top
 * sites — is derived analyzer output. Nothing here is invented: a Metadata
 * value renders through the same Field State text every list page uses, so
 * `absent` and `unavailable` stay visibly distinct from a value. The
 * highlights band reads straight off `activity` and `most-visited` — recorded
 * facts only; the one Candidate-backed panel (Topic categorization) is
 * labelled as ranked Candidates and never feeds a figure or a highlight.
 *
 * Presentation is Fluid Functionalism throughout: an unframed masthead on
 * the page substrate (the shell renders no page header here), one
 * `MetricBand` of figures, `ChartSection` for the two charts and
 * `SectionPanel` for every other section, FF ghost buttons for the jump
 * links, one fluid hover highlight on the Top sites list, and `reveal-swap`
 * for the load.
 *
 * Saved and recovered rows: every figure and chart counts saved rows only
 * (Top sites and Recent downloads read `commit-state=committed`; the shared
 * activity read keeps recovered rows apart). Recovered visits are named
 * beside the visit figure, never summed in — as on History and Timeline.
 */
import { useEffect, useId, useMemo, useState } from "react";

import {
  bucketsToDays,
  bucketsToHourTotals,
  fillGaps,
} from "@/components/activity-data";
import {
  ActivityBars,
  formatHour,
  HourBars,
  useChartTokens,
  type DayCount,
} from "@/components/charts";
import { ChartSection } from "@/components/chart-section";
import { DateRangePicker } from "@/components/date-range-picker";
import { ErrorRows } from "@/components/list-states";
import { SectionPanel } from "@/components/page-kit";
import { Term } from "@/components/term";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";

// The "Topic categorization" Overview widget: donut + ranked legend, with a
// locked preview and an "enable the model" Sheet when the local classifier
// isn't available. See overview-topic-widget.tsx for the still-mock-data note.
import {
  TopicCategorizationCard as TopicWidget,
  type TopicState,
} from "./overview-topic-widget.js";
import {
  fieldString,
  formatDay,
  formatSpan,
  loadOverview,
  domainOf,
  type OverviewData,
} from "./overview/data";
import {
  CaseFigures,
  DownloadsList,
  HourSpark,
  JumpLink,
  LoadingOverview,
  Masthead,
  SubjectList,
  TopSitesList,
  type CaseFigure,
} from "./overview/parts";

export function OverviewPage({
  onOpen,
}: {
  /** Opens a nav section by key — the per-panel jump links in panel headers,
   *  and the Top sites row click, which passes a second argument: the host
   *  to preselect once the Sites tab is open. */
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
      {data === null ? null : <OverviewContent data={data} onOpen={onOpen} />}
    </div>
  );
}

function OverviewContent({
  data,
  onOpen,
}: {
  readonly data: OverviewData;
  readonly onOpen?: (key: string, param?: string) => void;
}) {
  const tokens = useChartTokens();
  const subjectId = useId();
  const topSitesId = useId();
  const downloadsId = useId();
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

  const coverage = useMemo(() => {
    let attempted = 0;
    let produced = 0;
    for (const statement of data.completeness.statements) {
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
  //
  // Every day the loaded activity rows cover is recorded evidence too, so the
  // span always contains them: "full span" can never read narrower than the
  // chart drawn under it (it once read a single day when both bound reads
  // returned the same row).
  const fullSpan = useMemo(() => {
    const { first, last } = data.recordedSpan;
    const days = [
      ...(first === null ? [] : [first.slice(0, 10)]),
      ...(last === null ? [] : [last.slice(0, 10)]),
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
    const busiest = days.reduce<DayCount | null>(
      (best, day) => (best === null || day.count > best.count ? day : best),
      null,
    );
    return { days, hourTotals, totalVisits, recoveredVisits, busiest };
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

  // Only worth a line when a range is narrowing the page — the full span
  // already reads verbatim in the picker.
  const rangeNote = rangeActive
    ? windowed.busiest === null
      ? "No activity in the selected range."
      : `${String(windowed.days.length)} active day${windowed.days.length === 1 ? "" : "s"} in range, of a recorded span of ${spanLabel ?? "no dated activity"}.`
    : null;

  // The figures: each a plain reading of a number the page already computed
  // above, never a new query. A Case (or range) with nothing of that shape
  // says so in words, muted, rather than hiding the reading. Everything read
  // from `activity` counts saved visits only (see the module note).
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
  const visitScope = [
    truncated
      ? "Saved, loaded days"
      : rangeActive
        ? "Saved, in range"
        : "Saved",
    windowed.recoveredVisits > 0
      ? `${windowed.recoveredVisits.toLocaleString("en-US")} recovered not counted`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const figures: readonly CaseFigure[] = [
    {
      key: "visits",
      label: "Page visits",
      value: windowed.totalVisits,
      recorded: true,
      detail: visitScope,
    },
    {
      key: "active-days",
      label: "Active days",
      value: windowed.days.length,
      recorded: true,
      detail: "Days with at least one visit",
    },
    {
      key: "readable",
      // Derived from the Completeness Statement alone: produced over
      // attempted, summed across every artifact the analyzer attempted.
      label: (
        <Term
          label="Readable"
          technical="Completeness Statement: produced / attempted"
        >
          Share of this Case&apos;s artifacts the analyzer could read, from the
          Completeness Statement. Each artifact page lists what was and was not
          read.
        </Term>
      ),
      value:
        coverage.attempted === 0
          ? "Not analyzed"
          : `${String(Math.round((coverage.produced / coverage.attempted) * 100))}%`,
      recorded: coverage.attempted > 0,
      detail:
        coverage.attempted === 0
          ? "Completeness Statement: none attempted"
          : `Completeness Statement: ${String(coverage.produced)} of ${String(coverage.attempted)} read`,
    },
    {
      key: "profiles",
      label: data.profiles.length === 1 ? "Profile" : "Profiles",
      value: data.profiles.length,
      recorded: true,
      detail:
        data.profiles.length === 0
          ? "No profiles recorded"
          : data.profiles.join(", "),
    },
    {
      key: "busiest-day",
      label: "Busiest day",
      recorded: windowed.busiest !== null,
      value:
        windowed.busiest === null
          ? "No dated activity"
          : formatDay(windowed.busiest.date),
      detail:
        windowed.busiest === null
          ? "No page visits recorded in range"
          : `${windowed.busiest.count.toLocaleString("en-US")} page visits`,
    },
    {
      key: "busiest-hour",
      label: "Busiest hour",
      recorded: peakHour !== null,
      value:
        peakHour === null ? "No timed activity" : formatHour(peakHour.hour),
      detail:
        peakHour === null
          ? "No hourly data recorded"
          : `${peakHour.count.toLocaleString("en-US")} page visits, local time`,
      aside: <HourSpark hours={windowed.hourTotals} />,
    },
    {
      key: "top-site",
      label: "Most visited site",
      recorded: topSite !== null,
      value: topSite === null ? "No visited sites" : domainOf(topSite.url),
      detail:
        topSite === null
          ? "No saved site visits recorded"
          : `${topSite.count.toLocaleString("en-US")} saved visits`,
    },
    {
      key: "quiet",
      label: "Longest quiet stretch",
      recorded: quietGap !== null,
      value:
        quietGap === null
          ? windowed.days.length === 0
            ? "No dated activity"
            : "No quiet days"
          : `${String(quietGap.days)} day${quietGap.days === 1 ? "" : "s"}`,
      detail:
        quietGap === null
          ? windowed.days.length === 0
            ? "No page visits recorded in range"
            : "No day-long gaps inside the active span"
          : `Between ${formatDay(quietGap.from)} and ${formatDay(quietGap.to)}`,
    },
  ];

  const open = (key: string) =>
    onOpen === undefined
      ? undefined
      : () => {
          onOpen(key);
        };

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

  return (
    <div className="reveal-items flex flex-col gap-5">
      <Masthead
        subjectName={subjectName}
        meta={heroMeta}
        rangeNote={rangeNote}
        picker={
          <DateRangePicker
            from={rangeFrom}
            to={rangeTo}
            min={fullSpan.first}
            max={fullSpan.last}
            triggerLabel={
              spanLabel === null
                ? "Full recorded span"
                : `${spanLabel}  ·  full span`
            }
            formatDate={formatDay}
            onChange={({ from, to }) => {
              setRangeFrom(from);
              setRangeTo(to);
            }}
          />
        }
      />

      <CaseFigures items={figures} />

      <div className="grid grid-cols-12 gap-4">
        {/* Activity — the page's main chart. */}
        <ChartSection
          title="Browsing activity"
          description="Saved page visits per day."
          action={<JumpLink label="History" onOpen={open("history")} />}
          footer={truncationNote}
          className="col-span-12 lg:col-span-8"
        >
          {/* Recharts measures its parent, and a bare flex child resolves to
              zero height — so the plot fills an absolutely positioned box
              inside a `flex-1` content area, and stretches to the grid row's
              real height (set by the Subject panel beside it). */}
          <div className="relative min-h-[240px] flex-1">
            <div className="absolute inset-0 px-2 pt-2 pb-3">
              <ActivityBars days={chartDays} tokens={tokens} />
            </div>
          </div>
        </ChartSection>

        {/* Subject — the full identity readout, beside the activity it
            belongs next to. */}
        <SectionPanel
          id={subjectId}
          title="Subject"
          description="Read from Preferences and Local State."
          aside={<JumpLink label="Metadata" onOpen={open("metadata")} />}
          className="col-span-12 lg:col-span-4"
        >
          <SubjectList
            fields={[
              {
                label: "Account e-mail",
                field: profileMetadata?.fields.accountEmail,
              },
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
                label: "Chrome version",
                field: browserMetadata?.fields.chromeVersion,
              },
              {
                label: "Screen work area",
                field: profileMetadata?.fields.screenWorkArea,
              },
            ]}
          />
        </SectionPanel>

        {/* Top sites + Topic categorization — a matched pair right under
            Activity/Subject. */}
        <SectionPanel
          id={topSitesId}
          title="Top sites"
          description="By saved visits."
          aside={<JumpLink label="Top sites" onOpen={open("top-sites")} />}
          className="col-span-12 md:col-span-6"
        >
          <TopSitesList
            sites={data.mostVisited}
            favicons={data.favicons}
            onOpenSite={
              onOpen === undefined
                ? undefined
                : (domain) => {
                    onOpen("sites", domain);
                  }
            }
          />
        </SectionPanel>

        {/* TODO: still backed by mock data — wire to the real
            topic-candidates / topic-status routes once they exist. */}
        <TopicWidget state={topicState} className="col-span-12 md:col-span-6" />

        {/* Time of day. Coverage lives in the "Readable" figure here, and in
            full as the Evidence coverage panel every artifact page opens
            with. */}
        <ChartSection
          title="Time of day"
          description="Saved page visits by local hour."
          action={<JumpLink label="Timeline" onOpen={open("timeline")} />}
          footer={truncationNote}
          className="col-span-12 md:col-span-6"
        >
          <div className="relative min-h-[220px] flex-1">
            <div className="absolute inset-0 px-2 pt-2 pb-3">
              <HourBars hours={windowed.hourTotals} tokens={tokens} />
            </div>
          </div>
        </ChartSection>

        {/* Recent downloads — paired with Time of day as two even halves. */}
        <SectionPanel
          id={downloadsId}
          title="Recent downloads"
          description="Saved downloads: target file and source, newest first."
          aside={<JumpLink label="Downloads" onOpen={open("downloads")} />}
          className="col-span-12 md:col-span-6"
        >
          <DownloadsList downloads={data.downloads} />
        </SectionPanel>
      </div>
    </div>
  );
}
