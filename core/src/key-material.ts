import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";

import { ForensixError } from "./errors.js";
import type {
  AuthorizedKeyMaterial,
  KeyMaterialProvenance,
  OscryptRoute,
} from "./oscrypt.js";

/**
 * Resolve authorized OSCrypt key material for the offline Analyzer.
 *
 * This module only reads the operator-provided key-material file (and, for
 * captured material, the operator's recipient private key). It never reads a
 * live key store, never writes Source bytes, and makes no network calls. It
 * supports two input shapes:
 *
 * - `supplied`: an operator-authored file that names each route, its key kind,
 *   and the raw key bytes, each carrying explicit Provenance.
 * - `captured`: sealed records from the Collector's `key_material/` subtree
 *   (see `collector/contracts/key-material`). Each `captured` record seals a
 *   derived OSCrypt row key to an X25519 recipient key; the operator supplies
 *   the matching private key to unseal it offline.
 *
 * Records that do not carry a usable row key, or that map to an unsupported
 * route, are skipped and reported as typed issues; they never become a guessed
 * key.
 */

const SEAL_INFO = "forensix/key-material-seal/1";

export interface KeyMaterialIssue {
  readonly recordId: string;
  readonly reason: string;
}

export interface ResolvedKeyMaterial {
  readonly material: readonly AuthorizedKeyMaterial[];
  readonly issues: readonly KeyMaterialIssue[];
}

export interface LoadKeyMaterialOptions {
  readonly keyMaterialPath: string;
  /** PEM (PKCS8) X25519 private key path, required to unseal captured records. */
  readonly recipientKeyPath?: string;
}

interface SuppliedEntry {
  readonly recordId?: string;
  readonly record_id?: string;
  readonly route: OscryptRoute;
  readonly keyKind?: AuthorizedKeyMaterial["keyKind"];
  readonly key_kind?: AuthorizedKeyMaterial["keyKind"];
  readonly secretBase64?: string;
  readonly secret_base64?: string;
  readonly rowPrefix?: "" | "v10" | "v11" | "v20";
  readonly row_prefix?: "" | "v10" | "v11" | "v20";
  readonly profile?: string | null;
  readonly masterKeyGuid?: string;
  readonly master_key_guid?: string;
  readonly provider?: {
    readonly platform?: KeyMaterialProvenance["providerPlatform"];
    readonly name?: string;
    readonly item?: string;
    readonly scope?: string;
  };
}

interface SuppliedFile {
  readonly schema: "forensix/supplied-key-material/1";
  readonly entries: readonly SuppliedEntry[];
}

interface CapturedProvider {
  readonly platform: "darwin" | "linux" | "windows" | "unknown";
  readonly name: string;
  readonly item: string;
  readonly scope: string;
}

interface CapturedContext {
  readonly name: string;
  readonly value: string;
}

interface CapturedPolicy {
  readonly row_prefix: "" | "v10" | "v11" | "v20";
  readonly support: "supported" | "unsupported" | "unavailable";
  readonly reason?: string;
}

interface CapturedEvidence {
  readonly path: string;
  readonly sha256: string;
  readonly version?: string;
  readonly policy?: string;
}

interface CapturedSealedMaterial {
  readonly algorithm: "x25519-hkdf-sha256-aes-256-gcm";
  readonly recipient_fingerprint: string;
  readonly ephemeral_public_key: string;
  readonly salt: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly associated_data_sha256: string;
}

interface CapturedRecord {
  readonly schema_version: "forensix/key-material-record/1";
  readonly record_id: string;
  readonly capture_state: "captured" | "unsupported" | "unavailable";
  readonly key_kind: "oscrypt_row_key";
  readonly usable_row_key: boolean;
  readonly provider: CapturedProvider;
  readonly context: readonly CapturedContext[];
  readonly policy: CapturedPolicy;
  readonly evidence: readonly CapturedEvidence[];
  readonly sealed_material: CapturedSealedMaterial | null;
}

interface CapturedFile {
  readonly schema: "forensix/key-material-bundle/1";
  readonly records: readonly CapturedRecord[];
}

function invalid(message: string): ForensixError {
  return new ForensixError("INVALID_ARGUMENT", message);
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw invalid(`Key material file could not be read: ${String(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw invalid(`Key material file is not valid JSON: ${String(error)}`);
  }
}

function providerFromSupplied(
  entry: SuppliedEntry,
): Pick<
  KeyMaterialProvenance,
  "providerPlatform" | "providerName" | "providerItem" | "providerScope"
> {
  const provider = entry.provider ?? {};
  return {
    providerPlatform: provider.platform ?? "unknown",
    providerName: provider.name ?? "supplied",
    providerItem: provider.item ?? "supplied",
    providerScope: provider.scope ?? "supplied",
  };
}

function resolveSupplied(file: SuppliedFile): ResolvedKeyMaterial {
  const material: AuthorizedKeyMaterial[] = [];
  const issues: KeyMaterialIssue[] = [];
  file.entries.forEach((entry, index) => {
    const recordId = entry.recordId ?? entry.record_id ?? `supplied-${index}`;
    const secretBase64 = entry.secretBase64 ?? entry.secret_base64;
    if (secretBase64 === undefined) {
      issues.push({ recordId, reason: "missing_secret" });
      return;
    }
    const secret = new Uint8Array(Buffer.from(secretBase64, "base64"));
    if (secret.length === 0) {
      issues.push({ recordId, reason: "empty_secret" });
      return;
    }
    const provenance: KeyMaterialProvenance = {
      origin: "supplied",
      recordId,
      route: entry.route,
      rowPrefix: entry.rowPrefix ?? entry.row_prefix ?? "",
      profileScope: entry.profile ?? null,
      evidenceSha256: [],
      ...providerFromSupplied(entry),
    };
    const masterKeyGuid = entry.masterKeyGuid ?? entry.master_key_guid;
    material.push({
      provenance,
      keyKind: entry.keyKind ?? entry.key_kind ?? "row_key",
      secret,
      ...(masterKeyGuid === undefined ? {} : { masterKeyGuid }),
    });
  });
  return { material, issues };
}

/**
 * Map a captured record's provider and policy onto a supported route. Returns
 * `null` (and the caller records an issue) for anything outside the evidenced
 * bounds, so an unsupported provider never silently becomes a guessed route.
 */
function routeFromRecord(record: CapturedRecord): OscryptRoute | null {
  const platform = record.provider.platform;
  const name = record.provider.name.toLowerCase();
  if (platform === "darwin") {
    return "macos-keychain";
  }
  if (platform === "windows") {
    return record.policy.row_prefix === "v10"
      ? "windows-dpapi-v10"
      : record.policy.row_prefix === ""
        ? "windows-dpapi-legacy"
        : null;
  }
  if (platform === "linux") {
    if (name.includes("kwallet")) {
      return "kwallet";
    }
    if (
      name.includes("keyring") ||
      name.includes("libsecret") ||
      name.includes("gnome")
    ) {
      return "gnome-keyring";
    }
    if (name.includes("basic") || name.includes("plain")) {
      return "linux-basic";
    }
  }
  return null;
}

function base64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

/**
 * Rebuild the associated data the Collector authenticated: one compact JSON
 * line of the record with `sealed_material` set to `null`, in the record schema
 * field order, terminated by LF.
 */
export function associatedDataLine(record: CapturedRecord): string {
  const ordered: Record<string, unknown> = {
    schema_version: record.schema_version,
    record_id: record.record_id,
    capture_state: record.capture_state,
    key_kind: record.key_kind,
    usable_row_key: record.usable_row_key,
    provider: {
      platform: record.provider.platform,
      name: record.provider.name,
      item: record.provider.item,
      scope: record.provider.scope,
    },
    context: record.context.map((entry) => ({
      name: entry.name,
      value: entry.value,
    })),
    policy: {
      row_prefix: record.policy.row_prefix,
      support: record.policy.support,
      ...(record.policy.reason === undefined
        ? {}
        : { reason: record.policy.reason }),
    },
    evidence: record.evidence.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      ...(entry.version === undefined ? {} : { version: entry.version }),
      ...(entry.policy === undefined ? {} : { policy: entry.policy }),
    })),
    sealed_material: null,
  };
  return `${JSON.stringify(ordered)}\n`;
}

function unsealRowKey(
  record: CapturedRecord,
  recipientPrivateKey: KeyObject,
): Uint8Array {
  const sealed = record.sealed_material;
  if (sealed === null) {
    throw invalid("captured record has no sealed material");
  }
  const ephemeralPublicKey = createPublicKey({
    key: Buffer.concat([
      // SubjectPublicKeyInfo prefix for a raw 32-byte X25519 public key.
      Buffer.from("302a300506032b656e032100", "hex"),
      base64(sealed.ephemeral_public_key),
    ]),
    format: "der",
    type: "spki",
  });
  const shared = diffieHellman({
    privateKey: recipientPrivateKey,
    publicKey: ephemeralPublicKey,
  });
  const sealKey = Buffer.from(
    hkdfSync("sha256", shared, base64(sealed.salt), SEAL_INFO, 32),
  );
  const ciphertext = base64(sealed.ciphertext);
  if (ciphertext.length < 16) {
    throw invalid("sealed ciphertext is too short");
  }
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    sealKey,
    base64(sealed.nonce),
  );
  decipher.setAAD(Buffer.from(associatedDataLine(record), "utf8"));
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(body), decipher.final()]),
  );
}

function profileScopeFromContext(record: CapturedRecord): string | null {
  const entry = record.context.find((item) => item.name === "profile");
  return entry === undefined || entry.value.length === 0 ? null : entry.value;
}

function resolveCaptured(
  file: CapturedFile,
  recipientKeyPath: string | undefined,
): ResolvedKeyMaterial {
  const material: AuthorizedKeyMaterial[] = [];
  const issues: KeyMaterialIssue[] = [];
  let recipientKey: KeyObject | null = null;
  if (recipientKeyPath !== undefined) {
    try {
      recipientKey = createPrivateKey(readFileSync(recipientKeyPath, "utf8"));
    } catch (error) {
      throw invalid(`Recipient private key is unusable: ${String(error)}`);
    }
  }
  for (const record of file.records) {
    if (record.capture_state !== "captured" || !record.usable_row_key) {
      issues.push({
        recordId: record.record_id,
        reason: record.policy.reason ?? `capture_state_${record.capture_state}`,
      });
      continue;
    }
    const route = routeFromRecord(record);
    if (route === null) {
      issues.push({
        recordId: record.record_id,
        reason: "unsupported_route",
      });
      continue;
    }
    if (recipientKey === null) {
      issues.push({
        recordId: record.record_id,
        reason: "recipient_private_key_required",
      });
      continue;
    }
    let secret: Uint8Array;
    try {
      secret = unsealRowKey(record, recipientKey);
    } catch (error) {
      issues.push({
        recordId: record.record_id,
        reason: `unseal_failed:${
          error instanceof ForensixError ? error.message : String(error)
        }`,
      });
      continue;
    }
    material.push({
      provenance: {
        origin: "captured",
        recordId: record.record_id,
        route,
        rowPrefix: record.policy.row_prefix,
        providerPlatform: record.provider.platform,
        providerName: record.provider.name,
        providerItem: record.provider.item,
        providerScope: record.provider.scope,
        profileScope: profileScopeFromContext(record),
        evidenceSha256: record.evidence.map((entry) => entry.sha256),
      },
      keyKind: "row_key",
      secret,
    });
  }
  return { material, issues };
}

/**
 * Load and resolve authorized key material from an operator-provided file.
 * Throws `INVALID_ARGUMENT` only for a structurally unusable file; individual
 * records that cannot be resolved are reported as typed issues.
 */
export function loadAuthorizedKeyMaterial(
  options: LoadKeyMaterialOptions,
): ResolvedKeyMaterial {
  const parsed = readJson(options.keyMaterialPath);
  if (parsed === null || typeof parsed !== "object") {
    throw invalid("Key material file must be a JSON object.");
  }
  const schema = (parsed as { readonly schema?: unknown }).schema;
  if (schema === "forensix/supplied-key-material/1") {
    return resolveSupplied(parsed as SuppliedFile);
  }
  if (schema === "forensix/key-material-bundle/1") {
    return resolveCaptured(parsed as CapturedFile, options.recipientKeyPath);
  }
  throw invalid(
    "Key material file has an unrecognised schema; expected " +
      "forensix/supplied-key-material/1 or forensix/key-material-bundle/1.",
  );
}
