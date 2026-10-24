/**
 * One keyset-paginated list over a read-only API route.
 *
 * `retry` re-reads only what failed: after a failed "Load more" it asks for
 * the same page again and keeps the loaded rows; after a failed first read
 * (or with no error) it starts the list over.
 *
 * Every read carries the list's generation: a filter, range, sort or retry
 * change starts a new generation, and a response from an older one (a
 * "Load more" still in flight when the filters changed) is dropped, so an
 * old page never lands in the new list and its cursor never replaces the new
 * one. `loadMore` does nothing while a read is in flight.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { callApi, type QueryParameters } from "./api.js";
import type { PageOf } from "./types.js";

export function usePaginatedList<Row>(
  route: string,
  parameters: QueryParameters,
  enabled = true,
) {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const parametersKey = JSON.stringify(parameters);
  // The current generation, and whether a read of it is in flight.
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const cancelled = () => generation.current !== current;
    if (!enabled) {
      inFlight.current = false;
      setLoading(false);
      setError(null);
      setRows([]);
      setCursor(null);
      return () => {
        generation.current += 1;
      };
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Row>>(route, parameters)
      .then((page) => {
        if (cancelled()) {
          return;
        }
        inFlight.current = false;
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled()) {
          return;
        }
        inFlight.current = false;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      generation.current += 1;
      inFlight.current = false;
    };
  }, [route, parametersKey, reloadNonce, enabled]);

  const loadMore = useCallback(() => {
    if (!enabled || cursor === null || inFlight.current) {
      return;
    }
    const current = generation.current;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    callApi<PageOf<Row>>(route, [...parameters, ["after", cursor]])
      .then((page) => {
        if (generation.current !== current) {
          return;
        }
        inFlight.current = false;
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (generation.current !== current) {
          return;
        }
        inFlight.current = false;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
  }, [route, parametersKey, cursor, enabled]);

  // Retry only what failed. A failed "Load more" keeps its cursor and the
  // rows already shown, so asking for that page again keeps every loaded row;
  // anything else (a failed first read, or a plain reload) starts the list
  // over.
  const failedPage = error !== null && rows.length > 0 && cursor !== null;
  const retry = useCallback(() => {
    if (failedPage) {
      loadMore();
      return;
    }
    setReloadNonce((nonce) => nonce + 1);
  }, [failedPage, loadMore]);

  return { rows, cursor, loading, error, loadMore, retry };
}
