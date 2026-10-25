/**
 * Where keyboard focus goes when the view changes under it - one module
 * for the shell and ⌘K:
 *
 *  - `pageHeading(column)`: the page's h1, made a programmatic focus
 *    target (`tabindex="-1"`, no ring);
 *  - `focusPageHeading(column, fromDrawer)`: after a page change, focus the
 *    new page's h1 (waiting for a page that builds its own, the Overview
 *    masthead), and after a pick in the phone drawer redirect the drawer's
 *    focus hand-back to its trigger to that h1;
 *  - `returnTarget(previous, column)`: where focus goes back to when a
 *    dialog closes without moving it - what had it, if still on show, else
 *    the h1;
 *  - `rescueFocusFromCollapsedSidebar()`: a sidebar collapse that hides
 *    the focused element hands focus to the topbar's sidebar trigger.
 *
 * Dialogs restore focus through their own `onCloseAutoFocus` (Radix): the
 * ⌘K menu calls `returnTarget` there; nothing here polls for a dialog.
 */

/** The page's h1, made a programmatic focus target. */
export function pageHeading(column: HTMLElement | null): HTMLElement | null {
  const heading = column?.querySelector<HTMLElement>("h1") ?? null;
  if (heading !== null && !heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
    heading.classList.add("outline-none");
  }
  return heading;
}

/** Focus is somewhere a page change may take it from: nowhere, the nav,
 *  the topbar, or the drawer trigger - never a field the user is in. */
function focusIsFree(column: HTMLElement): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    !column.contains(active) ||
    active.matches("h1")
  );
}

/** How long a page that builds its own h1 may take to render it. */
const HEADING_WAIT_MS = 5000;
/** How long after a drawer pick its focus hand-back is redirected. */
const DRAWER_HANDBACK_MS = 1500;

/**
 * After a page change: focus the new page's h1 (waiting for it when the
 * page builds its own). After a pick in the phone drawer, the drawer hands
 * focus back to its trigger as it closes; for a moment that hand-back is
 * redirected to the heading too, so keyboard users continue from the page
 * they opened. Returns the cleanup.
 */
export function focusPageHeading(
  column: HTMLElement,
  fromDrawer: boolean,
): () => void {
  const cleanups: (() => void)[] = [];
  const focus = () => {
    const heading = pageHeading(column);
    if (heading === null || !focusIsFree(column)) {
      return heading !== null;
    }
    heading.focus({ preventScroll: true });
    return true;
  };
  if (!focus()) {
    const observer = new MutationObserver(() => {
      if (focus()) {
        observer.disconnect();
      }
    });
    observer.observe(column, { childList: true, subtree: true });
    const stop = setTimeout(() => {
      observer.disconnect();
    }, HEADING_WAIT_MS);
    cleanups.push(() => {
      observer.disconnect();
      clearTimeout(stop);
    });
  }
  if (fromDrawer) {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[data-sidebar="trigger"]') !== null
      ) {
        pageHeading(column)?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", onFocusIn);
    const stop = setTimeout(() => {
      document.removeEventListener("focusin", onFocusIn);
    }, DRAWER_HANDBACK_MS);
    cleanups.push(() => {
      document.removeEventListener("focusin", onFocusIn);
      clearTimeout(stop);
    });
  }
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

/** The element focus should return to after a dialog closes: what had it
 *  when the dialog opened, if it is still on show; else the page's h1. */
export function returnTarget(
  previous: HTMLElement | null,
  column: HTMLElement | null,
): HTMLElement | null {
  if (
    previous !== null &&
    previous.isConnected &&
    previous.getClientRects().length > 0
  ) {
    return previous;
  }
  return pageHeading(column);
}

/**
 * When a sidebar collapse hides the element that had focus (a nav row, the
 * brand row's trigger, a ⌘K pick made from the sidebar), focus moves to
 * the topbar's sidebar trigger - the control that brings the sidebar back
 * - instead of falling to <body>. Returns the cleanup.
 */
export function rescueFocusFromCollapsedSidebar(): () => void {
  const trigger = () =>
    document.querySelector<HTMLElement>(
      '.inset-topbar [data-sidebar="trigger"]',
    );
  const collapsed = () =>
    document.querySelector('[data-slot="sidebar"][data-state="collapsed"]') !==
    null;
  const onFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (
      event.relatedTarget !== null ||
      !(target instanceof HTMLElement) ||
      target.closest('[data-slot="sidebar"]') === null
    ) {
      return;
    }
    // Once the browser has settled on <body> after the collapse.
    setTimeout(() => {
      const active = document.activeElement;
      if ((active === null || active === document.body) && collapsed()) {
        trigger()?.focus({ preventScroll: true });
      }
    }, 0);
  };
  document.addEventListener("focusout", onFocusOut);
  return () => {
    document.removeEventListener("focusout", onFocusOut);
  };
}
