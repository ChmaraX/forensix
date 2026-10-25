/**
 * Where a Timeline row lives: its artifact page and that page's view of
 * the row (`TimelineSourceLink`). Pure (unit-tested).
 */
import {
  FINDING_KINDS,
  artifactLabelOfKind,
  type EvidenceKey,
} from "../artifacts.js";
import { fieldText } from "../field-readers.js";
import { rowRefOf, type ViewLocation } from "../router.js";
import type { Finding } from "../types.js";

/** Where the row lives: its page and that page's view of it; null when
 *  the kind has no page or the row no reference. */
export function sourceRowOf(
  row: Finding,
  lensProfiles: readonly string[],
): {
  readonly page: EvidenceKey;
  readonly label: string;
  readonly extras: Partial<Omit<ViewLocation, "page">>;
} | null {
  const page = FINDING_KINDS[row.findingKind]?.artifact;
  const label = artifactLabelOfKind(row.findingKind);
  const ref = rowRefOf(row);
  if (page === undefined || label === null || ref === null) {
    return null;
  }
  const url =
    row.findingKind === "history_visit" ? fieldText(row.fields.url) : null;
  return {
    page,
    label,
    extras: {
      row: ref,
      tab: row.commitState === "committed" ? "saved" : "recovered",
      ...(url === null ? {} : { q: url }),
      // A profile pick that leaves this row's profile out would hide the
      // row there: the lens gains it (the topbar chip shows the change).
      ...(lensProfiles.length === 0 || lensProfiles.includes(row.profile)
        ? {}
        : { profiles: [...lensProfiles, row.profile] }),
    },
  };
}
