/**
 * App-level helpers. `cn` is Fluid Functionalism's (src/lib/utils.ts), whose
 * tailwind-merge knows the type-scale role classes; it is re-exported here so
 * existing `../lib.js` imports keep resolving to the one implementation.
 */
export { cn } from "./lib/utils.js";

/** Render an arbitrary field value as text; time objects show their UTC form. */
export function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.utc === "string" ? record.utc : JSON.stringify(value);
  }
  return String(value);
}
