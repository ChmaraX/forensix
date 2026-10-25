/**
 * Pure URL helpers (no imports, `splitUrlHost` unit-tested in
 * timeline-source-row.test.ts): the host inside a recorded URL as written
 * (`splitUrlHost`, host-link.tsx) and a URL's host with its port
 * (`urlHostOf`). Which host Sites keys a value under is core's
 * `siteHostKey` (site-host-key.ts).
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
