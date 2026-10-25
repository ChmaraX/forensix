/**
 * Favicon field readings shared by the Favicons page and the Sites view's
 * Favicons list: the stored resolution and byte size, each falling back to
 * its own field's word when not recorded as a number.
 */
import { createContext } from "react";

import type { Finding } from "../types.js";
import { FieldCell, fieldInteger } from "./finding-fields.js";

/** A favicon's stored resolution as a `"32×32"` label, or null when either
 *  edge is not recorded as a number. */
export function resolutionLabel(row: Finding): string | null {
  const width = fieldInteger(row.fields.width);
  const height = fieldInteger(row.fields.height);
  if (width === null || height === null) {
    return null;
  }
  return `${String(width)}×${String(height)}`;
}

/** The stored bitmap's size in bytes, or null when not recorded. */
export function faviconBytes(row: Finding): number | null {
  return fieldInteger(row.fields.payloadBytes);
}

/** "32×32", else the word of whichever edge was not recorded as a number. */
export function ResolutionCell({ row }: { readonly row: Finding }) {
  const label = resolutionLabel(row);
  if (label !== null) {
    return label;
  }
  const missing =
    fieldInteger(row.fields.width) === null
      ? row.fields.width
      : row.fields.height;
  return <FieldCell field={missing} />;
}

/** The stored bitmaps on show, by SHA-256 (`useOwnBitmaps`): a row's
 *  thumbnail is the payload its own `payloadSha256` names. */
export const FaviconBitmapsContext = createContext<ReadonlyMap<string, string>>(
  new Map(),
);
