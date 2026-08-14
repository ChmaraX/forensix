import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  FaviconArtifactWrite,
  PersistedFaviconFinding,
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
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import {
  readFaviconPasses,
  type FaviconPass,
  type RawFaviconBitmap,
  type RawFaviconValue,
  type VerifiedFaviconFile,
} from "./favicons-sqlite.js";

/**
 * The Case-relative directory that holds icon payloads as separately hashed
 * files. Payloads are content-addressed by their SHA-256, so identical bytes
 * across bitmaps, Profiles, or Commit States are stored once and every Finding
 * references the file by digest instead of inlining base64 into a row.
 */
export const FAVICON_PAYLOAD_DIRECTORY = "favicon-payloads";

const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

// favicon_base::IconType values as persisted in `favicons.icon_type`.
const ICON_TYPES = new Map<bigint, string>([
  [0n, "invalid"],
  [1n, "favicon"],
  [2n, "touch_icon"],
  [4n, "touch_precomposed_icon"],
  [8n, "web_manifest_icon"],
]);

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface PayloadFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly data: Uint8Array;
}

interface BuiltFavicon {
  readonly signature: string;
  readonly persisted: PersistedFaviconFinding;
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

/**
 * Favicon `last_updated` / `last_requested` are `base::Time` internal values:
 * microseconds since the 1601-01-01 UTC Windows epoch on every platform. The
 * epoch is therefore fixed and needs no declared origin OS, unlike History.
 */
function faviconTimestamp(
  raw: RawFaviconValue,
  columnPresent: boolean,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (!columnPresent || raw === null || raw === 0n) {
    return absentField();
  }
  if (typeof raw !== "bigint") {
    return unavailableField("unsupported_value");
  }
  const utc = utcFromUnixMicros(raw - WINDOWS_EPOCH_OFFSET_MICROS);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: "1601-us",
      utc,
      declaredTimezone,
      resolution: "chromium_base_time_internal_value",
    },
    { synthetic: false },
  );
}

function preservedString(
  value: RawFaviconValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(
  value: RawFaviconValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function iconTypeField(value: RawFaviconValue): FieldState<string> {
  if (value === null) {
    return absentField();
  }
  if (typeof value !== "bigint") {
    return unavailableField("unsupported_value");
  }
  const name = ICON_TYPES.get(value);
  return name === undefined
    ? unavailableField("unsupported_value")
    : valueField(name);
}

/**
 * Classify an icon payload into three distinct Field States:
 * - a present, non-empty blob becomes a `value` referencing a hashed file;
 * - a missing payload (absent column, NULL, or an empty blob Chromium stores to
 *   record a known-absent icon) becomes `absent`;
 * - a value that is not a blob (a read/representation failure) becomes
 *   `unavailable`, so a corrupt payload is never confused with a missing one.
 */
function classifyPayload(
  value: RawFaviconValue,
  columnPresent: boolean,
):
  | { readonly state: "value"; readonly payload: PayloadFile }
  | { readonly state: "absent" }
  | {
      readonly state: "unavailable";
    } {
  if (!columnPresent || value === null) {
    return { state: "absent" };
  }
  if (!(value instanceof Uint8Array)) {
    return { state: "unavailable" };
  }
  if (value.byteLength === 0) {
    return { state: "absent" };
  }
  const sha256 = createHash("sha256").update(value).digest("hex");
  return {
    state: "value",
    payload: { sha256, bytes: value.byteLength, data: value },
  };
}

function bigintText(value: RawFaviconValue): string | null {
  return typeof value === "bigint" ? value.toString() : null;
}

function faviconRecords(
  pass: FaviconPass,
): ReadonlyMap<
  string,
  { readonly url: RawFaviconValue; readonly iconType: RawFaviconValue }
> {
  return new Map(
    pass.favicons.flatMap((record) => {
      const id = bigintText(record.rowId);
      return id === null
        ? []
        : [[id, { url: record.url, iconType: record.iconType }] as const];
    }),
  );
}

interface PageAssociation {
  readonly pageUrl: string | null;
  readonly rowId: string;
}

function iconMappingsByIcon(
  pass: FaviconPass,
): ReadonlyMap<string, readonly PageAssociation[]> {
  const grouped = new Map<string, PageAssociation[]>();
  for (const mapping of pass.iconMappings) {
    const iconId = bigintText(mapping.iconId);
    const rowId = bigintText(mapping.rowId);
    if (iconId === null || rowId === null) {
      continue;
    }
    const pageUrl =
      typeof mapping.pageUrl === "string" ? mapping.pageUrl : null;
    const list = grouped.get(iconId) ?? [];
    list.push({ pageUrl, rowId });
    grouped.set(iconId, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) =>
      BigInt(left.rowId) < BigInt(right.rowId) ? -1 : 1,
    );
  }
  return grouped;
}

function buildFavicons(options: {
  readonly pass: FaviconPass;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
  readonly payloads: Map<string, PayloadFile>;
}): BuiltFavicon[] {
  const records = faviconRecords(options.pass);
  const mappings = iconMappingsByIcon(options.pass);
  return options.pass.bitmaps.map((bitmap: RawFaviconBitmap) => {
    const bitmapId = bigintText(bitmap.rowId);
    if (bitmapId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Favicons favicon_bitmaps rowid is not an exact integer.",
      );
    }
    const iconId = bigintText(bitmap.iconId);
    const record = iconId === null ? undefined : records.get(iconId);
    const associations = iconId === null ? [] : (mappings.get(iconId) ?? []);

    const provenance: Provenance = {
      manifestEntryId: `${options.manifest.sourceId}:${options.manifest.ordinal}`,
      sourceId: options.manifest.sourceId,
      manifestEntryOrdinal: options.manifest.ordinal,
      manifestPath: options.manifest.path,
      database: options.manifest.databasePath,
      table: "favicon_bitmaps",
      rowId: bitmapId,
    };
    const supportingRows: SourceRowProvenance[] = [];
    if (iconId !== null && record !== undefined) {
      supportingRows.push({ ...provenance, table: "favicons", rowId: iconId });
    }
    for (const association of associations) {
      supportingRows.push({
        ...provenance,
        table: "icon_mapping",
        rowId: association.rowId,
      });
    }
    const fullProvenance: Provenance =
      supportingRows.length === 0
        ? provenance
        : { ...provenance, supportingRows };

    const payload = classifyPayload(
      bitmap.imageData,
      options.pass.schema.bitmapColumns.has("image_data"),
    );
    if (payload.state === "value") {
      options.payloads.set(payload.payload.sha256, payload.payload);
    }
    const iconUrl = preservedString(record?.url ?? null, record !== undefined);
    const iconType = iconTypeField(record?.iconType ?? null);
    const lastUpdated = faviconTimestamp(
      bitmap.lastUpdated,
      options.pass.schema.bitmapColumns.has("last_updated"),
      options.declaredTimezone,
    );
    const pageUrls = associations
      .map((association) => association.pageUrl)
      .filter((value): value is string => value !== null);

    const fields = {
      bitmapId: valueField(bitmapId),
      iconId:
        iconId === null
          ? unavailableField("related_row_missing")
          : valueField(iconId),
      iconUrl:
        record === undefined && iconId !== null
          ? unavailableField("related_row_missing")
          : iconUrl,
      iconType:
        record === undefined && iconId !== null
          ? unavailableField("related_row_missing")
          : iconType,
      iconTypeRaw: preservedInteger(
        record?.iconType ?? null,
        record !== undefined,
      ),
      width: preservedInteger(
        bitmap.width,
        options.pass.schema.bitmapColumns.has("width"),
      ),
      height: preservedInteger(
        bitmap.height,
        options.pass.schema.bitmapColumns.has("height"),
      ),
      lastUpdated,
      lastRequested: faviconTimestamp(
        bitmap.lastRequested,
        options.pass.schema.bitmapColumns.has("last_requested"),
        options.declaredTimezone,
      ),
      payloadSha256:
        payload.state === "value"
          ? valueField(payload.payload.sha256)
          : payload.state === "absent"
            ? absentField()
            : unavailableField("unsupported_value"),
      payloadBytes:
        payload.state === "value"
          ? valueField(payload.payload.bytes.toString())
          : payload.state === "absent"
            ? absentField()
            : unavailableField("unsupported_value"),
      payloadPath:
        payload.state === "value"
          ? valueField(`${FAVICON_PAYLOAD_DIRECTORY}/${payload.payload.sha256}`)
          : payload.state === "absent"
            ? absentField()
            : unavailableField("unsupported_value"),
      pageUrls: valueField(pageUrls),
      pageAssociationCount: valueField(associations.length.toString()),
    };

    const finding = createFinding({
      findingKind: "favicon",
      profile: options.profile,
      commitState: options.commitState,
      provenance: fullProvenance,
      fields,
    });

    const iconUrlValue = iconUrl.state === "value" ? iconUrl.value : null;
    const firstPageUrl =
      pageUrls.length > 0 ? ([...pageUrls].sort()[0] ?? null) : null;
    const widthKey = typeof bitmap.width === "bigint" ? bitmap.width : null;
    const lastUpdatedUtc =
      lastUpdated.state === "value" ? lastUpdated.value.utc : null;

    const signature = JSON.stringify({
      bitmapId,
      iconId,
      iconUrl: iconUrlValue,
      iconType: record?.iconType?.toString() ?? null,
      width: bigintText(bitmap.width),
      height: bigintText(bitmap.height),
      lastUpdated: bigintText(bitmap.lastUpdated),
      lastRequested: bigintText(bitmap.lastRequested),
      payload:
        payload.state === "value" ? payload.payload.sha256 : payload.state,
      pageUrls: [...pageUrls].sort(),
    });

    return {
      signature,
      persisted: {
        finding,
        searchText: [options.profile, iconUrlValue ?? "", ...pageUrls]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortIconUrl: iconUrlValue,
        sortPageUrl: firstPageUrl,
        sortLastUpdated: lastUpdatedUtc,
        sortWidth: widthKey,
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
): FaviconArtifactWrite {
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
    committedFaviconCount: 0,
    recoveredFaviconCount: 0,
    payloadFileCount: 0,
  };
}

async function writePayloads(
  caseDirectory: string,
  payloads: ReadonlyMap<string, PayloadFile>,
): Promise<void> {
  if (payloads.size === 0) {
    return;
  }
  const directory = join(caseDirectory, FAVICON_PAYLOAD_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const payload of payloads.values()) {
    // Payload files are content-addressed by SHA-256, so an identical write is
    // idempotent; a re-analysis rewrites byte-for-byte identical content.
    await writeFile(join(directory, payload.sha256), payload.data, {
      mode: 0o600,
    });
  }
}

async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly caseDirectory: string;
  readonly declaredTimezone: string;
}): Promise<FaviconArtifactWrite> {
  const databasePath =
    options.profile === "." ? "Favicons" : `${options.profile}/Favicons`;
  const manifest = manifestIdentity(options.source, databasePath);
  if (manifest === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      null,
      "absent",
      "favicons_absent",
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
      "favicons_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `favicons_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "favicons_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "favicons_manifest_representation_incomplete",
    );
  }

  const verifiedDatabase: VerifiedFaviconFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedFaviconFile[] = options.source.entries
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
    const passes = await readFaviconPasses({
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
        "Favicons recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const payloads = new Map<string, PayloadFile>();
    const committed = buildFavicons({
      pass: passes.committed,
      commitState: "committed",
      profile: options.profile,
      manifest,
      declaredTimezone: options.declaredTimezone,
      payloads,
    });
    const committedSignatures = new Set(
      committed.map((favicon) => favicon.signature),
    );
    // A recovered bitmap belongs to the sidecar Commit State only when the
    // committed image has no byte-identical Finding for it: the signature folds
    // in the payload digest and the sorted page-URL associations, so a sidecar
    // that only adds an icon-to-page mapping still surfaces as a distinct
    // sidecar-resident Finding while committed associations stay untouched.
    const recovered =
      passes.recovered === null
        ? []
        : buildFavicons({
            pass: passes.recovered,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
            declaredTimezone: options.declaredTimezone,
            payloads,
          }).filter((favicon) => !committedSignatures.has(favicon.signature));

    await writePayloads(options.caseDirectory, payloads);

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
      findings: [...committed, ...recovered].map(
        (favicon) => favicon.persisted,
      ),
      committedFaviconCount: committed.length,
      recoveredFaviconCount: recovered.length,
      payloadFileCount: payloads.size,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `favicons_read_failed:${String(error)}`;
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

export interface FaviconsAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
  readonly caseDirectory: string;
  readonly declaredTimezone: string;
}

export async function analyseSourceFavicons(
  input: FaviconsAnalysisInput,
): Promise<FaviconArtifactWrite[]> {
  const artifacts: FaviconArtifactWrite[] = [];
  for (const profile of input.source.profiles) {
    artifacts.push(
      await analyseProfile({
        source: input.source,
        profile: profile.path,
        workingCopyPath: input.workingCopyPath,
        caseDirectory: input.caseDirectory,
        declaredTimezone: input.declaredTimezone,
      }),
    );
  }
  return artifacts;
}
