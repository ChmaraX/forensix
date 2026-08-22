import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

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
