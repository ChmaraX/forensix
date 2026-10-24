/**
 * The `history` `view=activity` read for History and Timeline, kept apart by
 * Commit State.
 *
 * `activity-data.ts` sums every activity row into one per-hour count, so a
 * figure built on it mixes saved visits with visits recovered from the WAL
 * or rollback journal. Core writes one activity row per Profile, Commit
 * State, local date and hour, so this read keeps each row's Commit State and
 * hands the page two bucket sets: `saved` (committed rows — what charts and
 * figures count) and `recovered` (WAL + journal rows — reported beside them,
 * never summed in). It also exposes `retry`, which the shared hook lacks, so
 * a failed read can be retried in place.
 *
 * Same paging and cap as `fetchActivityBuckets`.
 */
import { useCallback, useEffect, useState } from "react";

import { callApi } from "../api.js";
import type { Finding, PageOf } from "../types.js";
import { ACTIVITY_PAGE_CAP, type ActivityBucket } from "./activity-data.js";
import { fieldString } from "./finding-fields.js";

export interface SplitActivity {
  /** Buckets read from committed activity rows. */
  readonly saved: readonly ActivityBucket[];
  /** Buckets read from WAL- and journal-resident activity rows. */
  readonly recovered: readonly ActivityBucket[];
  /** False when the page cap stopped the read before the cursor ran out. */
  readonly complete: boolean;
}

async function fetchSplitActivity(): Promise<SplitActivity> {
  const saved: ActivityBucket[] = [];
  const recovered: ActivityBucket[] = [];
  let after: string | null = null;
  let complete = false;
  for (let page = 0; page < ACTIVITY_PAGE_CAP; page += 1) {
    const parameters: (readonly [string, string])[] = [
      ["view", "activity"],
      ["sort", "local-time"],
      ["direction", "asc"],
      ["limit", "100"],
    ];
    if (after !== null) {
      parameters.push(["after", after]);
    }
    const result: PageOf<Finding> = await callApi<PageOf<Finding>>(
      "history",
      parameters,
    );
    for (const row of result.items) {
      const date = fieldString(row.fields.localDate);
      const hour = Number(fieldString(row.fields.localHour) ?? "");
      const count = Number(fieldString(row.fields.supportingVisitCount) ?? "0");
      if (date === null || !Number.isInteger(hour) || Number.isNaN(count)) {
        continue;
      }
      (row.commitState === "committed" ? saved : recovered).push({
        date,
        hour,
        count,
      });
    }
    after = result.nextCursor;
    if (after === null) {
      complete = true;
      break;
    }
  }
  return { saved, recovered, complete };
}

/** The split activity read. `activity` stays `null` while the read is in
 *  flight and after a failure (`error` set); `retry` reads again. */
export function useSplitActivity(): {
  readonly activity: SplitActivity | null;
  readonly error: string | null;
  readonly retry: () => void;
} {
  const [activity, setActivity] = useState<SplitActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setActivity(null);
    setError(null);
    fetchSplitActivity()
      .then((result) => {
        if (!cancelled) {
          setActivity(result);
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
  }, [nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { activity, error, retry };
}

/** Total visits across a bucket set. */
export function visitTotal(buckets: readonly ActivityBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}
