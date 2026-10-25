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
 * `useViewProfiles()`. Which parts the page on show applies is the page
 * registry's (`PAGES[page].lens`, pages.ts), so the topbar chip only shows
 * what the page actually filters by.
 *
 * Page state: `useViewHost()`, `useViewSearch()`, `useViewFilter()`,
 * `useViewTab()` and
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

import { useCommandMenuOpen } from "./menu-open.js";
import type { PageKey } from "./pages.js";
import { findRowByRef, type RowLookupSource } from "./row-lookup.js";
import { isAbortError } from "./api.js";

export type { ViewLocation, ViewTab } from "./router.js";
export type { RowLookupSource } from "./row-lookup.js";

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
  page: PageKey,
  extras: Partial<Omit<ViewLocation, "page">> = {},
  options: NavigateOptions = {},
): void {
  navigate((current) => withPage(current, page, extras), options);
}

/** The hash for a page view from here (for real `<a href>` links), with
 *  the lens carried as `openPage` would. */
export function hrefFor(
  page: PageKey,
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

/** The whole lens (the shell's chip, ⌘K). Pages use `useViewRange` /
 *  `useViewProfiles`. */
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
 * The Case-wide date range, for a page that filters by it (its registry
 * entry says so: `PAGES[page].lens.range`). Drop-in for a page's own
 * `useState({ from: "", to: "" })`; the range object is stable while the
 * days are unchanged, so it can sit in a memo's dependencies.
 */
export function useViewRange(): readonly [DayRange, (range: DayRange) => void] {
  const { range, setRange } = useViewState();
  return [range, setRange] as const;
}

/** The Case-wide profile selection (empty = every profile, sorted), for a
 *  page that filters by it (`PAGES[page].lens.profiles`). */
export function useViewProfiles(): readonly [
  readonly string[],
  (profiles: readonly string[]) => void,
] {
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
    // A new host starts its own view: no row open, no kind picked.
    navigate((current) => ({
      ...current,
      host: next,
      filter: null,
      row: null,
    }));
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

/** The page's own one-of filter (a chip or Select pick: Bookmarks folder,
 *  Form data category, Timeline event kind, Sites kind), so refresh and
 *  Back restore it. Drop-in for `useState<string | null>(null)` (null is no
 *  filter; an updater function works too). Replaces the history entry, as
 *  a search does. */
export function useViewFilter(): readonly [
  string | null,
  (next: string | null | ((current: string | null) => string | null)) => void,
] {
  const { filter } = useViewLocation();
  const setFilter = useCallback(
    (next: string | null | ((current: string | null) => string | null)) => {
      navigate(
        (current) => {
          const value =
            typeof next === "function" ? next(current.filter) : next;
          return {
            ...current,
            filter: value === "" ? null : value,
            row: null,
          };
        },
        { replace: true },
      );
    },
    [],
  );
  return [filter, setFilter] as const;
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

/* ------------------------------ row from the URL ------------------------- */

/** Where the lookup of a URL-named row stands, for the shell's notice. */
export type RowLookupStatus =
  | { readonly state: "idle" }
  /** Reading the page's route for the row (`findRowByRef`). */
  | { readonly state: "looking"; readonly ref: string }
  /** Not found: `capped` when the lookup stopped at its cap with rows
   *  unread, `failed` when a read failed; neither: the route holds no row
   *  with that reference. */
  | {
      readonly state: "missing";
      readonly ref: string;
      readonly capped: boolean;
      readonly failed: boolean;
    };

const IDLE: RowLookupStatus = { state: "idle" };
/** How long a URL-named row may take to arrive with the page's own first
 *  read before it is looked up by its reference. */
const ROW_LOOKUP_DELAY = 600;
let lookupStatus: RowLookupStatus = IDLE;
const lookupListeners = new Set<() => void>();

function setLookupStatus(next: RowLookupStatus): void {
  if (
    next.state === lookupStatus.state &&
    (next.state === "idle" ||
      (lookupStatus.state !== "idle" && next.ref === lookupStatus.ref))
  ) {
    return;
  }
  lookupStatus = next;
  for (const listener of lookupListeners) {
    listener();
  }
}

/** The URL-named row's lookup (the shell shows "looking" and "missing"). */
export function useRowLookupStatus(): RowLookupStatus {
  return useSyncExternalStore(
    (listener) => {
      lookupListeners.add(listener);
      return () => {
        lookupListeners.delete(listener);
      };
    },
    () => lookupStatus,
  );
}

/** Closes the sheet the URL names (the notice's "Close"). */
export function closeUrlRow(): void {
  const current = readLocation();
  if (current.row !== null) {
    navigate({ ...current, row: null }, { replace: true });
  }
}

/**
 * The open row sheet, in the URL. Pass the rows the page has loaded (both
 * lists); `selected` is the row the URL names when it is among them, so a
 * refresh or Back re-opens the sheet once that row has loaded again.
 *
 *   const sheet = useRowSelection(
 *     [...lists.saved.rows, ...lists.recovered.rows],
 *     ROW_LOOKUP, // { route: "cookies" }, a module constant
 *   );
 *   <ResponsiveRows onSelect={sheet.select} … />
 *   {sheet.selected === null ? null : (
 *     <RowSheet selected={sheet.selected} onClose={sheet.close} />
 *   )}
 *
 * With `lookup` (the page's route; keep it stable - a module constant or a
 * memo), a URL-named row the lists do not hold - a Timeline link into a
 * large Case, a copied URL - is read from the route by its reference
 * (`findRowByRef`, row-lookup.ts) once the page's own lists have had their
 * first read, and opens from there; an abandoned lookup is aborted on the
 * wire. The shell says when it is looked for and when it was not found.
 *
 * A row without a reference (no table or row id) still opens: it is held
 * for this page view only and is not addressable.
 */
export function useRowSelection<Row extends RowRefSource>(
  rows: readonly Row[],
  lookup?: RowLookupSource,
): {
  readonly selected: { readonly kind: "finding"; readonly row: Row } | null;
  readonly select: (row: Row) => void;
  readonly close: () => void;
} {
  const { row: ref } = useViewLocation();
  // A row with no reference opens for this page view only.
  const [unaddressed, setUnaddressed] = useState<Row | null>(null);
  // A URL-named row read by its reference (not in the loaded lists).
  const [found, setFound] = useState<{
    readonly ref: string;
    readonly row: Row;
  } | null>(null);
  const match = useMemo(
    () =>
      ref === null
        ? null
        : (rows.find((candidate) => rowRefOf(candidate) === ref) ?? null),
    [rows, ref],
  );
  useEffect(() => {
    if (ref === null || match !== null || lookup === undefined) {
      setLookupStatus(IDLE);
      return;
    }
    if (found?.ref === ref) {
      return;
    }
    const abort = new AbortController();
    // A beat for the page's own first read: a row on its first page opens
    // from there without a second read.
    const timer = setTimeout(() => {
      setLookupStatus({ state: "looking", ref });
      findRowByRef<Row>(lookup, ref, abort.signal)
        .then(({ row, capped }) => {
          if (row === null) {
            setLookupStatus({ state: "missing", ref, capped, failed: false });
            return;
          }
          setFound({ ref, row });
          setLookupStatus(IDLE);
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted && !isAbortError(error)) {
            setLookupStatus({
              state: "missing",
              ref,
              capped: false,
              failed: true,
            });
          }
        });
    }, ROW_LOOKUP_DELAY);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [ref, match, lookup, found]);
  useEffect(
    () => () => {
      setLookupStatus(IDLE);
    },
    [],
  );
  const row =
    match ??
    (found !== null && found.ref === ref ? found.row : null) ??
    unaddressed;
  // A sheet never opens under the ⌘K menu: one the URL names while the
  // menu is open (a pick made just before it was reopened, its row still
  // loading) opens once the menu closes. A sheet already open stays (⌘K
  // from inside it switches its row).
  const menuOpen = useCommandMenuOpen();
  const [sheetOpen, setSheetOpen] = useState(false);
  const shown = menuOpen && !sheetOpen ? null : row;
  useEffect(() => {
    setSheetOpen(shown !== null);
  }, [shown]);
  const selected = useMemo(
    () => (shown === null ? null : ({ kind: "finding", row: shown } as const)),
    [shown],
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
