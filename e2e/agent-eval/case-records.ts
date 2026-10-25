/**
 * Record lookup for the agent eval: does a cited record id exist, and what
 * does the record hold?
 *
 * Primary path: `forensix get --case <case> --id <id> --json` (PLAN A3/B2).
 * Fallback path, while that command does not exist: a read-only lookup in
 * `case.fxdb`. A record id is `<store>:<rowid>` (PLAN A2). The fallback maps the
 * store key to its storage table with `STORE_TABLES`.
 *
 * The store keys copy core's record-store table (core/src/record-store.ts).
 * The deterministic test compares the ids that the CLI prints with
 * `locateRecords`, so a change in core fails that test.
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
  /** `cli-get` once `forensix get --id` exists, else `case-db`. */
  readonly via: "cli-get" | "case-db";
  /** The record, or null when the id is malformed or names no record. */
  resolve(id: string): EvalRecord | null;
}

const ID_PATTERN = /^([a-z][a-z0-9-]*):([1-9][0-9]*)$/;

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

function toRecord(id: string, row: Row): EvalRecord {
  return {
    id,
    recordType: row.record_type === "candidate" ? "candidate" : "finding",
    kind: row.kind,
    profile: row.profile_path,
    commitState: row.commit_state,
    active: row.active === null ? null : row.active === 1,
    fields: JSON.parse(row.fields_json) as Record<string, unknown>,
  };
}

function openCaseDatabase(caseDirectory: string): DatabaseSync {
  return new DatabaseSync(join(caseDirectory, "case.fxdb"), {
    readOnly: true,
  });
}

/** Read-only lookup of one id in `case.fxdb`. */
export function lookupInCaseDatabase(
  caseDirectory: string,
  id: string,
): EvalRecord | null {
  const match = ID_PATTERN.exec(id.trim());
  const store = match === null ? undefined : storeTable(match[1] ?? "");
  if (match === null || store === undefined) {
    return null;
  }
  const database = openCaseDatabase(caseDirectory);
  try {
    const row = database
      .prepare(selectSql(database, store, `t.${store.idColumn} = ?`))
      .get(Number(match[2])) as Row | undefined;
    return row === undefined ? null : toRecord(id.trim(), row);
  } finally {
    database.close();
  }
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

/** True when the compiled CLI answers `get --id` (found or RECORD_NOT_FOUND). */
export function cliHasGet(cli: string, caseDirectory: string): boolean {
  const probe = runGet(cli, caseDirectory, "history:1");
  if (probe.status === 0) {
    return true;
  }
  const error = parseJson<CliError>(probe.stderr);
  return error?.code === "RECORD_NOT_FOUND";
}

function cliResolver(cli: string, caseDirectory: string): RecordResolver {
  return {
    via: "cli-get",
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

/** `forensix get --id` when the CLI has it, else the read-only fallback. */
export function createResolver(
  caseDirectory: string,
  cli: string,
): RecordResolver {
  if (cliHasGet(cli, caseDirectory)) {
    return cliResolver(cli, caseDirectory);
  }
  return {
    via: "case-db",
    resolve: (id) => lookupInCaseDatabase(caseDirectory, id),
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
