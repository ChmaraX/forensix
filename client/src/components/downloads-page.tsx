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
 * Layout, top-down, as FF Panels: Evidence coverage → a MetricBand of
 * recorded figures → bytes per day (Recharts on the shared chart helpers:
 * fluid band cursor, FluidBar, FF tooltip card; drag across it to focus the
 * table on a range) → file kinds (an FF CardGroup: one fluid hover highlight,
 * a picked kind holds the selected fill) beside the top sources → the
 * sortable table on FF's Table.
 *
 * Presentation rules kept (see app.tsx's header): the Completeness Statement
 * renders before any row; download states are worded, never colour alone; a
 * field without a recorded value reads as the word "absent"; TYPE — here the
 * file-kind column — comes first in the table. This page is read-only: it
 * starts no ingest, reruns no analysis, and writes nothing back to the Case.
 */
import {
  Archive,
  ArrowDown,
  ArrowUp,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Search,
  Sheet,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
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
import { PanelFooter } from "@/components/panel";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fontWeights } from "@/lib/font-weight";
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
  FluidBandCursor,
  FluidBar,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
} from "./charts.js";
import { ChartSection } from "./chart-section.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { DateRangePicker } from "./date-range-picker.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CARD_TITLE_CLEAR,
  CHART_HEIGHT,
  CommitStateSplit,
  MeterList,
  SectionPanel,
  ShareBar,
  TimeCell,
  formatBytes,
  formatDay,
  formatDayTick,
  plural,
  type CommitView,
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
  Record<FileKind, { readonly label: string; readonly icon: LucideIcon }>
> = {
  executable: { label: "Executable", icon: Terminal },
  archive: { label: "Archive", icon: FileArchive },
  document: { label: "Document", icon: FileText },
  spreadsheet: { label: "Spreadsheet", icon: Sheet },
  image: { label: "Image", icon: FileImage },
  audio: { label: "Audio", icon: FileAudio },
  video: { label: "Video", icon: FileVideo },
  code: { label: "Code / config", icon: FileCode2 },
  other: { label: "Other", icon: Archive },
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

/** Which column the table sorts by. */
type SortKey = "type" | "file" | "size" | "source" | "started" | "state";

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
    case "state":
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
 * downloads are filled with zero so the axis is continuous calendar time,
 * never compressed. Drag across the bars (or click one) to focus the table.
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
  // The busiest day holds full strength, the rest sit lower; days outside
  // the focused range fade right back — the same reading as Activity bars.
  const strengthOf = (day: VolumeDay) => {
    if (
      highlight !== null &&
      (day.date < highlight.from || day.date > highlight.to)
    ) {
      return 0.2;
    }
    return peak > 0 && day.bytes === peak ? 1 : 0.55;
  };
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
                    {count.toLocaleString("en-US")} file
                    {count === 1 ? "" : "s"}
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
              fill={tokens["--primary"]}
              fillOpacity={0.07}
              strokeOpacity={0}
              radius={6}
            />
          ) : null}
          <Bar
            dataKey="bytes"
            radius={[3, 3, 0, 0]}
            {...chartAnimation(reduced)}
            fill={tokens["--primary"]}
            shape={(props: BarShapeProps) => {
              const day = days[props.originalDataIndex];
              return (
                <FluidBar
                  {...props}
                  fill={tokens["--primary"]}
                  opacity={day === undefined ? 0.55 : strengthOf(day)}
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
  // (the over-time chart and the source ranking are both bytes), so one 2 GB
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

/** How many source hosts the sources card lists before "and N more". */
const SOURCE_LIMIT = 6;

/**
 * Where the files came from. Hosts ranked by total bytes pulled from each,
 * with the file count beside the size — the "which site did this machine pull
 * the most data from" question the flat table cannot answer at a glance. Not
 * clickable, so no hover: a highlight would promise a click with nowhere to
 * land.
 */
function SourceHosts({ rows }: { readonly rows: readonly DownloadRow[] }) {
  const size = useSize();
  const tokens = useChartTokens();
  const hosts = useMemo(() => {
    const map = new Map<string, { count: number; bytes: number }>();
    for (const row of rows) {
      if (row.host === null) {
        continue;
      }
      const entry = map.get(row.host) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += row.bytes ?? 0;
      map.set(row.host, entry);
    }
    return [...map.entries()]
      .map(([host, entry]) => ({ host, ...entry }))
      .sort((left, right) => right.bytes - left.bytes);
  }, [rows]);

  if (hosts.length === 0) {
    return <EmptyRows message="No source host recorded on these downloads." />;
  }
  const more = hosts.length - SOURCE_LIMIT;

  return (
    <>
      <MeterList
        className="px-4 pt-1 pb-3"
        labelWidth="clamp(6rem, 32%, 12rem)"
        tokens={tokens}
        rows={hosts.slice(0, SOURCE_LIMIT).map((entry) => ({
          key: entry.host,
          label: (
            <>
              <SiteAvatar host={entry.host} />
              <span className="truncate" title={entry.host}>
                {entry.host}
              </span>
            </>
          ),
          value: entry.bytes,
          display: `${formatBytes(entry.bytes)} · ${plural(entry.count, "file", "files")}`,
          title: `${entry.bytes.toLocaleString("en-US")} bytes`,
        }))}
      />
      {more > 0 ? (
        <PanelFooter>
          <p className={cn(size.type.caption, "text-muted-foreground")}>
            and {plural(more, "more source host", "more source hosts")} in the
            table below
          </p>
        </PanelFooter>
      ) : null}
    </>
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

const TABLE_COLUMNS: readonly {
  readonly label: string;
  readonly key: SortKey;
}[] = [
  { label: "Type", key: "type" },
  { label: "File", key: "file" },
  { label: "Size", key: "size" },
  { label: "Source", key: "source" },
  { label: "Started", key: "started" },
  { label: "State", key: "state" },
];

/** A sortable column header: the label is the button; the active column
 *  reads in the foreground with its direction arrow, the rest stay muted. */
function SortHead({
  label,
  active,
  dir,
  onSort,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly dir: "asc" | "desc";
  readonly onSort: () => void;
}) {
  const size = useSize();
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className="whitespace-nowrap"
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-focus-ring",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {label}
        <Arrow
          aria-hidden="true"
          size={size.icon}
          strokeWidth={2}
          className={cn("shrink-0", !active && "invisible")}
        />
      </button>
    </TableHead>
  );
}

function DownloadsTable({
  rows,
  sort,
  onSort,
  onSelect,
}: {
  readonly rows: readonly DownloadRow[];
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
  readonly onSelect: (finding: Finding) => void;
}) {
  const size = useSize();
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            {TABLE_COLUMNS.map(({ label, key }) => (
              <SortHead
                key={key}
                label={label}
                active={sort.key === key}
                dir={sort.dir}
                onSort={() => {
                  onSort(key);
                }}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const meta = KIND_META[row.kind];
            const Icon = meta.icon;
            const open = () => {
              onSelect(row.finding);
            };
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label={`Open download row detail: ${row.name ?? "download"}`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <Icon
                      aria-hidden="true"
                      size={size.icon}
                      strokeWidth={1.5}
                      className="shrink-0"
                    />
                    {meta.label}
                  </span>
                </TableCell>
                <TableCell className="max-w-[300px]">
                  {row.name === null ? (
                    <FieldCell field={row.finding.fields.targetPath} />
                  ) : (
                    <span
                      className="block truncate text-foreground"
                      title={row.path ?? row.name}
                    >
                      {row.name}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {row.bytes === null ? (
                    <FieldCell field={row.finding.fields.totalBytes} />
                  ) : (
                    <span title={`${row.bytes.toLocaleString("en-US")} bytes`}>
                      {formatBytes(row.bytes)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  {row.host === null ? (
                    row.sourceUrl === null ? (
                      <FieldCell field={row.finding.fields.originalUrl} />
                    ) : (
                      <span
                        className="block truncate font-mono"
                        title={row.sourceUrl}
                      >
                        {row.sourceUrl}
                      </span>
                    )
                  ) : (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <SiteAvatar host={row.host} />
                      <span
                        className="truncate"
                        title={row.sourceUrl ?? row.host}
                      >
                        {row.host}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <TimeCell field={row.finding.fields.startTime} />
                </TableCell>
                <TableCell>
                  <DownloadState field={row.finding.fields.state} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
      <Skeleton className="h-[86px] rounded-xl" />
      <Skeleton className="h-[318px] rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-xl" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
    </div>
  );
}

/* ---------------------------------- lists --------------------------------- */

/** One of the two download lists (Saved or Recovered): its first read
 *  swapped in over a skeleton, a failed read with Retry, the table or its
 *  empty state, and the footer. Rows are already narrowed and sorted. */
function DownloadList({
  read,
  rows,
  recovered,
  filtered,
  sort,
  onSort,
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
  readonly sort: SortState;
  readonly onSort: (key: SortKey) => void;
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
      <DownloadsTable
        rows={rows}
        sort={sort}
        onSort={onSort}
        onSelect={onSelect}
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

  const onSort = useCallback((key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "file" || key === "type" ? "asc" : "desc" },
    );
  }, []);

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
      ? "no dated saved downloads"
      : summary.firstUtc.slice(0, 10) === summary.lastUtc.slice(0, 10)
        ? formatDay(summary.firstUtc.slice(0, 10))
        : `${formatDay(summary.firstUtc.slice(0, 10))} to ${formatDay(summary.lastUtc.slice(0, 10))}`;

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
                    ? "recorded total size"
                    : `across ${plural(summary.sized, "sized row", "sized rows")}`
                }
              />
              <MetricBandItem
                label="Source hosts"
                value={summary.hosts.toLocaleString("en-US")}
                detail="distinct download origins"
              />
              <MetricBandItem
                label="Did not finish"
                value={summary.unfinished.toLocaleString("en-US")}
                detail="interrupted or cancelled"
              />
            </MetricBand>

            {/* Volume over time. Drag across it (or pick a range) to focus
                  the lists below, the same gesture the Timeline and History
                  activity charts use. The picker carries its own clear. */}
            <ChartSection
              title="Downloads over time"
              description="Bytes of saved downloads per day. Choose a range or drag across the bars."
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
              footer={
                recoveredTotal === null || recoveredTotal === 0 ? undefined : (
                  <RecoveredNote count={recoveredTotal} />
                )
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

            {/* File kinds + sources — the two lenses an examiner scans a
                  downloads set through, side by side. Picking a file kind
                  focuses the lists below on it. */}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <SectionPanel
                id="downloads-kinds-title"
                title="By file kind"
                description="Saved downloads. Pick a kind to focus the table."
              >
                <KindBreakdown
                  rows={model}
                  activeKind={kindFilter}
                  onKind={onKind}
                />
              </SectionPanel>
              <SectionPanel
                id="downloads-sources-title"
                title="Top sources"
                description="Saved downloads, by total bytes."
              >
                <SourceHosts rows={model} />
              </SectionPanel>
            </div>
          </div>
        </RevealSwap>
      )}

      {/* The raw rows, saved and recovered as separate reads. */}
      <div ref={tableRef} className="relative scroll-mt-4">
        <SectionPanel
          id="downloads-all-title"
          title="All downloads"
          description="Every recorded download. File kind, dates and search narrow both lists."
        >
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
                    trailingIcon={X}
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
                    trailingIcon={X}
                    aria-label="Clear the date range"
                    onClick={() => {
                      setRange({ from: "", to: "" });
                    }}
                  >
                    {range.from === "" ? "Start" : formatDayTick(range.from)} to{" "}
                    {range.to === "" ? "end" : formatDayTick(range.to)}
                  </Button>
                ) : null}
                <FilterTextField
                  id="downloads-search"
                  commit="change"
                  label="Search loaded downloads"
                  icon={Search}
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
                sort={sort}
                onSort={onSort}
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
                sort={sort}
                onSort={onSort}
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

function RecoveredNote({ count }: { readonly count: number }) {
  const size = useSize();
  return (
    <p className={cn(size.type.caption, "text-muted-foreground")}>
      {plural(count, "recovered download is", "recovered downloads are")} not
      counted here; they are listed under Recovered below.
    </p>
  );
}
