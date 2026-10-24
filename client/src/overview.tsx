/**
 * Overview — the Case at a glance.
 *
 * The page answers an examiner's first question before anything else: whose
 * browser is this (the subject fields, read from Metadata Findings). Every
 * other panel — activity, time of day, most visited sites, downloads — is
 * derived analyzer output. Nothing here is invented: a Metadata value renders
 * through the same Field State text every list page uses, so `absent` and
 * `unavailable` stay visibly distinct from a value. The one Candidate-backed
 * panel (Topic categorization) is labelled Candidate and never feeds a
 * figure.
 *
 * Presentation is Fluid Functionalism throughout: an unframed masthead on
 * the page substrate (the shell renders no page header here), one
 * `MetricBand` of four figures, `ChartSection` for the two charts and
 * `SectionPanel` for the rest, FF ghost buttons for the jump links, and
 * `reveal-swap` for the load.
 *
 * Saved and recovered rows: every figure and chart counts saved rows only
 * (Most visited sites and Recent downloads read `commit-state=committed`; the
 * shared activity read keeps recovered rows apart). The two charts carry a
 * "Saved only" tag naming how many recovered visits they leave out.
 */
import { useEffect, useId, useMemo, useState } from "react";

import {
  bucketsToDays,
  bucketsToHourTotals,
  fillGaps,
} from "@/components/activity-data";
import { ActivityBars, HourBars, useChartTokens } from "@/components/charts";
import { ChartSection } from "@/components/chart-section";
import { DateRangePicker } from "@/components/date-range-picker";
import { ErrorRows } from "@/components/list-states";
import { plural, SectionPanel } from "@/components/page-kit";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";

// Topic categorization: a one-line "unavailable" state with an "enable the
// model" Sheet, until the topic-status route exists.
import { TopicCategorizationLine } from "./overview-topic-widget.js";
import {
  fieldString,
  formatDay,
  formatDayRange,
  formatSpan,
  loadOverview,
  shiftDay,
  type OverviewData,
} from "./overview/data";
import {
  CaseFigures,
  DownloadsList,
  JumpLink,
  LoadingOverview,
  Masthead,
  SavedOnlyTag,
  SubjectList,
  TopSitesList,
  type CaseFigure,
} from "./overview/parts";

export function OverviewPage({
  onOpen,
}: {
  /** Opens a nav section by key — the per-panel jump links in panel headers,
   *  and the Most visited sites row click, which passes a second argument:
   *  the host to preselect once the Sites tab is open. */
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
    return { days, hourTotals, totalVisits, recoveredVisits };
  }, [data, rangeFrom, rangeTo]);

  // The same days, continuous: zero-count days fill the gaps between them so
  // the chart's x-axis is real calendar time — the same shared reading
  // History's and Timeline's "page visits per day" charts draw.
  const chartDays = useMemo(() => fillGaps(windowed.days), [windowed.days]);

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
  // it is itself data (the quiet stretch's dates). A Case (or range) with
  // nothing of that shape says so in words, muted, rather than hiding the
  // reading. Everything read from `activity` counts saved visits only.
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
          : plural(quietGap.days, "day", "days"),
      detail:
        quietGap === null
          ? undefined
          : formatDayRange(quietGap.from, quietGap.to),
    },
    {
      key: "profiles",
      label: data.profiles.length === 1 ? "Profile" : "Profiles",
      value: data.profiles.length,
      recorded: true,
      valueTooltip:
        data.profiles.length === 0 ? undefined : data.profiles.join(", "),
    },
  ];

  const open = (key: string) =>
    onOpen === undefined
      ? undefined
      : () => {
          onOpen(key);
        };

  // Both charts plot saved visits only; the tag says how many recovered
  // visits they leave out, and is absent when there are none.
  const savedOnly =
    windowed.recoveredVisits > 0 ? (
      <SavedOnlyTag
        note={`${plural(windowed.recoveredVisits, "recovered visit", "recovered visits")} not drawn`}
      />
    ) : null;

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
        picker={
          <DateRangePicker
            size="compact"
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
          description=""
          action={
            <>
              {savedOnly}
              <JumpLink label="History" onOpen={open("history")} />
            </>
          }
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

        {/* Subject — the identity readout, beside the activity it belongs
            next to. E-mail and Chrome version already read in the masthead. */}
        <SectionPanel
          id={subjectId}
          title="Subject"
          aside={<JumpLink label="Metadata" onOpen={open("metadata")} />}
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

        <ChartSection
          title="Time of day"
          description=""
          action={
            <>
              {savedOnly}
              <JumpLink label="Timeline" onOpen={open("timeline")} />
            </>
          }
          footer={truncationNote}
          className="col-span-12 md:col-span-6"
        >
          <div className="relative min-h-[220px] flex-1">
            <div className="absolute inset-0 px-2 pt-2 pb-3">
              <HourBars hours={windowed.hourTotals} tokens={tokens} />
            </div>
          </div>
        </ChartSection>

        {/* Ranked by this Case's saved History visits — not Chrome's own
            Top sites ranking — so it opens History. */}
        <SectionPanel
          id={topSitesId}
          title="Most visited sites"
          aside={<JumpLink label="History" onOpen={open("history")} />}
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

        <SectionPanel
          id={downloadsId}
          title="Recent downloads"
          aside={<JumpLink label="Downloads" onOpen={open("downloads")} />}
          className="col-span-12"
        >
          <DownloadsList downloads={data.downloads} />
        </SectionPanel>

        {/* TODO: wire to the real topic-candidates / topic-status routes
            once they exist; until then the panel states it is unavailable. */}
        <TopicCategorizationLine className="col-span-12" />
      </div>
    </div>
  );
}
