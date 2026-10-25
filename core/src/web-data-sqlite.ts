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
  type SqlitePasses,
} from "./sqlite-artifact.js";

export type RawWebDataValue = null | string | bigint | Uint8Array;

/**
 * One row of the Chrome `autofill` table, preserved column-by-column exactly as
 * stored. The `autofill` table has no integer primary key — its logical key is
 * `(name, value)` — so the stable SQLite `rowid` is retained as the Provenance
 * row identity. Values keep their raw SQLite type so the Finding layer can
 * classify each Field State (value, absent, or unavailable) without lossy
 * coercion.
 */
export interface RawAutofillRow {
  readonly values: ReadonlyMap<string, RawWebDataValue>;
  readonly rowId: bigint | null;
}

export interface WebDataSchema {
  readonly version: number;
  readonly columns: ReadonlySet<string>;
}

export interface WebDataPass {
  readonly schema: WebDataSchema;
  readonly rows: readonly RawAutofillRow[];
  readonly integrity: string;
}

export type WebDataPasses = SqlitePasses<WebDataPass>;

export interface VerifiedWebDataFile {
  readonly path: string;
  readonly manifestPath: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * Columns the metadata pipeline preserves when present. The `autofill` table is
 * Chrome's form-autocomplete history: one row per distinct submitted
 * (field, value) pair. The `name` column holds the raw HTML form field `name`
 * (or `autocomplete`) attribute as authored by the visited site — for example
 * `email`, `phone`, `tel`, `city`, `address`, or `postal-code` — which is how
 * this table captures form/phone/address/city evidence. It is not Chrome's
 * internal address-book `ServerFieldType` token, and it is not the structured
 * address profiles stored separately in `autofill_profiles` / `contact_info` /
 * `local_addresses`. All values are cleartext, so no decryption is involved.
 */
export const SUPPORTED_AUTOFILL_COLUMNS = [
  "name",
  "value",
  "value_lower",
  "date_created",
  "date_last_used",
  "count",
] as const;

const REQUIRED_AUTOFILL_COLUMNS = ["name", "value"] as const;

function readSchema(database: DatabaseSync): WebDataSchema {
  for (const table of ["meta", "autofill"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Web Data database is missing the ${table} table.`,
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
      "Web Data meta.version is missing or unsupported.",
      { recordedVersion: versionText ?? null },
    );
  }

  const columns = tableColumns(database, "autofill");
  const missing = REQUIRED_AUTOFILL_COLUMNS.filter(
    (column) => !columns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Web Data schema version ${version} is missing required autofill columns.`,
      { version, missingColumns: missing },
    );
  }

  return { version, columns };
}

const normalize = (value: unknown): RawWebDataValue =>
  normalizeSqliteValue(value, "Web Data");

function readPass(database: DatabaseSync): WebDataPass {
  const schema = readSchema(database);
  const selected = SUPPORTED_AUTOFILL_COLUMNS.filter((column) =>
    schema.columns.has(column),
  );
  const projection = selected
    .map((column) => `a."${column}" AS "${column}"`)
    .join(",\n      ");
  const statement = database.prepare(`
    SELECT
      a.rowid AS "__rowid",
      ${projection}
    FROM autofill a
    ORDER BY a.rowid
  `);
  const rows: RawAutofillRow[] = [];
  for (const row of statement.iterate()) {
    const values = new Map<string, RawWebDataValue>();
    for (const column of selected) {
      values.set(column, normalize(row[column]));
    }
    const rawRowId = normalize(row.__rowid);
    rows.push({
      values,
      rowId: typeof rawRowId === "bigint" ? rawRowId : null,
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

export async function readWebDataPasses(options: {
  readonly database: VerifiedWebDataFile;
  readonly sidecars: readonly VerifiedWebDataFile[];
}): Promise<WebDataPasses> {
  // A sidecar row is kept only when the committed image has no row with the
  // same `autofill.rowid` or holds a different exact image for it.
  return readSqlitePasses({
    artifact: "Web Data",
    ...options,
    readPass,
    sidecarOnly: (committed, sidecar) => ({
      ...sidecar,
      rows: sidecarOnlyRows(committed.rows, sidecar.rows, (row) =>
        integerKey(row.rowId),
      ),
    }),
  });
}
