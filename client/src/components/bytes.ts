/** Byte counts in words (pure; shared by the tables, figures and the row
 *  sheet). */

/** Bytes as "1.4 MB" / "812 KB" / "312 B" — base-1024, one decimal below
 *  100 units. Presentation only: the exact byte count stays reachable in the
 *  row detail sheet (put it in a `title` where the short form is shown). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${units[unit] ?? "KB"}`;
}
