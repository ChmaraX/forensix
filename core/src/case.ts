import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type {
  AcquisitionBundleStatus,
  AcquisitionVerificationOutcome,
} from "./acquisition-bundle.js";
import { ForensixError } from "./errors.js";
import {
  SOURCE_KINDS,
  decodeManifestEntry,
  type ManifestEntry,
  type ManifestHeader,
  type SourceKind,
} from "./manifest.js";

export const CASE_SCHEMA_VERSION = 2;
export const CASE_FILENAME = "case.fxdb";
export const TOOL_VERSION = "2.0.0-alpha.1";

export interface CaseProfileInput {
  readonly profileId: string;
  readonly path: string;
}

export interface SourceEvidenceGap {
  readonly path: string;
  readonly state: "unavailable";
  readonly reason: "outside_source";
}

export interface AcquisitionManifestInput {
  readonly manifestPath: string;
  readonly headerPath: string;
  readonly header: ManifestHeader;
  readonly entries: readonly ManifestEntry[];
}

export interface CreateCaseSourceOptions {
  readonly sourceId: string;
  readonly manifestId: string;
  readonly sourceKind: SourceKind;
  readonly sourcePath: string;
  readonly sourceOriginPath: string | null;
  readonly workingCopyPath: string;
  readonly manifestPath: string;
  readonly header: ManifestHeader;
  readonly entries: readonly ManifestEntry[];
  readonly profiles: readonly CaseProfileInput[];
  readonly evidenceGaps: readonly SourceEvidenceGap[];
  readonly acquisitionManifest?: AcquisitionManifestInput;
}

export interface CaseBundleVerificationFileInput {
  readonly scope: "bundle" | "source_manifest";
  readonly sourceId: string | null;
  readonly path: string;
  readonly outcome: AcquisitionVerificationOutcome;
  readonly expectedSize: number | null;
  readonly actualSize: number | null;
  readonly expectedSha256: string | null;
  readonly actualSha256: string | null;
}

export interface CaseBundleVerificationInput {
  readonly bundleId: string;
  readonly status: AcquisitionBundleStatus;
  readonly expectedBundleDigest: string;
  readonly actualBundleDigest: string;
  readonly sourceErrors: readonly string[];
  readonly files: readonly CaseBundleVerificationFileInput[];
}

export interface CreateCaseDatabaseOptions {
  readonly caseDirectory: string;
  readonly caseId: string;
  readonly inputSourceKind: SourceKind;
  readonly inputSourcePath: string;
  readonly discoveryUnavailablePaths: readonly string[];
  readonly sources: readonly CreateCaseSourceOptions[];
  readonly bundleVerification?: CaseBundleVerificationInput;
}

export interface CaseProfileRecord {
  readonly profileId: string;
  readonly path: string;
}

export interface CaseSourceRecord {
  readonly caseId: string;
  readonly sourceId: string;
  readonly manifestId: string;
  readonly sourceKind: SourceKind;
  readonly sourcePath: string;
  readonly sourceOriginPath: string | null;
  readonly selectionPolicy: "chrome-userdata/1";
  readonly manifestSchema: "forensix/manifest/1";
  readonly manifestPath: string;
  readonly tier2Included: boolean;
  readonly evidenceSetDigest: string;
  readonly workingCopyPath: string;
  readonly workingCopyPathKind: "relative" | "absolute";
  readonly workingCopyDigest: string;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly profileCount: number;
  readonly unavailableCount: number;
  readonly unclassifiedCount: number;
  readonly entries: readonly ManifestEntry[];
  readonly profiles: readonly CaseProfileRecord[];
  readonly evidenceGaps: readonly SourceEvidenceGap[];
}

interface ManifestEntryRow {
  readonly path: unknown;
  readonly state: unknown;
  readonly unavailable_reason: unknown;
  readonly node_type: unknown;
  readonly file_kind: unknown;
  readonly selection_tier: unknown;
  readonly copied: number;
  readonly unclassified: number;
  readonly size: unknown;
  readonly mtime_ns: unknown;
  readonly hash_algorithm: unknown;
  readonly sha256: unknown;
  readonly link_target: unknown;
}

interface SourceRow {
  readonly case_id: string;
  readonly source_id: string;
  readonly manifest_id: string;
  readonly source_kind: string;
  readonly source_path: string;
  readonly source_origin_path: string | null;
  readonly selection_policy: string;
  readonly manifest_schema: string;
  readonly manifest_path: string;
  readonly tier_2_included: number;
  readonly evidence_set_digest: string;
  readonly working_copy_path: string;
  readonly working_copy_path_kind: string;
  readonly working_copy_digest: string;
  readonly entry_count: number;
  readonly copied_entry_count: number;
  readonly profile_count: number;
  readonly unavailable_count: number;
  readonly unclassified_count: number;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA application_id = 0x46584A32;
    PRAGMA user_version = ${CASE_SCHEMA_VERSION};

    CREATE TABLE case_info (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      case_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      tool_version TEXT NOT NULL
    ) STRICT;

    CREATE TABLE ingest_inputs (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      case_id TEXT NOT NULL REFERENCES case_info(case_id),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('USER_DATA_DIR', 'PROFILE_DIR', 'FILESYSTEM_ROOT', 'IMAGE_CONTAINER', 'ACQUISITION_BUNDLE')),
      source_path TEXT NOT NULL,
      discovery_unavailable_paths_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE sources (
      source_id TEXT PRIMARY KEY,
      manifest_id TEXT NOT NULL UNIQUE,
      case_id TEXT NOT NULL REFERENCES case_info(case_id),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('USER_DATA_DIR', 'PROFILE_DIR', 'FILESYSTEM_ROOT', 'IMAGE_CONTAINER', 'ACQUISITION_BUNDLE')),
      source_path TEXT NOT NULL,
      source_origin_path TEXT,
      selection_policy TEXT NOT NULL CHECK (selection_policy = 'chrome-userdata/1'),
      manifest_schema TEXT NOT NULL CHECK (manifest_schema = 'forensix/manifest/1'),
      manifest_path TEXT NOT NULL UNIQUE,
      tier_2_included INTEGER NOT NULL CHECK (tier_2_included IN (0, 1)),
      evidence_set_digest TEXT NOT NULL,
      working_copy_path TEXT NOT NULL UNIQUE,
      working_copy_path_kind TEXT NOT NULL CHECK (working_copy_path_kind IN ('relative', 'absolute')),
      working_copy_digest TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      copied_entry_count INTEGER NOT NULL,
      profile_count INTEGER NOT NULL,
      unavailable_count INTEGER NOT NULL,
      unclassified_count INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE profiles (
      profile_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      path TEXT NOT NULL,
      UNIQUE (source_id, path)
    ) STRICT;

    CREATE TABLE source_evidence_gaps (
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state = 'unavailable'),
      reason TEXT NOT NULL CHECK (reason = 'outside_source'),
      PRIMARY KEY (source_id, path)
    ) STRICT;

    CREATE TABLE manifest_entries (
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      ordinal INTEGER NOT NULL,
      path TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('value', 'absent', 'unavailable')),
      unavailable_reason TEXT,
      node_type TEXT NOT NULL CHECK (node_type IN ('file', 'symlink', 'socket', 'dir', 'absent')),
      file_kind TEXT NOT NULL,
      selection_tier TEXT NOT NULL CHECK (selection_tier IN ('tier_1', 'tier_2', 'tier_3', 'unclassified')),
      copied INTEGER NOT NULL CHECK (copied IN (0, 1)),
      unclassified INTEGER NOT NULL CHECK (unclassified IN (0, 1)),
      size INTEGER,
      mtime_ns TEXT,
      hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha-256'),
      sha256 TEXT,
      link_target TEXT,
      PRIMARY KEY (source_id, ordinal),
      UNIQUE (source_id, path)
    ) STRICT;

    CREATE TABLE acquisition_manifests (
      source_id TEXT PRIMARY KEY REFERENCES sources(source_id),
      manifest_path TEXT NOT NULL,
      header_path TEXT NOT NULL,
      header_json TEXT NOT NULL,
      evidence_set_digest TEXT NOT NULL,
      working_copy_digest TEXT NOT NULL
    ) STRICT;

    CREATE TABLE acquisition_manifest_entries (
      source_id TEXT NOT NULL REFERENCES acquisition_manifests(source_id),
      ordinal INTEGER NOT NULL,
      path TEXT NOT NULL,
      state TEXT NOT NULL,
      unavailable_reason TEXT,
      node_type TEXT NOT NULL,
      file_kind TEXT NOT NULL,
      selection_tier TEXT NOT NULL,
      copied INTEGER NOT NULL CHECK (copied IN (0, 1)),
      unclassified INTEGER NOT NULL CHECK (unclassified IN (0, 1)),
      size INTEGER,
      mtime_ns TEXT,
      hash_algorithm TEXT NOT NULL,
      sha256 TEXT,
      link_target TEXT,
      PRIMARY KEY (source_id, ordinal),
      UNIQUE (source_id, path)
    ) STRICT;

    CREATE TABLE acquisition_bundle_verifications (
      bundle_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES case_info(case_id),
      status TEXT NOT NULL CHECK (status IN ('verified', 'verified_with_divergence', 'failed_to_open')),
      expected_bundle_digest TEXT NOT NULL,
      actual_bundle_digest TEXT NOT NULL,
      source_errors_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE acquisition_bundle_files (
      bundle_id TEXT NOT NULL REFERENCES acquisition_bundle_verifications(bundle_id),
      ordinal INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('bundle', 'source_manifest')),
      source_id TEXT REFERENCES sources(source_id),
      path TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('match', 'mismatch', 'missing_on_disk', 'missing_in_manifest')),
      expected_size INTEGER,
      actual_size INTEGER,
      expected_sha256 TEXT,
      actual_sha256 TEXT,
      PRIMARY KEY (bundle_id, ordinal)
    ) STRICT;
  `);
}

function insertEntry(
  statement: ReturnType<DatabaseSync["prepare"]>,
  sourceId: string,
  ordinal: number,
  entry: ManifestEntry,
): void {
  statement.run(
    sourceId,
    ordinal,
    entry.path,
    entry.state,
    entry.unavailable_reason,
    entry.node_type,
    entry.file_kind,
    entry.selection_tier,
    entry.copied ? 1 : 0,
    entry.unclassified ? 1 : 0,
    entry.size,
    entry.mtime_ns,
    entry.hash_algorithm,
    entry.sha256,
    entry.link_target,
  );
}

export function createCaseDatabase(options: CreateCaseDatabaseOptions): void {
  const databasePath = join(options.caseDirectory, CASE_FILENAME);
  const database = new DatabaseSync(databasePath);
  try {
    createSchema(database);
    database.exec("BEGIN IMMEDIATE;");
    try {
      database
        .prepare(
          `INSERT INTO case_info
            (singleton, case_id, schema_version, created_at, tool_version)
           VALUES (1, ?, ?, ?, ?)`,
        )
        .run(
          options.caseId,
          CASE_SCHEMA_VERSION,
          new Date().toISOString(),
          TOOL_VERSION,
        );
      database
        .prepare(
          `INSERT INTO ingest_inputs
            (singleton, case_id, source_kind, source_path, discovery_unavailable_paths_json)
           VALUES (1, ?, ?, ?, ?)`,
        )
        .run(
          options.caseId,
          options.inputSourceKind,
          options.inputSourcePath,
          JSON.stringify(options.discoveryUnavailablePaths),
        );

      const insertSource = database.prepare(`
        INSERT INTO sources
          (source_id, manifest_id, case_id, source_kind, source_path,
           source_origin_path, selection_policy, manifest_schema, manifest_path,
           tier_2_included, evidence_set_digest, working_copy_path,
           working_copy_path_kind, working_copy_digest, entry_count,
           copied_entry_count, profile_count, unavailable_count, unclassified_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertProfile = database.prepare(
        "INSERT INTO profiles (profile_id, source_id, path) VALUES (?, ?, ?)",
      );
      const insertGap = database.prepare(
        "INSERT INTO source_evidence_gaps (source_id, path, state, reason) VALUES (?, ?, ?, ?)",
      );
      const entrySql = `
        INSERT INTO manifest_entries
          (source_id, ordinal, path, state, unavailable_reason, node_type,
           file_kind, selection_tier, copied, unclassified, size, mtime_ns,
           hash_algorithm, sha256, link_target)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertManifestEntry = database.prepare(entrySql);
      const insertAcquisitionEntry = database.prepare(
        entrySql.replace("manifest_entries", "acquisition_manifest_entries"),
      );

      for (const source of options.sources) {
        const workingCopyPathKind = isAbsolute(source.workingCopyPath)
          ? "absolute"
          : "relative";
        insertSource.run(
          source.sourceId,
          source.manifestId,
          options.caseId,
          source.sourceKind,
          source.sourcePath,
          source.sourceOriginPath,
          source.header.selection_policy,
          source.header.manifest_schema,
          source.manifestPath,
          source.header.tier_2_included ? 1 : 0,
          source.header.evidence_set_digest,
          source.workingCopyPath,
          workingCopyPathKind,
          source.header.working_copy_digest,
          source.header.entry_count,
          source.header.copied_entry_count,
          source.header.profile_count,
          source.header.unavailable_count,
          source.header.unclassified_count,
        );
        for (const profile of source.profiles) {
          insertProfile.run(profile.profileId, source.sourceId, profile.path);
        }
        for (const gap of source.evidenceGaps) {
          insertGap.run(source.sourceId, gap.path, gap.state, gap.reason);
        }
        for (const [ordinal, entry] of source.entries.entries()) {
          insertEntry(insertManifestEntry, source.sourceId, ordinal, entry);
        }
        if (source.acquisitionManifest !== undefined) {
          database
            .prepare(
              `INSERT INTO acquisition_manifests
                (source_id, manifest_path, header_path, header_json,
                 evidence_set_digest, working_copy_digest)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              source.sourceId,
              source.acquisitionManifest.manifestPath,
              source.acquisitionManifest.headerPath,
              JSON.stringify(source.acquisitionManifest.header),
              source.acquisitionManifest.header.evidence_set_digest,
              source.acquisitionManifest.header.working_copy_digest,
            );
          for (const [
            ordinal,
            entry,
          ] of source.acquisitionManifest.entries.entries()) {
            insertEntry(
              insertAcquisitionEntry,
              source.sourceId,
              ordinal,
              entry,
            );
          }
        }
      }

      if (options.bundleVerification !== undefined) {
        const verification = options.bundleVerification;
        database
          .prepare(
            `INSERT INTO acquisition_bundle_verifications
              (bundle_id, case_id, status, expected_bundle_digest,
               actual_bundle_digest, source_errors_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            verification.bundleId,
            options.caseId,
            verification.status,
            verification.expectedBundleDigest,
            verification.actualBundleDigest,
            JSON.stringify(verification.sourceErrors),
          );
        const insertFile = database.prepare(`
          INSERT INTO acquisition_bundle_files
            (bundle_id, ordinal, scope, source_id, path, outcome,
             expected_size, actual_size, expected_sha256, actual_sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [ordinal, file] of verification.files.entries()) {
          insertFile.run(
            verification.bundleId,
            ordinal,
            file.scope,
            file.sourceId,
            file.path,
            file.outcome,
            file.expectedSize,
            file.actualSize,
            file.expectedSha256,
            file.actualSha256,
          );
        }
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    database.close();
  }
}

function openCaseDatabase(caseDirectory: string): {
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly resolvedCaseDirectory: string;
} {
  const resolvedCaseDirectory = resolve(caseDirectory);
  const databasePath = join(resolvedCaseDirectory, CASE_FILENAME);
  if (!existsSync(databasePath)) {
    throw new ForensixError(
      "CASE_NOT_FOUND",
      `Case file does not exist: ${databasePath}`,
      { case_directory: resolvedCaseDirectory },
    );
  }
  try {
    const databaseUrl = pathToFileURL(databasePath);
    databaseUrl.searchParams.set("immutable", "1");
    return {
      database: new DatabaseSync(databaseUrl.href),
      databasePath,
      resolvedCaseDirectory,
    };
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      `Case file cannot be opened: ${databasePath}`,
      { case_directory: resolvedCaseDirectory },
      { cause: error },
    );
  }
}

function decodeEntryRow(row: ManifestEntryRow): ManifestEntry {
  if (
    (row.copied !== 0 && row.copied !== 1) ||
    (row.unclassified !== 0 && row.unclassified !== 1)
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains an invalid Manifest boolean.",
      { path: row.path },
    );
  }
  return decodeManifestEntry({
    path: row.path,
    state: row.state,
    unavailable_reason: row.unavailable_reason,
    node_type: row.node_type,
    file_kind: row.file_kind,
    selection_tier: row.selection_tier,
    copied: row.copied === 1,
    unclassified: row.unclassified === 1,
    size: row.size,
    mtime_ns: row.mtime_ns,
    hash_algorithm: row.hash_algorithm,
    sha256: row.sha256,
    link_target: row.link_target,
  });
}

export function loadCaseSources(
  caseDirectory: string,
): readonly CaseSourceRecord[] {
  const { database, databasePath, resolvedCaseDirectory } =
    openCaseDatabase(caseDirectory);
  try {
    const sourceRows = database
      .prepare(
        `SELECT c.case_id, s.source_id, s.manifest_id, s.source_kind,
                s.source_path, s.source_origin_path, s.selection_policy,
                s.manifest_schema, s.manifest_path, s.tier_2_included,
                s.evidence_set_digest, s.working_copy_path,
                s.working_copy_path_kind, s.working_copy_digest,
                s.entry_count, s.copied_entry_count, s.profile_count,
                s.unavailable_count, s.unclassified_count
           FROM sources s
           JOIN case_info c ON c.case_id = s.case_id
          ORDER BY s.source_id`,
      )
      .all() as unknown as SourceRow[];
    if (sourceRows.length === 0) {
      throw new ForensixError("CASE_INVALID", "Case file contains no Source.", {
        case_directory: resolvedCaseDirectory,
      });
    }

    return sourceRows.map((source) => {
      if (
        !SOURCE_KINDS.includes(source.source_kind as SourceKind) ||
        source.selection_policy !== "chrome-userdata/1" ||
        source.manifest_schema !== "forensix/manifest/1" ||
        (source.working_copy_path_kind !== "relative" &&
          source.working_copy_path_kind !== "absolute") ||
        (source.tier_2_included !== 0 && source.tier_2_included !== 1)
      ) {
        throw new ForensixError(
          "CASE_INVALID",
          "Case Source contract is not supported.",
          { case_directory: resolvedCaseDirectory },
        );
      }
      const rows = database
        .prepare(
          `SELECT path, state, unavailable_reason, node_type, file_kind,
                  selection_tier, copied, unclassified, size, mtime_ns,
                  hash_algorithm, sha256, link_target
             FROM manifest_entries
            WHERE source_id = ?
            ORDER BY ordinal`,
        )
        .all(source.source_id) as unknown as ManifestEntryRow[];
      const entries = rows.map(decodeEntryRow);
      if (entries.length !== source.entry_count) {
        throw new ForensixError(
          "CASE_INVALID",
          "Case Manifest entry count does not match.",
          { expected: source.entry_count, actual: entries.length },
        );
      }
      const profiles = database
        .prepare(
          "SELECT profile_id, path FROM profiles WHERE source_id = ? ORDER BY path",
        )
        .all(source.source_id) as unknown as CaseProfileRecord[];
      if (profiles.length !== source.profile_count) {
        throw new ForensixError(
          "CASE_INVALID",
          "Case Profile count does not match.",
          { expected: source.profile_count, actual: profiles.length },
        );
      }
      const evidenceGaps = database
        .prepare(
          "SELECT path, state, reason FROM source_evidence_gaps WHERE source_id = ? ORDER BY path",
        )
        .all(source.source_id) as unknown as SourceEvidenceGap[];

      return {
        caseId: source.case_id,
        sourceId: source.source_id,
        manifestId: source.manifest_id,
        sourceKind: source.source_kind as SourceKind,
        sourcePath: source.source_path,
        sourceOriginPath: source.source_origin_path,
        selectionPolicy: "chrome-userdata/1",
        manifestSchema: "forensix/manifest/1",
        manifestPath: source.manifest_path,
        tier2Included: source.tier_2_included === 1,
        evidenceSetDigest: source.evidence_set_digest,
        workingCopyPath: source.working_copy_path,
        workingCopyPathKind: source.working_copy_path_kind as
          | "relative"
          | "absolute",
        workingCopyDigest: source.working_copy_digest,
        entryCount: source.entry_count,
        copiedEntryCount: source.copied_entry_count,
        profileCount: source.profile_count,
        unavailableCount: source.unavailable_count,
        unclassifiedCount: source.unclassified_count,
        entries,
        profiles,
        evidenceGaps,
      };
    });
  } catch (error) {
    if (error instanceof ForensixError) {
      throw error;
    }
    throw new ForensixError(
      "CASE_INVALID",
      `Case file cannot be read: ${databasePath}`,
      { case_directory: resolvedCaseDirectory },
      { cause: error },
    );
  } finally {
    database.close();
  }
}

export function loadCaseSource(caseDirectory: string): CaseSourceRecord {
  const source = loadCaseSources(caseDirectory)[0];
  if (source === undefined) {
    throw new ForensixError("CASE_INVALID", "Case file contains no Source.");
  }
  return source;
}

export function caseArtifactAbsolutePath(
  caseDirectory: string,
  artifactPath: string,
): string {
  if (isAbsolute(artifactPath)) {
    throw new ForensixError("CASE_INVALID", "Case artifact path is absolute.", {
      artifact_path: artifactPath,
    });
  }

  const resolvedCaseDirectory = resolve(caseDirectory);
  const resolvedArtifactPath = resolve(resolvedCaseDirectory, artifactPath);
  const difference = relative(resolvedCaseDirectory, resolvedArtifactPath);
  if (
    difference === "" ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case artifact path escapes the Case Directory.",
      { artifact_path: artifactPath },
    );
  }

  try {
    const physicalCaseDirectory = realpathSync(resolvedCaseDirectory);
    const physicalArtifactPath = realpathSync(resolvedArtifactPath);
    const physicalDifference = relative(
      physicalCaseDirectory,
      physicalArtifactPath,
    );
    if (
      physicalDifference === "" ||
      physicalDifference === ".." ||
      physicalDifference.startsWith(`..${sep}`) ||
      isAbsolute(physicalDifference)
    ) {
      throw new ForensixError(
        "CASE_INVALID",
        "Case artifact path escapes the Case Directory.",
        { artifact_path: artifactPath },
      );
    }
  } catch (error) {
    if (error instanceof ForensixError) {
      throw error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return resolvedArtifactPath;
    }
    throw new ForensixError(
      "CASE_INVALID",
      "Case artifact path cannot be resolved.",
      { artifact_path: artifactPath },
      { cause: error },
    );
  }
  return resolvedArtifactPath;
}

export function workingCopyAbsolutePath(
  caseDirectory: string,
  source: Pick<CaseSourceRecord, "workingCopyPath" | "workingCopyPathKind">,
): string {
  if (source.workingCopyPathKind === "absolute") {
    if (!isAbsolute(source.workingCopyPath)) {
      throw new ForensixError(
        "CASE_INVALID",
        "Absolute Working Copy path is not absolute.",
        { working_copy_path: source.workingCopyPath },
      );
    }
    return resolve(source.workingCopyPath);
  }
  if (isAbsolute(source.workingCopyPath)) {
    throw new ForensixError(
      "CASE_INVALID",
      "Relative Working Copy path is absolute.",
      { working_copy_path: source.workingCopyPath },
    );
  }

  const resolvedCaseDirectory = resolve(caseDirectory);
  const workingCopyPath = resolve(
    resolvedCaseDirectory,
    source.workingCopyPath,
  );
  const difference = relative(resolvedCaseDirectory, workingCopyPath);
  if (
    difference === "" ||
    difference === ".." ||
    difference.startsWith(`..${sep}`)
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Relative Working Copy path escapes the Case Directory.",
      { working_copy_path: source.workingCopyPath },
    );
  }
  let physicalCaseDirectory: string;
  let physicalWorkingCopyPath: string;
  try {
    physicalCaseDirectory = realpathSync(resolvedCaseDirectory);
    physicalWorkingCopyPath = realpathSync(workingCopyPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return workingCopyPath;
    }
    throw new ForensixError(
      "CASE_INVALID",
      "Relative Working Copy path cannot be resolved.",
      { working_copy_path: source.workingCopyPath },
      { cause: error },
    );
  }
  const physicalDifference = relative(
    physicalCaseDirectory,
    physicalWorkingCopyPath,
  );
  if (
    physicalDifference === "" ||
    physicalDifference === ".." ||
    physicalDifference.startsWith(`..${sep}`) ||
    isAbsolute(physicalDifference)
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Relative Working Copy path escapes the Case Directory.",
      { working_copy_path: source.workingCopyPath },
    );
  }
  return workingCopyPath;
}
