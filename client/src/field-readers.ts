/**
 * The field readers: a recorded value, or `null` - and `null` covers
 * absent, (empty) and unavailable alike. Use them to compute, group and
 * sort; to show a field render `FieldCell` / `TimeCell` with the FieldState
 * itself, so each state keeps its own word.
 *
 * Pure (no React): the URL, Related and index rules read rows through
 * these too. `components/finding-fields.tsx` re-exports them for pages.
 */
import type { FieldState } from "./types.js";

/** `"value"`-state non-empty string, or null. */
export function fieldText(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "string" && field.value !== ""
    ? field.value
    : null;
}

/** `"value"`-state field as a plain string (numbers included), or null. */
export function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value === "" ? null : field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
}

/**
 * A `"value"`-state flag as `true` / `false`, or null. Core records most
 * flags as JSON booleans (a cookie's `isSecure`, Preferences' key
 * presence) and the cache's integrity flags as the strings `"true"` /
 * `"false"` (`booleanField` in core/src/cache.ts); both read the same.
 * Any other value or state is null, never coerced to a verdict.
 */
export function fieldBool(field: FieldState | undefined): boolean | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "boolean") {
    return field.value;
  }
  return field.value === "true" ? true : field.value === "false" ? false : null;
}

/** The UTC instant of a timestamp field (`{utc, ...}` value shape), or null. */
export function fieldUtc(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value !== "object" || field.value === null) {
    return null;
  }
  const utc = (field.value as Record<string, unknown>).utc;
  return typeof utc === "string" ? utc : null;
}

/** Integer carried as a string field (ranks, counts), or null. */
export function fieldInteger(field: FieldState | undefined): number | null {
  const text = fieldText(field);
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}
