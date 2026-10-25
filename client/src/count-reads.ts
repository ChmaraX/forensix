/**
 * Figures from the server's aggregates, never from rows drained to the
 * client.
 *
 * `count` groups the active records of one kind by one field (or by
 * `profile` / `commitState`) in SQL and answers with the total and the
 * largest buckets (at most 100; `otherCount` holds the rest). `summary`
 * counts every kind at once. A page asks for the figure it prints, with
 * the same profile pick and Commit State as its lists, so a figure covers
 * the whole Case however few rows the lists have loaded.
 *
 * The pure readers below turn a `CountResult` into the numbers a page
 * shows, and say when a figure is only a floor (more buckets than the
 * server lists). They are unit-tested (count-reads.test.ts).
 */
import { useEffect, useMemo, useState } from "react";

import { callApi, type QueryParameters } from "./api.js";
import type { Read } from "./components/metric-band.js";
import type { CommitState, CountBucket, CountResult } from "./types.js";

/** Buckets the server lists at most per count (core's `--limit` bound). */
export const COUNT_BUCKET_LIMIT = 100;

export interface CountQuery {
  /** The Finding or Candidate kind (`login_credential`). */
  readonly kind: string;
  /** The field, or `profile` / `commitState`. */
  readonly by: string;
  /** The profile pick (empty: every profile). */
  readonly profiles?: readonly string[];
  readonly commitState?: CommitState;
}

/** The `count` route's parameters for a query (every bucket it may list). */
export function countParameters(query: CountQuery): QueryParameters {
  return [
    ["kind", query.kind],
    ["by", query.by],
    ...(query.profiles ?? []).map((profile) => ["profile", profile] as const),
    ...(query.commitState === undefined
      ? []
      : [["commit-state", query.commitState] as const]),
    ["limit", String(COUNT_BUCKET_LIMIT)],
  ];
}

/** One `count` read, re-read when the query changes; null skips it. */
export function useCount(query: CountQuery | null): Read<CountResult> {
  const key = query === null ? null : JSON.stringify(countParameters(query));
  const [read, setRead] = useState<{
    readonly key: string | null;
    readonly read: Read<CountResult>;
  }>({ key: null, read: { state: "loading" } });
  useEffect(() => {
    if (key === null) {
      return;
    }
    const abort = new AbortController();
    const parameters = JSON.parse(key) as QueryParameters;
    callApi<CountResult>("count", parameters, { signal: abort.signal }).then(
      (value) => {
        setRead({ key, read: { state: "ready", value } });
      },
      () => {
        if (!abort.signal.aborted) {
          setRead({ key, read: { state: "failed" } });
        }
      },
    );
    return () => {
      abort.abort();
    };
  }, [key]);
  // A read of an older query never stands for this one.
  return read.key === key ? read.read : { state: "loading" };
}

/** A count's figure: the number, and whether it is only a floor. */
export interface Tally {
  readonly count: number;
  /** More buckets exist than the server listed: `count` is a floor. */
  readonly more: boolean;
}

/** "1,204", or "100+" when the tally is a floor. */
export function formatTally(tally: Tally): string {
  return `${tally.count.toLocaleString("en-US")}${tally.more ? "+" : ""}`;
}

/** A bucket that holds a recorded, non-empty value. */
function isValueBucket(bucket: CountBucket): boolean {
  return bucket.state === "value" && bucket.key !== "";
}

/**
 * How many distinct recorded, non-empty values the field holds (absent,
 * (empty) and unavailable are no value). A floor when the server listed
 * only its largest buckets.
 */
export function distinctValues(result: CountResult): Tally {
  return {
    count: result.buckets.filter(isValueBucket).length,
    more: result.otherCount > 0,
  };
}

/** The records whose bucket passes `test`: a floor when buckets past the
 *  limit could pass it too. */
export function recordsWhere(
  result: CountResult,
  test: (bucket: CountBucket) => boolean,
): Tally {
  return {
    count: result.buckets
      .filter(test)
      .reduce((sum, bucket) => sum + bucket.count, 0),
    more: result.otherCount > 0,
  };
}

/** Saved and recovered records per a `by=commitState` count. */
export function commitStateTotals(result: CountResult): {
  readonly saved: number;
  readonly recovered: number;
} {
  let saved = 0;
  let recovered = 0;
  for (const bucket of result.buckets) {
    if (bucket.key === "committed") {
      saved += bucket.count;
    } else if (
      bucket.key === "wal_resident" ||
      bucket.key === "journal_resident"
    ) {
      recovered += bucket.count;
    }
  }
  return { saved, recovered };
}

/** A read's value mapped, its state kept. */
export function mapRead<T, U>(read: Read<T>, map: (value: T) => U): Read<U> {
  return read.state === "ready"
    ? { state: "ready", value: map(read.value) }
    : read;
}

/** Saved / recovered totals for one kind in the profile pick: the tabs'
 *  counts, from one `by=commitState` count. */
export function useCommitStateTotals(
  kind: string,
  profiles: readonly string[],
): Read<{ readonly saved: number; readonly recovered: number }> {
  const read = useCount(
    useMemo(() => ({ kind, by: "commitState", profiles }), [kind, profiles]),
  );
  return useMemo(() => mapRead(read, commitStateTotals), [read]);
}
