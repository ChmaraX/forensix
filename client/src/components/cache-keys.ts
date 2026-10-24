/**
 * Reading a cache entry's key: the resource URL it names, and that URL's
 * host as the Sites view keys hosts (`siteKeyOf`).
 *
 * Chrome's HTTP cache keys an entry by the resource URL, in newer versions
 * behind a scope prefix that names the frame the resource was loaded for
 * ("1/0/_dk_https://top.example https://frame.example https://cdn.example/x.js").
 * The resource is always the key's last space-separated part; the parts
 * before it are the isolation scope, never the resource. A string reading of
 * the recorded key, nothing more: a key whose last part is no URL reads null.
 *
 * Pure (`cacheResourceUrl` lives in url-host.ts, unit-tested there, and
 * is the reader related.ts keys a cache row's host with). Shared by the Cache page and the Sites view so
 * the two agree on which host an entry belongs to.
 */
import { recordedText, siteKeyOf } from "../related.js";
import type { Finding } from "../types.js";
import { cacheResourceUrl, urlHostOf } from "./url-host.js";

export { cacheResourceUrl };

/** The host of the entry's resource URL ("www.example.com"), or null. */
export function cacheResourceHost(row: Finding): string | null {
  return urlHostOf(cacheResourceUrl(recordedText(row.fields.key)));
}

/** The entry's resource host as Sites keys hosts ("www.example.com": the
 *  hostname, lower case, no port), or null. */
export function cacheSiteKey(row: Finding): string | null {
  return siteKeyOf(cacheResourceUrl(recordedText(row.fields.key)));
}
