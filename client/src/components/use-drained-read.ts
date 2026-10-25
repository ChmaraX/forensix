/**
 * A list a page reads whole (up to a page cap) because its figures sum over
 * every row, or group it: Cache, Downloads, the Sites host list and a
 * host's rows. The first page paints at once; the rest drain in the
 * background (`readPages`), appended in batches (at most every
 * `FLUSH_INTERVAL_MS`, so a long drain does not re-render per page), with
 * `draining` true until the cursor runs out or the cap is hit. Every read
 * carries an `AbortSignal`: unmounting, Retry or a change of the read's
 * parameters aborts the request in flight, not only the loop.
 *
 * `complete` is true only when the cursor ran out (never while draining,
 * never at the cap), so counts read "1,200+" until the whole list is in.
 */
import { useCallback, useEffect, useState } from "react";

import { isAbortError, type QueryParameters } from "../api.js";
import { readPages } from "../read-pages.js";
import type { Finding } from "../types.js";

/** Longest a drained page waits before its rows are shown. */
const FLUSH_INTERVAL_MS = 250;

export interface DrainedRead<Row = Finding> {
  /** Rows read so far, or null before the first page lands. */
  readonly rows: readonly Row[] | null;
  /** The cursor ran out: every row is in. */
  readonly complete: boolean;
  /** More pages are being read in the background. */
  readonly draining: boolean;
  readonly error: string | null;
  /** Pages read so far. */
  readonly pages: number;
  readonly retry: () => void;
}

/** Reads `route` whole, up to `pageCap` pages. `parameters` is compared by
 *  value: a fresh array with the same pairs does not read again. */
export function useDrainedRead<Row = Finding>(
  route: string,
  parameters: QueryParameters,
  pageCap: number,
): DrainedRead<Row> {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [draining, setDraining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [nonce, setNonce] = useState(0);
  const parametersKey = JSON.stringify(parameters);

  useEffect(() => {
    const abort = new AbortController();
    setRows(null);
    setComplete(false);
    setDraining(true);
    setError(null);
    setPages(0);
    const collected: Row[] = [];
    let lastFlush = 0;
    readPages<Row>(route, parameters, {
      cap: pageCap,
      signal: abort.signal,
      onPage: (items, index) => {
        if (abort.signal.aborted) {
          return "stop";
        }
        collected.push(...items);
        const now = performance.now();
        if (index === 0 || now - lastFlush >= FLUSH_INTERVAL_MS) {
          lastFlush = now;
          setRows([...collected]);
          setPages(index + 1);
        }
      },
    })
      .then((read) => {
        if (abort.signal.aborted) {
          return;
        }
        setRows([...collected]);
        setPages(read.pages);
        setComplete(read.complete);
        setDraining(false);
      })
      .catch((requestError: unknown) => {
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
    // `parametersKey` stands in for `parameters` (compared by value).
  }, [route, parametersKey, pageCap, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, complete, draining, error, pages, retry };
}
