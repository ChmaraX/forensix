/**
 * Reading a cache entry's key: the resource URL it names (core's
 * `cacheResourceUrl`, the rule Sites puts the entry on a host by), that
 * URL's host as written, and the host as Sites keys it. Shared by the Cache
 * page and the Sites view so the two agree on which host an entry belongs
 * to.
 */
import { fieldText } from "../field-readers.js";
import { cacheResourceUrl, siteHostKey } from "../site-host-key.js";
import type { Finding } from "../types.js";
import { urlHostOf } from "./url-host.js";

/** The host of the entry's resource URL ("www.example.com:8443"), or null. */
export function cacheResourceHost(row: Finding): string | null {
  return urlHostOf(cacheResourceUrl(fieldText(row.fields.key)));
}

/** The entry's resource host as Sites keys it ("www.example.com": the
 *  hostname, lower case, no port), or null. */
export function cacheSiteKey(row: Finding): string | null {
  return siteHostKey(cacheResourceUrl(fieldText(row.fields.key)));
}
