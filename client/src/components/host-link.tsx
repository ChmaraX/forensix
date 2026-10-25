/**
 * Cell links: a value inside a table cell that is also a way to another
 * page - a host to Sites, a URL to its visits in History. One component
 * per pivot for every page (History, Top sites, Downloads, Cookies, Saved
 * logins, Form data, Bookmarks, Cache, Favicons) and one read of the
 * Sites host list per session, shared with the row sheet's Related block.
 *
 * Pivots follow related.ts: a link appears only when the value it filters
 * by is recorded exactly and the other page holds it -
 *  - a host opens Sites only when Sites lists that exact host key
 *    (`siteKeyOf`, the Sites route's own key; a list cut short at its page
 *    cap cannot rule a host out, so then every host links);
 *  - a URL opens History only when History holds a visit whose URL is the
 *    same string (`exactVisitsOf`), on the tab that holds it.
 * Until the check has answered, the value reads as plain text, so a link
 * never appears and then goes dead.
 *
 * A cell link is a pointer shortcut inside a row that itself opens the row
 * sheet: a click on the link never opens the sheet, and the link takes no
 * tab stop of its own (`tabIndex={-1}`), so Tab and J / K still walk rows,
 * not rows and links. The keyboard path to the same place is the row
 * sheet's Related block. Stacked phone cards are buttons, so callers draw
 * the value as plain text there. Each link is a real `<a href>` (a new
 * tab works, Back returns here), carrying the lens of the moment it is
 * used.
 *
 * Look: the cell's own text, never a colour of its own. The underline is
 * drawn only while its row is hovered (a column of underlined hosts at
 * rest would shout), muted, and firms up to the text colour under the
 * pointer - FF's 80ms colour step.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { caseSiteHosts, exactVisitsOf } from "../case-reads.js";
import { siteKeyOf } from "../related.js";
import type { ViewLocation } from "../router.js";
import type { FieldState } from "../types.js";
import { hrefFor, openPage } from "../view-state.js";
import { FieldCell } from "./finding-fields.js";
import { splitUrlHost } from "./url-host.js";

/* ------------------------------- the link -------------------------------- */

const LINK_CLASS =
  "min-w-0 cursor-pointer underline decoration-transparent underline-offset-[3px] transition-[text-decoration-color] duration-80 [tr:hover_&]:decoration-muted-foreground [tr:focus-visible_&]:decoration-muted-foreground hover:decoration-current [tr:hover_&:hover]:decoration-current";

type Extras = Partial<Omit<ViewLocation, "page">>;

function stop(event: MouseEvent) {
  event.stopPropagation();
}

function stopKey(event: KeyboardEvent) {
  event.stopPropagation();
}

/** A plain click navigates in place; a modified or middle click is left to
 *  the browser (new tab / window) through the real `href`. Neither reaches
 *  the row, which would open its sheet. */
function CellLink({
  page,
  extras,
  label,
  className,
  tabbable = false,
  children,
}: {
  readonly page: string;
  readonly extras: Extras;
  /** Takes a tab stop: a link outside a row (a card's host list), where no
   *  row sheet offers the keyboard path. @default false */
  readonly tabbable?: boolean;
  /** Where it goes, as the tooltip ("Open teamviewer.com in Sites"); the
   *  accessible name stays the value shown. */
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
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
      openPage(page, extras);
    },
    [page, extras],
  );
  // The href carries the lens as it is at the moment of use, not as it was
  // when the (memoised) row last rendered.
  const refresh = useCallback(
    (event: { readonly currentTarget: HTMLAnchorElement }) => {
      event.currentTarget.href = hrefFor(page, extras);
    },
    [page, extras],
  );
  return (
    <a
      href={hrefFor(page, extras)}
      tabIndex={tabbable ? undefined : -1}
      title={label}
      onClick={onClick}
      onAuxClick={stop}
      onKeyDown={stopKey}
      onPointerEnter={refresh}
      onFocus={refresh}
      className={cn(
        LINK_CLASS,
        // Outside a row nothing hover-reveals the underline: it shows muted
        // at rest, so the link is seen as one.
        tabbable && "decoration-muted-foreground",
        className,
      )}
    >
      {children}
    </a>
  );
}

/* ---------------------------- the Sites host list ------------------------- */

/** Which host keys Sites lists; `null` while the list is read or after a
 *  failed read (no links then - never one that may lead nowhere). */
export type SiteHostLookup = ((key: string) => boolean) | null;

let lookup: SiteHostLookup = null;
let hostRead: Promise<SiteHostLookup> | null = null;
const listeners = new Set<() => void>();

function readSiteHosts(): Promise<SiteHostLookup> {
  hostRead ??= caseSiteHosts()
    .then(({ hosts, complete }) => {
      const keys = new Set(hosts.map((entry) => entry.host));
      // A list cut short at its cap cannot rule a host out.
      const next: SiteHostLookup = complete
        ? (key) => keys.has(key)
        : () => true;
      lookup = next;
      for (const listener of listeners) {
        listener();
      }
      return next;
    })
    .catch(() => {
      // Forgotten, so the next caller tries again; until then no link.
      hostRead = null;
      return null;
    });
  return hostRead;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The Sites host list as a lookup, read once per session. Every link
 *  subscribes on its own, so memoised rows still learn the list when it
 *  lands. */
export function useSiteHosts(): SiteHostLookup {
  const current = useSyncExternalStore(subscribe, () => lookup);
  useEffect(() => {
    void readSiteHosts();
  }, []);
  return current;
}

/** True when Sites lists `key` (the row sheet's Related block); false on
 *  a failed read. */
export async function siteHostListed(key: string): Promise<boolean> {
  const answer = await readSiteHosts();
  return answer !== null && answer(key);
}

/* ------------------------------ host → Sites ------------------------------ */

/**
 * A recorded host, URL or cookie host key that opens Sites on that host
 * once Sites is known to list it; plain text (`<span className>`) until
 * then, and for good when it does not.
 */
export function SiteHostLink({
  host,
  className,
  tabbable = false,
  children,
}: {
  /** The recorded host, URL or host key (`siteKeyOf` keys it). */
  readonly host: string | null;
  readonly className?: string;
  /** Takes a tab stop (outside a row; see `CellLink`). @default false */
  readonly tabbable?: boolean;
  /** The value as the cell shows it. */
  readonly children: ReactNode;
}) {
  const key = siteKeyOf(host);
  const sites = useSiteHosts();
  const extras = useMemo(() => ({ host: key }), [key]);
  if (key === null || sites === null || !sites(key)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <CellLink
      page="sites"
      extras={extras}
      label={`Open ${key} in Sites`}
      className={className}
      tabbable={tabbable}
    >
      {children}
    </CellLink>
  );
}

/**
 * A URL field on the muted second line of a two-line cell (mono, at the
 * line's size), its host linked to Sites when Sites lists it; any other
 * value or state reads as `FieldCell` writes it.
 */
export function UrlWithSiteLink({
  field,
}: {
  readonly field: FieldState | undefined;
}) {
  const size = useSize();
  const url =
    field?.state === "value" && typeof field.value === "string"
      ? field.value
      : null;
  const parts = url === null ? null : splitUrlHost(url);
  if (url === null || parts === null || siteKeyOf(url) === null) {
    return <FieldCell field={field} mono />;
  }
  return (
    <span
      className={cn(size.type.body, "block truncate font-mono")}
      title={url}
    >
      {parts.head}
      <SiteHostLink host={url}>{parts.host}</SiteHostLink>
      {parts.tail}
    </span>
  );
}

/* ------------------------------ URL → History ----------------------------- */

/** Where History's visits to one URL are: none, or the tab to open on (the
 *  Saved tab when any exact visit is saved). `exact` is false when the
 *  exact-visit read was cut off before finding one: the link then opens
 *  History searched for the URL, which proves neither a visit nor none. */
type VisitPresence = {
  readonly tab: "saved" | "recovered";
  readonly exact: boolean;
} | null;

const presence = new Map<string, VisitPresence>();
const pending = new Map<string, Promise<VisitPresence>>();
const queue: (() => void)[] = [];
let running = 0;
/** At most this many exact-visit reads in flight, so a long list of
 *  bookmarks asks History a few URLs at a time. */
const VISIT_READS = 4;

function runNext(): void {
  while (running < VISIT_READS && queue.length > 0) {
    const task = queue.shift();
    task?.();
  }
}

function visitPresenceOf(url: string): Promise<VisitPresence> {
  const known = pending.get(url);
  if (known !== undefined) {
    return known;
  }
  const read = new Promise<VisitPresence>((resolve) => {
    queue.push(() => {
      running += 1;
      exactVisitsOf(url)
        .then(({ visits, more, savedMore }) => {
          // Only a read that ran out proves "no visit"; a cut-off one with
          // no exact match offers the search on the tab that was cut off.
          const value: VisitPresence =
            visits.length === 0
              ? more
                ? { tab: savedMore ? "saved" : "recovered", exact: false }
                : null
              : {
                  tab: visits.some((visit) => visit.commitState === "committed")
                    ? "saved"
                    : "recovered",
                  exact: true,
                };
          presence.set(url, value);
          resolve(value);
        })
        .catch(() => {
          // Unknown is not "none": forget it so a later mount asks again.
          pending.delete(url);
          resolve(null);
        })
        .finally(() => {
          running -= 1;
          runNext();
        });
    });
    runNext();
  });
  pending.set(url, read);
  return read;
}

/**
 * A recorded URL that opens History searched for it, on the tab that holds
 * its visits, once History is known to hold a visit to exactly that URL (or
 * the exact-visit read was cut off, so one may exist); plain text until
 * then, and for good when a complete read holds none.
 */
export function VisitedUrlLink({
  url,
  className,
  children,
}: {
  readonly url: string | null;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const [found, setFound] = useState<VisitPresence | undefined>(() =>
    url === null ? null : presence.get(url),
  );
  useEffect(() => {
    if (url === null) {
      setFound(null);
      return;
    }
    if (presence.has(url)) {
      setFound(presence.get(url));
      return;
    }
    let live = true;
    void visitPresenceOf(url).then((value) => {
      if (live) {
        setFound(value);
      }
    });
    return () => {
      live = false;
    };
  }, [url]);
  const extras = useMemo(
    () =>
      found === undefined || found === null || url === null
        ? null
        : { q: url, tab: found.tab },
    [found, url],
  );
  if (extras === null) {
    return <span className={className}>{children}</span>;
  }
  return (
    <CellLink
      page="history"
      extras={extras}
      label={
        found?.exact === false
          ? "Open History searched for this URL"
          : "Open the visits to this URL in History"
      }
      className={className}
    >
      {children}
    </CellLink>
  );
}
