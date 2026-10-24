/**
 * The Bookmarks folder navigator: the folder tree built from the loaded
 * rows' recorded folder paths, and its keyboard-navigable list of
 * `FolderRow`s (fluid hover, chevrons, counts). Split out of
 * `bookmarks-page.tsx`.
 */
import { motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
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
import { plural, SectionPanel, WeightLabel } from "./page-kit.js";
import type { BookmarkRow } from "./bookmarks-page.js";

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
 * Rebuilds the subject's bookmark folder hierarchy from the `folderPath` of
 * every row. `direct` is bookmarks filed straight in a folder; `total` rolls
 * up the subtree. Rows with no recorded folder are excluded here and surfaced
 * as their own worded line under the tree, so absence stays visible.
 */
export function buildFolderTree(rows: readonly BookmarkRow[]): {
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
export function FolderNavigator({
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
