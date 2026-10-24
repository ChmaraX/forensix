/**
 * Evidence coverage (the Completeness Statement) — always rendered before any
 * rows, so absence is visible, not silent. Plain words; the technical term
 * lives in the tooltip.
 *
 * A Panel with the title and the four counts on one line (each count is a
 * number + its word; the state hue rides a dot beside the word, never alone),
 * then an FF Accordion row that opens the per-database detail as a compact
 * FF Table whose Outcome column is a worded EvidenceBadge.
 *
 * Scoped per page: a page passes the shell's Case-wide `completeness` and the
 * Completeness artifact keys it shows (`artifacts`), so each page states the
 * coverage of exactly the evidence it lists.
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
import { ARTIFACTS } from "../artifacts.js";
import type { CaseCompleteness, CompletenessStatement } from "../types.js";
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
  statements,
  showArtifact,
}: {
  readonly statements: readonly CompletenessStatement[];
  readonly showArtifact: boolean;
}) {
  const rows = statements.flatMap((statement) => statement.artifacts);
  return (
    <div className="scroll-fade-x overflow-x-auto [&_tbody>tr:last-child]:border-transparent">
      <Table size="compact">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Outcome</TableHead>
            {showArtifact ? (
              <TableHead className="whitespace-nowrap">Artifact</TableHead>
            ) : null}
            <TableHead className="whitespace-nowrap">Source</TableHead>
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            <TableHead className="whitespace-nowrap">Database</TableHead>
            <TableHead className="whitespace-nowrap">Reason</TableHead>
            <TableHead className="whitespace-nowrap">Run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((artifact, index) => {
            const outcome = OUTCOME_META[artifact.outcome];
            return (
              <TableRow
                key={`${artifact.artifact}-${artifact.sourceId}-${artifact.profile}-${String(index)}`}
                index={index}
              >
                <TableCell className="whitespace-nowrap">
                  <EvidenceBadge state={outcome.evidence}>
                    {outcome.label}
                  </EvidenceBadge>
                </TableCell>
                {showArtifact ? (
                  <TableCell className="whitespace-nowrap">
                    {artifactLabel(artifact.artifact)}
                  </TableCell>
                ) : null}
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

/** The plain label of a Completeness artifact ("Web Data" → "Form data"). */
function artifactLabel(artifact: string): string {
  return (
    ARTIFACTS.find((entry) => entry.completenessArtifact === artifact)?.label ??
    artifact
  );
}

/** Every Completeness artifact the Timeline merges (core's queryTimeline). */
export const TIMELINE_COVERAGE: readonly string[] = [
  "History",
  "Downloads",
  "Cookies",
  "Web Data",
];

/** Every Completeness artifact the Sites view groups by host. */
export const SITES_COVERAGE: readonly string[] = [
  "History",
  "Cookies",
  "Login Data",
  "Bookmarks",
  "Top Sites",
  "Web Data",
];

/**
 * The statements in scope, summed: one Completeness Statement per artifact
 * (`artifacts`, the `completenessArtifact` keys from artifacts.ts), or every
 * statement in the Case when `artifacts` is omitted. Artifacts in scope with
 * no statement at all are returned as `missing` — never silently dropped.
 */
function scopeOf(
  completeness: CaseCompleteness,
  artifacts: readonly string[] | undefined,
) {
  const statements =
    artifacts === undefined
      ? completeness.statements
      : completeness.statements.filter((statement) =>
          artifacts.includes(statement.artifact),
        );
  const missing =
    artifacts === undefined
      ? []
      : artifacts.filter(
          (artifact) =>
            !completeness.statements.some(
              (statement) => statement.artifact === artifact,
            ),
        );
  const total = (key: "attempted" | "produced" | "absent" | "unavailable") =>
    statements.reduce((sum, statement) => sum + statement[key], 0);
  return {
    statements,
    missing,
    attempted: total("attempted"),
    produced: total("produced"),
    absent: total("absent"),
    unavailable: total("unavailable"),
  };
}

/**
 * Evidence coverage for a page. Pass the Case-wide `completeness` the shell
 * loads once, and the `artifacts` the page shows (its own
 * `config.completenessArtifact`, or every artifact a merged view reads —
 * `TIMELINE_COVERAGE`, `SITES_COVERAGE`). Omit `artifacts` for the whole Case.
 * With more than one artifact in scope the counts are summed, the artifacts
 * are named under the title, and the detail table gains an Artifact column.
 */
export function CompletenessPanel({
  completeness,
  artifacts,
  className,
}: {
  readonly completeness: CaseCompleteness;
  /** Completeness artifact keys in scope (`ArtifactConfig.completenessArtifact`). */
  readonly artifacts?: readonly string[];
  readonly className?: string;
}) {
  const size = useSize();
  const scope = scopeOf(completeness, artifacts);
  const empty = scope.attempted === 0;
  const merged = artifacts === undefined || artifacts.length > 1;
  const named = artifacts === undefined ? [] : artifacts.map(artifactLabel);

  return (
    <Panel
      role="region"
      aria-label="Evidence coverage"
      className={cn("overflow-clip", className)}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2
            className={cn(size.type.subtitle, "text-foreground")}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            <CoverageTerm>Evidence coverage</CoverageTerm>
          </h2>
          {merged && named.length > 0 ? (
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              {named.join(" · ")}
            </p>
          ) : null}
        </div>
        {empty ? (
          <p className={cn(size.type.body, "text-muted-foreground")}>
            {artifacts === undefined
              ? "Nothing analyzed for this Case yet."
              : `Nothing analyzed for ${named.join(", ")} in this Case yet.`}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <CoverageStat label="attempted" count={scope.attempted} />
            <CoverageStat
              label={OUTCOME_META.produced.label}
              count={scope.produced}
              state="produced"
            />
            <CoverageStat
              label={OUTCOME_META.absent.label}
              count={scope.absent}
              state="absent"
            />
            <CoverageStat
              label={OUTCOME_META.unavailable.label}
              count={scope.unavailable}
              state="unavailable"
            />
          </div>
        )}
        {!empty && scope.missing.length > 0 ? (
          <p className={cn(size.type.caption, "text-muted-foreground")}>
            Not analyzed: {scope.missing.map(artifactLabel).join(", ")}
          </p>
        ) : null}
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
                  <DetailTable
                    statements={scope.statements}
                    showArtifact={merged}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </Panel>
  );
}
