import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CASE_FILENAME, TOOL_VERSION } from "./case.js";
import type { Candidate, Finding } from "./forensic-model.js";

export type DeclaredOriginOs = "windows" | "macos" | "linux";

export interface PersistedFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortTime: string | null;
  readonly sortUrl: string | null;
  readonly sortDuration: bigint | null;
  readonly sortCount: bigint | null;
  readonly transitionCore: string | null;
}

export interface PersistedCandidate {
  readonly candidate: Candidate;
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly searchText: string;
}

export interface HistoryArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedFinding[];
  readonly candidates?: readonly PersistedCandidate[];
  readonly committedVisitCount: number;
  readonly recoveredVisitCount: number;
}

export interface StoreHistoryAnalysisOptions {
  readonly caseDirectory: string;
  readonly sourceIds: readonly string[];
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly invocation: readonly string[];
  readonly startedAt: string;
  readonly artifacts: readonly HistoryArtifactWrite[];
}

export interface StoredHistoryAnalysis {
  readonly runId: string;
  readonly finishedAt: string;
  readonly runStatus: "complete" | "partial";
}

export function initializeFindingSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS analysis_runs (
      run_id TEXT PRIMARY KEY,
      artifact TEXT NOT NULL CHECK (artifact = 'History'),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      tool_version TEXT NOT NULL,
      invocation_json TEXT NOT NULL,
      declared_timezone TEXT NOT NULL,
      declared_origin_os TEXT CHECK (
        declared_origin_os IS NULL OR
        declared_origin_os IN ('windows', 'macos', 'linux')
      ),
      status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS analysis_run_sources (
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      PRIMARY KEY (run_id, source_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS history_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'History'),
      manifest_entry_ordinal INTEGER,
      database_path TEXT NOT NULL,
      schema_version INTEGER,
      integrity TEXT,
      recovery_status TEXT NOT NULL CHECK (
        recovery_status IN ('complete', 'unavailable', 'not_applicable')
      ),
      status TEXT NOT NULL CHECK (status IN ('complete', 'absent', 'unavailable')),
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal),
      UNIQUE (run_id, source_id, profile_path, artifact)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS history_one_active_result
      ON history_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS forensic_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES history_artifact_results(artifact_result_id),
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL,
      manifest_entry_ordinal INTEGER NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type = 'finding'),
      finding_kind TEXT NOT NULL,
      profile_path TEXT NOT NULL,
      commit_state TEXT NOT NULL CHECK (
        commit_state IN ('committed', 'wal_resident', 'journal_resident')
      ),
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      sort_time TEXT,
      sort_url TEXT,
      sort_duration INTEGER,
      sort_count INTEGER,
      transition_core TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS forensic_findings_active_query
      ON forensic_findings(finding_kind, profile_path, commit_state, finding_id);
    CREATE INDEX IF NOT EXISTS forensic_findings_profile_query
      ON forensic_findings(finding_kind, profile_path, finding_id);
    CREATE INDEX IF NOT EXISTS forensic_findings_time_query
      ON forensic_findings(finding_kind, COALESCE(sort_time, ''), finding_id);
    CREATE INDEX IF NOT EXISTS forensic_findings_url_query
      ON forensic_findings(finding_kind, COALESCE(sort_url, ''), finding_id);
    CREATE INDEX IF NOT EXISTS forensic_findings_duration_query
      ON forensic_findings(finding_kind, COALESCE(sort_duration, -1), finding_id);
    CREATE INDEX IF NOT EXISTS forensic_findings_count_query
      ON forensic_findings(finding_kind, COALESCE(sort_count, -1), finding_id);

    CREATE TABLE IF NOT EXISTS forensic_candidates (
      candidate_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES history_artifact_results(artifact_result_id),
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      record_type TEXT NOT NULL CHECK (record_type = 'candidate'),
      candidate_kind TEXT NOT NULL,
      profile_path TEXT NOT NULL,
      commit_state TEXT NOT NULL CHECK (
        commit_state IN ('committed', 'wal_resident', 'journal_resident')
      ),
      rank INTEGER NOT NULL CHECK (rank > 0),
      supporting_count INTEGER NOT NULL CHECK (supporting_count > 0),
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL
    ) STRICT;
  `);
}

function insertFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedFinding,
): void {
  const finding = row.finding;
  statement.run(
    artifactResultId,
    runId,
    finding.provenance.sourceId,
    finding.provenance.manifestEntryOrdinal,
    finding.recordType,
    finding.findingKind,
    finding.profile,
    finding.commitState,
    JSON.stringify(finding.provenance),
    JSON.stringify(finding.fields),
    row.searchText,
    row.sortTime,
    row.sortUrl,
    row.sortDuration,
    row.sortCount,
    row.transitionCore,
  );
}

function insertCandidate(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedCandidate,
): void {
  const candidate = row.candidate;
  statement.run(
    artifactResultId,
    runId,
    candidate.recordType,
    candidate.candidateKind,
    row.profile,
    row.commitState,
    candidate.rank,
    candidate.count,
    JSON.stringify(candidate.provenance),
    JSON.stringify(candidate.fields),
    row.searchText,
  );
}

export function storeHistoryAnalysis(
  options: StoreHistoryAnalysisOptions,
): StoredHistoryAnalysis {
  const runId = randomUUID();
  const database = new DatabaseSync(
    join(resolve(options.caseDirectory), CASE_FILENAME),
    { readBigInts: true },
  );
  try {
    initializeFindingSchema(database);
    database.exec("BEGIN IMMEDIATE;");
    try {
      database
        .prepare(
          `INSERT INTO analysis_runs
             (run_id, artifact, started_at, tool_version, invocation_json,
              declared_timezone, declared_origin_os, status)
           VALUES (?, 'History', ?, ?, ?, ?, ?, 'running')`,
        )
        .run(
          runId,
          options.startedAt,
          TOOL_VERSION,
          JSON.stringify(options.invocation),
          options.declaredTimezone,
          options.declaredOriginOs,
        );
      const insertRunSource = database.prepare(
        "INSERT INTO analysis_run_sources (run_id, source_id) VALUES (?, ?)",
      );
      for (const sourceId of [...new Set(options.sourceIds)].sort()) {
        insertRunSource.run(runId, sourceId);
      }

      const insertArtifact = database.prepare(
        `INSERT INTO history_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'History', ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertFindingStatement = database.prepare(
        `INSERT INTO forensic_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_time, sort_url,
            sort_duration, sort_count, transition_core)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertCandidateStatement = database.prepare(
        `INSERT INTO forensic_candidates
           (artifact_result_id, run_id, record_type, candidate_kind,
            profile_path, commit_state, rank, supporting_count,
            provenance_json, fields_json, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePrevious = database.prepare(
        `UPDATE history_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'History'
            AND active = 1`,
      );
      const activateCurrent = database.prepare(
        "UPDATE history_artifact_results SET active = 1 WHERE artifact_result_id = ?",
      );

      for (const artifact of options.artifacts) {
        const insertion = insertArtifact.run(
          runId,
          artifact.sourceId,
          artifact.profile,
          artifact.manifestEntryOrdinal,
          artifact.databasePath,
          artifact.schemaVersion,
          artifact.integrity,
          artifact.recoveryStatus,
          artifact.status,
          artifact.reason,
        );
        const artifactResultId = insertion.lastInsertRowid as bigint;
        for (const finding of artifact.findings) {
          insertFinding(
            insertFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        for (const candidate of artifact.candidates ?? []) {
          insertCandidate(
            insertCandidateStatement,
            artifactResultId,
            runId,
            candidate,
          );
        }
        if (artifact.status === "complete") {
          deactivatePrevious.run(artifact.sourceId, artifact.profile);
          activateCurrent.run(artifactResultId);
        }
      }

      const runStatus = options.artifacts.some(
        (artifact) => artifact.status === "unavailable",
      )
        ? "partial"
        : "complete";
      const finishedAt = new Date().toISOString();
      database
        .prepare(
          "UPDATE analysis_runs SET finished_at = ?, status = ? WHERE run_id = ?",
        )
        .run(finishedAt, runStatus, runId);
      database.exec("COMMIT;");
      database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      return { runId, finishedAt, runStatus };
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    database.close();
  }
}
