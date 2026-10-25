/**
 * The Bookmarks folder navigator: the folder tree built from the server's
 * count of saved bookmarks per recorded folder path (`count`
 * `by=folderPath`, every saved bookmark in the lens, not the rows loaded
 * so far), and its keyboard-navigable list of `FolderRow`s (fluid hover,
 * chevrons, counts). Split out of `bookmarks-page.tsx`.
 */
import { motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import {
  ChevronRightIcon,
  FolderIcon,
  LibraryIcon,
  OpenFolderIcon,
} from "@/lib/app-icons";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { ChartEmpty } from "./charts.js";
import { FilterField } from "./filters.js";
import { plural, SectionPanel, WeightLabel } from "./page-kit.js";

/** Saved bookmarks per recorded folder path, as the server counted them. */
export interface FolderCounts {
  /** Each recorded folder path (split into its segments) and the saved
   *  bookmarks filed directly in it. */
  readonly folders: readonly {
    readonly segments: readonly string[];
    readonly count: number;
  }[];
  /** Saved bookmarks with no recorded folder (absent, empty or
   *  unavailable). */
  readonly unfiled: number;
  /** Every saved bookmark counted. */
  readonly total: number;
  /** Saved bookmarks in folders past the server's bucket limit: not in the
   *  tree, said under it. */
  readonly unlisted: number;
}

/* ------------------------------- folder tree ------------------------------ */

export interface FolderNode {
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
 * Rebuilds the subject's bookmark folder hierarchy from the saved
 * bookmarks counted per `folderPath`. `direct` is bookmarks filed straight
 * in a folder; `total` rolls up the subtree. Bookmarks with no recorded
 * folder are excluded here and surfaced as their own worded line under the
 * tree, so absence stays visible.
 */
export function buildFolderTree(counts: FolderCounts): {
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
  let unfiled = counts.unfiled;

  for (const folder of counts.folders) {
    if (folder.segments.length === 0) {
      unfiled += folder.count;
      continue;
    }
    let level = roots;
    let pathSoFar = "";
    let node: Builder | null = null;
    for (const [index, segment] of folder.segments.entries()) {
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
      child.total += folder.count;
      node = child;
      level = child.children;
    }
    if (node !== null) {
      node.direct += folder.count;
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
export function visibleFolders(
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
export const TREE_STEP = 16;
export const TREE_INSET = 4;
export const CHEVRON_BOX = 24;

/** Focus ring for the navigator's own buttons (FF's 1px focus ring). */
export const BUTTON_FOCUS =
  "outline-none focus-visible:ring-1 focus-visible:ring-focus-ring";

/**
 * One navigator row. The row is the choice (it focuses the lists on the
 * folder and is what the fluid hover registers); the chevron is its own
 * 24px button over the row's leading edge, so opening a branch never changes
 * the focus. The chevron comes first in the DOM — it is drawn on the left —
 * so Tab walks a row left to right: expand, then pick.
 */
export function FolderRow({
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
  /** Rows filed directly here: the count's tooltip when it differs from
   *  `count` (never a bare "(1)" beside it). */
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
            "coarse-hit relative z-10 col-start-1 row-start-1 inline-flex size-6 cursor-pointer items-center justify-center self-center justify-self-start rounded-md text-muted-foreground transition-colors duration-80 hover:text-foreground",
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
              {count.toLocaleString("en-US")}
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
export function FolderNavigator({
  counts,
  activePath,
  onPick,
}: {
  readonly counts: FolderCounts;
  readonly activePath: string | null;
  readonly onPick: (path: string | null) => void;
}) {
  const { roots, unfiled } = useMemo(() => buildFolderTree(counts), [counts]);
  // Top-level folders start open, deeper ones closed; `toggled` holds the
  // folders the examiner flipped from that default. Kept as the flips (not
  // the open set) so a tree rebuilt for another profile pick opens its own
  // top-level folders too.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const open = useMemo(() => {
    const result = new Set<string>();
    const walk = (nodes: readonly FolderNode[]) => {
      for (const node of nodes) {
        if ((node.depth === 0) !== toggled.has(node.path)) {
          result.add(node.path);
        }
        walk(node.children);
      }
    };
    walk(roots);
    return result;
  }, [roots, toggled]);
  const flat = useMemo(() => visibleFolders(roots, open), [roots, open]);
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();

  const toggle = useCallback((path: string) => {
    setToggled((current) => {
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
                count={counts.total}
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
      {counts.unlisted > 0 ? (
        <p
          className={cn(
            typeClass("caption"),
            "border-t border-border px-4 py-2.5 text-muted-foreground",
          )}
        >
          {plural(counts.unlisted, "saved bookmark", "saved bookmarks")} in
          smaller folders not listed here.
        </p>
      ) : null}
    </SectionPanel>
  );
}

/** "All bookmarks" as a Select value (no folder path starts with NUL). */
const ALL_FOLDERS = "\u0000all";

/**
 * The navigator's pick for a narrow screen: one Select in the list's
 * toolbar - "All bookmarks", then every folder in tree order by its whole
 * path, with its count - so on a phone the rows are not pushed below a
 * folder tree. Same counts and same rule (a folder keeps everything nested
 * beneath it) as `FolderNavigator`.
 */
export function FolderSelect({
  counts,
  activePath,
  onPick,
}: {
  readonly counts: FolderCounts;
  readonly activePath: string | null;
  readonly onPick: (path: string | null) => void;
}) {
  const { roots } = useMemo(() => buildFolderTree(counts), [counts]);
  const everyFolder = useMemo(() => {
    const out: FolderNode[] = [];
    const walk = (nodes: readonly FolderNode[]) => {
      for (const node of nodes) {
        out.push(node);
        walk(node.children);
      }
    };
    walk(roots);
    return out;
  }, [roots]);
  if (everyFolder.length === 0) {
    return null;
  }
  return (
    <FilterField label="Folder" htmlFor="bookmarks-folder">
      <Select
        value={activePath ?? ALL_FOLDERS}
        onValueChange={(path) => {
          onPick(path === ALL_FOLDERS ? null : path);
        }}
      >
        <SelectTrigger id="bookmarks-folder" />
        <SelectContent>
          <SelectItem index={0} value={ALL_FOLDERS}>
            All bookmarks{" "}
            <span className="text-muted-foreground tabular-nums">
              {counts.total.toLocaleString("en-US")}
            </span>
          </SelectItem>
          {everyFolder.map((node, index) => (
            <SelectItem key={node.path} index={index + 1} value={node.path}>
              {/* The whole path, so the closed Select still says where a
                  nested folder sits (and two "Work" folders differ). */}
              {node.path}{" "}
              <span className="text-muted-foreground tabular-nums">
                {node.total.toLocaleString("en-US")}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}
