/**
 * One keyset-paginated list over a read-only API route.
 *
 * `retry` re-reads only what failed: after a failed "Load more" it asks for
 * the same page again and keeps the loaded rows; after a failed first read
 * (or with no error) it starts the list over.
 */
import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setLoading(false);
      setError(null);
      setRows([]);
      setCursor(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Row>>(route, parameters)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, parametersKey, reloadNonce, enabled]);

  const loadMore = useCallback(() => {
    if (!enabled || cursor === null) {
      return;
    }
    setLoading(true);
    setError(null);
    callApi<PageOf<Row>>(route, [...parameters, ["after", cursor]])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
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
