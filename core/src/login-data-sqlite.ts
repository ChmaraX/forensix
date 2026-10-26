import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import {
  integerKey,
  normalizeSqliteValue,
  readIntegrity,
  readSqlitePasses,
  sidecarOnlyRows,
  tableColumns,
  tableExists,
  type RawSqliteValue,
  type SqlitePasses,
  type VerifiedSqliteFile,
} from "./sqlite-artifact.js";

/**
 * One row of the Chrome `logins` table, preserved column-by-column exactly as
 * stored. Values keep their raw SQLite type so the Finding layer can classify
 * each Field State (value, absent, or unavailable) without lossy coercion.
 */
export interface RawLoginRow {
  readonly values: ReadonlyMap<string, RawSqliteValue>;
  readonly id: bigint | null;
}

export interface LoginSchema {
  readonly version: number;
  readonly columns: ReadonlySet<string>;
}

export interface LoginPass {
  readonly schema: LoginSchema;
  readonly rows: readonly RawLoginRow[];
  readonly integrity: string;
}

export type LoginPasses = SqlitePasses<LoginPass>;

/**
 * Columns the metadata pipeline preserves when present. `password_value` is the
 * encrypted secret blob; it is retained here only so its wrapper prefix and byte
 * length can be described. The plaintext secret is never derived.
 */
export const SUPPORTED_LOGIN_COLUMNS = [
  "id",
  "origin_url",
  "action_url",
  "signon_realm",
  "username_element",
  "username_value",
  "password_element",
  "password_value",
  "date_created",
  "date_last_used",
  "date_password_modified",
  "blacklisted_by_user",
  "scheme",
  "password_type",
  "times_used",
  "display_name",
  "icon_url",
  "federation_url",
  "skip_zero_click",
  "generation_upload_status",
] as const;

const REQUIRED_LOGIN_COLUMNS = [
  "id",
  "origin_url",
  "signon_realm",
  "username_value",
  "password_value",
  "date_created",
] as const;

function readSchema(database: DatabaseSync): LoginSchema {
  for (const table of ["meta", "logins"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Login Data database is missing the ${table} table.`,
        { table },
      );
    }
  }

  const versionRow = database
    .prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 1")
    .get();
  const versionText = versionRow?.value;
  const version =
    typeof versionText === "string" || typeof versionText === "bigint"
      ? Number(versionText)
      : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "Login Data meta.version is missing or unsupported.",
      { recordedVersion: versionText ?? null },
    );
  }

  const columns = tableColumns(database, "logins");
  const missing = REQUIRED_LOGIN_COLUMNS.filter(
    (column) => !columns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Login Data schema version ${version} is missing required logins columns.`,
      { version, missingColumns: missing },
    );
  }

  return { version, columns };
}

const normalize = (value: unknown): RawSqliteValue =>
  normalizeSqliteValue(value, "Login Data");

function readPass(database: DatabaseSync): LoginPass {
  const schema = readSchema(database);
  const selected = SUPPORTED_LOGIN_COLUMNS.filter((column) =>
    schema.columns.has(column),
  );
  const projection = selected
    .map((column) => `l."${column}" AS "${column}"`)
    .join(",\n      ");
  const statement = database.prepare(`
    SELECT
      ${projection}
    FROM logins l
    ORDER BY l."id"
  `);
  const rows: RawLoginRow[] = [];
  for (const row of statement.iterate()) {
    const values = new Map<string, RawSqliteValue>();
    for (const column of selected) {
      values.set(column, normalize(row[column]));
    }
    const idValue = values.get("id");
    rows.push({
      values,
      id: typeof idValue === "bigint" ? idValue : null,
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

export async function readLoginPasses(options: {
  readonly database: VerifiedSqliteFile;
  readonly sidecars: readonly VerifiedSqliteFile[];
}): Promise<LoginPasses> {
  // A sidecar row is kept only when the committed image has no row with the
  // same `logins.id` or holds a different exact image for it.
  return readSqlitePasses({
    artifact: "Login Data",
    ...options,
    readPass,
    sidecarOnly: (committed, sidecar) => ({
      ...sidecar,
      rows: sidecarOnlyRows(committed.rows, sidecar.rows, (row) =>
        integerKey(row.id),
      ),
    }),
  });
}
