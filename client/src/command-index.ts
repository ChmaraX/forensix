/**
 * The ⌘K Case index, as pure rules (unit-tested in command-index.test.ts):
 * what each indexed thing is called, which words find it, and how many of a
 * group's matches are listed before an "N more" row.
 *
 *  - Days: every Case day with saved page visits; found by ISO date
 *    ("2024-03-12"), table format ("12 Mar 2024"), or day and month in
 *    either order, short or long ("Mar 12", "12 March").
 *  - Files: each download's file name (the last segment of its recorded
 *    target path), opening that exact Downloads row.
 *  - Usernames: each saved login's recorded username, opening that exact
 *    Saved logins row.
 *
 * Matching is the menu's own rule (every word of the query appears in the
 * row's text, case-insensitively); nothing is matched loosely or inferred.
 */
import { fileNameOf } from "./components/downloads-model.js";
import { profileLabel } from "./components/finding-fields.js";
import { formatDay } from "./day-format.js";
import { rowRefOf } from "./router.js";
import type { Finding } from "./types.js";
import { fieldText } from "./field-readers.js";
import { urlHostOf } from "./components/url-host.js";

/** Matches listed per group before its "N more" row. */
export const INDEX_GROUP_CAP = 8;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The words a Case day is found by: ISO, table format, and day / month in
 *  either order with the month short or long. */
export function dayKeywords(day: string): readonly string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    return [day];
  }
  const [, year = "", month = "", date = ""] = match;
  const long = MONTHS_LONG[Number(month) - 1] ?? "";
  const short = long.slice(0, 3);
  const dayNumber = String(Number(date));
  return [
    day,
    formatDay(day),
    `${short} ${dayNumber} ${year}`,
    `${dayNumber} ${long} ${year}`,
    `${long} ${dayNumber} ${year}`,
  ];
}

/** The menu's match rule: every word of `query` appears somewhere in
 *  `parts`, case-insensitively. An empty query matches everything. */
export function matchesQuery(parts: readonly string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = parts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The first `cap` matches of `query` among `entries` (in their order) and
 *  how many more there are. An empty query lists none. */
export function capMatches<T>(
  entries: readonly T[],
  query: string,
  partsOf: (entry: T) => readonly string[],
  cap: number = INDEX_GROUP_CAP,
): { readonly shown: readonly T[]; readonly more: number } {
  if (query.trim() === "") {
    return { shown: [], more: 0 };
  }
  const matched = entries.filter((entry) =>
    matchesQuery(partsOf(entry), query),
  );
  return {
    shown: matched.slice(0, cap),
    more: Math.max(0, matched.length - cap),
  };
}

/** A download in the index. */
export interface FileEntry {
  readonly name: string;
  /** The recorded target path, for the match and the row's description. */
  readonly path: string;
  readonly host: string | null;
  readonly profile: string;
  readonly recovered: boolean;
  /** The row's reference (router `rowRefOf`): opens exactly this row. */
  readonly ref: string;
}

/** Every download with a file name, in read order. */
export function fileEntriesOf(rows: readonly Finding[]): readonly FileEntry[] {
  return rows.flatMap((row) => {
    const path = fieldText(row.fields.targetPath);
    const name = fileNameOf(path);
    if (path === null || name === null) {
      return [];
    }
    return [
      {
        name,
        path,
        host:
          urlHostOf(fieldText(row.fields.tabUrl)) ??
          urlHostOf(fieldText(row.fields.siteUrl)),
        profile: row.profile,
        recovered: row.commitState !== "committed",
        ref: rowRefOf(row),
      },
    ];
  });
}

/** A saved login's username in the index. */
export interface UsernameEntry {
  readonly username: string;
  /** The login's site (its origin URL's host, else the signon realm). */
  readonly site: string | null;
  readonly profile: string;
  readonly recovered: boolean;
  readonly ref: string;
}

/** Every saved login with a recorded username. Only the
 *  username and the site are kept - never a password field. */
export function usernameEntriesOf(
  rows: readonly Finding[],
): readonly UsernameEntry[] {
  return rows.flatMap((row) => {
    const username = fieldText(row.fields.usernameValue);
    if (username === null) {
      return [];
    }
    const origin = fieldText(row.fields.originUrl);
    const realm = fieldText(row.fields.signonRealm);
    return [
      {
        username,
        site: urlHostOf(origin) ?? urlHostOf(realm) ?? realm,
        profile: row.profile,
        recovered: row.commitState !== "committed",
        ref: rowRefOf(row),
      },
    ];
  });
}

/** "teamviewer.com · Profile 2 · Recovered": where an indexed row is. */
export function entryDescription(
  where: string | null,
  profile: string,
  recovered: boolean,
): string {
  return [where, profileLabel(profile), recovered ? "Recovered" : null]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/** "3 more files match": the row after a capped group. */
export function moreLabel(more: number, one: string, many: string): string {
  return `${more.toLocaleString("en-US")} more ${more === 1 ? `${one} matches` : `${many} match`}`;
}
