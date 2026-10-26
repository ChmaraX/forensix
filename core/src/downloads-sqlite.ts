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
 * Signals that a History database has no `downloads` table at all. This is a
 * typed, distinct outcome — the table is simply not present, carrying no
 * download evidence — so the artifact layer can classify it as `absent`
 * (inapplicable) by `instanceof` rather than by inspecting an untyped error
 * detail. A corrupt or unreadable database throws a `ForensixError` instead and
 * stays `unavailable`.
 */
export class DownloadsTableAbsentError extends Error {
  public constructor() {
    super("History database is missing the downloads table.");
    this.name = "DownloadsTableAbsentError";
  }
}

/**
 * One node of a download's redirect URL chain, from the
 * `downloads_url_chains` table. `chainIndex` orders the hops (0 is the URL the
 * user or page first requested; the final index is the URL that actually
 * served the bytes). The composite `(id, chain_index)` primary key is retained
 * so each hop carries its own resolvable Provenance row identity.
 */
export interface RawDownloadUrlChainNode {
  readonly chainIndex: bigint | null;
  readonly url: RawSqliteValue;
  readonly rowId: string | null;
}

/**
 * One row of the Chrome `downloads` table, preserved column-by-column exactly
 * as stored, together with its ordered URL chain. Values keep their raw SQLite
 * type so the Finding layer can classify each Field State (value, absent, or
 * unavailable) without lossy coercion.
 */
export interface RawDownloadRow {
  readonly values: ReadonlyMap<string, RawSqliteValue>;
  readonly rowId: bigint | null;
  readonly urlChain: readonly RawDownloadUrlChainNode[];
  readonly urlChainTablePresent: boolean;
}

export interface DownloadsSchema {
  readonly version: number;
  readonly columns: ReadonlySet<string>;
  readonly hasUrlChains: boolean;
}

export interface DownloadsPass {
  readonly schema: DownloadsSchema;
  readonly rows: readonly RawDownloadRow[];
  readonly integrity: string;
}

export type DownloadsPasses = SqlitePasses<DownloadsPass>;

/**
 * Columns the Downloads pipeline preserves when present. The `downloads` table
 * lives inside the History database. `target_path` (and the microsecond
 * `base::Time` timestamps) arrived together at History schema version 24, so
 * requiring `target_path` guarantees the timestamp Epoch Family below.
 */
export const SUPPORTED_DOWNLOAD_COLUMNS = [
  "id",
  "guid",
  "current_path",
  "target_path",
  "start_time",
  "end_time",
  "last_access_time",
  "received_bytes",
  "total_bytes",
  "state",
  "danger_type",
  "interrupt_reason",
  "hash",
  "opened",
  "transient",
  "referrer",
  "site_url",
  "tab_url",
  "tab_referrer_url",
  "http_method",
  "mime_type",
  "original_mime_type",
  "by_ext_id",
  "by_ext_name",
  "by_web_app_id",
  "etag",
  "last_modified",
] as const;

const REQUIRED_DOWNLOAD_COLUMNS = [
  "id",
  "target_path",
  "start_time",
  "state",
] as const;

function readSchema(database: DatabaseSync): DownloadsSchema {
  if (!tableExists(database, "meta")) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "History database is missing the meta table.",
      { table: "meta" },
    );
  }
  // A History database with no `downloads` table simply carries no download
  // evidence. That is `absent` (inapplicable), distinct from a corrupt or
  // unreadable database, which stays `unavailable`. A dedicated typed error
  // lets the artifact layer classify it without conflating the two.
  if (!tableExists(database, "downloads")) {
    throw new DownloadsTableAbsentError();
  }

  const versionRow = database
    .prepare("SELECT value FROM meta WHERE key = 'version' LIMIT 1")
    .get();
  const versionText = versionRow?.value;
  const version =
    typeof versionText === "string" || typeof versionText === "bigint"
      ? Number(versionText)
      : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 15) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "History meta.version is missing or unsupported.",
      { recordedVersion: versionText ?? null },
    );
  }

  const columns = tableColumns(database, "downloads");
  const missing = REQUIRED_DOWNLOAD_COLUMNS.filter(
    (column) => !columns.has(column),
  );
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `Downloads schema version ${version} is missing required downloads columns.`,
      { version, missingColumns: missing },
    );
  }

  return {
    version,
    columns,
    hasUrlChains: tableExists(database, "downloads_url_chains"),
  };
}

const normalize = (value: unknown): RawSqliteValue =>
  normalizeSqliteValue(value, "Downloads");

function readUrlChains(
  database: DatabaseSync,
): ReadonlyMap<string, RawDownloadUrlChainNode[]> {
  const chains = new Map<string, RawDownloadUrlChainNode[]>();
  const statement = database.prepare(
    `SELECT id AS "id", chain_index AS "chainIndex", url AS "url"
       FROM downloads_url_chains
      ORDER BY id, chain_index`,
  );
  for (const row of statement.iterate()) {
    const id = normalize(row.id);
    if (typeof id !== "bigint") {
      continue;
    }
    const chainIndex = normalize(row.chainIndex);
    const key = id.toString();
    const nodes = chains.get(key) ?? [];
    nodes.push({
      chainIndex: typeof chainIndex === "bigint" ? chainIndex : null,
      url: normalize(row.url),
      rowId:
        typeof chainIndex === "bigint"
          ? `${key}:${chainIndex.toString()}`
          : null,
    });
    chains.set(key, nodes);
  }
  return chains;
}

function readPass(database: DatabaseSync): DownloadsPass {
  const schema = readSchema(database);
  const selected = SUPPORTED_DOWNLOAD_COLUMNS.filter((column) =>
    schema.columns.has(column),
  );
  const projection = selected
    .map((column) => `d."${column}" AS "${column}"`)
    .join(",\n      ");
  const chains = schema.hasUrlChains
    ? readUrlChains(database)
    : new Map<string, RawDownloadUrlChainNode[]>();
  const statement = database.prepare(`
    SELECT
      d.rowid AS "__rowid",
      ${projection}
    FROM downloads d
    ORDER BY d.rowid
  `);
  const rows: RawDownloadRow[] = [];
  for (const row of statement.iterate()) {
    const values = new Map<string, RawSqliteValue>();
    for (const column of selected) {
      values.set(column, normalize(row[column]));
    }
    const rawRowId = normalize(row.__rowid);
    const rowId = typeof rawRowId === "bigint" ? rawRowId : null;
    rows.push({
      values,
      rowId,
      urlChain: rowId === null ? [] : (chains.get(rowId.toString()) ?? []),
      urlChainTablePresent: schema.hasUrlChains,
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

export async function readDownloadsPasses(options: {
  readonly database: VerifiedSqliteFile;
  readonly sidecars: readonly VerifiedSqliteFile[];
}): Promise<DownloadsPasses> {
  // A sidecar row (with its URL chain) is kept only when the committed image
  // has no row with the same `downloads.rowid` or holds a different exact
  // image for it.
  return readSqlitePasses({
    artifact: "Downloads",
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
