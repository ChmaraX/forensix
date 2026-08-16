import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CASE_FILENAME, TOOL_VERSION } from "./case.js";
import { openDatabaseSync } from "./sqlite-open.js";
import type {
  Candidate,
  CandidateCategory,
  Finding,
} from "./forensic-model.js";

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

/**
 * A ranked identity/behavior Candidate. Unlike the History-scoped
 * `PersistedCandidate` above, these are derived across Web Data, Preferences,
 * and History Findings and carry a category plus a normalized sort key. They
 * are never Findings and never carry a Commit State: they summarize committed
 * evidence, ranked and hedged.
 */
export interface PersistedIdentityCandidate {
  readonly candidate: Candidate;
  readonly category: CandidateCategory;
  readonly profile: string;
  readonly searchText: string;
  readonly sortValue: string;
}

export interface CandidateArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly reason: string | null;
  readonly candidates: readonly PersistedIdentityCandidate[];
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

export interface PersistedDownloadFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortStart: string | null;
  readonly sortEnd: string | null;
  readonly sortTargetPath: string | null;
  readonly sortState: string | null;
  readonly sortTotalBytes: bigint | null;
  readonly dangerType: string | null;
}

export interface DownloadsArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedDownloadFinding[];
  readonly committedDownloadCount: number;
  readonly recoveredDownloadCount: number;
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

export interface PersistedFaviconFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sortIconUrl: string | null;
  readonly sortPageUrl: string | null;
  readonly sortLastUpdated: string | null;
  readonly sortWidth: bigint | null;
}

export interface FaviconArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly reason: string | null;
  readonly findings: readonly PersistedFaviconFinding[];
  readonly committedFaviconCount: number;
  readonly recoveredFaviconCount: number;
  readonly payloadFileCount: number;
}

export interface PersistedCacheFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly backend: string;
  readonly sortKey: string | null;
  readonly sortLastUsed: string | null;
  readonly sortSizeBytes: bigint | null;
  readonly sortEntryHash: string;
}

export interface PersistedCacheCandidate {
  readonly candidate: Candidate;
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly backend: string;
  readonly candidateKind: string;
  readonly searchText: string;
  readonly sortKey: string | null;
  readonly sortLastUsed: string | null;
}

export interface CacheArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  /** The cache data directory, e.g. `Default/Cache/Cache_Data`. */
  readonly databasePath: string;
  /** The detected backend, or null when the cache was absent/uncollected. */
  readonly backend: string | null;
  readonly reason: string | null;
  readonly findings: readonly PersistedCacheFinding[];
  readonly candidates: readonly PersistedCacheCandidate[];
  readonly candidateCount: number;
  readonly payloadFileCount: number;
}

export type BookmarkSourceFile = "Bookmarks" | "Bookmarks.bak";

export interface PersistedBookmarkFinding {
  readonly finding: Finding;
  readonly searchText: string;
  readonly sourceFile: BookmarkSourceFile;
  readonly sortName: string | null;
  readonly sortUrl: string | null;
  readonly sortDateAdded: bigint | null;
  readonly sortFolder: string | null;
}

export interface BookmarksArtifactWrite {
  readonly sourceId: string;
  readonly profile: string;
  /**
   * The Bookmarks evidence file backing this record. Chrome keeps a primary
   * `Bookmarks` document and a `Bookmarks.bak` snapshot of the previous state;
   * storing the filename here keeps the two scopes distinct so the primary and
   * backup records are never silently merged.
   */
  readonly artifact: BookmarkSourceFile;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly reason: string | null;
  readonly findings: readonly PersistedBookmarkFinding[];
  readonly bookmarkCount: number;
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
  readonly faviconArtifacts?: readonly FaviconArtifactWrite[];
  readonly downloadsArtifacts?: readonly DownloadsArtifactWrite[];
  readonly metadataArtifacts?: readonly MetadataArtifactWrite[];
  readonly bookmarksArtifacts?: readonly BookmarksArtifactWrite[];
  readonly cacheArtifacts?: readonly CacheArtifactWrite[];
  readonly candidateArtifacts?: readonly CandidateArtifactWrite[];
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
      -- topic-specific projection of fields.topicLabel, kept as a column so the
      -- Candidate query can filter and sort by label without parsing JSON.
      topic_label TEXT,
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS forensic_candidates_rank_query
      ON forensic_candidates(candidate_kind, rank, candidate_id);
    CREATE INDEX IF NOT EXISTS forensic_candidates_supporting_query
      ON forensic_candidates(candidate_kind, supporting_count, candidate_id);
    CREATE INDEX IF NOT EXISTS forensic_candidates_label_query
      ON forensic_candidates(candidate_kind, COALESCE(topic_label, ''), candidate_id);
    CREATE INDEX IF NOT EXISTS forensic_candidates_profile_query
      ON forensic_candidates(candidate_kind, profile_path, commit_state, candidate_id);

    CREATE TABLE IF NOT EXISTS candidate_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Candidates'),
      database_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('complete', 'absent', 'unavailable')),
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      UNIQUE (run_id, source_id, profile_path, artifact)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS candidate_one_active_result
      ON candidate_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS identity_candidates (
      candidate_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES candidate_artifact_results(artifact_result_id),
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      record_type TEXT NOT NULL CHECK (record_type = 'candidate'),
      candidate_kind TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('identity', 'behavior')),
      profile_path TEXT NOT NULL,
      rank INTEGER NOT NULL CHECK (rank > 0),
      supporting_count INTEGER NOT NULL CHECK (supporting_count > 0),
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      sort_value TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS identity_candidates_query
      ON identity_candidates(candidate_kind, rank, candidate_id);

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

    CREATE TABLE IF NOT EXISTS downloads_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Downloads'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS downloads_one_active_result
      ON downloads_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS downloads_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES downloads_artifact_results(artifact_result_id),
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
      sort_start TEXT,
      sort_end TEXT,
      sort_target TEXT,
      sort_state TEXT,
      sort_bytes INTEGER,
      danger_type TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS downloads_findings_start_query
      ON downloads_findings(finding_kind, COALESCE(sort_start, ''), finding_id);
    CREATE INDEX IF NOT EXISTS downloads_findings_end_query
      ON downloads_findings(finding_kind, COALESCE(sort_end, ''), finding_id);
    CREATE INDEX IF NOT EXISTS downloads_findings_target_query
      ON downloads_findings(finding_kind, COALESCE(sort_target, ''), finding_id);
    CREATE INDEX IF NOT EXISTS downloads_findings_state_query
      ON downloads_findings(finding_kind, COALESCE(sort_state, ''), finding_id);
    CREATE INDEX IF NOT EXISTS downloads_findings_bytes_query
      ON downloads_findings(finding_kind, COALESCE(sort_bytes, -1), finding_id);
    CREATE INDEX IF NOT EXISTS downloads_findings_profile_query
      ON downloads_findings(finding_kind, profile_path, commit_state, finding_id);

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

    CREATE TABLE IF NOT EXISTS favicon_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Favicons'),
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

    CREATE UNIQUE INDEX IF NOT EXISTS favicon_one_active_result
      ON favicon_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS favicon_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES favicon_artifact_results(artifact_result_id),
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
      sort_icon_url TEXT,
      sort_page_url TEXT,
      sort_last_updated TEXT,
      sort_width INTEGER,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS favicon_findings_icon_url_query
      ON favicon_findings(finding_kind, COALESCE(sort_icon_url, ''), finding_id);
    CREATE INDEX IF NOT EXISTS favicon_findings_page_url_query
      ON favicon_findings(finding_kind, COALESCE(sort_page_url, ''), finding_id);
    CREATE INDEX IF NOT EXISTS favicon_findings_last_updated_query
      ON favicon_findings(finding_kind, COALESCE(sort_last_updated, ''), finding_id);
    CREATE INDEX IF NOT EXISTS favicon_findings_width_query
      ON favicon_findings(finding_kind, COALESCE(sort_width, -1), finding_id);
    CREATE INDEX IF NOT EXISTS favicon_findings_profile_query
      ON favicon_findings(finding_kind, profile_path, commit_state, finding_id);

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

    CREATE TABLE IF NOT EXISTS bookmarks_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact IN ('Bookmarks', 'Bookmarks.bak')),
      manifest_entry_ordinal INTEGER,
      database_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('complete', 'absent', 'unavailable')),
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal),
      UNIQUE (run_id, source_id, profile_path, artifact)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_one_active_result
      ON bookmarks_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS bookmarks_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES bookmarks_artifact_results(artifact_result_id),
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
      source_file TEXT NOT NULL CHECK (source_file IN ('Bookmarks', 'Bookmarks.bak')),
      sort_name TEXT,
      sort_url TEXT,
      sort_date_added INTEGER,
      sort_folder TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS bookmarks_findings_name_query
      ON bookmarks_findings(finding_kind, COALESCE(sort_name, ''), finding_id);
    CREATE INDEX IF NOT EXISTS bookmarks_findings_url_query
      ON bookmarks_findings(finding_kind, COALESCE(sort_url, ''), finding_id);
    CREATE INDEX IF NOT EXISTS bookmarks_findings_date_added_query
      ON bookmarks_findings(finding_kind, COALESCE(sort_date_added, -1), finding_id);
    CREATE INDEX IF NOT EXISTS bookmarks_findings_folder_query
      ON bookmarks_findings(finding_kind, COALESCE(sort_folder, ''), finding_id);
    CREATE INDEX IF NOT EXISTS bookmarks_findings_profile_query
      ON bookmarks_findings(finding_kind, source_file, profile_path, finding_id);

    CREATE TABLE IF NOT EXISTS cache_artifact_results (
      artifact_result_id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL REFERENCES sources(source_id),
      profile_path TEXT NOT NULL,
      artifact TEXT NOT NULL CHECK (artifact = 'Cache'),
      manifest_entry_ordinal INTEGER,
      database_path TEXT NOT NULL,
      backend TEXT,
      status TEXT NOT NULL CHECK (status IN ('complete', 'absent', 'unavailable')),
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal),
      UNIQUE (run_id, source_id, profile_path, artifact)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS cache_one_active_result
      ON cache_artifact_results(source_id, profile_path, artifact)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS cache_findings (
      finding_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES cache_artifact_results(artifact_result_id),
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL,
      manifest_entry_ordinal INTEGER NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type = 'finding'),
      finding_kind TEXT NOT NULL,
      profile_path TEXT NOT NULL,
      commit_state TEXT NOT NULL CHECK (
        commit_state IN ('committed', 'wal_resident', 'journal_resident')
      ),
      backend TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      sort_key TEXT,
      sort_last_used TEXT,
      sort_size INTEGER,
      sort_entry_hash TEXT NOT NULL,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS cache_findings_key_query
      ON cache_findings(finding_kind, COALESCE(sort_key, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cache_findings_last_used_query
      ON cache_findings(finding_kind, COALESCE(sort_last_used, ''), finding_id);
    CREATE INDEX IF NOT EXISTS cache_findings_size_query
      ON cache_findings(finding_kind, COALESCE(sort_size, -1), finding_id);
    CREATE INDEX IF NOT EXISTS cache_findings_hash_query
      ON cache_findings(finding_kind, sort_entry_hash, finding_id);
    CREATE INDEX IF NOT EXISTS cache_findings_profile_query
      ON cache_findings(finding_kind, profile_path, finding_id);

    CREATE TABLE IF NOT EXISTS cache_candidates (
      candidate_id INTEGER PRIMARY KEY,
      artifact_result_id INTEGER NOT NULL
        REFERENCES cache_artifact_results(artifact_result_id),
      run_id TEXT NOT NULL REFERENCES analysis_runs(run_id),
      source_id TEXT NOT NULL,
      manifest_entry_ordinal INTEGER NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type = 'candidate'),
      candidate_kind TEXT NOT NULL,
      profile_path TEXT NOT NULL,
      commit_state TEXT NOT NULL CHECK (
        commit_state IN ('committed', 'wal_resident', 'journal_resident')
      ),
      backend TEXT NOT NULL,
      rank INTEGER NOT NULL CHECK (rank > 0),
      supporting_count INTEGER NOT NULL CHECK (supporting_count > 0),
      provenance_json TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      search_text TEXT NOT NULL,
      sort_key TEXT,
      sort_last_used TEXT,
      FOREIGN KEY (source_id, manifest_entry_ordinal)
        REFERENCES manifest_entries(source_id, ordinal)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS cache_candidates_kind_query
      ON cache_candidates(candidate_kind, COALESCE(sort_last_used, ''), candidate_id);
    CREATE INDEX IF NOT EXISTS cache_candidates_profile_query
      ON cache_candidates(profile_path, candidate_id);
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
  // Denormalise the topic label into a column so the Candidate query can filter
  // and sort by it without parsing JSON per row. It is a projection of
  // `fields.topicLabel`, never a second source of truth.
  const labelField = candidate.fields.topicLabel;
  const topicLabel =
    labelField !== undefined && labelField.state === "value"
      ? String(labelField.value)
      : null;
  statement.run(
    artifactResultId,
    runId,
    candidate.recordType,
    candidate.candidateKind,
    row.profile,
    row.commitState,
    candidate.rank,
    candidate.count,
    topicLabel,
    JSON.stringify(candidate.provenance),
    JSON.stringify(candidate.fields),
    row.searchText,
  );
}

function insertIdentityCandidate(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedIdentityCandidate,
): void {
  const candidate = row.candidate;
  statement.run(
    artifactResultId,
    runId,
    candidate.recordType,
    candidate.candidateKind,
    row.category,
    row.profile,
    candidate.rank,
    candidate.count,
    JSON.stringify(candidate.provenance),
    JSON.stringify(candidate.fields),
    row.searchText,
    row.sortValue,
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

function insertDownloadFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedDownloadFinding,
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
    row.sortStart,
    row.sortEnd,
    row.sortTargetPath,
    row.sortState,
    row.sortTotalBytes,
    row.dangerType,
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

function insertFaviconFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedFaviconFinding,
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
    row.sortIconUrl,
    row.sortPageUrl,
    row.sortLastUpdated,
    row.sortWidth,
  );
}

function insertCacheFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedCacheFinding,
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
    row.backend,
    JSON.stringify(finding.provenance),
    JSON.stringify(finding.fields),
    row.searchText,
    row.sortKey,
    row.sortLastUsed,
    row.sortSizeBytes,
    row.sortEntryHash,
  );
}

function insertCacheCandidate(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedCacheCandidate,
): void {
  const candidate = row.candidate;
  statement.run(
    artifactResultId,
    runId,
    candidate.provenance.sourceId,
    candidate.provenance.manifestEntryOrdinal,
    candidate.recordType,
    candidate.candidateKind,
    row.profile,
    row.commitState,
    row.backend,
    candidate.rank,
    candidate.count,
    JSON.stringify(candidate.provenance),
    JSON.stringify(candidate.fields),
    row.searchText,
    row.sortKey,
    row.sortLastUsed,
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

function insertBookmarkFinding(
  statement: ReturnType<DatabaseSync["prepare"]>,
  artifactResultId: bigint,
  runId: string,
  row: PersistedBookmarkFinding,
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
    row.sourceFile,
    row.sortName,
    row.sortUrl,
    row.sortDateAdded,
    row.sortFolder,
  );
}

type PreparedStatement = ReturnType<DatabaseSync["prepare"]>;

/**
 * Normalized, non-optional artifact write set. The public
 * {@link storeHistoryAnalysis} entrypoint accepts the historical shape with
 * optional per-family arrays and normalizes it into this structure before
 * persistence, so the engine never has to branch on `undefined`.
 */
interface ArtifactWrites {
  readonly historyArtifacts: readonly HistoryArtifactWrite[];
  readonly cookieArtifacts: readonly CookieArtifactWrite[];
  readonly topSitesArtifacts: readonly TopSitesArtifactWrite[];
  readonly faviconArtifacts: readonly FaviconArtifactWrite[];
  readonly loginDataArtifacts: readonly LoginDataArtifactWrite[];
  readonly webDataArtifacts: readonly WebDataArtifactWrite[];
  readonly downloadsArtifacts: readonly DownloadsArtifactWrite[];
  readonly metadataArtifacts: readonly MetadataArtifactWrite[];
  readonly bookmarksArtifacts: readonly BookmarksArtifactWrite[];
  readonly cacheArtifacts: readonly CacheArtifactWrite[];
  readonly candidateArtifacts: readonly CandidateArtifactWrite[];
}

interface AnalysisRunMetadata {
  readonly caseDirectory: string;
  readonly sourceIds: readonly string[];
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly invocation: readonly string[];
  readonly startedAt: string;
}

/**
 * A child-record inserter (Findings or Candidates) belonging to one artifact
 * family. It pairs the exact INSERT text with a row selector and the binder
 * that maps a persisted row onto its statement parameters.
 */
interface ChildPersist<TWrite> {
  readonly insertSql: string;
  rows(artifact: TWrite): readonly unknown[];
  bind(
    statement: PreparedStatement,
    artifactResultId: bigint,
    runId: string,
    row: unknown,
  ): void;
}

/**
 * Per-family persistence descriptor. It captures the exact INSERT/UPDATE text
 * and bindings for one artifact family so the generic persist loop can drive
 * every family without re-cloning the insert-result / insert-rows /
 * deactivate-previous / activate-current block. The SQL text and the
 * per-family statement order are preserved verbatim, so the Case DB the loop
 * produces is byte-for-byte identical to the hand-wired version it replaces.
 */
interface ArtifactPersist<
  TWrite extends { readonly status: "complete" | "absent" | "unavailable" },
> {
  readonly artifacts: readonly TWrite[];
  readonly insertResultSql: string;
  insertResult(
    statement: PreparedStatement,
    runId: string,
    artifact: TWrite,
  ): bigint;
  readonly deactivateSql: string;
  deactivate(statement: PreparedStatement, artifact: TWrite): void;
  readonly activateSql: string;
  readonly children: readonly ChildPersist<TWrite>[];
}

/**
 * Build a type-checked child inserter. The generic row type is erased at the
 * boundary so heterogeneous families can share one descriptor shape while each
 * binder keeps its precise persisted-row type.
 */
function childPersist<TWrite, TRow>(
  insertSql: string,
  rows: (artifact: TWrite) => readonly TRow[],
  bind: (
    statement: PreparedStatement,
    artifactResultId: bigint,
    runId: string,
    row: TRow,
  ) => void,
): ChildPersist<TWrite> {
  return {
    insertSql,
    rows: (artifact) => rows(artifact) as readonly unknown[],
    bind: (statement, artifactResultId, runId, row) =>
      bind(statement, artifactResultId, runId, row as TRow),
  };
}

/**
 * Persist one artifact family inside the open transaction. For each artifact it
 * inserts the result row, fans its Findings and Candidates out to their child
 * tables in declared order, and — when the artifact is `complete` — deactivates
 * the previously active result before activating the current one. Statement
 * preparation does not write, so preparing per family here is equivalent to the
 * former up-front block; the `run()` order is preserved unchanged.
 */
function persistArtifacts<
  TWrite extends { readonly status: "complete" | "absent" | "unavailable" },
>(
  database: DatabaseSync,
  runId: string,
  descriptor: ArtifactPersist<TWrite>,
): void {
  const insertResult = database.prepare(descriptor.insertResultSql);
  const deactivate = database.prepare(descriptor.deactivateSql);
  const activate = database.prepare(descriptor.activateSql);
  const children = descriptor.children.map((child) => ({
    child,
    statement: database.prepare(child.insertSql),
  }));
  for (const artifact of descriptor.artifacts) {
    const artifactResultId = descriptor.insertResult(
      insertResult,
      runId,
      artifact,
    );
    for (const { child, statement } of children) {
      for (const row of child.rows(artifact)) {
        child.bind(statement, artifactResultId, runId, row);
      }
    }
    if (artifact.status === "complete") {
      descriptor.deactivate(deactivate, artifact);
      activate.run(artifactResultId);
    }
  }
}

/**
 * The result-row columns shared by every SQLite-backed primary store (History,
 * Cookies, Top Sites, Favicons, Login Data, Web Data, Downloads). Their
 * `X_artifact_results` inserts bind an identical parameter list, so they share
 * one result binder.
 */
interface SqlitePrimaryWrite {
  readonly sourceId: string;
  readonly profile: string;
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable" | "not_applicable";
  readonly status: "complete" | "absent" | "unavailable";
  readonly reason: string | null;
}

function bindSqlitePrimaryResult<T extends SqlitePrimaryWrite>(
  statement: PreparedStatement,
  runId: string,
  artifact: T,
): bigint {
  return statement.run(
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
  ).lastInsertRowid as bigint;
}

function bindSourceProfileDeactivate(
  statement: PreparedStatement,
  artifact: { readonly sourceId: string; readonly profile: string },
): void {
  statement.run(artifact.sourceId, artifact.profile);
}

/**
 * Persist a full analysis run from a normalized, non-optional write set. This
 * is the engine behind {@link storeHistoryAnalysis}; the families are persisted
 * in the historical order and with the exact per-table SQL so the Case DB is
 * byte-for-byte identical to the previous hand-wired transaction.
 */
function storeAnalysisWrites(
  metadata: AnalysisRunMetadata,
  writes: ArtifactWrites,
): StoredHistoryAnalysis {
  const runId = randomUUID();
  const database = openDatabaseSync(
    join(resolve(metadata.caseDirectory), CASE_FILENAME),
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
          metadata.startedAt,
          TOOL_VERSION,
          JSON.stringify(metadata.invocation),
          metadata.declaredTimezone,
          metadata.declaredOriginOs,
        );
      const insertRunSource = database.prepare(
        "INSERT INTO analysis_run_sources (run_id, source_id) VALUES (?, ?)",
      );
      for (const sourceId of [...new Set(metadata.sourceIds)].sort()) {
        insertRunSource.run(runId, sourceId);
      }

      // Families are persisted in the historical order below. The persist loop
      // preserves each family's insert-result / insert-rows / activate order
      // and the exact SQL text, keeping the produced Case DB byte-identical.
      persistArtifacts<HistoryArtifactWrite>(database, runId, {
        artifacts: writes.historyArtifacts,
        insertResultSql: `INSERT INTO history_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'History', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE history_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'History'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE history_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<HistoryArtifactWrite, PersistedFinding>(
            `INSERT INTO forensic_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_time, sort_url,
            sort_duration, sort_count, transition_core)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertFinding,
          ),
          childPersist<HistoryArtifactWrite, PersistedCandidate>(
            `INSERT INTO forensic_candidates
           (artifact_result_id, run_id, record_type, candidate_kind,
            profile_path, commit_state, rank, supporting_count,
            topic_label, provenance_json, fields_json, search_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.candidates ?? [],
            insertCandidate,
          ),
        ],
      });

      persistArtifacts<CookieArtifactWrite>(database, runId, {
        artifacts: writes.cookieArtifacts,
        insertResultSql: `INSERT INTO cookie_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Cookies', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE cookie_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Cookies'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE cookie_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<CookieArtifactWrite, PersistedCookieFinding>(
            `INSERT INTO cookie_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_host, sort_name,
            sort_creation, sort_expires, sort_last_access, host_key, same_site)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertCookieFinding,
          ),
        ],
      });

      persistArtifacts<TopSitesArtifactWrite>(database, runId, {
        artifacts: writes.topSitesArtifacts,
        insertResultSql: `INSERT INTO top_sites_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Top Sites', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE top_sites_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Top Sites'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE top_sites_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<TopSitesArtifactWrite, PersistedTopSiteFinding>(
            `INSERT INTO top_sites_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_url, sort_title,
            sort_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertTopSiteFinding,
          ),
        ],
      });

      persistArtifacts<FaviconArtifactWrite>(database, runId, {
        artifacts: writes.faviconArtifacts,
        insertResultSql: `INSERT INTO favicon_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Favicons', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE favicon_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Favicons'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE favicon_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<FaviconArtifactWrite, PersistedFaviconFinding>(
            `INSERT INTO favicon_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_icon_url,
            sort_page_url, sort_last_updated, sort_width)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertFaviconFinding,
          ),
        ],
      });

      persistArtifacts<LoginDataArtifactWrite>(database, runId, {
        artifacts: writes.loginDataArtifacts,
        insertResultSql: `INSERT INTO login_data_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Login Data', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE login_data_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Login Data'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE login_data_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<LoginDataArtifactWrite, PersistedLoginFinding>(
            `INSERT INTO login_data_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_created,
            sort_last_used, sort_origin, sort_username)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertLoginFinding,
          ),
        ],
      });

      persistArtifacts<WebDataArtifactWrite>(database, runId, {
        artifacts: writes.webDataArtifacts,
        insertResultSql: `INSERT INTO web_data_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Web Data', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE web_data_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Web Data'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE web_data_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<WebDataArtifactWrite, PersistedAutofillFinding>(
            `INSERT INTO web_data_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_created,
            sort_last_used, sort_name, sort_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertAutofillFinding,
          ),
        ],
      });

      persistArtifacts<DownloadsArtifactWrite>(database, runId, {
        artifacts: writes.downloadsArtifacts,
        insertResultSql: `INSERT INTO downloads_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, schema_version, integrity, recovery_status,
            status, reason, active)
         VALUES (?, ?, ?, 'Downloads', ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: bindSqlitePrimaryResult,
        deactivateSql: `UPDATE downloads_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Downloads'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE downloads_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<DownloadsArtifactWrite, PersistedDownloadFinding>(
            `INSERT INTO downloads_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_start, sort_end,
            sort_target, sort_state, sort_bytes, danger_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertDownloadFinding,
          ),
        ],
      });

      persistArtifacts<MetadataArtifactWrite>(database, runId, {
        artifacts: writes.metadataArtifacts,
        insertResultSql: `INSERT INTO preferences_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, status, reason, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: (statement, currentRunId, artifact) =>
          statement.run(
            currentRunId,
            artifact.sourceId,
            artifact.profile,
            artifact.artifact,
            artifact.manifestEntryOrdinal,
            artifact.databasePath,
            artifact.status,
            artifact.reason,
          ).lastInsertRowid as bigint,
        deactivateSql: `UPDATE preferences_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = ?
            AND active = 1`,
        deactivate: (statement, artifact) => {
          statement.run(artifact.sourceId, artifact.profile, artifact.artifact);
        },
        activateSql:
          "UPDATE preferences_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<MetadataArtifactWrite, PersistedMetadataFinding>(
            `INSERT INTO preferences_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, sort_type, sort_profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertMetadataFinding,
          ),
        ],
      });

      persistArtifacts<BookmarksArtifactWrite>(database, runId, {
        artifacts: writes.bookmarksArtifacts,
        insertResultSql: `INSERT INTO bookmarks_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, status, reason, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        insertResult: (statement, currentRunId, artifact) =>
          statement.run(
            currentRunId,
            artifact.sourceId,
            artifact.profile,
            artifact.artifact,
            artifact.manifestEntryOrdinal,
            artifact.databasePath,
            artifact.status,
            artifact.reason,
          ).lastInsertRowid as bigint,
        deactivateSql: `UPDATE bookmarks_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = ?
            AND active = 1`,
        deactivate: (statement, artifact) => {
          statement.run(artifact.sourceId, artifact.profile, artifact.artifact);
        },
        activateSql:
          "UPDATE bookmarks_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<BookmarksArtifactWrite, PersistedBookmarkFinding>(
            `INSERT INTO bookmarks_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state,
            provenance_json, fields_json, search_text, source_file, sort_name,
            sort_url, sort_date_added, sort_folder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertBookmarkFinding,
          ),
        ],
      });

      persistArtifacts<CacheArtifactWrite>(database, runId, {
        artifacts: writes.cacheArtifacts,
        insertResultSql: `INSERT INTO cache_artifact_results
           (run_id, source_id, profile_path, artifact, manifest_entry_ordinal,
            database_path, backend, status, reason, active)
         VALUES (?, ?, ?, 'Cache', ?, ?, ?, ?, ?, 0)`,
        insertResult: (statement, currentRunId, artifact) =>
          statement.run(
            currentRunId,
            artifact.sourceId,
            artifact.profile,
            artifact.manifestEntryOrdinal,
            artifact.databasePath,
            artifact.backend,
            artifact.status,
            artifact.reason,
          ).lastInsertRowid as bigint,
        deactivateSql: `UPDATE cache_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Cache'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE cache_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<CacheArtifactWrite, PersistedCacheFinding>(
            `INSERT INTO cache_findings
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, finding_kind, profile_path, commit_state, backend,
            provenance_json, fields_json, search_text, sort_key, sort_last_used,
            sort_size, sort_entry_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.findings,
            insertCacheFinding,
          ),
          childPersist<CacheArtifactWrite, PersistedCacheCandidate>(
            `INSERT INTO cache_candidates
           (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
            record_type, candidate_kind, profile_path, commit_state, backend,
            rank, supporting_count, provenance_json, fields_json, search_text,
            sort_key, sort_last_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.candidates,
            insertCacheCandidate,
          ),
        ],
      });

      persistArtifacts<CandidateArtifactWrite>(database, runId, {
        artifacts: writes.candidateArtifacts,
        insertResultSql: `INSERT INTO candidate_artifact_results
           (run_id, source_id, profile_path, artifact, database_path, status,
            reason, active)
         VALUES (?, ?, ?, 'Candidates', 'Candidates', ?, ?, 0)`,
        insertResult: (statement, currentRunId, artifact) =>
          statement.run(
            currentRunId,
            artifact.sourceId,
            artifact.profile,
            artifact.status,
            artifact.reason,
          ).lastInsertRowid as bigint,
        deactivateSql: `UPDATE candidate_artifact_results
            SET active = 0
          WHERE source_id = ? AND profile_path = ? AND artifact = 'Candidates'
            AND active = 1`,
        deactivate: bindSourceProfileDeactivate,
        activateSql:
          "UPDATE candidate_artifact_results SET active = 1 WHERE artifact_result_id = ?",
        children: [
          childPersist<CandidateArtifactWrite, PersistedIdentityCandidate>(
            `INSERT INTO identity_candidates
           (artifact_result_id, run_id, record_type, candidate_kind, category,
            profile_path, rank, supporting_count, provenance_json, fields_json,
            search_text, sort_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            (artifact) => artifact.candidates,
            insertIdentityCandidate,
          ),
        ],
      });

      // The SQLite primary stores (History, Cookies, Login Data, Web Data, Top
      // Sites, Favicons) drive the Analysis Run exit state. Several artifacts
      // are recorded and independently queryable but deliberately excluded
      // here so their health cannot change the History/Cookies/Login exit-code
      // semantics an operator relies on:
      //   - the JSON-derived `Local State`/`Preferences` metadata and the
      //     `Bookmarks`/`Bookmarks.bak` documents — a valid-but-empty or
      //     malformed JSON document must not flip the run exit state; and
      //   - the `Cache` artifact — a tier-2 store that is not ingested by
      //     default, so a Manifest that merely lists a cache dir (as every real
      //     Chrome profile does) reports `unavailable`
      //     (`cache_not_in_working_copy`) or `cache_backend_unsupported` for
      //     backends we do not parse. That availability signal must not turn an
      //     otherwise-clean run into `partial`/`failed`.
      // The excluded artifacts' health is surfaced separately in the analyse
      // summary.
      const combinedArtifacts = [
        ...writes.historyArtifacts,
        ...writes.cookieArtifacts,
        ...writes.loginDataArtifacts,
        ...writes.topSitesArtifacts,
        ...writes.webDataArtifacts,
        ...writes.faviconArtifacts,
        ...writes.downloadsArtifacts,
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

/**
 * Persist a full analysis run. This is a thin, backward-compatible wrapper: it
 * accepts the historical options shape (with optional per-family arrays),
 * normalizes it into a non-optional {@link ArtifactWrites} set, and delegates
 * to {@link storeAnalysisWrites}. Existing callers keep compiling unchanged.
 */
export function storeHistoryAnalysis(
  options: StoreHistoryAnalysisOptions,
): StoredHistoryAnalysis {
  const writes: ArtifactWrites = {
    historyArtifacts: options.artifacts,
    cookieArtifacts: options.cookieArtifacts ?? [],
    topSitesArtifacts: options.topSitesArtifacts ?? [],
    faviconArtifacts: options.faviconArtifacts ?? [],
    loginDataArtifacts: options.loginDataArtifacts ?? [],
    webDataArtifacts: options.webDataArtifacts ?? [],
    downloadsArtifacts: options.downloadsArtifacts ?? [],
    metadataArtifacts: options.metadataArtifacts ?? [],
    bookmarksArtifacts: options.bookmarksArtifacts ?? [],
    cacheArtifacts: options.cacheArtifacts ?? [],
    candidateArtifacts: options.candidateArtifacts ?? [],
  };
  return storeAnalysisWrites(
    {
      caseDirectory: options.caseDirectory,
      sourceIds: options.sourceIds,
      declaredTimezone: options.declaredTimezone,
      declaredOriginOs: options.declaredOriginOs,
      invocation: options.invocation,
      startedAt: options.startedAt,
    },
    writes,
  );
}
