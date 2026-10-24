/**
 * Which recorded fields put a row on a host, for the evidence kinds the
 * Sites route does not group itself (Downloads, Cache, Favicons). The Sites
 * view reads those artifacts' own routes with the host as a search, then
 * keeps only rows that record the host exactly: a URL field whose host,
 * keyed as Sites keys hosts (`siteKeyOf`: lower case, no leading dot or
 * `www.`), equals it. A partial match ("dropbox.com" inside
 * "dl.dropbox.com") never counts.
 *
 * Pure (sites-host-fields.test.ts).
 */
import { siteKeyOf } from "../related.js";
import type { FieldState, Finding } from "../types.js";
import { cacheSiteKey } from "./cache-keys.js";

/** The recorded strings of a field: a string value, or the strings of a
 *  list value (a URL chain, a favicon's page URLs). */
function recordedStrings(field: FieldState | undefined): readonly string[] {
  if (field?.state !== "value") {
    return [];
  }
  const value = field.value;
  if (typeof value === "string") {
    return value === "" ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry !== "",
    );
  }
  return [];
}

/** The URL fields, per kind, that can put a row on a host, in the order
 *  they are named. Downloads: the fields core's search reads (the URL chain
 *  and its two ends, the referrer, the tab page). */
const HOST_URL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  download: ["urlChain", "originalUrl", "finalUrl", "referrer", "tabUrl"],
  favicon: ["iconUrl", "pageUrls"],
};

/**
 * The fields of `row` that record a URL on exactly `host`, in field order
 * (a download's URL chain hop, its referrer, its tab page; a favicon's icon
 * URL, its page URLs). A cache entry is on the host its key's resource URL
 * names (`"key"`). Empty when the row is not on the host.
 */
export function hostFieldsOf(row: Finding, host: string): readonly string[] {
  if (row.findingKind === "cache_entry") {
    return cacheSiteKey(row) === host ? ["key"] : [];
  }
  const fields: string[] = [];
  for (const name of HOST_URL_FIELDS[row.findingKind] ?? []) {
    if (
      recordedStrings(row.fields[name]).some((url) => siteKeyOf(url) === host)
    ) {
      fields.push(name);
    }
  }
  // A chain's two ends are hops of the chain: named once, as the chain.
  return fields.includes("urlChain")
    ? fields.filter((name) => name !== "originalUrl" && name !== "finalUrl")
    : fields;
}
