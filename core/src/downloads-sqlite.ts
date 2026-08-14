import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import type { CommitState } from "./forensic-model.js";
import {
  immutableDatabase,
  snapshotVerifiedFile,
  type VerifiedHistoryFile,
} from "./history-sqlite.js";
import { openDatabaseSync } from "./sqlite-open.js";

export type RawDownloadValue = null | string | bigint | Uint8Array;

/**
 * One node of a download's redirect URL chain, from the
 * `downloads_url_chains` table. `chainIndex` orders the hops (0 is the URL the
 * user or page first requested; the final index is the URL that actually
 * served the bytes). The composite `(id, chain_index)` primary key is retained
 * so each hop carries its own resolvable Provenance row identity.
 */
export interface RawDownloadUrlChainNode {
  readonly chainIndex: bigint | null;
  readonly url: RawDownloadValue;
  readonly rowId: string | null;
}

/**
 * One row of the Chrome `downloads` table, preserved column-by-column exactly
 * as stored, together with its ordered URL chain. Values keep their raw SQLite
 * type so the Finding layer can classify each Field State (value, absent, or
 * unavailable) without lossy coercion.
 */
export interface RawDownloadRow {
  readonly values: ReadonlyMap<string, RawDownloadValue>;
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

export interface RecoveredDownloadsPass extends DownloadsPass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface DownloadsPasses {
  readonly committed: DownloadsPass;
  readonly recovered: RecoveredDownloadsPass | null;
  readonly recoveryUnavailableReason: string | null;
}

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
  // unreadable database, which stays `unavailable`. The flag lets the artifact
  // layer classify it without conflating the two.
  if (!tableExists(database, "downloads")) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "History database is missing the downloads table.",
      { table: "downloads", downloads_table_absent: true },
    );
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
      { recorded_version: versionText ?? null },
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
      { version, missing_columns: missing },
    );
  }

  return {
    version,
    columns,
    hasUrlChains: tableExists(database, "downloads_url_chains"),
  };
}

function normalizeValue(value: unknown): RawDownloadValue {
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
    "Downloads contains a value that cannot be preserved exactly.",
  );
}

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
    const id = normalizeValue(row.id);
    if (typeof id !== "bigint") {
      continue;
    }
    const chainIndex = normalizeValue(row.chainIndex);
    const key = id.toString();
    const nodes = chains.get(key) ?? [];
    nodes.push({
      chainIndex: typeof chainIndex === "bigint" ? chainIndex : null,
      url: normalizeValue(row.url),
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
    const values = new Map<string, RawDownloadValue>();
    for (const column of selected) {
      values.set(column, normalizeValue(row[column]));
    }
    const rawRowId = normalizeValue(row.__rowid);
    const rowId = typeof rawRowId === "bigint" ? rawRowId : null;
    rows.push({
      values,
      rowId,
      urlChain: rowId === null ? [] : (chains.get(rowId.toString()) ?? []),
      urlChainTablePresent: schema.hasUrlChains,
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, rows, integrity };
}

function fingerprint(row: RawDownloadRow): string {
  return JSON.stringify(
    {
      values: [...row.values.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
      chain: row.urlChain.map((node) => [
        node.chainIndex === null ? null : node.chainIndex.toString(),
        node.url,
      ]),
    },
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return `${value.toString()}n`;
      }
      if (value instanceof Uint8Array) {
        return `blob:${Buffer.from(value).toString("base64")}`;
      }
      return value;
    },
  );
}

/**
 * Return only rows that a WAL or rollback journal adds or changes relative to
 * the committed database, keyed by `downloads.rowid`. This keeps recovered
 * evidence separate from committed evidence, mirroring the History and Web Data
 * recovery contract.
 */
function recoveredOnlyRows(
  committed: readonly RawDownloadRow[],
  recovered: readonly RawDownloadRow[],
): RawDownloadRow[] {
  const committedByRowId = new Map(
    committed.flatMap((row) =>
      row.rowId === null
        ? []
        : [[row.rowId.toString(), fingerprint(row)] as const],
    ),
  );
  const rows: RawDownloadRow[] = [];
  for (const row of recovered) {
    const id = row.rowId === null ? null : row.rowId.toString();
    const committedFingerprint =
      id === null ? undefined : committedByRowId.get(id);
    if (
      committedFingerprint === undefined ||
      committedFingerprint !== fingerprint(row)
    ) {
      rows.push(row);
    }
  }
  return rows;
}

export async function readDownloadsPasses(options: {
  readonly database: VerifiedHistoryFile;
  readonly sidecars: readonly VerifiedHistoryFile[];
}): Promise<DownloadsPasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-downloads-snapshot-"),
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
    let committed: DownloadsPass;
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
          rows: recoveredOnlyRows(committed.rows, fullRecoveryPass.rows),
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
