/**
 * Evidence coverage (the Completeness Statement), visible before any row so
 * absence is never silent — but only as loud as the coverage is bad.
 *
 *  - `CoverageIndicator`: a quiet "2/2 read" control with a state dot. The
 *    shell puts it at the right of every evidence page's title row. It opens
 *    the per-database detail (`CoverageDetail`) in an FF popover.
 *  - `CoverageBanner`: only when something in scope was not read (not
 *    present, unreadable, or never analyzed) — one line in an FF Banner
 *    naming what, with a "Details" action opening the same detail. The shell
 *    renders it directly under the page header. Healthy coverage renders
 *    nothing here.
 *
 * Scope: the Completeness artifact keys a page shows (`artifacts`, from
 * artifacts.ts: `completenessArtifact`, `TIMELINE_COVERAGE`,
 * `SITES_COVERAGE`), or the whole Case when omitted.
 */
import { Button } from "@/components/ui/button";
import {
  Banner,
  BannerAction,
  BannerActions,
  BannerTitle,
} from "@/components/ui/banner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { OUTCOME_META } from "../terms.js";
import { ARTIFACTS, SITES_COVERAGE, TIMELINE_COVERAGE } from "../artifacts.js";
import type {
  CaseCompleteness,
  CompletenessArtifact,
  CompletenessStatement,
} from "../types.js";
import { EvidenceDot, type EvidenceState } from "./evidence.js";
import { profileLabel } from "./finding-fields.js";

export { SITES_COVERAGE, TIMELINE_COVERAGE };

/** The plain label of a Completeness artifact ("Web Data" → "Form data"). */
export function artifactLabel(artifact: string): string {
  return (
    ARTIFACTS.find((entry) => entry.completenessArtifact === artifact)?.label ??
    artifact
  );
}

/** The coverage of one scope, summed over its statements. */
export interface CoverageScope {
  readonly statements: readonly CompletenessStatement[];
  /** Artifacts in scope with no statement at all ("not analyzed"). */
  readonly missing: readonly string[];
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
  /** Anything in scope not read: not present, unreadable, or not analyzed. */
  readonly degraded: boolean;
  /** The state dot: produced (all read), unavailable (any unreadable),
   *  warning (something not present or not analyzed). */
  readonly state: EvidenceState;
  /** More than one artifact in scope: the detail groups by artifact. */
  readonly merged: boolean;
}

/**
 * The statements in scope, summed: one Completeness Statement per artifact
 * (`artifacts`), or every statement in the Case when `artifacts` is omitted.
 * Artifacts in scope with no statement at all are returned as `missing` —
 * never silently dropped.
 */
export function coverageOf(
  completeness: CaseCompleteness,
  artifacts?: readonly string[],
): CoverageScope {
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
  const attempted = total("attempted");
  const produced = total("produced");
  const absent = total("absent");
  const unavailable = total("unavailable");
  const degraded =
    attempted === 0 ||
    produced < attempted ||
    missing.length > 0 ||
    statements.some((statement) => statement.attempted === 0);
  return {
    statements,
    missing,
    attempted,
    produced,
    absent,
    unavailable,
    degraded,
    state: unavailable > 0 ? "unavailable" : degraded ? "warning" : "produced",
    merged: artifacts === undefined || artifacts.length > 1,
  };
}

/** "2 of 2 databases read", then what the rest were. */
function summaryOf(scope: CoverageScope): string {
  if (scope.attempted === 0) {
    return "Nothing analyzed in this scope yet.";
  }
  const parts = [
    `${scope.produced.toLocaleString("en-US")} of ${scope.attempted.toLocaleString("en-US")} ${scope.attempted === 1 ? "database" : "databases"} read`,
  ];
  if (scope.unavailable > 0) {
    parts.push(
      `${scope.unavailable.toLocaleString("en-US")} ${OUTCOME_META.unavailable.label}`,
    );
  }
  if (scope.absent > 0) {
    parts.push(
      `${scope.absent.toLocaleString("en-US")} ${OUTCOME_META.absent.label}`,
    );
  }
  if (scope.missing.length > 0) {
    parts.push(`${scope.missing.length.toLocaleString("en-US")} not analyzed`);
  }
  return parts.join(" · ");
}

const OUTCOME_ORDER: Readonly<Record<CompletenessArtifact["outcome"], number>> =
  { unavailable: 0, absent: 1, produced: 2 };

/** One database: outcome word (dot repeats it), file, and the reason. */
function DetailRow({ row }: { readonly row: CompletenessArtifact }) {
  const outcome = OUTCOME_META[row.outcome];
  return (
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 px-2.5 py-1.5">
      <span
        className={cn(
          typeClass("caption"),
          "inline-flex items-center gap-1.5 whitespace-nowrap",
          outcome.className,
        )}
      >
        <EvidenceDot state={outcome.evidence} />
        {outcome.label}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            typeClass("caption"),
            "block truncate font-mono text-foreground",
          )}
          title={row.databasePath}
        >
          {row.databasePath}
        </span>
        {row.reason === null ? null : (
          <span
            className={cn(
              typeClass("caption"),
              "break-words text-muted-foreground",
            )}
          >
            {row.reason}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * The per-database detail: a heading, the one-line summary, then every
 * database in scope (grouped by artifact when more than one is in scope),
 * unread ones first. Rendered inside the indicator's and the banner's
 * popover.
 */
export function CoverageDetail({ scope }: { readonly scope: CoverageScope }) {
  const groups = scope.statements.map((statement) => ({
    key: statement.artifact,
    label: artifactLabel(statement.artifact),
    rows: [...statement.artifacts].sort(
      (a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome],
    ),
  }));
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-1.5">
        <p
          className={cn(typeClass("subtitle"), "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          Evidence coverage
        </p>
        <p
          className={cn(
            typeClass("caption"),
            "text-muted-foreground tabular-nums",
          )}
        >
          {summaryOf(scope)}
        </p>
      </div>
      <div className="max-h-[min(60vh,24rem)] overflow-y-auto border-t border-border pt-1">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            {scope.merged ? (
              <h3
                className={cn(
                  typeClass("caption"),
                  "px-2.5 pt-1.5 text-foreground",
                )}
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {group.label}
              </h3>
            ) : null}
            <ul>
              {group.rows.map((row, index) => (
                <DetailRow
                  key={`${row.sourceId}-${row.profile}-${String(index)}`}
                  row={row}
                />
              ))}
            </ul>
          </section>
        ))}
        {scope.missing.map((artifact) => (
          <section key={artifact} aria-label={artifactLabel(artifact)}>
            <h3
              className={cn(
                typeClass("caption"),
                "px-2.5 pt-1.5 text-foreground",
              )}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {artifactLabel(artifact)}
            </h3>
            <p
              className={cn(
                typeClass("caption"),
                "flex items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground",
              )}
            >
              <EvidenceDot state="absent" />
              not analyzed in this Case
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Popover surface for the detail: wide enough for a database path. */
const DETAIL_POPOVER = "w-[min(26rem,calc(100vw-2rem))] pb-1.5";

/**
 * The quiet coverage control for a page title row: the state dot and
 * "N/M read" (databases read of those attempted), opening the per-database
 * detail. Its accessible name carries the full summary.
 */
export function CoverageIndicator({
  completeness,
  artifacts,
  quiet = false,
  className,
}: {
  readonly completeness: CaseCompleteness;
  /** Completeness artifact keys in scope; omit for the whole Case. */
  readonly artifacts?: readonly string[];
  /** The landing page's reading (Overview): the dot stays a neutral ring
   *  unless something in scope is unreadable (then red). @default false */
  readonly quiet?: boolean;
  readonly className?: string;
}) {
  const scope = coverageOf(completeness, artifacts);
  const dot: EvidenceState =
    quiet && scope.state !== "unavailable" ? "neutral" : scope.state;
  const label =
    scope.attempted === 0
      ? "Not analyzed"
      : `${scope.produced.toLocaleString("en-US")}/${scope.attempted.toLocaleString("en-US")} read`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="compact"
          aria-label={`Evidence coverage: ${summaryOf(scope)}`}
          className={cn("shrink-0 tabular-nums", className)}
        >
          <span className="inline-flex items-center gap-1.5">
            <EvidenceDot state={dot} />
            {label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={DETAIL_POPOVER}>
        <CoverageDetail scope={scope} />
      </PopoverContent>
    </Popover>
  );
}

/** One unread thing, in words: the artifact (and Profile when only part of
 *  it), what happened, and why. */
interface Gap {
  readonly subject: string;
  readonly where: string;
  readonly outcome: "unavailable" | "absent" | "missing";
  readonly reason: string | null;
}

function gapsOf(scope: CoverageScope): Gap[] {
  const gaps: Gap[] = [];
  for (const statement of scope.statements) {
    const subject = artifactLabel(statement.artifact);
    const unread = statement.artifacts.filter(
      (row) => row.outcome !== "produced",
    );
    const keys = new Map<string, CompletenessArtifact[]>();
    for (const row of unread) {
      const key = `${row.outcome}\u0000${row.reason ?? ""}`;
      keys.set(key, [...(keys.get(key) ?? []), row]);
    }
    for (const rows of keys.values()) {
      const first = rows[0];
      if (first === undefined || first.outcome === "produced") {
        continue;
      }
      const where =
        rows.length >= statement.attempted
          ? ""
          : rows.length === 1
            ? ` in ${profileLabel(first.profile)}`
            : ` in ${String(rows.length)} profiles`;
      gaps.push({
        subject,
        where,
        outcome: first.outcome,
        reason: first.reason,
      });
    }
    if (statement.attempted === 0) {
      gaps.push({ subject, where: "", outcome: "missing", reason: null });
    }
  }
  for (const artifact of scope.missing) {
    gaps.push({
      subject: artifactLabel(artifact),
      where: "",
      outcome: "missing",
      reason: null,
    });
  }
  return gaps;
}

/** The banner's one line: a sentence for one gap, a list for several. */
function GapSentence({ gaps }: { readonly gaps: readonly Gap[] }) {
  const strong = { fontVariationSettings: fontWeights.semibold };
  const only = gaps.length === 1 ? gaps[0] : undefined;
  if (only === undefined) {
    return (
      <>
        Not everything was read:{" "}
        {gaps.map((gap, index) => (
          <span key={index}>
            {index === 0 ? "" : ", "}
            <span style={strong}>{gap.subject}</span>
            {gap.where}
          </span>
        ))}
        .
      </>
    );
  }
  const reason =
    only.reason === null ? "" : ` - ${only.reason.replace(/\.$/, "")}`;
  if (only.outcome === "unavailable") {
    return (
      <>
        <span style={strong}>{only.subject}</span>
        {only.where} could not be read{reason}.
      </>
    );
  }
  if (only.outcome === "absent") {
    return (
      <>
        No <span style={strong}>{only.subject}</span> database{only.where}
        {reason}.
      </>
    );
  }
  return (
    <>
      <span style={strong}>{only.subject}</span> was not analyzed in this Case.
    </>
  );
}

function plainGaps(gaps: readonly Gap[]): string {
  return gaps
    .map(
      (gap) =>
        `${gap.subject}${gap.where}: ${
          gap.outcome === "missing"
            ? "not analyzed"
            : OUTCOME_META[gap.outcome].label
        }${gap.reason === null ? "" : ` - ${gap.reason}`}`,
    )
    .join("; ");
}

/**
 * One line above the rows when something in scope was not read: an FF
 * Banner (error when anything is unreadable, else warning) naming what, with
 * a "Details" action opening the per-database detail. Renders nothing when
 * every database in scope was read.
 */
export function CoverageBanner({
  completeness,
  artifacts,
  className,
}: {
  readonly completeness: CaseCompleteness;
  /** Completeness artifact keys in scope; omit for the whole Case. */
  readonly artifacts?: readonly string[];
  readonly className?: string;
}) {
  const scope = coverageOf(completeness, artifacts);
  if (!scope.degraded) {
    return null;
  }
  const gaps = gapsOf(scope);
  return (
    <Banner
      status={scope.unavailable > 0 ? "error" : "warning"}
      size="compact"
      role="status"
      aria-label="Evidence coverage"
      className={className}
    >
      <BannerTitle
        className="sm:truncate"
        style={{ fontVariationSettings: fontWeights.normal }}
        title={plainGaps(gaps)}
      >
        <GapSentence gaps={gaps} />
      </BannerTitle>
      <BannerActions>
        <Popover>
          <PopoverTrigger asChild>
            <BannerAction variant="ghost">Details</BannerAction>
          </PopoverTrigger>
          <PopoverContent align="end" className={DETAIL_POPOVER}>
            <CoverageDetail scope={scope} />
          </PopoverContent>
        </Popover>
      </BannerActions>
    </Banner>
  );
}
