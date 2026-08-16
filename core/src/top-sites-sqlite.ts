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
  tableColumns,
  tableExists,
  type RawSqliteValue,
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

export interface RecoveredTopSitePass extends TopSitePass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface TopSitePasses {
  readonly committed: TopSitePass;
  readonly recovered: RecoveredTopSitePass | null;
  readonly recoveryUnavailableReason: string | null;
}

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
      { recorded_version: versionText ?? null },
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
      { version, missing_columns: missing },
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

function normalizeValue(value: unknown): RawTopSiteValue {
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
    "Top Sites contains a value that cannot be preserved exactly.",
  );
}

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
      rowId: normalizeValue(row.rowId),
      url: normalizeValue(row.url),
      urlRank: normalizeValue(row.urlRank),
      title: normalizeValue(row.title),
      redirects: normalizeValue(row.redirects),
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, rows, integrity };
}

function fingerprint(values: readonly RawTopSiteValue[]): string {
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

function topSiteFingerprint(row: RawTopSite): string {
  return fingerprint([row.url, row.urlRank, row.title, row.redirects]);
}

function rowId(row: RawTopSite): string | null {
  return typeof row.rowId === "bigint" ? row.rowId.toString() : null;
}

/**
 * The `top_sites` table is a single-table artifact, so a recovered row belongs
 * to the sidecar Commit State only when the committed image has no row with the
 * same rowid or holds a different exact byte image for it. This mirrors the
 * History and Cookies recovery contracts.
 */
function recoveredOnlyTopSites(
  committed: readonly RawTopSite[],
  recovered: readonly RawTopSite[],
): RawTopSite[] {
  const committedByRowId = new Map(
    committed.flatMap((row) => {
      const id = rowId(row);
      return id === null ? [] : [[id, topSiteFingerprint(row)] as const];
    }),
  );
  const rows: RawTopSite[] = [];
  for (const row of recovered) {
    const id = rowId(row);
    const committedFingerprint =
      id === null ? undefined : committedByRowId.get(id);
    if (
      committedFingerprint === undefined ||
      committedFingerprint !== topSiteFingerprint(row)
    ) {
      rows.push(row);
    }
  }
  return rows;
}

export async function readTopSitePasses(options: {
  readonly database: VerifiedTopSiteFile;
  readonly sidecars: readonly VerifiedTopSiteFile[];
}): Promise<TopSitePasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-top-sites-snapshot-"),
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
    let committed: TopSitePass;
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
          rows: recoveredOnlyTopSites(committed.rows, fullRecoveryPass.rows),
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
