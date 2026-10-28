import type { DatabaseSync } from "node:sqlite";

import { openCaseReadOnly } from "./case.js";
import {
  readActiveProfiles,
  readCaseId,
  readCompletenessStatements,
  type OverviewArtifact,
} from "./case-overview.js";
import { ForensixError } from "./errors.js";
import {
  normalizeLimit,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
} from "./finding-query.js";
import type { CommitState } from "./forensic-model.js";
import { secretValueSha256 } from "./record-redaction.js";
import { isSecretField } from "./secret-fields.js";
import {
  RECORD_STORES,
  decodeStoredRecord,
  parseRecordId,
  presentStores,
  storedRecordColumns,
  type RecordStore,
  type RecordStoreKey,
  type StoredRecord,
  type StoredRecordRow,
} from "./record-store.js";
import { tableExists } from "./sqlite-artifact.js";
import { TIMELINE_SOURCES } from "./timeline-query.js";

/**
 * Small, agent-facing read queries over one Case: fetch one record by id,
 * describe the fields of each record kind, count records by one field, and
 * summarise the Case. Every query opens the Case immutable and read-only,
 * reads only active rows (except `getRecord`, which also returns superseded
 * rows), and aggregates in SQL so no query loads every row into memory.
 */

// ---------------------------------------------------------------- get

export interface GetRecordQuery {
  readonly caseDirectory: string;
  readonly id: string;
}

export interface GetRecordResult {
  readonly status: "ok";
  readonly command: "get";
  /** False when a later Analysis Run superseded the row. */
  readonly active: boolean;
  readonly item: StoredRecord;
}

/** One Finding or Candidate by its `<store>:<rowid>` id, active or not. */
export function getRecord(input: GetRecordQuery): GetRecordResult {
  const { store, rowId } = parseRecordId(input.id);
  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    requireAnalysis(database);
    if (!storeExists(database, store)) {
      throw recordNotFound(input.id);
    }
    const row = database
      .prepare(
        `SELECT ${storedRecordColumns(store)}, r.active AS active
           FROM ${store.table} f
           JOIN ${store.resultsTable} r
             ON r.artifact_result_id = f.artifact_result_id
          WHERE f.${store.idColumn} = ?`,
      )
      .get(rowId) as
      (StoredRecordRow & { readonly active: bigint }) | undefined;
    if (row === undefined) {
      throw recordNotFound(input.id);
    }
    return {
      status: "ok",
      command: "get",
      active: row.active === 1n,
      item: decodeStoredRecord(store, row),
    };
  } finally {
    database.close();
  }
}

function recordNotFound(id: string): ForensixError {
  return new ForensixError(
    "RECORD_NOT_FOUND",
    `Case has no record with id ${id}.`,
    { id },
  );
}

// ---------------------------------------------------------------- schema

export type SchemaValueType =
  "string" | "number" | "boolean" | "array" | "object" | "timestamp" | "null";

export interface SchemaField {
  readonly name: string;
  /** Active records of this kind per Field State of this field. */
  readonly states: {
    readonly value: number;
    readonly absent: number;
    readonly unavailable: number;
  };
  /** Records whose value is the empty string. */
  readonly empty: number;
  /** JSON types seen in `value`; an object with `utc` is a timestamp. */
  readonly valueTypes: readonly SchemaValueType[];
}

export interface SchemaKind {
  readonly recordType: "finding" | "candidate";
  readonly kind: string;
  readonly store: RecordStoreKey;
  /** Active records of this kind. */
  readonly count: number;
  readonly fields: readonly SchemaField[];
}

export interface SchemaQuery {
  readonly caseDirectory: string;
  /** Describe only this Finding or Candidate kind. */
  readonly kind?: string;
}

export interface SchemaResult {
  readonly status: "ok";
  readonly command: "schema";
  readonly kinds: readonly SchemaKind[];
}

const VALUE_TYPE_SQL = `CASE json_type(j.value, '$.value')
  WHEN 'text' THEN 'string'
  WHEN 'integer' THEN 'number'
  WHEN 'real' THEN 'number'
  WHEN 'true' THEN 'boolean'
  WHEN 'false' THEN 'boolean'
  WHEN 'array' THEN 'array'
  WHEN 'null' THEN 'null'
  WHEN 'object' THEN CASE
    WHEN json_type(j.value, '$.value.utc') IS NOT NULL THEN 'timestamp'
    ELSE 'object' END
  END`;

interface SchemaRow {
  readonly kind: string;
  readonly name: string;
  readonly state: string | null;
  readonly value_type: SchemaValueType | null;
  readonly rows: bigint;
  readonly empty: bigint;
}

/** The fields of each record kind with active rows in the Case. */
export function querySchema(input: SchemaQuery): SchemaResult {
  const requested =
    input.kind === undefined ? null : resolveKind(input.kind).kind;
  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    requireAnalysis(database);
    const kinds: SchemaKind[] = [];
    for (const store of presentStores(database)) {
      if (requested !== null && !store.kinds.includes(requested)) {
        continue;
      }
      const kindFilter =
        requested === null ? "" : `AND f.${store.kindColumn} = ?`;
      const kindParameters = requested === null ? [] : [requested];
      const counts = database
        .prepare(
          `SELECT f.${store.kindColumn} AS kind, count(*) AS rows
             FROM ${store.table} f
             JOIN ${store.resultsTable} r
               ON r.artifact_result_id = f.artifact_result_id
            WHERE r.active = 1 ${kindFilter}
            GROUP BY 1
            ORDER BY 1`,
        )
        .all(...kindParameters) as unknown as {
        readonly kind: string;
        readonly rows: bigint;
      }[];
      const fieldRows = database
        .prepare(
          `SELECT f.${store.kindColumn} AS kind, j.key AS name,
                  json_extract(j.value, '$.state') AS state,
                  CASE WHEN json_extract(j.value, '$.state') = 'value'
                       THEN ${VALUE_TYPE_SQL} END AS value_type,
                  count(*) AS rows,
                  sum(json_extract(j.value, '$.state') = 'value'
                      AND json_type(j.value, '$.value') = 'text'
                      AND json_extract(j.value, '$.value') = '') AS empty
             FROM ${store.table} f
             JOIN ${store.resultsTable} r
               ON r.artifact_result_id = f.artifact_result_id,
                  json_each(f.fields_json) j
            WHERE r.active = 1 ${kindFilter}
            GROUP BY 1, 2, 3, 4`,
        )
        .all(...kindParameters) as unknown as SchemaRow[];
      for (const { kind, rows } of counts) {
        kinds.push({
          recordType: store.recordType,
          kind,
          store: store.key,
          count: Number(rows),
          fields: schemaFields(
            database,
            store,
            kind,
            fieldRows.filter((row) => row.kind === kind),
          ),
        });
      }
      if (requested !== null && counts.length === 0) {
        kinds.push({
          recordType: store.recordType,
          kind: requested,
          store: store.key,
          count: 0,
          fields: [],
        });
      }
    }
    return { status: "ok", command: "schema", kinds };
  } finally {
    database.close();
  }
}

function schemaFields(
  database: DatabaseSync,
  store: RecordStore,
  kind: string,
  rows: readonly SchemaRow[],
): SchemaField[] {
  const byName = new Map<
    string,
    {
      value: number;
      absent: number;
      unavailable: number;
      empty: number;
      types: Set<SchemaValueType>;
    }
  >();
  for (const row of rows) {
    const entry = byName.get(row.name) ?? {
      value: 0,
      absent: 0,
      unavailable: 0,
      empty: 0,
      types: new Set<SchemaValueType>(),
    };
    const count = Number(row.rows);
    if (row.state === "value") entry.value += count;
    else if (row.state === "absent") entry.absent += count;
    else if (row.state === "unavailable") entry.unavailable += count;
    entry.empty += Number(row.empty);
    if (row.value_type !== null) entry.types.add(row.value_type);
    byName.set(row.name, entry);
  }
  // Field order is the order of the first active record of the kind, so the
  // schema reads like a record; names only some records carry follow, sorted.
  const firstOrder = (
    database
      .prepare(
        `SELECT j.key AS name
           FROM ${store.table} f, json_each(f.fields_json) j
          WHERE f.${store.idColumn} = (
                SELECT min(g.${store.idColumn})
                  FROM ${store.table} g
                  JOIN ${store.resultsTable} r
                    ON r.artifact_result_id = g.artifact_result_id
                 WHERE r.active = 1 AND g.${store.kindColumn} = ?)
          ORDER BY j.id`,
      )
      .all(kind) as unknown as { readonly name: string }[]
  ).map((row) => row.name);
  const names = [
    ...firstOrder.filter((name) => byName.has(name)),
    ...[...byName.keys()].filter((name) => !firstOrder.includes(name)).sort(),
  ];
  return names.map((name) => {
    const entry = byName.get(name);
    if (entry === undefined) throw new Error(`Missing schema field ${name}.`);
    return {
      name,
      states: {
        value: entry.value,
        absent: entry.absent,
        unavailable: entry.unavailable,
      },
      empty: entry.empty,
      valueTypes: [...entry.types].sort(),
    };
  });
}

// ---------------------------------------------------------------- count

export interface CountQuery {
  readonly caseDirectory: string;
  /** The Finding or Candidate kind to count. */
  readonly kind: string;
  /** A field name of the kind, or the built-ins `profile`, `commitState`. */
  readonly by: string;
  readonly profiles?: readonly string[];
  readonly commitState?: CommitState;
  readonly search?: string;
  /** Buckets to return, 1 through 100 (default 20). */
  readonly limit?: number;
  /**
   * When `by` is a plaintext secret field (see `SECRET_FIELDS_BY_KIND`),
   * replace each value bucket key with `(redacted:sha256:<hex>)`.
   */
  readonly redactSecrets?: boolean;
}

/**
 * One count bucket. `state` keeps the Field State of the grouped value apart
 * from the value itself, so an evidence string such as "(absent)" can never
 * merge with, or pass as, a real absent field.
 */
export interface CountBucket {
  readonly state: "value" | "absent" | "unavailable" | "missing" | "redacted";
  readonly key: string;
  readonly count: number;
}

export interface CountResult {
  readonly status: "ok";
  readonly command: "count";
  readonly kind: string;
  readonly by: string;
  /** Active records that match the filters. */
  readonly total: number;
  readonly buckets: readonly CountBucket[];
  /** Records in buckets past `limit`. */
  readonly otherCount: number;
  readonly limit: number;
}

export const COUNT_BUILT_IN_FIELDS = ["profile", "commitState"] as const;

const BUCKET_STATE_SQL = `CASE
  WHEN fs IS NULL THEN 'missing'
  ELSE COALESCE(json_extract(fs, '$.state'), 'unknown')
END`;

const BUCKET_KEY_SQL = `CASE
  WHEN fs IS NULL THEN '(missing)'
  WHEN json_extract(fs, '$.state') = 'value' THEN
    CASE json_type(fs, '$.value')
      WHEN 'object' THEN CASE
        WHEN json_type(fs, '$.value.utc') = 'text'
          THEN substr(json_extract(fs, '$.value.utc'), 1, 10)
        ELSE json_extract(fs, '$.value') END
      WHEN 'array' THEN json_extract(fs, '$.value')
      WHEN 'true' THEN 'true'
      WHEN 'false' THEN 'false'
      WHEN 'null' THEN 'null'
      ELSE CAST(json_extract(fs, '$.value') AS TEXT)
    END
  WHEN json_extract(fs, '$.state') = 'absent' THEN '(absent)'
  WHEN json_extract(fs, '$.state') = 'unavailable'
    THEN '(unavailable:' || COALESCE(json_extract(fs, '$.reason'), 'unspecified') || ')'
  ELSE '(' || COALESCE(json_extract(fs, '$.state'), 'unknown') || ')'
END`;

/** Active records of one kind, grouped by one field, counted in SQL. */
export function queryCount(input: CountQuery): CountResult {
  const { store, kind } = resolveKind(input.kind);
  const limit = normalizeLimit(input.limit ?? 20, "Count");
  const profiles = resolveProfiles(input.profiles, "Count");
  const commitState = resolveCommitState(input.commitState);
  const search = resolveSearch(input.search);
  if (
    store.recordType === "candidate" &&
    (commitState !== null || input.by === "commitState")
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Kind ${kind} records are Candidates. A Candidate has no Commit State.`,
      { kind },
    );
  }
  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    requireAnalysis(database);
    if (!storeExists(database, store)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        `Case has no analysis for kind ${kind}. Run analyse first.`,
        { kind },
      );
    }
    const conditions = ["r.active = 1", `f.${store.kindColumn} = ?`];
    const parameters: (string | bigint)[] = [kind];
    if (profiles.length > 0) {
      conditions.push(
        `f.profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (commitState !== null) {
      conditions.push("f.commit_state = ?");
      parameters.push(commitState);
    }
    if (search !== null) {
      conditions.push("instr(f.search_text, ?) > 0");
      parameters.push(search);
    }
    const from = `FROM ${store.table} f
      JOIN ${store.resultsTable} r
        ON r.artifact_result_id = f.artifact_result_id
     WHERE ${conditions.join(" AND ")}`;

    let bucketSql: string;
    const bucketParameters: string[] = [];
    if (input.by === "profile") {
      bucketSql = `SELECT 'value' AS bucket_state, f.profile_path AS bucket ${from}`;
    } else if (input.by === "commitState") {
      bucketSql = `SELECT 'value' AS bucket_state, f.commit_state AS bucket ${from}`;
    } else {
      assertFieldExists(database, store, kind, input.by);
      bucketSql = `SELECT ${BUCKET_STATE_SQL} AS bucket_state,
               ${BUCKET_KEY_SQL} AS bucket
        FROM (SELECT json_extract(f.fields_json, ?) AS fs ${from})`;
      bucketParameters.push(`$."${input.by}"`);
    }
    const totalRow = database
      .prepare(`SELECT count(*) AS total ${from}`)
      .get(...parameters) as { readonly total: bigint };
    const redact =
      input.redactSecrets === true && isSecretField(kind, input.by);
    // A redacted count must not order or cut buckets by the plaintext: then
    // every bucket is read, hashed, sorted by the hash, and cut here.
    const rows = database
      .prepare(
        `SELECT bucket_state AS state, bucket AS key, count(*) AS count
           FROM (${bucketSql})
          GROUP BY bucket_state, bucket
          ${redact ? "" : "ORDER BY count DESC, key ASC, state ASC LIMIT ?"}`,
      )
      .all(
        ...bucketParameters,
        ...parameters,
        ...(redact ? [] : [BigInt(limit)]),
      ) as unknown as {
      readonly key: string;
      readonly count: bigint;
      readonly state: string;
    }[];
    const shown = rows.map((row): CountBucket => {
      const state = bucketState(row.state);
      if (redact && state === "value") {
        return {
          state: "redacted",
          key: `(redacted:sha256:${secretValueSha256(row.key)})`,
          count: Number(row.count),
        };
      }
      return { state, key: row.key, count: Number(row.count) };
    });
    const buckets = redact
      ? shown
          .sort(
            (left, right) =>
              right.count - left.count ||
              (left.key < right.key ? -1 : left.key > right.key ? 1 : 0) ||
              (left.state < right.state ? -1 : 1),
          )
          .slice(0, limit)
      : shown;
    const total = Number(totalRow.total);
    return {
      status: "ok",
      command: "count",
      kind,
      by: input.by,
      total,
      buckets,
      otherCount:
        total - buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      limit,
    };
  } finally {
    database.close();
  }
}

function bucketState(value: string): CountBucket["state"] {
  if (
    value === "value" ||
    value === "absent" ||
    value === "unavailable" ||
    value === "missing"
  ) {
    return value;
  }
  throw new ForensixError(
    "CASE_INVALID",
    "Case contains a field with an unknown Field State.",
    { state: value },
  );
}

function assertFieldExists(
  database: DatabaseSync,
  store: RecordStore,
  kind: string,
  field: string,
): void {
  const fromActive = `FROM ${store.table} f
      JOIN ${store.resultsTable} r
        ON r.artifact_result_id = f.artifact_result_id,
           json_each(f.fields_json) j
     WHERE r.active = 1 AND f.${store.kindColumn} = ?`;
  const present = database
    .prepare(`SELECT 1 ${fromActive} AND j.key = ? LIMIT 1`)
    .get(kind, field);
  if (present !== undefined) return;
  const names = (
    database
      .prepare(`SELECT DISTINCT j.key AS name ${fromActive} ORDER BY 1`)
      .all(kind) as unknown as { readonly name: string }[]
  ).map((row) => row.name);
  throw new ForensixError(
    "INVALID_ARGUMENT",
    `Count --by ${field} is not a field of kind ${kind}. Run forensix schema --kind ${kind} to list the fields.`,
    { by: field, kind, allowed: [...COUNT_BUILT_IN_FIELDS, ...names] },
  );
}

// ---------------------------------------------------------------- summary

export interface SummaryQuery {
  readonly caseDirectory: string;
}

export interface SummarySource {
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly sourcePath: string;
  readonly profileCount: number;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly unavailableCount: number;
  readonly evidenceSetDigest: string;
}

export interface SummaryAnalysis {
  readonly runId: string;
  readonly exitState: string;
  readonly toolVersion: string;
  readonly declaredTimezone: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface SummaryRecordCount {
  readonly recordType: "finding" | "candidate";
  readonly kind: string;
  readonly store: RecordStoreKey;
  /** Null for Candidates, which carry no Commit State. */
  readonly committed: number | null;
  /** WAL- or journal-resident records; null without a Commit State. */
  readonly recovered: number | null;
  readonly total: number;
}

export interface SummaryCompleteness {
  readonly artifact: OverviewArtifact;
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
}

export interface SummaryResult {
  readonly status: "ok";
  readonly command: "summary";
  readonly caseId: string;
  readonly sources: readonly SummarySource[];
  readonly profiles: readonly string[];
  /** The most recent Analysis Run, or null before the first analyse. */
  readonly analysis: SummaryAnalysis | null;
  readonly records: readonly SummaryRecordCount[];
  /** Earliest and latest Timeline instant (UTC), or null when none. */
  readonly timeSpan: {
    readonly earliest: string;
    readonly latest: string;
  } | null;
  readonly completeness: readonly SummaryCompleteness[];
}

/** Counts only: Sources, Profiles, the last run, records, span, coverage. */
export function querySummary(input: SummaryQuery): SummaryResult {
  const database = openCaseReadOnly(input.caseDirectory, { readBigInts: true });
  try {
    const caseId = readCaseId(database);
    const sources = (
      database
        .prepare(
          `SELECT source_id, source_kind, source_path, profile_count,
                  entry_count, copied_entry_count, unavailable_count,
                  evidence_set_digest
             FROM sources
            ORDER BY source_id`,
        )
        .all() as unknown as {
        readonly source_id: string;
        readonly source_kind: string;
        readonly source_path: string;
        readonly profile_count: bigint;
        readonly entry_count: bigint;
        readonly copied_entry_count: bigint;
        readonly unavailable_count: bigint;
        readonly evidence_set_digest: string;
      }[]
    ).map((row) => ({
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      sourcePath: row.source_path,
      profileCount: Number(row.profile_count),
      entryCount: Number(row.entry_count),
      copiedEntryCount: Number(row.copied_entry_count),
      unavailableCount: Number(row.unavailable_count),
      evidenceSetDigest: row.evidence_set_digest,
    }));
    const stores = presentStores(database);
    return {
      status: "ok",
      command: "summary",
      caseId,
      sources,
      profiles: readActiveProfiles(database),
      analysis: latestAnalysis(database),
      records: stores.flatMap((store) => recordCounts(database, store)),
      timeSpan: timeSpan(database, stores),
      completeness: readCompletenessStatements(database).map((statement) => ({
        artifact: statement.artifact,
        attempted: statement.attempted,
        produced: statement.produced,
        absent: statement.absent,
        unavailable: statement.unavailable,
      })),
    };
  } finally {
    database.close();
  }
}

function latestAnalysis(database: DatabaseSync): SummaryAnalysis | null {
  if (!tableExists(database, "analysis_runs")) return null;
  const row = database
    .prepare(
      `SELECT run_id, status, tool_version, declared_timezone, started_at,
              finished_at
         FROM analysis_runs
        ORDER BY started_at DESC, run_id DESC
        LIMIT 1`,
    )
    .get() as
    | {
        readonly run_id: string;
        readonly status: string;
        readonly tool_version: string;
        readonly declared_timezone: string;
        readonly started_at: string;
        readonly finished_at: string | null;
      }
    | undefined;
  return row === undefined
    ? null
    : {
        runId: row.run_id,
        exitState: row.status,
        toolVersion: row.tool_version,
        declaredTimezone: row.declared_timezone,
        startedAt: row.started_at,
        endedAt: row.finished_at,
      };
}

function recordCounts(
  database: DatabaseSync,
  store: RecordStore,
): SummaryRecordCount[] {
  const committed =
    store.recordType === "finding"
      ? "sum(f.commit_state = 'committed')"
      : "NULL";
  const rows = database
    .prepare(
      `SELECT f.${store.kindColumn} AS kind, count(*) AS total,
              ${committed} AS committed
         FROM ${store.table} f
         JOIN ${store.resultsTable} r
           ON r.artifact_result_id = f.artifact_result_id
        WHERE r.active = 1
        GROUP BY 1
        ORDER BY 1`,
    )
    .all() as unknown as {
    readonly kind: string;
    readonly total: bigint;
    readonly committed: bigint | null;
  }[];
  return rows.map((row) => {
    const total = Number(row.total);
    const committedCount =
      row.committed === null ? null : Number(row.committed);
    return {
      recordType: store.recordType,
      kind: row.kind,
      store: store.key,
      committed: committedCount,
      recovered: committedCount === null ? null : total - committedCount,
      total,
    };
  });
}

function timeSpan(
  database: DatabaseSync,
  stores: readonly RecordStore[],
): SummaryResult["timeSpan"] {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const entry of TIMELINE_SOURCES) {
    const store = stores.find((candidate) => candidate.key === entry.store);
    if (store === undefined) continue;
    const row = database
      .prepare(
        `SELECT min(f.${entry.column}) AS earliest,
                max(f.${entry.column}) AS latest
           FROM ${store.table} f
           JOIN ${store.resultsTable} r
             ON r.artifact_result_id = f.artifact_result_id
          WHERE r.active = 1 AND f.${entry.column} IS NOT NULL
                AND f.finding_kind = ?`,
      )
      .get(entry.kind) as {
      readonly earliest: string | null;
      readonly latest: string | null;
    };
    if (row.earliest !== null && (earliest === null || row.earliest < earliest))
      earliest = row.earliest;
    if (row.latest !== null && (latest === null || row.latest > latest))
      latest = row.latest;
  }
  return earliest === null || latest === null ? null : { earliest, latest };
}

// ---------------------------------------------------------------- shared

const KNOWN_KINDS: readonly string[] = RECORD_STORES.flatMap(
  (store) => store.kinds,
);

function resolveKind(kind: string): {
  readonly store: RecordStore;
  readonly kind: string;
} {
  const store = RECORD_STORES.find((candidate) =>
    candidate.kinds.includes(kind),
  );
  if (store === undefined) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Kind ${kind} is not a Finding or Candidate kind.`,
      { kind, allowed: KNOWN_KINDS },
    );
  }
  return { store, kind };
}

function storeExists(database: DatabaseSync, store: RecordStore): boolean {
  return (
    tableExists(database, store.table) &&
    tableExists(database, store.resultsTable)
  );
}

function requireAnalysis(database: DatabaseSync): void {
  if (!tableExists(database, "forensic_findings")) {
    throw new ForensixError(
      "ANALYSIS_NOT_FOUND",
      "Case has no analysis. Run analyse first.",
    );
  }
}
