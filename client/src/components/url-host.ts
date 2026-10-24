/**
 * Pure URL helpers (no imports, unit-tested in timeline-source-row.test.ts
 * and related.test.ts): the host inside a recorded URL as written
 * (`splitUrlHost`, host-link.tsx), a URL's host, and the resource URL a
 * cache key names (`cacheResourceUrl`, cache-keys.ts and related.ts).
 */

/**
 * The host part of a recorded URL, exactly as written: `scheme://`, the
 * authority (userinfo, host, port), and the rest. Null when the text has
 * no `scheme://authority`.
 */
export function splitUrlHost(url: string): {
  readonly head: string;
  readonly host: string;
  readonly tail: string;
} | null {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]+)(.*)$/is.exec(url);
  if (match === null) {
    return null;
  }
  const [, head = "", authority = "", tail = ""] = match;
  // Userinfo stays outside the link: the host is what Sites keys.
  const at = authority.lastIndexOf("@");
  return at === -1
    ? { head, host: authority, tail }
    : {
        head: head + authority.slice(0, at + 1),
        host: authority.slice(at + 1),
        tail,
      };
}

/** The URL's host ("www.example.com"), or null when it does not parse. */
export function urlHostOf(url: string | null): string | null {
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
  return urlHostOf(url) === null ? null : url;
}
