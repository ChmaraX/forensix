import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";

/**
 * Read-only Case overview surface. It powers the loopback dashboard's
 * Completeness Statements and Profile filters. It interprets no artifact rows
 * and writes nothing: every function opens the Case immutable and read-only,
 * mirroring the History/Cookies/Login Data query contracts.
 */

export type OverviewArtifact = "History" | "Cookies" | "Login Data";
export type CompletenessOutcome = "produced" | "absent" | "unavailable";

export interface CompletenessArtifact {
  readonly sourceId: string;
  readonly profile: string;
  readonly artifact: OverviewArtifact;
  readonly databasePath: string;
  readonly outcome: CompletenessOutcome;
  readonly reason: string | null;
  readonly runId: string;
}

export interface CompletenessStatement {
  readonly artifact: OverviewArtifact;
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly artifacts: readonly CompletenessArtifact[];
}

export interface CaseCompleteness {
  readonly status: "ok";
  readonly command: "completeness";
  readonly caseId: string;
  readonly statements: readonly CompletenessStatement[];
}

export interface CaseProfiles {
  readonly status: "ok";
  readonly command: "profiles";
  readonly caseId: string;
  readonly profiles: readonly string[];
}

interface OverviewQuery {
  readonly caseDirectory: string;
}

interface ArtifactResultRow {
  readonly source_id: string;
  readonly profile_path: string;
  readonly database_path: string;
  readonly status: string;
  readonly reason: string | null;
  readonly run_id: string;
  readonly artifact_result_id: bigint | number;
  readonly started_at: string;
  readonly active: bigint | number;
}

interface ArtifactTable {
  readonly artifact: OverviewArtifact;
  readonly resultsTable: string;
}

const ARTIFACT_TABLES: readonly ArtifactTable[] = [
  { artifact: "History", resultsTable: "history_artifact_results" },
  { artifact: "Cookies", resultsTable: "cookie_artifact_results" },
  { artifact: "Login Data", resultsTable: "login_data_artifact_results" },
];

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get(name) !== undefined
  );
}

function readCaseId(database: DatabaseSync): string {
  const caseRow = database
    .prepare("SELECT case_id FROM case_info LIMIT 1")
    .get();
  if (typeof caseRow?.case_id !== "string") {
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  }
  return caseRow.case_id;
}

/**
 * Reduce the retained artifact-result lineage to the current outcome per
 * (Source, Profile). Supersede keeps every earlier row, so the current outcome
 * is the active result when one exists (a superseding rerun that ended
 * unavailable supersedes nothing, so the active complete row stays current);
 * otherwise it is the most recent attempt, which surfaces absent or
 * unavailable. This is the same notion of "current" the list queries use
 * (`WHERE active = 1`), so Completeness always matches the rows shown.
 */
function buildStatement(
  database: DatabaseSync,
  table: ArtifactTable,
): CompletenessStatement {
  if (
    !tableExists(database, table.resultsTable) ||
    !tableExists(database, "analysis_runs")
  ) {
    return {
      artifact: table.artifact,
      attempted: 0,
      produced: 0,
      absent: 0,
      unavailable: 0,
      artifacts: [],
    };
  }
  const rows = database
    .prepare(
      `SELECT r.source_id, r.profile_path, r.database_path, r.status,
              r.reason, r.run_id, r.artifact_result_id, r.active, a.started_at
         FROM ${table.resultsTable} r
         JOIN analysis_runs a ON a.run_id = r.run_id
        ORDER BY r.source_id, r.profile_path`,
    )
    .all() as unknown as ArtifactResultRow[];
  const current = new Map<string, ArtifactResultRow>();
  for (const row of rows) {
    const key = `${row.source_id}\u0000${row.profile_path}`;
    const chosen = current.get(key);
    if (chosen === undefined) {
      current.set(key, row);
      continue;
    }
    // An active result is always current; it is never superseded by a later
    // rerun that failed to produce. Between two non-active rows, keep the most
    // recent attempt.
    const rowActive = BigInt(row.active) === 1n;
    const chosenActive = BigInt(chosen.active) === 1n;
    if (chosenActive) {
      continue;
    }
    if (
      rowActive ||
      row.started_at > chosen.started_at ||
      (row.started_at === chosen.started_at &&
        BigInt(row.artifact_result_id) > BigInt(chosen.artifact_result_id))
    ) {
      current.set(key, row);
    }
  }
  const artifacts = [...current.values()]
    .map((row): CompletenessArtifact => {
      const outcome: CompletenessOutcome =
        row.status === "complete"
          ? "produced"
          : row.status === "absent"
            ? "absent"
            : "unavailable";
      return {
        sourceId: row.source_id,
        profile: row.profile_path,
        artifact: table.artifact,
        databasePath: row.database_path,
        outcome,
        reason:
          outcome === "unavailable"
            ? (row.reason ?? "unspecified")
            : row.reason,
        runId: row.run_id,
      };
    })
    .sort((left, right) =>
      left.sourceId === right.sourceId
        ? left.profile.localeCompare(right.profile)
        : left.sourceId.localeCompare(right.sourceId),
    );
  return {
    artifact: table.artifact,
    attempted: artifacts.length,
    produced: artifacts.filter((row) => row.outcome === "produced").length,
    absent: artifacts.filter((row) => row.outcome === "absent").length,
    unavailable: artifacts.filter((row) => row.outcome === "unavailable")
      .length,
    artifacts,
  };
}

/**
 * The Completeness Statement for every artifact type, computed before any row
 * is read. The dashboard shows this above every list.
 */
export function queryCompleteness(input: OverviewQuery): CaseCompleteness {
  const database = openCase(input.caseDirectory);
  try {
    const caseId = readCaseId(database);
    return {
      status: "ok",
      command: "completeness",
      caseId,
      statements: ARTIFACT_TABLES.map((table) =>
        buildStatement(database, table),
      ),
    };
  } finally {
    database.close();
  }
}

/**
 * The distinct Profiles that currently carry active Findings across every
 * artifact type. It backs the multi-Profile filter shared by all lists.
 */
export function queryProfiles(input: OverviewQuery): CaseProfiles {
  const database = openCase(input.caseDirectory);
  try {
    const caseId = readCaseId(database);
    const profiles = new Set<string>();
    for (const table of ARTIFACT_TABLES) {
      if (!tableExists(database, table.resultsTable)) {
        continue;
      }
      const rows = database
        .prepare(
          `SELECT DISTINCT profile_path
             FROM ${table.resultsTable}
            WHERE active = 1
            ORDER BY profile_path`,
        )
        .all() as unknown as { readonly profile_path: string }[];
      for (const row of rows) {
        profiles.add(row.profile_path);
      }
    }
    return {
      status: "ok",
      command: "profiles",
      caseId,
      profiles: [...profiles].sort((left, right) => left.localeCompare(right)),
    };
  } finally {
    database.close();
  }
}
