import { join } from "node:path";

import type {
  LoginDataArtifactWrite,
  PersistedLoginFinding,
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
import { decryptSecretField } from "./decrypted-field.js";
import { schemeOf, type DecryptionSettings } from "./oscrypt.js";
import {
  readLoginPasses,
  type LoginSchema,
  type RawLoginRow,
  type RawLoginValue,
  type VerifiedLoginFile,
} from "./login-data-sqlite.js";

const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

/**
 * Chrome stores password-store timestamps as `base::Time` internal values, i.e.
 * microseconds since 1601-01-01 UTC, on every platform. Unlike History, the
 * epoch does not depend on the origin OS, so no Declared Origin OS is required.
 */
const LOGIN_EPOCH_FAMILY = "1601-us" as const;

interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

interface BuiltCredential {
  readonly persisted: PersistedLoginFinding;
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

function preservedString(value: RawLoginValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

function preservedInteger(value: RawLoginValue): FieldState<string> {
  if (value === undefined || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

function preservedBoolean(value: RawLoginValue): FieldState<boolean> {
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
  raw: RawLoginValue,
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
  const utc = utcFromUnixMicros(raw - WINDOWS_EPOCH_OFFSET_MICROS);
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: LOGIN_EPOCH_FAMILY,
      utc,
      declaredTimezone,
      resolution: `verified_login_data_schema_version_${schemaVersion}`,
    },
    { synthetic: false },
  );
}

interface SecretDescription {
  readonly secret: FieldState<string>;
  readonly scheme: FieldState<string>;
  readonly prefix: FieldState<string>;
  readonly byteLength: FieldState<string>;
  readonly decryptionRoute: FieldState<string>;
  readonly keyMaterialRecordId: FieldState<string>;
}

/**
 * Describe the encrypted secret wrapper and resolve the secret through the
 * shared opt-in decrypt gate. With decryption disabled (the default) the secret
 * stays `unavailable` with the typed reason `encrypted_secret_without_key_material`;
 * an empty or missing blob is `absent`. The wrapper prefix (for example `v10`,
 * `v11`, `v20`) and byte length are always retained as metadata so an
 * investigator can classify the scheme even when the secret is not disclosed.
 */
function describeSecret(
  value: RawLoginValue,
  columnPresent: boolean,
  profile: string,
  decryption: DecryptionSettings,
): SecretDescription {
  if (!columnPresent || value === undefined || value === null) {
    return {
      secret: absentField(),
      scheme: absentField(),
      prefix: absentField(),
      byteLength: absentField(),
      decryptionRoute: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  if (!(value instanceof Uint8Array)) {
    return {
      secret: unavailableField("unsupported_value"),
      scheme: unavailableField("unsupported_value"),
      prefix: unavailableField("unsupported_value"),
      byteLength: unavailableField("unsupported_value"),
      decryptionRoute: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  if (value.length === 0) {
    return {
      secret: absentField(),
      scheme: absentField(),
      prefix: absentField(),
      byteLength: valueField("0"),
      decryptionRoute: absentField(),
      keyMaterialRecordId: absentField(),
    };
  }
  const schemeClass = schemeOf(value);
  const recognizedScheme = schemeClass !== "legacy";
  const decrypted = decryptSecretField(value, profile, decryption);
  return {
    secret: decrypted.value,
    scheme: recognizedScheme
      ? valueField(schemeClass)
      : unavailableField("unsupported_value"),
    prefix: recognizedScheme
      ? valueField(schemeClass)
      : valueField(Buffer.from(value.subarray(0, 3)).toString("hex")),
    byteLength: valueField(value.length.toString()),
    decryptionRoute: decrypted.route,
    keyMaterialRecordId: decrypted.keyMaterialRecordId,
  };
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
    table: "logins",
    rowId,
  };
}

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildCredentials(options: {
  readonly rows: readonly RawLoginRow[];
  readonly schema: LoginSchema;
  readonly commitState: CommitState;
  readonly profile: string;
  readonly manifest: ManifestIdentity;
  readonly declaredTimezone: string;
  readonly decryption: DecryptionSettings;
}): BuiltCredential[] {
  return options.rows.map((row) => {
    if (row.id === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Login Data logins.id is not an exact integer.",
      );
    }
    const rowId = row.id.toString();
    const has = (column: string): boolean => options.schema.columns.has(column);
    const get = (column: string): RawLoginValue =>
      row.values.get(column) ?? null;
    const secret = describeSecret(
      get("password_value"),
      has("password_value"),
      options.profile,
      options.decryption,
    );
    const originUrl = preservedString(get("origin_url"));
    const signonRealm = preservedString(get("signon_realm"));
    const usernameValue = preservedString(get("username_value"));
    const actionUrl = preservedString(get("action_url"));
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
      credentialId: valueField(rowId),
      originUrl,
      actionUrl,
      signonRealm,
      usernameElement: preservedString(get("username_element")),
      usernameValue,
      passwordElement: preservedString(get("password_element")),
      secret: secret.secret,
      secretEncryptionScheme: secret.scheme,
      secretEncryptionPrefix: secret.prefix,
      secretByteLength: secret.byteLength,
      secretDecryptionRoute: secret.decryptionRoute,
      secretKeyMaterialRecordId: secret.keyMaterialRecordId,
      dateCreated,
      dateLastUsed,
      datePasswordModified: timestampField(
        get("date_password_modified"),
        has("date_password_modified"),
        options.schema.version,
        options.declaredTimezone,
      ),
      timesUsed: preservedInteger(get("times_used")),
      blacklistedByUser: preservedBoolean(get("blacklisted_by_user")),
      scheme: preservedInteger(get("scheme")),
      passwordType: preservedInteger(get("password_type")),
      displayName: preservedString(get("display_name")),
      iconUrl: preservedString(get("icon_url")),
      federationUrl: preservedString(get("federation_url")),
      skipZeroClick: preservedBoolean(get("skip_zero_click")),
      generationUploadStatus: preservedInteger(get("generation_upload_status")),
    };
    const finding: Finding = createFinding({
      findingKind: "login_credential",
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
          textValue(originUrl),
          textValue(actionUrl),
          textValue(signonRealm),
          textValue(usernameValue),
        ]
          .join("\n")
          .toLocaleLowerCase("en-US"),
        sortCreated: timeValue(dateCreated),
        sortLastUsed: timeValue(dateLastUsed),
        sortOrigin: textValue(originUrl) || null,
        sortUsername: textValue(usernameValue) || null,
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
): LoginDataArtifactWrite {
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
    committedCredentialCount: 0,
    recoveredCredentialCount: 0,
  };
}

export async function analyseLoginDataProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly decryption: DecryptionSettings;
}): Promise<LoginDataArtifactWrite> {
  const databasePath =
    options.profile === "." ? "Login Data" : `${options.profile}/Login Data`;
  const manifest = manifestIdentity(options.source, databasePath);
  if (manifest === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      null,
      "absent",
      "login_data_manifest_entry_missing",
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
      "login_data_absent",
    );
  }
  if (entry.state === "unavailable") {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      `login_data_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "login_data_not_in_working_copy",
    );
  }
  if (entry.size === null || entry.sha256 === null) {
    return unavailableArtifact(
      options.source.sourceId,
      options.profile,
      databasePath,
      manifest.ordinal,
      "unavailable",
      "login_data_manifest_representation_incomplete",
    );
  }

  const verifiedDatabase: VerifiedLoginFile = {
    path: join(options.workingCopyPath, ...databasePath.split("/")),
    manifestPath: databasePath,
    size: entry.size,
    sha256: entry.sha256,
  };
  const sidecars: VerifiedLoginFile[] = options.source.entries
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
    const passes = await readLoginPasses({
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
        "Login Data recovery content has no resolvable sidecar Manifest entry.",
        { database_path: databasePath },
      );
    }
    const committed = buildCredentials({
      rows: passes.committed.rows,
      schema: passes.committed.schema,
      commitState: "committed",
      profile: options.profile,
      manifest,
      declaredTimezone: options.declaredTimezone,
      decryption: options.decryption,
    });
    const recovered =
      passes.recovered === null
        ? []
        : buildCredentials({
            rows: passes.recovered.rows,
            schema: passes.recovered.schema,
            commitState: passes.recovered.commitState,
            profile: options.profile,
            manifest: recoveredManifest as ManifestIdentity,
            declaredTimezone: options.declaredTimezone,
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
      findings: [
        ...committed.map((credential) => credential.persisted),
        ...recovered.map((credential) => credential.persisted),
      ],
      committedCredentialCount: committed.length,
      recoveredCredentialCount: recovered.length,
    };
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `login_data_read_failed:${String(error)}`;
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
