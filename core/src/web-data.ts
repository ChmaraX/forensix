import { join } from "node:path";

import type {
  PersistedAutofillFinding,
  WebDataArtifactWrite,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type CommitState,
  type FieldState,
  type Finding,
  type SourceRowProvenance,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import {
  readWebDataPasses,
  type RawAutofillRow,
  type RawWebDataValue,
  type VerifiedWebDataFile,
  type WebDataSchema,
} from "./web-data-sqlite.js";

/**
 * Chrome stores `autofill` timestamps with `base::Time::ToTimeT()`, i.e. whole
 * seconds since 1970-01-01 UTC, on every platform. The epoch does not depend on
 * the origin OS, so no Declared Origin OS is required.
 */
const AUTOFILL_EPOCH_FAMILY = "unix-seconds" as const;

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface BuiltAutofill {
  readonly persisted: PersistedAutofillFinding;
}

function utcFromUnixSeconds(seconds: bigint): string | null {
  const milliseconds = seconds * 1000n;
  const numericMilliseconds = Number(milliseconds);
  if (!Number.isSafeInteger(numericMilliseconds)) {
    return null;
  }
  const date = new Date(numericMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function preservedString(value: RawWebDataValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(value: RawWebDataValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function timestampField(
  raw: RawWebDataValue,
  columnPresent: boolean,
  schemaVersion: number,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (!columnPresent || raw === undefined || raw === null || raw === 0n) {
    return absentField();
  }
  if (typeof raw !== "bigint") {
    return unavailableField("unsupported_value");
  }
  const utc = utcFromUnixSeconds(raw);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: AUTOFILL_EPOCH_FAMILY,
      utc,
      declaredTimezone,
      resolution: `verified_web_data_schema_version_${schemaVersion}`,
    },
    { synthetic: false },
  );
}

function sourceRowProvenance(
  manifest: ManifestIdentity,
  rowId: string,
): SourceRowProvenance {
  return {
    manifestEntryId: `${manifest.sourceId}:${manifest.ordinal}`,
    sourceId: manifest.sourceId,
    manifestEntryOrdinal: manifest.ordinal,
    manifestPath: manifest.path,
    database: manifest.databasePath,
    table: "autofill",
    rowId,
  };
}

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildAutofillEntries(options: {
  readonly rows: readonly RawAutofillRow[];
  readonly schema: WebDataSchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
}): BuiltAutofill[] {
  return options.rows.map((row) => {
    if (row.rowId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Web Data autofill.rowid is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const has = (column: string): boolean => options.schema.columns.has(column);
    const get = (column: string): RawWebDataValue =>
      row.values.get(column) ?? null;
    const fieldName = preservedString(get("name"));
    const fieldValue = preservedString(get("value"));
    const dateCreated = timestampField(
      get("date_created"),
      has("date_created"),
      options.schema.version,
      options.declaredTimezone,
    );
    const dateLastUsed = timestampField(
      get("date_last_used"),
      has("date_last_used"),
      options.schema.version,
      options.declaredTimezone,
    );
    const fields = {
      autofillId: valueField(rowId),
      fieldName,
      fieldValue,
      fieldValueLower: preservedString(get("value_lower")),
      timesUsed: preservedInteger(get("count")),
      dateCreated,
      dateLastUsed,
    };
    const finding: Finding = createFinding({
      findingKind: "autofill_entry",
      profile: options.profile,
      commitState: options.commitState,
      provenance: sourceRowProvenance(options.manifest, rowId),
      fields,
    });
    return {
      persisted: {
        finding,
        searchText: [
          options.profile,
          textValue(fieldName),
          textValue(fieldValue),
        ]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortCreated: timeValue(dateCreated),
        sortLastUsed: timeValue(dateLastUsed),
        sortName: textValue(fieldName) || null,
        sortValue: textValue(fieldValue) || null,
      },
    };
  });
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
): WebDataArtifactWrite {
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
    committedFieldCount: 0,
    recoveredFieldCount: 0,
  };
}

export async function analyseWebDataProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
}): Promise<WebDataArtifactWrite> {
  const databasePath =
    options.profile === "." ? "Web Data" : `${options.profile}/Web Data`;
  const manifest = manifestIdentity(options.source, databasePath);
  if (manifest === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      null,
      "absent",
      "web_data_manifest_entry_missing",
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
      "web_data_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `web_data_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "web_data_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "web_data_manifest_representation_incomplete",
    );
  }

  const verifiedDatabase: VerifiedWebDataFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedWebDataFile[] = options.source.entries
    .filter(
      (candidate) =>
        candidate.copied &&
        candidate.state === "value" &&
        candidate.size !== null &&
        candidate.sha256 !== null &&
        (candidate.path === `${databasePath}-wal` ||
          candidate.path === `${databasePath}-journal`),
    )
    .map((candidate) => ({
      path: join(options.workingCopyPath, ...candidate.path.split("/")),
      manifestPath: candidate.path,
      size: candidate.size as number,
      sha256: candidate.sha256 as string,
    }));

  try {
    const passes = await readWebDataPasses({
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
        "Web Data recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const committed = buildAutofillEntries({
      rows: passes.committed.rows,
      schema: passes.committed.schema,
      commitState: "committed",
      profile: options.profile,
      manifest,
      declaredTimezone: options.declaredTimezone,
    });
    const recovered =
      passes.recovered === null
        ? []
        : buildAutofillEntries({
            rows: passes.recovered.rows,
            schema: passes.recovered.schema,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
            declaredTimezone: options.declaredTimezone,
          });
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
        ...committed.map((entry) => entry.persisted),
        ...recovered.map((entry) => entry.persisted),
      ],
      committedFieldCount: committed.length,
      recoveredFieldCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `web_data_read_failed:${String(error)}`;
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
