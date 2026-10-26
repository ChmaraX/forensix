import { createHash } from "node:crypto";

import type {
  CookieArtifactWrite,
  DeclaredOriginOs,
  PersistedCookieFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { readCookiePasses, type CookiePass } from "./cookies-sqlite.js";
import { ForensixError } from "./errors.js";
import {
  absentField,
  createFinding,
  unavailableField,
  valueField,
  type FieldState,
  type Finding,
} from "./forensic-model.js";
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
  type CitedPass,
  type SqliteArtifactHeader,
  type RawSqliteValue,
  type TimestampEpoch,
} from "./sqlite-artifact.js";
import type { ForensicTimestamp } from "./history.js";
import { decryptSecretField, type PlaintextUnwrap } from "./decrypted-field.js";
import { schemeOf, type DecryptionSettings } from "./oscrypt.js";

/**
 * Chromium stores cookie times as `base::Time`: microseconds since the Windows
 * 1601 epoch on every platform. At or above this schema version the `meta`
 * table is treated as self-describing, so the epoch needs no operator input.
 * Below it the analyzer refuses to assert an epoch without a Declared Origin OS.
 */
const COOKIE_VERIFIED_SCHEMA_MINIMUM = 10;

/**
 * From Cookies schema version 24, Chromium encrypts `SHA-256(host_key)`
 * followed by the cookie value, and on read it refuses a row whose decrypted
 * bytes do not start with that hash (net/extras/sqlite/
 * sqlite_persistent_cookie_store.cc, `MakeCookiesFromSQLStatement`).
 */
const COOKIE_HOST_KEY_HASH_SCHEMA_MINIMUM = 24;
const HOST_KEY_HASH_BYTES = 32;

/**
 * The check for a version 24+ decrypted Cookie value: the first 32 bytes must
 * equal SHA-256 of the row's `host_key`, and only the bytes after them are the
 * value. A mismatch stays unavailable; the analyzer never guesses a value.
 */
function hostKeyHashUnwrap(hostKey: FieldState<string>): PlaintextUnwrap {
  return (plaintext) => {
    if (hostKey.state !== "value") {
      return { ok: false, reason: "cookie_host_key_hash_unverifiable" };
    }
    const expected = createHash("sha256")
      .update(Buffer.from(hostKey.value, "utf8"))
      .digest();
    if (
      plaintext.length < HOST_KEY_HASH_BYTES ||
      !expected.equals(plaintext.subarray(0, HOST_KEY_HASH_BYTES))
    ) {
      return { ok: false, reason: "cookie_host_key_hash_mismatch" };
    }
    return { ok: true, plaintext: plaintext.subarray(HOST_KEY_HASH_BYTES) };
  };
}

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

function resolveCookieEpoch(
  schemaVersion: number,
  declaredOriginOs: DeclaredOriginOs | null,
): TimestampEpoch | null {
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

function buildCookies(
  cited: CitedPass<CookiePass>,
  options: {
    readonly profile: string;
    readonly declaredTimezone: string;
    readonly declaredOriginOs: DeclaredOriginOs | null;
    readonly decryption: DecryptionSettings;
  },
): PersistedCookieFinding[] {
  const { schema } = cited.pass;
  const columns = schema.cookieColumns;
  const epoch = resolveCookieEpoch(schema.version, options.declaredOriginOs);
  return cited.pass.rows.map((row) => {
    if (typeof row.rowId !== "bigint") {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Cookies rowid is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const hostKey = preservedString(row.hostKey, columns.has("host_key"));
    const name = preservedString(row.name, columns.has("name"));
    const path = preservedString(row.path, columns.has("path"));
    const plaintextValue = preservedString(row.value, columns.has("value"));
    const encrypted =
      row.encryptedValue instanceof Uint8Array ? row.encryptedValue : null;
    // The encrypted secret, narrowed to a non-empty blob; an empty blob is not
    // a secret. `encrypted` is kept for the retained byte-length metadata.
    const secretBlob =
      encrypted !== null && encrypted.length > 0 ? encrypted : null;
    const isEncrypted = secretBlob !== null;
    const schemeClass = secretBlob !== null ? schemeOf(secretBlob) : null;
    // The displayed scheme keeps only the canonical v10/v11/v20 classes; a
    // legacy (unprefixed) blob has no recognised scheme string.
    const scheme =
      schemeClass === null || schemeClass === "legacy" ? null : schemeClass;
    const decrypted =
      secretBlob !== null
        ? decryptSecretField(
            secretBlob,
            options.profile,
            options.decryption,
            schema.version >= COOKIE_HOST_KEY_HASH_SCHEMA_MINIMUM
              ? hostKeyHashUnwrap(hostKey)
              : undefined,
          )
        : null;

    const sameSite = enumFields(
      row.samesite,
      SAME_SITE_LABELS,
      columns.has("samesite"),
    );
    const priority = enumFields(
      row.priority,
      PRIORITY_LABELS,
      columns.has("priority"),
    );
    const sourceScheme = enumFields(
      row.sourceScheme,
      SOURCE_SCHEME_LABELS,
      columns.has("source_scheme"),
    );
    const sourceType = enumFields(
      row.sourceType,
      SOURCE_TYPE_LABELS,
      columns.has("source_type"),
    );
    const time = (
      raw: RawSqliteValue,
      column: string,
    ): FieldState<ForensicTimestamp> =>
      timestampField(raw, columns.has(column), epoch, options.declaredTimezone);
    const creationTime = time(row.creationUtc, "creation_utc");
    const expiresTime = time(row.expiresUtc, "expires_utc");
    const lastAccessTime = time(row.lastAccessUtc, "last_access_utc");
    const lastUpdateTime = time(row.lastUpdateUtc, "last_update_utc");

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
      commitState: cited.commitState,
      provenance: {
        ...sourceRowProvenance(cited.manifest, "cookies", rowId),
        ...(cited.recoveredVia === undefined
          ? {}
          : { recoveredVia: cited.recoveredVia }),
      },
      fields,
    });

    const hostValue = hostKey.state === "value" ? hostKey.value : null;
    const nameValue = name.state === "value" ? name.value : null;
    return {
      finding,
      // The Cookie value is a secret (see record-redaction.ts), so it is
      // never put in the search text: a substring search would otherwise
      // let a caller rebuild a withheld value one prefix at a time.
      searchText: [
        options.profile,
        hostValue ?? "",
        nameValue ?? "",
        path.state === "value" ? path.value : "",
        isEncrypted ? `encrypted ${scheme ?? "unknown"}` : "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortHost: hostValue,
      sortName: nameValue,
      sortCreation:
        creationTime.state === "value" ? creationTime.value.utc : null,
      sortExpires: expiresTime.state === "value" ? expiresTime.value.utc : null,
      sortLastAccess:
        lastAccessTime.state === "value" ? lastAccessTime.value.utc : null,
      hostKey: hostValue,
      sameSite: sameSite.label.state === "value" ? sameSite.label.value : null,
    };
  });
}

function unavailableArtifact(
  header: SqliteArtifactHeader,
): CookieArtifactWrite {
  return {
    ...header,
    findings: [],
    committedCookieCount: 0,
    recoveredCookieCount: 0,
  };
}

/**
 * Chromium moved the profile Cookies store under `Network/` in 2020. The
 * analyzer prefers that modern path and falls back to the legacy top-level
 * `Cookies` file so both schema generations are parsed. Only an `absent`
 * entry falls back: a store that exists but could not be read (`unavailable`)
 * is reported with its reason, and never replaced by an older copy.
 */
async function analyseProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly declaredOriginOs: DeclaredOriginOs | null;
  readonly decryption: DecryptionSettings;
}): Promise<CookieArtifactWrite> {
  const resolved = resolveProfileDatabase({
    ...options,
    label: "cookies",
    relativePaths: ["Network/Cookies", "Cookies"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readCookiePasses(target);
    const cited = citedPasses(target, passes);
    const committed = buildCookies(cited.committed, options);
    const recovered =
      cited.recovered === null ? [] : buildCookies(cited.recovered, options);
    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered],
      committedCookieCount: committed.length,
      recoveredCookieCount: recovered.length,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "cookies", error));
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
