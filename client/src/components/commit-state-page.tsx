/**
 * The frame every saved / recovered artifact page shares (forensic rule
 * 4): the page's empty state when both lists read empty, else its figures
 * (over the saved rows, revealed once they are read, stepping aside when
 * there is none to count) and its list panel; the row sheet last.
 *
 * The page supplies only what is its own - the empty state, the figures,
 * the list panel (`CommitStateSplit` with `status.split`) and the sheet -
 * and reads the one status model (`commitStateStatus`), so every page
 * decides "empty", "figures ready" and the tab counts the same way.
 */
import type { ReactNode } from "react";

import type { CommitStateStatus } from "../use-commit-state-lists.js";
import { RevealSwap } from "./list-states.js";
import { Panel } from "./panel.js";

export function CommitStatePage({
  status,
  empty,
  figures,
  figuresSkeleton,
  sheet,
  children,
}: {
  readonly status: CommitStateStatus;
  /** The page's empty state (an `ArtifactEmpty` or `EmptyRows`). */
  readonly empty: ReactNode;
  /** The figures and widgets over the saved rows, if the page has any. */
  readonly figures?: ReactNode;
  /** Stands in for `figures` at their size while the saved rows load. */
  readonly figuresSkeleton?: ReactNode;
  /** The open row's sheet (null when none). */
  readonly sheet: ReactNode;
  /** The list panel. */
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {status.pageEmpty ? (
        <Panel>{empty}</Panel>
      ) : (
        <>
          {figures === undefined || status.figures === "hide" ? null : (
            <RevealSwap
              loading={status.figures === "loading"}
              skeleton={figuresSkeleton}
            >
              {figures}
            </RevealSwap>
          )}
          {children}
        </>
      )}
      {sheet}
    </div>
  );
}
