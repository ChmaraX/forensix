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
 *  - `profile`      the Case-wide profile selection (repeated);
 *  - `host`         the host a page is focused on (Sites);
 *  - `q`            a page's search text (History);
 *  - `tab`          `recovered` when the page's Recovered list is on show;
 *  - `row`          the open row's reference (`rowRefOf`).
 *
 * Range and profiles are the shell's lens: they travel with every page
 * change. Host, search, tab and row belong to one page and reset when the
 * page changes, unless the change carries its own (a link to a host in
 * Sites).
 *
 * Pure: parsing and formatting never touch `window`, so they are unit
 * tested (router.test.ts). The live store is `view-state.tsx`.
 */
import { ARTIFACTS } from "./artifacts.js";
import type { CommitState } from "./types.js";

/** Which of a page's two lists is on show. */
export type ViewTab = "saved" | "recovered";

/** Every view the URL can hold. */
export interface ViewLocation {
  /** A nav key: "overview", "timeline", "sites", or an artifact key. */
  readonly page: string;
  /** First Case day of the range, `YYYY-MM-DD`, or `""` (open). */
  readonly from: string;
  /** Last Case day of the range, `YYYY-MM-DD`, or `""` (open). */
  readonly to: string;
  /** Profiles picked across the Case; empty means every profile. */
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

export const DEFAULT_PAGE = "overview";

/**
 * The evidence pages in the sidebar's order: activity first, then stored
 * identity data, with browser metadata last as context.
 */
export const EVIDENCE_ORDER = [
  "history",
  "downloads",
  "bookmarks",
  "top-sites",
  "cookies",
  "credentials",
  "autofill",
  "cache",
  "favicons",
  "metadata",
] as const;

/** Every page the shell can show, in nav order, with its title. */
export const PAGES: readonly {
  readonly key: string;
  readonly label: string;
}[] = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "sites", label: "Sites" },
  ...EVIDENCE_ORDER.flatMap((key) => {
    const artifact = ARTIFACTS.find((entry) => entry.key === key);
    return artifact === undefined
      ? []
      : [{ key: artifact.key, label: artifact.label }];
  }),
];

/** The page's title ("Saved logins"), or null for an unknown key. */
export function pageLabelOf(page: string): string | null {
  return PAGES.find((entry) => entry.key === page)?.label ?? null;
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
  let page = DEFAULT_PAGE;
  try {
    const decoded = decodeURIComponent(path.replace(/\/+$/, ""));
    if (pageLabelOf(decoded) !== null) {
      page = decoded;
    }
  } catch {
    // A malformed escape is an unknown page.
  }
  const range = normalizeRange(query.get("from") ?? "", query.get("to") ?? "");
  const profiles = [
    ...new Set(query.getAll("profile").filter((name) => name !== "")),
  ];
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
  for (const profile of new Set(location.profiles)) {
    if (profile !== "") {
      query.append("profile", profile);
    }
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
  const page =
    pageLabelOf(location.page) === null ? DEFAULT_PAGE : location.page;
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
  page: string,
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

/** The parts of a Finding a row reference is made of. */
export interface RowRefSource {
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: {
    readonly manifestPath?: string;
    readonly table?: string;
    readonly rowId?: string;
  };
}

/**
 * A row's reference in the URL: its source chain (manifest path · table ·
 * row id), its profile and its Commit State, joined by `|` — enough to find
 * exactly that row again among a page's loaded rows. A row without a row id
 * or table has no reference (it opens, but is not addressable).
 */
export function rowRefOf(row: RowRefSource): string | null {
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
