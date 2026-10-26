/**
 * A `YYYY-MM-DD` day in words (read as a UTC calendar day, so the day
 * named is the day given). Unparseable input is returned as is. Pure.
 */

function formatted(date: string, options: Intl.DateTimeFormatOptions): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
}

/** "4 Mar 2024": range labels, chart tooltips, the ⌘K menu. */
export function formatDay(date: string): string {
  return formatted(date, { day: "numeric", month: "short", year: "numeric" });
}

/** "4 Mar", for chart axis ticks. */
export function formatDayTick(date: string): string {
  return formatted(date, { day: "numeric", month: "short" });
}

/** "Thu, 14 Mar 2024": a chart day in full, for tooltips and speech. */
export function formatDayLong(date: string): string {
  return formatted(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A recorded span as data, shortened: "11 Mar - 17 Apr" within one year,
 *  "9 Dec 2023 - 4 Jan 2024" across years, "4 Mar 2024" for one day. */
export function formatDaySpan(first: string, last: string): string {
  if (first === last) {
    return formatDay(first);
  }
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${formatDayTick(first)} - ${formatDayTick(last)}`
    : `${formatDay(first)} - ${formatDay(last)}`;
}
