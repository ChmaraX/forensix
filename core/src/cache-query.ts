import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  createCandidate,
  createFinding,
  type Candidate,
  type Finding,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";

export type CacheDirection = "asc" | "desc";
export type CacheRecordType = "finding" | "candidate";
export type CacheSort = "key" | "last-used" | "size" | "entry-hash" | "profile";

export interface CacheQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly recordType?: CacheRecordType;
  readonly backend?: string;
  readonly sort?: CacheSort;
  readonly direction?: CacheDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CachePage {
  readonly status: "ok";
  readonly command: "cache";
  readonly recordType: CacheRecordType;
  readonly items: readonly (Finding | Candidate)[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly key: string;
  readonly rowId: string;
}

interface QueryRow {
  readonly row_id: bigint;
  readonly finding_kind?: string;
  readonly candidate_kind?: string;
  readonly profile_path: string;
  readonly commit_state?: string;
  readonly rank?: bigint;
  readonly supporting_count?: bigint;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string | bigint;
}

const CACHE_DIRECTIONS = ["asc", "desc"] as const;
const CACHE_RECORD_TYPES = ["finding", "candidate"] as const;
const FINDING_SORTS = [
  "key",
  "last-used",
  "size",
  "entry-hash",
  "profile",
] as const;
const CANDIDATE_SORTS = ["key", "last-used", "profile"] as const;
const CACHE_FINDING_KIND = "cache_entry";

interface SortDefinition {
  readonly expression: string;
  readonly kind: "text" | "integer";
}

const FINDING_SORT_SQL: Readonly<Record<CacheSort, SortDefinition>> = {
  key: { expression: "COALESCE(c.sort_key, '')", kind: "text" },
  "last-used": { expression: "COALESCE(c.sort_last_used, '')", kind: "text" },
  size: { expression: "COALESCE(c.sort_size, -1)", kind: "integer" },
  "entry-hash": { expression: "c.sort_entry_hash", kind: "text" },
  profile: { expression: "c.profile_path", kind: "text" },
};

const CANDIDATE_SORT_SQL: Readonly<Record<string, SortDefinition>> = {
  key: { expression: "COALESCE(c.sort_key, '')", kind: "text" },
  "last-used": { expression: "COALESCE(c.sort_last_used, '')", kind: "text" },
  profile: { expression: "c.profile_path", kind: "text" },
};

const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;

function queryFingerprint(input: Record<string, unknown>): string {
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
      "Cache cursor is not valid.",
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
    !("rowId" in parsed) ||
    typeof parsed.rowId !== "string" ||
    !/^[0-9]+$/.test(parsed.rowId)
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Cache cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Cache --limit must be an integer from 1 through 100.",
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
      `Cache ${name} has an unsupported value.`,
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

function cacheSchemaExists(database: DatabaseSync): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'cache_findings'",
      )
      .get() !== undefined
  );
}

function activeIdentity(database: DatabaseSync): {
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
         FROM cache_artifact_results
        WHERE active = 1
        ORDER BY artifact_result_id`,
    )
    .all();
  return {
    caseId: caseRow.case_id,
    artifactResultIds: resultRows.map((row) => String(row.artifact_result_id)),
  };
}

function parseRecord(
  row: QueryRow,
  recordType: CacheRecordType,
): Finding | Candidate {
  let provenance: Provenance;
  let fields: ForensicFields;
  try {
    provenance = JSON.parse(row.provenance_json) as Provenance;
    fields = JSON.parse(row.fields_json) as ForensicFields;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Cache record JSON.",
      { row_id: row.row_id.toString() },
      { cause: error },
    );
  }
  if (recordType === "candidate") {
    return createCandidate({
      candidateKind: row.candidate_kind as string,
      rank: Number(row.rank),
      count: Number(row.supporting_count),
      provenance,
      fields,
    });
  }
  if (
    row.commit_state !== "committed" &&
    row.commit_state !== "wal_resident" &&
    row.commit_state !== "journal_resident"
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains an invalid Commit State.",
      { row_id: row.row_id.toString() },
    );
  }
  return createFinding({
    findingKind: row.finding_kind as string,
    profile: row.profile_path,
    commitState: row.commit_state,
    provenance,
    fields,
  });
}

export function queryCache(input: CacheQuery): CachePage {
  const recordType = enumValue(
    input.recordType,
    "finding",
    CACHE_RECORD_TYPES,
    "--record-type",
  );
  const direction = enumValue(
    input.direction,
    "asc",
    CACHE_DIRECTIONS,
    "--direction",
  );
  const sortValues = recordType === "finding" ? FINDING_SORTS : CANDIDATE_SORTS;
  const sort = enumValue(
    input.sort,
    recordType === "finding" ? "key" : "last-used",
    sortValues,
    "--sort",
  );
  const sortDefinition =
    recordType === "finding"
      ? FINDING_SORT_SQL[sort]
      : (CANDIDATE_SORT_SQL[sort] as SortDefinition);
  const sortExpression = sortDefinition.expression;
  const limit = normalizeLimit(input.limit);
  const profiles = [...new Set(input.profiles ?? [])].sort();
  if (profiles.length > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Cache queries accept at most 100 Profile filters.",
      { profile_count: profiles.length },
    );
  }
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;
  const backend = input.backend ?? null;

  const table =
    recordType === "finding" ? "cache_findings" : "cache_candidates";
  const idColumn = recordType === "finding" ? "finding_id" : "candidate_id";
  const kindColumn =
    recordType === "finding" ? "finding_kind" : "candidate_kind";
  const kindValue = recordType === "finding" ? CACHE_FINDING_KIND : null;

  const database = openCase(input.caseDirectory);
  try {
    if (!cacheSchemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no Cache analysis. Run analyse first.",
      );
    }
    const identity = activeIdentity(database);
    const fingerprint = queryFingerprint({
      caseId: identity.caseId,
      activeArtifactResultIds: identity.artifactResultIds,
      recordType,
      profiles,
      search,
      backend,
      sort,
      direction,
    });
    const cursor =
      input.after === undefined ? null : decodeCursor(input.after, fingerprint);

    const conditions = ["r.active = 1", "c.record_type = ?"];
    const parameters: (string | bigint)[] = [recordType];
    if (kindValue !== null) {
      conditions.push(`c.${kindColumn} = ?`);
      parameters.push(kindValue);
    }
    if (profiles.length > 0) {
      conditions.push(
        `c.profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (backend !== null) {
      conditions.push("c.backend = ?");
      parameters.push(backend);
    }
    if (search !== null) {
      conditions.push("instr(c.search_text, ?) > 0");
      parameters.push(search);
    }
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortExpression} ${operator} ? OR ` +
          `(${sortExpression} = ? AND c.${idColumn} ${operator} ?))`,
      );
      const rowId = BigInt(cursor.rowId);
      const integerCursorKey =
        sortDefinition.kind === "integer" && /^-?[0-9]+$/.test(cursor.key)
          ? BigInt(cursor.key)
          : null;
      if (
        rowId > SQLITE_MAX_INTEGER ||
        (sortDefinition.kind === "integer" &&
          (integerCursorKey === null ||
            integerCursorKey < SQLITE_MIN_INTEGER ||
            integerCursorKey > SQLITE_MAX_INTEGER))
      ) {
        throw new ForensixError(
          "INVALID_CURSOR",
          "Cache cursor contains an invalid sort key.",
        );
      }
      const cursorKey =
        sortDefinition.kind === "integer"
          ? (integerCursorKey as bigint)
          : cursor.key;
      parameters.push(cursorKey, cursorKey, rowId);
    }

    parameters.push(BigInt(limit + 1));
    const sqlDirection = direction === "asc" ? "ASC" : "DESC";
    const selectExtra =
      recordType === "finding"
        ? "c.finding_kind AS finding_kind, c.commit_state AS commit_state"
        : "c.candidate_kind AS candidate_kind, c.rank AS rank, c.supporting_count AS supporting_count";
    const rows = database
      .prepare(
        `SELECT c.${idColumn} AS row_id, c.profile_path,
                ${selectExtra},
                c.provenance_json, c.fields_json,
                ${sortExpression} AS cursor_key
           FROM ${table} c
           JOIN cache_artifact_results r
             ON r.artifact_result_id = c.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortExpression} ${sqlDirection},
                   c.${idColumn} ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "cache",
      recordType,
      items: pageRows.map((row) => parseRecord(row, recordType)),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              version: 1,
              fingerprint,
              key: last.cursor_key.toString(),
              rowId: last.row_id.toString(),
            })
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
