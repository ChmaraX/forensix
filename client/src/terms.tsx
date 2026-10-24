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
import { EvidenceBadge, type EvidenceState } from "./components/evidence.js";
import { Term, TermExplanation, TermTooltip } from "./components/term.js";

export const COMMIT_META: Readonly<
  Record<
    CommitState,
    {
      readonly label: string;
      /** Evidence state drawn for this Commit State (see evidence.tsx). */
      readonly badge: Extract<EvidenceState, "committed" | "wal" | "journal">;
      readonly plain: string;
      readonly technical: string;
    }
  >
> = {
  committed: {
    label: "saved",
    badge: "committed",
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
    badge: "journal",
    plain:
      "Found in Chrome's rollback journal: data from an interrupted write — often rows that were being deleted or replaced. Recovered by the analyzer.",
    technical: "Commit State: journal_resident (rollback journal)",
  },
};

export function CommitBadge({ state }: { readonly state: CommitState }) {
  const meta = COMMIT_META[state];
  return (
    <TermTooltip
      content={
        <TermExplanation technical={meta.technical}>
          {meta.plain}
        </TermExplanation>
      }
    >
      <EvidenceBadge state={meta.badge} tabIndex={0} className="cursor-help">
        {meta.label}
      </EvidenceBadge>
    </TermTooltip>
  );
}

/**
 * Completeness outcomes. The word is the state; `evidence` names the FF
 * Badge / dot that repeats it in color (see evidence.tsx). `className` is
 * the text color for the bare word — one of FF's two text colors; the hue
 * belongs on the dot or Badge, never on the word.
 */
export const OUTCOME_META = {
  produced: {
    label: "available",
    className: "text-foreground",
    evidence: "produced",
  },
  absent: {
    label: "not present",
    className: "text-muted-foreground",
    evidence: "absent",
  },
  unavailable: {
    label: "unreadable",
    className: "text-foreground",
    evidence: "unavailable",
  },
} as const satisfies Record<
  string,
  { label: string; className: string; evidence: EvidenceState }
>;

export function CoverageTerm({ children }: { readonly children: ReactNode }) {
  return (
    <Term label={children} technical="Technical: Completeness Statement">
      What the analyzer attempted to read from this Case, and what it got:
      available (parsed fine), not present (the file does not exist), or
      unreadable (exists but could not be parsed — with the reason). Missing
      evidence is shown, never hidden.
    </Term>
  );
}
