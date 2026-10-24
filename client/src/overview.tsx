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
 * the page substrate (the shell renders no page header here), `Panel`
 * surfaces for every section, FF ghost buttons for the jump links, one fluid
 * hover highlight on the Top sites list, and `reveal-swap` for the load.
 */
import { useEffect, useMemo, useState } from "react";

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
import { DateRangePicker } from "@/components/date-range-picker";
import { Panel } from "@/components/panel";
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
  DownloadsList,
  HighlightsBand,
  HourSpark,
  LoadingOverview,
  Masthead,
  SectionHeader,
  SubjectList,
  TopSitesList,
  type Highlight,
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

  if (error !== null) {
    return (
      <Banner status="error" contrast="high">
        <BannerTitle>The overview could not be loaded</BannerTitle>
        <BannerDescription>{error}</BannerDescription>
      </Banner>
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
  const fullSpan = useMemo(() => {
    const { first, last } = data.recordedSpan;
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

  // The highlights: each a plain reading of a number the page already
  // computed above, never a new query. A Case (or range) with nothing of
  // that shape says so in a muted state, not by hiding the reading.
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
  const highlights: readonly Highlight[] = [
    {
      label: "Busiest day",
      recorded: windowed.busiest !== null,
      value:
        windowed.busiest === null
          ? "No dated activity"
          : formatDay(windowed.busiest.date),
      note:
        windowed.busiest === null
          ? "No page visits recorded in range."
          : `${windowed.busiest.count.toLocaleString("en-US")} page visits`,
    },
    {
      label: "Busiest hour",
      recorded: peakHour !== null,
      value:
        peakHour === null ? "No timed activity" : formatHour(peakHour.hour),
      note:
        peakHour === null
          ? "No hourly data recorded."
          : `${peakHour.count.toLocaleString("en-US")} page visits, local time`,
      aside: <HourSpark hours={windowed.hourTotals} />,
    },
    {
      label: "Most visited site",
      recorded: topSite !== null,
      value: topSite === null ? "No visited sites" : domainOf(topSite.url),
      note:
        topSite === null
          ? "No sites recorded yet."
          : `${topSite.count.toLocaleString("en-US")} recorded visits`,
    },
    {
      label: "Longest quiet stretch",
      recorded: quietGap !== null,
      value:
        quietGap === null
          ? windowed.days.length === 0
            ? "No dated activity"
            : "No quiet days"
          : `${String(quietGap.days)} day${quietGap.days === 1 ? "" : "s"}`,
      note:
        quietGap === null
          ? windowed.days.length === 0
            ? "No page visits recorded in range."
            : "No day-long gaps inside the active span."
          : `No visits between ${formatDay(quietGap.from)} and ${formatDay(quietGap.to)}`,
    },
  ];

  const open = (key: string) =>
    onOpen === undefined
      ? undefined
      : () => {
          onOpen(key);
        };

  return (
    <div className="reveal-items flex flex-col gap-6">
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
        visits={windowed.totalVisits}
        activeDays={windowed.days.length}
        readable={{
          label: (
            <Term
              label="Readable"
              technical="Completeness Statement: produced / attempted"
            >
              Share of this Case&apos;s artifacts the analyzer could read. Each
              artifact page lists what was and was not read.
            </Term>
          ),
          value:
            coverage.attempted === 0
              ? "—"
              : `${String(Math.round((coverage.produced / coverage.attempted) * 100))}%`,
          note:
            coverage.attempted === 0
              ? "no artifacts attempted"
              : `${String(coverage.produced)} of ${String(coverage.attempted)} artifacts`,
        }}
        profiles={data.profiles}
      />

      <HighlightsBand items={highlights} />

      <div className="grid grid-cols-12 gap-4">
        {/* Activity — the page's main chart. */}
        <Panel className="col-span-12 overflow-hidden lg:col-span-8">
          <SectionHeader
            title="Browsing activity"
            description="Page visits recorded in this Case, per day."
            linkLabel="History"
            onOpen={open("history")}
          />
          {truncated ? (
            <div className="px-4 pt-1 pb-2">
              <Banner status="warning" contrast="high" size="compact">
                <BannerTitle>
                  These charts stop short of the full recorded span
                </BannerTitle>
                <BannerDescription>
                  The recorded span is {spanLabel ?? "undated"}; the charts
                  cover only {chartsCoverLabel}, the most this page could read.
                </BannerDescription>
              </Banner>
            </div>
          ) : null}
          {/* Recharts measures its parent, and a bare flex child resolves to
              zero height — so the plot fills an absolutely positioned box
              inside a `flex-1` content area, and stretches to the grid row's
              real height (set by the Subject panel beside it). */}
          <div className="relative min-h-[240px] flex-1">
            <div className="absolute inset-0 pt-2 pr-4 pb-3 pl-2">
              <ActivityBars days={chartDays} tokens={tokens} />
            </div>
          </div>
        </Panel>

        {/* Subject — the full identity readout, beside the activity it
            belongs next to. */}
        <Panel className="col-span-12 lg:col-span-4">
          <SectionHeader
            title="Subject"
            description="Read from Preferences and Local State."
            linkLabel="Metadata"
            onOpen={open("metadata")}
          />
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
        </Panel>

        {/* Top sites + Topic categorization — a matched pair right under
            Activity/Subject. */}
        <Panel className="col-span-12 md:col-span-6">
          <SectionHeader
            title="Top sites"
            description="By recorded visits."
            linkLabel="Top sites"
            onOpen={open("top-sites")}
          />
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
        </Panel>

        {/* TODO: still backed by mock data — wire to the real
            topic-candidates / topic-status routes once they exist. */}
        <TopicWidget state={topicState} className="col-span-12 md:col-span-6" />

        {/* Time of day. Coverage lives in the masthead's "Readable" figure
            here, and in full as the Evidence coverage panel every artifact
            page opens with. */}
        <Panel className="col-span-12 overflow-hidden md:col-span-6">
          <SectionHeader
            title="Time of day"
            description="When the visits happened, by local hour."
            linkLabel="Timeline"
            onOpen={open("timeline")}
          />
          <div className="relative min-h-[220px] flex-1">
            <div className="absolute inset-0 pt-2 pr-4 pb-3 pl-2">
              <HourBars hours={windowed.hourTotals} tokens={tokens} />
            </div>
          </div>
        </Panel>

        {/* Recent downloads — paired with Time of day as two even halves. */}
        <Panel className="col-span-12 md:col-span-6">
          <SectionHeader
            title="Recent downloads"
            description="Target file and source, newest first."
            linkLabel="Downloads"
            onOpen={open("downloads")}
          />
          <DownloadsList downloads={data.downloads} />
        </Panel>
      </div>
    </div>
  );
}
