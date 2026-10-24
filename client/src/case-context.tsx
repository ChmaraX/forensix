/**
 * The Case-wide reads every page needs - the Completeness Statement and the
 * profiles route - read once by the shell and handed to pages through
 * context, so no page reads them again (switching pages never refetches
 * the statement).
 *
 *  - `useCaseContextRead()` - the shell's read (`app.tsx` provides it with
 *    `CaseContextProvider`);
 *  - `useCaseContext()` - `{ context, error, retry }` for a page that
 *    needs the statement or the profile list (Overview, Browser profile);
 *  - `useArtifactCoverage(artifact)` - one artifact's `CoverageScope` (the
 *    identity pages' empty states), null until the statement is read.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { callApi } from "./api.js";
import { coverageOf, type CoverageScope } from "./components/completeness.js";
import type { CaseCompleteness, CaseProfiles } from "./types.js";

export interface CaseContext {
  readonly completeness: CaseCompleteness;
  /** The profiles route's list (`caseProfilesOf` adds the ones only the
   *  statement names). */
  readonly profiles: readonly string[];
}

export interface CaseContextState {
  /** Null while read, and after a failed read (`error` set). */
  readonly context: CaseContext | null;
  readonly error: string | null;
  readonly retry: () => void;
}

const CaseContextValue = createContext<CaseContextState>({
  context: null,
  error: null,
  retry: () => undefined,
});

export const CaseContextProvider = CaseContextValue.Provider;

/** The shell's one read of the Completeness Statement and the profiles. */
export function useCaseContextRead(): CaseContextState {
  const [context, setContext] = useState<CaseContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      callApi<CaseCompleteness>("completeness", []),
      callApi<CaseProfiles>("profiles", []),
    ])
      .then(([completeness, caseProfiles]) => {
        if (!cancelled) {
          setContext({ completeness, profiles: caseProfiles.profiles });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Request failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const retry = useCallback(() => {
    setContext(null);
    setReloadNonce((nonce) => nonce + 1);
  }, []);

  return useMemo(() => ({ context, error, retry }), [context, error, retry]);
}

/** The shell's Case context (see the file comment). */
export function useCaseContext(): CaseContextState {
  return useContext(CaseContextValue);
}

/** One Completeness artifact's coverage ("Login Data"), from the shell's
 *  statement; null until it is read (or when it could not be). */
export function useArtifactCoverage(artifact: string): CoverageScope | null {
  const { context } = useCaseContext();
  return useMemo(
    () =>
      context === null ? null : coverageOf(context.completeness, [artifact]),
    [context, artifact],
  );
}
