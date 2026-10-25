/**
 * Related evidence for one row: links that open other pages filtered by a
 * value this row records exactly - never a relationship the data does not
 * record.
 *
 *  - host → Sites: the host of a URL (or a cookie's host key) the row
 *    records, as the Sites view keys it (`siteKeyOf`), offered only when
 *    Sites lists that exact host;
 *  - day → Timeline: the Case day of the row's own timestamp (the field
 *    `FINDING_KINDS` dates the kind by), in the Case's declared timezone;
 *  - URL → History: visits whose URL equals, character for character, a
 *    URL the row records (a download's tab page or referrer, a bookmark's or
 *    top site's URL). Each match links to that visit; nothing is guessed
 *    from a partial match.
 *
 * Pure (related.test.ts): the one read, `exactVisitsOf`, is in
 * case-reads.ts.
 */
import { FINDING_KINDS } from "./artifacts.js";
import { localDayOf } from "./components/day-bounds.js";
import { cacheResourceUrl } from "./components/url-host.js";
import { fieldLabel } from "./field-labels.js";
import { rowRefOf, type ViewLocation } from "./router.js";
import type { FieldState, Finding } from "./types.js";

/** One related-evidence link. */
export interface RelatedLink {
  /** Stable key (also the React key). */
  readonly key: string;
  /** What the value is ("Host", "Day", "Tab page"). */
  readonly label: string;
  /** The raw field the value was read from (shown as a caption). */
  readonly field: string | null;
  /** The value, as shown. */
  readonly value: string;
  /** The value is code-like (a URL): monospace. */
  readonly mono: boolean;
  /** The page the link opens. */
  readonly page: string;
  /** The opened page's own view (host, search, tab, row; or a range). */
  readonly extras: Partial<Omit<ViewLocation, "page">>;
  /** The link's words ("Open in Sites"). */
  readonly action: string;
}

/* ------------------------------ field readers ----------------------------- */

/** A recorded, non-empty string value, or null. */
export function recordedText(field: FieldState | undefined): string | null {
  return field?.state === "value" &&
    typeof field.value === "string" &&
    field.value !== ""
    ? field.value
    : null;
}

function utcOf(field: FieldState | undefined): string | null {
  if (field?.state !== "value") {
    return null;
  }
  const value = field.value;
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const utc = (value as Record<string, unknown>).utc;
  return typeof utc === "string" ? utc : null;
}

/* ---------------------------------- host ---------------------------------- */

/**
 * A bare host key: a host with no scheme, port, path, query, fragment,
 * userinfo or whitespace ("example.com", "www.example.com"), or a bracketed
 * IPv6 literal ("[::1]").
 */
const BARE_HOST = /^(?:[^\s/?#:@\\[\]]+|\[[0-9a-f:.]+\])$/i;

/**
 * The key Sites groups a recorded host under - the same transform core's
 * `siteHostKey` (core/src/sites-query.ts) applies, so a key read here is one
 * the Sites route lists. A URL is keyed by its hostname (no port, userinfo
 * or path); a Chrome cookie host key - a domain cookie's ".example.com" or
 * a host-only cookie's bare "example.com" - by itself. One leading dot is
 * removed and the result lower-cased. Nothing else: no domain expansion,
 * so "www.example.com" is a host apart from "example.com". Null when there
 * is no host to read.
 */
export function siteKeyOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const text = raw.startsWith(".") ? raw.slice(1) : raw;
  if (text.length === 0) {
    return null;
  }
  if (BARE_HOST.test(text)) {
    return text.toLocaleLowerCase("en-US");
  }
  try {
    return new URL(text).hostname.toLocaleLowerCase("en-US") || null;
  } catch {
    return null;
  }
}

/** A field a row's host is read from, and how: the recorded text itself
 *  (a URL or host key), or `read` over it (a cache key names its
 *  resource URL behind an isolation scope). */
type HostField =
  | string
  | {
      readonly field: string;
      readonly read: (text: string) => string | null;
    };

/** The fields, per kind, whose host a row is "on", most direct first. */
const HOST_FIELDS: Readonly<Record<string, readonly HostField[]>> = {
  history_visit: ["url"],
  cookie: ["hostKey"],
  login_credential: ["originUrl", "signonRealm"],
  bookmark: ["url"],
  top_site: ["url"],
  download: ["tabUrl", "siteUrl"],
  cache_entry: [{ field: "key", read: cacheResourceUrl }],
  favicon: ["iconUrl"],
};

/** The row's host as Sites keys it, from the first host-bearing field it
 *  records; null when it records none. */
export function hostLinkOf(row: Finding): RelatedLink | null {
  for (const entry of HOST_FIELDS[row.findingKind] ?? []) {
    const field = typeof entry === "string" ? entry : entry.field;
    const text = recordedText(row.fields[field]);
    const key = siteKeyOf(
      typeof entry === "string" || text === null ? text : entry.read(text),
    );
    if (key !== null) {
      return {
        key: `host:${key}`,
        label: "Host",
        field,
        value: key,
        mono: false,
        page: "sites",
        extras: { host: key },
        action: "Open in Sites",
      };
    }
  }
  return null;
}

/* ----------------------------------- day ---------------------------------- */

/** "12 Mar 2024" for a `YYYY-MM-DD` day. */
export function formatCaseDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** The Case day of the row's own timestamp, linked to that day on the
 *  Timeline; null when the kind is not dated or the time is not recorded. */
export function dayLinkOf(
  row: Finding,
  timeZone: string | null,
): RelatedLink | null {
  const field = FINDING_KINDS[row.findingKind]?.time;
  if (field === undefined) {
    return null;
  }
  const day = localDayOf(utcOf(row.fields[field]), timeZone);
  if (day === null) {
    return null;
  }
  return {
    key: `day:${day}`,
    label: "Day",
    field,
    value: formatCaseDay(day),
    mono: false,
    page: "timeline",
    extras: { from: day, to: day },
    action: "Open in Timeline",
  };
}

/* ----------------------------------- URLs --------------------------------- */

/** The URL fields, per kind, that name a page the subject visited. */
const VISITED_URL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  download: ["tabUrl", "referrer"],
  bookmark: ["url"],
  top_site: ["url"],
};

/** The distinct URLs the row records in its visited-page fields, each with
 *  the first field it appears in. */
export function visitedUrlsOf(
  row: Finding,
): readonly { readonly field: string; readonly url: string }[] {
  const seen = new Set<string>();
  const urls: { field: string; url: string }[] = [];
  for (const field of VISITED_URL_FIELDS[row.findingKind] ?? []) {
    const url = recordedText(row.fields[field]);
    if (url !== null && !seen.has(url) && /^[a-z][a-z0-9+.-]*:/i.test(url)) {
      seen.add(url);
      urls.push({ field, url });
    }
  }
  return urls;
}

/** At most this many visits are linked one by one under a URL. */
export const VISIT_LINKS = 3;

/** "2 more saved visits and 1 more recovered visit": each Commit State
 *  counted on its own (a zero is left out). */
function moreVisitsText(saved: number, recovered: number): string {
  const part = (count: number, state: string) =>
    `${String(count)} more ${state} ${count === 1 ? "visit" : "visits"}`;
  return [
    ...(saved > 0 ? [part(saved, "saved")] : []),
    ...(recovered > 0 ? [part(recovered, "recovered")] : []),
  ].join(" and ");
}

/**
 * Links to the visits of `url`: only the visits whose `url` field equals it
 * exactly. Up to `VISIT_LINKS` open their own row (History, searched for
 * the URL so the row is loaded, on the visit's Saved / Recovered tab);
 * past that - or when the read was cut short (`more`) - one link opens
 * History searched for the URL. A cut-off read with no exact match still
 * offers that search: it proves neither a visit nor none.
 */
export function visitLinksOf(
  source: { readonly field: string; readonly url: string },
  kind: string,
  visits: readonly Finding[],
  formatTime: (utc: string) => string,
  more = false,
): readonly RelatedLink[] {
  const exact = visits.filter(
    (visit) =>
      visit.findingKind === "history_visit" &&
      recordedText(visit.fields.url) === source.url,
  );
  const label = `Visit to ${fieldLabel(source.field, kind)}`;
  const links: RelatedLink[] = [];
  for (const visit of exact.slice(0, VISIT_LINKS)) {
    const ref = rowRefOf(visit);
    const utc = utcOf(visit.fields.visitTime);
    if (ref === null) {
      continue;
    }
    links.push({
      key: `visit:${ref}`,
      label,
      field: source.field,
      value: utc === null ? source.url : formatTime(utc),
      mono: utc === null,
      page: "history",
      extras: {
        q: source.url,
        row: ref,
        tab: visit.commitState === "committed" ? "saved" : "recovered",
      },
      action: "Open visit",
    });
  }
  // Past the first few, one search link, its count split by Commit State
  // (saved and recovered visits are never summed into one number).
  const rest = exact.slice(VISIT_LINKS);
  const restSaved = rest.filter(
    (visit) => visit.commitState === "committed",
  ).length;
  const restRecovered = rest.length - restSaved;
  if (more && exact.length === 0) {
    // The read was cut off before an exact match: unknown, not "no visit".
    links.push({
      key: `visits:${source.url}`,
      label: `Search for ${fieldLabel(source.field, kind)}`,
      field: source.field,
      value: "Searched for this URL",
      mono: false,
      page: "history",
      extras: { q: source.url },
      action: "Open History searched for this URL",
    });
  } else if (more || rest.length > 0) {
    links.push({
      key: `visits:${source.url}`,
      label: `Visits to ${fieldLabel(source.field, kind)}`,
      field: source.field,
      value: more
        ? "Every visit to this URL"
        : `${moreVisitsText(restSaved, restRecovered)} to this URL`,
      mono: false,
      page: "history",
      extras:
        !more && restSaved === 0
          ? { q: source.url, tab: "recovered" }
          : { q: source.url },
      action: "Open in History",
    });
  }
  return links;
}

/* -------------------------------- citation -------------------------------- */

/** Fields whose value is a hash of the recorded content. */
function isValueHash(name: string): boolean {
  return /(?:Sha256|Sha1|Md5)$/i.test(name);
}

/**
 * One line citing a row by its provenance, for a report: artifact, profile,
 * file, table, row id, Commit State and any content hash the row records.
 * Never a field's value beyond those (a secret stays out whatever is
 * revealed); a part not recorded reads "absent".
 */
export function citationOf(
  row: Finding,
  options: {
    readonly artifact: string | null;
    readonly profile: string;
    /** Fields withheld from the citation (secrets). */
    readonly redacted?: readonly string[];
  },
): string {
  const { manifestPath, table, rowId } = row.provenance;
  const part = (value: string | undefined | null) =>
    value === undefined || value === null || value === "" ? "absent" : value;
  const parts = [
    `Artifact: ${part(options.artifact ?? row.findingKind)} (${row.findingKind})`,
    `Profile: ${options.profile}`,
    `File: ${part(manifestPath)}`,
    `Table: ${part(table)}`,
    `Row id: ${part(rowId)}`,
    `Commit State: ${row.commitState}`,
  ];
  for (const [name, field] of Object.entries(row.fields)) {
    if (!isValueHash(name) || options.redacted?.includes(name) === true) {
      continue;
    }
    const hash = recordedText(field);
    if (hash !== null) {
      parts.push(`${name}: ${hash}`);
    }
  }
  return parts.join(" · ");
}
