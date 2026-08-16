import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import { openDatabaseSync } from "./sqlite-open.js";
import type { CommitState } from "./forensic-model.js";
import {
  immutableDatabase,
  snapshotVerifiedFile,
  tableColumns,
  tableExists,
  type RawSqliteValue,
  type VerifiedSqliteFile,
} from "./sqlite-artifact.js";

// The shared verified-SQLite helpers live in `sqlite-artifact.ts`. These
// aliases and re-exports preserve this module's historical public surface so
// existing importers keep working unchanged.
export { immutableDatabase, snapshotVerifiedFile };
export type RawHistoryValue = RawSqliteValue;
export type VerifiedHistoryFile = VerifiedSqliteFile;
export type HistorySourceTable = "visits" | "urls" | "visit_source";

export interface SidecarSourceRow {
  readonly table: HistorySourceTable;
  readonly rowId: string;
}

export interface RawHistoryVisit {
  readonly visitId: RawHistoryValue;
  readonly urlId: RawHistoryValue;
  readonly visitTime: RawHistoryValue;
  readonly fromVisit: RawHistoryValue;
  readonly externalReferrerUrl: RawHistoryValue;
  readonly transition: RawHistoryValue;
  readonly segmentId: RawHistoryValue;
  readonly visitDuration: RawHistoryValue;
  readonly incrementedOmniboxTypedScore: RawHistoryValue;
  readonly openerVisit: RawHistoryValue;
  readonly originatorCacheGuid: RawHistoryValue;
  readonly originatorVisitId: RawHistoryValue;
  readonly originatorFromVisit: RawHistoryValue;
  readonly originatorOpenerVisit: RawHistoryValue;
  readonly isKnownToSync: RawHistoryValue;
  readonly considerForNtpMostVisited: RawHistoryValue;
  readonly visitedLinkId: RawHistoryValue;
  readonly appId: RawHistoryValue;
  readonly urlRecordId: RawHistoryValue;
  readonly url: RawHistoryValue;
  readonly title: RawHistoryValue;
  readonly urlVisitCount: RawHistoryValue;
  readonly typedCount: RawHistoryValue;
  readonly lastVisitTime: RawHistoryValue;
  readonly hidden: RawHistoryValue;
  readonly visitSource: RawHistoryValue;
  readonly sidecarTables: readonly HistorySourceTable[];
  readonly sidecarRows: readonly SidecarSourceRow[];
}

export interface HistorySchema {
  readonly version: number;
  readonly visitColumns: ReadonlySet<string>;
  readonly urlColumns: ReadonlySet<string>;
  readonly hasVisitSource: boolean;
}

export interface HistoryPass {
  readonly schema: HistorySchema;
  readonly rows: readonly RawHistoryVisit[];
  readonly integrity: string;
}

export interface RecoveredHistoryPass extends HistoryPass {
  readonly commitState: Exclude<CommitState, "committed">;
}

export interface HistoryPasses {
  readonly committed: HistoryPass;
  readonly recovered: RecoveredHistoryPass | null;
  readonly recoveryUnavailableReason: string | null;
}

const REQUIRED_VISIT_COLUMNS = [
  "id",
  "url",
  "visit_time",
  "from_visit",
  "transition",
] as const;
const CURRENT_VISIT_COLUMNS = [
  ...REQUIRED_VISIT_COLUMNS,
  "external_referrer_url",
  "segment_id",
  "visit_duration",
  "incremented_omnibox_typed_score",
  "opener_visit",
  "originator_cache_guid",
  "originator_visit_id",
  "originator_from_visit",
  "originator_opener_visit",
  "is_known_to_sync",
  "consider_for_ntp_most_visited",
  "visited_link_id",
  "app_id",
] as const;
const POST_VERSION_16_VISIT_COLUMNS = [
  "external_referrer_url",
  "opener_visit",
  "originator_cache_guid",
  "originator_visit_id",
  "originator_from_visit",
  "originator_opener_visit",
  "is_known_to_sync",
  "consider_for_ntp_most_visited",
  "visited_link_id",
  "app_id",
] as const;
const REQUIRED_URL_COLUMNS = [
  "id",
  "url",
  "title",
  "visit_count",
  "typed_count",
  "last_visit_time",
  "hidden",
] as const;

function requireColumns(
  actual: ReadonlySet<string>,
  expected: readonly string[],
  table: string,
  version: number,
): void {
  const missing = expected.filter((column) => !actual.has(column));
  if (missing.length > 0) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      `History schema version ${version} is missing required ${table} columns.`,
      { table, version, missing_columns: missing },
    );
  }
}

function readSchema(database: DatabaseSync): HistorySchema {
  for (const table of ["meta", "urls", "visits"]) {
    if (!tableExists(database, table)) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `History database is missing the ${table} table.`,
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
  if (!Number.isSafeInteger(version) || version < 15) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "History meta.version is missing or unsupported.",
      { recorded_version: versionText ?? null },
    );
  }

  const visitColumns = tableColumns(database, "visits");
  const urlColumns = tableColumns(database, "urls");
  requireColumns(visitColumns, REQUIRED_VISIT_COLUMNS, "visits", version);
  requireColumns(urlColumns, REQUIRED_URL_COLUMNS, "urls", version);
  if (version >= 70) {
    requireColumns(visitColumns, CURRENT_VISIT_COLUMNS, "visits", version);
  }
  const hasVisitSource = tableExists(database, "visit_source");
  if (
    version <= 16 &&
    (hasVisitSource ||
      POST_VERSION_16_VISIT_COLUMNS.some((column) => visitColumns.has(column)))
  ) {
    throw new ForensixError(
      "ANALYSIS_FAILED",
      "History meta.version does not agree with the visits schema.",
      { recorded_version: version },
    );
  }

  return {
    version,
    visitColumns,
    urlColumns,
    hasVisitSource,
  };
}

function optionalColumn(
  columns: ReadonlySet<string>,
  tableAlias: string,
  column: string,
  alias: string,
): string {
  return columns.has(column)
    ? `${tableAlias}."${column}" AS "${alias}"`
    : `NULL AS "${alias}"`;
}

function normalizeValue(value: unknown): RawHistoryValue {
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
    "History contains a value that cannot be preserved exactly.",
  );
}

function readPass(database: DatabaseSync): HistoryPass {
  const schema = readSchema(database);
  const visit = (column: string, alias: string): string =>
    optionalColumn(schema.visitColumns, "v", column, alias);
  const url = (column: string, alias: string): string =>
    optionalColumn(schema.urlColumns, "u", column, alias);
  const visitSourceSelect = schema.hasVisitSource
    ? "vs.source AS visitSource"
    : "NULL AS visitSource";
  const visitSourceJoin = schema.hasVisitSource
    ? "LEFT JOIN visit_source vs ON vs.id = v.id"
    : "";
  const statement = database.prepare(`
    SELECT
      ${visit("id", "visitId")},
      ${visit("url", "urlId")},
      ${visit("visit_time", "visitTime")},
      ${visit("from_visit", "fromVisit")},
      ${visit("external_referrer_url", "externalReferrerUrl")},
      ${visit("transition", "transition")},
      ${visit("segment_id", "segmentId")},
      ${visit("visit_duration", "visitDuration")},
      ${visit("incremented_omnibox_typed_score", "incrementedOmniboxTypedScore")},
      ${visit("opener_visit", "openerVisit")},
      ${visit("originator_cache_guid", "originatorCacheGuid")},
      ${visit("originator_visit_id", "originatorVisitId")},
      ${visit("originator_from_visit", "originatorFromVisit")},
      ${visit("originator_opener_visit", "originatorOpenerVisit")},
      ${visit("is_known_to_sync", "isKnownToSync")},
      ${visit("consider_for_ntp_most_visited", "considerForNtpMostVisited")},
      ${visit("visited_link_id", "visitedLinkId")},
      ${visit("app_id", "appId")},
      ${url("id", "urlRecordId")},
      ${url("url", "url")},
      ${url("title", "title")},
      ${url("visit_count", "urlVisitCount")},
      ${url("typed_count", "typedCount")},
      ${url("last_visit_time", "lastVisitTime")},
      ${url("hidden", "hidden")},
      ${visitSourceSelect}
    FROM visits v
    LEFT JOIN urls u ON u.id = v.url
    ${visitSourceJoin}
    ORDER BY v.id
  `);
  const rows: RawHistoryVisit[] = [];
  for (const row of statement.iterate()) {
    rows.push({
      visitId: normalizeValue(row.visitId),
      urlId: normalizeValue(row.urlId),
      visitTime: normalizeValue(row.visitTime),
      fromVisit: normalizeValue(row.fromVisit),
      externalReferrerUrl: normalizeValue(row.externalReferrerUrl),
      transition: normalizeValue(row.transition),
      segmentId: normalizeValue(row.segmentId),
      visitDuration: normalizeValue(row.visitDuration),
      incrementedOmniboxTypedScore: normalizeValue(
        row.incrementedOmniboxTypedScore,
      ),
      openerVisit: normalizeValue(row.openerVisit),
      originatorCacheGuid: normalizeValue(row.originatorCacheGuid),
      originatorVisitId: normalizeValue(row.originatorVisitId),
      originatorFromVisit: normalizeValue(row.originatorFromVisit),
      originatorOpenerVisit: normalizeValue(row.originatorOpenerVisit),
      isKnownToSync: normalizeValue(row.isKnownToSync),
      considerForNtpMostVisited: normalizeValue(row.considerForNtpMostVisited),
      visitedLinkId: normalizeValue(row.visitedLinkId),
      appId: normalizeValue(row.appId),
      urlRecordId: normalizeValue(row.urlRecordId),
      url: normalizeValue(row.url),
      title: normalizeValue(row.title),
      urlVisitCount: normalizeValue(row.urlVisitCount),
      typedCount: normalizeValue(row.typedCount),
      lastVisitTime: normalizeValue(row.lastVisitTime),
      hidden: normalizeValue(row.hidden),
      visitSource: normalizeValue(row.visitSource),
      sidecarTables: [],
      sidecarRows: [],
    });
  }

  const integrityRow = database.prepare("PRAGMA integrity_check(1)").get();
  const integrity = String(integrityRow?.integrity_check ?? "unavailable");
  return { schema, rows, integrity };
}

function fingerprint(values: readonly RawHistoryValue[]): string {
  return JSON.stringify(values, (_key, value: unknown) =>
    typeof value === "bigint" ? `${value.toString()}n` : value,
  );
}

function tableFingerprint(
  row: RawHistoryVisit,
  table: HistorySourceTable,
): string {
  if (table === "visits") {
    return fingerprint([
      row.visitId,
      row.urlId,
      row.visitTime,
      row.fromVisit,
      row.externalReferrerUrl,
      row.transition,
      row.segmentId,
      row.visitDuration,
      row.incrementedOmniboxTypedScore,
      row.openerVisit,
      row.originatorCacheGuid,
      row.originatorVisitId,
      row.originatorFromVisit,
      row.originatorOpenerVisit,
      row.isKnownToSync,
      row.considerForNtpMostVisited,
      row.visitedLinkId,
      row.appId,
    ]);
  }
  if (table === "urls") {
    return fingerprint([
      row.urlRecordId,
      row.url,
      row.title,
      row.urlVisitCount,
      row.typedCount,
      row.lastVisitTime,
      row.hidden,
    ]);
  }
  return fingerprint([row.visitId, row.visitSource]);
}

function rowId(row: RawHistoryVisit): string | null {
  return typeof row.visitId === "bigint" ? row.visitId.toString() : null;
}

function presentTables(row: RawHistoryVisit): HistorySourceTable[] {
  return [
    "visits",
    ...(row.urlRecordId === null ? [] : (["urls"] as const)),
    ...(row.visitSource === null ? [] : (["visit_source"] as const)),
  ];
}

function tableRowId(
  row: RawHistoryVisit,
  table: HistorySourceTable,
): string | null {
  const value = table === "urls" ? row.urlRecordId : row.visitId;
  return typeof value === "bigint" ? value.toString() : null;
}

function recoveredOnlyRows(
  committed: readonly RawHistoryVisit[],
  recovered: readonly RawHistoryVisit[],
): RawHistoryVisit[] {
  const committedByVisitId = new Map(
    committed.flatMap((row) => {
      const id = rowId(row);
      return id === null ? [] : [[id, row] as const];
    }),
  );
  const rows: RawHistoryVisit[] = [];
  for (const row of recovered) {
    const id = rowId(row);
    const committedRow = id === null ? undefined : committedByVisitId.get(id);
    const tables = new Set<HistorySourceTable>([
      ...presentTables(row),
      ...(committedRow === undefined ? [] : presentTables(committedRow)),
    ]);
    const sidecarTables = [...tables].filter(
      (table) =>
        committedRow === undefined ||
        tableFingerprint(row, table) !== tableFingerprint(committedRow, table),
    );
    if (sidecarTables.length > 0) {
      const sidecarRows = sidecarTables.flatMap((table) => {
        const sourceRowId =
          tableRowId(row, table) ??
          (committedRow === undefined ? null : tableRowId(committedRow, table));
        return sourceRowId === null ? [] : [{ table, rowId: sourceRowId }];
      });
      rows.push({ ...row, sidecarTables, sidecarRows });
    }
  }
  return rows;
}

/**
 * Windows CI can transiently refuse the read-write recovery open of a freshly
 * copied snapshot that still carries a hot rollback journal or WAL. This
 * budget is finite and comfortably under the History E2E ceiling (60s), so a
 * genuine deadlock still fails instead of hanging, while a slow-but-transient
 * Windows lock/scanner window is absorbed. Successful opens are unaffected.
 */
const RECOVERY_OPEN_CONFIG = {
  maxAttempts: 12,
  maxTotalMs: 15_000,
  busyTimeoutMs: 10_000,
} as const;

export async function readHistoryPasses(options: {
  readonly database: VerifiedHistoryFile;
  readonly sidecars: readonly VerifiedHistoryFile[];
}): Promise<HistoryPasses> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "forensix-history-snapshot-"),
  );
  // The committed pass reads an immutable (lock-free) snapshot. The recovery
  // pass must open read-write to roll back a hot journal / checkpoint a WAL,
  // which acquires exclusive locks and mutates the file. Give recovery its own
  // pristine copy in a separate directory so its read-write open never contends
  // with the just-closed committed handle. On Windows a handle close does not
  // synchronously release the OS lock, and reusing one file for both opens is
  // the observed source of intermittent "unable to open database file".
  // Copy the verified database and every sidecar into `directory`, preserving
  // basenames so a hot journal/WAL still sits next to its database. Returns the
  // snapshot database path.
  const snapshotInto = async (directory: string): Promise<string> => {
    await mkdir(directory, { recursive: true });
    const databasePath = join(directory, basename(options.database.path));
    await snapshotVerifiedFile(options.database, databasePath);
    for (const sidecar of options.sidecars) {
      await snapshotVerifiedFile(
        sidecar,
        join(directory, basename(sidecar.path)),
      );
    }
    return databasePath;
  };

  const committedDirectory = join(temporaryDirectory, "committed");
  const recoveryDirectory = join(temporaryDirectory, "recovery");
  try {
    const committedDatabasePath = await snapshotInto(committedDirectory);
    const committedDatabase = immutableDatabase(committedDatabasePath);
    let committed: HistoryPass;
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

    // Fresh, isolated copy for the read-write rollback/checkpoint open. A copy
    // failure degrades to committed-only for symmetry with a recovery-open
    // failure, rather than throwing and killing the whole read.
    let recoveryDatabasePath: string;
    try {
      recoveryDatabasePath = await snapshotInto(recoveryDirectory);
    } catch (error) {
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_snapshot_failed:${String(error)}`,
      };
    }

    let recoveryDatabase: DatabaseSync;
    try {
      recoveryDatabase = openDatabaseSync(
        recoveryDatabasePath,
        { readBigInts: true },
        RECOVERY_OPEN_CONFIG,
      );
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
