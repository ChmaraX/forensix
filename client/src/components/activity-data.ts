/**
 * Shared `history` `view=activity` reads.
 *
 * Overview, History, and Timeline all draw a "page visits per day" chart
 * from the exact same underlying evidence. Before this module existed each
 * page re-implemented its own paginated fetch, and only Timeline's chart
 * gap-filled zero-visit days — Overview's and History's charts silently
 * skipped them instead of drawing a zero bar, so the same evidence read as
 * three subtly different shapes depending which page you were on. One fetch
 * loop, one gap-fill algorithm, used everywhere this data appears.
 */
import { useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import type { FieldState, Finding, PageOf } from "../types.js";
import type { DayCount } from "./charts.js";

/** One `activity` row: recorded page-visit count for a local date and hour. */
export interface ActivityBucket {
  readonly date: string;
  readonly hour: number;
  readonly count: number;
}

function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
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
export const GAP_FILL_LIMIT = 550;

/**
 * Reads every `history` `view=activity` row up to `ACTIVITY_PAGE_CAP` pages,
 * parsed into `{date, hour, count}` buckets. Reports whether the read was
 * complete (the cursor ran out) or was cut off by the cap, so the caller can
 * show a truncation notice instead of silently under-reporting.
 */
export async function fetchActivityBuckets(): Promise<{
  readonly buckets: readonly ActivityBucket[];
  readonly complete: boolean;
}> {
  const buckets: ActivityBucket[] = [];
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
      const count = Number(
        fieldString(row.fields.supportingVisitCount) ?? "0",
      );
      if (date === null || !Number.isInteger(hour) || Number.isNaN(count)) {
        continue;
      }
      buckets.push({ date, hour, count });
    }
    after = result.nextCursor;
    if (after === null) {
      complete = true;
      break;
    }
  }
  return { buckets, complete };
}

/** React hook wrapping `fetchActivityBuckets`, cancelled on unmount. Buckets
 *  stay `null` while the first read is in flight. */
export function useActivityBuckets(): {
  readonly buckets: readonly ActivityBucket[] | null;
  readonly complete: boolean;
  readonly error: string | null;
} {
  const [buckets, setBuckets] = useState<readonly ActivityBucket[] | null>(
    null,
  );
  const [complete, setComplete] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActivityBuckets()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setBuckets(result.buckets);
        setComplete(result.complete);
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
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { buckets, complete, error };
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

/**
 * Gap-filled per-day totals in one call — fetch, aggregate, fill — the exact
 * shape a chart-only consumer needs (Timeline). Kept as one hook so that
 * page's own code stays an import away from this module rather than
 * reimplementing the composition.
 */
export function useActivityDays(): {
  readonly days: readonly DayCount[] | null;
  readonly error: string | null;
} {
  const { buckets, error } = useActivityBuckets();
  const days = useMemo(
    () => (buckets === null ? null : fillGaps(bucketsToDays(buckets))),
    [buckets],
  );
  return { days, error };
}
