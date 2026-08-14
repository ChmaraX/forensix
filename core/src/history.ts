import { join, resolve } from "node:path";

import {
  storeHistoryAnalysis,
  type AnalysisRunExitState,
  type CookieArtifactWrite,
  type DeclaredOriginOs,
  type HistoryArtifactWrite,
  type LoginDataArtifactWrite,
  type PersistedFinding,
} from "./case-findings.js";
import { analyseSourceCookies } from "./cookies.js";
import { analyseLoginDataProfile } from "./login-data.js";
import {
  loadCaseSources,
  workingCopyAbsolutePath,
  type CaseSourceRecord,
} from "./case.js";
import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type CommitState,
  type FieldState,
  type Finding,
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import {
  readHistoryPasses,
  type HistorySchema,
  type HistorySourceTable,
  type RawHistoryValue,
  type RawHistoryVisit,
  type VerifiedHistoryFile,
} from "./history-sqlite.js";
import { verifyWorkingCopy, type WorkingCopyVerification } from "./verify.js";

export type EpochFamily =
  | "1601-us"
  | "1601-ms"
  | "1601-seconds"
  | "unix-seconds"
  | "unix-us"
  | "unix-ms-json-double"
  | "omaha-days";

export interface ForensicTimestamp {
  readonly raw: string;
  readonly epochFamily: EpochFamily;
  readonly utc: string;
  readonly declaredTimezone: string;
  readonly resolution: string;
}

export interface AnalyseCaseOptions {
  readonly caseDirectory: string;
  readonly declaredTimezone?: string;
  readonly declaredOriginOs?: DeclaredOriginOs;
  readonly invocation?: readonly string[];
}

export interface HistoryAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedVisitCount: number;
  readonly recoveredVisitCount: number;
  readonly findingCount: number;
  readonly candidateCount: 0;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly declaredOriginOsConflict: boolean;
}

export interface CookieAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly recoveryUnavailableProfileCount: number;
  readonly committedCookieCount: number;
  readonly recoveredCookieCount: number;
  readonly findingCount: number;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
}

/**
 * Distinct, documented exit codes for the `analyse` command. The Case is the
 * record of truth for the exit state; these codes map each recorded Analysis
 * Run exit state onto a stable process exit code so operators and scripts can
 * tell a clean analysis from a partial or failed one.
 *
 * - `complete` (0): every artifact produced defensible results.
 * - `partial` (2): at least one artifact was unavailable, but other artifacts
 *   produced defensible, queryable results.
 * - `failed` (3): the analysis produced no defensible artifact result.
 *
 * Usage errors, a missing Case, and a Working Copy integrity refusal exit with
 * the generic error code 1 handled by the CLI entrypoint.
 */
export const ANALYSE_EXIT_CODES = {
  complete: 0,
  partial: 2,
  failed: 3,
} as const satisfies Record<AnalysisRunExitState, number>;

export interface LoginDataAnalysisSummary {
  readonly status: "complete" | "partial";
  readonly profileCount: number;
  readonly analysedProfileCount: number;
  readonly absentProfileCount: number;
  readonly unavailableProfileCount: number;
  readonly committedCredentialCount: number;
  readonly recoveredCredentialCount: number;
  readonly findingCount: number;
}

export interface AnalyseCaseResult extends WorkingCopyVerification {
  readonly command: "analyse";
  readonly analysisStatus: "ready";
  readonly artifactCount: number;
  readonly runId: string;
  readonly exitState: AnalysisRunExitState;
  readonly history: HistoryAnalysisSummary;
  readonly cookies: CookieAnalysisSummary;
  readonly loginData: LoginDataAnalysisSummary;
}

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface BuiltVisit {
  readonly finding: Finding;
  readonly persisted: PersistedFinding;
  readonly visitId: string;
  readonly urlId: string | null;
  readonly url: FieldState<string>;
  readonly title: FieldState<string>;
  readonly visitTimeUtc: string | null;
  readonly durationMicros: bigint | null;
  readonly provenance: Provenance;
}

const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;
const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;
const TRANSITION_CORES = new Map<number, string>([
  [0, "link"],
  [1, "typed"],
  [2, "auto_bookmark"],
  [3, "auto_subframe"],
  [4, "manual_subframe"],
  [5, "generated"],
  [6, "auto_toplevel"],
  [7, "form_submit"],
  [8, "reload"],
  [9, "keyword"],
  [10, "keyword_generated"],
]);
const TRANSITION_QUALIFIERS = [
  [0x00800000n, "blocked"],
  [0x01000000n, "forward_back"],
  [0x02000000n, "from_address_bar"],
  [0x04000000n, "home_page"],
  [0x08000000n, "from_api"],
  [0x10000000n, "chain_start"],
  [0x20000000n, "chain_end"],
  [0x40000000n, "client_redirect"],
  [0x80000000n, "server_redirect"],
] as const;
const VISIT_SOURCES = new Map<bigint, string>([
  [0n, "synced"],
  [1n, "browsed"],
  [2n, "extension"],
  [3n, "firefox_imported"],
  [4n, "ie_imported"],
  [5n, "safari_imported"],
  [6n, "actor"],
  [7n, "os_migration_imported"],
]);

function validateDeclaredTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
      new Date(0),
    );
  } catch (error) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Declared Timezone is not supported: ${timezone}`,
      { declared_timezone: timezone },
      { cause: error },
    );
  }
  return timezone;
}

function bigintValue(value: RawHistoryValue): bigint | null {
  return typeof value === "bigint" ? value : null;
}

function preservedInteger(
  value: RawHistoryValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent) {
    return absentField();
  }
  if (value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function preservedBoolean(
  value: RawHistoryValue,
  columnPresent: boolean,
): FieldState<boolean> {
  if (!columnPresent) {
    return absentField();
  }
  if (value === null) {
    return absentField();
  }
  if (value === 0n) {
    return valueField(false);
  }
  if (value === 1n) {
    return valueField(true);
  }
  return unavailableField("unsupported_value");
}

function preservedString(
  value: RawHistoryValue,
  columnPresent: boolean,
  relatedRowPresent = true,
): FieldState<string> {
  if (!columnPresent) {
    return absentField();
  }
  if (!relatedRowPresent) {
    return unavailableField("related_row_missing");
  }
  if (value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function floorDivision(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function utcFromUnixMicros(unixMicros: bigint): string | null {
  const seconds = floorDivision(unixMicros, 1_000_000n);
  const micros = unixMicros - seconds * 1_000_000n;
  const milliseconds = seconds * 1000n + micros / 1000n;
  const numericMilliseconds = Number(milliseconds);
  if (!Number.isSafeInteger(numericMilliseconds)) {
    return null;
  }
  const date = new Date(numericMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const base = date.toISOString();
  return `${base.slice(0, -5)}.${micros.toString().padStart(6, "0")}Z`;
}

function resolveHistoryEpoch(
  schemaVersion: number,
  declaredOriginOs: DeclaredOriginOs | null,
): {
  readonly epochFamily: "1601-us" | "unix-us";
  readonly resolution: string;
} | null {
  if (schemaVersion >= 17) {
    return {
      epochFamily: "1601-us",
      resolution: `verified_schema_version_${schemaVersion}`,
    };
  }
  if (declaredOriginOs === null) {
    return null;
  }
  return {
    epochFamily: declaredOriginOs === "windows" ? "1601-us" : "unix-us",
    resolution: `verified_schema_version_${schemaVersion}_declared_origin_os_${declaredOriginOs}`,
  };
}

function timestampField(
  raw: RawHistoryValue,
  columnPresent: boolean,
  schemaVersion: number,
  declaredOriginOs: DeclaredOriginOs | null,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (!columnPresent || raw === null || raw === 0n) {
    return absentField();
  }
  if (typeof raw !== "bigint") {
    return unavailableField("unsupported_value");
  }
  const resolution = resolveHistoryEpoch(schemaVersion, declaredOriginOs);
  if (resolution === null) {
    return unavailableField("epoch_requires_declared_origin_os");
  }
  const unixMicros =
    resolution.epochFamily === "1601-us"
      ? raw - WINDOWS_EPOCH_OFFSET_MICROS
      : raw;
  const utc = utcFromUnixMicros(unixMicros);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: resolution.epochFamily,
      utc,
      declaredTimezone,
      resolution: resolution.resolution,
    },
    { synthetic: false },
  );
}

function transitionDetails(raw: RawHistoryValue): {
  readonly raw: FieldState<string>;
  readonly core: FieldState<string>;
  readonly qualifiers: FieldState<readonly string[]>;
  readonly coreValue: string | null;
  readonly qualifierValues: readonly string[];
} {
  if (typeof raw !== "bigint") {
    const unavailable = unavailableField("unsupported_value");
    return {
      raw: unavailable,
      core: unavailable,
      qualifiers: unavailable,
      coreValue: null,
      qualifierValues: [],
    };
  }
  const unsigned = BigInt.asUintN(32, raw);
  const coreNumber = Number(unsigned & 0xffn);
  const core = TRANSITION_CORES.get(coreNumber);
  const qualifiers: string[] = TRANSITION_QUALIFIERS.filter(
    ([mask]) => (unsigned & mask) !== 0n,
  ).map(([, name]) => name);
  const knownMask = TRANSITION_QUALIFIERS.reduce(
    (mask, [qualifier]) => mask | qualifier,
    0n,
  );
  const unknownMask = unsigned & 0xffffff00n & ~knownMask;
  if (unknownMask !== 0n) {
    qualifiers.push(`unknown_0x${unknownMask.toString(16).padStart(8, "0")}`);
  }
  return {
    raw: valueField(raw.toString()),
    core:
      core === undefined
        ? unavailableField("unsupported_value")
        : valueField(core),
    qualifiers: valueField(qualifiers),
    coreValue: core ?? null,
    qualifierValues: qualifiers,
  };
}

function sourceRowProvenance(
  manifest: ManifestIdentity,
  table: string,
  rowId: string,
): SourceRowProvenance {
  return {
    manifestEntryId: `${manifest.sourceId}:${manifest.ordinal}`,
    sourceId: manifest.sourceId,
    manifestEntryOrdinal: manifest.ordinal,
    manifestPath: manifest.path,
    database: manifest.databasePath,
    table,
    rowId,
  };
}

function urlField<T>(
  field: FieldState<T>,
  relatedRowPresent: boolean,
): FieldState<T> {
  return relatedRowPresent ? field : unavailableField("related_row_missing");
}

interface RedirectRelationships {
  readonly childIds: readonly string[];
  readonly supportingRows: readonly SourceRowProvenance[];
}

function redirectRelationshipsForRows(
  rowSets: readonly {
    readonly rows: readonly RawHistoryVisit[];
    readonly manifest: ManifestIdentity;
  }[],
): ReadonlyMap<string, RedirectRelationships> {
  const redirectChildren = new Map<string, Map<string, SourceRowProvenance>>();
  for (const rowSet of rowSets) {
    for (const row of rowSet.rows) {
      const visitId = bigintValue(row.visitId)?.toString();
      const fromVisit = bigintValue(row.fromVisit);
      const transition = transitionDetails(row.transition);
      if (
        visitId !== undefined &&
        fromVisit !== null &&
        fromVisit !== 0n &&
        transition.qualifierValues.some((value) => value.endsWith("_redirect"))
      ) {
        const key = fromVisit.toString();
        const children =
          redirectChildren.get(key) ?? new Map<string, SourceRowProvenance>();
        children.set(
          visitId,
          sourceRowProvenance(rowSet.manifest, "visits", visitId),
        );
        redirectChildren.set(key, children);
      }
    }
  }
  return new Map(
    [...redirectChildren].map(([parent, children]) => {
      const sorted = [...children].sort(([left], [right]) =>
        BigInt(left) < BigInt(right)
          ? -1
          : BigInt(left) > BigInt(right)
            ? 1
            : 0,
      );
      return [
        parent,
        {
          childIds: sorted.map(([childId]) => childId),
          supportingRows: sorted.map(([, provenance]) => provenance),
        },
      ];
    }),
  );
}

function buildVisits(options: {
  readonly rows: readonly RawHistoryVisit[];
  readonly schema: HistorySchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly committedManifest?: ManifestIdentity;
  readonly redirectRelationships: ReadonlyMap<string, RedirectRelationships>;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
}): BuiltVisit[] {
  return options.rows.map((row) => {
    const visitId = bigintValue(row.visitId)?.toString();
    if (visitId === undefined) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "History visits.id is not an exact integer.",
      );
    }
    const urlId = bigintValue(row.urlId)?.toString() ?? null;
    const relatedUrlPresent = bigintValue(row.urlRecordId) !== null;
    const transition = transitionDetails(row.transition);
    const visitTime = timestampField(
      row.visitTime,
      options.schema.visitColumns.has("visit_time"),
      options.schema.version,
      options.declaredOriginOs,
      options.declaredTimezone,
    );
    const lastVisitTime = urlField(
      timestampField(
        row.lastVisitTime,
        options.schema.urlColumns.has("last_visit_time"),
        options.schema.version,
        options.declaredOriginOs,
        options.declaredTimezone,
      ),
      relatedUrlPresent,
    );
    const fromVisit = bigintValue(row.fromVisit);
    const isRedirect = transition.qualifierValues.some((value) =>
      value.endsWith("_redirect"),
    );
    const visitSourceRaw =
      row.visitSource === null && options.schema.hasVisitSource
        ? 1n
        : bigintValue(row.visitSource);
    const visitSource =
      visitSourceRaw === null
        ? unavailableField("missing_column")
        : VISIT_SOURCES.has(visitSourceRaw)
          ? valueField(VISIT_SOURCES.get(visitSourceRaw) as string)
          : unavailableField("unsupported_value");
    const manifestForTable = (table: HistorySourceTable): ManifestIdentity =>
      row.sidecarTables.includes(table)
        ? options.manifest
        : (options.committedManifest ?? options.manifest);
    const provenance = sourceRowProvenance(
      manifestForTable("visits"),
      "visits",
      visitId,
    );
    const supportingRows: SourceRowProvenance[] = [];
    const urlRowId = bigintValue(row.urlRecordId)?.toString();
    if (urlRowId !== undefined) {
      supportingRows.push(
        sourceRowProvenance(manifestForTable("urls"), "urls", urlRowId),
      );
    }
    if (row.visitSource !== null && typeof row.visitSource === "bigint") {
      supportingRows.push(
        sourceRowProvenance(
          manifestForTable("visit_source"),
          "visit_source",
          visitId,
        ),
      );
    }
    for (const sidecarRow of row.sidecarRows) {
      if (
        sidecarRow.table !== "visits" ||
        provenance.manifestPath !== options.manifest.path
      ) {
        supportingRows.push(
          sourceRowProvenance(
            options.manifest,
            sidecarRow.table,
            sidecarRow.rowId,
          ),
        );
      }
    }
    supportingRows.push(
      ...(options.redirectRelationships.get(visitId)?.supportingRows ?? []),
    );
    const uniqueSupportingRows = [
      ...new Map(
        supportingRows.map((row) => [sourceRowKey(row), row]),
      ).values(),
    ];
    const fullProvenance: Provenance =
      uniqueSupportingRows.length === 0
        ? provenance
        : { ...provenance, supportingRows: uniqueSupportingRows };
    const url = preservedString(
      row.url,
      options.schema.urlColumns.has("url"),
      relatedUrlPresent,
    );
    const title = preservedString(
      row.title,
      options.schema.urlColumns.has("title"),
      relatedUrlPresent,
    );
    const duration = bigintValue(row.visitDuration);
    const fields = {
      visitId: valueField(visitId),
      urlId: preservedInteger(
        row.urlId,
        options.schema.visitColumns.has("url"),
      ),
      urlRecordId: urlField(
        preservedInteger(row.urlRecordId, options.schema.urlColumns.has("id")),
        relatedUrlPresent,
      ),
      url,
      title,
      urlVisitCount: urlField(
        preservedInteger(
          row.urlVisitCount,
          options.schema.urlColumns.has("visit_count"),
        ),
        relatedUrlPresent,
      ),
      typedCount: urlField(
        preservedInteger(
          row.typedCount,
          options.schema.urlColumns.has("typed_count"),
        ),
        relatedUrlPresent,
      ),
      lastVisitTime,
      hidden: urlField(
        preservedBoolean(row.hidden, options.schema.urlColumns.has("hidden")),
        relatedUrlPresent,
      ),
      visitTime,
      fromVisit: preservedInteger(
        row.fromVisit,
        options.schema.visitColumns.has("from_visit"),
      ),
      externalReferrerUrl: preservedString(
        row.externalReferrerUrl,
        options.schema.visitColumns.has("external_referrer_url"),
      ),
      transitionRaw: transition.raw,
      transitionCore: transition.core,
      transitionQualifiers: transition.qualifiers,
      redirectFromVisitId:
        isRedirect && fromVisit !== null && fromVisit !== 0n
          ? valueField(fromVisit.toString())
          : absentField(),
      redirectToVisitIds: valueField(
        options.redirectRelationships.get(visitId)?.childIds ?? [],
      ),
      segmentId: preservedInteger(
        row.segmentId,
        options.schema.visitColumns.has("segment_id"),
      ),
      visitDurationMicros: preservedInteger(
        row.visitDuration,
        options.schema.visitColumns.has("visit_duration"),
      ),
      incrementedOmniboxTypedScore: preservedBoolean(
        row.incrementedOmniboxTypedScore,
        options.schema.visitColumns.has("incremented_omnibox_typed_score"),
      ),
      openerVisit: preservedInteger(
        row.openerVisit,
        options.schema.visitColumns.has("opener_visit"),
      ),
      originatorCacheGuid: preservedString(
        row.originatorCacheGuid,
        options.schema.visitColumns.has("originator_cache_guid"),
      ),
      originatorVisitId: preservedInteger(
        row.originatorVisitId,
        options.schema.visitColumns.has("originator_visit_id"),
      ),
      originatorFromVisit: preservedInteger(
        row.originatorFromVisit,
        options.schema.visitColumns.has("originator_from_visit"),
      ),
      originatorOpenerVisit: preservedInteger(
        row.originatorOpenerVisit,
        options.schema.visitColumns.has("originator_opener_visit"),
      ),
      isKnownToSync: preservedBoolean(
        row.isKnownToSync,
        options.schema.visitColumns.has("is_known_to_sync"),
      ),
      considerForNtpMostVisited: preservedBoolean(
        row.considerForNtpMostVisited,
        options.schema.visitColumns.has("consider_for_ntp_most_visited"),
      ),
      visitedLinkId: preservedInteger(
        row.visitedLinkId,
        options.schema.visitColumns.has("visited_link_id"),
      ),
      appId: preservedString(
        row.appId,
        options.schema.visitColumns.has("app_id"),
      ),
      visitSourceRaw:
        visitSourceRaw === null
          ? unavailableField("missing_column")
          : valueField(visitSourceRaw.toString()),
      visitSource,
    };
    const finding = createFinding({
      findingKind: "history_visit",
      profile: options.profile,
      commitState: options.commitState,
      provenance: fullProvenance,
      fields,
    });
    const visitTimeUtc =
      visitTime.state === "value" ? visitTime.value.utc : null;
    return {
      finding,
      persisted: {
        finding,
        searchText: [
          options.profile,
          url.state === "value" ? url.value : "",
          title.state === "value" ? title.value : "",
          transition.coreValue ?? "",
          visitSource.state === "value" ? visitSource.value : "",
        ]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortTime: visitTimeUtc,
        sortUrl: url.state === "value" ? url.value : null,
        sortDuration: duration,
        sortCount: null,
        transitionCore: transition.coreValue,
      },
      visitId,
      urlId,
      url,
      title,
      visitTimeUtc,
      durationMicros: duration,
      provenance: fullProvenance,
    };
  });
}

function localDateAndHour(
  utc: string,
  declaredTimezone: string,
): { readonly date: string; readonly hour: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: declaredTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utc));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: part("hour"),
  };
}

function sourceRowKey(provenance: SourceRowProvenance): string {
  return [
    provenance.manifestEntryId,
    provenance.database,
    provenance.table,
    provenance.rowId,
  ].join("\0");
}

function summaryProvenance(visits: readonly BuiltVisit[]): Provenance {
  const first = visits[0];
  if (first === undefined) {
    throw new Error("A History summary needs supporting visits.");
  }
  const supportingRows = new Map<string, SourceRowProvenance>();
  for (const visit of visits) {
    for (const row of [
      visit.provenance,
      ...(visit.provenance.supportingRows ?? []),
    ]) {
      if (sourceRowKey(row) !== sourceRowKey(first.provenance)) {
        supportingRows.set(sourceRowKey(row), row);
      }
    }
  }
  return supportingRows.size === 0
    ? first.provenance
    : { ...first.provenance, supportingRows: [...supportingRows.values()] };
}

function durationSummaryFields(visits: readonly BuiltVisit[]): {
  readonly withDurationCount: number;
  readonly withoutDurationCount: number;
  readonly total: bigint;
  readonly totalField: FieldState<string>;
  readonly averageField: FieldState<string>;
} {
  const knownDurations = visits.flatMap((visit) =>
    visit.durationMicros === null ? [] : [visit.durationMicros],
  );
  const total = knownDurations.reduce((sum, duration) => sum + duration, 0n);
  const withDurationCount = knownDurations.length;
  return {
    withDurationCount,
    withoutDurationCount: visits.length - withDurationCount,
    total,
    totalField:
      withDurationCount === 0 ? absentField() : valueField(total.toString()),
    averageField:
      withDurationCount === 0
        ? absentField()
        : valueField((total / BigInt(withDurationCount)).toString()),
  };
}

function boundedSortInteger(value: bigint): bigint | null {
  return value >= SQLITE_MIN_INTEGER && value <= SQLITE_MAX_INTEGER
    ? value
    : null;
}

function buildSummaries(
  visits: readonly BuiltVisit[],
  declaredTimezone: string,
): PersistedFinding[] {
  const results: PersistedFinding[] = [];
  const activityGroups = new Map<string, BuiltVisit[]>();
  const urlGroups = new Map<string, BuiltVisit[]>();

  for (const visit of visits) {
    if (visit.visitTimeUtc !== null) {
      const local = localDateAndHour(visit.visitTimeUtc, declaredTimezone);
      const activityKey = `${visit.finding.profile}\0${visit.finding.commitState}\0${local.date}\0${local.hour}`;
      const group = activityGroups.get(activityKey) ?? [];
      group.push(visit);
      activityGroups.set(activityKey, group);
    }
    const urlKey = `${visit.finding.profile}\0${visit.finding.commitState}\0${visit.urlId ?? (visit.url.state === "value" ? visit.url.value : visit.visitId)}`;
    const urlGroup = urlGroups.get(urlKey) ?? [];
    urlGroup.push(visit);
    urlGroups.set(urlKey, urlGroup);
  }

  for (const group of activityGroups.values()) {
    const first = group[0];
    if (first === undefined || first.visitTimeUtc === null) {
      continue;
    }
    const local = localDateAndHour(first.visitTimeUtc, declaredTimezone);
    const duration = durationSummaryFields(group);
    const finding = createFinding({
      findingKind: "history_activity_summary",
      profile: first.finding.profile,
      commitState: first.finding.commitState,
      provenance: summaryProvenance(group),
      fields: {
        localDate: valueField(local.date),
        localHour: valueField(local.hour),
        declaredTimezone: valueField(declaredTimezone),
        supportingVisitCount: valueField(group.length.toString()),
        visitsWithDurationCount: valueField(
          duration.withDurationCount.toString(),
        ),
        visitsWithoutDurationCount: valueField(
          duration.withoutDurationCount.toString(),
        ),
        totalDurationMicros: duration.totalField,
      },
    });
    results.push({
      finding,
      searchText:
        `${first.finding.profile}\n${local.date}\n${local.hour}`.toLocaleLowerCase(
          "en-US",
        ),
      sortTime: `${local.date}T${local.hour}`,
      sortUrl: null,
      sortDuration:
        duration.withDurationCount === 0
          ? null
          : boundedSortInteger(duration.total),
      sortCount: BigInt(group.length),
      transitionCore: null,
    });
  }

  for (const group of urlGroups.values()) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    const duration = durationSummaryFields(group);
    const commonFields = {
      url: first.url,
      title: first.title,
      supportingVisitCount: valueField(group.length.toString()),
    };
    const mostVisited = createFinding({
      findingKind: "history_most_visited_summary",
      profile: first.finding.profile,
      commitState: first.finding.commitState,
      provenance: summaryProvenance(group),
      fields: commonFields,
    });
    results.push({
      finding: mostVisited,
      searchText:
        `${first.finding.profile}\n${first.url.state === "value" ? first.url.value : ""}\n${first.title.state === "value" ? first.title.value : ""}`.toLocaleLowerCase(
          "en-US",
        ),
      sortTime: first.visitTimeUtc,
      sortUrl: first.url.state === "value" ? first.url.value : null,
      sortDuration: null,
      sortCount: BigInt(group.length),
      transitionCore: null,
    });

    const durationSummary = createFinding({
      findingKind: "history_duration_summary",
      profile: first.finding.profile,
      commitState: first.finding.commitState,
      provenance: summaryProvenance(group),
      fields: {
        ...commonFields,
        visitsWithDurationCount: valueField(
          duration.withDurationCount.toString(),
        ),
        visitsWithoutDurationCount: valueField(
          duration.withoutDurationCount.toString(),
        ),
        totalDurationMicros: duration.totalField,
        averageDurationMicros: duration.averageField,
      },
    });
    results.push({
      finding: durationSummary,
      searchText:
        `${first.finding.profile}\n${first.url.state === "value" ? first.url.value : ""}\n${first.title.state === "value" ? first.title.value : ""}`.toLocaleLowerCase(
          "en-US",
        ),
      sortTime: first.visitTimeUtc,
      sortUrl: first.url.state === "value" ? first.url.value : null,
      sortDuration:
        duration.withDurationCount === 0
          ? null
          : boundedSortInteger(duration.total),
      sortCount: BigInt(group.length),
      transitionCore: null,
    });
  }

  return results;
}

function manifestIdentity(
  source: CaseSourceRecord,
  path: string,
  databasePath = path,
): ManifestIdentity | null {
  const ordinal = source.entries.findIndex((entry) => entry.path === path);
  return ordinal < 0
    ? null
    : { sourceId: source.sourceId, ordinal, path, databasePath };
}

function unavailableArtifact(
  sourceId: string,
  profile: string,
  databasePath: string,
  manifestEntryOrdinal: number | null,
  status: "absent" | "unavailable",
  reason: string,
): HistoryArtifactWrite {
  return {
    sourceId,
    profile,
    status,
    manifestEntryOrdinal,
    databasePath,
    schemaVersion: null,
    integrity: null,
    recoveryStatus: "unavailable",
    reason,
    findings: [],
    committedVisitCount: 0,
    recoveredVisitCount: 0,
  };
}

async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
}): Promise<HistoryArtifactWrite> {
  const databasePath =
    options.profile === "." ? "History" : `${options.profile}/History`;
  const manifest = manifestIdentity(options.source, databasePath);
  if (manifest === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      null,
      "unavailable",
      "history_manifest_entry_missing",
    );
  }
  const entry = options.source.entries[manifest.ordinal];
  if (entry === undefined) {
    throw new Error("Manifest ordinal became invalid.");
  }
  if (entry.state === "absent") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "absent",
      "history_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `history_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "history_not_in_working_copy",
    );
  }

  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "history_manifest_representation_incomplete",
    );
  }
  const verifiedDatabase: VerifiedHistoryFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedHistoryFile[] = options.source.entries
    .filter(
      (candidate) =>
        candidate.copied &&
        candidate.state === "value" &&
        candidate.size !== null &&
        candidate.sha256 !== null &&
        (candidate.path === `${databasePath}-wal` ||
          candidate.path === `${databasePath}-shm` ||
          candidate.path === `${databasePath}-journal`),
    )
    .map((candidate) => ({
      path: join(options.workingCopyPath, ...candidate.path.split("/")),
      manifestPath: candidate.path,
      size: candidate.size as number,
      sha256: candidate.sha256 as string,
    }));

  try {
    const passes = await readHistoryPasses({
      database: verifiedDatabase,
      sidecars,
    });
    const recoveredManifest =
      passes.recovered === null
        ? null
        : manifestIdentity(
            options.source,
            `${databasePath}${
              passes.recovered.commitState === "wal_resident"
                ? "-wal"
                : "-journal"
            }`,
            databasePath,
          );
    if (passes.recovered !== null && recoveredManifest === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const redirectRelationships = redirectRelationshipsForRows([
      { rows: passes.committed.rows, manifest },
      ...(passes.recovered === null
        ? []
        : [
            {
              rows: passes.recovered.rows,
              manifest: recoveredManifest as ManifestIdentity,
            },
          ]),
    ]);
    const committed = buildVisits({
      rows: passes.committed.rows,
      schema: passes.committed.schema,
      commitState: "committed",
      profile: options.profile,
      manifest,
      redirectRelationships,
      declaredTimezone: options.declaredTimezone,
      declaredOriginOs: options.declaredOriginOs,
    });
    const recovered =
      passes.recovered === null
        ? []
        : buildVisits({
            rows: passes.recovered.rows,
            schema: passes.recovered.schema,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
            committedManifest: manifest,
            redirectRelationships,
            declaredTimezone: options.declaredTimezone,
            declaredOriginOs: options.declaredOriginOs,
          });
    const allVisits = [...committed, ...recovered];
    return {
      sourceId: options.source.sourceId,
      profile: options.profile,
      status: "complete",
      manifestEntryOrdinal: manifest.ordinal,
      databasePath,
      schemaVersion: passes.committed.schema.version,
      integrity: passes.committed.integrity,
      recoveryStatus: passes.recovered === null ? "unavailable" : "complete",
      reason: passes.recoveryUnavailableReason,
      findings: [
        ...allVisits.map((visit) => visit.persisted),
        ...buildSummaries(allVisits, options.declaredTimezone),
      ],
      committedVisitCount: committed.length,
      recoveredVisitCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `history_read_failed:${String(error)}`;
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      reason,
    );
  }
}

export async function analyseCase(
  options: AnalyseCaseOptions,
): Promise<AnalyseCaseResult> {
  const caseDirectory = resolve(options.caseDirectory);
  const declaredTimezone = validateDeclaredTimezone(
    options.declaredTimezone ?? "UTC",
  );
  const declaredOriginOs = options.declaredOriginOs ?? null;
  const startedAt = new Date().toISOString();
  const verification = await verifyWorkingCopy(caseDirectory);
  const sources = loadCaseSources(caseDirectory);
  const artifacts: HistoryArtifactWrite[] = [];
  const cookieArtifacts: CookieArtifactWrite[] = [];
  const loginDataArtifacts: LoginDataArtifactWrite[] = [];
  for (const source of sources) {
    const workingCopyPath = workingCopyAbsolutePath(caseDirectory, source);
    for (const profile of source.profiles) {
      artifacts.push(
        await analyseProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
          declaredOriginOs,
        }),
      );
      loginDataArtifacts.push(
        await analyseLoginDataProfile({
          source,
          profile: profile.path,
          workingCopyPath,
          declaredTimezone,
        }),
      );
    }
    cookieArtifacts.push(
      ...(await analyseSourceCookies({
        source,
        workingCopyPath,
        declaredTimezone,
        declaredOriginOs,
      })),
    );
  }

  await verifyWorkingCopy(caseDirectory);
  const stored = storeHistoryAnalysis({
    caseDirectory,
    sourceIds: sources.map((source) => source.sourceId),
    declaredTimezone,
    declaredOriginOs,
    invocation: options.invocation ?? ["analyse", "--case", caseDirectory],
    startedAt,
    artifacts,
    cookieArtifacts,
    loginDataArtifacts,
  });
  const singletonLockPresent = sources.some((source) =>
    source.entries.some(
      (entry) =>
        entry.path === "SingletonLock" &&
        entry.state === "value" &&
        entry.node_type === "symlink",
    ),
  );
  const analysed = artifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const absent = artifacts.filter((artifact) => artifact.status === "absent");
  const unavailable = artifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const cookiesAnalysed = cookieArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const cookiesAbsent = cookieArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const cookiesUnavailable = cookieArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  const loginAnalysed = loginDataArtifacts.filter(
    (artifact) => artifact.status === "complete",
  );
  const loginAbsent = loginDataArtifacts.filter(
    (artifact) => artifact.status === "absent",
  );
  const loginUnavailable = loginDataArtifacts.filter(
    (artifact) => artifact.status === "unavailable",
  );
  return {
    ...verification,
    command: "analyse",
    analysisStatus: "ready",
    artifactCount:
      analysed.length + cookiesAnalysed.length + loginAnalysed.length,
    runId: stored.runId,
    exitState: stored.runStatus,
    cookies: {
      status: cookiesUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: cookiesAnalysed.length,
      absentProfileCount: cookiesAbsent.length,
      unavailableProfileCount: cookiesUnavailable.length,
      recoveryUnavailableProfileCount: cookiesAnalysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedCookieCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.committedCookieCount,
        0,
      ),
      recoveredCookieCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredCookieCount,
        0,
      ),
      findingCount: cookiesAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
      declaredTimezone,
      declaredOriginOs,
    },
    history: {
      status: unavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: analysed.length,
      absentProfileCount: absent.length,
      unavailableProfileCount: unavailable.length,
      recoveryUnavailableProfileCount: analysed.filter(
        (artifact) => artifact.recoveryStatus === "unavailable",
      ).length,
      committedVisitCount: analysed.reduce(
        (count, artifact) => count + artifact.committedVisitCount,
        0,
      ),
      recoveredVisitCount: analysed.reduce(
        (count, artifact) => count + artifact.recoveredVisitCount,
        0,
      ),
      findingCount: analysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
      candidateCount: 0,
      declaredTimezone,
      declaredOriginOs,
      declaredOriginOsConflict:
        declaredOriginOs === "windows" && singletonLockPresent,
    },
    loginData: {
      status: loginUnavailable.length === 0 ? "complete" : "partial",
      profileCount: sources.reduce(
        (count, source) => count + source.profiles.length,
        0,
      ),
      analysedProfileCount: loginAnalysed.length,
      absentProfileCount: loginAbsent.length,
      unavailableProfileCount: loginUnavailable.length,
      committedCredentialCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.committedCredentialCount,
        0,
      ),
      recoveredCredentialCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.recoveredCredentialCount,
        0,
      ),
      findingCount: loginAnalysed.reduce(
        (count, artifact) => count + artifact.findings.length,
        0,
      ),
    },
  };
}
