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
 * Presentation rules kept (see app.tsx's header): the Completeness Statement
 * renders before any row; download states are worded, never colour alone; a
 * field without a recorded value reads as the word "absent"; TYPE — here the
 * file-kind column — leads the table. This page is read-only: it starts no
 * ingest, reruns no analysis, and writes nothing back to the Case.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  Finding,
  PageOf,
} from "../types.js";
import { useChartTokens, usePrefersReducedMotion } from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  SiteAvatar,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";

/* --------------------------------- reads ---------------------------------- */

/** Above this many pages the read stops; the page then says it is partial. */
const DOWNLOADS_PAGE_CAP = 150;

/**
 * Reads every download row (up to the page cap), newest first. The real API
 * paginates; the read follows the cursor until it runs out, so the aggregates
 * below cover the whole Case rather than one page. `complete` is false only
 * when the cap was hit before the cursor did.
 */
function useDownloads(route: string) {
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
  }, [route, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, complete, error, pages, retry };
}

/* ------------------------------- formatting ------------------------------- */

/** Bytes as "1.4 MB" / "812 KB" — base-1024, the size an examiner reads. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${units[unit] ?? "KB"}`;
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

function formatTick(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

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
 *  through verbatim rather than being reshaped into one this page invented. */
const STATE_LABEL: Readonly<Record<string, string>> = {
  complete: "Complete",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

function stateLabel(state: string | null): string {
  if (state === null) {
    return "Unrecorded";
  }
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
      return stateLabel(a.state).localeCompare(stateLabel(b.state), "en-US");
  }
}

/* -------------------------------- widgets --------------------------------- */

function StatTile({
  label,
  value,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[0_16px_32px_-18px_var(--edge-shadow)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-accent/70 to-transparent"
      />
      <div className="relative flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </span>
        <p className="truncate text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
          {value}
        </p>
        <p className="truncate text-[12px] text-muted-foreground" title={note}>
          {note}
        </p>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  count,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly count?: number;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {count === undefined ? null : (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        {description === undefined ? null : (
          <p className="w-full text-[12px] text-muted-foreground sm:w-auto sm:flex-1">
            {description}
          </p>
        )}
        {action === undefined ? null : (
          <div className="ml-auto flex items-center">{action}</div>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * Downloads over time. An area of bytes transferred per recorded day — the
 * shape of when data actually left the machine, drawn with the same primary
 * area as the Overview's browsing chart. Days with no downloads are filled
 * with zero so the axis is continuous calendar time, never compressed.
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
    return hasRange ? range : null;
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

  const days = useMemo(() => {
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
      <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
        No dated downloads to draw.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "h-[190px] w-full px-2 py-3",
        dragging && "cursor-crosshair select-none",
      )}
      aria-label="Bytes downloaded per day. Drag across the chart to focus the table below."
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={days}
          margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
          onMouseDown={(state) => {
            if (typeof state?.activeLabel === "string") {
              setDragStart(state.activeLabel);
              setDragCurrent(state.activeLabel);
            }
          }}
          onMouseMove={(state) => {
            if (dragStart !== null && typeof state?.activeLabel === "string") {
              setDragCurrent(state.activeLabel);
            }
          }}
          onMouseUp={commitDrag}
          onMouseLeave={commitDrag}
        >
          <defs>
            <linearGradient id="fxDownloadsFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={tokens["--primary"]}
                stopOpacity={0.3}
              />
              <stop
                offset="100%"
                stopColor={tokens["--primary"]}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke={tokens["--border"]}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            minTickGap={44}
            tickFormatter={formatTick}
            tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
          />
          <YAxis
            width={46}
            tickLine={false}
            axisLine={false}
            tickFormatter={(bytes: number) => formatBytes(bytes)}
            tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
          />
          <Tooltip
            cursor={{ stroke: tokens["--border"], strokeWidth: 1 }}
            content={({ payload }) => {
              const entry = Array.isArray(payload)
                ? (payload[0] as
                    | {
                        payload?: {
                          date: string;
                          bytes: number;
                          count: number;
                        };
                      }
                    | undefined)
                : undefined;
              const row = entry?.payload;
              return row === undefined ? null : (
                <div
                  className="rounded-md border px-3 py-2 text-[12px] shadow-md"
                  style={{
                    backgroundColor: tokens["--card"],
                    borderColor: tokens["--border"],
                    color: tokens["--foreground"],
                  }}
                >
                  <p className="font-medium">{formatDay(row.date)}</p>
                  <p
                    className="tabular-nums"
                    style={{ color: tokens["--muted-foreground"] }}
                  >
                    {formatBytes(row.bytes)} ·{" "}
                    {row.count.toLocaleString("en-US")} file
                    {row.count === 1 ? "" : "s"}
                  </p>
                </div>
              );
            }}
          />
          {highlight !== null && highlight.from !== highlight.to ? (
            <ReferenceArea
              x1={highlight.from}
              x2={highlight.to}
              fill={tokens["--primary"]}
              fillOpacity={0.08}
              stroke={tokens["--primary"]}
              strokeOpacity={0.25}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="bytes"
            stroke={tokens["--primary"]}
            strokeWidth={2}
            fill="url(#fxDownloadsFill)"
            isAnimationActive={!reduced}
            animationDuration={650}
            activeDot={{
              r: 4,
              fill: tokens["--primary"],
              stroke: tokens["--card"],
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * File-kind breakdown. One row per kind that appears, ordered investigative
 * first (executables, archives), each a bar sized to the busiest kind by
 * count with its total size beside it. This is the lens an examiner actually
 * scans a downloads set through — "did anything executable land here" — that
 * the raw table alone buries.
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
    <ul className="flex flex-col gap-1 p-2">
      {kinds.map((entry) => {
        const meta = KIND_META[entry.kind];
        const Icon = meta.icon;
        const active = activeKind === entry.kind;
        const share = Math.max(2, Math.round((entry.bytes / peak) * 100));
        return (
          <li key={entry.kind}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => {
                onKind(active ? null : entry.kind);
              }}
              className={cn(
                "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                active ? "bg-accent" : "hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-3.5",
                      active ? "text-accent-foreground" : "text-foreground/60",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "w-[104px] truncate text-[12.5px] font-medium",
                    active && "text-accent-foreground",
                  )}
                >
                  {meta.label}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-[width] duration-500",
                      entry.bytes === peak ? "bg-primary" : "bg-primary/45",
                    )}
                    style={{ width: `${String(share)}%` }}
                  />
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-[12px] tabular-nums">
                  {entry.count.toLocaleString("en-US")}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(entry.bytes)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** How many source hosts the sources card lists before "and N more". */
const SOURCE_LIMIT = 6;

/**
 * Where the files came from. Hosts ranked by total bytes pulled from each,
 * with the file count beside the size — the "which site did this machine pull
 * the most data from" question the flat table cannot answer at a glance.
 */
function SourceHosts({ rows }: { readonly rows: readonly DownloadRow[] }) {
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
  const peak = hosts[0]?.bytes ?? 0;

  return (
    <ol className="flex flex-col p-2">
      {hosts.slice(0, SOURCE_LIMIT).map((entry, index) => {
        const share = peak === 0 ? 0 : Math.round((entry.bytes / peak) * 100);
        return (
          <li key={entry.host}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 py-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="w-4 shrink-0 text-center text-[12px] font-semibold text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <SiteAvatar host={entry.host} />
                <span
                  className="truncate text-[12.5px] font-medium"
                  title={entry.host}
                >
                  {entry.host}
                </span>
              </span>
              <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width] duration-500",
                    index === 0 ? "bg-primary" : "bg-primary/45",
                  )}
                  style={{ width: `${String(share)}%` }}
                />
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-[12px] tabular-nums">
                  {formatBytes(entry.bytes)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {entry.count.toLocaleString("en-US")} file
                  {entry.count === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          </li>
        );
      })}
      {hosts.length > SOURCE_LIMIT ? (
        <li className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
          and {hosts.length - SOURCE_LIMIT} more source host
          {hosts.length - SOURCE_LIMIT === 1 ? "" : "s"} in the table below
        </li>
      ) : null}
    </ol>
  );
}

/* --------------------------------- table ---------------------------------- */

function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className="whitespace-nowrap text-[12.5px] tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span className="font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </span>
  );
}

/**
 * The download state as a plain word with a quiet dot: "Complete" sits muted
 * (the boring default), the two unfinished states carry the same non-green
 * hues the rest of the app reserves for "recovered" so state never rides on
 * colour alone — the word is always present.
 */
function DownloadState({ state }: { readonly state: string | null }) {
  const unfinished = isUnfinished(state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]",
        state === null
          ? "text-muted-foreground italic"
          : unfinished
            ? "font-medium text-warning"
            : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          state === null
            ? "bg-muted-foreground/40"
            : unfinished
              ? "bg-warning"
              : "bg-muted-foreground/50",
        )}
      />
      {stateLabel(state)}
    </span>
  );
}

const TABLE_COLUMNS: readonly { readonly label: string; readonly key: SortKey }[] =
  [
    { label: "Type", key: "type" },
    { label: "File", key: "file" },
    { label: "Size", key: "size" },
    { label: "Source", key: "source" },
    { label: "Started", key: "started" },
    { label: "State", key: "state" },
  ];

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
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {TABLE_COLUMNS.map(({ label, key }) => {
              const active = sort.key === key;
              const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={key}
                  aria-sort={
                    active
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="sticky top-0 z-10 border-b border-border bg-muted/80 p-0 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSort(key);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-1 px-3 py-2 uppercase transition-colors duration-150 hover:text-foreground",
                      active && "text-foreground",
                    )}
                  >
                    {label}
                    <Arrow
                      aria-hidden="true"
                      className={cn(
                        "size-3 shrink-0",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const meta = KIND_META[row.kind];
            const Icon = meta.icon;
            return (
              <tr
                key={index}
                tabIndex={0}
                aria-label="Open download row detail"
                onClick={() => {
                  onSelect(row.finding);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row.finding);
                  }
                }}
                className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                    <Icon aria-hidden="true" className="size-3.5" />
                    {meta.label}
                  </span>
                </td>
                <td className="max-w-[300px] px-3 py-2.5">
                  {row.name === null ? (
                    <AbsentWord />
                  ) : (
                    <span
                      className="block truncate font-medium text-foreground/90"
                      title={row.path ?? row.name}
                    >
                      {row.name}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] tabular-nums">
                  {row.bytes === null ? <AbsentWord /> : formatBytes(row.bytes)}
                </td>
                <td className="max-w-[220px] px-3 py-2.5">
                  {row.host === null ? (
                    <AbsentWord />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2">
                      <SiteAvatar host={row.host} />
                      <span
                        className="truncate text-[12.5px] text-muted-foreground"
                        title={row.sourceUrl ?? row.host}
                      >
                        {row.host}
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <TimeCell utc={row.startUtc} />
                </td>
                <td className="px-3 py-2.5">
                  <DownloadState state={row.state} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function DownloadsPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const { rows, complete, error, pages, retry } = useDownloads(config.route);
  const reduced = usePrefersReducedMotion();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<FileKind | null>(null);
  const [range, setRange] = useState<DayRange>({ from: "", to: "" });
  const [sort, setSort] = useState<SortState>({ key: "started", dir: "desc" });

  // Clicking a file kind (or picking a day range) narrows the table that sits
  // below the fold on a tall monitor; without this the table would change
  // silently. A brief ring pulse plus a scroll-into-view draws the eye down.
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
    const timer = setTimeout(() => {
      setPulsing(false);
    }, 650);
    return () => {
      clearTimeout(timer);
    };
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

  const model = useMemo(() => (rows ?? []).map(toRow), [rows]);

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

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    const rowsInScope = model.filter((row) => {
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
  }, [model, search, kindFilter, hasRange, range, sort]);

  const filtered = visible.length !== model.length;

  const select = useCallback((finding: Finding) => {
    setSelected({ kind: "finding", row: finding });
  }, []);

  const spanLabel =
    summary.firstUtc === null || summary.lastUtc === null
      ? "no dated downloads"
      : summary.firstUtc.slice(0, 10) === summary.lastUtc.slice(0, 10)
        ? formatDay(summary.firstUtc.slice(0, 10))
        : `${formatDay(summary.firstUtc.slice(0, 10))} — ${formatDay(summary.lastUtc.slice(0, 10))}`;

  return (
    <div className="flex flex-col gap-4">

      {error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The downloads could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{error}</p>
          </div>
          <Button onClick={retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : rows === null ? (
        <div className="flex flex-col gap-3" aria-label="Loading downloads">
          <p
            className="text-[12.5px] text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {pages === 0
              ? "Reading downloads…"
              : `Reading downloads… ${pages.toLocaleString("en-US")} page${
                  pages === 1 ? "" : "s"
                } loaded`}
          </p>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
          </div>
          <Skeleton className="h-[250px] w-full rounded-lg" />
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </div>
      ) : model.length === 0 ? (
        <SectionCard title="Downloads">
          <EmptyRows message="No downloads recorded in this Case." />
        </SectionCard>
      ) : (
        <>
          {!complete ? (
            <div
              role="alert"
              className="rounded-md border border-warning-border bg-warning-wash px-3 py-2 text-[12.5px] text-warning"
            >
              These figures cover the first{" "}
              {model.length.toLocaleString("en-US")} downloads read — the most
              this page loads at once. More rows exist in the Case.
            </div>
          ) : null}

          {/* Summary — a plain reading of the set: how many files, how much
              data left the machine, from how many sources, and how many
              transfers did not finish. Every figure is a count of fields the
              rows already carry, never an inference. */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile
              label="Files downloaded"
              value={summary.total.toLocaleString("en-US")}
              note={spanLabel}
            />
            <StatTile
              label="Data transferred"
              value={formatBytes(summary.bytes)}
              note={
                summary.sized === summary.total
                  ? "recorded total size"
                  : `across ${summary.sized.toLocaleString("en-US")} sized rows`
              }
            />
            <StatTile
              label="Source hosts"
              value={summary.hosts.toLocaleString("en-US")}
              note="distinct download origins"
            />
            <StatTile
              label="Did not finish"
              value={summary.unfinished.toLocaleString("en-US")}
              note="interrupted or cancelled"
            />
          </div>

          {/* Volume over time — the hero, full width. Drag across it to focus
              the table below on a date range, the same gesture the Timeline
              and History activity charts use. */}
          <SectionCard
            title="Downloads over time"
            description="Bytes per recorded day. Drag to focus the table."
            action={
              hasRange ? (
                <button
                  type="button"
                  onClick={() => {
                    setRange({ from: "", to: "" });
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-[12px] font-medium text-foreground/80 transition-colors duration-150 hover:text-foreground"
                >
                  {range.from === "" ? "…" : formatTick(range.from)} —{" "}
                  {range.to === "" ? "…" : formatTick(range.to)}
                  <X aria-hidden="true" className="size-3" />
                  <span className="sr-only">Clear the date range</span>
                </button>
              ) : null
            }
          >
            <VolumeChart rows={model} range={range} onRangeChange={setRange} />
          </SectionCard>

          {/* File kinds + sources — the two lenses an examiner scans a
              downloads set through, side by side. Clicking a file kind
              focuses the table below on it. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard
              title="By file kind"
              description="Click a kind to focus the table."
            >
              <KindBreakdown
                rows={model}
                activeKind={kindFilter}
                onKind={onKind}
              />
            </SectionCard>
            <SectionCard title="Top sources" description="By total bytes.">
              <SourceHosts rows={model} />
            </SectionCard>
          </div>

          {/* The raw rows. */}
          <div
            ref={tableRef}
            className={cn(
              "scroll-mt-4 rounded-lg transition-shadow duration-300",
              pulsing && "ring-2 ring-primary/60",
            )}
          >
          <SectionCard title="All downloads" count={visible.length}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-2.5">
              {kindFilter !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setKindFilter(null);
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-accent-border bg-accent px-2.5 text-[12px] font-medium text-accent-foreground transition-colors duration-150"
                >
                  {KIND_META[kindFilter].label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Clear the file-kind filter</span>
                </button>
              ) : null}
              {hasRange ? (
                <button
                  type="button"
                  onClick={() => {
                    setRange({ from: "", to: "" });
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 text-[12px] font-medium text-foreground/80 transition-colors duration-150 hover:text-foreground"
                >
                  {range.from === "" ? "…" : formatTick(range.from)} —{" "}
                  {range.to === "" ? "…" : formatTick(range.to)}
                  <X aria-hidden="true" className="size-3" />
                  <span className="sr-only">Clear the date range</span>
                </button>
              ) : null}
              <label className="relative ml-auto">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder="Search file, path, or source"
                  aria-label="Search loaded downloads"
                  className="h-8 w-[240px] rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No loaded downloads match these filters."
                    : "No downloads in this Case."
                }
              />
            ) : (
              <DownloadsTable
                rows={visible}
                sort={sort}
                onSort={onSort}
                onSelect={select}
              />
            )}

            <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
              <p
                className="text-[12.5px] text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {filtered
                  ? `${String(visible.length)} of ${String(model.length)} downloads shown`
                  : `${String(model.length)} download${model.length === 1 ? "" : "s"} shown`}
              </p>
            </div>
          </SectionCard>
          </div>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
