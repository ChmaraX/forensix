/**
 * Shared by the identity pages (Cookies, Saved logins, Form data,
 * Bookmarks): pivots drawn inside a table cell, the Case-wide profile lens
 * as these pages apply it, and empty states worded from the Completeness
 * Statement.
 *
 * Pivots follow related.ts: a link appears only when the value it filters
 * by is recorded exactly and the other page holds it -
 *  - a host opens Sites only when Sites lists that exact host key
 *    (`siteKeyOf`, the Sites route's own key);
 *  - a URL opens History only when History holds a visit whose URL is the
 *    same string (`exactVisitsOf`).
 * Until the check has answered, the value reads as plain text, so a link
 * never appears and then goes dead.
 *
 * A cell link is a pointer shortcut inside a row that itself opens the row
 * sheet: a click on the link never opens the sheet, and the link takes no
 * tab stop of its own (`tabIndex={-1}`), so Tab and J / K still walk rows,
 * not rows and links. The keyboard path to the same place is the row
 * sheet's Related block (Enter, then "Open in Sites" / "Open visit").
 * Stacked phone cards are buttons, so they draw no cell link at all.
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

import { Button } from "@/components/ui/button";
import type { AppIcon } from "@/lib/app-icons";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import { caseSiteHosts, exactVisitsOf } from "../case-reads.js";
import { siteKeyOf } from "../related.js";
import type { ViewLocation } from "../router.js";
import type { CaseCompleteness } from "../types.js";
import {
  hrefFor,
  openPage,
  updateView,
  useViewProfiles,
} from "../view-state.js";
import { coverageOf, type CoverageScope } from "./completeness.js";
import {
  emptyCoverageOf as coverageWordsOf,
  joinWords,
  type EmptyCoverage,
} from "./identity-coverage.js";
import { EmptyRows } from "./data-table.js";
import { profileLabel } from "./finding-fields.js";

/* -------------------------------- cell link ------------------------------- */

/**
 * The look of a value that is also a link: the cell's own text with FF's
 * typeset underline, lighter at rest (22% of the text colour, so a column
 * of links stays quiet) and full on hover - a linked host reads as the
 * same value, not as a coloured button.
 */
const LINK_CLASS =
  "min-w-0 cursor-pointer underline underline-offset-[0.2em] [text-decoration-color:color-mix(in_oklab,currentColor_22%,transparent)] transition-[text-decoration-color] duration-80 hover:[text-decoration-color:currentColor]";

type Extras = Partial<Omit<ViewLocation, "page">>;

/** A plain click navigates in place; a modified or middle click is left to
 *  the browser (new tab / window) through the real `href`. Neither reaches
 *  the row, which would open its sheet. */
function CellLink({
  page,
  extras,
  label,
  className,
  children,
}: {
  readonly page: string;
  readonly extras: Extras;
  /** Where it goes, as the tooltip and the accessible description ("Open
   *  teamviewer.com in Sites"); the name stays the value shown, so the
   *  visible label is the spoken one. */
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
      tabIndex={-1}
      title={label}
      onClick={onClick}
      onAuxClick={stop}
      onKeyDown={stopKey}
      onPointerEnter={refresh}
      onFocus={refresh}
      className={cn(LINK_CLASS, className)}
    >
      {children}
    </a>
  );
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

function stopKey(event: KeyboardEvent) {
  event.stopPropagation();
}

/* ------------------------------ host → Sites ------------------------------ */

interface HostList {
  readonly hosts: ReadonlySet<string>;
  readonly complete: boolean;
}

let hostList: HostList | null = null;
let hostRead: Promise<void> | null = null;
const hostListeners = new Set<() => void>();

function readHostList(): void {
  hostRead ??= caseSiteHosts()
    .then((result) => {
      hostList = {
        hosts: new Set(result.hosts.map((entry) => entry.host)),
        complete: result.complete,
      };
      for (const listener of hostListeners) {
        listener();
      }
    })
    .catch(() => {
      // Forgotten, so the next mount tries again; until then no link.
      hostRead = null;
    });
}

function subscribeHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

/** True once Sites is known to list `key` (a list cut short at its cap
 *  cannot rule a host out). */
function useSitesLists(key: string | null): boolean {
  const list = useSyncExternalStore(subscribeHosts, () => hostList);
  useEffect(() => {
    readHostList();
  }, []);
  return (
    key !== null && list !== null && (!list.complete || list.hosts.has(key))
  );
}

/**
 * A host value (or a URL / cookie host key the host is read from) that
 * opens Sites on that host once Sites is known to list it; plain text
 * until then, and for good when it does not.
 */
export function SiteHostLink({
  raw,
  className,
  children,
}: {
  /** The recorded host, URL or host key (`siteKeyOf` keys it). */
  readonly raw: string | null;
  readonly className?: string;
  /** The value as the cell shows it. */
  readonly children: ReactNode;
}) {
  const key = siteKeyOf(raw);
  const listed = useSitesLists(key);
  const extras = useMemo(() => ({ host: key }), [key]);
  if (!listed || key === null) {
    return <span className={className}>{children}</span>;
  }
  return (
    <CellLink
      page="sites"
      extras={extras}
      label={`Open ${key} in Sites`}
      className={className}
    >
      {children}
    </CellLink>
  );
}

/* ------------------------------ URL → History ----------------------------- */

/** Where History's visits to one URL are: none, or the tab to open on (the
 *  Saved tab when any exact visit is saved). */
type VisitPresence = { readonly tab: "saved" | "recovered" } | null;

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
        .then(({ visits }) => {
          const value: VisitPresence =
            visits.length === 0
              ? null
              : {
                  tab: visits.some((visit) => visit.commitState === "committed")
                    ? "saved"
                    : "recovered",
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
 * its visits, once History is known to hold a visit to exactly that URL;
 * plain text until then, and for good when it holds none.
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
      label="Open the visits to this URL in History"
      className={className}
    >
      {children}
    </CellLink>
  );
}

/* ------------------------------- profile lens ----------------------------- */

/**
 * The Case-wide profile pick as these pages apply it (client-side, over the
 * loaded rows): `applies(profile)` keeps a row, `options` is what the
 * picker lists (the profiles the rows carry, plus any picked elsewhere that
 * carry none here, so a pick never disappears from its own picker), and
 * `showPicker` is false when there is nothing to choose between.
 */
export function useProfileLens(rowProfiles: readonly string[]): {
  readonly selected: readonly string[];
  readonly setSelected: (profiles: readonly string[]) => void;
  readonly options: readonly string[];
  readonly showPicker: boolean;
  readonly applies: (profile: string) => boolean;
  /** "Profile 2" / "Default profile and Profile 2", for empty-state words. */
  readonly words: string | null;
} {
  const [selected, setSelected] = useViewProfiles();
  const options = useMemo(
    () => [...new Set([...rowProfiles, ...selected])].sort(),
    [rowProfiles, selected],
  );
  const applies = useCallback(
    (profile: string) => selected.length === 0 || selected.includes(profile),
    [selected],
  );
  return {
    selected,
    setSelected,
    options,
    showPicker: options.length > 1 || selected.length > 0,
    applies,
    words: selected.length === 0 ? null : joinWords(selected.map(profileLabel)),
  };
}

/** Drops the page's filters in one history entry: its search and the
 *  profile pick (the lens), as History's "Clear filters" does. */
export function clearSearchAndProfiles(): void {
  updateView({ q: null, profiles: [] });
}

/* ------------------------------ coverage reads ---------------------------- */

let completenessRead: Promise<CaseCompleteness> | null = null;

/** The Case's Completeness Statement, read once (the Case is read-only). */
function caseCompleteness(): Promise<CaseCompleteness> {
  completenessRead ??= callApi<CaseCompleteness>("completeness", []).catch(
    (error: unknown) => {
      completenessRead = null;
      throw error;
    },
  );
  return completenessRead;
}

/** The coverage of one Completeness artifact ("Login Data"), or null while
 *  it is read (or when it could not be). */
export function useArtifactCoverage(artifact: string): CoverageScope | null {
  const [scope, setScope] = useState<CoverageScope | null>(null);
  useEffect(() => {
    let live = true;
    caseCompleteness()
      .then((completeness) => {
        if (live) {
          setScope(coverageOf(completeness, [artifact]));
        }
      })
      .catch(() => {
        // The shell shows the coverage failure; the page words stay
        // generic.
      });
    return () => {
      live = false;
    };
  }, [artifact]);
  return scope;
}

/* ------------------------------- empty states ----------------------------- */

/** How an artifact with no rows was covered, profiles in their one name. */
export function emptyCoverageOf(scope: CoverageScope | null): EmptyCoverage {
  return coverageWordsOf(scope, profileLabel);
}

/**
 * The empty state of an identity page with no rows at all, worded from its
 * coverage (onboard: what would be here, why there is nothing, where to
 * look next):
 *  - read and empty: "Login Data was read for Default profile and Profile
 *    2 and holds no stored logins, saved or recovered.";
 *  - no file anywhere: "No Login Data database" - a missing database is
 *    not an empty one, and the words keep the two apart;
 *  - not analysed: says so.
 */
export function ArtifactEmpty({
  icon,
  coverage,
  source,
  title,
  what,
  sidecars = true,
  pivot,
}: {
  readonly icon: AppIcon;
  readonly coverage: EmptyCoverage;
  /** The file Chrome keeps these rows in, and what it is. */
  readonly source: {
    readonly name: string;
    readonly kind: "database" | "file";
  };
  /** "No saved logins". */
  readonly title: string;
  /** "stored logins" (plural noun, lower case). */
  readonly what: string;
  /** The file has WAL / journal sidecars (so "saved or recovered" applies). */
  readonly sidecars?: boolean;
  /** The next place to look (`EmptyPivot`). */
  readonly pivot?: ReactNode;
}) {
  const either = sidecars ? ", saved or recovered" : "";
  let heading = title;
  let message: string;
  switch (coverage.kind) {
    case "read":
      message = `${source.name} was read for ${coverage.read} and holds no ${what}${either}.`;
      break;
    case "no-file":
      heading = `No ${source.name} ${source.kind}`;
      message = `No profile in this Case has a ${source.name} ${source.kind}, where Chrome keeps ${what}. A missing ${source.kind} is not the same as an empty one.`;
      break;
    case "not-analysed":
      message = `${source.name} was not analysed for this Case, so there are no ${what} to list.`;
      break;
    default:
      message = `No ${what} in this Case${either}.`;
  }
  return (
    <EmptyRows
      icon={icon}
      title={heading}
      message={<span className="block text-pretty">{message}</span>}
      action={pivot}
    />
  );
}

/**
 * The next place to look from an empty page: one quiet tertiary link (a
 * real `<a>`, so it opens in a new tab too).
 */
export function EmptyPivot({
  page,
  children,
}: {
  readonly page: string;
  readonly children: ReactNode;
}) {
  return (
    <Button asChild variant="tertiary" size="compact">
      <a href={hrefFor(page)}>{children}</a>
    </Button>
  );
}
