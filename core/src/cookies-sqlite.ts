import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CommitState } from "./forensic-model.js";
import { ForensixError } from "./errors.js";
import { openDatabaseSync } from "./sqlite-open.js";
import {
  immutableDatabase,
  snapshotVerifiedFile,
  type RawHistoryValue,
  type VerifiedHistoryFile,
} from "./history-sqlite.js";

export type RawCookieValue = RawHistoryValue;
export type VerifiedCookieFile = VerifiedHistoryFile;

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

export interface RecoveredCookiePass extends CookiePass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface CookiePasses {
  readonly committed: CookiePass;
  readonly recovered: RecoveredCookiePass | null;
  readonly recoveryUnavailableReason: string | null;
}

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

function tableExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table) !== undefined
  );
}

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    database
      .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
      .all(table)
      .map((row) => String(row.name)),
  );
}

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
      { recorded_version: versionText ?? null },
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
      { version, missing_columns: missing },
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

function normalizeValue(value: unknown): RawCookieValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new ForensixError(
    "ANALYSIS_FAILED",
    "Cookies contains a value that cannot be preserved exactly.",
  );
}

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
      rowId: normalizeValue(row.rowId),
      creationUtc: normalizeValue(row.creationUtc),
      hostKey: normalizeValue(row.hostKey),
      topFrameSiteKey: normalizeValue(row.topFrameSiteKey),
      name: normalizeValue(row.name),
      value: normalizeValue(row.value),
      encryptedValue: normalizeValue(row.encryptedValue),
      path: normalizeValue(row.path),
      expiresUtc: normalizeValue(row.expiresUtc),
      isSecure: normalizeValue(row.isSecure),
      isHttpOnly: normalizeValue(row.isHttpOnly),
      lastAccessUtc: normalizeValue(row.lastAccessUtc),
      hasExpires: normalizeValue(row.hasExpires),
      isPersistent: normalizeValue(row.isPersistent),
      priority: normalizeValue(row.priority),
      samesite: normalizeValue(row.samesite),
      sourceScheme: normalizeValue(row.sourceScheme),
      sourcePort: normalizeValue(row.sourcePort),
      lastUpdateUtc: normalizeValue(row.lastUpdateUtc),
      sourceType: normalizeValue(row.sourceType),
      hasCrossSiteAncestor: normalizeValue(row.hasCrossSiteAncestor),
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, rows, integrity };
}

function fingerprint(values: readonly RawCookieValue[]): string {
  return JSON.stringify(values, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return `${value.toString()}n`;
    }
    if (value instanceof Uint8Array) {
      return `blob:${Buffer.from(value).toString("hex")}`;
    }
    return value;
  });
}

function cookieFingerprint(row: RawCookie): string {
  return fingerprint([
    row.creationUtc,
    row.hostKey,
    row.topFrameSiteKey,
    row.name,
    row.value,
    row.encryptedValue,
    row.path,
    row.expiresUtc,
    row.isSecure,
    row.isHttpOnly,
    row.lastAccessUtc,
    row.hasExpires,
    row.isPersistent,
    row.priority,
    row.samesite,
    row.sourceScheme,
    row.sourcePort,
    row.lastUpdateUtc,
    row.sourceType,
    row.hasCrossSiteAncestor,
  ]);
}

function rowId(row: RawCookie): string | null {
  return typeof row.rowId === "bigint" ? row.rowId.toString() : null;
}

/**
 * The `cookies` table is a single-table artifact, so a recovered row belongs to
 * the sidecar Commit State only when the committed image has no row with the
 * same rowid or holds a different exact byte image for it.
 */
function recoveredOnlyCookies(
  committed: readonly RawCookie[],
  recovered: readonly RawCookie[],
): RawCookie[] {
  const committedByRowId = new Map(
    committed.flatMap((row) => {
      const id = rowId(row);
      return id === null ? [] : [[id, cookieFingerprint(row)] as const];
    }),
  );
  const rows: RawCookie[] = [];
  for (const row of recovered) {
    const id = rowId(row);
    const committedFingerprint =
      id === null ? undefined : committedByRowId.get(id);
    if (
      committedFingerprint === undefined ||
      committedFingerprint !== cookieFingerprint(row)
    ) {
      rows.push(row);
    }
  }
  return rows;
}

export async function readCookiePasses(options: {
  readonly database: VerifiedCookieFile;
  readonly sidecars: readonly VerifiedCookieFile[];
}): Promise<CookiePasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-cookies-snapshot-"),
  );
  const temporaryDatabasePath = join(
    temporaryDirectory,
    basename(options.database.path),
  );
  try {
    await snapshotVerifiedFile(options.database, temporaryDatabasePath);
    for (const sidecar of options.sidecars) {
      await snapshotVerifiedFile(
        sidecar,
        join(temporaryDirectory, basename(sidecar.path)),
      );
    }

    const committedDatabase = immutableDatabase(temporaryDatabasePath);
    let committed: CookiePass;
    try {
      committed = readPass(committedDatabase);
    } finally {
      committedDatabase.close();
    }

    const wal = options.sidecars.find((sidecar) =>
      sidecar.path.endsWith("-wal"),
    );
    const journal = options.sidecars.find((sidecar) =>
      sidecar.path.endsWith("-journal"),
    );
    const commitState =
      wal === undefined
        ? journal === undefined
          ? null
          : "journal_resident"
        : "wal_resident";
    if (commitState === null) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: "sidecar_not_supplied",
      };
    }

    let recoveryDatabase: DatabaseSync;
    try {
      recoveryDatabase = openDatabaseSync(temporaryDatabasePath, {
        readBigInts: true,
      });
    } catch (error) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_open_failed:${String(error)}`,
      };
    }
    try {
      const fullRecoveryPass = readPass(recoveryDatabase);
      return {
        committed,
        recovered: {
          ...fullRecoveryPass,
          rows: recoveredOnlyCookies(committed.rows, fullRecoveryPass.rows),
          commitState,
        },
        recoveryUnavailableReason: null,
      };
    } catch (error) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_read_failed:${String(error)}`,
      };
    } finally {
      recoveryDatabase.close();
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
