/**
 * A host in a table cell as a link to that host in Sites - only when the
 * Sites list has exactly that host, else plain text.
 *
 * The link is a pointer shortcut inside a clickable row: its click opens
 * Sites instead of the row, and it takes no tab stop of its own (the row is
 * the stop; the row sheet's Related block carries the same link for the
 * keyboard). A real `<a href>`, so a middle click or "open in new tab"
 * works and Back returns here.
 *
 * Wrap the list in `SitesHostKeysProvider` (one read of the Sites host list
 * per session); rows stay memoised and still learn the list when it lands.
 */
import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { hrefFor, openPage } from "../view-state.js";
import { useSitesHostKeys } from "./sites-hosts.js";

const SitesHostKeysContext = createContext<ReadonlySet<string> | null>(null);

/** Provides the hosts the Sites list has to the `HostLink`s inside. */
export function SitesHostKeysProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const keys = useSitesHostKeys();
  return (
    <SitesHostKeysContext.Provider value={keys}>
      {children}
    </SitesHostKeysContext.Provider>
  );
}

export function HostLink({
  host,
  className,
  children,
}: {
  /** The host as Sites keys it (`siteKeyOf`), or null for none. */
  readonly host: string | null;
  readonly className?: string;
  /** What the cell shows (the host as recorded). */
  readonly children: ReactNode;
}) {
  const siteKeys = useContext(SitesHostKeysContext);
  if (host === null || siteKeys?.has(host) !== true) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={hrefFor("sites", { host })}
      tabIndex={-1}
      title={`Open ${host} in Sites`}
      onClick={(event) => {
        // The row opens its sheet on click; the link goes to Sites instead.
        event.stopPropagation();
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        // A memoised row keeps the href it rendered with; open Sites with
        // the lens as it is now.
        event.preventDefault();
        openPage("sites", { host });
      }}
      className={cn(
        "rounded-sm underline decoration-transparent underline-offset-2 transition-[text-decoration-color] duration-80 hover:decoration-current",
        className,
      )}
    >
      {children}
    </a>
  );
}
