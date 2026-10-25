import type { MouseEvent } from "react";

/**
 * `onMouseDown` for an FF tab (`TabItem`): keeps its focus ring for the
 * keyboard only.
 *
 * Radix Tabs focus a tab from their own mousedown handler (`.focus()`), and
 * Chrome counts a scripted focus as keyboard-like, so the tab matched
 * `:focus-visible` and FF drew its ring after a plain click. Taking that
 * focus first with `focusVisible: false` (and stopping Radix's handler with
 * `preventDefault`) leaves no ring; Radix still selects the tab from its
 * focus event (automatic activation). A browser without the option focuses
 * as before. Only a plain left press is handled.
 */
export function focusTabWithoutRing(event: MouseEvent<HTMLElement>): void {
  if (event.button !== 0 || event.ctrlKey) {
    return;
  }
  event.preventDefault();
  event.currentTarget.focus({ focusVisible: false } as FocusOptions);
}
