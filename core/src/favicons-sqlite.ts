import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import {
  normalizeSqliteValue,
  readIntegrity,
  readSqlitePasses,
  tableColumns,
  tableExists,
  type RawSqliteValue,
  type SqlitePasses,
  type VerifiedSqliteFile,
} from "./sqlite-artifact.js";

export type RawFaviconValue = RawSqliteValue;
export type VerifiedFaviconFile = VerifiedSqliteFile;

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

export type FaviconPasses = SqlitePasses<FaviconPass>;

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
      { recordedVersion: versionText ?? null },
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
      { version, missingColumns: missing },
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

const normalize = (value: unknown): RawFaviconValue =>
  normalizeSqliteValue(value, "Favicons");

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
      rowId: normalize(row.rowId),
      iconId: normalize(row.iconId),
      imageData: normalize(row.imageData),
      width: normalize(row.width),
      height: normalize(row.height),
      lastUpdated: normalize(row.lastUpdated),
      lastRequested: normalize(row.lastRequested),
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
      rowId: normalize(row.rowId),
      url: normalize(row.url),
      iconType: normalize(row.iconType),
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
      rowId: normalize(row.rowId),
      pageUrl: normalize(row.pageUrl),
      iconId: normalize(row.iconId),
    });
  }

  return {
    schema,
    bitmaps,
    favicons,
    iconMappings,
    integrity: readIntegrity(database),
  };
}

export async function readFaviconPasses(options: {
  readonly database: VerifiedFaviconFile;
  readonly sidecars: readonly VerifiedFaviconFile[];
}): Promise<FaviconPasses> {
  return readSqlitePasses({
    artifact: "Favicons",
    ...options,
    readPass,
    // The sidecar pass stays complete: a Favicon joins three tables, so the
    // Finding layer compares built Finding signatures with the committed pass.
    sidecarOnly: (_committed, sidecar) => sidecar,
  });
}
