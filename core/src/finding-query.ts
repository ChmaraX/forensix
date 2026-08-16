import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import { SQLITE_MAX_INTEGER, SQLITE_MIN_INTEGER } from "./forensic-time.js";
import type {
  CommitState,
  ForensicFields,
  Provenance,
} from "./forensic-model.js";

/**
 * Shared read-only query engine for every artifact list surface.
 *
 * The bookmarks, cache, cookies, downloads, favicons, identity/topic
 * Candidate, Login Data, Preferences, Top Sites, and Web Data queries are all
 * the same query: open the immutable Case, confirm the analysis exists, pin the
 * active artifact results, hash a fingerprint over the resolved filters, decode
 * an optional keyset cursor, then run a deterministic keyset page. They differ
 * only in table names, kind constants, sortable columns, extra filters, output
 * record shape, and human wording. Those differences live in a per-surface
 * {@link FindingQuerySpec}; the engine below owns everything else so the SQL
 * assembly, cursor encoding, and pagination cannot drift between surfaces.
 */

export type QueryDirection = "asc" | "desc";

export interface SortDefinition {
  readonly expression: string;
  readonly kind: "text" | "integer";
}

export interface AnalysisIdentity {
  readonly caseId: string;
  readonly artifactResultIds: readonly string[];
}

/** Row shape returned by the engine's SELECT; parsers cast the columns they own. */
export interface EngineRow {
  readonly entity_id: bigint;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string | bigint;
  readonly finding_kind?: string;
  readonly candidate_kind?: string;
  readonly category?: string;
  readonly profile_path?: string;
  readonly commit_state?: string;
  readonly rank?: bigint;
  readonly supporting_count?: bigint;
}

/** Everything a single call resolves before any database work happens. */
export interface QueryPlan {
  readonly sort: string;
  readonly direction: QueryDirection;
  readonly limit: number;
  readonly sortDefinition: SortDefinition;
  /** WHERE fragments after the shared `r.active = 1`, paired with {@link QueryPlan.parameters}. */
  readonly conditions: readonly string[];
  readonly parameters: readonly (string | bigint)[];
  /** Builds the exact fingerprint input object; field order is load-bearing. */
  readonly fingerprint: (identity: AnalysisIdentity) => Record<string, unknown>;
}

export interface FindingQuerySpec<TInput extends BaseQueryInput, TItem> {
  /** Human label used in every INVALID_ARGUMENT / INVALID_CURSOR message. */
  readonly label: string;
  readonly analysisNotFound: string;
  readonly schemaTable: string;
  readonly mainTable: string;
  readonly resultsTable: string;
  readonly idColumn: string;
  readonly cursorIdField: string;
  /** Columns between the aliased id and provenance/fields, joined verbatim. */
  readonly selectColumns: string;
  readonly parse: (row: EngineRow) => TItem;
  readonly plan: (input: TInput) => QueryPlan;
}

export interface BaseQueryInput {
  readonly caseDirectory: string;
  readonly after?: string;
}

export interface QueryPageParts<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const COMMIT_STATES: readonly CommitState[] = [
  "committed",
  "wal_resident",
  "journal_resident",
];

export function validateEnum<const Values extends readonly string[]>(
  value: string | undefined,
  fallback: Values[number],
  values: Values,
  name: string,
  label: string,
): Values[number] {
  const result = value ?? fallback;
  if (!values.includes(result)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `${label} ${name} has an unsupported value.`,
      { value: result, allowed: values },
    );
  }
  return result;
}

export function normalizeLimit(
  value: number | undefined,
  label: string,
): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `${label} --limit must be an integer from 1 through 100.`,
      { limit },
    );
  }
  return limit;
}

export function resolveProfiles(
  profiles: readonly string[] | undefined,
  label: string,
): string[] {
  const result = [...new Set(profiles ?? [])].sort();
  if (result.length > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `${label} queries accept at most 100 Profile filters.`,
      { profile_count: result.length },
    );
  }
  return result;
}

export function resolveSearch(search: string | undefined): string | null {
  return search?.toLocaleLowerCase("en-US") ?? null;
}

/** Optional Commit-State filter shared by every Finding surface. */
export function resolveCommitState(
  value: CommitState | undefined,
  label: string,
): CommitState | null {
  return value === undefined
    ? null
    : validateEnum(value, "committed", COMMIT_STATES, "--commit-state", label);
}

/** Accumulates paired WHERE fragments and their positional parameters. */
export interface ConditionBuilder {
  readonly conditions: string[];
  readonly parameters: (string | bigint)[];
  add(condition: string, ...params: (string | bigint)[]): void;
  addProfiles(profiles: readonly string[]): void;
  addSearch(search: string | null): void;
}

export function createConditions(): ConditionBuilder {
  const conditions: string[] = [];
  const parameters: (string | bigint)[] = [];
  return {
    conditions,
    parameters,
    add(condition, ...params) {
      conditions.push(condition);
      parameters.push(...params);
    },
    addProfiles(profiles) {
      if (profiles.length > 0) {
        conditions.push(
          `f.profile_path IN (${profiles.map(() => "?").join(", ")})`,
        );
        parameters.push(...profiles);
      }
    },
    addSearch(search) {
      if (search !== null) {
        conditions.push("instr(f.search_text, ?) > 0");
        parameters.push(search);
      }
    },
  };
}

/** Parses provenance/fields JSON, raising a typed CASE_INVALID on corruption. */
export function decodeRecordJson(
  row: EngineRow,
  invalidJsonMessage: string,
  idKey: string,
): { readonly provenance: Provenance; readonly fields: ForensicFields } {
  try {
    return {
      provenance: JSON.parse(row.provenance_json) as Provenance,
      fields: JSON.parse(row.fields_json) as ForensicFields,
    };
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      invalidJsonMessage,
      { [idKey]: row.entity_id.toString() },
      { cause: error },
    );
  }
}

/** Validates a stored Commit State, raising a typed CASE_INVALID otherwise. */
export function assertCommitState(
  value: string | undefined,
  idKey: string,
  idValue: string,
): CommitState {
  if (
    value !== "committed" &&
    value !== "wal_resident" &&
    value !== "journal_resident"
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains an invalid Commit State.",
      { [idKey]: idValue },
    );
  }
  return value;
}

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function schemaExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get(table) !== undefined
  );
}

function activeAnalysisIdentity(
  database: DatabaseSync,
  resultsTable: string,
): AnalysisIdentity {
  const caseRow = database
    .prepare("SELECT case_id FROM case_info LIMIT 1")
    .get();
  if (typeof caseRow?.case_id !== "string") {
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  }
  const resultRows = database
    .prepare(
      `SELECT artifact_result_id
         FROM ${resultsTable}
        WHERE active = 1
        ORDER BY artifact_result_id`,
    )
    .all();
  return {
    caseId: caseRow.case_id,
    artifactResultIds: resultRows.map((row) => String(row.artifact_result_id)),
  };
}

function encodeCursor(
  fingerprint: string,
  key: string,
  idField: string,
  idValue: string,
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, fingerprint, key, [idField]: idValue }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  value: string,
  expectedFingerprint: string,
  label: string,
  idField: string,
): { readonly key: string; readonly id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    throw new ForensixError(
      "INVALID_CURSOR",
      `${label} cursor is not valid.`,
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
    !(idField in parsed) ||
    typeof (parsed as Record<string, unknown>)[idField] !== "string" ||
    !/^[0-9]+$/.test((parsed as Record<string, unknown>)[idField] as string)
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      `${label} cursor does not belong to this query.`,
    );
  }
  const record = parsed as Record<string, unknown>;
  return { key: record.key as string, id: record[idField] as string };
}

/**
 * Runs one keyset page for a surface. The returned parts are wrapped by each
 * surface into its own typed page literal so emitted JSON field order stays
 * byte-for-byte identical to the pre-refactor modules.
 */
export function runFindingQuery<TInput extends BaseQueryInput, TItem>(
  spec: FindingQuerySpec<TInput, TItem>,
  input: TInput,
): QueryPageParts<TItem> {
  const plan = spec.plan(input);
  const sortExpression = plan.sortDefinition.expression;

  const database = openCase(input.caseDirectory);
  try {
    if (!schemaExists(database, spec.schemaTable)) {
      throw new ForensixError("ANALYSIS_NOT_FOUND", spec.analysisNotFound);
    }
    const identity = activeAnalysisIdentity(database, spec.resultsTable);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(plan.fingerprint(identity)))
      .digest("hex");
    const cursor =
      input.after === undefined
        ? null
        : decodeCursor(
            input.after,
            fingerprint,
            spec.label,
            spec.cursorIdField,
          );

    const conditions = ["r.active = 1", ...plan.conditions];
    const parameters: (string | bigint)[] = [...plan.parameters];
    if (cursor !== null) {
      const operator = plan.direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortExpression} ${operator} ? OR ` +
          `(${sortExpression} = ? AND f.${spec.idColumn} ${operator} ?))`,
      );
      const id = BigInt(cursor.id);
      // An integer sort validates its key with the same regex and int64 range
      // guard History uses, so a forged or out-of-range cursor surfaces a typed
      // INVALID_CURSOR instead of a raw BigInt/node:sqlite throw.
      const integerCursorKey =
        plan.sortDefinition.kind === "integer" && /^-?[0-9]+$/.test(cursor.key)
          ? BigInt(cursor.key)
          : null;
      if (
        id > SQLITE_MAX_INTEGER ||
        (plan.sortDefinition.kind === "integer" &&
          (integerCursorKey === null ||
            integerCursorKey < SQLITE_MIN_INTEGER ||
            integerCursorKey > SQLITE_MAX_INTEGER))
      ) {
        throw new ForensixError(
          "INVALID_CURSOR",
          `${spec.label} cursor contains an invalid sort key.`,
        );
      }
      const cursorKey =
        plan.sortDefinition.kind === "integer"
          ? (integerCursorKey as bigint)
          : cursor.key;
      parameters.push(cursorKey, cursorKey, id);
    }

    parameters.push(BigInt(plan.limit + 1));
    const sqlDirection = plan.direction === "asc" ? "ASC" : "DESC";
    const rows = database
      .prepare(
        `SELECT f.${spec.idColumn} AS entity_id, ${spec.selectColumns},
                f.provenance_json, f.fields_json,
                ${sortExpression} AS cursor_key
           FROM ${spec.mainTable} f
           JOIN ${spec.resultsTable} r
             ON r.artifact_result_id = f.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortExpression} ${sqlDirection},
                   f.${spec.idColumn} ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as EngineRow[];
    const hasNext = rows.length > plan.limit;
    const pageRows = hasNext ? rows.slice(0, plan.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(spec.parse),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor(
              fingerprint,
              last.cursor_key.toString(),
              spec.cursorIdField,
              last.entity_id.toString(),
            )
          : null,
      limit: plan.limit,
    };
  } finally {
    database.close();
  }
}
