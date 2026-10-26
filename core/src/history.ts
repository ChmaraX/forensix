import {
  type DeclaredOriginOs,
  type HistoryArtifactWrite,
  type PersistedFinding,
} from "./case-findings.js";
import { type CaseSourceRecord } from "./case.js";
import { ForensixError } from "./errors.js";
import { boundedSortInteger } from "./forensic-time.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type FieldState,
  type Finding,
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import {
  citedPasses,
  completeArtifactHeader,
  preservedBoolean,
  preservedInteger,
  preservedString,
  readFailureHeader,
  resolveProfileDatabase,
  sourceRowProvenance,
  timestampField,
  type CitedPass,
  type ManifestIdentity,
  type RawSqliteValue,
  type SqliteArtifactHeader,
  type TimestampEpoch,
} from "./sqlite-artifact.js";
export type { TopicCandidateSummary } from "./history-topic-classification.js";
import {
  readHistoryPasses,
  type HistoryPass,
  type HistorySourceTable,
} from "./history-sqlite.js";

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

export function validateDeclaredTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
      new Date(0),
    );
  } catch (error) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Declared Timezone is not supported: ${timezone}`,
      { declaredTimezone: timezone },
      { cause: error },
    );
  }
  return timezone;
}

function bigintValue(value: RawSqliteValue): bigint | null {
  return typeof value === "bigint" ? value : null;
}

function resolveHistoryEpoch(
  schemaVersion: number,
  declaredOriginOs: DeclaredOriginOs | null,
): TimestampEpoch | null {
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

function transitionDetails(raw: RawSqliteValue): {
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
  rowSets: readonly CitedPass<HistoryPass>[],
): ReadonlyMap<string, RedirectRelationships> {
  const redirectChildren = new Map<string, Map<string, SourceRowProvenance>>();
  for (const rowSet of rowSets) {
    for (const row of rowSet.pass.rows) {
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

function buildVisits(
  cited: CitedPass<HistoryPass>,
  options: {
    readonly profile: string;
    /** The main database entry, cited by the tables a sidecar did not change. */
    readonly committedManifest: ManifestIdentity;
    readonly redirectRelationships: ReadonlyMap<string, RedirectRelationships>;
    readonly declaredTimezone: string;
    readonly declaredOriginOs: DeclaredOriginOs | null;
  },
): BuiltVisit[] {
  const { schema } = cited.pass;
  const epoch = resolveHistoryEpoch(schema.version, options.declaredOriginOs);
  return cited.pass.rows.map((row) => {
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
      schema.visitColumns.has("visit_time"),
      epoch,
      options.declaredTimezone,
    );
    const lastVisitTime = urlField(
      timestampField(
        row.lastVisitTime,
        schema.urlColumns.has("last_visit_time"),
        epoch,
        options.declaredTimezone,
      ),
      relatedUrlPresent,
    );
    const fromVisit = bigintValue(row.fromVisit);
    const isRedirect = transition.qualifierValues.some((value) =>
      value.endsWith("_redirect"),
    );
    const visitSourceRaw =
      row.visitSource === null && schema.hasVisitSource
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
        ? cited.manifest
        : options.committedManifest;
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
        provenance.manifestPath !== cited.manifest.path
      ) {
        supportingRows.push(
          sourceRowProvenance(
            cited.manifest,
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
    const fullProvenance: Provenance = {
      ...provenance,
      ...(uniqueSupportingRows.length === 0
        ? {}
        : { supportingRows: uniqueSupportingRows }),
      ...(cited.recoveredVia === undefined
        ? {}
        : { recoveredVia: cited.recoveredVia }),
    };
    const url = urlField(
      preservedString(row.url, schema.urlColumns.has("url")),
      relatedUrlPresent,
    );
    const title = urlField(
      preservedString(row.title, schema.urlColumns.has("title")),
      relatedUrlPresent,
    );
    const duration = bigintValue(row.visitDuration);
    const fields = {
      visitId: valueField(visitId),
      urlId: preservedInteger(row.urlId, schema.visitColumns.has("url")),
      urlRecordId: urlField(
        preservedInteger(row.urlRecordId, schema.urlColumns.has("id")),
        relatedUrlPresent,
      ),
      url,
      title,
      urlVisitCount: urlField(
        preservedInteger(
          row.urlVisitCount,
          schema.urlColumns.has("visit_count"),
        ),
        relatedUrlPresent,
      ),
      typedCount: urlField(
        preservedInteger(row.typedCount, schema.urlColumns.has("typed_count")),
        relatedUrlPresent,
      ),
      lastVisitTime,
      hidden: urlField(
        preservedBoolean(row.hidden, schema.urlColumns.has("hidden")),
        relatedUrlPresent,
      ),
      visitTime,
      fromVisit: preservedInteger(
        row.fromVisit,
        schema.visitColumns.has("from_visit"),
      ),
      externalReferrerUrl: preservedString(
        row.externalReferrerUrl,
        schema.visitColumns.has("external_referrer_url"),
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
        schema.visitColumns.has("segment_id"),
      ),
      visitDurationMicros: preservedInteger(
        row.visitDuration,
        schema.visitColumns.has("visit_duration"),
      ),
      incrementedOmniboxTypedScore: preservedBoolean(
        row.incrementedOmniboxTypedScore,
        schema.visitColumns.has("incremented_omnibox_typed_score"),
      ),
      openerVisit: preservedInteger(
        row.openerVisit,
        schema.visitColumns.has("opener_visit"),
      ),
      originatorCacheGuid: preservedString(
        row.originatorCacheGuid,
        schema.visitColumns.has("originator_cache_guid"),
      ),
      originatorVisitId: preservedInteger(
        row.originatorVisitId,
        schema.visitColumns.has("originator_visit_id"),
      ),
      originatorFromVisit: preservedInteger(
        row.originatorFromVisit,
        schema.visitColumns.has("originator_from_visit"),
      ),
      originatorOpenerVisit: preservedInteger(
        row.originatorOpenerVisit,
        schema.visitColumns.has("originator_opener_visit"),
      ),
      isKnownToSync: preservedBoolean(
        row.isKnownToSync,
        schema.visitColumns.has("is_known_to_sync"),
      ),
      considerForNtpMostVisited: preservedBoolean(
        row.considerForNtpMostVisited,
        schema.visitColumns.has("consider_for_ntp_most_visited"),
      ),
      visitedLinkId: preservedInteger(
        row.visitedLinkId,
        schema.visitColumns.has("visited_link_id"),
      ),
      appId: preservedString(row.appId, schema.visitColumns.has("app_id")),
      visitSourceRaw:
        visitSourceRaw === null
          ? unavailableField("missing_column")
          : valueField(visitSourceRaw.toString()),
      visitSource,
    };
    const finding = createFinding({
      findingKind: "history_visit",
      profile: options.profile,
      commitState: cited.commitState,
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

function unavailableArtifact(
  header: SqliteArtifactHeader,
): HistoryArtifactWrite {
  return {
    ...header,
    findings: [],
    committedVisitCount: 0,
    recoveredVisitCount: 0,
  };
}

export async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
}): Promise<HistoryArtifactWrite> {
  const resolved = resolveProfileDatabase({
    ...options,
    label: "history",
    relativePaths: ["History"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readHistoryPasses(target);
    const cited = citedPasses(target, passes);
    const redirectRelationships = redirectRelationshipsForRows(
      cited.recovered === null
        ? [cited.committed]
        : [cited.committed, cited.recovered],
    );
    const build = (pass: CitedPass<HistoryPass>): BuiltVisit[] =>
      buildVisits(pass, {
        ...options,
        committedManifest: cited.committed.manifest,
        redirectRelationships,
      });
    const committed = build(cited.committed);
    const recovered = cited.recovered === null ? [] : build(cited.recovered);
    const allVisits = [...committed, ...recovered];
    return {
      ...completeArtifactHeader(target, passes),
      findings: [
        ...allVisits.map((visit) => visit.persisted),
        ...buildSummaries(allVisits, options.declaredTimezone),
      ],
      committedVisitCount: committed.length,
      recoveredVisitCount: recovered.length,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "history", error));
  }
}
