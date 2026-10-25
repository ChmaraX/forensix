/**
 * Recovered favicons, read from the Case's own Favicons payloads (never
 * fetched live: the dashboard's CSP admits only inline `data:` images).
 *
 *  - `fetchSiteFavicons(hosts)`: the `site-favicons` route - per host, the
 *    widest saved bitmap core finds on it (a host's avatar); `null` when
 *    none.
 *  - `useOwnBitmaps(rows)`: each favicon row's *own* bitmap, by the
 *    `payloadSha256` it records (the `favicon-bitmaps` route reads that
 *    payload and returns it only when its bytes hash to it), whatever the
 *    row's Commit State - so a recovered row draws its own icon, and a
 *    host's other (larger, newer) bitmap never stands in for this one.
 */
import { useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { fieldText } from "../field-readers.js";
import type {
  FaviconBitmapsResult,
  Finding,
  SiteFaviconsResult,
} from "../types.js";

/** Hosts or hashes per request (core's per-request bound). */
const REQUEST_BATCH = 100;

/** The route's favicon per host (`null`: none recovered). Empty input skips
 *  the request. */
export async function fetchSiteFavicons(
  hosts: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string | null>> {
  if (hosts.length === 0) {
    return new Map();
  }
  const result = await callApi<SiteFaviconsResult>(
    "site-favicons",
    hosts.map((host) => ["host", host] as const),
    { signal },
  );
  return new Map(Object.entries(result.icons));
}

/** Bitmaps already read this session, by SHA-256 (`null`: none readable). */
const bitmapCache = new Map<string, string | null>();

/**
 * The stored bitmaps of `rows` (favicon rows), keyed by the SHA-256 each
 * records: look a row's own `payloadSha256` up here to draw its thumbnail.
 * Each hash is read once per session; best effort - a failed read leaves a
 * row its letter tile, never an error state.
 */
export function useOwnBitmaps(
  rows: readonly Finding[],
): ReadonlyMap<string, string> {
  // One read per distinct hash set, whatever order the rows load in.
  const key = useMemo(
    () =>
      [
        ...new Set(
          rows.flatMap((row) => {
            const sha = fieldText(row.fields.payloadSha256);
            return sha === null ? [] : [sha];
          }),
        ),
      ]
        .sort()
        .join("\n"),
    [rows],
  );
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    const known = () => {
      const next = new Map<string, string>();
      for (const sha of wanted) {
        const uri = bitmapCache.get(sha);
        if (uri !== undefined && uri !== null) {
          next.set(sha, uri);
        }
      }
      return next;
    };
    setBitmaps(known());
    const unread = wanted.filter((sha) => !bitmapCache.has(sha));
    if (unread.length === 0) {
      return;
    }
    const abort = new AbortController();
    void (async () => {
      for (let start = 0; start < unread.length; start += REQUEST_BATCH) {
        const batch = unread.slice(start, start + REQUEST_BATCH);
        try {
          const result = await callApi<FaviconBitmapsResult>(
            "favicon-bitmaps",
            batch.map((sha) => ["sha256", sha] as const),
            { signal: abort.signal },
          );
          for (const sha of batch) {
            bitmapCache.set(sha, result.bitmaps[sha] ?? null);
          }
        } catch {
          // Aborted or failed: the rows keep their letter tiles.
          return;
        }
        setBitmaps(known());
      }
    })();
    return () => {
      abort.abort();
    };
  }, [key]);
  return bitmaps;
}
