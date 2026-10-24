/**
 * Downloads data: the drained reads (saved, WAL, journal), the file-kind
 * rule (MIME type, then extension) and the derived row model the page's
 * figures, widgets and lists share. Split out of `downloads-page.tsx`; no
 * behaviour of its own.
 */
import {
  DownloadedFileIcon,
  FILE_KIND_ICONS,
  type AppIcon,
} from "@/lib/app-icons";
import type { CommitState, Finding } from "../types.js";
import { fieldInteger, fieldText, fieldUtc, hostOf } from "./finding-fields.js";
import { useDrainedRead } from "./use-drained-read.js";

/* --------------------------------- reads ---------------------------------- */

/** Above this many pages the read stops; the page then says it is partial. */
export const DOWNLOADS_PAGE_CAP = 150;

/**
 * Reads every download row of one Commit State (up to the page cap), newest
 * first. The real API paginates; the read follows the cursor until it runs
 * out, so the aggregates below cover the whole Case rather than one page.
 * The first page paints at once and the rest drain in the background
 * (`draining`, `useDrainedRead`), every request abortable. `complete` is
 * false while draining and when the cap was hit before the cursor ran out.
 * Each Commit State is its own server read (forensic rule 4): saved rows
 * never mix with WAL- or journal-resident ones.
 */
export function useDownloads(route: string, commitState: CommitState) {
  return useDrainedRead(
    route,
    [
      ["sort", "start-time"],
      ["direction", "desc"],
      ["limit", "100"],
      ["commit-state", commitState],
    ],
    DOWNLOADS_PAGE_CAP,
  );
}

export type DownloadsRead = ReturnType<typeof useDownloads>;

/** The recovered downloads: the WAL read, then the journal read, joined in
 *  that order (never interleaved). Ready once both reads have a first page;
 *  draining while either still reads. */
export function joinRecovered(wal: DownloadsRead, journal: DownloadsRead) {
  return {
    rows:
      wal.rows === null || journal.rows === null
        ? null
        : [...wal.rows, ...journal.rows],
    complete: wal.complete && journal.complete,
    draining: wal.draining || journal.draining,
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
export function fileNameOf(path: string | null): string | null {
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
export type FileKind =
  | "executable"
  | "archive"
  | "document"
  | "spreadsheet"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "other";

export const KIND_META: Readonly<
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
export const KIND_ORDER: readonly FileKind[] = [
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

export const EXTENSION_KIND: Readonly<Record<string, FileKind>> = {
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

export function extensionOf(name: string | null): string | null {
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
export function kindOf(mime: string | null, name: string | null): FileKind {
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
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** What the lists sort by. */
export type SortKey =
  | "started"
  | "type"
  | "file"
  | "size"
  | "source"
  | "outcome";

/** Toolbar order and wording of the sort keys. */
export const SORT_KEYS: readonly SortKey[] = [
  "started",
  "type",
  "file",
  "size",
  "source",
  "outcome",
];

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  started: "Started",
  type: "Type",
  file: "File",
  size: "Size",
  source: "Source",
  outcome: "Outcome",
};

/** What the direction toggle says, per key ("newest first", not
 *  "descending"). */
export const DIRECTION_WORDS: Readonly<
  Record<SortKey, { readonly desc: string; readonly asc: string }>
> = {
  started: { desc: "newest first", asc: "oldest first" },
  type: { desc: "reverse kind order", asc: "kind order" },
  file: { desc: "Z to A", asc: "A to Z" },
  size: { desc: "largest first", asc: "smallest first" },
  source: { desc: "Z to A", asc: "A to Z" },
  outcome: { desc: "Z to A", asc: "A to Z" },
};

export interface SortState {
  readonly key: SortKey;
  readonly dir: "asc" | "desc";
}

export interface DownloadRow {
  readonly finding: Finding;
  readonly name: string | null;
  readonly path: string | null;
  readonly host: string | null;
  readonly sourceUrl: string | null;
  /** Bytes Chrome recorded as received (`receivedBytes`): what reached
   *  the disk. Every figure, bar and size reads this. */
  readonly received: number | null;
  /** The size Chrome expected (`totalBytes`), when it recorded one above
   *  zero: shown beside the received bytes, never counted as received. */
  readonly expected: number | null;
  readonly startUtc: string | null;
  readonly state: string | null;
  readonly kind: FileKind;
}

export function toRow(finding: Finding): DownloadRow {
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
    received: fieldInteger(finding.fields.receivedBytes),
    expected: positive(fieldInteger(finding.fields.totalBytes)),
    startUtc: fieldUtc(finding.fields.startTime),
    state: fieldText(finding.fields.state),
    kind: kindOf(mime, name),
  };
}

/** Chrome writes an unknown total as 0 (or -1): no expected size. */
function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** How a recorded `state` value reads, plain-worded. Unknown values pass
 *  through verbatim rather than being reshaped into one this page invented;
 *  a state with no recorded value keeps its field's own word (absent,
 *  (empty), unavailable) in the table. */
export const STATE_LABEL: Readonly<Record<string, string>> = {
  complete: "Complete",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** The two states that mean a transfer did not finish cleanly — the ones an
 *  examiner counts, not a colour badge. */
export function isUnfinished(state: string | null): boolean {
  return (
    state === "interrupted" || state === "cancelled" || state === "canceled"
  );
}

/** Orders two rows by one column, ascending; the caller flips for descending.
 *  Nulls sort last in ascending order (an absent size or time is not "zero"). */
export function compareRows(
  a: DownloadRow,
  b: DownloadRow,
  key: SortKey,
): number {
  switch (key) {
    case "type":
      return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    case "file":
      return (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff", "en-US");
    case "size":
      // The size a row shows: received bytes, else the expected size.
      return (
        (a.received ?? a.expected ?? -1) - (b.received ?? b.expected ?? -1)
      );
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
