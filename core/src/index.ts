export {
  CASE_FILENAME,
  CASE_SCHEMA_VERSION,
  TOOL_VERSION,
  caseArtifactAbsolutePath,
  loadCaseSource,
  loadCaseSources,
  workingCopyAbsolutePath,
  type CaseProfileRecord,
  type CaseSourceRecord,
  type SourceEvidenceGap,
} from "./case.js";
export {
  ForensixError,
  WorkingCopyIntegrityRefusal,
  type ErrorDiagnostic,
  type ForensixErrorCode,
  type WorkingCopyIssue,
  type WorkingCopyIssueReason,
} from "./errors.js";
export {
  ingestSource,
  ingestUserDataDir,
  type IngestBundleVerificationResult,
  type IngestOptions,
  type IngestProgress,
  type IngestResult,
  type IngestSourceResult,
} from "./ingest.js";
export {
  HASH_ALGORITHM,
  MANIFEST_SCHEMA,
  SOURCE_KINDS,
  assertManifestEntry,
  canonicalManifestLine,
  decodeManifestEntry,
  decodeManifestHeader,
  evidenceSetDigest,
  manifestBytes,
  representationDigest,
  sha256,
  sortManifestEntries,
  workingCopyDigest,
  type FileKind,
  type ManifestEntry,
  type ManifestHeader,
  type ManifestState,
  type NodeType,
  type SelectionTier,
  type SourceKind,
  type UnavailableReason,
} from "./manifest.js";
export {
  CHROME_USERDATA_POLICY,
  browserLevelEvidence,
  classifyProfileSourcePath,
  classifySourcePath,
  expectedProfileTierOnePaths,
  expectedTierOnePaths,
  isProfileDirectoryName,
  type BrowserLevelEvidence,
  type Selection,
} from "./selection-policy.js";
export {
  preflightAnalysis,
  verifyWorkingCopy,
  type AnalysisPreflightResult,
  type WorkingCopySourceVerification,
  type WorkingCopyVerification,
} from "./verify.js";
export {
  absentField,
  createCandidate,
  createFinding,
  FindingCollection,
  unavailableField,
  valueField,
  type AbsentField,
  type Candidate,
  type CommitState,
  type FieldState,
  type FieldUnavailableReason,
  type Finding,
  type ForensicFields,
  type Provenance,
  type SourceRowProvenance,
  type UnavailableField,
  type ValueField,
} from "./forensic-model.js";
export {
  ANALYSE_EXIT_CODES,
  analyseCase,
  type AnalyseCaseOptions,
  type AnalyseCaseResult,
  type EpochFamily,
  type ForensicTimestamp,
  type HistoryAnalysisSummary,
} from "./history.js";
export {
  queryHistory,
  type HistoryDirection,
  type HistoryPage,
  type HistoryQuery,
  type HistorySort,
  type HistoryView,
} from "./history-query.js";
export {
  type AnalysisRunExitState,
  type DeclaredOriginOs,
} from "./case-findings.js";

export const MINIMUM_NODE_VERSION = "24.15.0" as const;
