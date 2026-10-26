import { join } from "node:path";

import type {
  FaviconArtifactWrite,
  PersistedFaviconFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type FieldState,
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import {
  citedPasses,
  completeArtifactHeader,
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
} from "./sqlite-artifact.js";
import {
  readFaviconPasses,
  type FaviconPass,
  type RawFaviconBitmap,
} from "./favicons-sqlite.js";
import {
  payloadFile,
  writePayloadFiles,
  type PayloadFile,
} from "./payload-files.js";

/**
 * The Case-relative directory that holds icon payloads as separately hashed
 * files. Payloads are content-addressed by their SHA-256, so identical bytes
 * across bitmaps, Profiles, or Commit States are stored once and every Finding
 * references the file by digest instead of inlining base64 into a row.
 */
export const FAVICON_PAYLOAD_DIRECTORY = "favicon-payloads";

// favicon_base::IconType values as persisted in `favicons.icon_type`.
const ICON_TYPES = new Map<bigint, string>([
  [0n, "invalid"],
  [1n, "favicon"],
  [2n, "touch_icon"],
  [4n, "touch_precomposed_icon"],
  [8n, "web_manifest_icon"],
]);

interface BuiltFavicon {
  readonly signature: string;
  readonly persisted: PersistedFaviconFinding;
}

/**
 * Favicon `last_updated` / `last_requested` are `base::Time` internal values:
 * microseconds since the 1601-01-01 UTC Windows epoch on every platform. The
 * epoch is therefore fixed and needs no declared origin OS, unlike History.
 */
const FAVICON_EPOCH = {
  epochFamily: "1601-us",
  resolution: "chromium_base_time_internal_value",
} as const;

function iconTypeField(value: RawSqliteValue): FieldState<string> {
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
  value: RawSqliteValue,
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
  return { state: "value", payload: payloadFile(value) };
}

type PayloadClassification = ReturnType<typeof classifyPayload>;

function bigintText(value: RawSqliteValue): string | null {
  return typeof value === "bigint" ? value.toString() : null;
}

function faviconRecords(
  pass: FaviconPass,
): ReadonlyMap<
  string,
  { readonly url: RawSqliteValue; readonly iconType: RawSqliteValue }
> {
  const records = new Map<
    string,
    { readonly url: RawSqliteValue; readonly iconType: RawSqliteValue }
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
    | { readonly url: RawSqliteValue; readonly iconType: RawSqliteValue }
    | undefined;
  readonly associations: readonly PageAssociation[];
}

interface BuildFaviconContext {
  readonly cited: CitedPass<FaviconPass>;
  readonly profile: string;
  readonly declaredTimezone: string;
  readonly payloads: Map<string, PayloadFile>;
  readonly bitmapColumns: ReadonlySet<string>;
}

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
function faviconProvenance(
  manifest: ManifestIdentity,
  row: FaviconRow,
): Provenance {
  const cite = (table: string, rowId: string): SourceRowProvenance =>
    sourceRowProvenance(manifest, table, rowId);
  let primary: SourceRowProvenance;
  if (row.bitmap !== null && row.bitmapId !== null) {
    primary = cite("favicon_bitmaps", row.bitmapId);
  } else if (row.record !== undefined && row.iconId !== null) {
    primary = cite("favicons", row.iconId);
  } else {
    const first = row.associations[0];
    if (first === undefined) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "A bitmap-less favicon has no citable favicons or icon_mapping row.",
      );
    }
    primary = cite("icon_mapping", first.rowId);
  }
  const supportingRows: SourceRowProvenance[] = [];
  if (
    row.record !== undefined &&
    row.iconId !== null &&
    primary.table !== "favicons"
  ) {
    supportingRows.push(cite("favicons", row.iconId));
  }
  for (const association of row.associations) {
    if (
      primary.table === "icon_mapping" &&
      primary.rowId === association.rowId
    ) {
      continue;
    }
    supportingRows.push(cite("icon_mapping", association.rowId));
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
  const { cited } = context;
  const provenance: Provenance = {
    ...faviconProvenance(cited.manifest, row),
    ...(cited.recoveredVia === undefined
      ? {}
      : { recoveredVia: cited.recoveredVia }),
  };

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
  const lastUpdated = timestampField(
    row.bitmap?.lastUpdated ?? null,
    bitmapColumn("last_updated"),
    FAVICON_EPOCH,
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
    lastRequested: timestampField(
      row.bitmap?.lastRequested ?? null,
      bitmapColumn("last_requested"),
      FAVICON_EPOCH,
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
    commitState: cited.commitState,
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

function buildFavicons(
  cited: CitedPass<FaviconPass>,
  options: {
    readonly profile: string;
    readonly declaredTimezone: string;
    readonly payloads: Map<string, PayloadFile>;
  },
): BuiltFavicon[] {
  const records = faviconRecords(cited.pass);
  const mappings = iconMappingsByIcon(cited.pass);
  const context: BuildFaviconContext = {
    cited,
    profile: options.profile,
    declaredTimezone: options.declaredTimezone,
    payloads: options.payloads,
    bitmapColumns: cited.pass.schema.bitmapColumns,
  };
  const results: BuiltFavicon[] = [];
  const bitmapIconIds = new Set<string>();
  for (const bitmap of cited.pass.bitmaps) {
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
  for (const record of cited.pass.favicons) {
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

function unavailableArtifact(
  header: SqliteArtifactHeader,
): FaviconArtifactWrite {
  return {
    ...header,
    findings: [],
    committedFaviconCount: 0,
    recoveredFaviconCount: 0,
    payloadFileCount: 0,
  };
}

async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly caseDirectory: string;
  readonly declaredTimezone: string;
}): Promise<FaviconArtifactWrite> {
  const resolved = resolveProfileDatabase({
    ...options,
    label: "favicons",
    relativePaths: ["Favicons"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readFaviconPasses(target);
    const cited = citedPasses(target, passes);
    const payloads = new Map<string, PayloadFile>();
    const build = (pass: CitedPass<FaviconPass>): BuiltFavicon[] =>
      buildFavicons(pass, { ...options, payloads });
    const committed = build(cited.committed);
    const committedSignatures = new Set(
      committed.map((favicon) => favicon.signature),
    );
    // A recovered bitmap belongs to the sidecar Commit State only when the
    // committed image has no byte-identical Finding for it: the signature folds
    // in the payload digest and the sorted page-URL associations, so a sidecar
    // that only adds an icon-to-page mapping still surfaces as a distinct
    // sidecar-resident Finding while committed associations stay untouched.
    const recovered =
      cited.recovered === null
        ? []
        : build(cited.recovered).filter(
            (favicon) => !committedSignatures.has(favicon.signature),
          );

    await writePayloadFiles(
      join(options.caseDirectory, FAVICON_PAYLOAD_DIRECTORY),
      payloads.values(),
    );

    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered].map(
        (favicon) => favicon.persisted,
      ),
      committedFaviconCount: committed.length,
      recoveredFaviconCount: recovered.length,
      payloadFileCount: payloads.size,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "favicons", error));
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
