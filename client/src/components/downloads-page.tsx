/**
 * The Downloads page.
 *
 * A dedicated read of the browser's recorded downloads, framed the way an
 * examiner reads them: how much arrived and when, what kinds of files, and
 * from which sources — then the full row table underneath. Every figure
 * here is a plain reading of fields the evidence already carries
 * (`receivedBytes`, `totalBytes`, `startTime`, `mimeType`, `state`,
 * `originalUrl`); nothing is smoothed, projected, or ranked by a score the
 * rows do not contain. Sizes never overstate: figures, bars and kinds sum
 * the bytes Chrome recorded as received; the expected size (`totalBytes`)
 * only ever sits beside them, named "expected".
 *
 * The date range and the profile pick are the Case-wide lens
 * (`useViewRange` / `useViewProfiles`, in Case days); the open row, the
 * Saved / Recovered tab and the lens live in the URL, so Back and a
 * refresh restore the view.
 *
 * Layout, top-down, as FF Panels: a MetricBand of recorded figures (label
 * and value; the span's dates are the one data line) → bytes per day (the
 * one series style: ink bars, the peak — or a picked day — at full strength;
 * it drives the page's date range with its picker: click a day, again to
 * clear, drag for a span; the figures, kinds and lists follow) beside the
 * file kinds (an FF
 * CardGroup: one fluid hover highlight, a picked kind holds the selected
 * fill and focuses the lists) → the lists, sorted from the toolbar (Sort +
 * direction, as on History) and drawn by `ResponsiveRows` (a table from
 * `sm`, stacked cards below).
 *
 * Presentation rules kept (see app.tsx's header): the Completeness Statement
 * (the shell's indicator) sits by the title, before any row; download
 * outcomes are worded, never colour alone; a field without a recorded value
 * reads as its own state word; TYPE — here the file-kind column — comes
 * first in the table; the Commit State word appears in the Recovered list
 * only (every saved row would say "saved"). This page is read-only: it
 * starts no ingest, reruns no analysis, and writes nothing back to the Case.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { ARTIFACTS } from "../artifacts.js";
import type { RowLookupSource } from "../row-lookup.js";

import {
  updateView,
  useRowSelection,
  useViewProfiles,
  useViewRange,
  useViewSearch,
  useViewTab,
} from "../view-state.js";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CloseIcon, SearchIcon } from "@/lib/app-icons";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { caseDayOf, inCaseDays, zonesNote } from "./day-bounds.js";
import { CompactFilters, FilterTextField, ProfilePicker } from "./filters.js";
import { DrainNote, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet } from "./row-sheet.js";
import { CommitStateSplit, SectionPanel, plural } from "./page-kit.js";
import {
  useDownloads,
  joinRecovered,
  fileNameOf,
  type FileKind,
  KIND_META,
  type SortState,
  type DownloadRow,
  toRow,
  isUnfinished,
  compareRows,
} from "./downloads-model.js";
import { VolumeChart, KindBreakdown } from "./downloads-widgets.js";
import {
  SortControls,
  DownloadsLoading,
  DownloadList,
} from "./downloads-table.js";
import { fieldText } from "../field-readers.js";
import { formatBytes } from "./bytes.js";
import { formatDay, formatDaySpan } from "../day-format.js";

/* ---------------------------------- page ---------------------------------- */

const config = ARTIFACTS.downloads;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function DownloadsPage() {
  const savedRead = useDownloads(config.route, "committed");
  const walRead = useDownloads(config.route, "wal_resident");
  const journalRead = useDownloads(config.route, "journal_resident");
  const recoveredRead = joinRecovered(walRead, journalRead);
  const reduced = usePrefersReducedMotion();
  // Saved / Recovered lives in the URL (`tab`): Back and a refresh keep it.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  const [kindFilter, setKindFilter] = useState<FileKind | null>(null);
  // The Case-wide lens: the range (Case days) and the profile pick.
  const [range, setRange] = useViewRange();
  const [profiles, setProfiles] = useViewProfiles();
  // Days are Case days: each download buckets and filters on the clock its
  // own start time declares (`row.startZone`), with no wait for History.
  const [sort, setSort] = useState<SortState>({ key: "started", dir: "desc" });

  // Clicking a file kind narrows the table, which can sit below the fold on
  // a tall monitor: it is scrolled into view (only when out of it), and its
  // rows re-reveal - the list's own motion, no extra highlight.
  const tableRef = useRef<HTMLDivElement | null>(null);
  const focusTable = useCallback(() => {
    tableRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
    });
  }, [reduced]);

  const onKind = useCallback(
    (kind: FileKind | null) => {
      setKindFilter(kind);
      if (kind !== null) {
        focusTable();
      }
    },
    [focusTable],
  );

  const hasRange = range.from !== "" || range.to !== "";
  const hasProfiles = profiles.length > 0;

  // Figures, chart, kinds and sources count saved rows only; recovered rows
  // are their own list below, never summed in.
  const model = useMemo(
    () => (savedRead.rows ?? []).map(toRow),
    [savedRead.rows],
  );
  const recoveredModel = useMemo(
    () =>
      walRead.rows === null || journalRead.rows === null
        ? []
        : [...walRead.rows, ...journalRead.rows].map(toRow),
    [walRead.rows, journalRead.rows],
  );

  // The open row lives in the URL: Back and a refresh re-open it.
  const loadedFindings = useMemo(
    () => [
      ...(savedRead.rows ?? []),
      ...(walRead.rows ?? []),
      ...(journalRead.rows ?? []),
    ],
    [savedRead.rows, walRead.rows, journalRead.rows],
  );
  const sheet = useRowSelection(loadedFindings, ROW_LOOKUP);
  const sheetSelect = sheet.select;
  const select = useCallback(
    (row: DownloadRow) => {
      sheetSelect(row.finding);
    },
    [sheetSelect],
  );

  // The profiles the picker offers: every profile a loaded download names,
  // plus any the lens holds (so a pick from another page can be undone).
  const profileOptions = useMemo(
    () =>
      [
        ...new Set([
          ...[...model, ...recoveredModel].map((row) => row.finding.profile),
          ...profiles,
        ]),
      ].sort(),
    [model, recoveredModel, profiles],
  );
  const inProfiles = useCallback(
    (row: DownloadRow) =>
      !hasProfiles || profiles.includes(row.finding.profile),
    [hasProfiles, profiles],
  );

  // The date range and the profile pick narrow the figures and the file
  // kinds as they narrow the lists; the chart keeps drawing every day of
  // the picked profiles, the range washed in.
  const modelInProfiles = useMemo(
    () => (hasProfiles ? model.filter(inProfiles) : model),
    [model, hasProfiles, inProfiles],
  );
  const modelInRange = useMemo(
    () =>
      hasRange
        ? modelInProfiles.filter((row) =>
            inCaseDays(row.startUtc, range, row.startZone),
          )
        : modelInProfiles,
    [modelInProfiles, hasRange, range],
  );

  const summary = useMemo(() => {
    let received = 0;
    let receivedRows = 0;
    let expected = 0;
    let unfinished = 0;
    const hosts = new Set<string>();
    let firstDay: string | null = null;
    let lastDay: string | null = null;
    for (const row of modelInRange) {
      if (row.received !== null) {
        received += row.received;
        receivedRows += 1;
      }
      // What the rows expected, over the rows that record both: the
      // "of …" beside the received figure compares like with like.
      if (row.received !== null && row.expected !== null) {
        expected += Math.max(row.expected, row.received);
      }
      if (isUnfinished(row.state)) {
        unfinished += 1;
      }
      if (row.host !== null) {
        hosts.add(row.host);
      }
      const day = caseDayOf(row.startUtc, row.startZone);
      if (day !== null) {
        if (firstDay === null || day < firstDay) {
          firstDay = day;
        }
        if (lastDay === null || day > lastDay) {
          lastDay = day;
        }
      }
    }
    return {
      total: modelInRange.length,
      received,
      receivedRows,
      expected,
      unfinished,
      hosts: hosts.size,
      firstDay,
      lastDay,
    };
  }, [modelInRange]);

  // The same filters and sort narrow both lists.
  const narrow = useCallback(
    (rows: readonly DownloadRow[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      const rowsInScope = rows.filter((row) => {
        if (kindFilter !== null && row.kind !== kindFilter) {
          return false;
        }
        if (!inProfiles(row)) {
          return false;
        }
        if (hasRange && !inCaseDays(row.startUtc, range, row.startZone)) {
          return false;
        }
        if (query === "") {
          return true;
        }
        const haystack = [row.name ?? "", row.path ?? "", row.sourceUrl ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
      return [...rowsInScope].sort((left, right) => {
        const order = compareRows(left, right, sort.key);
        return sort.dir === "asc" ? order : -order;
      });
    },
    [search, kindFilter, hasRange, range, sort, inProfiles],
  );
  const visibleSaved = useMemo(() => narrow(model), [narrow, model]);
  // The tabs and footers count the rows in the lens (range, profiles) -
  // the same base the figures use - so a day reads "Saved 1 · 1 of 1",
  // never an all-days total beside one row.
  const recoveredInLens = useMemo(
    () =>
      recoveredModel.filter(
        (row) =>
          inProfiles(row) &&
          (!hasRange || inCaseDays(row.startUtc, range, row.startZone)),
      ),
    [recoveredModel, inProfiles, hasRange, range],
  );
  const visibleRecovered = useMemo(
    () => narrow(recoveredModel),
    [narrow, recoveredModel],
  );
  const filtered =
    search.trim() !== "" || kindFilter !== null || hasRange || hasProfiles;

  // An empty filtered list names what narrowed it: the days alone read
  // "No saved downloads on 12 Mar 2024.", never a vague "no matches".
  const describe = useCallback(
    (noun: string, others: boolean) => {
      const days =
        range.from !== "" && range.to !== ""
          ? range.from === range.to
            ? `on ${formatDay(range.from)}`
            : `in ${formatDaySpan(range.from, range.to)}`
          : null;
      if (days === null) {
        return `No ${noun} match these filters.`;
      }
      return others
        ? `No ${noun} ${days} match these filters.`
        : `No ${noun} ${days}.`;
    },
    [range],
  );
  const filteredMessage = (noun: string) =>
    describe(noun, search.trim() !== "" || kindFilter !== null || hasProfiles);
  // The file kinds follow the lens only (range, profiles).
  const lensEmptyMessage = (noun: string) => describe(noun, hasProfiles);

  const spanLabel =
    summary.firstDay === null || summary.lastDay === null
      ? undefined
      : formatDaySpan(summary.firstDay, summary.lastDay);

  // The date picker spans every dated download, saved or recovered: its
  // range filters both lists.
  const pickerSpan = useMemo(() => {
    const days = [...model, ...recoveredModel]
      .flatMap((row) => {
        const day = caseDayOf(row.startUtc, row.startZone);
        return day === null ? [] : [day];
      })
      .sort();
    return {
      min: days[0] ?? null,
      max: days[days.length - 1] ?? null,
    };
  }, [model, recoveredModel]);
  // The rows' own zones: more than one gets one quiet line under the chart.
  const zoneNote = useMemo(
    () =>
      zonesNote(
        [...model, ...recoveredModel].flatMap((row) =>
          row.startUtc === null ? [] : [row.startZone],
        ),
      ),
    [model, recoveredModel],
  );

  const clearAll = useCallback(() => {
    setKindFilter(null);
    // The search, the range and the profiles in one history entry.
    updateView({ q: null, from: "", to: "", profiles: [] });
  }, []);

  const receivedDetail = [
    summary.expected > summary.received
      ? `of ${formatBytes(summary.expected)} expected`
      : null,
    summary.receivedRows === summary.total
      ? null
      : `${summary.receivedRows.toLocaleString("en-US")} of ${plural(summary.total, "row", "rows")} record it`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <div className="flex flex-col gap-5">
      {/* The overview reads the saved downloads only; when that read
          failed it steps aside and the Saved tab carries the error. */}
      {savedRead.error !== null ? null : (
        <RevealSwap
          loading={savedRead.rows === null}
          skeleton={<DownloadsLoading pages={savedRead.pages} />}
        >
          <div className="flex flex-col gap-5">
            {!savedRead.complete && !savedRead.draining ? (
              <Banner status="warning" contrast="high">
                <BannerTitle>These figures cover part of the Case.</BannerTitle>
                <BannerDescription>
                  They cover the first {model.length.toLocaleString("en-US")}{" "}
                  saved downloads read - the most this page loads at once. More
                  rows exist in the Case.
                </BannerDescription>
              </Banner>
            ) : null}

            <DrainNote
              draining={savedRead.draining && savedRead.error === null}
              message={`Reading the rest of the saved downloads - ${model.length.toLocaleString("en-US")} read so far. The figures grow as rows arrive.`}
            />
            <MetricBand className="grid-cols-2 lg:grid-cols-4">
              <MetricBandItem
                label="Saved downloads"
                value={`${summary.total.toLocaleString("en-US")}${savedRead.draining ? "+" : ""}`}
                detail={spanLabel}
              />
              <MetricBandItem
                label="Data received"
                value={formatBytes(summary.received)}
                detail={receivedDetail === "" ? undefined : receivedDetail}
              />
              <MetricBandItem
                label="Source hosts"
                value={summary.hosts.toLocaleString("en-US")}
              />
              <MetricBandItem
                label="Did not finish"
                value={summary.unfinished.toLocaleString("en-US")}
              />
            </MetricBand>

            {/* Volume over time beside the file kinds. Dragging across the
                bars (or picking a range) and picking a kind both focus the
                lists below; the picker carries its own clear. */}
            {/* The two panels share one height (the row's), so their
                bottoms line up whatever the range leaves in the kinds. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ChartSection
                title="Data received per day"
                className="lg:col-span-2"
                footer={
                  zoneNote === null ? undefined : (
                    <p
                      className={cn(
                        typeClass("caption"),
                        "text-muted-foreground",
                      )}
                    >
                      {zoneNote}
                    </p>
                  )
                }
                action={
                  <DateRangePicker
                    from={range.from}
                    to={range.to}
                    min={pickerSpan.min}
                    max={pickerSpan.max}
                    triggerLabel="All recorded days"
                    formatDate={formatDay}
                    onChange={setRange}
                    presets
                  />
                }
              >
                <div className="px-2 pt-2 pb-3">
                  <VolumeChart
                    rows={modelInProfiles}
                    range={range}
                    onRangeChange={setRange}
                  />
                </div>
              </ChartSection>
              <SectionPanel id="downloads-kinds-title" title="By file kind">
                <KindBreakdown
                  rows={modelInRange}
                  activeKind={kindFilter}
                  onKind={onKind}
                  emptyMessage={
                    hasRange || hasProfiles
                      ? lensEmptyMessage("saved downloads")
                      : undefined
                  }
                />
              </SectionPanel>
            </div>
          </div>
        </RevealSwap>
      )}

      {/* The raw rows, saved and recovered as separate reads. */}
      <div ref={tableRef} className="relative scroll-mt-4">
        <SectionPanel id="downloads-all-title" title="All downloads">
          <CommitStateSplit
            value={view}
            onValueChange={setView}
            label="Saved or recovered downloads"
            savedCount={savedRead.rows === null ? null : modelInRange.length}
            recoveredCount={
              recoveredRead.rows === null ? null : recoveredInLens.length
            }
            savedMore={!savedRead.complete}
            recoveredMore={!recoveredRead.complete}
            toolbar={
              <>
                <CompactFilters
                  active={
                    (kindFilter === null ? 0 : 1) +
                    (profiles.length > 0 ? 1 : 0)
                  }
                >
                  {kindFilter !== null ? (
                    <Button
                      variant="tertiary"
                      trailingIcon={CloseIcon}
                      aria-label={`File kind: ${KIND_META[kindFilter].label}. Clear the file-kind filter`}
                      onClick={() => {
                        setKindFilter(null);
                      }}
                    >
                      {KIND_META[kindFilter].label}
                    </Button>
                  ) : null}
                  {profileOptions.length > 1 ? (
                    <ProfilePicker
                      id="downloads-profiles"
                      profiles={profileOptions}
                      selected={profiles}
                      onChange={setProfiles}
                    />
                  ) : null}
                  <SortControls sort={sort} onSort={setSort} />
                </CompactFilters>
                <FilterTextField
                  id="downloads-search"
                  commit="change"
                  label="Search loaded downloads"
                  icon={SearchIcon}
                  value={search}
                  placeholder="Search file, path, or source…"
                  onCommit={setSearch}
                />
              </>
            }
            saved={
              <DownloadList
                read={savedRead}
                rows={visibleSaved}
                total={modelInRange.length}
                recovered={false}
                filtered={filtered}
                filteredMessage={filteredMessage("saved downloads")}
                onSelect={select}
                onClearFilters={clearAll}
              />
            }
            recovered={
              <DownloadList
                read={recoveredRead}
                rows={visibleRecovered}
                total={recoveredInLens.length}
                recovered
                filtered={filtered}
                filteredMessage={filteredMessage("recovered downloads")}
                onSelect={select}
                onClearFilters={clearAll}
              />
            }
          />
        </SectionPanel>
      </div>

      {sheet.selected !== null ? (
        <RowSheet
          selected={sheet.selected}
          title={
            fileNameOf(fieldText(sheet.selected.row.fields.targetPath)) ??
            "Download"
          }
          onClose={sheet.close}
        />
      ) : null}
    </div>
  );
}
