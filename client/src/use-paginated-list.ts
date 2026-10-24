/**
 * One keyset-paginated list over a read-only API route.
 *
 * Moved out of app.tsx unchanged so page modules can share it without
 * importing the shell.
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

  const retry = useCallback(() => {
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return { rows, cursor, loading, error, loadMore, retry };
}
