/**
 * The shared `history` `view=activity` read (Overview, History, Timeline):
 * one fetch loop, read once per Case (`caseActivity`), one gap-fill
 * algorithm, used everywhere this data appears. Its `timeZone` is the one
 * Case zone, for server `from` / `to` bounds only: pages that bucket loaded
 * rows by day read each row's own declared zone (day-bounds `fieldZone`)
 * and never wait for this read.
 *
 * Saved and recovered stay apart (forensic rule 4). Core writes one activity
 * row per Profile, Commit State, local date and hour, so the read keeps each
 * row's Commit State and hands back two bucket sets: `saved` (committed rows
 * — what every chart and figure counts) and `recovered` (WAL + journal rows
 * — named beside them, never summed in).
 */
import { useCallback, useEffect, useState } from "react";

import { callApi } from "../api.js";
import type { Finding, PageOf } from "../types.js";
import type { DayCount } from "./charts.js";
import { fieldString } from "./finding-fields.js";

/** One `activity` row: recorded page-visit count for a local date and hour. */
export interface ActivityBucket {
  readonly date: string;
  readonly hour: number;
  readonly count: number;
  /** The profile the bucket's visits belong to (one activity row per
   *  profile per local date and hour). */
  readonly profile?: string;
}

/** The buckets of the picked profiles (every bucket when none is picked):
 *  the lens's profile pick, applied to a chart by the recorded profile. */
export function bucketsOfProfiles(
  buckets: readonly ActivityBucket[],
  profiles: readonly string[],
): readonly ActivityBucket[] {
  return profiles.length === 0
    ? buckets
    : buckets.filter(
        (bucket) =>
          bucket.profile !== undefined && profiles.includes(bucket.profile),
      );
}

/**
 * Upper bound on `activity` pages read. A Finding is one row per Profile per
 * local date-and-hour, so a single Profile at full hourly density needs
 * about one row per active hour: a year of daily browsing (about 350 active
 * days x up to 24 hours) fits in roughly 8,400 rows, or 84 pages at the
 * route's 100-row page size. 150 pages (15,000 rows) covers that with
 * headroom for several Profiles in one Case, while still bounding a
 * pathological Case to a fixed, short number of requests instead of reading
 * without limit.
 */
export const ACTIVITY_PAGE_CAP = 150;

/** Above this many days, gap-filling would draw more bars than pixels. */
const GAP_FILL_LIMIT = 550;

/** The activity read, kept apart by Commit State. */
export interface SplitActivity {
  /** Buckets read from committed activity rows. */
  readonly saved: readonly ActivityBucket[];
  /** Buckets read from WAL- and journal-resident activity rows. */
  readonly recovered: readonly ActivityBucket[];
  /** False when the page cap stopped the read before the cursor ran out. */
  readonly complete: boolean;
  /** The declared timezone the days were bucketed in (every row's
   *  `declaredTimezone`), or null when the rows carry none or disagree.
   *  Day ranges picked on these days go to the server in this zone
   *  (`dayRangeBounds`). */
  readonly timeZone: string | null;
}

/**
 * Reads every `history` `view=activity` row up to `ACTIVITY_PAGE_CAP` pages,
 * parsed into `{date, hour, count}` buckets and split by Commit State.
 * Reports whether the read was complete (the cursor ran out) or was cut off
 * by the cap, so the caller can say so instead of silently under-reporting.
 */
export async function fetchActivity(): Promise<SplitActivity> {
  const saved: ActivityBucket[] = [];
  const recovered: ActivityBucket[] = [];
  const zones = new Set<string>();
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
      // An unrecorded zone counts as its own (unknown) zone, so it can only
      // make the rows disagree, never stand in for a real one.
      zones.add(fieldString(row.fields.declaredTimezone) ?? "");
      (row.commitState === "committed" ? saved : recovered).push({
        date,
        hour,
        count,
        profile: row.profile,
      });
    }
    after = result.nextCursor;
    if (after === null) {
      complete = true;
      break;
    }
  }
  // One declared timezone across every row, or null: then day ranges fall
  // back to UTC days (`dayRangeBounds`), the only clock that does not pick
  // one Analysis Run's zone over another's.
  const [zone] = zones;
  return {
    saved,
    recovered,
    complete,
    timeZone:
      zones.size === 1 && zone !== undefined && zone !== "" ? zone : null,
  };
}

/**
 * The Case's activity read, shared: the first caller starts one
 * `fetchActivity`, every later caller (another page, the next visit to the
 * same page) gets the same answer. The Case is read-only, so the answer
 * cannot go stale; a failed read is forgotten so the next caller tries
 * again, and `refresh` forces a new read (Retry).
 */
let sharedActivity: Promise<SplitActivity> | null = null;

export function caseActivity(refresh = false): Promise<SplitActivity> {
  if (refresh || sharedActivity === null) {
    const read = fetchActivity();
    sharedActivity = read;
    read.catch(() => {
      if (sharedActivity === read) {
        sharedActivity = null;
      }
    });
  }
  return sharedActivity;
}

/** `caseActivity` as a hook. `activity` stays `null` while the read is in
 *  flight and after a failure (`error` set); `retry` reads again. */
export function useActivity(): {
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
    caseActivity(nonce > 0)
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

function inRange(
  date: string,
  range?: { readonly from?: string; readonly to?: string },
): boolean {
  if (range?.from !== undefined && range.from !== "" && date < range.from) {
    return false;
  }
  if (range?.to !== undefined && range.to !== "" && date > range.to) {
    return false;
  }
  return true;
}

/** Per-day totals, summed across every hour bucket, optionally restricted to
 *  an inclusive local-date range (an unset or empty bound is unrestricted on
 *  that side). Sorted ascending by date. Days with zero recorded visits are
 *  simply absent from the result — call `fillGaps` for a continuous axis. */
export function bucketsToDays(
  buckets: readonly ActivityBucket[],
  range?: { readonly from?: string; readonly to?: string },
): DayCount[] {
  const byDate = new Map<string, number>();
  for (const bucket of buckets) {
    if (!inRange(bucket.date, range)) {
      continue;
    }
    byDate.set(bucket.date, (byDate.get(bucket.date) ?? 0) + bucket.count);
  }
  return [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/** Totals per hour-of-day (0-23), summed across every day, under the same
 *  optional date-range restriction as `bucketsToDays`. */
export function bucketsToHourTotals(
  buckets: readonly ActivityBucket[],
  range?: { readonly from?: string; readonly to?: string },
): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const bucket of buckets) {
    if (!inRange(bucket.date, range)) {
      continue;
    }
    if (bucket.hour >= 0 && bucket.hour < 24) {
      hours[bucket.hour] = (hours[bucket.hour] ?? 0) + bucket.count;
    }
  }
  return hours;
}

/**
 * Zero-count days between the first and last day in `days`, so a chart's
 * x-axis is continuous calendar time and a drag or click maps 1:1 to
 * calendar days — the reading no evidence contradicts, since an unrecorded
 * day and a recorded-zero day are indistinguishable from `activity` alone.
 * Skipped above `GAP_FILL_LIMIT` days, where the extra bars would cost more
 * pixels than the continuity is worth, and left alone when `days` is already
 * empty or a single point.
 */
/**
 * `days` gap-filled across `span` too (zero days at its ends), so a chart's
 * axis reaches days the Case records events on without a page visit (the
 * Timeline's downloads and cookies). Left as `fillGaps(days)` when the span
 * would pass `GAP_FILL_LIMIT` days or is not known.
 */
export function fillGapsAcross(
  days: readonly DayCount[],
  span: { readonly min: string | null; readonly max: string | null },
): readonly DayCount[] {
  const ends = [span.min, span.max].filter(
    (date): date is string => date !== null,
  );
  if (ends.length === 0) {
    return fillGaps(days);
  }
  const widened = [
    ...days,
    ...ends
      .filter((date) => !days.some((day) => day.date === date))
      .map((date) => ({ date, count: 0 })),
  ].sort((left, right) => left.date.localeCompare(right.date));
  const first = widened[0]?.date;
  const last = widened[widened.length - 1]?.date;
  const length =
    first === undefined || last === undefined
      ? 0
      : Math.round(
          (new Date(`${last}T00:00:00Z`).getTime() -
            new Date(`${first}T00:00:00Z`).getTime()) /
            86_400_000,
        ) + 1;
  // Over the limit fillGaps would leave the days sparse: then keep the
  // visits' own axis rather than two lone zero days at its ends.
  return length > GAP_FILL_LIMIT ? fillGaps(days) : fillGaps(widened);
}

export function fillGaps(days: readonly DayCount[]): readonly DayCount[] {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    return days;
  }
  const start = new Date(`${first.date}T00:00:00Z`).getTime();
  const end = new Date(`${last.date}T00:00:00Z`).getTime();
  const span = Math.round((end - start) / 86_400_000) + 1;
  if (span <= days.length || span > GAP_FILL_LIMIT) {
    return days;
  }
  const byDate = new Map(days.map((day) => [day.date, day.count]));
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(start + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, count: byDate.get(date) ?? 0 };
  });
}
