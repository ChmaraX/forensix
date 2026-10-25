/**
 * The dashboard's address: which page is open and the view on it, held in
 * the URL hash so Back / Forward, a refresh and a copied link all restore
 * the same view. The server serves one file, so the hash is the whole
 * route; nothing here talks to the server.
 *
 *   #/history?from=2024-03-12&to=2024-03-14&profile=Default&tab=recovered&row=…
 *
 * Parameters (each optional; the order is fixed so one view has one URL):
 *  - `from` / `to`  the Case-wide date range, Case days (`YYYY-MM-DD`);
 *  - `profile`      the Case-wide profile selection (repeated, sorted);
 *  - `host`         the host a page is focused on (Sites);
 *  - `q`            a page's search text (History);
 *  - `tab`          `recovered` when the page's Recovered list is on show;
 *  - `row`          the open row's reference (`rowRefOf`: its record id,
 *                   `history:180`; an older source-chain reference still
 *                   opens its row).
 *
 * Range and profiles are the shell's lens: they travel with every page
 * change. Host, search, tab and row belong to one page and reset when the
 * page changes, unless the change carries its own (a link to a host in
 * Sites).
 *
 * Pure: parsing and formatting never touch `window`, so they are unit
 * tested (router.test.ts). The live store is `view-state.tsx`.
 */
import { DEFAULT_PAGE, isPageKey, type PageKey } from "./pages.js";
import type { CommitState } from "./types.js";

/** Which of a page's two lists is on show. */
export type ViewTab = "saved" | "recovered";

/** Every view the URL can hold. */
export interface ViewLocation {
  readonly page: PageKey;
  /** First Case day of the range, `YYYY-MM-DD`, or `""` (open). */
  readonly from: string;
  /** Last Case day of the range, `YYYY-MM-DD`, or `""` (open). */
  readonly to: string;
  /** Profiles picked across the Case, sorted and distinct (so one pick has
   *  one URL whatever order it was made in); empty means every profile. */
  readonly profiles: readonly string[];
  /** The host the page is focused on (Sites), or null. */
  readonly host: string | null;
  /** The page's search text, or null. */
  readonly q: string | null;
  /** The page's own one-of filter (Bookmarks folder, Form data category,
   *  Timeline event kind, Sites kind), or null. */
  readonly filter: string | null;
  readonly tab: ViewTab;
  /** The open row (`rowRefOf`), or null. */
  readonly row: string | null;
}

/** A profile pick in its one written form: distinct, non-empty, sorted by
 *  code unit. */
export function canonicalProfiles(
  profiles: readonly string[],
): readonly string[] {
  return [...new Set(profiles.filter((name) => name !== ""))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

export const DEFAULT_LOCATION: ViewLocation = {
  page: DEFAULT_PAGE,
  from: "",
  to: "",
  profiles: [],
  host: null,
  q: null,
  filter: null,
  tab: "saved",
  row: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in `YYYY-MM-DD` form. */
export function isDay(text: string): boolean {
  if (!DAY.test(text)) {
    return false;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === text
  );
}

/** A range as the pages use it: valid days or `""`, never reversed. */
export function normalizeRange(
  from: string,
  to: string,
): { readonly from: string; readonly to: string } {
  const start = isDay(from) ? from : "";
  const end = isDay(to) ? to : "";
  return start !== "" && end !== "" && start > end
    ? { from: end, to: start }
    : { from: start, to: end };
}

/** The page's view from a hash (`#/history?…`); anything unknown or
 *  malformed falls back to the default for that part. */
export function parseLocation(hash: string): ViewLocation {
  const body = hash.replace(/^#/, "").replace(/^\//, "");
  const queryAt = body.indexOf("?");
  const path = queryAt === -1 ? body : body.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? "" : body.slice(queryAt));
  let page: PageKey = DEFAULT_PAGE;
  try {
    const decoded = decodeURIComponent(path.replace(/\/+$/, ""));
    if (isPageKey(decoded)) {
      page = decoded;
    }
  } catch {
    // A malformed escape is an unknown page.
  }
  const range = normalizeRange(query.get("from") ?? "", query.get("to") ?? "");
  const profiles = canonicalProfiles(query.getAll("profile"));
  const text = (name: string) => {
    const value = query.get(name);
    return value === null || value === "" ? null : value;
  };
  return {
    page,
    from: range.from,
    to: range.to,
    profiles,
    host: text("host"),
    q: text("q"),
    filter: text("filter"),
    tab: query.get("tab") === "recovered" ? "recovered" : "saved",
    row: text("row"),
  };
}

/** The hash for a view (`#/history?from=…`), parameters in a fixed order
 *  and defaults left out. `parseLocation(formatLocation(x))` is `x`. */
export function formatLocation(location: ViewLocation): string {
  const query = new URLSearchParams();
  const range = normalizeRange(location.from, location.to);
  if (range.from !== "") {
    query.append("from", range.from);
  }
  if (range.to !== "") {
    query.append("to", range.to);
  }
  for (const profile of canonicalProfiles(location.profiles)) {
    query.append("profile", profile);
  }
  if (location.host !== null && location.host !== "") {
    query.append("host", location.host);
  }
  if (location.q !== null && location.q !== "") {
    query.append("q", location.q);
  }
  if (location.filter !== null && location.filter !== "") {
    query.append("filter", location.filter);
  }
  if (location.tab === "recovered") {
    query.append("tab", "recovered");
  }
  if (location.row !== null && location.row !== "") {
    query.append("row", location.row);
  }
  const page = isPageKey(location.page) ? location.page : DEFAULT_PAGE;
  const search = query.toString();
  return `#/${encodeURIComponent(page)}${search === "" ? "" : `?${search}`}`;
}

/** Same view, compared by its URL. */
export function sameLocation(a: ViewLocation, b: ViewLocation): boolean {
  return formatLocation(a) === formatLocation(b);
}

/**
 * The view a link or a nav pick opens: `page` with the lens (range,
 * profiles) carried, and the page's own state (host, search, filter, tab,
 * row)
 * fresh - set only by `extras` (a host for Sites, a row to open). The same
 * for the page on show: a nav pick on it starts it over.
 */
export function withPage(
  current: ViewLocation,
  page: PageKey,
  extras: Partial<Omit<ViewLocation, "page">> = {},
): ViewLocation {
  return {
    ...current,
    host: null,
    q: null,
    filter: null,
    tab: "saved",
    row: null,
    ...extras,
    page,
  };
}

/** The parts of a Finding or Candidate a row reference is made of. */
export interface RowRefSource {
  /** The record id every list route puts first (`history:180`): unique in
   *  the Case, across Sources and Profiles. */
  readonly id?: string;
  readonly profile?: string;
  /** Absent on identity Candidates (they carry no Commit State). */
  readonly commitState?: CommitState;
  readonly provenance: {
    readonly manifestPath?: string;
    readonly table?: string;
    readonly rowId?: string;
  };
}

/** A record id (`<store>:<rowid>`, e.g. `history:180`), as opposed to a
 *  legacy source-chain reference (which holds `|`). */
const RECORD_ID = /^[a-z][a-z-]*:[0-9]+$/;

export function isRecordId(ref: string): boolean {
  return RECORD_ID.test(ref);
}

/**
 * A row's reference in the URL: its record id (`history:180`), which core
 * keeps unique in the Case - two Sources holding the same file, table and
 * row id still get two ids. A row the server sent without an id falls back
 * to its legacy source-chain reference (`legacyRowRefOf`). A row with
 * neither has no reference (it opens, but is not addressable).
 */
export function rowRefOf(row: RowRefSource): string | null {
  if (row.id !== undefined && row.id !== "") {
    return row.id;
  }
  return legacyRowRefOf(row);
}

/** Whether `ref` (from the URL) names `row`: its record id, or the legacy
 *  source-chain reference an older link may still carry. */
export function rowMatchesRef(row: RowRefSource, ref: string): boolean {
  return rowRefOf(row) === ref || legacyRowRefOf(row) === ref;
}

/**
 * The reference links carried before rows had a record id: the source
 * chain (manifest path · table · row id), the profile and the Commit
 * State, joined by `|`. Kept so an old link still opens its row; it is not
 * unique across Sources (two Sources can hold the same relative file), so
 * no new link is built from it while a row has an id.
 */
export function legacyRowRefOf(row: RowRefSource): string | null {
  if (row.commitState === undefined || row.profile === undefined) {
    return null;
  }
  const { manifestPath, table, rowId } = row.provenance;
  if (
    rowId === undefined ||
    rowId === "" ||
    table === undefined ||
    table === ""
  ) {
    return null;
  }
  return [manifestPath ?? "", table, rowId, row.profile, row.commitState].join(
    "|",
  );
}
