/**
 * Keyboard model for evidence lists.
 *
 *  - J or ↓ moves to the next row, K or ↑ to the previous one, in page
 *    order - past the end of one list into the next (Sites stacks several);
 *    from outside a list, J lands on the first row of the page and K on the
 *    last. Enter (and Space) on a row
 *    opens its sheet - the rows already answer it (`activateOnKey`).
 *  - ↑ / ↓ only act while a row has focus, so the page still scrolls with
 *    the arrows everywhere else. J / K never act inside a text field, a
 *    menu, a dialog or with a modifier held.
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
 */
import { useEffect, type RefObject } from "react";

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

function deltaOf(event: KeyboardEvent, onRow: boolean): 1 | -1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "j") {
    return 1;
  }
  if (key === "k") {
    return -1;
  }
  if (onRow && event.key === "ArrowDown") {
    return 1;
  }
  if (onRow && event.key === "ArrowUp") {
    return -1;
  }
  return null;
}

function handle(
  event: KeyboardEvent,
  scope: ParentNode,
  /** At the first or last row, keep the arrow from scrolling the page
   *  (the page-wide handler; a list's own handler lets it pass on). */
  holdAtEnds: boolean,
): void {
  if (event.defaultPrevented || event.isComposing) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const onRow = rowOf(target) !== null;
  if (!onRow && keysBelongElsewhere(event.target)) {
    return;
  }
  const delta = deltaOf(event, onRow);
  if (delta === null) {
    return;
  }
  if (moveRowFocus(target, delta, scope)) {
    event.preventDefault();
  } else if (onRow && holdAtEnds) {
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
      handle(event, element, false);
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, enabled]);
}

/** The page-wide keys: J / K from anywhere in `ref` (the page column),
 *  ↑ / ↓ on a row. Installed once by the shell. */
export function useGlobalRowKeys(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const scope = ref.current;
      if (scope === null) {
        return;
      }
      // Inside an open dialog (the row sheet, ⌘K) the keys are its own.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]') !== null
      ) {
        return;
      }
      // Focus outside the column (the sidebar, the topbar) still lets J / K
      // land on the page's rows; arrows there keep their own meaning.
      handle(event, scope, true);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}
