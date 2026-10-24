/**
 * Evidence coverage (the Completeness Statement) — always rendered before any
 * rows, so absence is visible, not silent. Plain words; the technical term
 * lives in the tooltip.
 *
 * A Panel with the title and the four counts on one line (each count is a
 * number + its word; the state hue rides a dot beside the word, never alone),
 * then an FF Accordion row that opens the per-database detail as a compact
 * FF Table whose Outcome column is a worded EvidenceBadge.
 */
import { Panel } from "@/components/panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { CoverageTerm, OUTCOME_META } from "../terms.js";
import type { CompletenessStatement } from "../types.js";
import { EvidenceBadge, EvidenceDot, type EvidenceState } from "./evidence.js";

function CoverageStat({
  label,
  count,
  state,
}: {
  readonly label: string;
  readonly count: number;
  readonly state?: EvidenceState;
}) {
  const size = useSize();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {state === undefined ? null : <EvidenceDot state={state} />}
      <span
        className={cn(size.type.body, "text-foreground tabular-nums")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {count.toLocaleString("en-US")}
      </span>
      <span className={cn(size.type.body, "text-muted-foreground")}>
        {label}
      </span>
    </span>
  );
}

function DetailTable({
  statement,
}: {
  readonly statement: CompletenessStatement;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto [&_tbody>tr:last-child]:border-transparent">
      <Table size="compact">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Outcome</TableHead>
            <TableHead className="whitespace-nowrap">Source</TableHead>
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            <TableHead className="whitespace-nowrap">Database</TableHead>
            <TableHead className="whitespace-nowrap">Reason</TableHead>
            <TableHead className="whitespace-nowrap">Run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statement.artifacts.map((artifact, index) => {
            const outcome = OUTCOME_META[artifact.outcome];
            return (
              <TableRow
                key={`${artifact.sourceId}-${artifact.profile}-${String(index)}`}
                index={index}
              >
                <TableCell className="whitespace-nowrap">
                  <EvidenceBadge state={outcome.evidence}>
                    {outcome.label}
                  </EvidenceBadge>
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {artifact.sourceId}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {artifact.profile}
                </TableCell>
                <TableCell className="max-w-[280px]">
                  <span
                    title={artifact.databasePath}
                    className="block truncate font-mono"
                  >
                    {artifact.databasePath}
                  </span>
                </TableCell>
                <TableCell className="min-w-[160px]">
                  {artifact.reason ?? "—"}
                </TableCell>
                <TableCell className="font-mono whitespace-nowrap">
                  {artifact.runId}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function CompletenessPanel({
  statement,
  className,
}: {
  readonly statement: CompletenessStatement | undefined;
  readonly className?: string;
}) {
  const size = useSize();
  const empty = statement === undefined || statement.attempted === 0;

  return (
    <Panel
      role="region"
      aria-label="Evidence coverage"
      className={cn("overflow-clip", className)}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <h2
          className={cn(size.type.subtitle, "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          <CoverageTerm>Evidence coverage</CoverageTerm>
        </h2>
        {empty ? (
          <p className={cn(size.type.body, "text-muted-foreground")}>
            Nothing analyzed for this Case yet.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <CoverageStat label="attempted" count={statement.attempted} />
            <CoverageStat
              label={OUTCOME_META.produced.label}
              count={statement.produced}
              state="produced"
            />
            <CoverageStat
              label={OUTCOME_META.absent.label}
              count={statement.absent}
              state="absent"
            />
            <CoverageStat
              label={OUTCOME_META.unavailable.label}
              count={statement.unavailable}
              state="unavailable"
            />
          </div>
        )}
      </div>
      {empty ? null : (
        <div className="border-t border-border p-1">
          <Accordion
            type="single"
            collapsible
            size="compact"
            className="w-full"
          >
            <AccordionItem value="detail" highlight="trigger">
              <AccordionTrigger>Per-database detail</AccordionTrigger>
              <AccordionContent>
                <div className="px-1 pt-1 pb-2">
                  <DetailTable statement={statement} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </Panel>
  );
}
