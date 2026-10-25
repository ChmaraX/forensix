import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import {
  immutableDatabase,
  integerKey,
  normalizeSqliteValue,
  readIntegrity,
  readSqlitePasses,
  snapshotVerifiedFile,
  sqliteFingerprint,
  tableColumns,
  tableExists,
  type RawSqliteValue,
  type SqlitePasses,
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

export type HistoryPasses = SqlitePasses<HistoryPass>;

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
      { table, version, missingColumns: missing },
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
      { recordedVersion: versionText ?? null },
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
      { recordedVersion: version },
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

const normalize = (value: unknown): RawHistoryValue =>
  normalizeSqliteValue(value, "History");

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
      visitId: normalize(row.visitId),
      urlId: normalize(row.urlId),
      visitTime: normalize(row.visitTime),
      fromVisit: normalize(row.fromVisit),
      externalReferrerUrl: normalize(row.externalReferrerUrl),
      transition: normalize(row.transition),
      segmentId: normalize(row.segmentId),
      visitDuration: normalize(row.visitDuration),
      incrementedOmniboxTypedScore: normalize(row.incrementedOmniboxTypedScore),
      openerVisit: normalize(row.openerVisit),
      originatorCacheGuid: normalize(row.originatorCacheGuid),
      originatorVisitId: normalize(row.originatorVisitId),
      originatorFromVisit: normalize(row.originatorFromVisit),
      originatorOpenerVisit: normalize(row.originatorOpenerVisit),
      isKnownToSync: normalize(row.isKnownToSync),
      considerForNtpMostVisited: normalize(row.considerForNtpMostVisited),
      visitedLinkId: normalize(row.visitedLinkId),
      appId: normalize(row.appId),
      urlRecordId: normalize(row.urlRecordId),
      url: normalize(row.url),
      title: normalize(row.title),
      urlVisitCount: normalize(row.urlVisitCount),
      typedCount: normalize(row.typedCount),
      lastVisitTime: normalize(row.lastVisitTime),
      hidden: normalize(row.hidden),
      visitSource: normalize(row.visitSource),
      sidecarTables: [],
      sidecarRows: [],
    });
  }

  return { schema, rows, integrity: readIntegrity(database) };
}

function tableFingerprint(
  row: RawHistoryVisit,
  table: HistorySourceTable,
): string {
  if (table === "visits") {
    return sqliteFingerprint([
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
    return sqliteFingerprint([
      row.urlRecordId,
      row.url,
      row.title,
      row.urlVisitCount,
      row.typedCount,
      row.lastVisitTime,
      row.hidden,
    ]);
  }
  return sqliteFingerprint([row.visitId, row.visitSource]);
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
  return integerKey(table === "urls" ? row.urlRecordId : row.visitId);
}

function recoveredOnlyRows(
  committed: readonly RawHistoryVisit[],
  recovered: readonly RawHistoryVisit[],
): RawHistoryVisit[] {
  const committedByVisitId = new Map(
    committed.flatMap((row) => {
      const id = integerKey(row.visitId);
      return id === null ? [] : [[id, row] as const];
    }),
  );
  const rows: RawHistoryVisit[] = [];
  for (const row of recovered) {
    const id = integerKey(row.visitId);
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

export async function readHistoryPasses(options: {
  readonly database: VerifiedHistoryFile;
  readonly sidecars: readonly VerifiedHistoryFile[];
}): Promise<HistoryPasses> {
  return readSqlitePasses({
    artifact: "History",
    ...options,
    readPass,
    sidecarOnly: (committed, sidecar) => ({
      ...sidecar,
      rows: recoveredOnlyRows(committed.rows, sidecar.rows),
    }),
  });
}
