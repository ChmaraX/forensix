/**
 * Shared, pure time and integer-range primitives for the History-family
 * artifacts. History and the Downloads that live inside the History database
 * serialise timestamps with the same `base::Time` epoch, so the conversion and
 * SQLite range helpers live here once rather than being copied per artifact.
 */

/** Microseconds between 1601-01-01 (the `base::Time` epoch) and 1970-01-01 UTC. */
export const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

/** Inclusive bounds of a signed 64-bit SQLite INTEGER column. */
export const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
export const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;

/** Floor division for bigints, so negative (pre-epoch) values round toward -inf. */
export function floorDivision(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

/**
 * Render microseconds since the Unix epoch as an ISO 8601 UTC instant with full
 * microsecond precision, or `null` when the value falls outside the range a
 * JavaScript `Date` can represent exactly.
 */
export function utcFromUnixMicros(unixMicros: bigint): string | null {
  const seconds = floorDivision(unixMicros, 1_000_000n);
  const micros = unixMicros - seconds * 1_000_000n;
  const milliseconds = seconds * 1000n + micros / 1000n;
  const numericMilliseconds = Number(milliseconds);
  if (!Number.isSafeInteger(numericMilliseconds)) {
    return null;
  }
  const date = new Date(numericMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const base = date.toISOString();
  return `${base.slice(0, -5)}.${micros.toString().padStart(6, "0")}Z`;
}

/** Keep a bigint only when it fits a signed 64-bit SQLite INTEGER sort column. */
export function boundedSortInteger(value: bigint): bigint | null {
  return value >= SQLITE_MIN_INTEGER && value <= SQLITE_MAX_INTEGER
    ? value
    : null;
}
