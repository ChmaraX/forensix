import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { ForensixError } from "./errors.js";
import {
  assertManifestEntry,
  canonicalManifestLine,
  type ManifestEntry,
  type ManifestHeader,
} from "./manifest.js";

export const CASE_SCHEMA_VERSION = 1;
export const CASE_FILENAME = "case.fxdb";
export const TOOL_VERSION = "2.0.0-alpha.1";

export interface CreateCaseDatabaseOptions {
  readonly caseDirectory: string;
  readonly sourcePath: string;
  readonly workingCopyPath: string;
  readonly manifestPath: string;
  readonly header: ManifestHeader;
  readonly entries: readonly ManifestEntry[];
  readonly profiles: readonly string[];
}

export interface CaseSourceRecord {
  readonly caseId: string;
  readonly sourceId: string;
  readonly sourceKind: "USER_DATA_DIR";
  readonly sourcePath: string;
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
}

interface SourceRow {
  readonly case_id: string;
  readonly source_id: string;
  readonly source_kind: string;
  readonly source_path: string;
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

export function createCaseDatabase(options: CreateCaseDatabaseOptions): {
  readonly caseId: string;
  readonly sourceId: string;
} {
  const caseId = randomUUID();
  const sourceId = randomUUID();
  const databasePath = join(options.caseDirectory, CASE_FILENAME);
  const database = new DatabaseSync(databasePath);

  try {
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

      CREATE TABLE sources (
        source_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES case_info(case_id),
        source_kind TEXT NOT NULL CHECK (source_kind = 'USER_DATA_DIR'),
        source_path TEXT NOT NULL,
        selection_policy TEXT NOT NULL CHECK (selection_policy = 'chrome-userdata/1'),
        manifest_schema TEXT NOT NULL CHECK (manifest_schema = 'forensix/manifest/1'),
        manifest_path TEXT NOT NULL,
        tier_2_included INTEGER NOT NULL CHECK (tier_2_included IN (0, 1)),
        evidence_set_digest TEXT NOT NULL,
        working_copy_path TEXT NOT NULL,
        working_copy_path_kind TEXT NOT NULL CHECK (working_copy_path_kind IN ('relative', 'absolute')),
        working_copy_digest TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        copied_entry_count INTEGER NOT NULL,
        profile_count INTEGER NOT NULL,
        unavailable_count INTEGER NOT NULL,
        unclassified_count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE profiles (
        source_id TEXT NOT NULL REFERENCES sources(source_id),
        path TEXT NOT NULL,
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
        canonical_json TEXT NOT NULL,
        PRIMARY KEY (source_id, ordinal),
        UNIQUE (source_id, path)
      ) STRICT;
    `);

    const workingCopyPathKind = isAbsolute(options.workingCopyPath)
      ? "absolute"
      : "relative";
    database.exec("BEGIN IMMEDIATE;");
    try {
      database
        .prepare(
          `INSERT INTO case_info
            (singleton, case_id, schema_version, created_at, tool_version)
           VALUES (1, ?, ?, ?, ?)`,
        )
        .run(
          caseId,
          CASE_SCHEMA_VERSION,
          new Date().toISOString(),
          TOOL_VERSION,
        );
      database
        .prepare(
          `INSERT INTO sources
            (source_id, case_id, source_kind, source_path, selection_policy,
             manifest_schema, manifest_path, tier_2_included, evidence_set_digest,
             working_copy_path, working_copy_path_kind, working_copy_digest, entry_count,
             copied_entry_count, profile_count, unavailable_count, unclassified_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceId,
          caseId,
          options.header.source_kind,
          options.sourcePath,
          options.header.selection_policy,
          options.header.manifest_schema,
          options.manifestPath,
          options.header.tier_2_included ? 1 : 0,
          options.header.evidence_set_digest,
          options.workingCopyPath,
          workingCopyPathKind,
          options.header.working_copy_digest,
          options.header.entry_count,
          options.header.copied_entry_count,
          options.header.profile_count,
          options.header.unavailable_count,
          options.header.unclassified_count,
        );

      const insertProfile = database.prepare(
        "INSERT INTO profiles (source_id, path) VALUES (?, ?)",
      );
      for (const profile of options.profiles) {
        insertProfile.run(sourceId, profile);
      }

      const insertEntry = database.prepare(`
        INSERT INTO manifest_entries
          (source_id, ordinal, path, state, unavailable_reason, node_type,
           file_kind, selection_tier, copied, unclassified, size, mtime_ns,
           hash_algorithm, sha256, link_target, canonical_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [ordinal, entry] of options.entries.entries()) {
        insertEntry.run(
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
          canonicalManifestLine(entry),
        );
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }

    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    return { caseId, sourceId };
  } finally {
    database.close();
  }
}

export function loadCaseSource(caseDirectory: string): CaseSourceRecord {
  const resolvedCaseDirectory = resolve(caseDirectory);
  const databasePath = join(resolvedCaseDirectory, CASE_FILENAME);
  if (!existsSync(databasePath)) {
    throw new ForensixError(
      "CASE_NOT_FOUND",
      `Case file does not exist: ${databasePath}`,
      {
        case_directory: resolvedCaseDirectory,
      },
    );
  }

  let database: DatabaseSync;
  try {
    const databaseUrl = pathToFileURL(databasePath);
    databaseUrl.searchParams.set("immutable", "1");
    database = new DatabaseSync(databaseUrl.href);
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      `Case file cannot be opened: ${databasePath}`,
      { case_directory: resolvedCaseDirectory },
      { cause: error },
    );
  }

  try {
    const source = database
      .prepare(
        `SELECT c.case_id, s.source_id, s.source_kind, s.source_path,
                s.selection_policy, s.manifest_schema, s.manifest_path,
                s.tier_2_included, s.evidence_set_digest, s.working_copy_path,
                s.working_copy_path_kind, s.working_copy_digest,
                s.entry_count, s.copied_entry_count, s.profile_count,
                s.unavailable_count, s.unclassified_count
           FROM sources s
           JOIN case_info c ON c.case_id = s.case_id
          ORDER BY s.source_id
          LIMIT 1`,
      )
      .get() as SourceRow | undefined;
    if (source === undefined) {
      throw new ForensixError("CASE_INVALID", "Case file contains no Source.", {
        case_directory: resolvedCaseDirectory,
      });
    }
    if (
      source.source_kind !== "USER_DATA_DIR" ||
      source.selection_policy !== "chrome-userdata/1" ||
      source.manifest_schema !== "forensix/manifest/1" ||
      (source.working_copy_path_kind !== "relative" &&
        source.working_copy_path_kind !== "absolute")
    ) {
      throw new ForensixError(
        "CASE_INVALID",
        "Case Source contract is not supported.",
        {
          case_directory: resolvedCaseDirectory,
        },
      );
    }

    const rows = database
      .prepare(
        `SELECT canonical_json
           FROM manifest_entries
          WHERE source_id = ?
          ORDER BY ordinal`,
      )
      .all(source.source_id) as { readonly canonical_json: string }[];
    const entries = rows.map((row) => {
      const entry = JSON.parse(row.canonical_json) as ManifestEntry;
      assertManifestEntry(entry);
      if (canonicalManifestLine(entry) !== row.canonical_json) {
        throw new ForensixError(
          "CASE_INVALID",
          "Case contains a non-canonical Manifest line.",
          {
            path: entry.path,
          },
        );
      }
      return entry;
    });
    if (entries.length !== source.entry_count) {
      throw new ForensixError(
        "CASE_INVALID",
        "Case Manifest entry count does not match.",
        {
          expected: source.entry_count,
          actual: entries.length,
        },
      );
    }

    return {
      caseId: source.case_id,
      sourceId: source.source_id,
      sourceKind: "USER_DATA_DIR",
      sourcePath: source.source_path,
      selectionPolicy: "chrome-userdata/1",
      manifestSchema: "forensix/manifest/1",
      manifestPath: source.manifest_path,
      tier2Included: source.tier_2_included === 1,
      evidenceSetDigest: source.evidence_set_digest,
      workingCopyPath: source.working_copy_path,
      workingCopyPathKind: source.working_copy_path_kind,
      workingCopyDigest: source.working_copy_digest,
      entryCount: source.entry_count,
      copiedEntryCount: source.copied_entry_count,
      profileCount: source.profile_count,
      unavailableCount: source.unavailable_count,
      unclassifiedCount: source.unclassified_count,
      entries,
    };
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

export function workingCopyAbsolutePath(
  caseDirectory: string,
  source: Pick<CaseSourceRecord, "workingCopyPath" | "workingCopyPathKind">,
): string {
  return source.workingCopyPathKind === "absolute"
    ? source.workingCopyPath
    : resolve(caseDirectory, source.workingCopyPath);
}
