import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CASE_FILENAME, TOOL_VERSION } from "./case.js";
import { openDatabaseSync } from "./sqlite-open.js";
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

export interface PersistedLoginFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortCreated: string | null;
  readonly sortLastUsed: string | null;
  readonly sortOrigin: string | null;
  readonly sortUsername: string | null;
}

export interface LoginDataArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedLoginFinding[];
  readonly committedCredentialCount: number;
  readonly recoveredCredentialCount: number;
}

export interface PersistedAutofillFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortCreated: string | null;
  readonly sortLastUsed: string | null;
  readonly sortName: string | null;
  readonly sortValue: string | null;
}

export interface WebDataArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedAutofillFinding[];
  readonly committedFieldCount: number;
  readonly recoveredFieldCount: number;
}

export interface PersistedCookieFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortHost: string | null;
  readonly sortName: string | null;
  readonly sortCreation: string | null;
  readonly sortExpires: string | null;
  readonly sortLastAccess: string | null;
  readonly hostKey: string | null;
  readonly sameSite: string | null;
}

export interface CookieArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedCookieFinding[];
  readonly committedCookieCount: number;
  readonly recoveredCookieCount: number;
}

export interface PersistedTopSiteFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortUrl: string | null;
  readonly sortTitle: string | null;
  readonly sortRank: bigint | null;
}

export interface TopSitesArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedTopSiteFinding[];
  readonly committedTopSiteCount: number;
  readonly recoveredTopSiteCount: number;
}

export interface PersistedMetadataFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortType: string;
  readonly sortProfile: string;
}

export interface MetadataArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  /**
   * The evidence file backing this metadata scope. `Local State` is
   * browser-level, `Preferences` is Profile-level. It keeps the two scopes
   * distinct in storage even when a single-Profile Source reports both under
   * the `.` Profile path.
   */
  readonly artifact: "Local State" | "Preferences";
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly reason: string | null;
  readonly findings: readonly PersistedMetadataFinding[];
}

export interface StoreHistoryAnalysisOptions {
  readonly caseDirectory: string;
  readonly sourceIds: readonly string[];
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly invocation: readonly string[];
  readonly startedAt: string;
  readonly artifacts: readonly HistoryArtifactWrite[];
  readonly cookieArtifacts?: readonly CookieArtifactWrite[];
  readonly loginDataArtifacts?: readonly LoginDataArtifactWrite[];
  readonly topSitesArtifacts?: readonly TopSitesArtifactWrite[];
  readonly webDataArtifacts?: readonly WebDataArtifactWrite[];
  readonly metadataArtifacts?: readonly MetadataArtifactWrite[];
}

export type AnalysisRunExitState = "complete" | "partial" | "failed";

export interface StoredHistoryAnalysis {
  readonly runId: string;
  readonly finishedAt: string;
  readonly runStatus: AnalysisRunExitState;
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
      status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed'))
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

    CREATE TABLE IF NOT EXISTS login_data_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Login Data'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS login_data_one_active_result
      ON login_data_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS login_data_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES login_data_artifact_results(artifact_result_id),
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
      sort_created TEXT,
      sort_last_used TEXT,
      sort_origin TEXT,
      sort_username TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS login_data_findings_created_query
      ON login_data_findings(finding_kind, COALESCE(sort_created, ''), finding_id);
    CREATE INDEX IF NOT EXISTS login_data_findings_last_used_query
      ON login_data_findings(finding_kind, COALESCE(sort_last_used, ''), finding_id);
    CREATE INDEX IF NOT EXISTS login_data_findings_origin_query
      ON login_data_findings(finding_kind, COALESCE(sort_origin, ''), finding_id);
    CREATE INDEX IF NOT EXISTS login_data_findings_username_query
      ON login_data_findings(finding_kind, COALESCE(sort_username, ''), finding_id);
    CREATE INDEX IF NOT EXISTS login_data_findings_profile_query
      ON login_data_findings(finding_kind, profile_path, finding_id);

    CREATE TABLE IF NOT EXISTS web_data_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Web Data'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS web_data_one_active_result
      ON web_data_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS web_data_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES web_data_artifact_results(artifact_result_id),
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
      sort_created TEXT,
      sort_last_used TEXT,
      sort_name TEXT,
      sort_value TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS web_data_findings_created_query
      ON web_data_findings(finding_kind, COALESCE(sort_created, ''), finding_id);
    CREATE INDEX IF NOT EXISTS web_data_findings_last_used_query
      ON web_data_findings(finding_kind, COALESCE(sort_last_used, ''), finding_id);
    CREATE INDEX IF NOT EXISTS web_data_findings_name_query
      ON web_data_findings(finding_kind, COALESCE(sort_name, ''), finding_id);
    CREATE INDEX IF NOT EXISTS web_data_findings_value_query
      ON web_data_findings(finding_kind, COALESCE(sort_value, ''), finding_id);
    CREATE INDEX IF NOT EXISTS web_data_findings_profile_query
      ON web_data_findings(finding_kind, profile_path, finding_id);

    CREATE TABLE IF NOT EXISTS cookie_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Cookies'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS cookie_one_active_result
      ON cookie_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS cookie_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES cookie_artifact_results(artifact_result_id),
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
      sort_host TEXT,
      sort_name TEXT,
      sort_creation TEXT,
      sort_expires TEXT,
      sort_last_access TEXT,
      host_key TEXT,
      same_site TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS cookie_findings_host_query
      ON cookie_findings(finding_kind, COALESCE(sort_host, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cookie_findings_name_query
      ON cookie_findings(finding_kind, COALESCE(sort_name, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cookie_findings_creation_query
      ON cookie_findings(finding_kind, COALESCE(sort_creation, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cookie_findings_expires_query
      ON cookie_findings(finding_kind, COALESCE(sort_expires, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cookie_findings_last_access_query
      ON cookie_findings(finding_kind, COALESCE(sort_last_access, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cookie_findings_profile_query
      ON cookie_findings(finding_kind, profile_path, commit_state, finding_id);

    CREATE TABLE IF NOT EXISTS top_sites_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Top Sites'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS top_sites_one_active_result
      ON top_sites_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS top_sites_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES top_sites_artifact_results(artifact_result_id),
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
      sort_url TEXT,
      sort_title TEXT,
      sort_rank INTEGER,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS top_sites_findings_rank_query
      ON top_sites_findings(finding_kind, COALESCE(sort_rank, -1), finding_id);
    CREATE INDEX IF NOT EXISTS top_sites_findings_url_query
      ON top_sites_findings(finding_kind, COALESCE(sort_url, ''), finding_id);
    CREATE INDEX IF NOT EXISTS top_sites_findings_title_query
      ON top_sites_findings(finding_kind, COALESCE(sort_title, ''), finding_id);
    CREATE INDEX IF NOT EXISTS top_sites_findings_profile_query
      ON top_sites_findings(finding_kind, profile_path, commit_state, finding_id);

    CREATE TABLE IF NOT EXISTS preferences_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact IN ('Local State', 'Preferences')),
      manifest_entry_ordinal INTEGER,
      database_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('complete', 'absent', 'unavailable')),
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal),
      UNIQUE (run_id, source_id, profile_path, artifact)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS preferences_one_active_result
      ON preferences_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS preferences_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES preferences_artifact_results(artifact_result_id),
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
      sort_type TEXT NOT NULL,
      sort_profile TEXT NOT NULL,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS preferences_findings_type_query
      ON preferences_findings(finding_kind, sort_type, finding_id);
    CREATE INDEX IF NOT EXISTS preferences_findings_profile_query
      ON preferences_findings(finding_kind, sort_profile, finding_id);
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

function insertLoginFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedLoginFinding,
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
    row.sortCreated,
    row.sortLastUsed,
    row.sortOrigin,
    row.sortUsername,
  );
}

function insertAutofillFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedAutofillFinding,
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
    row.sortCreated,
    row.sortLastUsed,
    row.sortName,
    row.sortValue,
  );
}

function insertCookieFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedCookieFinding,
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
    row.sortHost,
    row.sortName,
    row.sortCreation,
    row.sortExpires,
    row.sortLastAccess,
    row.hostKey,
    row.sameSite,
  );
}

function insertTopSiteFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedTopSiteFinding,
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
    row.sortUrl,
    row.sortTitle,
    row.sortRank,
  );
}

function insertMetadataFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedMetadataFinding,
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
    row.sortType,
    row.sortProfile,
  );
}

export function storeHistoryAnalysis(
  options: StoreHistoryAnalysisOptions,
): StoredHistoryAnalysis {
  const cookieArtifacts = options.cookieArtifacts ?? [];
  const metadataArtifacts = options.metadataArtifacts ?? [];
  const runId = randomUUID();
  const database = openDatabaseSync(
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
      const insertLoginArtifact = database.prepare(
        `INSERT INTO login_data_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Login Data', ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertLoginFindingStatement = database.prepare(
        `INSERT INTO login_data_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_created,
            sort_last_used, sort_origin, sort_username)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePreviousLogin = database.prepare(
        `UPDATE login_data_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Login Data'
            AND active = 1`,
      );
      const activateCurrentLogin = database.prepare(
        "UPDATE login_data_artifact_results SET active = 1 WHERE artifact_result_id = ?",
      );
      const insertWebDataArtifact = database.prepare(
        `INSERT INTO web_data_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Web Data', ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertWebDataFindingStatement = database.prepare(
        `INSERT INTO web_data_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_created,
            sort_last_used, sort_name, sort_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePreviousWebData = database.prepare(
        `UPDATE web_data_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Web Data'
            AND active = 1`,
      );
      const activateCurrentWebData = database.prepare(
        "UPDATE web_data_artifact_results SET active = 1 WHERE artifact_result_id = ?",
      );
      const insertCookieArtifact = database.prepare(
        `INSERT INTO cookie_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Cookies', ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertCookieFindingStatement = database.prepare(
        `INSERT INTO cookie_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_host, sort_name,
            sort_creation, sort_expires, sort_last_access, host_key, same_site)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePreviousCookie = database.prepare(
        `UPDATE cookie_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Cookies'
            AND active = 1`,
      );
      const activateCurrentCookie = database.prepare(
        "UPDATE cookie_artifact_results SET active = 1 WHERE artifact_result_id = ?",
      );
      const insertTopSiteArtifact = database.prepare(
        `INSERT INTO top_sites_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Top Sites', ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertTopSiteFindingStatement = database.prepare(
        `INSERT INTO top_sites_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_url, sort_title,
            sort_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePreviousTopSite = database.prepare(
        `UPDATE top_sites_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Top Sites'
            AND active = 1`,
      );
      const activateCurrentTopSite = database.prepare(
        "UPDATE top_sites_artifact_results SET active = 1 WHERE artifact_result_id = ?",
      );
      const insertMetadataArtifact = database.prepare(
        `INSERT INTO preferences_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, status, reason, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      const insertMetadataFindingStatement = database.prepare(
        `INSERT INTO preferences_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_type, sort_profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const deactivatePreviousMetadata = database.prepare(
        `UPDATE preferences_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = ?
            AND active = 1`,
      );
      const activateCurrentMetadata = database.prepare(
        "UPDATE preferences_artifact_results SET active = 1 WHERE artifact_result_id = ?",
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

      for (const artifact of cookieArtifacts) {
        const insertion = insertCookieArtifact.run(
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
          insertCookieFinding(
            insertCookieFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        if (artifact.status === "complete") {
          deactivatePreviousCookie.run(artifact.sourceId, artifact.profile);
          activateCurrentCookie.run(artifactResultId);
        }
      }

      for (const artifact of options.topSitesArtifacts ?? []) {
        const insertion = insertTopSiteArtifact.run(
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
          insertTopSiteFinding(
            insertTopSiteFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        if (artifact.status === "complete") {
          deactivatePreviousTopSite.run(artifact.sourceId, artifact.profile);
          activateCurrentTopSite.run(artifactResultId);
        }
      }

      for (const artifact of options.loginDataArtifacts ?? []) {
        const insertion = insertLoginArtifact.run(
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
          insertLoginFinding(
            insertLoginFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        if (artifact.status === "complete") {
          deactivatePreviousLogin.run(artifact.sourceId, artifact.profile);
          activateCurrentLogin.run(artifactResultId);
        }
      }

      for (const artifact of options.webDataArtifacts ?? []) {
        const insertion = insertWebDataArtifact.run(
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
          insertAutofillFinding(
            insertWebDataFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        if (artifact.status === "complete") {
          deactivatePreviousWebData.run(artifact.sourceId, artifact.profile);
          activateCurrentWebData.run(artifactResultId);
        }
      }

      for (const artifact of metadataArtifacts) {
        const insertion = insertMetadataArtifact.run(
          runId,
          artifact.sourceId,
          artifact.profile,
          artifact.artifact,
          artifact.manifestEntryOrdinal,
          artifact.databasePath,
          artifact.status,
          artifact.reason,
        );
        const artifactResultId = insertion.lastInsertRowid as bigint;
        for (const finding of artifact.findings) {
          insertMetadataFinding(
            insertMetadataFindingStatement,
            artifactResultId,
            runId,
            finding,
          );
        }
        if (artifact.status === "complete") {
          deactivatePreviousMetadata.run(
            artifact.sourceId,
            artifact.profile,
            artifact.artifact,
          );
          activateCurrentMetadata.run(artifactResultId);
        }
      }

      // Metadata artifacts are recorded and queryable but deliberately excluded
      // from the Analysis Run exit-state aggregation: `Local State` and
      // `Preferences` are contextual scaffolding, and their presence must not
      // change the History/Cookies/Login exit-code semantics an operator relies
      // on. Metadata health is surfaced separately in the analyse summary.
      const combinedArtifacts = [
        ...options.artifacts,
        ...cookieArtifacts,
        ...(options.loginDataArtifacts ?? []),
        ...(options.topSitesArtifacts ?? []),
        ...(options.webDataArtifacts ?? []),
      ];
      const unavailableCount = combinedArtifacts.filter(
        (artifact) => artifact.status === "unavailable",
      ).length;
      const completeCount = combinedArtifacts.filter(
        (artifact) => artifact.status === "complete",
      ).length;
      const runStatus: AnalysisRunExitState =
        unavailableCount === 0
          ? "complete"
          : completeCount === 0
            ? "failed"
            : "partial";
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
