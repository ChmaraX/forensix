/**
 * A media query as React state, kept in step with the viewport
 * (`useSyncExternalStore` over `matchMedia`). Lets a component mount one
 * layout instead of rendering both and hiding one with CSS.
 */
import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `sm` breakpoint (40rem): tables from here up, row cards
 *  below. */
export const SM_UP = "(min-width: 40rem)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = globalThis.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    [query],
  );
  const read = useCallback(() => globalThis.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}
