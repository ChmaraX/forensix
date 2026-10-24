/**
 * Day ranges as server instants, in the Case's declared timezone.
 *
 * Core buckets the per-day activity charts by the declared timezone of the
 * Analysis Run (`analyse --timezone`, default UTC): each `history`
 * `view=activity` row carries it in `fields.declaredTimezone`. So "4 Mar" on
 * a chart is 4 Mar on the Case's clock, and a click on it must list exactly
 * that day: `dayRangeBounds` turns a `YYYY-MM-DD` range into the first and
 * last instant of those local days (`from` / `to`, inclusive, UTC ISO with
 * microseconds, what `history` and `timeline` accept). `localDayOf` reads a
 * UTC instant back as the local day, for filtering loaded rows by the same
 * range.
 *
 * With no single declared timezone (no activity rows, or runs that declared
 * different zones) the bounds are UTC days: the only clock left that does not
 * pick one run's zone over another's.
 *
 * Pages that bucket or filter *loaded* rows by day (Downloads, Cache) use
 * `caseDayOf` / `inCaseDays` / `caseDayTotals` with the same zone
 * (`useCaseTimeZone()` in activity-data), so a moment falls on the same day
 * on every page.
 *
 * Pure (no React), unit-tested in `day-bounds.test.ts`.
 */

const DAY_MS = 86_400_000;

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

/** The zone if `Intl` knows it, else `"UTC"`. */
function usableZone(timeZone: string | null): string {
  if (timeZone === null || timeZone === "") {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (formatter === undefined) {
    // en-CA formats a date as YYYY-MM-DD, the same reading core's activity
    // bucketing uses (`localDateAndHour`).
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function dayAt(instantMs: number, timeZone: string): string {
  // UTC needs no zone database: the ISO date is the day (and it is several
  // times faster, which matters when a page buckets thousands of rows).
  if (timeZone === "UTC") {
    return new Date(instantMs).toISOString().slice(0, 10);
  }
  return dayFormatter(timeZone).format(new Date(instantMs));
}

/** The zone's offset from UTC at an instant, in ms (local minus UTC). */
function offsetAt(instantMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of partFormatter(timeZone).formatToParts(
    new Date(instantMs),
  )) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  const local = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return local - Math.floor(instantMs / 1000) * 1000;
}

/** The first instant (ms) of a local day in a zone. Handles a midnight that
 *  a clock change skips: the day then starts when it first reads that date. */
function dayStartMs(day: string, timeZone: string): number | null {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(midnight)) {
    return null;
  }
  if (timeZone === "UTC") {
    return midnight;
  }
  const offsets = new Set([
    offsetAt(midnight - DAY_MS, timeZone),
    offsetAt(midnight, timeZone),
    offsetAt(midnight + DAY_MS, timeZone),
  ]);
  const starts = [...offsets]
    .map((offset) => midnight - offset)
    .filter(
      (start) =>
        dayAt(start, timeZone) === day && dayAt(start - 1000, timeZone) < day,
    )
    .sort((left, right) => left - right);
  return starts[0] ?? midnight - offsetAt(midnight, timeZone);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The server bounds of an inclusive day range (`""` = an open side): `from`
 * is the first instant of the first day, `to` the last microsecond of the
 * last day, both on the zone's clock, as UTC ISO strings.
 */
export function dayRangeBounds(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
): { readonly from: string | null; readonly to: string | null } {
  const zone = usableZone(timeZone);
  const start = range.from === "" ? null : dayStartMs(range.from, zone);
  const end = range.to === "" ? null : dayStartMs(nextDay(range.to), zone);
  return {
    from: start === null ? null : new Date(start).toISOString(),
    // One millisecond before the next day, padded to its last microsecond:
    // day starts fall on whole seconds, so nothing of the day is cut off.
    to:
      end === null
        ? null
        : new Date(end - 1).toISOString().replace(/Z$/, "999Z"),
  };
}

/** `from` / `to` query parameters for a day range (open sides left out). */
export function dayRangeParameters(
  range: { readonly from: string; readonly to: string },
  timeZone: string | null,
): (readonly [string, string])[] {
  const bounds = dayRangeBounds(range, timeZone);
  return [
    ...(bounds.from === null ? [] : [["from", bounds.from] as const]),
    ...(bounds.to === null ? [] : [["to", bounds.to] as const]),
  ];
}

/** The local day (`YYYY-MM-DD`) of a UTC instant in the zone, or null. */
export function localDayOf(
  utc: string | null,
  timeZone: string | null,
): string | null {
  if (utc === null) {
    return null;
  }
  const instant = Date.parse(utc);
  if (Number.isNaN(instant)) {
    return null;
  }
  return dayAt(instant, usableZone(timeZone));
}

/** An inclusive day range (`""` = an open side). */
interface DayRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The Case day of a loaded row's instant: `localDayOf` under the name pages
 * read it by. `timeZone` is the Case's declared zone
 * (`useCaseTimeZone().timeZone`); null falls back to UTC days, the same rule
 * as `dayRangeBounds`.
 */
export function caseDayOf(
  utc: string | null,
  timeZone: string | null,
): string | null {
  return localDayOf(utc, timeZone);
}

/**
 * A loaded row's instant falls inside the day range on the Case's clock.
 * The full span (`{ from: "", to: "" }`) holds every row; with a range set,
 * a row with no recorded instant falls outside it.
 */
export function inCaseDays(
  utc: string | null,
  range: DayRange,
  timeZone: string | null,
): boolean {
  if (range.from === "" && range.to === "") {
    return true;
  }
  const day = localDayOf(utc, timeZone);
  if (day === null) {
    return false;
  }
  return (
    (range.from === "" || day >= range.from) &&
    (range.to === "" || day <= range.to)
  );
}

/** One Case day of loaded rows: how many, and the sum of their weights. */
export interface CaseDayTotal {
  readonly date: string;
  readonly count: number;
  readonly weight: number;
}

/**
 * Loaded rows bucketed by Case day: per day, the number of rows and the sum
 * of `weightOf` (bytes, say; 0 without it). Rows with no recorded instant
 * are left out. Sorted by day; days with no rows are absent (`fillGaps` in
 * activity-data makes the axis continuous).
 *
 *   caseDayTotals(downloads, (row) => row.startUtc, timeZone,
 *     (row) => row.receivedBytes ?? 0)
 */
export function caseDayTotals<Row>(
  rows: readonly Row[],
  utcOf: (row: Row) => string | null,
  timeZone: string | null,
  weightOf?: (row: Row) => number,
): CaseDayTotal[] {
  const zone = usableZone(timeZone);
  const byDay = new Map<string, { count: number; weight: number }>();
  for (const row of rows) {
    const utc = utcOf(row);
    if (utc === null) {
      continue;
    }
    const instant = Date.parse(utc);
    if (Number.isNaN(instant)) {
      continue;
    }
    const day = dayAt(instant, zone);
    const entry = byDay.get(day) ?? { count: 0, weight: 0 };
    entry.count += 1;
    entry.weight += weightOf?.(row) ?? 0;
    byDay.set(day, entry);
  }
  return [...byDay.entries()]
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((left, right) => left.date.localeCompare(right.date));
}
