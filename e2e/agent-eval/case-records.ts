/**
 * Record lookup for the agent eval: does a cited record id exist, and what
 * does the record hold?
 *
 * A cited id is looked up with `forensix get --case <case> --id <id> --json`.
 * A record id is `<store>:<rowid>`.
 *
 * `locateRecords` finds the truth records (by store, kind, and one field
 * value) with a read-only query on `case.fxdb`. Its store keys copy core's
 * record-store table (core/src/record-store.ts); the deterministic test
 * compares them with the ids that the CLI prints, so a change in core fails
 * that test.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface StoreTable {
  readonly table: string;
  readonly idColumn: "finding_id" | "candidate_id";
}

export const STORE_TABLES: Readonly<Record<string, StoreTable>> = {
  history: { table: "forensic_findings", idColumn: "finding_id" },
  "topic-candidates": {
    table: "forensic_candidates",
    idColumn: "candidate_id",
  },
  "identity-candidates": {
    table: "identity_candidates",
    idColumn: "candidate_id",
  },
  logins: { table: "login_data_findings", idColumn: "finding_id" },
  "web-data": { table: "web_data_findings", idColumn: "finding_id" },
  downloads: { table: "downloads_findings", idColumn: "finding_id" },
  cookies: { table: "cookie_findings", idColumn: "finding_id" },
  "top-sites": { table: "top_sites_findings", idColumn: "finding_id" },
  favicons: { table: "favicon_findings", idColumn: "finding_id" },
  preferences: { table: "preferences_findings", idColumn: "finding_id" },
  bookmarks: { table: "bookmarks_findings", idColumn: "finding_id" },
  cache: { table: "cache_findings", idColumn: "finding_id" },
  "cache-candidates": { table: "cache_candidates", idColumn: "candidate_id" },
};

function storeTable(store: string): StoreTable | undefined {
  return Object.hasOwn(STORE_TABLES, store) ? STORE_TABLES[store] : undefined;
}

/** One record as the eval needs it (a subset of the CLI item shape). */
export interface EvalRecord {
  readonly id: string;
  readonly recordType: "finding" | "candidate";
  readonly kind: string;
  readonly profile: string;
  /** `committed`, `wal_resident`, `journal_resident`; null when the store
   *  has no Commit State (identity Candidates). */
  readonly commitState: string | null;
  /** null when the lookup path cannot tell. */
  readonly active: boolean | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface RecordResolver {
  /** The record, or null when the id is malformed or names no record. */
  resolve(id: string): EvalRecord | null;
}

interface Row {
  readonly rowid: number;
  readonly record_type: string;
  readonly kind: string;
  readonly profile_path: string;
  readonly commit_state: string | null;
  readonly fields_json: string;
  readonly active: number | null;
}

function columnNames(database: DatabaseSync, table: string): Set<string> {
  const rows = database
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table) as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function resultTable(database: DatabaseSync, table: string): string | null {
  const row = database
    .prepare(
      `SELECT "table" AS target FROM pragma_foreign_key_list(?)
       WHERE "from" = 'artifact_result_id'`,
    )
    .get(table) as { target: string } | undefined;
  return row?.target ?? null;
}

function selectSql(
  database: DatabaseSync,
  store: StoreTable,
  where: string,
): string {
  const columns = columnNames(database, store.table);
  const kind = columns.has("finding_kind") ? "finding_kind" : "candidate_kind";
  const commit = columns.has("commit_state") ? "t.commit_state" : "NULL";
  const results = resultTable(database, store.table);
  const active = results === null ? "NULL" : "r.active";
  const join_ =
    results === null
      ? ""
      : `LEFT JOIN ${results} r ON r.artifact_result_id = t.artifact_result_id`;
  return `SELECT t.${store.idColumn} AS rowid, t.record_type, t.${kind} AS kind,
            t.profile_path, ${commit} AS commit_state, t.fields_json,
            ${active} AS active
          FROM ${store.table} t ${join_} WHERE ${where}`;
}

function openCaseDatabase(caseDirectory: string): DatabaseSync {
  return new DatabaseSync(join(caseDirectory, "case.fxdb"), {
    readOnly: true,
  });
}

/** How truth.json names a record: its store, kind, and one field value. */
export interface RecordLocator {
  readonly store: string;
  readonly kind: string;
  readonly field: string;
  readonly value: string;
}

/** The ids (`<store>:<rowid>`) of the active records that match a locator. */
export function locateRecords(
  caseDirectory: string,
  locator: RecordLocator,
): string[] {
  const store = storeTable(locator.store);
  if (store === undefined) {
    throw new Error(`unknown store key "${locator.store}"`);
  }
  const database = openCaseDatabase(caseDirectory);
  try {
    const sql = selectSql(
      database,
      store,
      `kind = ? AND json_extract(t.fields_json, ?) = ?`,
    );
    const rows = database
      .prepare(sql)
      .all(
        locator.kind,
        `$.${locator.field}.value`,
        locator.value,
      ) as unknown as Row[];
    return rows
      .filter((row) => row.active !== 0)
      .map((row) => `${locator.store}:${String(row.rowid)}`);
  } finally {
    database.close();
  }
}

interface CliGetEnvelope {
  readonly status: string;
  readonly active?: boolean;
  readonly item?: {
    readonly id: string;
    readonly recordType: string;
    readonly findingKind?: string;
    readonly candidateKind?: string;
    readonly kind?: string;
    readonly profile?: string;
    readonly commitState?: string;
    readonly fields?: Record<string, unknown>;
  };
}

interface CliError {
  readonly code?: string;
  readonly message?: string;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    return null;
  }
}

function runGet(
  cli: string,
  caseDirectory: string,
  id: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [cli, "get", "--case", caseDirectory, "--id", id, "--json"],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Looks up cited ids with `forensix get --id`. */
export function createResolver(
  caseDirectory: string,
  cli: string,
): RecordResolver {
  return {
    resolve(id) {
      const result = runGet(cli, caseDirectory, id);
      if (result.status !== 0) {
        const error = parseJson<CliError>(result.stderr);
        if (
          error?.code === "RECORD_NOT_FOUND" ||
          error?.code === "INVALID_ARGUMENT"
        ) {
          return null;
        }
        throw new Error(
          `forensix get --id ${id} failed (${String(result.status)}): ${result.stderr}`,
        );
      }
      const envelope = parseJson<CliGetEnvelope>(result.stdout);
      const item = envelope?.item;
      if (item === undefined) {
        throw new Error(`forensix get --id ${id} printed no item`);
      }
      return {
        id: item.id,
        recordType: item.recordType === "candidate" ? "candidate" : "finding",
        kind: item.findingKind ?? item.candidateKind ?? item.kind ?? "",
        profile: item.profile ?? "",
        commitState: item.commitState ?? null,
        active: envelope?.active ?? null,
        fields: item.fields ?? {},
      };
    },
  };
}

/** Every string value inside a record's fields, for content matching. */
export function fieldStrings(record: EvalRecord): string[] {
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(record.fields);
  return strings;
}
