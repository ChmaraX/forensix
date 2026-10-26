import type {
  DownloadsArtifactWrite,
  PersistedDownloadFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError } from "./errors.js";
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
import { boundedSortInteger } from "./forensic-time.js";
import type { ForensicTimestamp } from "./history.js";
import {
  DownloadsTableAbsentError,
  readDownloadsPasses,
  type DownloadsPass,
} from "./downloads-sqlite.js";
import {
  citedPasses,
  completeArtifactHeader,
  enumFields,
  preservedBoolean,
  preservedInteger,
  preservedString,
  readFailureHeader,
  resolveProfileDatabase,
  sourceRowProvenance,
  timestampField,
  unreadArtifactHeader,
  type CitedPass,
  type RawSqliteValue,
  type SqliteArtifactHeader,
} from "./sqlite-artifact.js";

/**
 * Chrome serialises `downloads` timestamps as a `base::Time` internal value:
 * microseconds since 1601-01-01 UTC, on every platform. This arrived with
 * `target_path` at History schema version 24, which the reader requires, so no
 * Declared Origin OS is needed to resolve the Epoch Family.
 */

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

/**
 * `downloads.interrupt_reason` — `download::DownloadInterruptReason` (sparse),
 * from components/download/public/common/download_interrupt_reason_values.h.
 * 32 is the obsolete `SERVER_PRECONDITION`; an older store can still hold it.
 */
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
  [32n, "server_precondition"],
  [33n, "server_bad_content"],
  [34n, "server_unauthorized"],
  [35n, "server_cert_problem"],
  [36n, "server_forbidden"],
  [37n, "server_unreachable"],
  [38n, "server_content_length_mismatch"],
  [39n, "server_cross_origin_redirect"],
  [40n, "user_canceled"],
  [41n, "user_shutdown"],
  [50n, "crash"],
  [51n, "local_download_blocked"],
]);

/**
 * Represent the `downloads.hash` BLOB (the SHA-256 of the downloaded bytes) as
 * lowercase hex plus its byte length. A digest is rendered in its canonical
 * reviewable form; binary is never base64-smuggled into a Finding row.
 */
function contentHashField(value: RawSqliteValue): {
  readonly sha256: FieldState<string>;
  readonly byteLength: FieldState<string>;
} {
  if (value === null) {
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

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildDownloads(
  cited: CitedPass<DownloadsPass>,
  profile: string,
  declaredTimezone: string,
): PersistedDownloadFinding[] {
  const epoch = {
    epochFamily: "1601-us",
    resolution: `verified_history_schema_version_${cited.pass.schema.version}`,
  } as const;
  return cited.pass.rows.map((row) => {
    if (row.rowId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Downloads downloads.id is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const get = (column: string): RawSqliteValue =>
      row.values.get(column) ?? null;
    const time = (column: string): FieldState<ForensicTimestamp> =>
      timestampField(get(column), true, epoch, declaredTimezone);

    const targetPath = preservedString(get("target_path"));
    const currentPath = preservedString(get("current_path"));
    const startTime = time("start_time");
    const endTime = time("end_time");
    const lastAccessTime = time("last_access_time");
    const state = enumFields(get("state"), DOWNLOAD_STATES);
    const dangerType = enumFields(get("danger_type"), DANGER_TYPES);
    const interruptReason = enumFields(
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
      state: state.label,
      dangerTypeRaw: dangerType.raw,
      dangerType: dangerType.label,
      interruptReasonRaw: interruptReason.raw,
      interruptReason: interruptReason.label,
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
                cited.manifest,
                "downloads_url_chains",
                node.rowId,
              ),
            ],
    );
    const provenance: Provenance = {
      ...sourceRowProvenance(cited.manifest, "downloads", rowId),
      ...(supportingRows.length === 0 ? {} : { supportingRows }),
      ...(cited.recoveredVia === undefined
        ? {}
        : { recoveredVia: cited.recoveredVia }),
    };
    const finding: Finding = createFinding({
      findingKind: "download",
      profile,
      commitState: cited.commitState,
      provenance,
      fields,
    });
    return {
      finding,
      searchText: [
        profile,
        textValue(targetPath),
        textValue(currentPath),
        state.label.state === "value" ? state.label.value : "",
        ...chainStrings,
        textValue(fields.referrer),
        textValue(fields.tabUrl),
      ]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortStart: timeValue(startTime),
      sortEnd: timeValue(endTime),
      sortTargetPath: textValue(targetPath) || null,
      sortState: state.label.state === "value" ? state.label.value : null,
      sortTotalBytes:
        fields.totalBytes.state === "value"
          ? boundedSortInteger(BigInt(fields.totalBytes.value))
          : null,
      dangerType:
        dangerType.label.state === "value" ? dangerType.label.value : null,
    };
  });
}

function unavailableArtifact(
  header: SqliteArtifactHeader,
): DownloadsArtifactWrite {
  return {
    ...header,
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
  const resolved = resolveProfileDatabase({
    ...options,
    label: "downloads",
    relativePaths: ["History"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readDownloadsPasses(target);
    const cited = citedPasses(target, passes);
    const build = (
      pass: CitedPass<DownloadsPass>,
    ): PersistedDownloadFinding[] =>
      buildDownloads(pass, options.profile, options.declaredTimezone);
    const committed = build(cited.committed);
    const recovered = cited.recovered === null ? [] : build(cited.recovered);
    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered],
      committedDownloadCount: committed.length,
      recoveredDownloadCount: recovered.length,
    };
  } catch (error) {
    // A History database that simply has no `downloads` table carries no
    // download evidence: report it as `absent` so it never degrades an
    // otherwise clean Analysis Run, while a corrupt or unreadable database
    // stays `unavailable` with its distinct typed reason.
    return unavailableArtifact(
      error instanceof DownloadsTableAbsentError
        ? unreadArtifactHeader(
            target,
            "absent",
            `downloads_table_absent:${error.message}`,
          )
        : readFailureHeader(target, "downloads", error),
    );
  }
}
