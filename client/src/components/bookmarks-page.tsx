/**
 * The Bookmarks page.
 *
 * Bookmarks are the one evidence kind the subject *curated* — every row is a
 * page they chose to keep and a folder they chose to file it under. So this
 * page reads them as a collection, not a log: the folder tree they built, the
 * cadence at which they saved, and which sites they returned to often, then
 * the full row table. Every figure is a plain reading of fields the evidence
 * already carries (`name`, `url`, `dateAdded`, `folderPath`, `sourceFile`);
 * nothing is smoothed, projected, or scored.
 *
 * Sections, each a direct grouping of the returned rows:
 *  1. A figure strip (saved pages, folders used, distinct sites,
 *     recovered-from-backup).
 *  2. Saved over time — bookmarks added per calendar month from `dateAdded`,
 *     zero-filled between the first and last month so cadence reads as real
 *     calendar time; the busiest month is marked. Undated rows are disclosed
 *     as their own worded figure, never folded silently into a month.
 *  3. Most-bookmarked sites — a host-frequency leaderboard; picking a site
 *     narrows the table to it.
 *  4. The folder navigator beside the table — the subject's own bookmark
 *     hierarchy rebuilt from `folderPath`, with per-branch counts. Picking a
 *     folder focuses the table on that folder and everything beneath it. This
 *     is the reading unique to bookmarks: it shows the *structure* the person
 *     imposed, which no flat table carries.
 *
 * The table keeps every wire field reachable through the row detail sheet.
 * Columns are curated: Folder (the TYPE-lead column for this artifact — the
 * curated bucket each row belongs to), Bookmark (name over URL), Added, Source
 * (primary file vs. recovered backup), and the Commit State word. Saved rows
 * and rows recovered from WAL / journal sidecars are separate lists (the
 * Saved / Recovered switch), never sorted together.
 *
 * Presentation rules kept (see app.tsx's header): the four value states stay
 * worded ("absent" for a missing value), never colour alone; the recovered
 * source keeps its own word; no month is invented past the last recorded
 * save. This page is read-only: it starts no ingest, reruns no analysis, and
 * writes nothing back to the Case.
 */
import {
  Bookmark,
  ChevronRight,
  Folder,
  FolderOpen,
  Library,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Panel,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  Finding,
  PageOf,
} from "../types.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import {
  AbsentWord,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { plural, SectionPanel, TimeCell, WeightLabel } from "./page-kit.js";

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

/* ------------------------------- folder tree ------------------------------ */

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
 * as their own worded line under the tree, so absence stays visible.
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

/** The tree as the rows currently on screen: a node's children follow it
 *  only while it is open. One flat list keeps the fluid hover indices
 *  contiguous, so the highlight walks the visible rows in reading order. */
function visibleFolders(
  roots: readonly FolderNode[],
  open: ReadonlySet<string>,
): readonly FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (nodes: readonly FolderNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length > 0 && open.has(node.path)) {
        walk(node.children);
      }
    }
  };
  walk(roots);
  return out;
}

/** Indent per tree level, and the inset of the first level, in px. */
const TREE_STEP = 16;
const TREE_INSET = 8;

/**
 * One navigator row. The row itself is the choice (it focuses the table on
 * the folder and is what the fluid hover registers); the chevron is its own
 * small button laid over the row's leading edge, so opening a branch never
 * changes the focus.
 */
function FolderRow({
  index,
  registerItem,
  depth,
  label,
  count,
  direct,
  icon,
  active,
  open,
  onPick,
  onToggle,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly depth: number;
  readonly label: string;
  readonly count: number;
  /** Rows filed directly here, shown when it differs from `count`. */
  readonly direct?: number;
  readonly icon: "library" | "folder";
  readonly active: boolean;
  /** Undefined for a row with no children. */
  readonly open?: boolean;
  readonly onPick: () => void;
  readonly onToggle?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  useRegisterFluidHoverItem(registerItem, index, ref);
  const lead = TREE_INSET + depth * TREE_STEP;
  const Icon =
    icon === "library" ? Library : open === true ? FolderOpen : Folder;
  return (
    // One grid cell holds both buttons, so the chevron sits over the row's
    // leading edge without a positioned <li> — a positioned ancestor would
    // become the row's offsetParent and throw off the fluid hover measure.
    <li className="grid">
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        onClick={onPick}
        className={cn(
          "relative col-start-1 row-start-1 flex h-9 w-full cursor-pointer items-center gap-2 pr-3 text-left transition-colors duration-80",
          shape.item,
          active ? "bg-active text-foreground" : "text-muted-foreground",
        )}
        style={{ paddingLeft: `${String(lead + 22)}px` }}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-colors duration-80",
            active ? "text-foreground" : "text-muted-foreground",
          )}
          strokeWidth={active ? 2 : 1.5}
        />
        <WeightLabel
          text={label}
          active={active}
          className={cn(typeClass("body"), "flex-1 text-foreground")}
        />
        <span
          className={cn(
            typeClass("caption"),
            "shrink-0 text-muted-foreground tabular-nums",
          )}
        >
          {count.toLocaleString("en-US")}
          {direct !== undefined && direct !== count ? (
            <span> ({direct.toLocaleString("en-US")})</span>
          ) : null}
        </span>
      </button>
      {onToggle === undefined ? null : (
        <button
          type="button"
          aria-label={open === true ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open === true}
          onClick={onToggle}
          className="relative z-10 col-start-1 row-start-1 inline-flex size-5 cursor-pointer items-center justify-center self-center justify-self-start rounded-md text-muted-foreground transition-colors duration-80 hover:text-foreground"
          style={{ marginLeft: `${String(lead)}px` }}
        >
          <motion.span
            className="inline-flex"
            initial={false}
            animate={{ rotate: open === true ? 90 : 0 }}
            transition={spring.fast}
          >
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </motion.span>
        </button>
      )}
    </li>
  );
}

/**
 * The folder navigator: "All bookmarks", then the subject's own hierarchy.
 * Top-level folders start open. Picking a folder focuses the table on it and
 * everything nested beneath it; picking it again (or "All bookmarks") clears
 * the focus.
 */
function FolderNavigator({
  rows,
  activePath,
  onPick,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly activePath: string | null;
  readonly onPick: (path: string | null) => void;
}) {
  const { roots, unfiled } = useMemo(() => buildFolderTree(rows), [rows]);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(roots.map((node) => node.path)),
  );
  const flat = useMemo(() => visibleFolders(roots, open), [roots, open]);
  const listRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();

  const toggle = useCallback((path: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <SectionPanel
      title="Folders"
      description="Pick a folder to focus the table."
    >
      {roots.length === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-1 pb-4 text-muted-foreground",
          )}
        >
          No folders recorded on these bookmarks.
        </p>
      ) : (
        <nav aria-label="Bookmark folders">
          <ul
            ref={listRef}
            {...hover.handlers}
            className="relative flex flex-col px-1 pb-1"
          >
            <FluidHoverHighlight hover={hover} className={shape.item} />
            <FolderRow
              index={0}
              registerItem={hover.registerItem}
              depth={0}
              label="All bookmarks"
              count={rows.length}
              icon="library"
              active={activePath === null}
              onPick={() => {
                onPick(null);
              }}
            />
            {flat.map((node, index) => (
              <FolderRow
                key={node.path}
                index={index + 1}
                registerItem={hover.registerItem}
                depth={node.depth}
                label={node.name}
                count={node.total}
                direct={node.direct}
                icon="folder"
                active={activePath === node.path}
                open={
                  node.children.length > 0 ? open.has(node.path) : undefined
                }
                onPick={() => {
                  onPick(node.path);
                }}
                onToggle={
                  node.children.length > 0
                    ? () => {
                        toggle(node.path);
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </nav>
      )}
      <p
        className={cn(
          typeClass("caption"),
          "border-t border-border px-4 py-2.5 text-muted-foreground",
        )}
      >
        Count is the folder and everything beneath it; the figure in (brackets)
        is filed directly there.
        {unfiled > 0
          ? ` ${plural(unfiled, "bookmark", "bookmarks")} had no recorded folder.`
          : ""}
      </p>
    </SectionPanel>
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

/** Column track height, in px. A percentage height on a flex child does not
 *  resolve against a flex-basis parent, so bar heights are computed here. */
const CADENCE_TRACK = 160;

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
      <p
        className={cn(
          typeClass("body"),
          "px-4 pt-1 pb-4 text-muted-foreground",
        )}
      >
        No dated bookmarks to chart.
        {undated > 0
          ? ` ${plural(undated, "bookmark", "bookmarks")} had no recorded date.`
          : ""}
      </p>
    );
  }

  const lastIndex = months.length - 1;
  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pt-2 pb-4">
      <div
        role="img"
        aria-label={`Bookmarks added per month, ${formatMonth(months[0]?.month ?? "")} to ${formatMonth(months[lastIndex]?.month ?? "")}`}
        className="flex flex-col gap-2"
      >
        <div
          className="flex items-end gap-1"
          style={{ height: `${String(CADENCE_TRACK)}px` }}
        >
          {months.map((bucket) => {
            const height =
              bucket.count === 0 || peak === 0
                ? 2
                : Math.max(
                    Math.round((bucket.count / peak) * CADENCE_TRACK),
                    6,
                  );
            const isBusiest =
              busiest !== null && bucket.month === busiest.month;
            return (
              <Tooltip
                key={bucket.month}
                content={`${formatMonth(bucket.month)} · ${bucket.count.toLocaleString("en-US")} saved`}
              >
                <span className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <span
                    className={cn(
                      "w-full max-w-12 rounded-t-[4px]",
                      bucket.count === 0
                        ? "bg-active"
                        : isBusiest
                          ? "bg-foreground opacity-90"
                          : "bg-foreground opacity-35",
                    )}
                    style={{ height: `${String(height)}px` }}
                  />
                </span>
              </Tooltip>
            );
          })}
        </div>

        {/* A sparse month axis — first, busiest, and last, each centred
            under its own column, so the row stays readable however many
            columns there are. */}
        <div
          aria-hidden="true"
          className={cn(
            typeClass("caption"),
            "flex gap-1 text-muted-foreground tabular-nums",
          )}
        >
          {months.map((bucket, index) => {
            const isBusiest =
              busiest !== null && bucket.month === busiest.month;
            const shown = index === 0 || index === lastIndex || isBusiest;
            return (
              <span
                key={bucket.month}
                className={cn(
                  "flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap",
                  months.length > 6 && index === 0 && "justify-start",
                  months.length > 6 && index === lastIndex && "justify-end",
                  isBusiest && "text-foreground",
                )}
              >
                {shown ? formatMonthShort(bucket.month) : null}
              </span>
            );
          })}
        </div>
      </div>

      {busiest !== null ? (
        <p className={cn(typeClass("caption"), "text-muted-foreground")}>
          Busiest month:{" "}
          <span className="text-foreground">{formatMonth(busiest.month)}</span>{" "}
          — {busiest.count.toLocaleString("en-US")} saved.
          {undated > 0
            ? ` ${plural(undated, "bookmark", "bookmarks")} had no recorded date.`
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
 * from here" out of a flat list. Picking a site narrows the table to it.
 */
function SiteLeaders({
  rows,
  activeHost,
  onPick,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly activeHost: string | null;
  readonly onPick: (host: string) => void;
}) {
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
  const listRef = useRef<HTMLOListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();

  if (hosts.length === 0) {
    return (
      <p
        className={cn(
          typeClass("body"),
          "px-4 pt-1 pb-4 text-muted-foreground",
        )}
      >
        No parseable site on these bookmarks.
      </p>
    );
  }
  const peak = hosts[0]?.count ?? 0;

  return (
    <>
      <ol
        ref={listRef}
        {...hover.handlers}
        className="relative flex flex-col px-1 pb-1"
      >
        <FluidHoverHighlight hover={hover} className={shape.item} />
        {hosts.slice(0, HOST_LIMIT).map((entry, index) => (
          <SiteRow
            key={entry.host}
            index={index}
            registerItem={hover.registerItem}
            host={entry.host}
            count={entry.count}
            peak={peak}
            active={activeHost === entry.host}
            onPick={onPick}
          />
        ))}
      </ol>
      {hosts.length > HOST_LIMIT ? (
        <p
          className={cn(
            typeClass("caption"),
            "border-t border-border px-4 py-2.5 text-muted-foreground",
          )}
        >
          and {plural(hosts.length - HOST_LIMIT, "more site", "more sites")} in
          the table
        </p>
      ) : null}
    </>
  );
}

function SiteRow({
  index,
  registerItem,
  host,
  count,
  peak,
  active,
  onPick,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly host: string;
  readonly count: number;
  readonly peak: number;
  readonly active: boolean;
  readonly onPick: (host: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        onClick={() => {
          onPick(host);
        }}
        className={cn(
          "relative grid h-9 w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_6rem_2rem] items-center gap-3 px-3 text-left transition-colors duration-80",
          shape.item,
          active && "bg-active",
        )}
      >
        <span
          className={cn(
            typeClass("caption"),
            "text-center text-muted-foreground tabular-nums",
          )}
        >
          {index + 1}
        </span>
        <span className="flex min-w-0 items-center gap-2.5">
          <SiteAvatar host={host} />
          <WeightLabel
            text={host}
            active={active}
            className={cn(typeClass("body"), "text-foreground")}
          />
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-active">
          <span
            className={cn(
              "block h-full rounded-full bg-foreground",
              index === 0 ? "opacity-90" : "opacity-45",
            )}
            style={{
              width: peak === 0 ? "0%" : `${String((count / peak) * 100)}%`,
            }}
          />
        </span>
        <span
          className={cn(
            typeClass("body"),
            "text-right text-muted-foreground tabular-nums",
          )}
        >
          {count.toLocaleString("en-US")}
        </span>
      </button>
    </li>
  );
}

/* --------------------------------- table ---------------------------------- */

/**
 * The source file as a plain word: the live `Bookmarks` file is the quiet
 * default; a row recovered from the `.bak` copy keeps its own dot *and* the
 * word "Backup" in the foreground, so the source never rides on colour alone.
 */
function SourceWord({ source }: { readonly source: string | null }) {
  if (source === null) {
    return <AbsentWord />;
  }
  const backup = isBackupSource(source);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap",
        backup && "text-foreground",
      )}
      title={source}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          backup ? "bg-violet" : "bg-muted-foreground",
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
    <div className="scroll-fade-x overflow-x-auto px-1 pb-1">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            {["Folder", "Bookmark", "Added", "Source", "State"].map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={index}
              index={index}
              tabIndex={0}
              aria-label={`Open bookmark ${row.name ?? row.url ?? ""}`}
              onClick={() => {
                onSelect(row.finding);
              }}
              onKeyDown={(event) => {
                activateOnKey(event, () => {
                  onSelect(row.finding);
                });
              }}
              className={ROW_FOCUS_CLASS}
            >
              <TableCell className="max-w-[150px]">
                {row.folderPath === null ? (
                  <span className="whitespace-nowrap">no folder</span>
                ) : (
                  <span
                    className="flex min-w-0 items-center gap-1.5"
                    title={row.folderPath}
                  >
                    <Folder aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {row.folderSegments[row.folderSegments.length - 1] ??
                        row.folderPath}
                    </span>
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-[280px]">
                <span className="flex min-w-0 flex-col">
                  <span
                    className="truncate text-foreground"
                    title={row.name ?? undefined}
                  >
                    {row.name ?? row.host ?? "(untitled)"}
                  </span>
                  {row.url === null ? null : (
                    <span
                      className={cn(
                        typeClass("caption"),
                        "truncate font-mono text-muted-foreground",
                      )}
                      title={row.url}
                    >
                      {row.url}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell>
                <TimeCell utc={row.addedUtc} />
              </TableCell>
              <TableCell>
                <SourceWord source={row.source} />
              </TableCell>
              <TableCell>
                <StateWord state={row.finding.commitState} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type View = "saved" | "recovered";

function BookmarkListPanel({
  rows,
  folderFilter,
  onClearFolder,
  search,
  onSearch,
  onSelect,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly folderFilter: string | null;
  readonly onClearFolder: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (finding: Finding) => void;
}) {
  const [view, setView] = useState<View>("saved");
  const size = useSize("compact");

  const saved = useMemo(
    () => rows.filter((row) => row.finding.commitState === "committed"),
    [rows],
  );
  const recovered = useMemo(
    () => rows.filter((row) => row.finding.commitState !== "committed"),
    [rows],
  );
  const base = view === "saved" ? saved : recovered;

  // Focusing a folder shows that folder and everything nested beneath it —
  // the path prefix match — so focusing "Bookmarks Bar" keeps its subfolders
  // visible rather than only its direct rows.
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return base.filter((row) => {
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
  }, [base, search, folderFilter]);

  const filtered = visible.length !== base.length;
  const noun = view === "saved" ? "saved" : "recovered";

  return (
    <Panel className="min-w-0 overflow-clip">
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>{folderFilter ?? "All bookmarks"}</PanelTitle>
          <PanelDescription>
            {folderFilter === null
              ? "Saved bookmarks and bookmarks recovered from WAL or journal sidecars are kept as separate lists."
              : "This folder and everything filed beneath it."}
          </PanelDescription>
        </div>
        {folderFilter === null ? null : (
          <Button variant="tertiary" size="compact" onClick={onClearFolder}>
            Show all folders
          </Button>
        )}
      </PanelHeader>
      <SizeProvider size="compact">
        <div
          className={cn(
            "flex flex-wrap items-center gap-y-2 px-4 pt-1 pb-3",
            size.gap,
          )}
        >
          <Tabs
            value={view}
            onValueChange={(next) => {
              setView(next === "recovered" ? "recovered" : "saved");
            }}
          >
            <TabsList aria-label="Saved or recovered bookmarks">
              <TabItem
                value="saved"
                label={`Saved ${saved.length.toLocaleString("en-US")}`}
              />
              <TabItem
                value="recovered"
                label={`Recovered ${recovered.length.toLocaleString("en-US")}`}
              />
            </TabsList>
          </Tabs>
          <FilterTextField
            label="Search loaded bookmarks"
            placeholder="Search name, URL, or folder"
            icon={Search}
            value={search}
            onCommit={onSearch}
            className="ml-auto w-60"
          />
        </div>
      </SizeProvider>

      <div className="border-t border-border">
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No ${noun} bookmarks match this filter.`
                : view === "saved"
                  ? "No saved bookmarks in this Case."
                  : "No bookmarks were recovered from WAL or journal sidecars."
            }
          />
        ) : (
          <BookmarksTable rows={visible} onSelect={onSelect} />
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
        <p
          className={cn(
            typeClass("caption"),
            "text-muted-foreground tabular-nums",
          )}
          aria-live="polite"
        >
          {filtered
            ? `${visible.length.toLocaleString("en-US")} of ${base.length.toLocaleString("en-US")} ${noun} bookmarks shown`
            : `${plural(base.length, `${noun} bookmark`, `${noun} bookmarks`)} shown`}
        </p>
      </div>
    </Panel>
  );
}

/** Placeholder at the size of the strip and the two charts. */
function BookmarksSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-7" />
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function BookmarksPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
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

  const select = useCallback((finding: Finding) => {
    setSelected({ kind: "finding", row: finding });
  }, []);

  const pickFolder = useCallback((path: string | null) => {
    setFolderFilter((current) =>
      path === null || current === path ? null : path,
    );
  }, []);

  const pickHost = useCallback((host: string) => {
    setSearch((current) => (current === host ? "" : host));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {error !== null ? (
        <ErrorRows
          title="The bookmarks could not be loaded."
          message={error}
          onRetry={retry}
          className="px-0 py-0"
        />
      ) : rows !== null && model.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={Bookmark}
            title="No bookmarks"
            message="No bookmarks recorded in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <BookmarksSkeleton />
          {rows === null ? null : (
            <div className="flex flex-col gap-4">
              {!complete ? (
                <Banner status="warning" contrast="high">
                  <BannerTitle>
                    These figures cover part of the Case
                  </BannerTitle>
                  <BannerDescription>
                    They read the first {model.length.toLocaleString("en-US")}{" "}
                    bookmarks — the most this page loads at once. More rows
                    exist in the Case.
                  </BannerDescription>
                </Banner>
              ) : null}

              {/* Figure strip — the collection at a glance. Every figure is
                  a direct read of the rows below, never a new query or an
                  invented number. */}
              <MetricBand className="grid-cols-2 lg:grid-cols-4">
                <MetricBandItem
                  label="Saved pages"
                  value={summary.total.toLocaleString("en-US")}
                />
                <MetricBandItem
                  label="Folders used"
                  value={summary.folders.toLocaleString("en-US")}
                />
                <MetricBandItem
                  label="Distinct sites"
                  value={summary.hosts.toLocaleString("en-US")}
                />
                <MetricBandItem
                  label="From backup"
                  value={summary.backup.toLocaleString("en-US")}
                  detail="recovered from Bookmarks.bak"
                  tone="warning"
                />
              </MetricBand>

              {/* Cadence + sites — the rhythm at which the collection was
                  built, and where the subject kept returning to save. */}
              <div className="grid grid-cols-12 gap-4">
                <SectionPanel
                  title="Saved over time"
                  description="Bookmarks added per month."
                  className="col-span-12 lg:col-span-7"
                >
                  <SaveCadence rows={model} />
                </SectionPanel>
                <SectionPanel
                  title="Most-bookmarked sites"
                  description="Pick a site to narrow the table."
                  className="col-span-12 lg:col-span-5"
                  aside={
                    <Badge size="compact" className="tabular-nums">
                      {plural(summary.hosts, "site", "sites")}
                    </Badge>
                  }
                >
                  <SiteLeaders
                    rows={model}
                    activeHost={search === "" ? null : search}
                    onPick={pickHost}
                  />
                </SectionPanel>
              </div>

              {/* The folder navigator beside the rows it focuses: the
                  structure the person built, next to what they filed. */}
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="lg:sticky lg:top-14">
                  <FolderNavigator
                    rows={model}
                    activePath={folderFilter}
                    onPick={pickFolder}
                  />
                </div>
                <BookmarkListPanel
                  rows={model}
                  folderFilter={folderFilter}
                  onClearFolder={() => {
                    setFolderFilter(null);
                  }}
                  search={search}
                  onSearch={setSearch}
                  onSelect={select}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={fieldText(selected.row.fields.name) ?? "Bookmark"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
