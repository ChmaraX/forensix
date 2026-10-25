/**
 * Case-wide reads the shell's helpers share (the ⌘K menu, the row sheet's
 * Related block, the cell links), each made at most once per session
 * (`once`): the Case is read-only, so its activity and its host list
 * cannot change under the dashboard. A failed read is forgotten, so the
 * next caller tries again.
 */
import { callApi } from "./api.js";
import { caseActivity } from "./components/activity-data.js";
import { fieldText } from "./field-readers.js";
import { COMMIT_STATES, once, readPages } from "./read-pages.js";
import type { Finding, PageOf, SiteHost } from "./types.js";

/** The Case's activity, read once. One read for the whole app: the same
 *  shared read History and Timeline use (`caseActivity` in
 *  components/activity-data). */
export { caseActivity };

/** The Case's declared timezone (null: the rows declare none or disagree,
 *  so days are UTC days), read once: the one zone for server `from` / `to`
 *  bounds (a day link into the Timeline). Rejects when the activity read
 *  fails - a day then cannot be told, never guessed in UTC. */
export async function caseTimeZone(): Promise<string | null> {
  return (await caseActivity()).timeZone;
}

/** Upper bound on `site-hosts` pages read (100 hosts each). */
const SITE_HOST_PAGE_CAP = 20;

/** Every host the Sites view groups by, in its order, read once (up to
 *  `SITE_HOST_PAGE_CAP` pages; `complete` says whether the list ran out). */
export const caseSiteHosts = once(
  async (): Promise<{
    readonly hosts: readonly SiteHost[];
    readonly complete: boolean;
  }> => {
    const { rows, complete } = await readPages<SiteHost>(
      "site-hosts",
      [["limit", "100"]],
      { cap: SITE_HOST_PAGE_CAP },
    );
    return { hosts: rows, complete };
  },
);

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
export async function exactVisitsOf(
  url: string,
  signal?: AbortSignal,
): Promise<{
  readonly visits: readonly Finding[];
  readonly more: boolean;
  readonly savedMore: boolean;
}> {
  const [saved, ...recovered] = await Promise.all(
    COMMIT_STATES.map((state) =>
      callApi<PageOf<Finding>>(
        "history",
        [
          ["view", "visits"],
          ["search", url],
          ["sort", "visit-time"],
          ["direction", "desc"],
          ["limit", String(VISIT_LOOKUP_LIMIT)],
          ["commit-state", state],
        ],
        { signal },
      ),
    ),
  );
  const pages = [saved, ...recovered];
  return {
    visits: pages.flatMap(
      (page) =>
        page?.items.filter((visit) => fieldText(visit.fields.url) === url) ??
        [],
    ),
    more: pages.some((page) => (page?.nextCursor ?? null) !== null),
    savedMore: (saved?.nextCursor ?? null) !== null,
  };
}

/** Upper bound on pages (100 rows each) one ⌘K index read drains per
 *  Commit State. */
const INDEX_PAGE_CAP = 20;

type IndexRead = Promise<{
  readonly rows: readonly Finding[];
  readonly complete: boolean;
}>;

/** Every row of `route` the ⌘K index lists, saved and recovered, up to
 *  `INDEX_PAGE_CAP` pages per Commit State (`complete` says whether every
 *  read ran out). */
async function drainForIndex(route: string): IndexRead {
  const reads = await Promise.all(
    COMMIT_STATES.map((state) =>
      readPages<Finding>(
        route,
        [
          ["limit", "100"],
          ["commit-state", state],
        ],
        { cap: INDEX_PAGE_CAP },
      ),
    ),
  );
  return {
    rows: reads.flatMap((read) => read.rows),
    complete: reads.every((read) => read.complete),
  };
}

/** The Case's downloads (every Commit State), read once, for ⌘K's Files. */
export const caseDownloads = once(() => drainForIndex("downloads"));

/** The Case's saved logins (every Commit State), read once, for ⌘K's
 *  Usernames. The index keeps only each row's recorded username and site
 *  (and its reference) - never a password field. */
export const caseSavedLogins = once(() => drainForIndex("credentials"));
