/**
 * Whether the ⌘K menu is open, for the one place outside the menu that
 * must know: a row sheet does not open underneath it (`useRowSelection`).
 * A pick made just before the menu was reopened can name a row whose page
 * is still loading; its sheet waits until the menu closes instead of
 * opening over - and hiding - the menu the user is typing in.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setCommandMenuOpen(next: boolean): void {
  if (next === open) {
    return;
  }
  open = next;
  for (const listener of listeners) {
    listener();
  }
}

export function useCommandMenuOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => open,
    () => false,
  );
}
