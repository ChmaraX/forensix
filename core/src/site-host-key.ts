/**
 * Which host a recorded row is "on", for Sites. Core owns this: the Sites
 * host list, a host's rows and its favicon all key hosts here, and the
 * dashboard bundle imports this same file for its Host links, so the two
 * can never disagree.
 *
 * Deliberately import-free and Node-free (only the standard `URL` global):
 * the browser bundle includes it as is.
 */

/**
 * A bare host key: a host with no scheme, port, path, query, fragment,
 * userinfo or whitespace ("example.com", "www.example.com"), or a bracketed
 * IPv6 literal ("[::1]").
 */
const BARE_HOST = /^(?:[^\s/?#:@\\[\]]+|\[[0-9a-f:.]+\])$/i;

/**
 * The key Sites groups a recorded host under. A URL is keyed by its
 * hostname (no port, userinfo or path); a Chrome cookie host key - a domain
 * cookie's ".example.com" or a host-only cookie's bare "example.com" - by
 * itself. One leading dot is removed and the result lower-cased. Nothing
 * else: no domain expansion ("www.example.com" stays apart from
 * "example.com") and no relationship scoring. Null when there is no host.
 */
export function siteHostKey(value: string | null): string | null {
  if (value === null) return null;
  const text = value.startsWith(".") ? value.slice(1) : value;
  if (text.length === 0) return null;
  if (BARE_HOST.test(text)) return text.toLocaleLowerCase("en-US");
  try {
    return new URL(text).hostname.toLocaleLowerCase("en-US") || null;
  } catch {
    return null;
  }
}

/**
 * The resource URL a Chrome HTTP cache key names, or null when its last part
 * is not a URL with a scheme and a host.
 *
 * Chrome keys a cache entry by the resource URL, in newer versions behind a
 * scope prefix naming the frame it was loaded for
 * ("1/0/_dk_https://top.example https://frame.example https://cdn.example/x.js").
 * The resource is always the key's last space-separated part; the parts
 * before it are the isolation scope, never the resource. A string reading of
 * the recorded key, nothing more.
 */
export function cacheResourceUrl(key: string | null): string | null {
  if (key === null) return null;
  const last = key.trim().split(/\s+/).pop() ?? "";
  // "_dk_https://…" when the key is a single scoped part: the URL follows
  // the prefix.
  const url = last.replace(/^(?:\d+\/\d+\/)?(?:_dk_)?/, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return null;
  try {
    return new URL(url).host === "" ? null : url;
  } catch {
    return null;
  }
}

/**
 * A field that can put a row on a host. `field` names the recorded field;
 * its value is a URL or host key, or a list of URLs (each one counts).
 * `read: "cache-key"` reads the field as a cache key, whose host is its
 * resource URL's (`cacheResourceUrl`).
 */
export interface SiteHostField {
  readonly field: string;
  readonly read?: "cache-key";
}

/**
 * The fields, per Finding kind, that put a row on a host, most direct
 * first. One row can be on several hosts (a download's redirect chain, a
 * favicon's page URLs); it is on each host once.
 *
 *  - download: the URL chain (every hop, so the original and final URL,
 *    which are the chain's two ends), the referrer and the tab page the
 *    download started from - the fields that say where it came from, the
 *    same ones the Downloads search reads. Not `siteUrl` (the storage
 *    partition site, a registrable domain rather than the host the bytes or
 *    the page came from) and not `tabReferrerUrl` (the page before the tab
 *    page, one step removed).
 *  - cache_entry: the resource the key names, never its isolation scope.
 *  - favicon: the icon URL and every page URL that uses the icon.
 */
export const SITE_HOST_FIELDS: Readonly<
  Record<string, readonly SiteHostField[]>
> = {
  history_visit: [{ field: "url" }],
  cookie: [{ field: "hostKey" }],
  login_credential: [{ field: "originUrl" }],
  bookmark: [{ field: "url" }],
  top_site: [{ field: "url" }],
  download: [{ field: "urlChain" }, { field: "referrer" }, { field: "tabUrl" }],
  cache_entry: [{ field: "key", read: "cache-key" }],
  favicon: [{ field: "iconUrl" }, { field: "pageUrls" }],
};

/** A recorded field as Findings carry it: only a `"value"` state records
 *  anything. */
export interface SiteHostFieldState {
  readonly state: string;
  readonly value?: unknown;
}

/** The strings a field records: a string value, or a list's string
 *  entries. Absent, unavailable and empty values record none. */
export function recordedStrings(
  field: SiteHostFieldState | undefined,
): readonly string[] {
  if (field?.state !== "value") return [];
  const value = field.value;
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value))
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry !== "",
    );
  return [];
}

/** The host keys one recorded field puts a row on, in recorded order. */
export function siteHostKeysOfField(
  entry: SiteHostField,
  field: SiteHostFieldState | undefined,
): readonly string[] {
  const keys: string[] = [];
  for (const text of recordedStrings(field)) {
    const key = siteHostKey(
      entry.read === "cache-key" ? cacheResourceUrl(text) : text,
    );
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Each host a row of `findingKind` is on, with the fields that put it
 * there (in `SITE_HOST_FIELDS` order). Empty for a kind Sites does not
 * group or a row that records no host.
 */
export function siteHostsOf(
  findingKind: string,
  fields: Readonly<Record<string, SiteHostFieldState | undefined>>,
): ReadonlyMap<string, readonly string[]> {
  const hosts = new Map<string, string[]>();
  for (const entry of SITE_HOST_FIELDS[findingKind] ?? []) {
    for (const key of siteHostKeysOfField(entry, fields[entry.field])) {
      const named = hosts.get(key);
      if (named === undefined) hosts.set(key, [entry.field]);
      else if (!named.includes(entry.field)) named.push(entry.field);
    }
  }
  return hosts;
}
