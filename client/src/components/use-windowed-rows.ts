/**
 * Windowed rendering for long evidence lists: only the rows near the
 * viewport are in the DOM, the rest stand in as two spacers of their
 * height, so a 15,000-row Downloads list costs what 40 rows cost.
 *
 * No library: rows are measured as they render (a running average stands
 * in for the rows not yet seen), the window follows the page's scroll (or
 * the nearest scrolling ancestor's), and the focused row — with its two
 * neighbours, so J / K always reach the true next row — stays mounted even
 * when scrolled away, so keyboard focus is never dropped to `<body>`.
 *
 * Lists at or under `WINDOW_THRESHOLD` rows render whole: windowing them
 * would buy nothing and cost find-in-page.
 *
 * The window maths (`windowRange`, `windowItems`) is pure and unit-tested in
 * `use-windowed-rows.test.ts`.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Lists longer than this render windowed. */
export const WINDOW_THRESHOLD = 150;

/** Pixels rendered beyond each edge of the viewport. */
const OVERSCAN_PX = 800;

/** One entry of a windowed list: a row by its index, or a spacer standing
 *  in for the rows between two rendered runs. */
export type WindowItem =
  | { readonly kind: "row"; readonly index: number }
  | {
      readonly kind: "gap";
      readonly key: string;
      readonly height: number;
    };

/** Prefix offsets: `offsets[i]` is where row `i` starts; `offsets[n]` is
 *  the list's height. */
export function rowOffsets(
  count: number,
  measured: ReadonlyMap<number, number>,
  estimate: number,
): Float64Array {
  const offsets = new Float64Array(count + 1);
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] =
      (offsets[index] ?? 0) + (measured.get(index) ?? estimate);
  }
  return offsets;
}

/** First index whose row ends after `y` (binary search). */
function firstEndingAfter(offsets: Float64Array, y: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((offsets[middle + 1] ?? 0) > y) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * The rows `[start, end)` overlapping `[top, bottom)` (list-relative
 * pixels). Always at least one row when the list has any.
 */
export function windowRange(
  offsets: Float64Array,
  top: number,
  bottom: number,
): { readonly start: number; readonly end: number } {
  const count = offsets.length - 1;
  if (count <= 0) {
    return { start: 0, end: 0 };
  }
  const start = Math.min(count - 1, firstEndingAfter(offsets, top));
  let end = start + 1;
  while (end < count && (offsets[end] ?? 0) < bottom) {
    end += 1;
  }
  return { start, end };
}

/**
 * The windowed sequence: rows `[start, end)` plus every `pinned` index (a
 * focused row and its neighbours), with a spacer for each run of rows left
 * out, sized from `offsets`.
 */
export function windowItems(
  start: number,
  end: number,
  pinned: readonly number[],
  offsets: Float64Array,
): WindowItem[] {
  const count = offsets.length - 1;
  const shown = new Set<number>();
  for (
    let index = Math.max(0, start);
    index < Math.min(end, count);
    index += 1
  ) {
    shown.add(index);
  }
  for (const index of pinned) {
    if (index >= 0 && index < count) {
      shown.add(index);
    }
  }
  const indices = [...shown].sort((left, right) => left - right);
  const items: WindowItem[] = [];
  let next = 0;
  for (const index of indices) {
    if (index > next) {
      items.push({
        kind: "gap",
        key: `gap-${String(next)}`,
        height: (offsets[index] ?? 0) - (offsets[next] ?? 0),
      });
    }
    items.push({ kind: "row", index });
    next = index + 1;
  }
  if (next < count) {
    items.push({
      kind: "gap",
      key: `gap-${String(next)}`,
      height: (offsets[count] ?? 0) - (offsets[next] ?? 0),
    });
  }
  return items;
}

/** The element whose scrolling moves `element`: its nearest ancestor that
 *  scrolls vertically, else null (the page). */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current !== null && current !== document.body) {
    const style = getComputedStyle(current);
    // `overflow-x: auto` alone also computes overflow-y to auto; only a box
    // that is height-bound (or already overflowing) scrolls vertically.
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      (style.maxHeight !== "none" ||
        current.scrollHeight > current.clientHeight + 1)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** The attribute every windowed row carries: its index in the full list. */
export const ROW_INDEX_ATTRIBUTE = "data-row-index";

/**
 * Windowing state for a list of `count` rows whose container (a `tbody` or
 * `ul`, holding the rows and spacers as direct children) gets `listRef`.
 * Each rendered row must carry `data-row-index={index}`. `resetKey`
 * changes when the rows themselves change (a new filter): measured heights
 * are dropped then. With `enabled` false every row renders.
 */
export function useWindowedRows({
  count,
  estimate,
  enabled,
  resetKey,
}: {
  readonly count: number;
  /** A row's height before it is measured, px. */
  readonly estimate: number;
  readonly enabled: boolean;
  readonly resetKey: unknown;
}): {
  readonly listRef: (element: HTMLElement | null) => void;
  readonly items: readonly WindowItem[];
} {
  const [list, setList] = useState<HTMLElement | null>(null);
  const measured = useRef(new Map<number, number>());
  const [version, setVersion] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const [view, setView] = useState<{
    readonly top: number;
    readonly bottom: number;
  }>(() => ({
    top: 0,
    bottom: (globalThis.innerHeight || 900) + OVERSCAN_PX,
  }));

  // New rows: forget the old heights (keep their average as the estimate).
  const [seenKey, setSeenKey] = useState(resetKey);
  const average = useRef(estimate);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    measured.current = new Map();
    setFocused(null);
  }

  const offsets = useMemo(
    () => rowOffsets(enabled ? count : 0, measured.current, average.current),
    // `version` / `seenKey` stand for the measured heights (a ref).
    [count, enabled, version, seenKey],
  );

  // Follow the scroll: the list's top against the viewport (or its
  // scrolling ancestor), once per frame.
  useEffect(() => {
    if (!enabled || list === null) {
      return;
    }
    const scroller = scrollParentOf(list);
    let frame = 0;
    const read = () => {
      frame = 0;
      const listTop = list.getBoundingClientRect().top;
      const viewTop =
        scroller === null ? 0 : scroller.getBoundingClientRect().top;
      const viewHeight =
        scroller === null ? globalThis.innerHeight : scroller.clientHeight;
      const top = viewTop - listTop - OVERSCAN_PX;
      const bottom = viewTop + viewHeight - listTop + OVERSCAN_PX;
      setView((current) =>
        Math.abs(current.top - top) < 1 && Math.abs(current.bottom - bottom) < 1
          ? current
          : { top, bottom },
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(read);
      }
    };
    read();
    const target: HTMLElement | Window = scroller ?? globalThis.window;
    target.addEventListener("scroll", schedule, { passive: true });
    globalThis.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      target.removeEventListener("scroll", schedule);
      globalThis.removeEventListener("resize", schedule);
    };
  }, [enabled, list]);

  // Keep the focused row (and its neighbours) mounted.
  useEffect(() => {
    if (!enabled || list === null) {
      return;
    }
    const indexOf = (target: EventTarget | null): number | null => {
      if (!(target instanceof Element)) {
        return null;
      }
      const row = target.closest(`[${ROW_INDEX_ATTRIBUTE}]`);
      if (row === null || !list.contains(row)) {
        return null;
      }
      const index = Number(row.getAttribute(ROW_INDEX_ATTRIBUTE));
      return Number.isInteger(index) ? index : null;
    };
    const onFocusIn = (event: FocusEvent) => {
      setFocused(indexOf(event.target));
    };
    const onFocusOut = (event: FocusEvent) => {
      if (indexOf(event.relatedTarget) === null) {
        setFocused(null);
      }
    };
    list.addEventListener("focusin", onFocusIn);
    list.addEventListener("focusout", onFocusOut);
    return () => {
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled, list]);

  const items = useMemo((): readonly WindowItem[] => {
    if (!enabled) {
      return Array.from({ length: count }, (_, index) => ({
        kind: "row" as const,
        index,
      }));
    }
    const { start, end } = windowRange(offsets, view.top, view.bottom);
    const pinned = focused === null ? [] : [focused - 1, focused, focused + 1];
    return windowItems(start, end, pinned, offsets);
  }, [enabled, count, offsets, view, focused]);

  // Measure what rendered; a changed height re-lays the window once.
  useLayoutEffect(() => {
    if (!enabled || list === null) {
      return;
    }
    let changed = false;
    for (const child of list.children) {
      const index = Number(child.getAttribute(ROW_INDEX_ATTRIBUTE));
      if (
        !child.hasAttribute(ROW_INDEX_ATTRIBUTE) ||
        !Number.isInteger(index)
      ) {
        continue;
      }
      const height = (child as HTMLElement).offsetHeight;
      if (
        height > 0 &&
        Math.abs((measured.current.get(index) ?? -1) - height) > 0.5
      ) {
        measured.current.set(index, height);
        changed = true;
      }
    }
    if (changed) {
      let sum = 0;
      for (const height of measured.current.values()) {
        sum += height;
      }
      average.current = sum / Math.max(1, measured.current.size);
      setVersion((value) => value + 1);
    }
  });

  const listRef = useCallback((element: HTMLElement | null) => {
    setList(element);
  }, []);

  return { listRef, items };
}
