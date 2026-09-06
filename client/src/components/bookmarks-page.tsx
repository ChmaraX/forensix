/**
 * The Bookmarks page.
 *
 * Bookmarks are the one evidence kind the subject *curated* — every row is a
 * page they chose to keep and a folder they chose to file it under. So this
 * page reads them as a collection, not a log: the folder tree they built, the
 * cadence at which they saved, and which sites they returned to often, then
 * the full row table underneath. Every figure is a plain reading of fields the
 * evidence already carries (`name`, `url`, `dateAdded`, `folderPath`,
 * `sourceFile`); nothing is smoothed, projected, or scored.
 *
 * Widgets, each a direct grouping of the returned rows:
 *  1. A calm figure strip (saved pages, folders used, distinct sites,
 *     recovered-from-backup) in the Overview's masthead-readout voice.
 *  2. A folder map — the subject's own bookmark hierarchy rebuilt from
 *     `folderPath`, with per-branch counts and weight bars. Clicking a branch
 *     focuses the table on it. This is the reading unique to bookmarks: it
 *     shows the *structure* the person imposed, which no flat table carries.
 *  3. Saved over time — bookmarks added per calendar month from `dateAdded`,
 *     zero-filled between the first and last month so cadence reads as real
 *     calendar time; the busiest month is marked. Undated rows are disclosed
 *     as their own worded figure, never folded silently into a month.
 *  4. Most-bookmarked sites — a host-frequency leaderboard, the same bar
 *     treatment the Downloads page uses for its sources.
 *
 * The raw table keeps every wire field reachable through the row detail sheet.
 * Columns are curated, not the sparse union grid: Folder (the TYPE-lead column
 * for this artifact — the curated bucket each row belongs to), Bookmark (name
 * over URL), Added, Source (primary file vs. recovered backup), and the Commit
 * State word.
 *
 * Presentation rules kept (see app.tsx's header): the Completeness Statement
 * ("Evidence coverage") renders before any row; the four value states stay
 * worded ("absent" for a missing value), never colour alone; the recovered
 * source keeps its own word; no month is invented past the last recorded save.
 * This page is read-only: it starts no ingest, reruns no analysis, and writes
 * nothing back to the Case.
 */
import { ChevronRight, Folder, FolderOpen, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  Finding,
  PageOf,
} from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";

/* --------------------------------- reads ---------------------------------- */

/** Above this many pages the read stops; the page then says it is partial. */
const BOOKMARKS_PAGE_CAP = 150;

/**
 * Reads every bookmark row (up to the page cap), newest first. The real API
 * paginates; the read follows the cursor until it runs out, so the widgets
 * cover the whole Case rather than one page. `complete` is false only when the
 * cap was hit before the cursor did.
 */
function useBookmarks(route: string) {
  const [rows, setRows] = useState<readonly Finding[] | null>(null);
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      const collected: Finding[] = [];
      let after: string | null = null;
      let hitCap = true;
      for (let page = 0; page < BOOKMARKS_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["sort", "date-added"],
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
        if (after === null) {
          hitCap = false;
          break;
        }
      }
      if (cancelled) {
        return;
      }
      setRows(collected);
      setComplete(!hitCap || after === null);
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

  return { rows, complete, error, retry };
}

/* ------------------------------- formatting ------------------------------- */

/** "Dec 2024" label for a `YYYY-MM` month key. */
function formatMonth(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return monthKey;
  }
  return parsed.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short "Dec '24" tick for the cadence axis. */
function formatMonthShort(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return monthKey;
  }
  const month = parsed.toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} '${monthKey.slice(2, 4)}`;
}

/* ----------------------------- derived model ------------------------------ */

interface BookmarkRow {
  readonly finding: Finding;
  readonly name: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly folderPath: string | null;
  readonly folderSegments: readonly string[];
  readonly addedUtc: string | null;
  readonly source: string | null;
}

/** Splits a "Bookmarks Bar / Finance" path into trimmed, non-empty segments. */
function segmentsOf(path: string | null): readonly string[] {
  if (path === null) {
    return [];
  }
  return path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toRow(finding: Finding): BookmarkRow {
  const url = fieldText(finding.fields.url);
  const folderPath = fieldText(finding.fields.folderPath);
  return {
    finding,
    name: fieldText(finding.fields.name),
    url,
    host: hostOf(url),
    folderPath,
    folderSegments: segmentsOf(folderPath),
    addedUtc: fieldUtc(finding.fields.dateAdded),
    source: fieldText(finding.fields.sourceFile),
  };
}

/**
 * Whether a row came from the recovered backup copy rather than the live
 * bookmarks file. Chrome writes a `Bookmarks.bak` alongside `Bookmarks`;
 * a row read from the `.bak` is evidence the live copy did not carry.
 */
function isBackupSource(source: string | null): boolean {
  return source !== null && source.toLowerCase().includes(".bak");
}

/* -------------------------------- widgets --------------------------------- */

function FigureBlock({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {detail === undefined ? null : (
        <span className="truncate text-[11.5px] text-muted-foreground">
          {detail}
        </span>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  count,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly count?: number;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
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
      </header>
      {children}
    </section>
  );
}

/* ------------------------------- folder map ------------------------------- */

interface FolderNode {
  readonly name: string;
  /** Full path from the root down to and including this node. */
  readonly path: string;
  readonly depth: number;
  /** Bookmarks filed directly in this folder (not in a subfolder). */
  readonly direct: number;
  /** Bookmarks in this folder and every folder beneath it. */
  readonly total: number;
  readonly children: readonly FolderNode[];
}

/**
 * Rebuilds the subject's bookmark folder hierarchy from the `folderPath` of
 * every row. `direct` is bookmarks filed straight in a folder; `total` rolls
 * up the subtree. Rows with no recorded folder are excluded here and surfaced
 * as their own worded line in the card, so absence stays visible.
 */
function buildFolderTree(rows: readonly BookmarkRow[]): {
  readonly roots: readonly FolderNode[];
  readonly unfiled: number;
} {
  interface Builder {
    name: string;
    path: string;
    depth: number;
    direct: number;
    total: number;
    children: Map<string, Builder>;
  }
  const roots = new Map<string, Builder>();
  let unfiled = 0;

  for (const row of rows) {
    if (row.folderSegments.length === 0) {
      unfiled += 1;
      continue;
    }
    let level = roots;
    let pathSoFar = "";
    let node: Builder | null = null;
    row.folderSegments.forEach((segment, index) => {
      pathSoFar = pathSoFar === "" ? segment : `${pathSoFar} / ${segment}`;
      let child = level.get(segment);
      if (child === undefined) {
        child = {
          name: segment,
          path: pathSoFar,
          depth: index,
          direct: 0,
          total: 0,
          children: new Map(),
        };
        level.set(segment, child);
      }
      child.total += 1;
      node = child;
      level = child.children;
    });
    if (node !== null) {
      (node as Builder).direct += 1;
    }
  }

  const freeze = (builder: Builder): FolderNode => ({
    name: builder.name,
    path: builder.path,
    depth: builder.depth,
    direct: builder.direct,
    total: builder.total,
    children: [...builder.children.values()]
      .sort((left, right) => right.total - left.total)
      .map(freeze),
  });

  return {
    roots: [...roots.values()]
      .sort((left, right) => right.total - left.total)
      .map(freeze),
    unfiled,
  };
}

function FolderBranch({
  node,
  peak,
  activePath,
  onPick,
}: {
  readonly node: FolderNode;
  readonly peak: number;
  readonly activePath: string | null;
  readonly onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(node.depth === 0);
  const hasChildren = node.children.length > 0;
  const active = activePath === node.path;
  const share = peak === 0 ? 0 : Math.round((node.total / peak) * 100);
  const Icon = open && hasChildren ? FolderOpen : Folder;

  return (
    <li>
      <div
        className={cn(
          "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md py-1.5 pr-2 transition-colors duration-150",
          active ? "bg-accent" : "hover:bg-muted",
        )}
        style={{ paddingLeft: `${String(8 + node.depth * 16)}px` }}
      >
        <span className="flex items-center gap-1">
          {hasChildren ? (
            <button
              type="button"
              aria-label={open ? "Collapse folder" : "Expand folder"}
              aria-expanded={open}
              onClick={() => {
                setOpen((value) => !value);
              }}
              className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  open && "rotate-90",
                )}
              />
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block size-4 shrink-0" />
          )}
          <Icon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0",
              active ? "text-accent-foreground" : "text-foreground/45",
            )}
          />
        </span>
        <button
          type="button"
          aria-pressed={active}
          onClick={() => {
            onPick(node.path);
          }}
          className="flex min-w-0 items-center gap-2 text-left"
          title={`Focus the table on "${node.path}"`}
        >
          <span
            className={cn(
              "truncate text-[12.5px] font-medium",
              active && "text-accent-foreground",
            )}
          >
            {node.name}
          </span>
          <span className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
            <span
              className={cn(
                "block h-full rounded-full",
                node.total === peak ? "bg-primary" : "bg-primary/45",
              )}
              style={{ width: `${String(share)}%` }}
            />
          </span>
        </button>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
          {node.total.toLocaleString("en-US")}
          {node.direct !== node.total ? (
            <span className="ml-1 text-[11px] opacity-70">
              ({node.direct.toLocaleString("en-US")})
            </span>
          ) : null}
        </span>
      </div>
      {hasChildren && open ? (
        <ul>
          {node.children.map((child) => (
            <FolderBranch
              key={child.path}
              node={child}
              peak={peak}
              activePath={activePath}
              onPick={onPick}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function FolderMap({
  rows,
  activePath,
  onPick,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly activePath: string | null;
  readonly onPick: (path: string) => void;
}) {
  const { roots, unfiled } = useMemo(() => buildFolderTree(rows), [rows]);
  const peak = useMemo(
    () => roots.reduce((max, node) => Math.max(max, node.total), 0),
    [roots],
  );

  if (roots.length === 0 && unfiled === 0) {
    return <EmptyRows message="No folders recorded on these bookmarks." />;
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col gap-0.5 p-2">
        {roots.map((node) => (
          <FolderBranch
            key={node.path}
            node={node}
            peak={peak}
            activePath={activePath}
            onPick={onPick}
          />
        ))}
      </ul>
      <p className="border-t border-border/70 px-4 py-2 text-[11.5px] text-muted-foreground">
        Count is the folder and everything beneath it; the value in{" "}
        <span className="font-mono">(brackets)</span> is filed directly here.
        {unfiled > 0
          ? ` ${unfiled.toLocaleString("en-US")} bookmark${unfiled === 1 ? "" : "s"} had no recorded folder.`
          : ""}
      </p>
    </div>
  );
}

/* ------------------------------ save cadence ------------------------------ */

interface MonthBucket {
  readonly month: string;
  readonly count: number;
}

/**
 * Bookmarks added per calendar month, from `dateAdded`. The range between the
 * first and last recorded month is zero-filled so the cadence reads as real
 * calendar time (a long quiet gap looks like a gap), bounded so a pathological
 * span never draws thousands of empty columns.
 */
function buildMonths(rows: readonly BookmarkRow[]): {
  readonly months: readonly MonthBucket[];
  readonly undated: number;
} {
  const byMonth = new Map<string, number>();
  let undated = 0;
  for (const row of rows) {
    if (row.addedUtc === null) {
      undated += 1;
      continue;
    }
    const month = row.addedUtc.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const recorded = [...byMonth.keys()].sort();
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  if (first === undefined || last === undefined) {
    return { months: [], undated };
  }
  const months: MonthBucket[] = [];
  const [startYear, startMonth] = first.split("-").map(Number);
  const [endYear, endMonth] = last.split("-").map(Number);
  let year = startYear ?? 0;
  let month = startMonth ?? 1;
  // Guard the fill: at most ~5 years of columns, else draw only recorded ones.
  const spanMonths =
    ((endYear ?? 0) - (startYear ?? 0)) * 12 +
    ((endMonth ?? 1) - (startMonth ?? 1));
  if (spanMonths > 60) {
    return {
      months: recorded.map((key) => ({
        month: key,
        count: byMonth.get(key) ?? 0,
      })),
      undated,
    };
  }
  for (let index = 0; index <= spanMonths; index += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push({ month: key, count: byMonth.get(key) ?? 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { months, undated };
}

function SaveCadence({ rows }: { readonly rows: readonly BookmarkRow[] }) {
  const { months, undated } = useMemo(() => buildMonths(rows), [rows]);
  const peak = useMemo(
    () => months.reduce((max, bucket) => Math.max(max, bucket.count), 0),
    [months],
  );
  const busiest = useMemo(
    () => months.find((bucket) => bucket.count === peak && peak > 0) ?? null,
    [months, peak],
  );

  if (months.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <p className="text-center text-[13px] text-muted-foreground">
          No dated bookmarks to chart.
          {undated > 0
            ? ` ${undated.toLocaleString("en-US")} had no recorded date.`
            : ""}
        </p>
      </div>
    );
  }

  // Bars are drawn at explicit pixel heights off a fixed track — a percentage
  // height on a flex child does not resolve against a flex-basis parent, so
  // the column height is computed here instead of deferred to CSS.
  const TRACK = 150;

  return (
    <div className="flex flex-1 flex-col justify-between gap-3 px-4 py-4">
      <div
        className="flex items-end gap-[3px]"
        style={{ height: `${String(TRACK)}px` }}
        role="img"
        aria-label="Bookmarks added per month"
      >
        {months.map((bucket) => {
          const filled =
            peak === 0 ? 0 : Math.max(Math.round((bucket.count / peak) * TRACK), 6);
          const isBusiest = busiest !== null && bucket.month === busiest.month;
          return (
            <div
              key={bucket.month}
              className="group relative flex min-w-0 flex-1 flex-col justify-end"
              title={`${formatMonth(bucket.month)}: ${bucket.count.toLocaleString("en-US")} saved`}
            >
              <span
                className={cn(
                  "w-full rounded-t-[3px] transition-colors duration-150",
                  bucket.count === 0
                    ? "bg-muted"
                    : isBusiest
                      ? "bg-primary"
                      : "bg-primary/45 group-hover:bg-primary/70",
                )}
                style={{ height: `${String(bucket.count === 0 ? 2 : filled)}px` }}
              />
            </div>
          );
        })}
      </div>

      {/* A sparse month axis — first, busiest, and last, so the row stays
          readable however many columns there are. */}
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground tabular-nums">
        <span>{formatMonthShort(months[0]?.month ?? "")}</span>
        {busiest !== null &&
        months.length > 2 &&
        busiest.month !== months[0]?.month &&
        busiest.month !== months[months.length - 1]?.month ? (
          <span className="font-medium text-foreground/70">
            {formatMonthShort(busiest.month)}
          </span>
        ) : null}
        <span>{formatMonthShort(months[months.length - 1]?.month ?? "")}</span>
      </div>

      {busiest !== null ? (
        <p className="text-[11.5px] text-muted-foreground">
          Busiest month:{" "}
          <span className="font-medium text-foreground/80">
            {formatMonth(busiest.month)}
          </span>{" "}
          — {busiest.count.toLocaleString("en-US")} saved.
          {undated > 0
            ? ` ${undated.toLocaleString("en-US")} bookmark${undated === 1 ? "" : "s"} had no recorded date.`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------ site leaders ------------------------------ */

/** How many hosts the leaders card lists before "and N more". */
const HOST_LIMIT = 6;

/**
 * Which sites the subject bookmarked most — a host-frequency leaderboard.
 * The one reading that surfaces "this person kept coming back to save pages
 * from here" out of a flat list.
 */
function SiteLeaders({ rows }: { readonly rows: readonly BookmarkRow[] }) {
  const hosts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.host === null) {
        continue;
      }
      const host = row.host.replace(/^www\./, "");
      map.set(host, (map.get(host) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((left, right) => right.count - left.count);
  }, [rows]);

  if (hosts.length === 0) {
    return <EmptyRows message="No parseable site on these bookmarks." />;
  }
  const peak = hosts[0]?.count ?? 0;

  return (
    <ol className="flex flex-col p-2">
      {hosts.slice(0, HOST_LIMIT).map((entry, index) => {
        const share = peak === 0 ? 0 : Math.round((entry.count / peak) * 100);
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
              <span className="shrink-0 font-mono text-[12px] tabular-nums">
                {entry.count.toLocaleString("en-US")}
              </span>
            </div>
          </li>
        );
      })}
      {hosts.length > HOST_LIMIT ? (
        <li className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
          and {hosts.length - HOST_LIMIT} more site
          {hosts.length - HOST_LIMIT === 1 ? "" : "s"} in the table below
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
 * The source file as a plain word: the live `Bookmarks` file is the boring
 * default and sits muted; a row recovered from the `.bak` copy keeps its own
 * hue *and* the word "Backup" so the source never rides on colour alone.
 */
function SourceWord({ source }: { readonly source: string | null }) {
  if (source === null) {
    return <AbsentWord />;
  }
  const backup = isBackupSource(source);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]",
        backup ? "font-medium text-violet" : "text-muted-foreground",
      )}
      title={source}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          backup ? "bg-violet" : "bg-muted-foreground/50",
        )}
      />
      {backup ? "Backup" : "Primary"}
    </span>
  );
}

function BookmarksTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly onSelect: (finding: Finding) => void;
}) {
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {["Folder", "Bookmark", "Added", "Source", "State"].map((label) => (
              <th
                key={label}
                className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              tabIndex={0}
              aria-label="Open bookmark row detail"
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
              <td className="max-w-[200px] px-3 py-2.5">
                {row.folderPath === null ? (
                  <span className="text-muted-foreground italic">
                    no folder
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
                    title={row.folderPath}
                  >
                    <Folder aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {row.folderSegments[row.folderSegments.length - 1] ??
                        row.folderPath}
                    </span>
                  </span>
                )}
              </td>
              <td className="max-w-[380px] px-3 py-2.5">
                <span className="flex items-center gap-2.5">
                  <SiteAvatar host={row.host} />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="truncate text-[13px] font-medium text-foreground/90"
                      title={row.name ?? undefined}
                    >
                      {row.name ?? row.host ?? "(untitled)"}
                    </span>
                    <span
                      className="truncate font-mono text-[11.5px] text-muted-foreground"
                      title={row.url ?? undefined}
                    >
                      {row.url ?? ""}
                    </span>
                  </span>
                </span>
              </td>
              <td className="px-3 py-2.5">
                <TimeCell utc={row.addedUtc} />
              </td>
              <td className="px-3 py-2.5">
                <SourceWord source={row.source} />
              </td>
              <td className="px-3 py-2.5">
                <StateWord state={row.finding.commitState} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function BookmarksPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const { rows, complete, error, retry } = useBookmarks(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  const model = useMemo(() => (rows ?? []).map(toRow), [rows]);

  const summary = useMemo(() => {
    const folders = new Set<string>();
    const hosts = new Set<string>();
    let backup = 0;
    for (const row of model) {
      if (row.folderPath !== null) {
        folders.add(row.folderPath);
      }
      if (row.host !== null) {
        hosts.add(row.host.replace(/^www\./, ""));
      }
      if (isBackupSource(row.source)) {
        backup += 1;
      }
    }
    return {
      total: model.length,
      folders: folders.size,
      hosts: hosts.size,
      backup,
    };
  }, [model]);

  // Focusing a folder branch shows that folder and everything nested beneath
  // it — the path prefix match — so clicking "Bookmarks Bar" keeps its
  // subfolders visible rather than only its direct rows.
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return model.filter((row) => {
      if (folderFilter !== null) {
        const path = row.folderPath;
        if (
          path === null ||
          !(path === folderFilter || path.startsWith(`${folderFilter} /`))
        ) {
          return false;
        }
      }
      if (query === "") {
        return true;
      }
      const haystack = [row.name ?? "", row.url ?? "", row.folderPath ?? ""]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [model, search, folderFilter]);

  const filtered = visible.length !== model.length;

  const select = useCallback((finding: Finding) => {
    setSelected({ kind: "finding", row: finding });
  }, []);

  const pickFolder = useCallback((path: string) => {
    setFolderFilter((current) => (current === path ? null : path));
  }, []);

  return (
    <div className="flex flex-col gap-4">

      {error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The bookmarks could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{error}</p>
          </div>
          <Button onClick={retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : rows === null ? (
        <div className="flex flex-col gap-3" aria-label="Loading bookmarks">
          <Skeleton className="h-[92px] w-full rounded-lg" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-[320px] rounded-lg" />
            <Skeleton className="h-[320px] rounded-lg" />
          </div>
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </div>
      ) : model.length === 0 ? (
        <SectionCard title="Bookmarks">
          <EmptyRows message="No bookmarks recorded in this Case." />
        </SectionCard>
      ) : (
        <>
          {!complete ? (
            <div
              role="alert"
              className="rounded-md border border-warning-border bg-warning-wash px-3 py-2 text-[12.5px] text-warning"
            >
              These figures cover the first{" "}
              {model.length.toLocaleString("en-US")} bookmarks read — the most
              this page loads at once. More rows exist in the Case.
            </div>
          ) : null}

          {/* Figure strip — the collection at a glance, in the Overview's
              calm masthead-readout voice. Every figure is a direct read of
              the rows below, never a new query or an invented number. */}
          <section className="rounded-lg border border-border bg-card px-5 py-4">
            <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
              <FigureBlock
                label="Saved pages"
                value={summary.total.toLocaleString("en-US")}
              />
              <FigureBlock
                label="Folders used"
                value={summary.folders.toLocaleString("en-US")}
              />
              <FigureBlock
                label="Distinct sites"
                value={summary.hosts.toLocaleString("en-US")}
              />
              <FigureBlock
                label="From backup"
                value={summary.backup.toLocaleString("en-US")}
                detail="recovered from Bookmarks.bak"
              />
            </div>
          </section>

          {/* Folder map + save cadence — the two readings that turn a flat
              list into the curated collection it is: the structure the person
              built, and the rhythm at which they built it. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard
              title="Folder map"
              description="Click a folder to focus the table."
            >
              <FolderMap
                rows={model}
                activePath={folderFilter}
                onPick={pickFolder}
              />
            </SectionCard>
            <SectionCard
              title="Saved over time"
              description="Bookmarks added per month."
            >
              <SaveCadence rows={model} />
            </SectionCard>
          </div>

          {/* Most-bookmarked sites — where the subject kept returning to save. */}
          <SectionCard
            title="Most-bookmarked sites"
            description="By number of saved pages."
          >
            <SiteLeaders rows={model} />
          </SectionCard>

          {/* The raw rows. */}
          <SectionCard title="All bookmarks" count={model.length}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-2.5">
              {folderFilter !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setFolderFilter(null);
                  }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-accent-border bg-accent px-2.5 text-[12px] font-medium text-accent-foreground transition-colors duration-150"
                  title={folderFilter}
                >
                  <Folder aria-hidden="true" className="size-3" />
                  <span className="max-w-[220px] truncate">{folderFilter}</span>
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Clear the folder filter</span>
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
                  placeholder="Search name, URL, or folder"
                  aria-label="Search loaded bookmarks"
                  className="h-8 w-[240px] rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No loaded bookmarks match this filter."
                    : "No bookmarks in this Case."
                }
              />
            ) : (
              <BookmarksTable rows={visible} onSelect={select} />
            )}

            <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
              <p
                className="text-[12.5px] text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {filtered
                  ? `${String(visible.length)} of ${String(model.length)} bookmarks shown`
                  : `${String(model.length)} bookmark${model.length === 1 ? "" : "s"} shown`}
              </p>
            </div>
          </SectionCard>
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
