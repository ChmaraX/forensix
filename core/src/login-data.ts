import type {
  LoginDataArtifactWrite,
  PersistedLoginFinding,
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
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import { decryptSecretField } from "./decrypted-field.js";
import { schemeOf, type DecryptionSettings } from "./oscrypt.js";
import { readLoginPasses, type LoginPass } from "./login-data-sqlite.js";
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
  type RawSqliteValue,
  type SqliteArtifactHeader,
} from "./sqlite-artifact.js";

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
  value: RawSqliteValue,
  columnPresent: boolean,
  profile: string,
  decryption: DecryptionSettings,
): SecretDescription {
  if (!columnPresent || value === null) {
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

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildCredentials(
  cited: CitedPass<LoginPass>,
  options: {
    readonly profile: string;
    readonly declaredTimezone: string;
    readonly decryption: DecryptionSettings;
  },
): PersistedLoginFinding[] {
  const { schema } = cited.pass;
  // Chrome stores password-store times as `base::Time` internal values:
  // microseconds since 1601-01-01 UTC on every platform, so the epoch does not
  // depend on the origin OS.
  const epoch = {
    epochFamily: "1601-us",
    resolution: `verified_login_data_schema_version_${schema.version}`,
  } as const;
  return cited.pass.rows.map((row) => {
    if (row.id === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Login Data logins.id is not an exact integer.",
      );
    }
    const rowId = row.id.toString();
    const get = (column: string): RawSqliteValue =>
      row.values.get(column) ?? null;
    const time = (column: string): FieldState<ForensicTimestamp> =>
      timestampField(
        get(column),
        schema.columns.has(column),
        epoch,
        options.declaredTimezone,
      );
    const secret = describeSecret(
      get("password_value"),
      schema.columns.has("password_value"),
      options.profile,
      options.decryption,
    );
    const originUrl = preservedString(get("origin_url"));
    const signonRealm = preservedString(get("signon_realm"));
    const usernameValue = preservedString(get("username_value"));
    const actionUrl = preservedString(get("action_url"));
    const dateCreated = time("date_created");
    const dateLastUsed = time("date_last_used");
    const finding: Finding = createFinding({
      findingKind: "login_credential",
      profile: options.profile,
      commitState: cited.commitState,
      provenance: {
        ...sourceRowProvenance(cited.manifest, "logins", rowId),
        ...(cited.recoveredVia === undefined
          ? {}
          : { recoveredVia: cited.recoveredVia }),
      },
      fields: {
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
        datePasswordModified: time("date_password_modified"),
        timesUsed: preservedInteger(get("times_used")),
        blacklistedByUser: preservedBoolean(get("blacklisted_by_user")),
        scheme: preservedInteger(get("scheme")),
        passwordType: preservedInteger(get("password_type")),
        displayName: preservedString(get("display_name")),
        iconUrl: preservedString(get("icon_url")),
        federationUrl: preservedString(get("federation_url")),
        skipZeroClick: preservedBoolean(get("skip_zero_click")),
        generationUploadStatus: preservedInteger(
          get("generation_upload_status"),
        ),
      },
    });
    return {
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
    };
  });
}

function unavailableArtifact(
  header: SqliteArtifactHeader,
): LoginDataArtifactWrite {
  return {
    ...header,
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
  const resolved = resolveProfileDatabase({
    ...options,
    label: "login_data",
    relativePaths: ["Login Data"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readLoginPasses(target);
    const cited = citedPasses(target, passes);
    const committed = buildCredentials(cited.committed, options);
    const recovered =
      cited.recovered === null
        ? []
        : buildCredentials(cited.recovered, options);
    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered],
      committedCredentialCount: committed.length,
      recoveredCredentialCount: recovered.length,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "login_data", error));
  }
}
