/**
 * Evidence coverage for the activity pages (History, Downloads, Top sites).
 *
 * Forensic rule 1: the Completeness Statement renders before any row on every
 * evidence page. The generic artifact page gets its statement from the shell;
 * these three bespoke pages read it themselves from the same read-only
 * `completeness` route and hand it to the shared `CompletenessPanel`. While
 * the read is in flight a Skeleton of the panel's size holds the space and
 * crossfades into the panel (`reveal-swap`).
 */
import { useEffect, useState } from "react";

import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/misc";

import { callApi } from "../api.js";
import type { CaseCompleteness, CompletenessStatement } from "../types.js";
import { CompletenessPanel } from "./completeness.js";

/**
 * An artifact's Completeness Statement, read from the same `completeness` route
 * the shell reads. `null` while the read is in flight; on a failed read the
 * panel is replaced by a warning that says coverage is unknown — never by a
 * fabricated "nothing analyzed".
 */
function useCoverage(artifact: string) {
  const [statement, setStatement] = useState<
    CompletenessStatement | undefined | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    callApi<CaseCompleteness>("completeness", [])
      .then((result) => {
        if (!cancelled) {
          setStatement(
            result.statements.find((entry) => entry.artifact === artifact),
          );
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
  }, [artifact]);
  return { statement, error };
}

export function Coverage({ artifact }: { readonly artifact: string }) {
  const { statement, error } = useCoverage(artifact);
  if (error !== null) {
    return (
      <Banner status="warning" contrast="high">
        <BannerTitle>Evidence coverage could not be loaded.</BannerTitle>
        <BannerDescription>{error}</BannerDescription>
      </Banner>
    );
  }
  return (
    <div className="reveal-swap">
      <Skeleton className="h-[86px] rounded-xl" />
      {statement === null ? null : <CompletenessPanel statement={statement} />}
    </div>
  );
}
