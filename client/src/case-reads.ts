/**
 * Case-wide reads the shell's helpers share (the ⌘K menu, the row sheet's
 * Related block), each made at most once per session: the Case is
 * read-only, so its activity and its host list cannot change under the
 * dashboard. A failed read is forgotten, so the next caller tries again.
 */
import { callApi } from "./api.js";
import { caseActivity } from "./components/activity-data.js";
import { recordedText } from "./related.js";
import type { Finding, PageOf, SiteHost } from "./types.js";

/** The Case's activity, read once. One read for the whole app: the same
 *  shared read History and Timeline use (`caseActivity` in
 *  components/activity-data). */
export { caseActivity };

/** The Case's declared timezone (null: UTC days), read once: the one zone
 *  for server `from` / `to` bounds (a day link into the Timeline). */
export async function caseTimeZone(): Promise<string | null> {
  try {
    return (await caseActivity()).timeZone;
  } catch {
    return null;
  }
}

/** Upper bound on `site-hosts` pages the ⌘K menu reads (100 hosts each). */
const SITE_HOST_PAGE_CAP = 20;

let siteHosts: Promise<{
  readonly hosts: readonly SiteHost[];
  readonly complete: boolean;
}> | null = null;

/** Every host the Sites view groups by, in its order, read once (up to
 *  `SITE_HOST_PAGE_CAP` pages; `complete` says whether the list ran out). */
export function caseSiteHosts(): Promise<{
  readonly hosts: readonly SiteHost[];
  readonly complete: boolean;
}> {
  siteHosts ??= (async () => {
    const hosts: SiteHost[] = [];
    let after: string | null = null;
    for (let page = 0; page < SITE_HOST_PAGE_CAP; page += 1) {
      const parameters: (readonly [string, string])[] = [["limit", "100"]];
      if (after !== null) {
        parameters.push(["after", after]);
      }
      const result: PageOf<SiteHost> = await callApi<PageOf<SiteHost>>(
        "site-hosts",
        parameters,
      );
      hosts.push(...result.items);
      after = result.nextCursor;
      if (after === null) {
        return { hosts, complete: true };
      }
    }
    return { hosts, complete: false };
  })().catch((error: unknown) => {
    siteHosts = null;
    throw error;
  });
  return siteHosts;
}

/** Page size of the exact-URL visit read. */
const VISIT_LOOKUP_LIMIT = 100;

/**
 * Visits to exactly `url`, saved and recovered: History's own search (which
 * matches any part of the URL or title) narrowed to rows whose URL is the
 * same string. Reads one page per Commit State; `more` says a page was full,
 * so further exact matches may exist (`savedMore`: the saved one was). A
 * cut-off read with no exact match proves nothing: callers then offer
 * History searched for the URL, never "no visit".
 */
export async function exactVisitsOf(url: string): Promise<{
  readonly visits: readonly Finding[];
  readonly more: boolean;
  readonly savedMore: boolean;
}> {
  const states = ["committed", "wal_resident", "journal_resident"] as const;
  const pages = await Promise.all(
    states.map((state) =>
      callApi<PageOf<Finding>>("history", [
        ["view", "visits"],
        ["search", url],
        ["sort", "visit-time"],
        ["direction", "desc"],
        ["limit", String(VISIT_LOOKUP_LIMIT)],
        ["commit-state", state],
      ]),
    ),
  );
  return {
    visits: pages.flatMap((page) =>
      page.items.filter((visit) => recordedText(visit.fields.url) === url),
    ),
    more: pages.some((page) => page.nextCursor !== null),
    // `states[0]` is the saved (committed) read.
    savedMore: (pages[0]?.nextCursor ?? null) !== null,
  };
}

/** Upper bound on pages (100 rows each) one ⌘K index read drains per
 *  Commit State. */
const INDEX_PAGE_CAP = 20;
const INDEX_STATES = ["committed", "wal_resident", "journal_resident"] as const;

/** Every row of `route` the ⌘K index lists, saved and recovered, up to
 *  `INDEX_PAGE_CAP` pages per Commit State (`complete` says whether every
 *  read ran out). */
async function drainForIndex(route: string): Promise<{
  readonly rows: readonly Finding[];
  readonly complete: boolean;
}> {
  const reads = await Promise.all(
    INDEX_STATES.map(async (state) => {
      const rows: Finding[] = [];
      let after: string | null = null;
      for (let page = 0; page < INDEX_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["limit", "100"],
          ["commit-state", state],
        ];
        if (after !== null) {
          parameters.push(["after", after]);
        }
        const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
          route,
          parameters,
        );
        rows.push(...result.items);
        after = result.nextCursor;
        if (after === null) {
          return { rows, complete: true };
        }
      }
      return { rows, complete: false };
    }),
  );
  return {
    rows: reads.flatMap((read) => read.rows),
    complete: reads.every((read) => read.complete),
  };
}

type IndexRead = Promise<{
  readonly rows: readonly Finding[];
  readonly complete: boolean;
}>;

let downloadRows: IndexRead | null = null;
let savedLoginRows: IndexRead | null = null;

/** The Case's downloads (every Commit State), read once, for ⌘K's Files. */
export function caseDownloads(): IndexRead {
  downloadRows ??= drainForIndex("downloads").catch((error: unknown) => {
    downloadRows = null;
    throw error;
  });
  return downloadRows;
}

/** The Case's saved logins (every Commit State), read once, for ⌘K's
 *  Usernames. The index keeps only each row's recorded username and site
 *  (and its reference) - never a password field. */
export function caseSavedLogins(): IndexRead {
  savedLoginRows ??= drainForIndex("credentials").catch((error: unknown) => {
    savedLoginRows = null;
    throw error;
  });
  return savedLoginRows;
}
