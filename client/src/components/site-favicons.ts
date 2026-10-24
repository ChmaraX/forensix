/**
 * Recovered favicons, read from the Case's own `Favicons` database through
 * the `site-favicons` route: per host, the largest recovered bitmap as an
 * inline `data:` URI (the dashboard's CSP admits no other image source, so
 * an icon is never fetched live). A host without one maps to `null`.
 *
 * `useOwnBitmaps` serves the Favicons page, where a thumbnail must be the
 * row's *own* bitmap: an icon the route returns is shown on a row only when
 * its bytes hash to the row's recorded `payloadSha256`, so a host's other
 * (larger, newer) bitmap never stands in for this one.
 */
import { useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";

/** The route's favicon per host (`null`: none recovered). Empty input skips
 *  the request. */
export async function fetchSiteFavicons(
  hosts: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (hosts.length === 0) {
    return new Map();
  }
  const result = await callApi<{
    readonly status: "ok";
    readonly icons: Readonly<Record<string, string | null>>;
  }>(
    "site-favicons",
    hosts.map((host) => ["host", host] as const),
  );
  return new Map(Object.entries(result.icons));
}

/** Lower-case hex SHA-256 of a base64 `data:` URI's bytes, or null when the
 *  URI is not base64 or the browser has no Web Crypto (an insecure origin). */
async function dataUriSha256(uri: string): Promise<string | null> {
  const comma = uri.indexOf(",");
  if (comma < 0 || !uri.slice(0, comma).endsWith(";base64")) {
    return null;
  }
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle === undefined) {
    return null;
  }
  try {
    const binary = atob(uri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * The recovered bitmaps for `hosts`, keyed by their SHA-256: look a row's
 * own `payloadSha256` up here to draw its thumbnail. Best effort - a failed
 * read leaves the map empty (letter tiles stand in), never an error state.
 */
export function useOwnBitmaps(
  hosts: readonly string[],
): ReadonlyMap<string, string> {
  // One read per distinct host set, whatever order the rows load in.
  const key = useMemo(() => [...new Set(hosts)].sort().join("\n"), [hosts]);
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    let live = true;
    const wanted = key === "" ? [] : key.split("\n");
    void (async () => {
      try {
        const icons = await fetchSiteFavicons(wanted);
        const next = new Map<string, string>();
        for (const uri of icons.values()) {
          if (uri === null) {
            continue;
          }
          const sha = await dataUriSha256(uri);
          if (sha !== null) {
            next.set(sha, uri);
          }
        }
        if (live) {
          setBitmaps(next);
        }
      } catch {
        // Best effort: without the route's answer every row keeps its
        // letter tile.
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);
  return bitmaps;
}
