/**
 * The Bookmarks page.
 *
 * Bookmarks are the one evidence kind the subject *curated* — every row is a
 * page they chose to keep and a folder they chose to file it under. So this
 * page reads them as a collection, not a log: a figure strip (saved
 * bookmarks, folders, distinct sites, rows read from the `.bak` backup copy),
 * then the folder tree they built beside the row lists. Every figure is a
 * plain reading of fields the evidence already carries (`name`, `url`,
 * `dateAdded`, `folderPath`, `sourceFile`).
 *
 * The folder navigator rebuilds the subject's own hierarchy from
 * `folderPath`, with per-branch counts; picking a folder focuses both lists
 * on that folder and everything beneath it.
 *
 * Saved bookmarks and bookmarks recovered from WAL / journal sidecars are
 * separate server reads (`useCommitStateLists`, every page followed so the
 * figures cover the whole set) and separate lists (the Saved / Recovered
 * tabs); every figure counts saved rows only. Columns are curated: Folder
 * (the TYPE-lead column for this artifact), Bookmark (name over URL), Added,
 * Source (live file vs. `.bak` backup), and — in the Recovered tab — the
 * Commit State word; every wire field stays reachable in the row sheet.
 * Missing values read as their own state word. This page is read-only.
 */
import { motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Panel } from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import {
  ARTIFACT_ICONS,
  ChevronRightIcon,
  FolderIcon,
  LibraryIcon,
  OpenFolderIcon,
  SearchIcon,
} from "@/lib/app-icons";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { ChartEmpty } from "./charts.js";
import { EmptyRows } from "./data-table.js";
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
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CommitStateSplit,
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  WeightLabel,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";
import { Term } from "./term.js";

/* --------------------------------- reads ---------------------------------- */

const BOOKMARK_PARAMETERS: QueryParameters = [
  ["sort", "date-added"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Above this many rows per list the read stops; the page then says the
 *  figures are partial. */
const BOOKMARK_ROW_CAP = 15_000;

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
    icon === "library"
      ? LibraryIcon
      : open === true
        ? OpenFolderIcon
        : FolderIcon;
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
            <ChevronRightIcon
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
        {direct !== undefined && direct !== count ? (
          <Tooltip
            content={`${count.toLocaleString("en-US")} in this folder and beneath it; ${direct.toLocaleString("en-US")} filed directly here.`}
          >
            <span
              className={cn(
                typeClass("caption"),
                "shrink-0 text-muted-foreground tabular-nums",
              )}
            >
              {count.toLocaleString("en-US")} ({direct.toLocaleString("en-US")})
            </span>
          </Tooltip>
        ) : (
          <span
            className={cn(
              typeClass("caption"),
              "shrink-0 text-muted-foreground tabular-nums",
            )}
          >
            {count.toLocaleString("en-US")}
          </span>
        )}
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
    <SectionPanel id="bookmarks-folders" title="Folders">
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
      {unfiled > 0 ? (
        <p
          className={cn(
            typeClass("caption"),
            "border-t border-border px-4 py-2.5 text-muted-foreground",
          )}
        >
          {plural(unfiled, "saved bookmark", "saved bookmarks")} with no
          recorded folder.
        </p>
      ) : null}
    </SectionPanel>
  );
}

/* --------------------------------- table ---------------------------------- */

/**
 * The source file as a word beside a neutral dot: the live `Bookmarks` file
 * is the quiet default ("Primary"); a row read from the `.bak` copy reads
 * "Backup" in the foreground — a source, not a Commit State, so it never
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
      <EvidenceDot state="neutral" />
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
      <FolderIcon size={size.icon} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">
        {row.folderSegments[row.folderSegments.length - 1] ?? row.folderPath}
      </span>
    </span>
  );
}

/** The bookmark's name over its URL (the URL mono, as a value to copy). */
function BookmarkCell({ row }: { readonly row: BookmarkRow }) {
  return (
    <span className="flex min-w-0 flex-col">
      {row.name === null ? (
        <FieldCell field={row.finding.fields.name} />
      ) : (
        <span className="truncate text-foreground" title={row.name}>
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
  );
}

/**
 * The table's columns: Folder (the TYPE-lead column), Bookmark, Added,
 * Source, and State in the Recovered tab only. Below `sm` a row stacks:
 * folder and state, the bookmark, then added and source.
 */
function bookmarkColumns(
  recovered: boolean,
): readonly RowColumn<BookmarkRow>[] {
  const columns: RowColumn<BookmarkRow>[] = [
    {
      key: "folder",
      header: "Folder",
      className: "max-w-[160px]",
      stack: "lead",
      cell: (row) => <FolderCell row={row} />,
    },
    {
      key: "bookmark",
      header: "Bookmark",
      className: "max-w-[340px]",
      stack: "title",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <SiteAvatar host={row.host} />
          <BookmarkCell row={row} />
        </span>
      ),
      stackedCell: (row) => <BookmarkCell row={row} />,
    },
    {
      key: "added",
      header: "Added",
      className: "whitespace-nowrap",
      cell: (row) => <TimeCell field={row.finding.fields.dateAdded} />,
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => <SourceWord row={row} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      stack: "aside",
      cell: (row) => <StateWord state={row.finding.commitState} />,
    });
  }
  return columns;
}

const SAVED_COLUMNS = bookmarkColumns(false);
const RECOVERED_COLUMNS = bookmarkColumns(true);

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
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} bookmark`, many: `${noun} bookmarks` }}
      shown={visible.length}
      filtered={visible.length !== rows.length}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved bookmarks in this Case."
              : "No bookmarks were recovered from WAL or journal sidecars."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={noun === "saved" ? SAVED_COLUMNS : RECOVERED_COLUMNS}
        rowKey={(row, index) => `${row.finding.commitState}-${String(index)}`}
        rowLabel={(row) =>
          `Open bookmark ${row.name ?? row.url ?? "with no recorded name or URL"}`
        }
        onSelect={(row) => {
          onSelect(row.finding);
        }}
        tableClassName={noun === "saved" ? "min-w-[660px]" : "min-w-[760px]"}
      />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip. */
function BookmarksSkeleton() {
  return (
    <div role="status" aria-label="Loading bookmark figures">
      <Skeleton className="h-[150px] w-full rounded-xl lg:h-[76px]" />
    </div>
  );
}

/** Focusing a folder keeps the folder and everything nested beneath it. */
function inFolder(row: BookmarkRow, folder: string): boolean {
  const path = row.folderPath;
  return path !== null && (path === folder || path.startsWith(`${folder} /`));
}

/* ---------------------------------- page ---------------------------------- */

export function BookmarksPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(
    config.route,
    BOOKMARK_PARAMETERS,
    {
      drain: BOOKMARK_ROW_CAP,
    },
  );
  const savedDone = lists.drained.saved;
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
            icon={SearchIcon}
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
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ARTIFACT_ICONS.bookmarks}
            title="No bookmarks"
            message="No bookmarks recorded in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap
              loading={!figuresReady}
              skeleton={<BookmarksSkeleton />}
            >
              <div className="flex flex-col gap-5">
                {capped ? (
                  <Banner status="warning" contrast="high">
                    <BannerTitle>
                      These figures cover part of the Case
                    </BannerTitle>
                    <BannerDescription>
                      They read the first {saved.length.toLocaleString("en-US")}{" "}
                      saved bookmarks — the most this page loads at once. More
                      rows exist in the Case.
                    </BannerDescription>
                  </Banner>
                ) : null}

                <MetricBand className="grid-cols-2 lg:grid-cols-4">
                  <MetricBandItem
                    label="Saved bookmarks"
                    value={`${summary.total.toLocaleString("en-US")}${capped ? "+" : ""}`}
                  />
                  <MetricBandItem
                    label="Folders"
                    value={summary.folders.toLocaleString("en-US")}
                  />
                  <MetricBandItem
                    label="Distinct sites"
                    value={summary.hosts.toLocaleString("en-US")}
                  />
                  <MetricBandItem
                    label={
                      <Term label="From backup">
                        Read from Bookmarks.bak, the backup copy Chrome keeps
                        beside the live file.
                      </Term>
                    }
                    value={summary.backup.toLocaleString("en-US")}
                  />
                </MetricBand>
              </div>
            </RevealSwap>
          ) : null}

          {/* The folder navigator beside the rows it focuses: the structure
              the person built, next to what they filed. */}
          {showFigures ? (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <RevealSwap
                className="lg:sticky lg:top-14"
                loading={!figuresReady}
                skeleton={
                  <div role="status" aria-label="Loading bookmark folders">
                    <Skeleton className="h-[240px] w-full rounded-xl" />
                  </div>
                }
              >
                <FolderNavigator
                  rows={saved}
                  activePath={folderFilter}
                  onPick={pickFolder}
                />
              </RevealSwap>
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
