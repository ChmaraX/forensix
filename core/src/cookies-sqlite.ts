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

export type RawCookieValue = RawSqliteValue;
export type VerifiedCookieFile = VerifiedSqliteFile;

export interface RawCookie {
  readonly rowId: RawCookieValue;
  readonly creationUtc: RawCookieValue;
  readonly hostKey: RawCookieValue;
  readonly topFrameSiteKey: RawCookieValue;
  readonly name: RawCookieValue;
  readonly value: RawCookieValue;
  readonly encryptedValue: RawCookieValue;
  readonly path: RawCookieValue;
  readonly expiresUtc: RawCookieValue;
  readonly isSecure: RawCookieValue;
  readonly isHttpOnly: RawCookieValue;
  readonly lastAccessUtc: RawCookieValue;
  readonly hasExpires: RawCookieValue;
  readonly isPersistent: RawCookieValue;
  readonly priority: RawCookieValue;
  readonly samesite: RawCookieValue;
  readonly sourceScheme: RawCookieValue;
  readonly sourcePort: RawCookieValue;
  readonly lastUpdateUtc: RawCookieValue;
  readonly sourceType: RawCookieValue;
  readonly hasCrossSiteAncestor: RawCookieValue;
}

export interface CookieSchema {
  readonly version: number;
  readonly cookieColumns: ReadonlySet<string>;
}

export interface CookiePass {
  readonly schema: CookieSchema;
  readonly rows: readonly RawCookie[];
  readonly integrity: string;
}

export type CookiePasses = SqlitePasses<CookiePass>;

/**
 * Columns every supported Chromium `cookies` schema must expose. The remaining
 * columns are read when present and recorded as an absent Field State when the
 * schema predates them, so a Finding never fabricates a value.
 */
const REQUIRED_COOKIE_COLUMNS = [
  "creation_utc",
  "host_key",
  "name",
  "value",
  "encrypted_value",
  "path",
  "expires_utc",
  "is_secure",
  "is_httponly",
  "last_access_utc",
] as const;

function readSchema(database: DatabaseSync): CookieSchema {
  for (const table of ["meta", "cookies"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Cookies database is missing the ${table} table.`,
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
      "Cookies meta.version is missing or unsupported.",
      { recordedVersion: versionText ?? null },
    );
  }

  const cookieColumns = tableColumns(database, "cookies");
  const missing = REQUIRED_COOKIE_COLUMNS.filter(
    (column) => !cookieColumns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Cookies schema version ${version} is missing required columns.`,
      { version, missingColumns: missing },
    );
  }

  return { version, cookieColumns };
}

function optionalColumn(
  columns: ReadonlySet<string>,
  column: string,
  alias: string,
): string {
  return columns.has(column)
    ? `c."${column}" AS "${alias}"`
    : `NULL AS "${alias}"`;
}

const normalize = (value: unknown): RawCookieValue =>
  normalizeSqliteValue(value, "Cookies");

function readPass(database: DatabaseSync): CookiePass {
  const schema = readSchema(database);
  const column = (name: string, alias: string): string =>
    optionalColumn(schema.cookieColumns, name, alias);
  const statement = database.prepare(`
    SELECT
      c.rowid AS "rowId",
      ${column("creation_utc", "creationUtc")},
      ${column("host_key", "hostKey")},
      ${column("top_frame_site_key", "topFrameSiteKey")},
      ${column("name", "name")},
      ${column("value", "value")},
      ${column("encrypted_value", "encryptedValue")},
      ${column("path", "path")},
      ${column("expires_utc", "expiresUtc")},
      ${column("is_secure", "isSecure")},
      ${column("is_httponly", "isHttpOnly")},
      ${column("last_access_utc", "lastAccessUtc")},
      ${column("has_expires", "hasExpires")},
      ${column("is_persistent", "isPersistent")},
      ${column("priority", "priority")},
      ${column("samesite", "samesite")},
      ${column("source_scheme", "sourceScheme")},
      ${column("source_port", "sourcePort")},
      ${column("last_update_utc", "lastUpdateUtc")},
      ${column("source_type", "sourceType")},
      ${column("has_cross_site_ancestor", "hasCrossSiteAncestor")}
    FROM cookies c
    ORDER BY c.rowid
  `);
  const rows: RawCookie[] = [];
  for (const row of statement.iterate()) {
    rows.push({
      rowId: normalize(row.rowId),
      creationUtc: normalize(row.creationUtc),
      hostKey: normalize(row.hostKey),
      topFrameSiteKey: normalize(row.topFrameSiteKey),
      name: normalize(row.name),
      value: normalize(row.value),
      encryptedValue: normalize(row.encryptedValue),
      path: normalize(row.path),
      expiresUtc: normalize(row.expiresUtc),
      isSecure: normalize(row.isSecure),
      isHttpOnly: normalize(row.isHttpOnly),
      lastAccessUtc: normalize(row.lastAccessUtc),
      hasExpires: normalize(row.hasExpires),
      isPersistent: normalize(row.isPersistent),
      priority: normalize(row.priority),
      samesite: normalize(row.samesite),
      sourceScheme: normalize(row.sourceScheme),
      sourcePort: normalize(row.sourcePort),
      lastUpdateUtc: normalize(row.lastUpdateUtc),
      sourceType: normalize(row.sourceType),
      hasCrossSiteAncestor: normalize(row.hasCrossSiteAncestor),
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

export async function readCookiePasses(options: {
  readonly database: VerifiedCookieFile;
  readonly sidecars: readonly VerifiedCookieFile[];
}): Promise<CookiePasses> {
  // The `cookies` table is a single-table artifact: a sidecar row is kept only
  // when the committed image has no row with the same rowid or holds a
  // different exact image for it.
  return readSqlitePasses({
    artifact: "Cookies",
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
