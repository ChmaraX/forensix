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

export type RawFaviconValue = RawHistoryValue;
export type VerifiedFaviconFile = VerifiedHistoryFile;

/**
 * One `favicon_bitmaps` row: a single stored icon payload at one pixel size,
 * with its raw SQLite values preserved so the Finding layer classifies each
 * Field State without lossy coercion. `imageData` stays a `Uint8Array` when the
 * blob is present so the analyzer can hash it into a separate payload file.
 */
export interface RawFaviconBitmap {
  readonly rowId: RawFaviconValue;
  readonly iconId: RawFaviconValue;
  readonly imageData: RawFaviconValue;
  readonly width: RawFaviconValue;
  readonly height: RawFaviconValue;
  readonly lastUpdated: RawFaviconValue;
  readonly lastRequested: RawFaviconValue;
}

/** One `favicons` row: the icon URL and its type, keyed by `id`. */
export interface RawFaviconRecord {
  readonly rowId: RawFaviconValue;
  readonly url: RawFaviconValue;
  readonly iconType: RawFaviconValue;
}

/** One `icon_mapping` row: a page URL bound to an icon `id`. */
export interface RawIconMapping {
  readonly rowId: RawFaviconValue;
  readonly pageUrl: RawFaviconValue;
  readonly iconId: RawFaviconValue;
}

export interface FaviconSchema {
  readonly version: number;
  readonly bitmapColumns: ReadonlySet<string>;
  readonly faviconColumns: ReadonlySet<string>;
  readonly mappingColumns: ReadonlySet<string>;
}

export interface FaviconPass {
  readonly schema: FaviconSchema;
  readonly bitmaps: readonly RawFaviconBitmap[];
  readonly favicons: readonly RawFaviconRecord[];
  readonly iconMappings: readonly RawIconMapping[];
  readonly integrity: string;
}

export interface RecoveredFaviconPass extends FaviconPass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface FaviconPasses {
  readonly committed: FaviconPass;
  readonly recovered: RecoveredFaviconPass | null;
  readonly recoveryUnavailableReason: string | null;
}

/**
 * Columns every supported Chromium Favicons schema (versions 7 and 8) must
 * expose. `favicon_bitmaps.last_requested` arrived in version 7 and is read
 * when present, recorded as an absent Field State when a schema omits it so a
 * Finding never fabricates a value.
 */
const REQUIRED_BITMAP_COLUMNS = [
  "icon_id",
  "image_data",
  "width",
  "height",
  "last_updated",
] as const;
const REQUIRED_FAVICON_COLUMNS = ["url", "icon_type"] as const;
const REQUIRED_MAPPING_COLUMNS = ["page_url", "icon_id"] as const;

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

function readSchema(database: DatabaseSync): FaviconSchema {
  for (const table of ["meta", "favicons", "favicon_bitmaps", "icon_mapping"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Favicons database is missing the ${table} table.`,
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
      "Favicons meta.version is missing or unsupported.",
      { recorded_version: versionText ?? null },
    );
  }

  const bitmapColumns = tableColumns(database, "favicon_bitmaps");
  const faviconColumns = tableColumns(database, "favicons");
  const mappingColumns = tableColumns(database, "icon_mapping");
  const missing = [
    ...REQUIRED_BITMAP_COLUMNS.filter((column) => !bitmapColumns.has(column)),
    ...REQUIRED_FAVICON_COLUMNS.filter((column) => !faviconColumns.has(column)),
    ...REQUIRED_MAPPING_COLUMNS.filter((column) => !mappingColumns.has(column)),
  ];
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Favicons schema version ${version} is missing required columns.`,
      { version, missing_columns: missing },
    );
  }

  return { version, bitmapColumns, faviconColumns, mappingColumns };
}

function optionalColumn(
  columns: ReadonlySet<string>,
  column: string,
  alias: string,
): string {
  return columns.has(column)
    ? `"${column}" AS "${alias}"`
    : `NULL AS "${alias}"`;
}

function normalizeValue(value: unknown): RawFaviconValue {
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
    "Favicons contains a value that cannot be preserved exactly.",
  );
}

function readPass(database: DatabaseSync): FaviconPass {
  const schema = readSchema(database);
  const bitmapStatement = database.prepare(`
    SELECT
      rowid AS "rowId",
      ${optionalColumn(schema.bitmapColumns, "icon_id", "iconId")},
      ${optionalColumn(schema.bitmapColumns, "image_data", "imageData")},
      ${optionalColumn(schema.bitmapColumns, "width", "width")},
      ${optionalColumn(schema.bitmapColumns, "height", "height")},
      ${optionalColumn(schema.bitmapColumns, "last_updated", "lastUpdated")},
      ${optionalColumn(schema.bitmapColumns, "last_requested", "lastRequested")}
    FROM favicon_bitmaps
    ORDER BY rowid
  `);
  const bitmaps: RawFaviconBitmap[] = [];
  for (const row of bitmapStatement.iterate()) {
    bitmaps.push({
      rowId: normalizeValue(row.rowId),
      iconId: normalizeValue(row.iconId),
      imageData: normalizeValue(row.imageData),
      width: normalizeValue(row.width),
      height: normalizeValue(row.height),
      lastUpdated: normalizeValue(row.lastUpdated),
      lastRequested: normalizeValue(row.lastRequested),
    });
  }

  const faviconStatement = database.prepare(`
    SELECT
      rowid AS "rowId",
      ${optionalColumn(schema.faviconColumns, "url", "url")},
      ${optionalColumn(schema.faviconColumns, "icon_type", "iconType")}
    FROM favicons
    ORDER BY rowid
  `);
  const favicons: RawFaviconRecord[] = [];
  for (const row of faviconStatement.iterate()) {
    favicons.push({
      rowId: normalizeValue(row.rowId),
      url: normalizeValue(row.url),
      iconType: normalizeValue(row.iconType),
    });
  }

  const mappingStatement = database.prepare(`
    SELECT
      rowid AS "rowId",
      ${optionalColumn(schema.mappingColumns, "page_url", "pageUrl")},
      ${optionalColumn(schema.mappingColumns, "icon_id", "iconId")}
    FROM icon_mapping
    ORDER BY rowid
  `);
  const iconMappings: RawIconMapping[] = [];
  for (const row of mappingStatement.iterate()) {
    iconMappings.push({
      rowId: normalizeValue(row.rowId),
      pageUrl: normalizeValue(row.pageUrl),
      iconId: normalizeValue(row.iconId),
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, bitmaps, favicons, iconMappings, integrity };
}

export async function readFaviconPasses(options: {
  readonly database: VerifiedFaviconFile;
  readonly sidecars: readonly VerifiedFaviconFile[];
}): Promise<FaviconPasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-favicons-snapshot-"),
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
    let committed: FaviconPass;
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
        recovered: { ...fullRecoveryPass, commitState },
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
