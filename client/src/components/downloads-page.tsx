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
 * drag across it to focus the lists on a range; a "Saved only" tag names
 * the recovered downloads it leaves out) beside the file kinds (an FF
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
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type MouseHandlerDataParam,
} from "recharts";

import { EvidenceDot } from "@/components/evidence";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
  CardGroup,
  CardHeader,
  CardMedia,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip as FluidTooltip } from "@/components/ui/tooltip";
import {
  CloseIcon,
  DownloadedFileIcon,
  FILE_KIND_ICONS,
  SearchIcon,
  SortNewestIcon,
  SortOldestIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { SizeProvider, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type {
  ArtifactConfig,
  CommitState,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import {
  activeIndexOf,
  CHART_FOCUS_CLASS,
  chartAnimation,
  chartAxis,
  chartGrid,
  ChartEmpty,
  ChartTooltipCard,
  chartTooltipMotion,
  ChartTooltipNote,
  ChartTooltipValue,
  chartRange,
  FluidBandCursor,
  SeriesBar,
  seriesColor,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
} from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { EmptyRows } from "./data-table.js";
import { DateRangePicker } from "./date-range-picker.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField } from "./filters.js";
import { formatDaySpan, SavedOnlyTag } from "./history-chart-parts.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CARD_TITLE_CLEAR,
  CHART_HEIGHT,
  CommitStateSplit,
  ResponsiveRows,
  SectionPanel,
  ShareBar,
  TimeCell,
  formatBytes,
  formatDay,
  formatDayTick,
  plural,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";

/* --------------------------------- reads ---------------------------------- */

/** Above this many pages the read stops; the page then says it is partial. */
const DOWNLOADS_PAGE_CAP = 150;

/**
 * Reads every download row of one Commit State (up to the page cap), newest
 * first. The real API paginates; the read follows the cursor until it runs
 * out, so the aggregates below cover the whole Case rather than one page.
 * `complete` is false only when the cap was hit before the cursor did. Each
 * Commit State is its own server read (forensic rule 4): saved rows never
 * mix with WAL- or journal-resident ones.
 */
function useDownloads(route: string, commitState: CommitState) {
  const [rows, setRows] = useState<readonly Finding[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    setPages(0);
    (async () => {
      const collected: Finding[] = [];
      let after: string | null = null;
      let ran = true;
      for (let page = 0; page < DOWNLOADS_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["sort", "start-time"],
          ["direction", "desc"],
          ["limit", "100"],
          ["commit-state", commitState],
        ];
        if (after !== null) {
          parameters.push(["after", after]);
        }
        const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
          route,
          parameters,
        );
        collected.push(...result.items);
        after = result.nextCursor;
        if (!cancelled) {
          setPages(page + 1);
        }
        if (after === null) {
          ran = false;
          break;
        }
      }
      if (cancelled) {
        return;
      }
      setRows(collected);
      setComplete(!ran || after === null);
    })().catch((requestError: unknown) => {
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
  }, [route, commitState, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, complete, error, pages, retry };
}

type DownloadsRead = ReturnType<typeof useDownloads>;

/** The recovered downloads: the WAL read, then the journal read, joined in
 *  that order (never interleaved). Ready only when both reads landed. */
function joinRecovered(wal: DownloadsRead, journal: DownloadsRead) {
  return {
    rows:
      wal.rows === null || journal.rows === null
        ? null
        : [...wal.rows, ...journal.rows],
    complete: wal.complete && journal.complete,
    error: wal.error ?? journal.error,
    retry: () => {
      if (wal.error !== null) {
        wal.retry();
      }
      if (journal.error !== null) {
        journal.retry();
      }
    },
  };
}

/* ------------------------------- formatting ------------------------------- */

/** The plain filename an examiner scans for — the last path segment. The full
 *  path stays byte-for-byte in the row detail sheet; this never rewrites it. */
function fileNameOf(path: string | null): string | null {
  if (path === null || path.length === 0) {
    return null;
  }
  const segments = path.split(/[/\\]/).filter((part) => part.length > 0);
  return segments[segments.length - 1] ?? null;
}

/* ------------------------------ file kinds -------------------------------- */

/**
 * File kinds an examiner sorts downloads by, in reading order: the two that
 * matter most in an investigation (executables, archives) lead, then the
 * document/media families, then anything unclassified. Each kind is inferred
 * from the recorded MIME type first, then the filename extension — the same
 * two fields the row already carries, never a new lookup.
 */
type FileKind =
  | "executable"
  | "archive"
  | "document"
  | "spreadsheet"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "other";

const KIND_META: Readonly<
  Record<FileKind, { readonly label: string; readonly icon: AppIcon }>
> = {
  executable: { label: "Executable", icon: FILE_KIND_ICONS.executable },
  archive: { label: "Archive", icon: FILE_KIND_ICONS.archive },
  document: { label: "Document", icon: FILE_KIND_ICONS.text },
  spreadsheet: { label: "Spreadsheet", icon: FILE_KIND_ICONS.sheet },
  image: { label: "Image", icon: FILE_KIND_ICONS.image },
  audio: { label: "Audio", icon: FILE_KIND_ICONS.audio },
  video: { label: "Video", icon: FILE_KIND_ICONS.video },
  code: { label: "Code / config", icon: FILE_KIND_ICONS.code },
  other: { label: "Other", icon: DownloadedFileIcon },
};

/** Order the file-kind breakdown lists its rows — investigative first. */
const KIND_ORDER: readonly FileKind[] = [
  "executable",
  "archive",
  "document",
  "spreadsheet",
  "image",
  "audio",
  "video",
  "code",
  "other",
];

const EXTENSION_KIND: Readonly<Record<string, FileKind>> = {
  exe: "executable",
  msi: "executable",
  dmg: "executable",
  pkg: "executable",
  bat: "executable",
  cmd: "executable",
  sh: "executable",
  apk: "executable",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  gz: "archive",
  tar: "archive",
  tgz: "archive",
  pdf: "document",
  doc: "document",
  docx: "document",
  txt: "document",
  rtf: "document",
  odt: "document",
  csv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  json: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  ovpn: "code",
  conf: "code",
  ini: "code",
  js: "code",
  ts: "code",
  html: "code",
};

function extensionOf(name: string | null): string | null {
  if (name === null) {
    return null;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  return name.slice(dot + 1).toLowerCase();
}

/** Classifies a download by MIME type, falling back to filename extension. */
function kindOf(mime: string | null, name: string | null): FileKind {
  const lower = mime?.toLowerCase() ?? "";
  if (
    lower.includes("msdownload") ||
    lower.includes("x-msi") ||
    lower.includes("x-executable") ||
    lower.includes("x-apple-diskimage") ||
    lower.includes("vnd.android.package")
  ) {
    return "executable";
  }
  if (
    lower.includes("zip") ||
    lower.includes("x-rar") ||
    lower.includes("x-7z") ||
    lower.includes("gzip") ||
    lower.includes("x-tar")
  ) {
    return "archive";
  }
  if (
    lower.includes("spreadsheet") ||
    lower.includes("ms-excel") ||
    lower === "text/csv"
  ) {
    return "spreadsheet";
  }
  if (
    lower === "application/pdf" ||
    lower.includes("wordprocessing") ||
    lower.includes("msword") ||
    lower === "text/plain" ||
    lower.includes("rtf")
  ) {
    return "document";
  }
  if (lower.startsWith("image/")) {
    return "image";
  }
  if (lower.startsWith("audio/")) {
    return "audio";
  }
  if (lower.startsWith("video/")) {
    return "video";
  }
  if (
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("yaml") ||
    lower.includes("javascript")
  ) {
    return "code";
  }
  const byExtension = EXTENSION_KIND[extensionOf(name) ?? ""];
  return byExtension ?? "other";
}

/* ----------------------------- derived model ------------------------------ */

/** ISO `YYYY-MM-DD`, or `""` when that bound is unset. Same shape the Timeline
 *  and History activity charts use to focus their tables. */
interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** What the lists sort by. */
type SortKey = "started" | "type" | "file" | "size" | "source" | "outcome";

/** Toolbar order and wording of the sort keys. */
const SORT_KEYS: readonly SortKey[] = [
  "started",
  "type",
  "file",
  "size",
  "source",
  "outcome",
];

const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  started: "Started",
  type: "Type",
  file: "File",
  size: "Size",
  source: "Source",
  outcome: "Outcome",
};

/** What the direction toggle says, per key ("newest first", not
 *  "descending"). */
const DIRECTION_WORDS: Readonly<
  Record<SortKey, { readonly desc: string; readonly asc: string }>
> = {
  started: { desc: "newest first", asc: "oldest first" },
  type: { desc: "reverse kind order", asc: "kind order" },
  file: { desc: "Z to A", asc: "A to Z" },
  size: { desc: "largest first", asc: "smallest first" },
  source: { desc: "Z to A", asc: "A to Z" },
  outcome: { desc: "Z to A", asc: "A to Z" },
};

interface SortState {
  readonly key: SortKey;
  readonly dir: "asc" | "desc";
}

interface DownloadRow {
  readonly finding: Finding;
  readonly name: string | null;
  readonly path: string | null;
  readonly host: string | null;
  readonly sourceUrl: string | null;
  readonly bytes: number | null;
  readonly startUtc: string | null;
  readonly state: string | null;
  readonly kind: FileKind;
}

function toRow(finding: Finding): DownloadRow {
  const path = fieldText(finding.fields.targetPath);
  const name = fileNameOf(path);
  const sourceUrl =
    fieldText(finding.fields.originalUrl) ??
    fieldText(finding.fields.siteUrl) ??
    fieldText(finding.fields.finalUrl);
  const mime = fieldText(finding.fields.mimeType);
  return {
    finding,
    name,
    path,
    host: hostOf(sourceUrl),
    sourceUrl,
    bytes: fieldInteger(finding.fields.totalBytes),
    startUtc: fieldUtc(finding.fields.startTime),
    state: fieldText(finding.fields.state),
    kind: kindOf(mime, name),
  };
}

/** How a recorded `state` value reads, plain-worded. Unknown values pass
 *  through verbatim rather than being reshaped into one this page invented;
 *  a state with no recorded value keeps its field's own word (absent,
 *  (empty), unavailable) in the table. */
const STATE_LABEL: Readonly<Record<string, string>> = {
  complete: "Complete",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** The two states that mean a transfer did not finish cleanly — the ones an
 *  examiner counts, not a colour badge. */
function isUnfinished(state: string | null): boolean {
  return (
    state === "interrupted" || state === "cancelled" || state === "canceled"
  );
}

/** Orders two rows by one column, ascending; the caller flips for descending.
 *  Nulls sort last in ascending order (an absent size or time is not "zero"). */
function compareRows(a: DownloadRow, b: DownloadRow, key: SortKey): number {
  switch (key) {
    case "type":
      return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    case "file":
      return (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff", "en-US");
    case "size":
      return (a.bytes ?? -1) - (b.bytes ?? -1);
    case "source":
      return (a.host ?? "\uffff").localeCompare(b.host ?? "\uffff", "en-US");
    case "started":
      return (a.startUtc ?? "").localeCompare(b.startUtc ?? "");
    case "outcome":
      return (a.state === null ? "\uffff" : stateLabel(a.state)).localeCompare(
        b.state === null ? "\uffff" : stateLabel(b.state),
        "en-US",
      );
  }
}

/* -------------------------------- widgets --------------------------------- */

interface VolumeDay {
  readonly date: string;
  readonly bytes: number;
  readonly count: number;
}

/**
 * Downloads over time. Bars show bytes transferred per recorded day — a
 * discrete reading of when data actually left the machine. Days with no
 * downloads are filled with zero (drawn as nothing) so the axis is
 * continuous calendar time, never compressed. Drag across the bars (or
 * click one) to focus the lists. The one series style: ink bars at rest,
 * one emphasis — the picked day, else the busiest — and the rest dimmed
 * outside a picked range.
 */
function VolumeChart({
  rows,
  range,
  onRangeChange,
}: {
  readonly rows: readonly DownloadRow[];
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
}) {
  const tokens = useChartTokens();
  const reduced = usePrefersReducedMotion();
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const hasRange = range.from !== "" || range.to !== "";
  const dragging = dragStart !== null;

  // While dragging the highlight follows the pointer; once committed it is the
  // page's own range. Bounds are kept sorted so a right-to-left drag reads the
  // same as a left-to-right one — identical to the Timeline activity card.
  const highlight = useMemo(() => {
    if (dragStart !== null && dragCurrent !== null) {
      return dragStart <= dragCurrent
        ? { from: dragStart, to: dragCurrent }
        : { from: dragCurrent, to: dragStart };
    }
    if (dragStart !== null) {
      return { from: dragStart, to: dragStart };
    }
    if (!hasRange) {
      return null;
    }
    // An unset bound is open-ended, exactly as the table filters: it reaches
    // the chart's first or last day, never collapses onto the other bound.
    return {
      from: range.from === "" ? "" : range.from,
      to: range.to === "" ? "\uffff" : range.to,
    };
  }, [dragStart, dragCurrent, hasRange, range]);

  const commitDrag = useCallback(() => {
    if (dragStart === null) {
      return;
    }
    const end = dragCurrent ?? dragStart;
    onRangeChange(
      dragStart <= end
        ? { from: dragStart, to: end }
        : { from: end, to: dragStart },
    );
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent, onRangeChange]);

  const days = useMemo<readonly VolumeDay[]>(() => {
    const byDate = new Map<string, { bytes: number; count: number }>();
    for (const row of rows) {
      if (row.startUtc === null) {
        continue;
      }
      const date = row.startUtc.slice(0, 10);
      const entry = byDate.get(date) ?? { bytes: 0, count: 0 };
      entry.bytes += row.bytes ?? 0;
      entry.count += 1;
      byDate.set(date, entry);
    }
    const recorded = [...byDate.entries()]
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((left, right) => left.date.localeCompare(right.date));
    const first = recorded[0];
    const last = recorded[recorded.length - 1];
    if (first === undefined || last === undefined) {
      return recorded;
    }
    const start = new Date(`${first.date}T00:00:00Z`).getTime();
    const end = new Date(`${last.date}T00:00:00Z`).getTime();
    const span = Math.round((end - start) / 86_400_000) + 1;
    // Gap-fill only when it stays cheap; otherwise draw the recorded days
    // straight, same guard the Timeline activity chart uses.
    if (span <= recorded.length || span > 550) {
      return recorded;
    }
    const map = new Map(recorded.map((day) => [day.date, day]));
    return Array.from({ length: span }, (_, index) => {
      const date = new Date(start + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return map.get(date) ?? { date, bytes: 0, count: 0 };
    });
  }, [rows]);

  if (days.length === 0) {
    return (
      <div className={CHART_HEIGHT}>
        <ChartEmpty>No dated downloads to draw.</ChartEmpty>
      </div>
    );
  }

  const peak = days.reduce((max, day) => Math.max(max, day.bytes), 0);
  const dateAt = (state: MouseHandlerDataParam | undefined) => {
    const index = activeIndexOf(state);
    return index === null ? null : (days[index]?.date ?? null);
  };
  // One emphasis: the picked day when the range is one drawn day, else the
  // busiest; days outside the focused range dim — as ActivityBars reads.
  const picked =
    range.from !== "" && range.from === range.to ? range.from : null;
  const pickedShown =
    picked !== null && days.some((day) => day.date === picked);
  const emphasisOf = (day: VolumeDay) =>
    pickedShown ? day.date === picked : peak > 0 && day.bytes === peak;
  const dimmedOf = (day: VolumeDay) =>
    highlight !== null &&
    (day.date < highlight.from || day.date > highlight.to);
  // The shaded band, clamped to the drawn days (an open bound runs to the
  // chart's edge).
  const firstDay = days[0]?.date ?? "";
  const lastDay = days[days.length - 1]?.date ?? "";
  const band =
    highlight === null
      ? null
      : {
          from: highlight.from < firstDay ? firstDay : highlight.from,
          to: highlight.to > lastDay ? lastDay : highlight.to,
        };

  return (
    <div
      className={cn(
        CHART_HEIGHT,
        "w-full",
        dragging && "cursor-crosshair select-none",
      )}
      aria-label="Bytes downloaded per day. Drag across the chart to focus the table below."
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        className={CHART_FOCUS_CLASS}
      >
        <BarChart
          data={days as VolumeDay[]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="18%"
          style={{ cursor: dragging ? "crosshair" : "pointer" }}
          onMouseDown={(state) => {
            const date = dateAt(state);
            if (date !== null) {
              setDragStart(date);
              setDragCurrent(date);
            }
          }}
          onMouseMove={(state) => {
            setHoverIndex(activeIndexOf(state));
            if (dragStart !== null) {
              const date = dateAt(state);
              if (date !== null) {
                setDragCurrent(date);
              }
            }
          }}
          onMouseUp={commitDrag}
          onMouseLeave={() => {
            setHoverIndex(null);
            commitDrag();
          }}
        >
          <CartesianGrid {...chartGrid(tokens)} />
          <XAxis
            dataKey="date"
            {...chartAxis(tokens)}
            minTickGap={40}
            tickFormatter={formatDayTick}
          />
          <YAxis
            width={56}
            {...chartAxis(tokens)}
            tickFormatter={(bytes: number) => formatBytes(bytes)}
          />
          <Tooltip
            {...chartTooltipMotion(reduced)}
            cursor={<FluidBandCursor fill={tokens["--hover"]} />}
            content={({ payload }) => {
              const row = tooltipEntry(payload);
              if (row === null) {
                return null;
              }
              const bytes = Number(row["bytes"]);
              const count = Number(row["count"]);
              return (
                <ChartTooltipCard label={formatDay(String(row["date"]))}>
                  <ChartTooltipValue
                    value={formatBytes(bytes)}
                    unit="downloaded"
                  />
                  <ChartTooltipNote>
                    {plural(count, "file", "files")}
                    {peak > 0 && bytes === peak ? " · busiest day" : ""}
                  </ChartTooltipNote>
                </ChartTooltipCard>
              );
            }}
          />
          {band !== null && band.from < band.to ? (
            <ReferenceArea
              x1={band.from}
              x2={band.to}
              {...chartRange(tokens)}
            />
          ) : null}
          <Bar
            dataKey="bytes"
            radius={[3, 3, 0, 0]}
            {...chartAnimation(reduced)}
            fill={seriesColor(tokens)}
            shape={(props: BarShapeProps) => {
              const day = days[props.originalDataIndex];
              return (
                <SeriesBar
                  {...props}
                  tokens={tokens}
                  emphasis={day !== undefined && emphasisOf(day)}
                  dimmed={day !== undefined && dimmedOf(day)}
                  hovered={props.originalDataIndex === hoverIndex}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * File-kind breakdown. One card per kind that appears, ordered investigative
 * first (executables, archives), each with a bar sized to the busiest kind by
 * bytes and its count and total size beside it. This is the lens an examiner
 * actually scans a downloads set through — "did anything executable land
 * here" — that the raw table alone buries. Picking a kind focuses the table;
 * the picked card holds FF's selected fill and its title turns semibold.
 */
function KindBreakdown({
  rows,
  activeKind,
  onKind,
}: {
  readonly rows: readonly DownloadRow[];
  readonly activeKind: FileKind | null;
  readonly onKind: (kind: FileKind | null) => void;
}) {
  const size = useSize();
  const kinds = useMemo(() => {
    const map = new Map<FileKind, { count: number; bytes: number }>();
    for (const row of rows) {
      const entry = map.get(row.kind) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += row.bytes ?? 0;
      map.set(row.kind, entry);
    }
    return KIND_ORDER.flatMap((kind) => {
      const entry = map.get(kind);
      return entry === undefined ? [] : [{ kind, ...entry }];
    });
  }, [rows]);

  // Bars are sized by bytes, not count: the whole page reads download volume
  // (the over-time chart is bytes too), so one 2 GB
  // executable must not shrink to the width of a single favicon.
  const peak = Math.max(...kinds.map((entry) => entry.bytes), 1);

  if (kinds.length === 0) {
    return <EmptyRows message="No downloads to classify." />;
  }

  return (
    <SizeProvider size="compact">
      <CardGroup orientation="inline" className="px-1 pb-1">
        {kinds.map((entry) => {
          const meta = KIND_META[entry.kind];
          const active = activeKind === entry.kind;
          return (
            <Card
              key={entry.kind}
              selected={active}
              onClick={() => {
                onKind(active ? null : entry.kind);
              }}
              label={`${meta.label}: ${plural(entry.count, "file", "files")}, ${formatBytes(entry.bytes)}. ${
                active
                  ? "Press to show every file kind"
                  : "Press to focus the table on this kind"
              }`}
            >
              <CardMedia icon={meta.icon} />
              <CardHeader className="w-28 flex-none">
                <CardTitle className={CARD_TITLE_CLEAR}>{meta.label}</CardTitle>
              </CardHeader>
              <span className="min-w-0 flex-1">
                <ShareBar fraction={entry.bytes / peak} />
              </span>
              {/* Text only: let a click on it fall through to the card. */}
              <CardFooter className="pointer-events-none w-20 flex-col items-end gap-0">
                <span
                  className={cn(size.type.body, "text-foreground tabular-nums")}
                >
                  {plural(entry.count, "file", "files")}
                </span>
                <span
                  className={cn(
                    size.type.caption,
                    "text-muted-foreground tabular-nums",
                  )}
                >
                  {formatBytes(entry.bytes)}
                </span>
              </CardFooter>
            </Card>
          );
        })}
      </CardGroup>
    </SizeProvider>
  );
}

/* --------------------------------- table ---------------------------------- */

/**
 * The download state in words. "Complete" sits muted beside a neutral dot
 * (the ordinary outcome); the two unfinished states read in the foreground
 * with the warning hue on the dot — the word is always present, never colour
 * alone. A value outside the known set passes through verbatim, and a state
 * Chrome did not record keeps its field's own word.
 */
function DownloadState({ field }: { readonly field: FieldState | undefined }) {
  const size = useSize();
  const state = fieldText(field);
  if (state === null) {
    return <FieldCell field={field} />;
  }
  const unfinished = isUnfinished(state);
  return (
    <span
      className={cn(
        size.type.caption,
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        unfinished ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <EvidenceDot state={unfinished ? "warning" : "neutral"} />
      {stateLabel(state)}
    </span>
  );
}

/** The source: the host with its avatar when the URL parses, the raw URL
 *  (monospace) when it does not, and the URL field's state word when none
 *  was recorded. */
function Source({
  row,
  avatar,
}: {
  readonly row: DownloadRow;
  readonly avatar: boolean;
}) {
  if (row.host === null) {
    return row.sourceUrl === null ? (
      <FieldCell field={row.finding.fields.originalUrl} />
    ) : (
      <span className="block truncate font-mono" title={row.sourceUrl}>
        {row.sourceUrl}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <SiteAvatar host={row.host} /> : null}
      <span className="truncate" title={row.sourceUrl ?? row.host}>
        {row.host}
      </span>
    </span>
  );
}

/** The download lists' columns, and where each sits in the stacked card on
 *  a phone: Type and the outcome (saved) or the State word (recovered) on
 *  the first line, the file as the title, size · source · start under it. */
function downloadColumns(
  recovered: boolean,
): readonly RowColumn<DownloadRow>[] {
  const columns: RowColumn<DownloadRow>[] = [
    {
      key: "type",
      header: "Type",
      className: "whitespace-nowrap",
      stack: "lead",
      cell: (row) => <FileKindLabel kind={row.kind} />,
      stackedCell: (row) => KIND_META[row.kind].label,
    },
    {
      key: "file",
      header: "File",
      className: "max-w-[300px]",
      stack: "title",
      cell: (row) =>
        row.name === null ? (
          <FieldCell field={row.finding.fields.targetPath} />
        ) : (
          <span
            className="block truncate text-foreground"
            title={row.path ?? row.name}
          >
            {row.name}
          </span>
        ),
    },
    {
      key: "size",
      header: "Size",
      className: "whitespace-nowrap tabular-nums",
      cell: (row) =>
        row.bytes === null ? (
          <FieldCell field={row.finding.fields.totalBytes} />
        ) : (
          <span title={`${row.bytes.toLocaleString("en-US")} bytes`}>
            {formatBytes(row.bytes)}
          </span>
        ),
    },
    {
      key: "source",
      header: "Source",
      className: "max-w-[240px]",
      cell: (row) => <Source row={row} avatar />,
      stackedCell: (row) => <Source row={row} avatar={false} />,
    },
    {
      key: "started",
      header: "Started",
      className: "whitespace-nowrap",
      cell: (row) => <TimeCell field={row.finding.fields.startTime} />,
    },
    {
      key: "outcome",
      header: "Outcome",
      className: "whitespace-nowrap",
      stack: recovered ? "meta" : "aside",
      cell: (row) => <DownloadState field={row.finding.fields.state} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      className: "whitespace-nowrap",
      stack: "aside",
      cell: (row) => <StateWord state={row.finding.commitState} />,
    });
  }
  return columns;
}

const SAVED_COLUMNS = downloadColumns(false);
const RECOVERED_COLUMNS = downloadColumns(true);

/** The file kind, worded, with its icon. */
function FileKindLabel({ kind }: { readonly kind: FileKind }) {
  const size = useSize();
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon
        aria-hidden="true"
        size={size.icon}
        strokeWidth={1.5}
        className="shrink-0"
      />
      {meta.label}
    </span>
  );
}

/** Sort and direction for both lists, as on History: an FF Select and a
 *  direction toggle whose tooltip says the order in words. */
function SortControls({
  sort,
  onSort,
}: {
  readonly sort: SortState;
  readonly onSort: (sort: SortState) => void;
}) {
  const descending = sort.dir === "desc";
  const words = DIRECTION_WORDS[sort.key];
  const DirectionIcon = descending ? SortNewestIcon : SortOldestIcon;
  const flip = `Sorted ${descending ? words.desc : words.asc}. Switch to ${
    descending ? words.asc : words.desc
  }`;
  return (
    <FilterField label="Sort" htmlFor="downloads-sort">
      <Select
        value={sort.key}
        onValueChange={(value) => {
          const key = SORT_KEYS.find((candidate) => candidate === value);
          if (key !== undefined) {
            onSort({
              key,
              dir: key === "file" || key === "type" ? "asc" : "desc",
            });
          }
        }}
      >
        <SelectTrigger id="downloads-sort" className="min-w-[120px]" />
        <SelectContent>
          {SORT_KEYS.map((key, index) => (
            <SelectItem key={key} index={index} value={key}>
              {SORT_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FluidTooltip content={flip}>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={flip}
          onClick={() => {
            onSort({ key: sort.key, dir: descending ? "asc" : "desc" });
          }}
        >
          <DirectionIcon />
        </Button>
      </FluidTooltip>
    </FilterField>
  );
}

/* --------------------------------- loading --------------------------------- */

/** The saved read in flight: how far the cursor walk has got, over
 *  placeholders at the size of the blocks they stand in for. */
function DownloadsLoading({ pages }: { readonly pages: number }) {
  const size = useSize();
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading downloads"
    >
      <p
        className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
        aria-live="polite"
      >
        {pages === 0
          ? "Reading saved downloads…"
          : `Reading saved downloads… ${plural(pages, "page", "pages")} loaded`}
      </p>
      <Skeleton className="h-[78px] rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[300px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}

/* ---------------------------------- lists --------------------------------- */

/** One of the two download lists (Saved or Recovered): its first read
 *  swapped in over a skeleton, a failed read with Retry, the rows or their
 *  empty state, and the footer. Rows are already narrowed and sorted. */
function DownloadList({
  read,
  rows,
  recovered,
  filtered,
  onSelect,
  onClearFilters,
}: {
  readonly read: {
    readonly rows: readonly Finding[] | null;
    readonly error: string | null;
    readonly retry: () => void;
  };
  readonly rows: readonly DownloadRow[];
  readonly recovered: boolean;
  readonly filtered: boolean;
  readonly onSelect: (finding: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  return (
    <ListBlock
      list={{
        rows: read.rows ?? [],
        cursor: null,
        loading: read.rows === null && read.error === null,
        error: read.error,
        loadMore: () => undefined,
        retry: read.retry,
      }}
      noun={
        recovered
          ? { one: "recovered download", many: "recovered downloads" }
          : { one: "saved download", many: "saved downloads" }
      }
      shown={rows.length}
      filtered={filtered}
      onClearFilters={onClearFilters}
      skeletonRows={recovered ? 3 : 8}
      empty={
        <EmptyRows
          title={recovered ? "No recovered downloads" : "No saved downloads"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a download row."
              : "The History database holds no committed download rows."
          }
        />
      }
    >
      <ResponsiveRows
        rows={rows}
        columns={recovered ? RECOVERED_COLUMNS : SAVED_COLUMNS}
        rowKey={(row, index) => `${row.finding.commitState}-${String(index)}`}
        rowLabel={(row) =>
          `Open download row detail: ${row.name ?? "download"}`
        }
        onSelect={(row) => {
          onSelect(row.finding);
        }}
        tableClassName="min-w-[860px]"
      />
    </ListBlock>
  );
}

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

  const summary = useMemo(() => {
    let bytes = 0;
    let sized = 0;
    let unfinished = 0;
    const hosts = new Set<string>();
    let firstUtc: string | null = null;
    let lastUtc: string | null = null;
    for (const row of model) {
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
      total: model.length,
      bytes,
      sized,
      unfinished,
      hosts: hosts.size,
      firstUtc,
      lastUtc,
    };
  }, [model]);

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
                  saved downloads read — the most this page loads at once. More
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
                description=""
                className="lg:col-span-2"
                action={
                  <>
                    <SavedOnlyTag
                      recovered={recoveredTotal ?? 0}
                      unit={{ one: "download", many: "downloads" }}
                    />
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
                  </>
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
                  rows={model}
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
                {hasRange ? (
                  <Button
                    variant="tertiary"
                    trailingIcon={CloseIcon}
                    aria-label="Clear the date range"
                    onClick={() => {
                      setRange({ from: "", to: "" });
                    }}
                  >
                    {range.from === "" ? "Start" : formatDayTick(range.from)} to{" "}
                    {range.to === "" ? "end" : formatDayTick(range.to)}
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
