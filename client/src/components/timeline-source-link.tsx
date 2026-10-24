/**
 * The Timeline row sheet's way back to the row's own page: "Open this row
 * in History" (or Downloads, Cookies, Form data). The Timeline merges four
 * artifacts; this opens the artifact page on the same row - addressed by
 * its reference (file, table, row id, profile, Commit State), on its Saved
 * or Recovered tab - so the examiner reads it beside its neighbours there.
 *
 * Nothing is matched: the link names the row itself. A page visit also
 * carries its URL as History's search, so History reads that row (its list
 * is paged) and opens it. A row without a reference (no table or row id)
 * has no address, so no link.
 */
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/lib/app-icons";

import type { Finding } from "../types.js";
import { hrefFor, openPage, useViewState } from "../view-state.js";
import { sourceRowOf } from "./timeline-source-row.js";

export function TimelineSourceLink({ row }: { readonly row: Finding }) {
  const { profiles } = useViewState();
  const source = sourceRowOf(row, profiles);
  if (source === null) {
    return null;
  }
  const words = `Open this row in ${source.label}`;
  return (
    <div className="flex">
      <Button
        asChild
        variant="tertiary"
        size="compact"
        trailingIcon={ChevronRightIcon}
      >
        <a
          href={hrefFor(source.page, source.extras)}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            openPage(source.page, source.extras);
          }}
        >
          {words}
        </a>
      </Button>
    </div>
  );
}
