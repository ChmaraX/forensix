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

type PayloadClassification = ReturnType<typeof classifyPayload>;

function bigintText(value: RawFaviconValue): string | null {
  return typeof value === "bigint" ? value.toString() : null;
}

function faviconRecords(
  pass: FaviconPass,
): ReadonlyMap<
  string,
  { readonly url: RawFaviconValue; readonly iconType: RawFaviconValue }
> {
  const records = new Map<
    string,
    { readonly url: RawFaviconValue; readonly iconType: RawFaviconValue }
  >();
  for (const record of pass.favicons) {
    const id = bigintText(record.rowId);
    if (id === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Favicons favicons.id is not an exact integer.",
      );
    }
    records.set(id, { url: record.url, iconType: record.iconType });
  }
  return records;
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
    const rowId = bigintText(mapping.rowId);
    if (rowId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Favicons icon_mapping.id is not an exact integer.",
      );
    }
    // icon_mapping.icon_id is a NOT NULL INTEGER foreign key. A non-integer
    // value cannot attach the mapping to any icon, so it is left ungrouped
    // rather than guessed; its own rowid corruption fails loud above, matching
    // the favicon_bitmaps rowid guard.
    const iconId = bigintText(mapping.iconId);
    if (iconId === null) {
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

interface FaviconRow {
  readonly bitmap: RawFaviconBitmap | null;
  readonly bitmapId: string | null;
  readonly iconId: string | null;
  readonly record:
    | { readonly url: RawFaviconValue; readonly iconType: RawFaviconValue }
    | undefined;
  readonly associations: readonly PageAssociation[];
}

interface BuildFaviconContext {
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
  readonly payloads: Map<string, PayloadFile>;
  readonly bitmapColumns: ReadonlySet<string>;
}

type ProvenanceBase = Omit<SourceRowProvenance, "table" | "rowId">;

function payloadField<T>(
  payload: PayloadClassification,
  project: (file: PayloadFile) => T,
): FieldState<T> {
  return payload.state === "value"
    ? valueField(project(payload.payload))
    : payload.state === "absent"
      ? absentField()
      : unavailableField("unsupported_value");
}

/**
 * Resolve the citable primary row plus supporting rows for one Finding. The
 * grain is a favicon_bitmaps row; a bitmap-less icon falls back to its favicons
 * row, or to its first icon_mapping row when even the favicons record is
 * missing, so every favicons and icon_mapping row stays citable. An icon with no
 * bitmap, no record, and no mapping is unreachable by construction and fails
 * loud rather than emitting an un-citable empty rowId.
 */
function faviconProvenance(base: ProvenanceBase, row: FaviconRow): Provenance {
  let primary: SourceRowProvenance;
  if (row.bitmap !== null && row.bitmapId !== null) {
    primary = { ...base, table: "favicon_bitmaps", rowId: row.bitmapId };
  } else if (row.record !== undefined && row.iconId !== null) {
    primary = { ...base, table: "favicons", rowId: row.iconId };
  } else {
    const first = row.associations[0];
    if (first === undefined) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "A bitmap-less favicon has no citable favicons or icon_mapping row.",
      );
    }
    primary = { ...base, table: "icon_mapping", rowId: first.rowId };
  }
  const supportingRows: SourceRowProvenance[] = [];
  if (
    row.record !== undefined &&
    row.iconId !== null &&
    primary.table !== "favicons"
  ) {
    supportingRows.push({ ...base, table: "favicons", rowId: row.iconId });
  }
  for (const association of row.associations) {
    if (
      primary.table === "icon_mapping" &&
      primary.rowId === association.rowId
    ) {
      continue;
    }
    supportingRows.push({
      ...base,
      table: "icon_mapping",
      rowId: association.rowId,
    });
  }
  return supportingRows.length === 0 ? primary : { ...primary, supportingRows };
}

function faviconSignature(input: {
  readonly row: FaviconRow;
  readonly payload: PayloadClassification;
  readonly iconUrl: string | null;
  readonly pageUrls: readonly string[];
  readonly unreadablePageAssociationCount: number;
}): string {
  const { row, payload } = input;
  return JSON.stringify({
    bitmapId: row.bitmapId,
    iconId: row.iconId,
    iconUrl: input.iconUrl,
    iconType: row.record?.iconType?.toString() ?? null,
    width: bigintText(row.bitmap?.width ?? null),
    height: bigintText(row.bitmap?.height ?? null),
    lastUpdated: bigintText(row.bitmap?.lastUpdated ?? null),
    lastRequested: bigintText(row.bitmap?.lastRequested ?? null),
    payload: payload.state === "value" ? payload.payload.sha256 : payload.state,
    pageUrls: [...input.pageUrls].sort(),
    unreadablePageAssociationCount: input.unreadablePageAssociationCount,
  });
}

function buildFaviconFinding(
  context: BuildFaviconContext,
  row: FaviconRow,
): BuiltFavicon {
  const base: ProvenanceBase = {
    manifestEntryId: `${context.manifest.sourceId}:${context.manifest.ordinal}`,
    sourceId: context.manifest.sourceId,
    manifestEntryOrdinal: context.manifest.ordinal,
    manifestPath: context.manifest.path,
    database: context.manifest.databasePath,
  };
  const provenance = faviconProvenance(base, row);

  const payload = classifyPayload(
    row.bitmap?.imageData ?? null,
    row.bitmap !== null && context.bitmapColumns.has("image_data"),
  );
  if (payload.state === "value") {
    context.payloads.set(payload.payload.sha256, payload.payload);
  }

  // A bitmap-less Finding has no bitmap columns to read, so every bitmap field
  // reads as absent rather than fabricating a value.
  const bitmapColumn = (name: string): boolean =>
    row.bitmap !== null && context.bitmapColumns.has(name);
  const iconUrl = preservedString(
    row.record?.url ?? null,
    row.record !== undefined,
  );
  const iconType = iconTypeField(row.record?.iconType ?? null);
  const lastUpdated = faviconTimestamp(
    row.bitmap?.lastUpdated ?? null,
    bitmapColumn("last_updated"),
    context.declaredTimezone,
  );
  const pageUrls = row.associations
    .map((association) => association.pageUrl)
    .filter((value): value is string => value !== null);
  // page_url is NOT NULL text in Chromium, so a non-string mapping is a read
  // failure. It is dropped from the URL list but counted separately, so the
  // list and its count never silently diverge and the failure stays visible.
  const unreadablePageAssociationCount =
    row.associations.length - pageUrls.length;

  const relatedRowMissing = row.record === undefined && row.iconId !== null;
  const fields = {
    bitmapId: row.bitmapId === null ? absentField() : valueField(row.bitmapId),
    iconId:
      row.iconId === null
        ? unavailableField("related_row_missing")
        : valueField(row.iconId),
    iconUrl: relatedRowMissing
      ? unavailableField("related_row_missing")
      : iconUrl,
    iconType: relatedRowMissing
      ? unavailableField("related_row_missing")
      : iconType,
    iconTypeRaw: preservedInteger(
      row.record?.iconType ?? null,
      row.record !== undefined,
    ),
    width: preservedInteger(row.bitmap?.width ?? null, bitmapColumn("width")),
    height: preservedInteger(
      row.bitmap?.height ?? null,
      bitmapColumn("height"),
    ),
    lastUpdated,
    lastRequested: faviconTimestamp(
      row.bitmap?.lastRequested ?? null,
      bitmapColumn("last_requested"),
      context.declaredTimezone,
    ),
    payloadSha256: payloadField(payload, (file) => file.sha256),
    payloadBytes: payloadField(payload, (file) => file.bytes.toString()),
    payloadPath: payloadField(
      payload,
      (file) => `${FAVICON_PAYLOAD_DIRECTORY}/${file.sha256}`,
    ),
    pageUrls: valueField(pageUrls),
    pageAssociationCount: valueField(pageUrls.length.toString()),
    unreadablePageAssociationCount: valueField(
      unreadablePageAssociationCount.toString(),
    ),
  };

  const finding = createFinding({
    findingKind: "favicon",
    profile: context.profile,
    commitState: context.commitState,
    provenance,
    fields,
  });

  const iconUrlValue = iconUrl.state === "value" ? iconUrl.value : null;
  const firstPageUrl =
    pageUrls.length > 0 ? ([...pageUrls].sort()[0] ?? null) : null;
  const widthKey =
    typeof row.bitmap?.width === "bigint" ? row.bitmap.width : null;
  const lastUpdatedUtc =
    lastUpdated.state === "value" ? lastUpdated.value.utc : null;

  return {
    signature: faviconSignature({
      row,
      payload,
      iconUrl: iconUrlValue,
      pageUrls,
      unreadablePageAssociationCount,
    }),
    persisted: {
      finding,
      searchText: [context.profile, iconUrlValue ?? "", ...pageUrls]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortIconUrl: iconUrlValue,
      sortPageUrl: firstPageUrl,
      sortLastUpdated: lastUpdatedUtc,
      sortWidth: widthKey,
    },
  };
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
  const context: BuildFaviconContext = {
    commitState: options.commitState,
    profile: options.profile,
    manifest: options.manifest,
    declaredTimezone: options.declaredTimezone,
    payloads: options.payloads,
    bitmapColumns: options.pass.schema.bitmapColumns,
  };
  const results: BuiltFavicon[] = [];
  const bitmapIconIds = new Set<string>();
  for (const bitmap of options.pass.bitmaps) {
    const bitmapId = bigintText(bitmap.rowId);
    if (bitmapId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Favicons favicon_bitmaps rowid is not an exact integer.",
      );
    }
    const iconId = bigintText(bitmap.iconId);
    if (iconId !== null) {
      bitmapIconIds.add(iconId);
    }
    results.push(
      buildFaviconFinding(context, {
        bitmap,
        bitmapId,
        iconId,
        record: iconId === null ? undefined : records.get(iconId),
        associations: iconId === null ? [] : (mappings.get(iconId) ?? []),
      }),
    );
  }

  // Every favicons row and icon_mapping target with no covering bitmap still
  // becomes one Finding, so a known icon URL or page association is never lost
  // just because its payload was never cached.
  const bitmaplessIconIds = new Set<string>();
  for (const record of options.pass.favicons) {
    const id = bigintText(record.rowId);
    if (id !== null && !bitmapIconIds.has(id)) {
      bitmaplessIconIds.add(id);
    }
  }
  for (const iconId of mappings.keys()) {
    if (!bitmapIconIds.has(iconId)) {
      bitmaplessIconIds.add(iconId);
    }
  }
  const sortedBitmapless = [...bitmaplessIconIds].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : 1,
  );
  for (const iconId of sortedBitmapless) {
    results.push(
      buildFaviconFinding(context, {
        bitmap: null,
        bitmapId: null,
        iconId,
        record: records.get(iconId),
        associations: mappings.get(iconId) ?? [],
      }),
    );
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
