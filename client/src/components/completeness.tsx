/**
 * Evidence coverage (the Completeness Statement) — always rendered before any
 * rows, so absence is visible, not silent. Plain words; the technical term
 * lives in the tooltip.
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib.js";
import { CoverageTerm, OUTCOME_META } from "../terms.js";
import type { CompletenessStatement } from "../types.js";

function Stat({
  label,
  count,
  dotClass,
}: {
  readonly label: string;
  readonly count: number;
  readonly dotClass?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {dotClass !== undefined ? (
        <span
          aria-hidden="true"
          className={cn("size-2 self-center rounded-full", dotClass)}
        />
      ) : null}
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums">{count}</span>
    </span>
  );
}

export function CompletenessPanel({
  statement,
}: {
  readonly statement: CompletenessStatement | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const empty = statement === undefined || statement.attempted === 0;

  return (
    <section
      aria-label="Evidence coverage"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <h2 className="text-[13px] font-semibold">
          <CoverageTerm>Evidence coverage</CoverageTerm>
        </h2>
        {empty ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing analyzed for this Case yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Stat label="attempted" count={statement.attempted} />
              <Stat
                label="available"
                count={statement.produced}
                dotClass="bg-success"
              />
              <Stat label="not present" count={statement.absent} />
              <Stat
                label="unreadable"
                count={statement.unavailable}
                dotClass="bg-destructive"
              />
            </div>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                setExpanded((value) => !value);
              }}
              className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              {expanded ? "Hide detail" : "Per-database detail"}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform duration-150",
                  expanded && "rotate-180",
                )}
              />
            </button>
          </>
        )}
      </div>
      {expanded && !empty ? (
        <div className="overflow-x-auto border-t border-border/70">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Profile</th>
                <th className="px-4 py-2 font-medium">Database</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {statement.artifacts.map((artifact, index) => (
                <tr
                  key={`${artifact.sourceId}-${artifact.profile}-${String(index)}`}
                  className="border-t border-border/70"
                >
                  <td
                    className={cn(
                      "px-4 py-2",
                      OUTCOME_META[artifact.outcome].className,
                    )}
                  >
                    {OUTCOME_META[artifact.outcome].label}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">
                    {artifact.sourceId}
                  </td>
                  <td className="px-4 py-2">{artifact.profile}</td>
                  <td className="max-w-[280px] truncate px-4 py-2 font-mono text-[12px] text-muted-foreground">
                    <span title={artifact.databasePath}>
                      {artifact.databasePath}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {artifact.reason ?? "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">
                    {artifact.runId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
