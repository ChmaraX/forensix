import { join } from "node:path";

import type {
  CookieArtifactWrite,
  DeclaredOriginOs,
  PersistedCookieFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import {
  readCookiePasses,
  type CookieSchema,
  type RawCookie,
  type RawCookieValue,
  type VerifiedCookieFile,
} from "./cookies-sqlite.js";
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
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import { decryptOscryptValue, type DecryptionSettings } from "./oscrypt.js";

/**
 * Chromium stores cookie times as `base::Time`: microseconds since the Windows
 * 1601 epoch on every platform. At or above this schema version the `meta`
 * table is treated as self-describing, so the epoch needs no operator input.
 * Below it the analyzer refuses to assert an epoch without a Declared Origin OS.
 */
const COOKIE_VERIFIED_SCHEMA_MINIMUM = 10;
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

const SAME_SITE_LABELS = new Map<bigint, string>([
  [-1n, "unspecified"],
  [0n, "no_restriction"],
  [1n, "lax"],
  [2n, "strict"],
]);
const PRIORITY_LABELS = new Map<bigint, string>([
  [0n, "low"],
  [1n, "medium"],
  [2n, "high"],
]);
const SOURCE_SCHEME_LABELS = new Map<bigint, string>([
  [0n, "unset"],
  [1n, "non_secure"],
  [2n, "secure"],
]);
const SOURCE_TYPE_LABELS = new Map<bigint, string>([
  [0n, "unknown"],
  [1n, "http"],
  [2n, "script"],
  [3n, "other"],
]);

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface BuiltCookie {
  readonly persisted: PersistedCookieFinding;
}

interface DecryptedSecret {
  readonly value: FieldState<string>;
  readonly route: FieldState<string>;
  readonly keyMaterialRecordId: FieldState<string>;
  readonly plaintext: string | null;
}

/**
 * Resolve the plaintext of an encrypted value strictly within the opt-in gate.
 * With decryption disabled the value stays `unavailable` with the historic
 * typed reason. With decryption enabled the row is dispatched offline by its
 * own prefix; success yields the plaintext plus the citing key-material
 * Provenance, and every failure keeps a distinct typed reason.
 */
function decryptSecret(
  encrypted: Uint8Array,
  profile: string,
  decryption: DecryptionSettings,
): DecryptedSecret {
  if (!decryption.enabled) {
    return {
      value: unavailableField("encrypted_secret_without_key_material"),
      route: absentField(),
      keyMaterialRecordId: absentField(),
      plaintext: null,
    };
  }
  const outcome = decryptOscryptValue({
    ciphertext: encrypted,
    profile,
    keyMaterial: decryption.keyMaterial,
  });
  if (outcome.state === "unavailable") {
    return {
      value: unavailableField(outcome.reason),
      route: absentField(),
      keyMaterialRecordId: absentField(),
      plaintext: null,
    };
  }
  const plaintext = Buffer.from(outcome.plaintext).toString("utf8");
  return {
    value: valueField(plaintext),
    route: valueField(outcome.route),
    keyMaterialRecordId: valueField(outcome.provenance.recordId),
    plaintext,
  };
}

function preservedString(
  value: RawCookieValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent) {
    return absentField();
  }
  if (value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(
  value: RawCookieValue,
  columnPresent: boolean,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function preservedBoolean(
  value: RawCookieValue,
  columnPresent: boolean,
): FieldState<boolean> {
  if (!columnPresent || value === null) {
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

function enumFields(
  value: RawCookieValue,
  columnPresent: boolean,
  labels: ReadonlyMap<bigint, string>,
): { readonly raw: FieldState<string>; readonly label: FieldState<string> } {
  if (!columnPresent || value === null) {
    return { raw: absentField(), label: absentField() };
  }
  if (typeof value !== "bigint") {
    return {
      raw: unavailableField("unsupported_value"),
      label: unavailableField("unsupported_value"),
    };
  }
  const label = labels.get(value);
  return {
    raw: valueField(value.toString()),
    label:
      label === undefined
        ? unavailableField("unsupported_value")
        : valueField(label),
  };
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

function resolveCookieEpoch(
  schemaVersion: number,
  declaredOriginOs: DeclaredOriginOs | null,
): { readonly epochFamily: "1601-us"; readonly resolution: string } | null {
  if (schemaVersion >= COOKIE_VERIFIED_SCHEMA_MINIMUM) {
    return {
      epochFamily: "1601-us",
      resolution: `verified_schema_version_${schemaVersion}`,
    };
  }
  if (declaredOriginOs === null) {
    return null;
  }
  return {
    epochFamily: "1601-us",
    resolution: `verified_schema_version_${schemaVersion}_declared_origin_os_${declaredOriginOs}`,
  };
}

function timestampField(
  raw: RawCookieValue,
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
  const resolution = resolveCookieEpoch(schemaVersion, declaredOriginOs);
  if (resolution === null) {
    return unavailableField("epoch_requires_declared_origin_os");
  }
  const utc = utcFromUnixMicros(raw - WINDOWS_EPOCH_OFFSET_MICROS);
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

function encryptionScheme(bytes: Uint8Array): string | null {
  if (bytes.length < 3) {
    return null;
  }
  const prefix = String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
  );
  return /^v(?:10|11|20)$/.test(prefix) ? prefix : null;
}

function buildCookies(options: {
  readonly rows: readonly RawCookie[];
  readonly schema: CookieSchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly decryption: DecryptionSettings;
}): BuiltCookie[] {
  const columns = options.schema.cookieColumns;
  return options.rows.map((row) => {
    const rowId =
      typeof row.rowId === "bigint" ? row.rowId.toString() : undefined;
    if (rowId === undefined) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Cookies rowid is not an exact integer.",
      );
    }
    const provenance: Provenance = {
      manifestEntryId: `${options.manifest.sourceId}:${options.manifest.ordinal}`,
      sourceId: options.manifest.sourceId,
      manifestEntryOrdinal: options.manifest.ordinal,
      manifestPath: options.manifest.path,
      database: options.manifest.databasePath,
      table: "cookies",
      rowId,
    };

    const hostKey = preservedString(row.hostKey, columns.has("host_key"));
    const name = preservedString(row.name, columns.has("name"));
    const path = preservedString(row.path, columns.has("path"));
    const plaintextValue = preservedString(row.value, columns.has("value"));
    const encrypted =
      row.encryptedValue instanceof Uint8Array ? row.encryptedValue : null;
    const isEncrypted = encrypted !== null && encrypted.length > 0;
    const scheme = isEncrypted ? encryptionScheme(encrypted) : null;
    const decrypted =
      isEncrypted && encrypted !== null
        ? decryptSecret(encrypted, options.profile, options.decryption)
        : null;

    const sameSite = enumFields(
      row.samesite,
      columns.has("samesite"),
      SAME_SITE_LABELS,
    );
    const priority = enumFields(
      row.priority,
      columns.has("priority"),
      PRIORITY_LABELS,
    );
    const sourceScheme = enumFields(
      row.sourceScheme,
      columns.has("source_scheme"),
      SOURCE_SCHEME_LABELS,
    );
    const sourceType = enumFields(
      row.sourceType,
      columns.has("source_type"),
      SOURCE_TYPE_LABELS,
    );

    const creationTime = timestampField(
      row.creationUtc,
      columns.has("creation_utc"),
      options.schema.version,
      options.declaredOriginOs,
      options.declaredTimezone,
    );
    const expiresTime = timestampField(
      row.expiresUtc,
      columns.has("expires_utc"),
      options.schema.version,
      options.declaredOriginOs,
      options.declaredTimezone,
    );
    const lastAccessTime = timestampField(
      row.lastAccessUtc,
      columns.has("last_access_utc"),
      options.schema.version,
      options.declaredOriginOs,
      options.declaredTimezone,
    );
    const lastUpdateTime = timestampField(
      row.lastUpdateUtc,
      columns.has("last_update_utc"),
      options.schema.version,
      options.declaredOriginOs,
      options.declaredTimezone,
    );

    const fields = {
      cookieId: valueField(rowId),
      hostKey,
      name,
      path,
      topFrameSiteKey: preservedString(
        row.topFrameSiteKey,
        columns.has("top_frame_site_key"),
      ),
      value: decrypted !== null ? decrypted.value : plaintextValue,
      valueDecryptionRoute:
        decrypted !== null ? decrypted.route : absentField(),
      valueKeyMaterialRecordId:
        decrypted !== null ? decrypted.keyMaterialRecordId : absentField(),
      isEncrypted: valueField(isEncrypted),
      encryptedValueScheme: isEncrypted
        ? scheme === null
          ? unavailableField("unsupported_value")
          : valueField(scheme)
        : absentField(),
      encryptedValueByteLength:
        encrypted === null
          ? absentField()
          : valueField(encrypted.length.toString()),
      isSecure: preservedBoolean(row.isSecure, columns.has("is_secure")),
      isHttpOnly: preservedBoolean(row.isHttpOnly, columns.has("is_httponly")),
      isPersistent: preservedBoolean(
        row.isPersistent,
        columns.has("is_persistent"),
      ),
      hasExpires: preservedBoolean(row.hasExpires, columns.has("has_expires")),
      priorityRaw: priority.raw,
      priority: priority.label,
      sameSiteRaw: sameSite.raw,
      sameSite: sameSite.label,
      sourceSchemeRaw: sourceScheme.raw,
      sourceScheme: sourceScheme.label,
      sourcePort: preservedInteger(row.sourcePort, columns.has("source_port")),
      sourceTypeRaw: sourceType.raw,
      sourceType: sourceType.label,
      hasCrossSiteAncestor: preservedBoolean(
        row.hasCrossSiteAncestor,
        columns.has("has_cross_site_ancestor"),
      ),
      creationTime,
      expiresTime,
      lastAccessTime,
      lastUpdateTime,
    };

    const finding = createFinding({
      findingKind: "cookie",
      profile: options.profile,
      commitState: options.commitState,
      provenance,
      fields,
    });

    const hostValue = hostKey.state === "value" ? hostKey.value : null;
    const nameValue = name.state === "value" ? name.value : null;
    return {
      persisted: {
        finding,
        searchText: [
          options.profile,
          hostValue ?? "",
          nameValue ?? "",
          path.state === "value" ? path.value : "",
          isEncrypted
            ? `encrypted ${scheme ?? "unknown"}`
            : plaintextValue.state === "value"
              ? plaintextValue.value
              : "",
        ]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortHost: hostValue,
        sortName: nameValue,
        sortCreation:
          creationTime.state === "value" ? creationTime.value.utc : null,
        sortExpires:
          expiresTime.state === "value" ? expiresTime.value.utc : null,
        sortLastAccess:
          lastAccessTime.state === "value" ? lastAccessTime.value.utc : null,
        hostKey: hostValue,
        sameSite:
          sameSite.label.state === "value" ? sameSite.label.value : null,
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
): CookieArtifactWrite {
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
    committedCookieCount: 0,
    recoveredCookieCount: 0,
  };
}

/**
 * Chromium moved the profile Cookies store under `Network/` in 2020. The
 * analyzer prefers that modern path and falls back to the legacy top-level
 * `Cookies` file so both schema generations are parsed.
 */
function resolveDatabasePath(
  source: CaseSourceRecord,
  profile: string,
): {
  readonly databasePath: string;
  readonly manifest: ManifestIdentity;
} | null {
  const prefix = profile === "." ? "" : `${profile}/`;
  for (const relative of ["Network/Cookies", "Cookies"]) {
    const databasePath = `${prefix}${relative}`;
    const manifest = manifestIdentity(source, databasePath);
    if (manifest === null) {
      continue;
    }
    const entry = source.entries[manifest.ordinal];
    if (entry !== undefined && entry.state === "value") {
      return { databasePath, manifest };
    }
  }
  return null;
}

async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly decryption: DecryptionSettings;
}): Promise<CookieArtifactWrite> {
  const modernPath =
    options.profile === "."
      ? "Network/Cookies"
      : `${options.profile}/Network/Cookies`;
  const resolved = resolveDatabasePath(options.source, options.profile);
  if (resolved === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      modernPath,
      null,
      "absent",
      "cookies_absent",
    );
  }
  const { databasePath, manifest } = resolved;
  const entry = options.source.entries[manifest.ordinal];
  if (entry === undefined) {
    throw new Error("Manifest ordinal became invalid.");
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "cookies_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "cookies_manifest_representation_incomplete",
    );
  }

  const verifiedDatabase: VerifiedCookieFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedCookieFile[] = options.source.entries
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
    const passes = await readCookiePasses({
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
        "Cookie recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const committed = buildCookies({
      rows: passes.committed.rows,
      schema: passes.committed.schema,
      commitState: "committed",
      profile: options.profile,
      manifest,
      declaredTimezone: options.declaredTimezone,
      declaredOriginOs: options.declaredOriginOs,
      decryption: options.decryption,
    });
    const recovered =
      passes.recovered === null
        ? []
        : buildCookies({
            rows: passes.recovered.rows,
            schema: passes.recovered.schema,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
            declaredTimezone: options.declaredTimezone,
            declaredOriginOs: options.declaredOriginOs,
            decryption: options.decryption,
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
      findings: [...committed, ...recovered].map((cookie) => cookie.persisted),
      committedCookieCount: committed.length,
      recoveredCookieCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `cookies_read_failed:${String(error)}`;
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

export interface CookieAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly decryption: DecryptionSettings;
}

export async function analyseSourceCookies(
  input: CookieAnalysisInput,
): Promise<CookieArtifactWrite[]> {
  const artifacts: CookieArtifactWrite[] = [];
  for (const profile of input.source.profiles) {
    artifacts.push(
      await analyseProfile({
        source: input.source,
        profile: profile.path,
        workingCopyPath: input.workingCopyPath,
        declaredTimezone: input.declaredTimezone,
        declaredOriginOs: input.declaredOriginOs,
        decryption: input.decryption,
      }),
    );
  }
  return artifacts;
}

export type { Finding as CookieFinding };
