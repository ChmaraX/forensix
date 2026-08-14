import { join } from "node:path";

import type {
  DownloadsArtifactWrite,
  PersistedDownloadFinding,
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
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import {
  readDownloadsPasses,
  type DownloadsSchema,
  type RawDownloadRow,
  type RawDownloadValue,
} from "./downloads-sqlite.js";
import type { VerifiedHistoryFile } from "./history-sqlite.js";

/**
 * Chrome serialises `downloads` timestamps as a `base::Time` internal value:
 * microseconds since 1601-01-01 UTC, on every platform. This arrived with
 * `target_path` at History schema version 24, which the reader requires, so no
 * Declared Origin OS is needed to resolve the Epoch Family.
 */
const DOWNLOAD_EPOCH_FAMILY = "1601-us" as const;
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

/**
 * `downloads.state` — `DownloadDatabase` `DownloadState`. Value 3 (BUG_140687)
 * is a deprecated placeholder that is deliberately left undecoded so it is not
 * conflated with the real INTERRUPTED (4) state; its raw value is still kept.
 */
const DOWNLOAD_STATES = new Map<bigint, string>([
  [0n, "in_progress"],
  [1n, "complete"],
  [2n, "cancelled"],
  [4n, "interrupted"],
]);

/** `downloads.danger_type` — `download::DownloadDangerType`. */
const DANGER_TYPES = new Map<bigint, string>([
  [0n, "not_dangerous"],
  [1n, "dangerous_file"],
  [2n, "dangerous_url"],
  [3n, "dangerous_content"],
  [4n, "maybe_dangerous_content"],
  [5n, "uncommon_content"],
  [6n, "user_validated"],
  [7n, "dangerous_host"],
  [8n, "potentially_unwanted"],
  [9n, "allowlisted_by_policy"],
  [10n, "async_scanning"],
  [11n, "blocked_password_protected"],
  [12n, "blocked_too_large"],
  [13n, "sensitive_content_warning"],
  [14n, "sensitive_content_block"],
  [15n, "deep_scanned_safe"],
  [16n, "deep_scanned_opened_dangerous"],
  [17n, "prompt_for_scanning"],
  [18n, "blocked_unsupported_file_type"],
  [19n, "dangerous_account_compromise"],
  [20n, "deep_scanned_failed"],
  [21n, "prompt_for_local_password_scanning"],
  [22n, "async_local_password_scanning"],
]);

/** `downloads.interrupt_reason` — `download::DownloadInterruptReason` (sparse). */
const INTERRUPT_REASONS = new Map<bigint, string>([
  [0n, "none"],
  [1n, "file_failed"],
  [2n, "file_access_denied"],
  [3n, "file_no_space"],
  [5n, "file_name_too_long"],
  [6n, "file_too_large"],
  [7n, "file_virus_infected"],
  [10n, "file_transient_error"],
  [11n, "file_blocked"],
  [12n, "file_security_check_failed"],
  [13n, "file_too_short"],
  [14n, "file_hash_mismatch"],
  [15n, "file_same_as_source"],
  [20n, "network_failed"],
  [21n, "network_timeout"],
  [22n, "network_disconnected"],
  [23n, "network_server_down"],
  [24n, "network_invalid_request"],
  [30n, "server_failed"],
  [31n, "server_no_range"],
  [32n, "server_bad_content"],
  [33n, "server_unauthorized"],
  [34n, "server_cert_problem"],
  [35n, "server_forbidden"],
  [36n, "server_unreachable"],
  [37n, "server_content_length_mismatch"],
  [38n, "server_cross_origin_redirect"],
  [40n, "user_canceled"],
  [41n, "user_shutdown"],
  [50n, "crash"],
]);

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

function floorDivision(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function utcFromWindowsMicros(windowsMicros: bigint): string | null {
  const unixMicros = windowsMicros - WINDOWS_EPOCH_OFFSET_MICROS;
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

function preservedString(value: RawDownloadValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(value: RawDownloadValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function preservedBoolean(value: RawDownloadValue): FieldState<boolean> {
  if (value === undefined || value === null) {
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

function timestampField(
  raw: RawDownloadValue,
  schemaVersion: number,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (raw === undefined || raw === null || raw === 0n) {
    return absentField();
  }
  if (typeof raw !== "bigint") {
    return unavailableField("unsupported_value");
  }
  const utc = utcFromWindowsMicros(raw);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: DOWNLOAD_EPOCH_FAMILY,
      utc,
      declaredTimezone,
      resolution: `verified_history_schema_version_${schemaVersion}`,
    },
    { synthetic: false },
  );
}

/**
 * Decode an enumerated integer column while retaining its raw value in a
 * companion field, so every decoded meaning stays independently reviewable
 * against ground truth. An unmapped code keeps the raw value and marks the
 * decoded field `unavailable` rather than guessing.
 */
function decodedEnum(
  value: RawDownloadValue,
  table: ReadonlyMap<bigint, string>,
): { readonly raw: FieldState<string>; readonly decoded: FieldState<string> } {
  if (value === undefined || value === null) {
    return { raw: absentField(), decoded: absentField() };
  }
  if (typeof value !== "bigint") {
    return {
      raw: unavailableField("unsupported_value"),
      decoded: unavailableField("unsupported_value"),
    };
  }
  const decoded = table.get(value);
  return {
    raw: valueField(value.toString()),
    decoded:
      decoded === undefined
        ? unavailableField("unsupported_value")
        : valueField(decoded),
  };
}

/**
 * Represent the `downloads.hash` BLOB (the SHA-256 of the downloaded bytes) as
 * lowercase hex plus its byte length. A digest is rendered in its canonical
 * reviewable form; binary is never base64-smuggled into a Finding row.
 */
function contentHashField(value: RawDownloadValue): {
  readonly sha256: FieldState<string>;
  readonly byteLength: FieldState<string>;
} {
  if (value === undefined || value === null) {
    return { sha256: absentField(), byteLength: absentField() };
  }
  if (!(value instanceof Uint8Array)) {
    return {
      sha256: unavailableField("unsupported_value"),
      byteLength: unavailableField("unsupported_value"),
    };
  }
  if (value.length === 0) {
    return { sha256: absentField(), byteLength: valueField("0") };
  }
  return {
    sha256: valueField(Buffer.from(value).toString("hex")),
    byteLength: valueField(value.length.toString()),
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

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildDownloads(options: {
  readonly rows: readonly RawDownloadRow[];
  readonly schema: DownloadsSchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
}): PersistedDownloadFinding[] {
  return options.rows.map((row) => {
    if (row.rowId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Downloads downloads.id is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const get = (column: string): RawDownloadValue =>
      row.values.get(column) ?? null;

    const targetPath = preservedString(get("target_path"));
    const currentPath = preservedString(get("current_path"));
    const startTime = timestampField(
      get("start_time"),
      options.schema.version,
      options.declaredTimezone,
    );
    const endTime = timestampField(
      get("end_time"),
      options.schema.version,
      options.declaredTimezone,
    );
    const lastAccessTime = timestampField(
      get("last_access_time"),
      options.schema.version,
      options.declaredTimezone,
    );
    const state = decodedEnum(get("state"), DOWNLOAD_STATES);
    const dangerType = decodedEnum(get("danger_type"), DANGER_TYPES);
    const interruptReason = decodedEnum(
      get("interrupt_reason"),
      INTERRUPT_REASONS,
    );
    const contentHash = contentHashField(get("hash"));

    // URL chain: ordered redirect hops with resolvable Provenance per hop.
    const chainUrls = row.urlChain.map((node) => node.url);
    const chainStrings = chainUrls.filter(
      (url): url is string => typeof url === "string",
    );
    const firstNode = row.urlChain[0];
    const lastNode = row.urlChain.at(-1);
    const chainField = (
      node: (typeof row.urlChain)[number] | undefined,
    ): FieldState<string> => {
      if (!row.urlChainTablePresent) {
        return absentField();
      }
      if (node === undefined) {
        return absentField();
      }
      return preservedString(node.url);
    };
    const originalUrl = chainField(firstNode);
    const finalUrl = chainField(lastNode);
    const urlChain: FieldState<readonly string[]> = row.urlChainTablePresent
      ? valueField(chainStrings)
      : absentField();

    const fields = {
      downloadId: valueField(rowId),
      guid: preservedString(get("guid")),
      targetPath,
      currentPath,
      startTime,
      endTime,
      lastAccessTime,
      receivedBytes: preservedInteger(get("received_bytes")),
      totalBytes: preservedInteger(get("total_bytes")),
      stateRaw: state.raw,
      state: state.decoded,
      dangerTypeRaw: dangerType.raw,
      dangerType: dangerType.decoded,
      interruptReasonRaw: interruptReason.raw,
      interruptReason: interruptReason.decoded,
      opened: preservedBoolean(get("opened")),
      transient: preservedBoolean(get("transient")),
      referrer: preservedString(get("referrer")),
      siteUrl: preservedString(get("site_url")),
      tabUrl: preservedString(get("tab_url")),
      tabReferrerUrl: preservedString(get("tab_referrer_url")),
      httpMethod: preservedString(get("http_method")),
      mimeType: preservedString(get("mime_type")),
      originalMimeType: preservedString(get("original_mime_type")),
      byExtId: preservedString(get("by_ext_id")),
      byExtName: preservedString(get("by_ext_name")),
      byWebAppId: preservedString(get("by_web_app_id")),
      etag: preservedString(get("etag")),
      lastModified: preservedString(get("last_modified")),
      contentSha256: contentHash.sha256,
      contentHashByteLength: contentHash.byteLength,
      originalUrl,
      finalUrl,
      urlChain,
      urlChainLength: row.urlChainTablePresent
        ? valueField(row.urlChain.length.toString())
        : absentField(),
    };

    const supportingRows: SourceRowProvenance[] = row.urlChain.flatMap(
      (node) =>
        node.rowId === null
          ? []
          : [
              sourceRowProvenance(
                options.manifest,
                "downloads_url_chains",
                node.rowId,
              ),
            ],
    );
    const provenance: Provenance = {
      ...sourceRowProvenance(options.manifest, "downloads", rowId),
      ...(supportingRows.length === 0 ? {} : { supportingRows }),
    };
    const finding: Finding = createFinding({
      findingKind: "download",
      profile: options.profile,
      commitState: options.commitState,
      provenance,
      fields,
    });
    return {
      finding,
      searchText: [
        options.profile,
        textValue(targetPath),
        textValue(currentPath),
        state.decoded.state === "value" ? state.decoded.value : "",
        ...chainStrings,
        textValue(fields.referrer),
        textValue(fields.tabUrl),
      ]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortStart: timeValue(startTime),
      sortEnd: timeValue(endTime),
      sortTargetPath: textValue(targetPath) || null,
      sortState: state.decoded.state === "value" ? state.decoded.value : null,
      sortTotalBytes:
        fields.totalBytes.state === "value"
          ? boundedSortInteger(BigInt(fields.totalBytes.value))
          : null,
      dangerType:
        dangerType.decoded.state === "value" ? dangerType.decoded.value : null,
    };
  });
}

const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;

function boundedSortInteger(value: bigint): bigint | null {
  return value >= SQLITE_MIN_INTEGER && value <= SQLITE_MAX_INTEGER
    ? value
    : null;
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
): DownloadsArtifactWrite {
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
    committedDownloadCount: 0,
    recoveredDownloadCount: 0,
  };
}

/**
 * Parse the `downloads` artifact for one Profile. Downloads live inside the
 * History database, so this reads the same verified `History` file and its
 * sidecars but produces its own artifact result. A broken or absent Downloads
 * table therefore yields a reasoned unavailability for Downloads without
 * suppressing the Profile's usable History visit results.
 */
export async function analyseDownloadsProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
}): Promise<DownloadsArtifactWrite> {
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
      "downloads_manifest_entry_missing",
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
      "downloads_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `downloads_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "downloads_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "downloads_manifest_representation_incomplete",
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
          candidate.path === `${databasePath}-journal`),
    )
    .map((candidate) => ({
      path: join(options.workingCopyPath, ...candidate.path.split("/")),
      manifestPath: candidate.path,
      size: candidate.size as number,
      sha256: candidate.sha256 as string,
    }));

  try {
    const passes = await readDownloadsPasses({
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
        "Downloads recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const committed = buildDownloads({
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
        : buildDownloads({
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
      findings: [...committed, ...recovered],
      committedDownloadCount: committed.length,
      recoveredDownloadCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    // A History database that simply has no `downloads` table carries no
    // download evidence: report it as `absent` so it never degrades an
    // otherwise clean Analysis Run, while a corrupt or unreadable database
    // stays `unavailable` with its distinct typed reason.
    if (
      error instanceof ForensixError &&
      error.details.downloads_table_absent === true
    ) {
      return unavailableArtifact(
        options.source.sourceId,
        options.profile,
        databasePath,
        manifest.ordinal,
        "absent",
        "downloads_table_absent:History database is missing the downloads table.",
      );
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `downloads_read_failed:${String(error)}`;
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
