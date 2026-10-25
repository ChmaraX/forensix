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

export type RawTopSiteValue = RawSqliteValue;
export type VerifiedTopSiteFile = VerifiedSqliteFile;

/**
 * One row of the Chromium `top_sites` table, preserved column-by-column exactly
 * as stored. Values keep their raw SQLite type so the Finding layer can classify
 * each Field State (value, absent, or unavailable) without lossy coercion.
 */
export interface RawTopSite {
  readonly rowId: RawTopSiteValue;
  readonly url: RawTopSiteValue;
  readonly urlRank: RawTopSiteValue;
  readonly title: RawTopSiteValue;
  readonly redirects: RawTopSiteValue;
}

export interface TopSiteSchema {
  readonly version: number;
  readonly columns: ReadonlySet<string>;
}

export interface TopSitePass {
  readonly schema: TopSiteSchema;
  readonly rows: readonly RawTopSite[];
  readonly integrity: string;
}

export type TopSitePasses = SqlitePasses<TopSitePass>;

/**
 * Columns every supported Chromium `top_sites` schema must expose. Schema
 * version 4 added a `redirects` column (unused since 2019) that version 5
 * dropped; it is read when present and recorded as an absent Field State when
 * the schema omits it, so a Finding never fabricates a value.
 */
const REQUIRED_TOP_SITE_COLUMNS = ["url", "url_rank", "title"] as const;

function readSchema(database: DatabaseSync): TopSiteSchema {
  for (const table of ["meta", "top_sites"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `Top Sites database is missing the ${table} table.`,
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
      "Top Sites meta.version is missing or unsupported.",
      { recordedVersion: versionText ?? null },
    );
  }

  const columns = tableColumns(database, "top_sites");
  const missing = REQUIRED_TOP_SITE_COLUMNS.filter(
    (column) => !columns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Top Sites schema version ${version} is missing required columns.`,
      { version, missingColumns: missing },
    );
  }

  return { version, columns };
}

function optionalColumn(
  columns: ReadonlySet<string>,
  column: string,
  alias: string,
): string {
  return columns.has(column)
    ? `t."${column}" AS "${alias}"`
    : `NULL AS "${alias}"`;
}

const normalize = (value: unknown): RawTopSiteValue =>
  normalizeSqliteValue(value, "Top Sites");

function readPass(database: DatabaseSync): TopSitePass {
  const schema = readSchema(database);
  const column = (name: string, alias: string): string =>
    optionalColumn(schema.columns, name, alias);
  const statement = database.prepare(`
    SELECT
      t.rowid AS "rowId",
      ${column("url", "url")},
      ${column("url_rank", "urlRank")},
      ${column("title", "title")},
      ${column("redirects", "redirects")}
    FROM top_sites t
    ORDER BY t.rowid
  `);
  const rows: RawTopSite[] = [];
  for (const row of statement.iterate()) {
    rows.push({
      rowId: normalize(row.rowId),
      url: normalize(row.url),
      urlRank: normalize(row.urlRank),
      title: normalize(row.title),
      redirects: normalize(row.redirects),
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

export async function readTopSitePasses(options: {
  readonly database: VerifiedTopSiteFile;
  readonly sidecars: readonly VerifiedTopSiteFile[];
}): Promise<TopSitePasses> {
  // The `top_sites` table is a single-table artifact: a sidecar row is kept
  // only when the committed image has no row with the same rowid or holds a
  // different exact image for it.
  return readSqlitePasses({
    artifact: "Top Sites",
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
