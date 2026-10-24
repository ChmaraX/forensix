/** Pure URL helper for `history-host-link.tsx` (unit-tested). */

/**
 * The host part of a recorded URL, exactly as written: `scheme://`, the
 * authority (userinfo, host, port), and the rest. Null when the text has
 * no `scheme://authority`.
 */
export function splitUrlHost(
  url: string,
): {
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
