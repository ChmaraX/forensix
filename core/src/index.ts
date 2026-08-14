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
  type CookieAnalysisSummary,
  type DecryptionSummary,
  type EpochFamily,
  type ForensicTimestamp,
  type HistoryAnalysisSummary,
  type LoginDataAnalysisSummary,
} from "./history.js";
export {
  DECRYPTION_DISABLED,
  OSCRYPT_ROUTES,
  decryptOscryptValue,
  schemeOf,
  type AuthorizedKeyMaterial,
  type DecryptionFailureReason,
  type DecryptionOutcome,
  type DecryptionSettings,
  type KeyMaterialProvenance,
  type OscryptRoute,
  type OscryptScheme,
} from "./oscrypt.js";
export {
  loadAuthorizedKeyMaterial,
  type KeyMaterialIssue,
  type LoadKeyMaterialOptions,
  type ResolvedKeyMaterial,
} from "./key-material.js";
export {
  queryCompleteness,
  queryProfiles,
  type CaseCompleteness,
  type CaseProfiles,
  type CompletenessArtifact,
  type CompletenessOutcome,
  type CompletenessStatement,
  type OverviewArtifact,
} from "./case-overview.js";
export {
  queryHistory,
  type HistoryDirection,
  type HistoryPage,
  type HistoryQuery,
  type HistorySort,
  type HistoryView,
} from "./history-query.js";
export {
  EXTRACT_FILES,
  EXTRACT_SCHEMA,
  REDACTION_POLICY,
  computeDerivedDigest,
  exportCase,
  isSecretFieldName,
  redactFields,
  type ExportCaseOptions,
  type ExportCaseResult,
  type ExtractCollection,
  type ExtractCompletenessArtifact,
  type ExtractCompletenessStatement,
  type ExtractManifest,
  type ExtractManifestFile,
  type ExtractRedactionState,
  type RedactedField,
} from "./export.js";
export {
  REPORT_SCHEMA,
  renderReport,
  type RenderReportOptions,
  type RenderReportResult,
} from "./report.js";
export {
  queryCredentials,
  type CredentialDirection,
  type CredentialPage,
  type CredentialQuery,
  type CredentialSort,
} from "./login-data-query.js";
export {
  queryCookies,
  type CookieDirection,
  type CookiePage,
  type CookieQuery,
  type CookieSort,
} from "./cookies-query.js";
export {
  type AnalysisRunExitState,
  type DeclaredOriginOs,
} from "./case-findings.js";
export { openDatabaseSync, type OpenDatabaseConfig } from "./sqlite-open.js";

export const MINIMUM_NODE_VERSION = "24.15.0" as const;
