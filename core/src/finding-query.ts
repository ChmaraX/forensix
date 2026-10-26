import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { openCaseReadOnly } from "./case.js";
import { readCaseId } from "./case-overview.js";
import { ForensixError } from "./errors.js";
import { SQLITE_MAX_INTEGER, SQLITE_MIN_INTEGER } from "./forensic-time.js";
import type { CommitState } from "./forensic-model.js";
import {
  recordStore,
  storedRecordColumns,
  type Identified,
  type RecordStore,
  type RecordStoreKey,
  type StoredRecordRow,
} from "./record-store.js";
import { tableExists } from "./sqlite-artifact.js";

/**
 * Shared read-only query engine for every artifact list surface.
 *
 * The bookmarks, cache, cookies, downloads, favicons, History, identity/topic
 * Candidate, Login Data, Preferences, Top Sites, and Web Data queries are all
 * the same query: open the immutable Case, confirm the analysis exists, pin the
 * active artifact results, hash a fingerprint over the resolved filters, decode
 * an optional keyset cursor, then run a deterministic keyset page. They differ
 * only in their record store, sortable columns, extra filters, and wording.
 * Those differences live in a per-surface {@link FindingQuerySpec}; the engine
 * below owns everything else so the SQL assembly, cursor encoding, and
 * pagination cannot drift between surfaces.
 */

export const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const satisfies readonly CommitState[];

export const QUERY_DIRECTIONS = ["asc", "desc"] as const;
export type QueryDirection = (typeof QUERY_DIRECTIONS)[number];

/**
 * Parses one option value against its allowed values. The CLI, the server,
 * and every core query use it, so a bad value gives one INVALID_ARGUMENT error.
 */
export function parseOption<const Values extends readonly string[]>(
  value: string,
  option: string,
  values: Values,
): Values[number];
export function parseOption<const Values extends readonly string[]>(
  value: string | null | undefined,
  option: string,
  values: Values,
): Values[number] | undefined;
export function parseOption<const Values extends readonly string[]>(
  value: string | null | undefined,
  option: string,
  values: Values,
): Values[number] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isOneOf(value, values)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} has an unsupported value: ${value}`,
      { option, value, allowed: values },
    );
  }
  return value;
}

function isOneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
): value is Values[number] {
  return values.includes(value);
}

export interface SortDefinition {
  readonly expression: string;
  readonly kind: "text" | "integer";
}

export interface AnalysisIdentity {
  readonly caseId: string;
  readonly artifactResultIds: readonly string[];
}

/** Everything a single call resolves before any database work happens. */
export interface QueryPlan {
  readonly direction: QueryDirection;
  readonly limit: number;
  readonly sortDefinition: SortDefinition;
  /** WHERE fragments after the shared `r.active = 1`, paired with {@link QueryPlan.parameters}. */
  readonly conditions: readonly string[];
  readonly parameters: readonly (string | bigint)[];
  /** Builds the exact fingerprint input object; field order is load-bearing. */
  readonly fingerprint: (identity: AnalysisIdentity) => Record<string, unknown>;
}

export interface FindingQuerySpec<
  TInput extends BaseQueryInput,
  TItem extends object,
> {
  /** Human label used in every INVALID_ARGUMENT / INVALID_CURSOR message. */
  readonly label: string;
  /** The record store the query reads; it names the tables and columns. */
  readonly store: RecordStoreKey;
  readonly analysisNotFound: string;
  /** The table that proves the analysis ran, when not the store's own table. */
  readonly schemaTable?: string;
  readonly decode: (
    store: RecordStore,
    row: StoredRecordRow,
  ) => Identified<TItem>;
  readonly plan: (input: TInput) => QueryPlan;
}

export interface BaseQueryInput {
  readonly caseDirectory: string;
  readonly after?: string;
}

export interface QueryPageParts<TItem> {
  readonly items: readonly Identified<TItem>[];
  readonly nextCursor: string | null;
  readonly limit: number;
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

/** An ISO 8601 instant with an offset, as a microsecond UTC string. */
export function normalizeInstant(
  value: string | undefined,
  option: string,
  label: string,
): string | null {
  if (value === undefined) {
    return null;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  const date = new Date(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    match === null ||
    Number.isNaN(date.getTime()) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `${label} ${option} must be an ISO 8601 instant with an offset.`,
      { value },
    );
  }
  const fraction = (match[7] ?? "").padEnd(6, "0");
  const milliseconds = date.toISOString();
  return `${milliseconds.slice(0, -5)}.${milliseconds.slice(-4, -1)}${fraction.slice(3)}Z`;
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
      { profileCount: result.length },
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
): CommitState | null {
  return parseOption(value, "--commit-state", COMMIT_STATES) ?? null;
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

/** The active artifact result ids of one results table, in order. */
export function activeArtifactResultIds(
  database: DatabaseSync,
  resultsTable: string,
): string[] {
  return database
    .prepare(
      `SELECT artifact_result_id
         FROM ${resultsTable}
        WHERE active = 1
        ORDER BY artifact_result_id`,
    )
    .all()
    .map((row) => String(row.artifact_result_id));
}

/** SHA-256 over the Case identity and the resolved filters of one query. */
export function queryFingerprint(query: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(query)).digest("hex");
}

export function encodeCursor(
  fingerprint: string,
  position: Readonly<Record<string, string>>,
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, fingerprint, ...position }),
    "utf8",
  ).toString("base64url");
}

/** The named string keys of a cursor minted for this exact query. */
export function decodeCursor<const Key extends string>(
  value: string,
  fingerprint: string,
  label: string,
  keys: readonly Key[],
): Readonly<Record<Key, string>> {
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
  const record = parsed as Record<string, unknown> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    record.version !== 1 ||
    record.fingerprint !== fingerprint ||
    !keys.every((key) => typeof record[key] === "string")
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      `${label} cursor does not belong to this query.`,
    );
  }
  return record as Record<Key, string>;
}

/** A cursor's row id: a decimal SQLite integer, or INVALID_CURSOR. */
export function cursorRowId(value: string, label: string): bigint {
  const id = /^[0-9]{1,19}$/.test(value) ? BigInt(value) : null;
  if (id === null || id > SQLITE_MAX_INTEGER) {
    throw new ForensixError(
      "INVALID_CURSOR",
      `${label} cursor does not belong to this query.`,
    );
  }
  return id;
}

/** Runs one keyset page for a surface. */
export function runFindingQuery<
  TInput extends BaseQueryInput,
  TItem extends object,
>(spec: FindingQuerySpec<TInput, TItem>, input: TInput): QueryPageParts<TItem> {
  const plan = spec.plan(input);
  const store = recordStore(spec.store);
  const sortExpression = plan.sortDefinition.expression;

  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    if (!tableExists(database, spec.schemaTable ?? store.table)) {
      throw new ForensixError("ANALYSIS_NOT_FOUND", spec.analysisNotFound);
    }
    const fingerprint = queryFingerprint(
      plan.fingerprint({
        caseId: readCaseId(database),
        artifactResultIds: activeArtifactResultIds(
          database,
          store.resultsTable,
        ),
      }),
    );
    const cursor =
      input.after === undefined
        ? null
        : decodeCursor(input.after, fingerprint, spec.label, ["key", "id"]);

    const conditions = ["r.active = 1", ...plan.conditions];
    const parameters: (string | bigint)[] = [...plan.parameters];
    if (cursor !== null) {
      const operator = plan.direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortExpression} ${operator} ? OR ` +
          `(${sortExpression} = ? AND f.${store.idColumn} ${operator} ?))`,
      );
      const id = cursorRowId(cursor.id, spec.label);
      // An integer sort validates its key with the same regex and int64 range
      // guard as the row id, so a forged or out-of-range cursor surfaces a
      // typed INVALID_CURSOR instead of a raw BigInt/node:sqlite throw.
      let cursorKey: string | bigint = cursor.key;
      if (plan.sortDefinition.kind === "integer") {
        const integerKey = /^-?[0-9]+$/.test(cursor.key)
          ? BigInt(cursor.key)
          : null;
        if (
          integerKey === null ||
          integerKey < SQLITE_MIN_INTEGER ||
          integerKey > SQLITE_MAX_INTEGER
        ) {
          throw new ForensixError(
            "INVALID_CURSOR",
            `${spec.label} cursor contains an invalid sort key.`,
          );
        }
        cursorKey = integerKey;
      }
      parameters.push(cursorKey, cursorKey, id);
    }

    parameters.push(BigInt(plan.limit + 1));
    const sqlDirection = plan.direction === "asc" ? "ASC" : "DESC";
    const rows = database
      .prepare(
        `SELECT ${storedRecordColumns(store)},
                ${sortExpression} AS cursor_key
           FROM ${store.table} f
           JOIN ${store.resultsTable} r
             ON r.artifact_result_id = f.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortExpression} ${sqlDirection},
                   f.${store.idColumn} ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as (StoredRecordRow & {
      readonly cursor_key: string | bigint;
    })[];
    const hasNext = rows.length > plan.limit;
    const pageRows = hasNext ? rows.slice(0, plan.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => spec.decode(store, row)),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor(fingerprint, {
              key: last.cursor_key.toString(),
              id: last.row_id.toString(),
            })
          : null,
      limit: plan.limit,
    };
  } finally {
    database.close();
  }
}
