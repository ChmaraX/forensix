/**
 * The shell's one line about a row the URL names that the page had not
 * loaded (`useRowSelection` with a lookup, row-lookup.ts): while it is read
 * by its reference, "Opening the row this link names…"; when it is not
 * found, says why (no such row, or not within the lookup's bound) and
 * offers Close (drops the row from the URL). Nothing when the row opened.
 */
import {
  Banner,
  BannerAction,
  BannerActions,
  BannerTitle,
} from "@/components/ui/banner";
import { fontWeights } from "@/lib/font-weight";

import { ROW_LOOKUP_ROW_CAP } from "../row-lookup.js";
import { closeUrlRow, useRowLookupStatus } from "../view-state.js";

export function RowLookupNotice({
  className,
}: {
  readonly className?: string;
}) {
  const status = useRowLookupStatus();
  if (status.state === "idle") {
    return null;
  }
  const words =
    status.state === "looking"
      ? "Opening the row this link names - it is not among the rows loaded here yet."
      : status.failed
        ? "The row this link names could not be read."
        : status.capped
          ? `The row this link names is not among the first ${ROW_LOOKUP_ROW_CAP.toLocaleString("en-US")} rows of its profile here, so it is not open.`
          : "No row on this page has the reference this link names, so nothing is open.";
  return (
    <Banner
      status={status.state === "looking" ? "info" : "warning"}
      size="compact"
      role="status"
      aria-label="Linked row"
      className={className}
    >
      <BannerTitle style={{ fontVariationSettings: fontWeights.normal }}>
        {words}
      </BannerTitle>
      {status.state === "missing" ? (
        <BannerActions>
          <BannerAction variant="ghost" onClick={closeUrlRow}>
            Close
          </BannerAction>
        </BannerActions>
      ) : null}
    </Banner>
  );
}
