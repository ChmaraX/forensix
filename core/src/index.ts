export {
  CASE_FILENAME,
  CASE_SCHEMA_VERSION,
  TOOL_VERSION,
  loadCaseSource,
  workingCopyAbsolutePath,
  type CaseSourceRecord,
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
  ingestUserDataDir,
  type IngestOptions,
  type IngestProgress,
  type IngestResult,
} from "./ingest.js";
export {
  HASH_ALGORITHM,
  MANIFEST_SCHEMA,
  assertManifestEntry,
  canonicalManifestLine,
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
  type UnavailableReason,
} from "./manifest.js";
export {
  CHROME_USERDATA_POLICY,
  classifySourcePath,
  expectedTierOnePaths,
  isProfileDirectoryName,
  type Selection,
} from "./selection-policy.js";
export {
  preflightAnalysis,
  verifyWorkingCopy,
  type AnalysisPreflightResult,
  type WorkingCopyVerification,
} from "./verify.js";

export const MINIMUM_NODE_VERSION = "24.15.0" as const;
