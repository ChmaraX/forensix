/**
 * A list a page reads whole (up to a page cap) because its figures sum over
 * every row: Cache and Downloads. The first page paints at once; the rest
 * drain in the background, appended in batches (at most every
 * `FLUSH_INTERVAL_MS`, so a long drain does not re-render per page), with
 * `draining` true until the cursor runs out or the cap is hit. Every read
 * carries an `AbortSignal`: unmounting, Retry or a change of the read's
 * parameters aborts the request in flight, not only the loop.
 *
 * `complete` is true only when the cursor ran out (never while draining,
 * never at the cap), so counts read "1,200+" until the whole list is in.
 */
import { useCallback, useEffect, useState } from "react";

import { callApi, isAbortError, type QueryParameters } from "../api.js";
import type { Finding, PageOf } from "../types.js";

/** Longest a drained page waits before its rows are shown. */
const FLUSH_INTERVAL_MS = 250;

export interface DrainedRead {
  /** Rows read so far, or null before the first page lands. */
  readonly rows: readonly Finding[] | null;
  /** The cursor ran out: every row is in. */
  readonly complete: boolean;
  /** More pages are being read in the background. */
  readonly draining: boolean;
  readonly error: string | null;
  /** Pages read so far. */
  readonly pages: number;
  readonly retry: () => void;
}

export function useDrainedRead(
  route: string,
  parameters: QueryParameters,
  pageCap: number,
): DrainedRead {
  const [rows, setRows] = useState<readonly Finding[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [draining, setDraining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [nonce, setNonce] = useState(0);
  const parametersKey = JSON.stringify(parameters);

  useEffect(() => {
    const abort = new AbortController();
    const base = JSON.parse(parametersKey) as [string, string][];
    setRows(null);
    setComplete(false);
    setDraining(true);
    setError(null);
    setPages(0);
    (async () => {
      const collected: Finding[] = [];
      let after: string | null = null;
      let lastFlush = 0;
      for (let page = 0; page < pageCap; page += 1) {
        const query: (readonly [string, string])[] = [...base];
        if (after !== null) {
          query.push(["after", after]);
        }
        const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
          route,
          query,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) {
          return;
        }
        collected.push(...result.items);
        after = result.nextCursor;
        const done = after === null || page + 1 === pageCap;
        const now = performance.now();
        if (page === 0 || done || now - lastFlush >= FLUSH_INTERVAL_MS) {
          lastFlush = now;
          setRows([...collected]);
          setPages(page + 1);
        }
        if (done) {
          setComplete(after === null);
          setDraining(false);
          return;
        }
      }
    })().catch((requestError: unknown) => {
      if (abort.signal.aborted || isAbortError(requestError)) {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Request failed.",
      );
      setDraining(false);
    });
    return () => {
      abort.abort();
    };
  }, [route, parametersKey, pageCap, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, complete, draining, error, pages, retry };
}
