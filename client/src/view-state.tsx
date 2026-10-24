/**
 * The live view: the URL hash (router.ts) as a React store, plus the hooks
 * pages read and write it through.
 *
 * One source of truth: every hook reads the hash and every setter writes a
 * new one, so Back / Forward, a refresh and a copied link all land on the
 * same view. Nothing is mirrored in component state.
 *
 * The shell lens (one date range and one profile selection for the whole
 * Case) is `useViewState()`; a page that honours it reads `useViewRange()` /
 * `useViewProfiles()`, which also tells the topbar chip the page applies it
 * (the chip only shows what the page on show actually filters by).
 *
 * Page state: `useViewHost()`, `useViewSearch()`, `useViewTab()` and
 * `useRowSelection(rows)` (the open row sheet). They reset when the page
 * changes.
 *
 * History entries: a page change, a range, a profile pick, a host and an
 * opened row each push one (Back undoes them one by one); a tab switch and a
 * search replace the current entry, so Back is not spent on them.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_LOCATION,
  formatLocation,
  normalizeRange,
  parseLocation,
  rowRefOf,
  sameLocation,
  withPage,
  type RowRefSource,
  type ViewLocation,
  type ViewTab,
} from "./router.js";

export type { ViewLocation, ViewTab } from "./router.js";

/* ---------------------------------- store --------------------------------- */

const listeners = new Set<() => void>();
let cachedHash: string | null = null;
let cachedLocation: ViewLocation = DEFAULT_LOCATION;

function readLocation(): ViewLocation {
  const hash = globalThis.location?.hash ?? "";
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedLocation = parseLocation(hash);
  }
  return cachedLocation;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    globalThis.addEventListener("hashchange", notify);
    globalThis.addEventListener("popstate", notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      globalThis.removeEventListener("hashchange", notify);
      globalThis.removeEventListener("popstate", notify);
    }
  };
}

/** Marks a history entry pushed by opening a row, so closing the sheet can
 *  step back over it instead of stacking a second entry. */
const ROW_ENTRY = "forensix.row-entry";

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing one. */
  readonly replace?: boolean;
}

/** The view now (outside React: event handlers, effects). */
export function currentLocation(): ViewLocation {
  return readLocation();
}

/** Moves to `next`. A view equal to the current one does nothing. */
export function navigate(
  next: ViewLocation | ((current: ViewLocation) => ViewLocation),
  options: NavigateOptions & { readonly rowEntry?: boolean } = {},
): void {
  const current = readLocation();
  const target = typeof next === "function" ? next(current) : next;
  if (sameLocation(current, target)) {
    return;
  }
  const url = formatLocation(target);
  const state = options.rowEntry === true ? { [ROW_ENTRY]: true } : null;
  if (options.replace === true) {
    globalThis.history.replaceState(state, "", url);
  } else {
    globalThis.history.pushState(state, "", url);
  }
  notify();
}

/** Opens a page, carrying the lens; `extras` sets the new page's own state
 *  (a host for Sites, a row to open). */
export function openPage(
  page: string,
  extras: Partial<Omit<ViewLocation, "page">> = {},
  options: NavigateOptions = {},
): void {
  navigate((current) => withPage(current, page, extras), options);
}

/** The hash for a page view from here (for real `<a href>` links), with
 *  the lens carried as `openPage` would. */
export function hrefFor(
  page: string,
  extras: Partial<Omit<ViewLocation, "page">> = {},
): string {
  return formatLocation(withPage(readLocation(), page, extras));
}

/**
 * Changes several parts of the current page's view in one history entry
 * (e.g. a page's "Clear filters": range, profiles and search at once). The
 * open row closes; the range is normalised.
 */
export function updateView(
  patch: Partial<Omit<ViewLocation, "page">>,
  options: NavigateOptions = {},
): void {
  navigate((current) => {
    const next = { ...current, ...patch, row: patch.row ?? null };
    return { ...next, ...normalizeRange(next.from, next.to) };
  }, options);
}

/** Normalises the URL once at start-up: an unknown or malformed hash is
 *  replaced by what it parses to, so the address bar shows the real view. */
export function canonicalizeLocation(): void {
  const parsed = readLocation();
  const canonical = formatLocation(parsed);
  if (globalThis.location.hash !== canonical) {
    globalThis.history.replaceState(globalThis.history.state, "", canonical);
    notify();
  }
}

/** The whole view, re-rendering on every change. */
export function useViewLocation(): ViewLocation {
  return useSyncExternalStore(subscribe, readLocation, () => DEFAULT_LOCATION);
}

/* ---------------------------- lens consumption ---------------------------- */

type LensPart = "range" | "profiles";
const consumers: Record<LensPart, number> = { range: 0, profiles: 0 };
const consumerListeners = new Set<() => void>();
let consumerSnapshot = "false:false";

function consumerKey(): string {
  return `${String(consumers.range > 0)}:${String(consumers.profiles > 0)}`;
}

function subscribeConsumers(listener: () => void): () => void {
  consumerListeners.add(listener);
  return () => {
    consumerListeners.delete(listener);
  };
}

function useLensConsumer(part: LensPart): void {
  useEffect(() => {
    consumers[part] += 1;
    const changed = () => {
      const key = consumerKey();
      if (key !== consumerSnapshot) {
        consumerSnapshot = key;
        for (const listener of consumerListeners) {
          listener();
        }
      }
    };
    changed();
    return () => {
      consumers[part] -= 1;
      changed();
    };
  }, [part]);
}

/** Which parts of the lens the page on show applies (`useViewRange` /
 *  `useViewProfiles` mounted). The topbar chip shows only those. */
export function useLensApplied(): {
  readonly range: boolean;
  readonly profiles: boolean;
} {
  const key = useSyncExternalStore(
    subscribeConsumers,
    () => consumerSnapshot,
    () => "false:false",
  );
  return useMemo(() => {
    const [range, profiles] = key.split(":");
    return { range: range === "true", profiles: profiles === "true" };
  }, [key]);
}

/* ---------------------------------- lens ---------------------------------- */

/** A Case-day range; `""` is an open side, both `""` is every day. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** The shell lens: the Case-wide date range and profile selection. */
export interface ViewState {
  readonly range: DayRange;
  readonly profiles: readonly string[];
  /** A range or a profile pick is set. */
  readonly active: boolean;
  readonly setRange: (range: DayRange) => void;
  readonly setProfiles: (profiles: readonly string[]) => void;
  /** Clears the range and the profile pick together. */
  readonly clear: () => void;
}

function setRangeNow(range: DayRange): void {
  const next = normalizeRange(range.from, range.to);
  navigate((current) => ({ ...current, ...next, row: null }));
}

function setProfilesNow(profiles: readonly string[]): void {
  navigate((current) => ({ ...current, profiles: [...profiles], row: null }));
}

/** The lens, without marking it applied (the shell's chip, ⌘K). Pages use
 *  `useViewRange` / `useViewProfiles`. */
export function useViewState(): ViewState {
  const location = useViewLocation();
  const { from, to, profiles } = location;
  const range = useMemo(() => ({ from, to }), [from, to]);
  const clear = useCallback(() => {
    navigate((current) => ({
      ...current,
      from: "",
      to: "",
      profiles: [],
      row: null,
    }));
  }, []);
  return {
    range,
    profiles,
    active: from !== "" || to !== "" || profiles.length > 0,
    setRange: setRangeNow,
    setProfiles: setProfilesNow,
    clear,
  };
}

/**
 * The Case-wide date range, for a page that filters by it (and so tells the
 * topbar chip it applies). Drop-in for a page's own
 * `useState({ from: "", to: "" })`; the range object is stable while the
 * days are unchanged, so it can sit in a memo's dependencies.
 */
export function useViewRange(): readonly [DayRange, (range: DayRange) => void] {
  useLensConsumer("range");
  const { range, setRange } = useViewState();
  return [range, setRange] as const;
}

/** The Case-wide profile selection (empty = every profile), for a page
 *  that filters by it. */
export function useViewProfiles(): readonly [
  readonly string[],
  (profiles: readonly string[]) => void,
] {
  useLensConsumer("profiles");
  const { profiles, setProfiles } = useViewState();
  return [profiles, setProfiles] as const;
}

/* ------------------------------- page state ------------------------------- */

/** The host the page is focused on (Sites). Picking one pushes a history
 *  entry, so Back returns to the previous host. */
export function useViewHost(): readonly [
  string | null,
  (host: string | null) => void,
] {
  const { host } = useViewLocation();
  const setHost = useCallback((next: string | null) => {
    navigate((current) => ({ ...current, host: next, row: null }));
  }, []);
  return [host, setHost] as const;
}

/** The page's search text (`""` when none). Replaces the history entry. */
export function useViewSearch(): readonly [string, (q: string) => void] {
  const { q } = useViewLocation();
  const setSearch = useCallback((next: string) => {
    navigate(
      (current) => ({ ...current, q: next === "" ? null : next, row: null }),
      { replace: true },
    );
  }, []);
  return [q ?? "", setSearch] as const;
}

/** The page's Saved / Recovered switch. Drop-in for
 *  `useState<CommitView>("saved")`. Replaces the history entry. */
export function useViewTab(): readonly [ViewTab, (tab: ViewTab) => void] {
  const { tab } = useViewLocation();
  const setTab = useCallback((next: ViewTab) => {
    navigate((current) => ({ ...current, tab: next, row: null }), {
      replace: true,
    });
  }, []);
  return [tab, setTab] as const;
}

/**
 * The open row sheet, in the URL. Pass the rows the page has loaded (both
 * lists); `selected` is the row the URL names when it is among them, so a
 * refresh or Back re-opens the sheet once that row has loaded again.
 *
 *   const sheet = useRowSelection([...lists.saved.rows, ...lists.recovered.rows]);
 *   <ResponsiveRows onSelect={sheet.select} … />
 *   {sheet.selected === null ? null : (
 *     <RowSheet selected={sheet.selected} onClose={sheet.close} />
 *   )}
 *
 * A row without a reference (no table or row id) still opens: it is held
 * for this page view only and is not addressable.
 */
export function useRowSelection<Row extends RowRefSource>(
  rows: readonly Row[],
): {
  readonly selected: { readonly kind: "finding"; readonly row: Row } | null;
  readonly select: (row: Row) => void;
  readonly close: () => void;
} {
  const { row: ref } = useViewLocation();
  // A row with no reference opens for this page view only.
  const [unaddressed, setUnaddressed] = useState<Row | null>(null);
  const match = useMemo(
    () =>
      ref === null
        ? null
        : (rows.find((candidate) => rowRefOf(candidate) === ref) ?? null),
    [rows, ref],
  );
  const row = match ?? unaddressed;
  const selected = useMemo(
    () => (row === null ? null : ({ kind: "finding", row } as const)),
    [row],
  );
  const select = useCallback((next: Row) => {
    const nextRef = rowRefOf(next);
    if (nextRef === null) {
      setUnaddressed(next);
      return;
    }
    setUnaddressed(null);
    navigate((current) => ({ ...current, row: nextRef }), { rowEntry: true });
  }, []);
  const close = useCallback(() => {
    setUnaddressed(null);
    const current = readLocation();
    if (current.row === null) {
      return;
    }
    const state: unknown = globalThis.history.state;
    if (
      typeof state === "object" &&
      state !== null &&
      (state as Record<string, unknown>)[ROW_ENTRY] === true
    ) {
      // The entry was pushed by opening this row: step back over it, so
      // Back after a close leaves the page instead of re-opening the row.
      globalThis.history.back();
      return;
    }
    navigate({ ...current, row: null }, { replace: true });
  }, []);
  return { selected, select, close };
}
