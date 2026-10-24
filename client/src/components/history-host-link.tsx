/**
 * Host → Sites from inside a table cell (History, Top sites, Downloads).
 *
 * A host is a link only when Sites lists that exact host (`siteKeyOf`, the
 * key the Sites route groups by): never a guessed or partial match. The
 * link is a real `<a href="#/sites?host=…">` (a new tab works), opened
 * with the lens of the moment; a plain click navigates in place and Back
 * returns to the list.
 *
 * Inside a clickable row the link is a pointer shortcut: it does not open
 * the row, and it takes no tab stop of its own (the row is the stop; J / K
 * walk the rows). Its keyboard path is the row sheet's Related block
 * ("Host - Open in Sites"), which offers the same exact link. On a phone
 * the row is one button-card, so the stacked layouts draw the host as
 * plain text (`linked={false}`) and the sheet carries the pivot.
 */
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { caseSiteHosts } from "../case-reads.js";
import { siteKeyOf } from "../related.js";
import { hrefFor, openPage } from "../view-state.js";
import { FieldCell } from "./finding-fields.js";
import { splitUrlHost } from "./history-url-host.js";
import type { FieldState } from "../types.js";

/** Which host keys Sites lists. `null` while the list is read (no links
 *  yet - never a link that may lead nowhere). */
export type SiteHostLookup = ((key: string) => boolean) | null;

let lookup: SiteHostLookup = null;

/**
 * Sites' host list as a lookup, read once per session (`caseSiteHosts`).
 * A list cut short at its page cap cannot rule a host out, so then every
 * host links (the same rule as the row sheet's Related block). A failed
 * read links nothing.
 */
export function useSiteHosts(): SiteHostLookup {
  const [state, setState] = useState<SiteHostLookup>(() => lookup);
  useEffect(() => {
    if (lookup !== null) {
      return;
    }
    let cancelled = false;
    caseSiteHosts()
      .then(({ hosts, complete }) => {
        const keys = new Set(hosts.map((entry) => entry.host));
        lookup = complete ? (key) => keys.has(key) : () => true;
        if (!cancelled) {
          setState(() => lookup);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** Keeps a click or a key on the link from also opening the row. */
function stop(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation();
}

/** The link classes: the cell's own text, never a colour of its own. The
 *  underline is drawn only while its row is hovered or focused (a column
 *  of underlined hosts at rest would shout), muted, and firms up to the
 *  text colour under the pointer - FF's 80ms colour step. */
const LINK_CLASS =
  "cursor-pointer underline decoration-transparent underline-offset-[3px] transition-[text-decoration-color] duration-80 [tr:hover_&]:decoration-muted-foreground [tr:focus-visible_&]:decoration-muted-foreground [tr:hover_&:hover]:decoration-current";

/**
 * A host key linked to Sites. `children` is what the cell shows (the host,
 * or the host as written inside a URL).
 */
export function SiteHostLink({
  siteKey,
  children,
  className,
}: {
  readonly siteKey: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const label = `Open ${siteKey} in Sites`;
  // The href carries the lens of the moment it is used (a row may be
  // memoised across a lens change): refreshed on hover and focus, and a
  // plain click navigates through `openPage` directly.
  const refresh = (event: { currentTarget: HTMLAnchorElement }) => {
    event.currentTarget.href = hrefFor("sites", { host: siteKey });
  };
  return (
    <a
      href={hrefFor("sites", { host: siteKey })}
      tabIndex={-1}
      title={label}
      aria-label={label}
      className={cn(LINK_CLASS, className)}
      onPointerEnter={refresh}
      onFocus={refresh}
      onKeyDown={stop}
      onClick={(event) => {
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
        event.preventDefault();
        openPage("sites", { host: siteKey });
      }}
    >
      {children}
    </a>
  );
}

/**
 * A URL field in the muted second line of a two-line cell (mono, caption),
 * its host linked to Sites when Sites lists it; any other value or state
 * reads as `FieldCell` would write it.
 */
export function UrlWithSiteLink({
  field,
  sites,
}: {
  readonly field: FieldState | undefined;
  readonly sites: SiteHostLookup;
}) {
  const size = useSize();
  const url =
    field?.state === "value" && typeof field.value === "string"
      ? field.value
      : null;
  const parts = url === null ? null : splitUrlHost(url);
  const key = url === null ? null : siteKeyOf(url);
  if (
    url === null ||
    parts === null ||
    key === null ||
    sites === null ||
    !sites(key)
  ) {
    return <FieldCell field={field} mono />;
  }
  return (
    <span
      className={cn(size.type.body, "block truncate font-mono")}
      title={url}
    >
      {parts.head}
      <SiteHostLink siteKey={key}>{parts.host}</SiteHostLink>
      {parts.tail}
    </span>
  );
}
