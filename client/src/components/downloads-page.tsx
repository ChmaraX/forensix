/**
 * The Downloads page.
 *
 * A dedicated read of the browser's recorded downloads, framed the way an
 * examiner reads them: how much left the machine and when, what kinds of
 * files, and from which sources — then the full row table underneath. Every
 * figure here is a plain reading of fields the evidence already carries
 * (`totalBytes`, `startTime`, `mimeType`, `state`, `originalUrl`); nothing is
 * smoothed, projected, or ranked by a score the rows do not contain.
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
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CloseIcon, SearchIcon } from "@/lib/app-icons";
import { spring } from "@/lib/springs";
import type { ArtifactConfig, Finding } from "../types.js";
import { usePrefersReducedMotion } from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { DateRangePicker } from "./date-range-picker.js";
import { fieldText } from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CommitStateSplit,
  SectionPanel,
  formatBytes,
  formatDay,
  formatDaySpan,
  plural,
  type CommitView,
} from "./page-kit.js";
import {
  useDownloads,
  joinRecovered,
  fileNameOf,
  type FileKind,
  KIND_META,
  type DayRange,
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

/* ---------------------------------- page ---------------------------------- */

export function DownloadsPage({ config }: { readonly config: ArtifactConfig }) {
  const savedRead = useDownloads(config.route, "committed");
  const walRead = useDownloads(config.route, "wal_resident");
  const journalRead = useDownloads(config.route, "journal_resident");
  const recoveredRead = joinRecovered(walRead, journalRead);
  const reduced = usePrefersReducedMotion();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | null>(null);
  const [range, setRange] = useState<DayRange>({ from: "", to: "" });
  const [sort, setSort] = useState<SortState>({ key: "started", dir: "desc" });

  // Clicking a file kind (or picking a day range) narrows the table that sits
  // below the fold on a tall monitor; without this the table would change
  // silently. A brief focus-ring pulse plus a scroll-into-view draws the eye
  // down. The ring springs in and, once its spring settles, springs out —
  // no hand-written timer.
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(0);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (pulse === 0) {
      return;
    }
    setPulsing(true);
    tableRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
    });
  }, [pulse, reduced]);
  const focusTable = useCallback(() => {
    setPulse((value) => value + 1);
  }, []);

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

  // The date range narrows the figures and the file kinds as it narrows
  // the lists; the chart keeps drawing every day, the range washed in.
  const modelInRange = useMemo(
    () =>
      hasRange
        ? model.filter((row) => {
            if (row.startUtc === null) {
              return false;
            }
            const day = row.startUtc.slice(0, 10);
            return (
              (range.from === "" || day >= range.from) &&
              (range.to === "" || day <= range.to)
            );
          })
        : model,
    [model, hasRange, range],
  );

  const summary = useMemo(() => {
    let bytes = 0;
    let sized = 0;
    let unfinished = 0;
    const hosts = new Set<string>();
    let firstUtc: string | null = null;
    let lastUtc: string | null = null;
    for (const row of modelInRange) {
      if (row.bytes !== null) {
        bytes += row.bytes;
        sized += 1;
      }
      if (isUnfinished(row.state)) {
        unfinished += 1;
      }
      if (row.host !== null) {
        hosts.add(row.host);
      }
      if (row.startUtc !== null) {
        if (firstUtc === null || row.startUtc < firstUtc) {
          firstUtc = row.startUtc;
        }
        if (lastUtc === null || row.startUtc > lastUtc) {
          lastUtc = row.startUtc;
        }
      }
    }
    return {
      total: modelInRange.length,
      bytes,
      sized,
      unfinished,
      hosts: hosts.size,
      firstUtc,
      lastUtc,
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
        if (hasRange) {
          const day = row.startUtc?.slice(0, 10) ?? null;
          if (
            day === null ||
            (range.from !== "" && day < range.from) ||
            (range.to !== "" && day > range.to)
          ) {
            return false;
          }
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
    [search, kindFilter, hasRange, range, sort],
  );
  const visibleSaved = useMemo(() => narrow(model), [narrow, model]);
  const visibleRecovered = useMemo(
    () => narrow(recoveredModel),
    [narrow, recoveredModel],
  );
  const filtered = search.trim() !== "" || kindFilter !== null || hasRange;

  const select = useCallback((finding: Finding) => {
    setSelected({ kind: "finding", row: finding });
  }, []);

  const spanLabel =
    summary.firstUtc === null || summary.lastUtc === null
      ? undefined
      : formatDaySpan(
          summary.firstUtc.slice(0, 10),
          summary.lastUtc.slice(0, 10),
        );

  // The date picker spans every dated download, saved or recovered: its
  // range filters both lists.
  const pickerSpan = useMemo(() => {
    const days = [...model, ...recoveredModel]
      .flatMap((row) => (row.startUtc === null ? [] : [row.startUtc]))
      .sort();
    return {
      min: days[0]?.slice(0, 10) ?? null,
      max: days[days.length - 1]?.slice(0, 10) ?? null,
    };
  }, [model, recoveredModel]);

  const recoveredTotal = recoveredRead.rows?.length ?? null;

  const clearAll = useCallback(() => {
    setKindFilter(null);
    setRange({ from: "", to: "" });
    setSearch("");
  }, []);

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
            {!savedRead.complete ? (
              <Banner status="warning" contrast="high">
                <BannerTitle>These figures cover part of the Case.</BannerTitle>
                <BannerDescription>
                  They cover the first {model.length.toLocaleString("en-US")}{" "}
                  saved downloads read - the most this page loads at once. More
                  rows exist in the Case.
                </BannerDescription>
              </Banner>
            ) : null}

            <MetricBand className="grid-cols-2 lg:grid-cols-4">
              <MetricBandItem
                label="Saved downloads"
                value={summary.total.toLocaleString("en-US")}
                detail={spanLabel}
              />
              <MetricBandItem
                label="Data transferred"
                value={formatBytes(summary.bytes)}
                detail={
                  summary.sized === summary.total
                    ? undefined
                    : `across ${plural(summary.sized, "sized row", "sized rows")}`
                }
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
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
              <ChartSection
                title="Downloads over time"
                className="lg:col-span-2"
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
                    rows={model}
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
            savedCount={savedRead.rows === null ? null : model.length}
            recoveredCount={recoveredTotal}
            savedMore={!savedRead.complete}
            recoveredMore={!recoveredRead.complete}
            toolbar={
              <>
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
                <SortControls sort={sort} onSort={setSort} />
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
                recovered={false}
                filtered={filtered}
                onSelect={select}
                onClearFilters={clearAll}
              />
            }
            recovered={
              <DownloadList
                read={recoveredRead}
                rows={visibleRecovered}
                recovered
                filtered={filtered}
                onSelect={select}
                onClearFilters={clearAll}
              />
            }
          />
        </SectionPanel>
        <AnimatePresence>
          {pulsing ? (
            <motion.span
              key={pulse}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-focus-ring"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.slow.exit }}
              transition={spring.slow}
              onAnimationComplete={() => {
                setPulsing(false);
              }}
            />
          ) : null}
        </AnimatePresence>
      </div>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            fileNameOf(fieldText(selected.row.fields.targetPath)) ?? "Download"
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
