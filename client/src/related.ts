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
 * The key Sites groups a host under: the URL's host (or a cookie host key)
 * lower-cased, without leading dots or a leading `www.` - so a
 * `.gmail.com` cookie and a `www.gmail.com` visit open the same host. A
 * string transform of the recorded value, the same one the Sites route
 * applies; null when there is no host to read.
 */
export function siteKeyOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  let host = raw.trim();
  if (host.includes("://")) {
    try {
      host = new URL(host).host;
    } catch {
      return null;
    }
  } else if (/[/?#\s]/.test(host)) {
    // Not a host key: a path or free text.
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/^www\./, "");
  return host === "" ? null : host;
}

/** The fields, per kind, whose host a row is "on", most direct first. */
const HOST_FIELDS: Readonly<Record<string, readonly string[]>> = {
  history_visit: ["url"],
  cookie: ["hostKey"],
  login_credential: ["originUrl", "signonRealm"],
  bookmark: ["url"],
  top_site: ["url"],
  download: ["tabUrl", "siteUrl"],
};

/** The row's host as Sites keys it, from the first host-bearing field it
 *  records; null when it records none. */
export function hostLinkOf(row: Finding): RelatedLink | null {
  for (const field of HOST_FIELDS[row.findingKind] ?? []) {
    const key = siteKeyOf(recordedText(row.fields[field]));
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

/**
 * Links to the visits of `url`: only the visits whose `url` field equals it
 * exactly. Up to `VISIT_LINKS` open their own row (History, searched for
 * the URL so the row is loaded, on the visit's Saved / Recovered tab);
 * past that - or when the read was cut short (`more`) - one link opens
 * History searched for the URL.
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
  const rest = exact.length - VISIT_LINKS;
  if (rest > 0 || (more && exact.length > 0)) {
    links.push({
      key: `visits:${source.url}`,
      label: `Visits to ${fieldLabel(source.field, kind)}`,
      field: source.field,
      value: more
        ? "Every visit to this URL"
        : `${String(rest)} more ${rest === 1 ? "visit" : "visits"} to this URL`,
      mono: false,
      page: "history",
      extras: { q: source.url },
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
