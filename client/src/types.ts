/**
 * Wire types for the read-only dashboard API.
 *
 * The server returns core's own shapes, so the client takes core's types
 * (type-only imports from core's sources: erased from the bundle, and a
 * change to core's shape is a compile error here, never silent drift). The
 * client contains no forensic logic: every value arrives already typed as a
 * FieldState and is only presented.
 */
import type {
  CommitState,
  Finding as CoreFinding,
} from "../../core/src/forensic-model.js";
import type { CandidateRecord as CoreCandidateRecord } from "../../core/src/identity-candidates-query.js";
import type {
  CountBucket as CoreCountBucket,
  CountResult as CoreCountResult,
  SummaryResult as CoreSummaryResult,
} from "../../core/src/record-queries.js";
import type { SiteFinding as CoreSiteFinding } from "../../core/src/sites-query.js";

export type {
  CaseCompleteness,
  CaseProfiles,
  CompletenessArtifact,
  CompletenessStatement,
} from "../../core/src/case-overview.js";
export type {
  CommitState,
  FieldUnavailableReason,
} from "../../core/src/forensic-model.js";
export type {
  FaviconBitmapsResult,
  SiteFaviconsResult,
} from "../../core/src/site-favicons-query.js";
export type { SiteArtifactKind, SiteHost } from "../../core/src/sites-query.js";

/** One recorded field: a value, absent, or unavailable with core's reason. */
export type FieldState = CoreFinding["fields"][string];

/** The parts of a Finding's provenance the dashboard reads (the wire
 *  carries core's whole source chain). */
export interface Provenance {
  /** The Source the row was read from (a Case can hold several). */
  readonly sourceId?: string;
  readonly manifestPath?: string;
  readonly table?: string;
  readonly rowId?: string;
}

/** A Finding as JSON carries it: core's `Finding` without its in-process
 *  brand. */
export interface Finding extends Pick<
  CoreFinding,
  "recordType" | "findingKind" | "profile" | "fields"
> {
  /** The record id every list route puts first (`history:180`): unique in
   *  the Case, the row's URL reference (`rowRefOf`). */
  readonly id?: string;
  readonly commitState: CommitState;
  readonly provenance: Provenance;
}

/** A row of one Sites host (`site-findings`): its Finding, the evidence
 *  kind it is grouped under, and the fields that record the host. */
export type SiteFinding = Finding &
  Pick<CoreSiteFinding, "artifactKind" | "hostFields">;

/** An identity or behavior Candidate (`candidates`): a ranked hypothesis,
 *  never a fact, with no Commit State. */
export interface IdentityCandidate extends Pick<
  CoreCandidateRecord,
  | "recordType"
  | "candidateKind"
  | "category"
  | "profile"
  | "rank"
  | "supportingCount"
  | "fields"
> {
  readonly id?: string;
  readonly provenance: Provenance & {
    readonly supportingRows?: readonly Provenance[];
  };
}

/** `count`: active records of one kind grouped by one field. */
export type CountResult = CoreCountResult;
export type CountBucket = CoreCountBucket;
/** `summary`: Sources, Profiles, record counts, span and coverage. */
export type SummaryResult = CoreSummaryResult;

export interface PageOf<Row> {
  readonly status: "ok";
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly limit: number;
}
