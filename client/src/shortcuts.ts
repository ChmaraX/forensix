/**
 * Keyboard model for evidence lists.
 *
 *  - J or ↓ moves to the next row, K or ↑ to the previous one, in page
 *    order - past the end of one list into the next (Sites stacks several);
 *    from outside a list, J lands on the first row of the page and K on the
 *    last. Enter (and Space) on a row opens its sheet - the rows already
 *    answer it (`activateOnKey`).
 *  - ↑ / ↓ only act while a row has focus, so the page still scrolls with
 *    the arrows everywhere else.
 *  - J / K (single character keys, WCAG 2.1.4) act only while focus is on
 *    a row, inside a list, or on the page itself (the document body, the
 *    page's h1) - never on a button, a link, a field, a menu, a dialog, the
 *    sidebar or the topbar - and never with a modifier held, Shift
 *    included. `[` (show or hide the sidebar) acts only from the page
 *    itself. All three can be turned off from ⌘K ("Single-key shortcuts"),
 *    persisted in localStorage.
 *
 * Rows are the focusable rows `ResponsiveRows` renders: table rows and the
 * phone cards. A list opts in explicitly with `data-row-nav` on each row;
 * until then the selector also matches today's markup (`tbody > tr` and
 * `[role=button]` cards with `tabindex="0"`). Only rows that are rendered
 * (not `display: none`, e.g. the phone cards on a desktop) count.
 *
 * `useRowKeyboardNav(ref)` handles the keys inside one list container (for
 * `ResponsiveRows` / a table); the shell installs `useGlobalRowKeys()` once
 * for the whole page column, which also carries a move past a list's last
 * row into the next list. Whichever handles a key marks it handled
 * (`preventDefault`), so they never both move.
 *
 * The decisions are pure (`rowKeyDelta`, `sidebarKeyFires`,
 * `parseSingleKeySetting`, unit-tested in shortcuts.test.ts); only
 * `focusPlaceOf` reads the DOM.
 */
import { useEffect, useSyncExternalStore, type RefObject } from "react";

/** A row the keys move between. */
export const ROW_NAV_SELECTOR = [
  "[data-row-nav]",
  'tbody > tr[tabindex="0"]',
  'li > [role="button"][tabindex="0"]',
].join(", ");

/** Every shortcut the dashboard answers, for the ⌘K menu's Shortcuts
 *  section (FF shortcut syntax for the caps). */
export const SHORTCUTS: readonly {
  readonly value: string;
  readonly label: string;
  readonly keys: string;
}[] = [
  { value: "shortcut-menu", label: "Open the command menu", keys: "mod+k" },
  { value: "shortcut-next", label: "Next row", keys: "j" },
  { value: "shortcut-previous", label: "Previous row", keys: "k" },
  { value: "shortcut-open", label: "Open the focused row", keys: "enter" },
  { value: "shortcut-close", label: "Close the row sheet", keys: "esc" },
  { value: "shortcut-sidebar", label: "Show or hide the sidebar", keys: "[" },
];

function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** The rows in `scope` that are on show, in document order. */
export function rowsIn(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(ROW_NAV_SELECTOR)].filter(
    isRendered,
  );
}

/** The row `element` is, or sits in. */
export function rowOf(element: Element | null): HTMLElement | null {
  const row = element?.closest<HTMLElement>(ROW_NAV_SELECTOR) ?? null;
  return row !== null && isRendered(row) ? row : null;
}

/** Text entry, a menu or a dialog: places J / K must not act. */
export function keysBelongElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target.isContentEditable ||
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [role="slider"]',
    ) !== null
  ) {
    return true;
  }
  return false;
}

function focusRow(row: HTMLElement): void {
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

/**
 * Moves focus one row on (`delta` 1) or back (-1) from `from`, among the
 * rows in `scope`; from no row (or a row outside `scope`), to the first (J)
 * or last (K) row in `scope`. Returns whether focus moved.
 */
export function moveRowFocus(
  from: Element | null,
  delta: 1 | -1,
  scope: ParentNode,
): boolean {
  const rows = rowsIn(scope);
  const current = rowOf(from);
  const index = current === null ? -1 : rows.indexOf(current);
  if (index === -1) {
    const target = delta === 1 ? rows[0] : rows[rows.length - 1];
    if (target === undefined) {
      return false;
    }
    focusRow(target);
    return true;
  }
  const target = rows[index + delta];
  if (target === undefined) {
    return false;
  }
  focusRow(target);
  return true;
}

/** Where focus is, for the single-key shortcuts. */
export type FocusPlace =
  /** Nothing focused: the document body. */
  | "body"
  /** An evidence row (a table row or a phone card). */
  | "row"
  /** Inside a list or table, on something that is not a control. */
  | "list"
  /** Inside the page column, on something that is not a control (the h1). */
  | "page"
  /** A button, link, tab, chart or other control in the page. */
  | "control"
  /** A text field, select, combobox, menu or listbox. */
  | "field"
  /** Inside a dialog (the row sheet, ⌘K). */
  | "dialog"
  /** Outside the page column: the sidebar, the topbar. */
  | "outside";

/** The parts of a key event the decisions read. */
export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

function hasModifier(event: KeyInput): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

/** Where J / K may act: a row, a list, or the page itself. */
const SINGLE_KEY_PLACES: ReadonlySet<FocusPlace> = new Set([
  "body",
  "row",
  "list",
  "page",
]);

/**
 * The move a key asks for: 1 (next row), -1 (previous) or null (not ours).
 * J / K only with single-key shortcuts on, from a row, a list or the page;
 * ↑ / ↓ only on a row. Any modifier (Shift too) leaves the key alone.
 */
export function rowKeyDelta(
  event: KeyInput,
  place: FocusPlace,
  singleKeys: boolean,
): 1 | -1 | null {
  if (hasModifier(event)) {
    return null;
  }
  if (event.key === "j" || event.key === "k") {
    if (!singleKeys || !SINGLE_KEY_PLACES.has(place)) {
      return null;
    }
    return event.key === "j" ? 1 : -1;
  }
  if (place === "row" && event.key === "ArrowDown") {
    return 1;
  }
  if (place === "row" && event.key === "ArrowUp") {
    return -1;
  }
  return null;
}

/** Whether `[` toggles the sidebar: single-key shortcuts on, no modifier,
 *  and focus on the page itself (never on a control, a row or the sidebar,
 *  whose collapse would take focus with it). */
export function sidebarKeyFires(
  event: KeyInput,
  place: FocusPlace,
  singleKeys: boolean,
): boolean {
  return (
    singleKeys &&
    event.key === "[" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    (place === "body" || place === "page")
  );
}

/** A control: something focus on which means "this, not the page". */
const CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="application"]',
].join(", ");

/** A list region: a table, or a container marked `data-row-list` /
 *  `data-row-nav-list` (ResponsiveRows' card list). */
const LIST_SELECTOR =
  'table, [role="table"], [role="grid"], [data-row-list], [data-row-nav-list]';

/** Where `target` is, relative to the page `column`. */
export function focusPlaceOf(
  target: EventTarget | null,
  column: Element | null,
): FocusPlace {
  if (
    !(target instanceof HTMLElement) ||
    target === document.body ||
    target === document.documentElement
  ) {
    return "body";
  }
  if (target.closest('[role="dialog"]') !== null) {
    return "dialog";
  }
  if (keysBelongElsewhere(target)) {
    return "field";
  }
  if (rowOf(target) !== null) {
    return "row";
  }
  if (column === null || !column.contains(target)) {
    return "outside";
  }
  if (target.matches(CONTROL_SELECTOR)) {
    return "control";
  }
  return target.closest(LIST_SELECTOR) === null ? "page" : "list";
}

// ─── The single-key setting ─────────────────────────────────────────────────

/** localStorage key for the single-key shortcuts setting ("on" / "off"). */
export const SINGLE_KEY_STORAGE_KEY = "forensix.singleKeyShortcuts";

/** On unless the stored value says "off" (on by default). */
export function parseSingleKeySetting(stored: string | null): boolean {
  return stored !== "off";
}

const singleKeyListeners = new Set<() => void>();

function readSingleKeySetting(): boolean {
  try {
    return parseSingleKeySetting(
      globalThis.localStorage.getItem(SINGLE_KEY_STORAGE_KEY),
    );
  } catch {
    // Storage unavailable (a locked-down profile): the default.
    return true;
  }
}

let singleKeysOn = readSingleKeySetting();

/** Whether J / K / `[` act at all. */
export function singleKeyShortcutsOn(): boolean {
  return singleKeysOn;
}

/** Turns J / K / `[` on or off, and remembers it for the next visit. */
export function setSingleKeyShortcuts(on: boolean): void {
  singleKeysOn = on;
  try {
    globalThis.localStorage.setItem(SINGLE_KEY_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Not persisted; the choice still holds for this visit.
  }
  for (const listener of singleKeyListeners) {
    listener();
  }
}

function subscribeSingleKeys(listener: () => void): () => void {
  singleKeyListeners.add(listener);
  return () => {
    singleKeyListeners.delete(listener);
  };
}

/** The setting, re-rendering when it changes. */
export function useSingleKeyShortcuts(): boolean {
  return useSyncExternalStore(subscribeSingleKeys, singleKeyShortcutsOn);
}

// ─── Handlers ───────────────────────────────────────────────────────────────

function handle(
  event: KeyboardEvent,
  scope: ParentNode,
  column: Element | null,
  /** At the first or last row, keep the arrow from scrolling the page
   *  (the page-wide handler; a list's own handler lets it pass on). */
  holdAtEnds: boolean,
): void {
  if (event.defaultPrevented || event.isComposing) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const place = focusPlaceOf(event.target, column);
  const delta = rowKeyDelta(event, place, singleKeysOn);
  if (delta === null) {
    return;
  }
  if (moveRowFocus(target, delta, scope)) {
    event.preventDefault();
  } else if (place === "row" && holdAtEnds) {
    // At the first or last row: the arrow stays on the row instead of
    // scrolling the page out from under it.
    event.preventDefault();
  }
}

/**
 * J / K / ↑ / ↓ between the rows inside `ref` (a list or table container).
 * Wire it where the rows are rendered:
 *
 *   const listRef = useRef<HTMLDivElement>(null);
 *   useRowKeyboardNav(listRef);
 *   <div ref={listRef}>…rows…</div>
 *
 * and give each focusable row `data-row-nav` (optional: today's row markup
 * already matches `ROW_NAV_SELECTOR`).
 */
export function useRowKeyboardNav(
  ref: RefObject<HTMLElement | null>,
  options: { readonly enabled?: boolean } = {},
): void {
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || element === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // The list is inside the page column; reading the column from the
      // list keeps "a control in the list" a control.
      handle(
        event,
        element,
        element.closest("[data-page-column]") ?? element,
        false,
      );
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, enabled]);
}

/** The page-wide keys: J / K from a row, a list or the page itself, ↑ / ↓
 *  on a row. Installed once by the shell. */
export function useGlobalRowKeys(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const scope = ref.current;
      if (scope === null) {
        return;
      }
      handle(event, scope, scope, true);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}

/** `[` shows or hides the sidebar, from the page itself only (the FF
 *  provider's own app-wide binding is turned off: `shortcut={null}`). */
export function useSidebarKey(
  ref: RefObject<HTMLElement | null>,
  toggle: () => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) {
        return;
      }
      const place = focusPlaceOf(event.target, ref.current);
      if (sidebarKeyFires(event, place, singleKeysOn)) {
        event.preventDefault();
        toggle();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, toggle]);
}
