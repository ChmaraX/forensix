/**
 * The plain-language layer.
 *
 * Every forensic term the UI shows gets a human label plus a tooltip that
 * explains it and names the exact technical term, so the surface is readable
 * without training while staying forensically precise. Labels stay distinct
 * words — meaning is never carried by color alone.
 */
import type { ReactNode } from "react";

import type { CommitState } from "./types.js";
import { Badge } from "./components/ui/badge.js";
import {
  Term,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip.js";

export const COMMIT_META: Readonly<
  Record<
    CommitState,
    {
      readonly label: string;
      readonly badge: "secondary" | "wal" | "violet";
      readonly plain: string;
      readonly technical: string;
    }
  >
> = {
  committed: {
    label: "saved",
    badge: "secondary",
    plain: "Normal data, fully saved in Chrome's database.",
    technical: "Commit State: committed",
  },
  wal_resident: {
    label: "recovered — unsaved",
    badge: "wal",
    plain:
      "Found in Chrome's write-ahead log: changes Chrome had not yet finished saving when it stopped. Real activity, recovered by the analyzer.",
    technical: "Commit State: wal_resident (WAL)",
  },
  journal_resident: {
    label: "recovered — overwritten",
    badge: "violet",
    plain:
      "Found in Chrome's rollback journal: data from an interrupted write — often rows that were being deleted or replaced. Recovered by the analyzer.",
    technical: "Commit State: journal_resident (rollback journal)",
  },
};

export function CommitBadge({ state }: { readonly state: CommitState }) {
  const meta = COMMIT_META[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={meta.badge} className="cursor-help">
          {meta.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {meta.plain}
        <span className="mt-1 block font-mono text-[11px] opacity-70">
          {meta.technical}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export const OUTCOME_META = {
  produced: { label: "available", className: "text-success font-medium" },
  absent: { label: "not present", className: "text-muted-foreground italic" },
  unavailable: {
    label: "unreadable",
    className: "text-destructive font-medium",
  },
} as const;

export function CoverageTerm({ children }: { readonly children: ReactNode }) {
  return (
    <Term label={children}>
      What the analyzer attempted to read from this Case, and what it got:
      available (parsed fine), not present (the file does not exist), or
      unreadable (exists but could not be parsed — with the reason). Missing
      evidence is shown, never hidden.
      <span className="mt-1 block font-mono text-[11px] opacity-70">
        Technical: Completeness Statement
      </span>
    </Term>
  );
}
