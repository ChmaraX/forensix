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
 * Pure (cache-keys.test.ts). Shared by the Cache page and the Sites view so
 * the two agree on which host an entry belongs to.
 */
import { recordedText, siteKeyOf } from "../related.js";
import type { Finding } from "../types.js";

/** The URL's host ("www.example.com"), or null when it does not parse. */
function hostOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    const { host } = new URL(url);
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/** The resource URL a cache key names, or null when its last part is not a
 *  URL with a scheme and a host. */
export function cacheResourceUrl(key: string | null): string | null {
  if (key === null) {
    return null;
  }
  const last = key.trim().split(/\s+/).pop() ?? "";
  // "_dk_https://…" when the key is a single scoped part: the URL follows
  // the prefix.
  const url = last.replace(/^(?:\d+\/\d+\/)?(?:_dk_)?/, "");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return null;
  }
  return hostOf(url) === null ? null : url;
}

/** The host of the entry's resource URL ("www.example.com"), or null. */
export function cacheResourceHost(row: Finding): string | null {
  return hostOf(cacheResourceUrl(recordedText(row.fields.key)));
}

/** The entry's resource host as Sites keys hosts ("example.com"), or null. */
export function cacheSiteKey(row: Finding): string | null {
  return siteKeyOf(cacheResourceUrl(recordedText(row.fields.key)));
}
