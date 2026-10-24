/**
 * The shell's one line about a row the URL names that the page had not
 * loaded (`useRowSelection` with a lookup, row-lookup.ts): while it is read
 * by its reference, "Opening the row this link names…"; when it is not
 * found, says why (no such row, or not within the lookup's bound) and
 * offers Close (drops the row from the URL and hands focus to the page's
 * h1). Nothing when the row opened.
 *
 * The polite region is always mounted and the banner is written into it,
 * so a screen reader announces the words when they appear (a region that
 * mounts already holding its text is often skipped).
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
  const words =
    status.state === "idle"
      ? null
      : status.state === "looking"
        ? "Opening the row this link names - it is not among the rows loaded here yet."
        : status.failed
          ? "The row this link names could not be read."
          : status.capped
            ? `The row this link names is not among the first ${ROW_LOOKUP_ROW_CAP.toLocaleString("en-US")} rows of its profile here, so it is not open.`
            : "No row on this page has the reference this link names, so nothing is open.";
  return (
    // Empty, the region takes no room: its negative margin cancels the
    // column gap it would otherwise add.
    <div role="status" aria-live="polite" className="empty:-mb-5">
      {words === null ? null : (
        <Banner
          status={status.state === "looking" ? "info" : "warning"}
          size="compact"
          role="none"
          className={className}
        >
          <BannerTitle style={{ fontVariationSettings: fontWeights.normal }}>
            {words}
          </BannerTitle>
          {status.state === "missing" ? (
            <BannerActions>
              <BannerAction
                variant="ghost"
                onClick={(event) => {
                  // The banner unmounts with the row: focus goes to the
                  // page's heading rather than falling to <body>.
                  const heading =
                    event.currentTarget
                      .closest("[data-page-column]")
                      ?.querySelector<HTMLElement>("h1") ?? null;
                  closeUrlRow();
                  requestAnimationFrame(() => {
                    if (heading === null) {
                      return;
                    }
                    if (!heading.hasAttribute("tabindex")) {
                      heading.setAttribute("tabindex", "-1");
                      heading.classList.add("outline-none");
                    }
                    heading.focus({ preventScroll: true });
                  });
                }}
              >
                Close
              </BannerAction>
            </BannerActions>
          ) : null}
        </Banner>
      )}
    </div>
  );
}
