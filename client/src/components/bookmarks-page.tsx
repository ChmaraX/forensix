/**
 * The Bookmarks page.
 *
 * Bookmarks are the one evidence kind the subject *curated* — every row is a
 * page they chose to keep and a folder they chose to file it under. So this
 * page reads them as a collection, not a log: the folder tree they built, the
 * cadence at which they saved, and which sites they returned to often, then
 * the full row lists. Every figure is a plain reading of fields the evidence
 * already carries (`name`, `url`, `dateAdded`, `folderPath`, `sourceFile`);
 * nothing is smoothed, projected, or scored.
 *
 * Sections, each a direct grouping of the saved rows:
 *  1. A figure strip (saved bookmarks, folders used, distinct sites, rows
 *     read from the `.bak` backup copy).
 *  2. Saved over time — bookmarks added per calendar month from `dateAdded`,
 *     zero-filled between the first and last month so cadence reads as real
 *     calendar time; the busiest month is marked. Undated rows are disclosed
 *     as their own worded figure, never folded silently into a month.
 *  3. Most-bookmarked sites — a host-frequency leaderboard; picking a site
 *     narrows the lists to it.
 *  4. The folder navigator beside the lists — the subject's own bookmark
 *     hierarchy rebuilt from `folderPath`, with per-branch counts. Picking a
 *     folder focuses both lists on that folder and everything beneath it.
 *
 * Saved bookmarks and bookmarks recovered from WAL / journal sidecars are
 * separate server reads (`useCommitStateLists`, every page followed so the
 * figures cover the whole set) and separate lists (the Saved / Recovered
 * switch), never sorted together; every figure counts saved rows only.
 * Columns are curated: Folder (the TYPE-lead column for this artifact),
 * Bookmark (name over URL), Added, Source (live file vs. `.bak` backup), and
 * the Commit State word; every wire field stays reachable in the row sheet.
 * Missing values read as their own state word. This page is read-only.
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

import { Panel } from "@/components/panel";
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
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, CaseCompleteness, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import {
  BookmarksCadence,
  formatMonth,
  type MonthBucket,
} from "./bookmarks-cadence.js";
import { ChartSection } from "./chart-section.js";
import { ChartEmpty, useChartTokens } from "./charts.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  FieldCell,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CommitStateSplit,
  plural,
  SectionPanel,
  ShareBar,
  TimeCell,
  WeightLabel,
  type CommitView,
} from "./page-kit.js";

/* --------------------------------- reads ---------------------------------- */

const BOOKMARK_PARAMETERS: QueryParameters = [
  ["sort", "date-added"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Above this many rows per list the read stops; the page then says the
 *  figures are partial. */
const BOOKMARK_ROW_CAP = 15_000;

/** Follows a list's cursor until it runs out or the cap is hit. Returns
 *  whether the read has settled. */
function useDrained(list: PaginatedList<Finding>): boolean {
  const { loading, error, cursor, rows, loadMore } = list;
  useEffect(() => {
    if (
      !loading &&
      error === null &&
      cursor !== null &&
      rows.length < BOOKMARK_ROW_CAP
    ) {
      loadMore();
    }
  }, [loading, error, cursor, rows.length, loadMore]);
  return !loading && (cursor === null || rows.length >= BOOKMARK_ROW_CAP);
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
 * Whether a row came from the backup copy rather than the live bookmarks
 * file. Chrome writes a `Bookmarks.bak` alongside `Bookmarks`; a row read
 * from the `.bak` is evidence the live copy did not carry.
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
    for (const [index, segment] of row.folderSegments.entries()) {
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
    }
    if (node !== null) {
      node.direct += 1;
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

/** Indent per tree level, the inset of the first level, and the chevron
 *  button's box, in px. */
const TREE_STEP = 16;
const TREE_INSET = 4;
const CHEVRON_BOX = 24;

/** Focus ring for the navigator's own buttons (FF's 1px focus ring). */
const BUTTON_FOCUS =
  "outline-none focus-visible:ring-1 focus-visible:ring-focus-ring";

/**
 * One navigator row. The row is the choice (it focuses the lists on the
 * folder and is what the fluid hover registers); the chevron is its own
 * 24px button over the row's leading edge, so opening a branch never changes
 * the focus. The chevron comes first in the DOM — it is drawn on the left —
 * so Tab walks a row left to right: expand, then pick.
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
  const size = useSize();
  useRegisterFluidHoverItem(registerItem, index, ref);
  const lead = TREE_INSET + depth * TREE_STEP;
  const Icon =
    icon === "library" ? Library : open === true ? FolderOpen : Folder;
  return (
    // One grid cell holds both buttons, so the chevron sits over the row's
    // leading edge without a positioned <li> — a positioned ancestor would
    // become the row's offsetParent and throw off the fluid hover measure.
    <li className="grid">
      {onToggle === undefined ? null : (
        <button
          type="button"
          aria-label={open === true ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open === true}
          onClick={onToggle}
          className={cn(
            "relative z-10 col-start-1 row-start-1 inline-flex size-6 cursor-pointer items-center justify-center self-center justify-self-start rounded-md text-muted-foreground transition-colors duration-80 hover:text-foreground",
            BUTTON_FOCUS,
          )}
          style={{ marginLeft: `${String(lead)}px` }}
        >
          <motion.span
            className="inline-flex"
            initial={false}
            animate={{ rotate: open === true ? 90 : 0 }}
            transition={spring.fast}
          >
            <ChevronRight
              aria-hidden="true"
              size={size.icon}
              strokeWidth={1.5}
            />
          </motion.span>
        </button>
      )}
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        aria-label={`${label}, ${plural(count, "saved bookmark", "saved bookmarks")}`}
        onClick={onPick}
        className={cn(
          "relative col-start-1 row-start-1 flex h-9 w-full cursor-pointer items-center gap-2 pr-3 text-left transition-colors duration-80",
          BUTTON_FOCUS,
          shape.item,
          active ? "bg-active text-foreground" : "text-muted-foreground",
        )}
        style={{ paddingLeft: `${String(lead + CHEVRON_BOX + 4)}px` }}
      >
        <Icon
          aria-hidden="true"
          size={size.icon}
          className={cn(
            "shrink-0 transition-colors duration-80",
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
    </li>
  );
}

/**
 * The folder navigator: "All bookmarks", then the subject's own hierarchy,
 * counted over the saved bookmarks. Top-level folders start open. Picking a
 * folder focuses both lists on it and everything nested beneath it; picking
 * it again (or "All bookmarks") clears the focus.
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
  const listRef = useRef<HTMLDivElement>(null);
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
      id="bookmarks-folders"
      title="Folders"
      description="Saved bookmarks per folder. Pick one to focus the lists."
    >
      {roots.length === 0 ? (
        <ChartEmpty>No folders recorded on the saved bookmarks.</ChartEmpty>
      ) : (
        <nav aria-label="Bookmark folders">
          <div ref={listRef} {...hover.handlers} className="relative px-1 pb-1">
            <FluidHoverHighlight hover={hover} className={shape.item} />
            <ul className="flex flex-col">
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
          </div>
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
          ? ` ${plural(unfiled, "saved bookmark", "saved bookmarks")} had no recorded folder.`
          : ""}
      </p>
    </SectionPanel>
  );
}

/* ------------------------------ save cadence ------------------------------ */

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

/** The cadence chart panel: the bars, then the busiest month and any undated
 *  rows as worded figures in the footer. */
function SaveCadence({
  rows,
  className,
}: {
  readonly rows: readonly BookmarkRow[];
  readonly className?: string;
}) {
  const tokens = useChartTokens();
  const { months, undated } = useMemo(() => buildMonths(rows), [rows]);
  const busiest = useMemo(() => {
    let best: MonthBucket | null = null;
    for (const bucket of months) {
      if (bucket.count > 0 && (best === null || bucket.count > best.count)) {
        best = bucket;
      }
    }
    return best;
  }, [months]);
  const undatedNote =
    undated > 0
      ? `${plural(undated, "saved bookmark", "saved bookmarks")} had no recorded date.`
      : null;
  return (
    <ChartSection
      className={className}
      title="Saved over time"
      description="Saved bookmarks added per month."
      footer={
        busiest === null && undatedNote === null ? undefined : (
          <p className={cn(typeClass("caption"), "text-muted-foreground")}>
            {busiest === null ? null : (
              <>
                Busiest month:{" "}
                <span className="text-foreground">
                  {formatMonth(busiest.month)}
                </span>{" "}
                — {busiest.count.toLocaleString("en-US")} saved.{" "}
              </>
            )}
            {undatedNote}
          </p>
        )
      }
    >
      <div className="h-[220px] px-2 pt-2 pb-3">
        {months.length === 0 ? (
          <ChartEmpty>No dated saved bookmarks to chart.</ChartEmpty>
        ) : (
          <BookmarksCadence months={months} tokens={tokens} />
        )}
      </div>
    </ChartSection>
  );
}

/* ------------------------------ site leaders ------------------------------ */

/** How many hosts the leaders card lists before "and N more". */
const HOST_LIMIT = 6;

function hostTallies(rows: readonly BookmarkRow[]) {
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
}

/**
 * Which sites the subject bookmarked most — a host-frequency leaderboard over
 * the saved bookmarks. Picking a site narrows the lists to it.
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
  const hosts = useMemo(() => hostTallies(rows), [rows]);
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();

  if (hosts.length === 0) {
    return <ChartEmpty>No parseable site on the saved bookmarks.</ChartEmpty>;
  }
  const peak = hosts[0]?.count ?? 0;

  return (
    <>
      <div ref={listRef} {...hover.handlers} className="relative px-1 pb-1">
        <FluidHoverHighlight hover={hover} className={shape.item} />
        <ol className="flex flex-col">
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
      </div>
      {hosts.length > HOST_LIMIT ? (
        <p
          className={cn(
            typeClass("caption"),
            "border-t border-border px-4 py-2.5 text-muted-foreground",
          )}
        >
          and {plural(hosts.length - HOST_LIMIT, "more site", "more sites")} in
          the lists
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
        aria-label={`${host}, ${plural(count, "saved bookmark", "saved bookmarks")}`}
        onClick={() => {
          onPick(host);
        }}
        className={cn(
          "relative grid h-9 w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_6rem_2rem] items-center gap-3 px-3 text-left transition-colors duration-80",
          BUTTON_FOCUS,
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
        <ShareBar fraction={peak === 0 ? 0 : count / peak} />
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
 * default ("Primary"); a row read from the `.bak` copy reads "Backup" in the
 * foreground beside a neutral dot — a source, not a Commit State, so it never
 * borrows the sidecar hues. A missing source reads its own state word.
 */
function SourceWord({ row }: { readonly row: BookmarkRow }) {
  if (row.source === null) {
    return <FieldCell field={row.finding.fields.sourceFile} />;
  }
  const backup = isBackupSource(row.source);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap",
        backup && "text-foreground",
      )}
      title={row.source}
    >
      {backup ? <EvidenceDot state="committed" /> : null}
      {backup ? "Backup" : "Primary"}
    </span>
  );
}

function FolderCell({ row }: { readonly row: BookmarkRow }) {
  const size = useSize();
  if (row.folderPath === null) {
    return <FieldCell field={row.finding.fields.folderPath} />;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={row.folderPath}>
      <Folder
        aria-hidden="true"
        size={size.icon}
        strokeWidth={1.5}
        className="shrink-0"
      />
      <span className="truncate">
        {row.folderSegments[row.folderSegments.length - 1] ?? row.folderPath}
      </span>
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
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            {["Folder", "Bookmark", "Added", "Source", "State"].map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => (
            <TableRow
              key={index}
              index={index}
              tabIndex={0}
              aria-label={`Open bookmark ${row.name ?? row.url ?? "with no recorded name or URL"}`}
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
              <TableCell className="max-w-[160px]">
                <FolderCell row={row} />
              </TableCell>
              <TableCell className="max-w-[340px]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <SiteAvatar host={row.host} />
                  <span className="flex min-w-0 flex-col">
                    {row.name === null ? (
                      <FieldCell field={row.finding.fields.name} />
                    ) : (
                      <span
                        className="truncate text-foreground"
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    )}
                    {row.url === null ? (
                      <span className={typeClass("caption")}>
                        <FieldCell field={row.finding.fields.url} />
                      </span>
                    ) : (
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
                </span>
              </TableCell>
              <TableCell>
                <TimeCell field={row.finding.fields.dateAdded} />
              </TableCell>
              <TableCell>
                <SourceWord row={row} />
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

/** One list (saved or recovered) with its loading, error, empty and footer. */
function BookmarkList({
  list,
  rows,
  visible,
  noun,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly rows: readonly BookmarkRow[];
  readonly visible: readonly BookmarkRow[];
  readonly noun: "saved" | "recovered";
  readonly onSelect: (finding: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const firstLoad = list.loading && rows.length === 0;
  if (list.error !== null && rows.length === 0) {
    return (
      <ErrorRows
        title={`The ${noun} bookmarks could not be loaded.`}
        message={list.error}
        onRetry={list.retry}
      />
    );
  }
  const filtered = visible.length !== rows.length;
  const word = (count: number) =>
    plural(count, `${noun} bookmark`, `${noun} bookmarks`);
  return (
    <>
      <div className="reveal-swap">
        <LoadingRows rows={3} label={`Loading ${noun} bookmarks`} />
        {firstLoad ? null : visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No ${noun} bookmarks match these filters.`
                : noun === "saved"
                  ? "No saved bookmarks in this Case."
                  : "No bookmarks were recovered from WAL or journal sidecars."
            }
            action={
              filtered ? (
                <Button
                  variant="tertiary"
                  size="compact"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <BookmarksTable rows={visible} onSelect={onSelect} />
        )}
      </div>
      {list.error !== null ? (
        <ErrorRows
          title={`More ${noun} bookmarks could not be loaded.`}
          message={list.error}
          onRetry={list.cursor === null ? list.retry : list.loadMore}
        />
      ) : null}
      {firstLoad ? null : (
        <ListFooter
          count={visible.length}
          cursor={list.cursor}
          loading={list.loading}
          onLoadMore={list.loadMore}
          summary={
            filtered
              ? `${visible.length.toLocaleString("en-US")} of ${word(rows.length)} shown`
              : `${word(rows.length)} shown`
          }
        />
      )}
    </>
  );
}

/** Placeholder at the size of the strip and the two charts. */
function BookmarksSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading bookmark figures"
    >
      <Skeleton className="h-[160px] w-full rounded-xl lg:h-[86px]" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[310px] rounded-xl lg:col-span-7 lg:h-[320px]" />
        <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

/** Focusing a folder keeps the folder and everything nested beneath it. */
function inFolder(row: BookmarkRow, folder: string): boolean {
  const path = row.folderPath;
  return path !== null && (path === folder || path.startsWith(`${folder} /`));
}

/* ---------------------------------- page ---------------------------------- */

export function BookmarksPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
  const lists = useCommitStateLists<Finding>(config.route, BOOKMARK_PARAMETERS);
  const savedDone = useDrained(lists.saved);
  useDrained(lists.recovered);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  const saved = useMemo(() => lists.saved.rows.map(toRow), [lists.saved.rows]);
  const recovered = useMemo(
    () => lists.recovered.rows.map(toRow),
    [lists.recovered.rows],
  );

  const summary = useMemo(() => {
    const folders = new Set<string>();
    const hosts = new Set<string>();
    let backup = 0;
    for (const row of saved) {
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
      total: saved.length,
      folders: folders.size,
      hosts: hosts.size,
      backup,
    };
  }, [saved]);

  const narrow = useCallback(
    (rows: readonly BookmarkRow[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return rows.filter((row) => {
        if (folderFilter !== null && !inFolder(row, folderFilter)) {
          return false;
        }
        if (query === "") {
          return true;
        }
        const haystack = [row.name ?? "", row.url ?? "", row.folderPath ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, folderFilter],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

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

  const clearFilters = useCallback(() => {
    setSearch("");
    setFolderFilter(null);
  }, []);

  const savedFirst = lists.saved.loading && saved.length === 0;
  const recoveredFirst = lists.recovered.loading && recovered.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    savedDone &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    saved.length === 0 &&
    recovered.length === 0;
  const figuresReady = savedDone || lists.saved.error !== null;
  const showFigures =
    !figuresReady || (lists.saved.error === null && saved.length > 0);
  const capped = savedDone && lists.saved.cursor !== null;

  const listPanel = (
    <SectionPanel
      id="bookmarks-list"
      className="min-w-0"
      title={folderFilter ?? "All bookmarks"}
      description={
        folderFilter === null
          ? "Saved bookmarks and bookmarks recovered from WAL or journal sidecars are separate lists."
          : "This folder and everything filed beneath it."
      }
      aside={
        folderFilter === null ? undefined : (
          <Button
            variant="tertiary"
            size="compact"
            onClick={() => {
              setFolderFilter(null);
            }}
          >
            Show all folders
          </Button>
        )
      }
    >
      <CommitStateSplit
        value={view}
        onValueChange={setView}
        label="Saved or recovered bookmarks"
        savedCount={
          savedFirst || (lists.saved.error !== null && saved.length === 0)
            ? null
            : saved.length
        }
        recoveredCount={
          recoveredFirst ||
          (lists.recovered.error !== null && recovered.length === 0)
            ? null
            : recovered.length
        }
        savedMore={lists.saved.cursor !== null}
        recoveredMore={lists.recovered.cursor !== null}
        toolbar={
          <FilterTextField
            commit="change"
            label="Search loaded bookmarks"
            placeholder="Search name, URL, or folder"
            icon={Search}
            value={search}
            onCommit={setSearch}
          />
        }
        saved={
          <BookmarkList
            list={lists.saved}
            rows={saved}
            visible={savedVisible}
            noun="saved"
            onSelect={select}
            onClearFilters={clearFilters}
          />
        }
        recovered={
          <BookmarkList
            list={lists.recovered}
            rows={recovered}
            visible={recoveredVisible}
            noun="recovered"
            onSelect={select}
            onClearFilters={clearFilters}
          />
        }
      />
    </SectionPanel>
  );

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={Bookmark}
            title="No bookmarks"
            message="No bookmarks recorded in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <BookmarksSkeleton />
              {figuresReady ? (
                <div className="flex flex-col gap-5">
                  {capped ? (
                    <Banner status="warning" contrast="high">
                      <BannerTitle>
                        These figures cover part of the Case
                      </BannerTitle>
                      <BannerDescription>
                        They read the first{" "}
                        {saved.length.toLocaleString("en-US")} saved bookmarks —
                        the most this page loads at once. More rows exist in the
                        Case.
                      </BannerDescription>
                    </Banner>
                  ) : null}

                  {/* Figure strip — the saved collection at a glance. Every
                      figure is a direct read of the saved rows below. */}
                  <MetricBand className="grid-cols-2 lg:grid-cols-4">
                    <MetricBandItem
                      label="Saved bookmarks"
                      value={`${summary.total.toLocaleString("en-US")}${capped ? "+" : ""}`}
                      detail="recovered rows are listed apart"
                    />
                    <MetricBandItem
                      label="Folders used"
                      value={summary.folders.toLocaleString("en-US")}
                      detail="distinct recorded folder paths"
                    />
                    <MetricBandItem
                      label="Distinct sites"
                      value={summary.hosts.toLocaleString("en-US")}
                      detail="hosts of the saved URLs"
                    />
                    <MetricBandItem
                      label="From backup"
                      value={summary.backup.toLocaleString("en-US")}
                      detail="read from Bookmarks.bak"
                    />
                  </MetricBand>

                  {/* Cadence + sites — the rhythm at which the collection
                      was built, and where the subject kept returning. */}
                  <div className="grid grid-cols-12 gap-4">
                    <SaveCadence
                      rows={saved}
                      className="col-span-12 lg:col-span-7"
                    />
                    <SectionPanel
                      id="bookmarks-sites"
                      title="Most-bookmarked sites"
                      description="Saved bookmarks per site. Pick one to narrow the lists."
                      className="col-span-12 lg:col-span-5"
                      aside={
                        <Badge size="compact" className="tabular-nums">
                          {plural(summary.hosts, "site", "sites")}
                        </Badge>
                      }
                    >
                      <SiteLeaders
                        rows={saved}
                        activeHost={search === "" ? null : search}
                        onPick={pickHost}
                      />
                    </SectionPanel>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* The folder navigator beside the rows it focuses: the structure
              the person built, next to what they filed. */}
          {showFigures ? (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="reveal-swap lg:sticky lg:top-14">
                <div role="status" aria-label="Loading bookmark folders">
                  <Skeleton className="h-[240px] w-full rounded-xl" />
                </div>
                {figuresReady ? (
                  <FolderNavigator
                    rows={saved}
                    activePath={folderFilter}
                    onPick={pickFolder}
                  />
                ) : null}
              </div>
              {listPanel}
            </div>
          ) : (
            listPanel
          )}
        </>
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
