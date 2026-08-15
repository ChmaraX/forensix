import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import type { CandidateCategory } from "./identity-candidates.js";
import type { ForensicFields, Provenance } from "./forensic-model.js";

export type CandidateSort =
  | "rank"
  | "kind"
  | "supporting-count"
  | "value"
  | "profile";
export type CandidateDirection = "asc" | "desc";

export interface CandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly category?: string;
  readonly kind?: string;
  readonly search?: string;
  readonly sort?: CandidateSort;
  readonly direction?: CandidateDirection;
  readonly limit?: number;
  readonly after?: string;
}

/**
 * One ranked Candidate row. It is deliberately not a Finding: it has no Commit
 * State, it carries `rank` and `supportingCount`, and its `candidateKind` is a
 * ranked-hypothesis kind, never a factual Finding kind.
 */
export interface CandidateRecord {
  readonly recordType: "candidate";
  readonly candidateKind: string;
  readonly category: CandidateCategory;
  readonly profile: string;
  readonly rank: number;
  readonly supportingCount: number;
  readonly provenance: Provenance;
  readonly fields: ForensicFields;
}

export interface CandidateCompleteness {
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
}

export interface CandidatePage {
  readonly status: "ok";
  readonly command: "candidates";
  readonly completeness: CandidateCompleteness;
  readonly items: readonly CandidateRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly key: string;
  readonly candidateId: string;
}

interface QueryRow {
  readonly candidate_id: bigint;
  readonly candidate_kind: string;
  readonly category: string;
  readonly profile_path: string;
  readonly rank: bigint;
  readonly supporting_count: bigint;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string;
}

const CANDIDATE_SORTS = [
  "rank",
  "kind",
  "supporting-count",
  "value",
  "profile",
] as const;
const CANDIDATE_DIRECTIONS = ["asc", "desc"] as const;
const CATEGORIES = ["identity", "behavior"] as const;

const SORT_EXPRESSIONS: Readonly<Record<CandidateSort, string>> = {
  rank: "printf('%020d', c.rank)",
  kind: "c.candidate_kind",
  "supporting-count": "printf('%020d', c.supporting_count)",
  value: "c.sort_value",
  profile: "c.profile_path",
};

const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;

function queryFingerprint(input: {
  readonly caseId: string;
  readonly activeArtifactResultIds: readonly string[];
  readonly profiles: readonly string[];
  readonly category: CandidateCategory | null;
  readonly kind: string | null;
  readonly search: string | null;
  readonly sort: CandidateSort;
  readonly direction: CandidateDirection;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  expectedFingerprint: string,
): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Candidates cursor is not valid.",
      {},
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("fingerprint" in parsed) ||
    parsed.fingerprint !== expectedFingerprint ||
    !("key" in parsed) ||
    typeof parsed.key !== "string" ||
    !("candidateId" in parsed) ||
    typeof parsed.candidateId !== "string" ||
    !/^[0-9]+$/.test(parsed.candidateId)
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Candidates cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Candidates --limit must be an integer from 1 through 100.",
      { limit },
    );
  }
  return limit;
}

function enumValue<const Values extends readonly string[]>(
  value: string | undefined,
  fallback: Values[number],
  values: Values,
  name: string,
): Values[number] {
  const result = value ?? fallback;
  if (!values.includes(result)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Candidates ${name} has an unsupported value.`,
      { value: result, allowed: values },
    );
  }
  return result;
}

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function schemaExists(database: DatabaseSync): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'identity_candidates'",
      )
      .get() !== undefined
  );
}

function activeAnalysisIdentity(database: DatabaseSync): {
  readonly caseId: string;
  readonly artifactResultIds: readonly string[];
} {
  const caseRow = database
    .prepare("SELECT case_id FROM case_info LIMIT 1")
    .get();
  if (typeof caseRow?.case_id !== "string") {
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  }
  const resultRows = database
    .prepare(
      `SELECT artifact_result_id
         FROM candidate_artifact_results
        WHERE active = 1
        ORDER BY artifact_result_id`,
    )
    .all();
  return {
    caseId: caseRow.case_id,
    artifactResultIds: resultRows.map((row) => String(row.artifact_result_id)),
  };
}

/**
 * The Completeness Statement for Candidate generation, computed before any row
 * is read. It reduces the retained artifact-result lineage to the current
 * outcome per (Source, Profile): the active result when one exists, otherwise
 * the most recent attempt.
 */
function buildCompleteness(
  database: DatabaseSync,
  profiles: readonly string[],
): CandidateCompleteness {
  const rows = database
    .prepare(
      `SELECT r.source_id, r.profile_path, r.status, r.active, a.started_at,
              r.artifact_result_id
         FROM candidate_artifact_results r
         JOIN analysis_runs a ON a.run_id = r.run_id
        ORDER BY r.source_id, r.profile_path`,
    )
    .all() as unknown as {
    readonly source_id: string;
    readonly profile_path: string;
    readonly status: string;
    readonly active: bigint | number;
    readonly started_at: string;
    readonly artifact_result_id: bigint | number;
  }[];
  const profileSet = new Set(profiles);
  const current = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (profileSet.size > 0 && !profileSet.has(row.profile_path)) {
      continue;
    }
    const key = `${row.source_id}\u0000${row.profile_path}`;
    const chosen = current.get(key);
    if (chosen === undefined) {
      current.set(key, row);
      continue;
    }
    if (BigInt(chosen.active) === 1n) {
      continue;
    }
    if (
      BigInt(row.active) === 1n ||
      row.started_at > chosen.started_at ||
      (row.started_at === chosen.started_at &&
        BigInt(row.artifact_result_id) > BigInt(chosen.artifact_result_id))
    ) {
      current.set(key, row);
    }
  }
  const values = [...current.values()];
  return {
    attempted: values.length,
    produced: values.filter((row) => row.status === "complete").length,
    absent: values.filter((row) => row.status === "absent").length,
    unavailable: values.filter((row) => row.status === "unavailable").length,
  };
}

function parseRecord(row: QueryRow): CandidateRecord {
  let provenance: Provenance;
  let fields: ForensicFields;
  try {
    provenance = JSON.parse(row.provenance_json) as Provenance;
    fields = JSON.parse(row.fields_json) as ForensicFields;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Candidate JSON.",
      { candidate_id: row.candidate_id.toString() },
      { cause: error },
    );
  }
  if (row.category !== "identity" && row.category !== "behavior") {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains an invalid Candidate category.",
      { candidate_id: row.candidate_id.toString() },
    );
  }
  return {
    recordType: "candidate",
    candidateKind: row.candidate_kind,
    category: row.category,
    profile: row.profile_path,
    rank: Number(row.rank),
    supportingCount: Number(row.supporting_count),
    provenance,
    fields,
  };
}

export function queryCandidates(input: CandidateQuery): CandidatePage {
  const direction = enumValue(
    input.direction,
    "asc",
    CANDIDATE_DIRECTIONS,
    "--direction",
  );
  const sort = enumValue(input.sort, "rank", CANDIDATE_SORTS, "--sort");
  const category =
    input.category === undefined
      ? null
      : enumValue(input.category, "identity", CATEGORIES, "--category");
  const kind =
    input.kind === undefined || input.kind.length === 0 ? null : input.kind;
  const sortExpression = SORT_EXPRESSIONS[sort];
  const limit = normalizeLimit(input.limit);
  const profiles = [...new Set(input.profiles ?? [])].sort();
  if (profiles.length > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Candidates queries accept at most 100 Profile filters.",
      { profile_count: profiles.length },
    );
  }
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;

  const database = openCase(input.caseDirectory);
  try {
    if (!schemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no Candidate analysis. Run analyse first.",
      );
    }
    const identity = activeAnalysisIdentity(database);
    const completeness = buildCompleteness(database, profiles);
    const fingerprint = queryFingerprint({
      caseId: identity.caseId,
      activeArtifactResultIds: identity.artifactResultIds,
      profiles,
      category,
      kind,
      search,
      sort,
      direction,
    });
    const cursor =
      input.after === undefined ? null : decodeCursor(input.after, fingerprint);

    const conditions = ["r.active = 1", "c.record_type = 'candidate'"];
    const parameters: (string | bigint)[] = [];
    if (profiles.length > 0) {
      conditions.push(
        `c.profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (category !== null) {
      conditions.push("c.category = ?");
      parameters.push(category);
    }
    if (kind !== null) {
      conditions.push("c.candidate_kind = ?");
      parameters.push(kind);
    }
    if (search !== null) {
      conditions.push("instr(c.search_text, ?) > 0");
      parameters.push(search);
    }
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortExpression} ${operator} ? OR ` +
          `(${sortExpression} = ? AND c.candidate_id ${operator} ?))`,
      );
      const candidateId = BigInt(cursor.candidateId);
      if (candidateId > SQLITE_MAX_INTEGER) {
        throw new ForensixError(
          "INVALID_CURSOR",
          "Candidates cursor contains an invalid sort key.",
        );
      }
      parameters.push(cursor.key, cursor.key, candidateId);
    }

    parameters.push(BigInt(limit + 1));
    const sqlDirection = direction === "asc" ? "ASC" : "DESC";
    const rows = database
      .prepare(
        `SELECT c.candidate_id, c.candidate_kind, c.category, c.profile_path,
                c.rank, c.supporting_count, c.provenance_json, c.fields_json,
                ${sortExpression} AS cursor_key
           FROM identity_candidates c
           JOIN candidate_artifact_results r
             ON r.artifact_result_id = c.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortExpression} ${sqlDirection},
                   c.candidate_id ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "candidates",
      completeness,
      items: pageRows.map(parseRecord),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              version: 1,
              fingerprint,
              key: last.cursor_key.toString(),
              candidateId: last.candidate_id.toString(),
            })
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
