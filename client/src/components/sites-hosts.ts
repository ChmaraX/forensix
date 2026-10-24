/**
 * Case-wide host reads for the Sites view: `useHostFavicons` (each host's
 * recovered favicon for its avatar). Which rows are on a host is
 * `sites-host-fields.ts`; whether Sites lists a host (for links to it) is
 * `host-link.tsx`'s `useSiteHosts`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchSiteFavicons } from "./site-favicons.js";

/** Hosts per `site-favicons` request (each is a query parameter). */
const FAVICON_BATCH = 50;
/** Most hosts the list asks icons for; the rest keep their letter. */
const FAVICON_HOST_CAP = 500;
/** Icons already asked for this session (`null`: none recovered). */
const hostIcons = new Map<string, string | null>();

/**
 * Each host's recovered favicon (`site-favicons`: the largest bitmap the
 * Case's own Favicons database holds for it, as a `data:` URI), for a
 * host's avatar tile. Asked in batches, each host once per session; best
 * effort - a failed read leaves the letter tiles.
 */
export function useHostFavicons(
  hosts: readonly string[],
): ReadonlyMap<string, string> {
  const key = useMemo(
    () => hosts.slice(0, FAVICON_HOST_CAP).join("\n"),
    [hosts],
  );
  const known = useCallback(() => {
    const icons = new Map<string, string>();
    for (const host of key === "" ? [] : key.split("\n")) {
      const icon = hostIcons.get(host);
      if (icon !== undefined && icon !== null) {
        icons.set(host, icon);
      }
    }
    return icons;
  }, [key]);
  const [icons, setIcons] = useState<ReadonlyMap<string, string>>(known);
  useEffect(() => {
    let live = true;
    const wanted = (key === "" ? [] : key.split("\n")).filter(
      (host) => !hostIcons.has(host),
    );
    setIcons(known());
    void (async () => {
      for (let start = 0; start < wanted.length; start += FAVICON_BATCH) {
        const batch = wanted.slice(start, start + FAVICON_BATCH);
        try {
          const answer = await fetchSiteFavicons(batch);
          for (const host of batch) {
            hostIcons.set(host, answer.get(host) ?? null);
          }
        } catch {
          return;
        }
        if (!live) {
          return;
        }
        setIcons(known());
      }
    })();
    return () => {
      live = false;
    };
  }, [key, known]);
  return icons;
}
