import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  type KeyObject,
} from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ForensixError } from "./errors.js";
import {
  OSCRYPT_ROUTES,
  type AuthorizedKeyMaterial,
  type KeyMaterialProvenance,
  type OscryptRoute,
} from "./oscrypt.js";

/**
 * Resolve authorized OSCrypt key material for the offline Analyzer.
 *
 * This module only reads the operator-provided key-material file (and, for
 * captured material, the operator's recipient private key). It never reads a
 * live key store, never writes Source bytes, and makes no network calls. It
 * supports these input shapes:
 *
 * - `supplied`: an operator-authored file that names each route, its key kind,
 *   and the raw key bytes, each carrying explicit Provenance.
 * - `captured`: sealed records from the Collector's `key_material/` subtree
 *   (see `collector/contracts/key-material`). Each `captured` record seals a
 *   derived OSCrypt row key to an X25519 recipient key; the operator supplies
 *   the matching private key to unseal it offline. The operator passes either
 *   the subtree directory `key_material/<account>/udd-N`, which is verified
 *   against its key-material Manifest first, or the subtree's
 *   `key_material_bundle.json` file.
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

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (values as readonly unknown[]).includes(value);
}

const KEY_KINDS: readonly AuthorizedKeyMaterial["keyKind"][] = [
  "row_key",
  "passphrase",
  "dpapi_master_key",
];
const ROW_PREFIXES: readonly KeyMaterialProvenance["rowPrefix"][] = [
  "",
  "v10",
  "v11",
  "v20",
];
const PLATFORMS: readonly KeyMaterialProvenance["providerPlatform"][] = [
  "darwin",
  "linux",
  "windows",
  "unknown",
];
const CAPTURE_STATES: readonly CapturedRecord["capture_state"][] = [
  "captured",
  "unsupported",
  "unavailable",
];
const POLICY_SUPPORT: readonly CapturedPolicy["support"][] = [
  "supported",
  "unsupported",
  "unavailable",
];
const SEALED_TEXT_FIELDS = [
  "recipient_fingerprint",
  "ephemeral_public_key",
  "salt",
  "nonce",
  "ciphertext",
  "associated_data_sha256",
] as const;

/** Whether a bundle record has the shape of the key-material record schema. */
function isCapturedRecord(value: unknown): value is CapturedRecord {
  if (!isObject(value)) {
    return false;
  }
  const { provider, context, policy, evidence } = value;
  const sealed = value.sealed_material;
  return (
    value.schema_version === "forensix/key-material-record/1" &&
    isString(value.record_id) &&
    isOneOf(CAPTURE_STATES, value.capture_state) &&
    value.key_kind === "oscrypt_row_key" &&
    typeof value.usable_row_key === "boolean" &&
    isObject(provider) &&
    isOneOf(PLATFORMS, provider.platform) &&
    isString(provider.name) &&
    isString(provider.item) &&
    isString(provider.scope) &&
    Array.isArray(context) &&
    context.every(
      (entry) =>
        isObject(entry) && isString(entry.name) && isString(entry.value),
    ) &&
    isObject(policy) &&
    isOneOf(ROW_PREFIXES, policy.row_prefix) &&
    isOneOf(POLICY_SUPPORT, policy.support) &&
    isOptionalString(policy.reason) &&
    Array.isArray(evidence) &&
    evidence.every(
      (entry) =>
        isObject(entry) &&
        isString(entry.path) &&
        isString(entry.sha256) &&
        isOptionalString(entry.version) &&
        isOptionalString(entry.policy),
    ) &&
    (sealed === null ||
      (isObject(sealed) &&
        sealed.algorithm === "x25519-hkdf-sha256-aes-256-gcm" &&
        SEALED_TEXT_FIELDS.every((field) => isString(sealed[field]))))
  );
}

function invalid(message: string): ForensixError {
  return new ForensixError("INVALID_ARGUMENT", message);
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw invalid(`${name} is not valid JSON: ${String(error)}`);
  }
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw invalid(`Key material file could not be read: ${String(error)}`);
  }
  return parseJson(text, "Key material file");
}

const KEY_MATERIAL_MANIFEST_SCHEMA = "forensix/key-material-manifest/1";
const KEY_MATERIAL_MANIFEST = "key_material_manifest.jsonl";
const KEY_MATERIAL_MANIFEST_HEADER = "key_material_manifest_header.json";
/** The aggregate analyzer input that the Collector writes in each subtree. */
const KEY_MATERIAL_BUNDLE_FILE = "key_material_bundle.json";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSubtreePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function subtreeRegularFiles(root: string, relative = ""): string[] {
  const files: string[] = [];
  const directory = relative === "" ? root : join(root, ...relative.split("/"));
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...subtreeRegularFiles(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw invalid(
        `Key-material subtree contains an unsupported node: ${path}`,
      );
    }
  }
  return files;
}

/** The string `record_id` of an aggregate record, or "" when it has none. */
function recordIdOf(record: unknown): string {
  return record !== null &&
    typeof record === "object" &&
    "record_id" in record &&
    typeof record.record_id === "string"
    ? record.record_id
    : "";
}

/**
 * Read a Collector key-material subtree. Each payload file must match the
 * subtree's key-material Manifest, and the Manifest must match the digest in
 * its header. The aggregate `key_material_bundle.json` must hold the same
 * records as `records/*.json`. Returns the parsed aggregate file.
 */
function readVerifiedKeyMaterialSubtree(root: string): unknown {
  const fail = (reason: string): ForensixError =>
    invalid(`Key-material subtree failed verification: ${reason}`);
  let headerText: string;
  let manifestBytes: Buffer;
  try {
    headerText = readFileSync(join(root, KEY_MATERIAL_MANIFEST_HEADER), "utf8");
    manifestBytes = readFileSync(join(root, KEY_MATERIAL_MANIFEST));
  } catch {
    throw invalid(
      "Key material directory is not a Collector key-material subtree; " +
        "pass key_material/<account>/udd-N from the Acquisition Bundle.",
    );
  }
  const header = parseJson(headerText, KEY_MATERIAL_MANIFEST_HEADER) as Record<
    string,
    unknown
  > | null;
  if (
    header === null ||
    typeof header !== "object" ||
    header.manifest_schema !== KEY_MATERIAL_MANIFEST_SCHEMA ||
    header.hash_algorithm !== "sha-256"
  ) {
    throw fail("unsupported key-material Manifest header");
  }
  if (header.manifest_digest !== sha256Hex(manifestBytes)) {
    throw fail("key-material Manifest digest mismatch");
  }
  const text = manifestBytes.toString("utf8");
  if (text.length > 0 && !text.endsWith("\n")) {
    throw fail("key-material Manifest is not LF-terminated JSONL");
  }
  const lines = text.length === 0 ? [] : text.slice(0, -1).split("\n");
  if (header.entry_count !== lines.length) {
    throw fail("key-material Manifest entry count mismatch");
  }
  const verified = new Map<string, Buffer>();
  let previous: string | null = null;
  for (const line of lines) {
    const entry = parseJson(line, KEY_MATERIAL_MANIFEST) as Record<
      string,
      unknown
    > | null;
    const path = entry?.path;
    if (
      entry === null ||
      typeof entry !== "object" ||
      !canonicalSubtreePath(path) ||
      path === KEY_MATERIAL_MANIFEST ||
      path === KEY_MATERIAL_MANIFEST_HEADER ||
      entry.hash_algorithm !== "sha-256" ||
      (previous !== null &&
        Buffer.compare(Buffer.from(previous), Buffer.from(path)) >= 0)
    ) {
      throw fail("key-material Manifest entry is invalid or out of order");
    }
    previous = path;
    const absolute = join(root, ...path.split("/"));
    let bytes: Buffer;
    try {
      if (!lstatSync(absolute).isFile()) {
        throw fail(`${path} is not a regular file`);
      }
      bytes = readFileSync(absolute);
    } catch (error) {
      if (error instanceof ForensixError) {
        throw error;
      }
      throw fail(`${path} is missing or unreadable`);
    }
    if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      throw fail(`${path} does not match the key-material Manifest`);
    }
    verified.set(path, bytes);
  }
  let actualFiles: string[];
  try {
    actualFiles = subtreeRegularFiles(root);
  } catch (error) {
    if (error instanceof ForensixError) {
      throw error;
    }
    throw fail("the subtree cannot be listed");
  }
  for (const path of actualFiles) {
    if (
      path !== KEY_MATERIAL_MANIFEST &&
      path !== KEY_MATERIAL_MANIFEST_HEADER &&
      !verified.has(path)
    ) {
      throw fail(`${path} is not in the key-material Manifest`);
    }
  }
  const aggregateBytes = verified.get(KEY_MATERIAL_BUNDLE_FILE);
  if (aggregateBytes === undefined) {
    throw fail(`${KEY_MATERIAL_BUNDLE_FILE} is missing`);
  }
  const aggregate = parseJson(
    aggregateBytes.toString("utf8"),
    KEY_MATERIAL_BUNDLE_FILE,
  ) as { readonly records?: unknown } | null;
  const records = Array.isArray(aggregate?.records) ? aggregate.records : null;
  const recordFiles = new Set(
    [...verified.keys()].filter((path) => path.startsWith("records/")),
  );
  if (records === null || records.length !== recordFiles.size) {
    throw fail(`${KEY_MATERIAL_BUNDLE_FILE} does not list every record`);
  }
  // Each record id occurs one time, and the aggregate names exactly the
  // manifested record files. A count match alone lets a duplicate id hide a
  // manifested record that is never compared.
  const listedFiles = new Set<string>();
  for (const record of records as readonly unknown[]) {
    const recordId = recordIdOf(record);
    const path = `records/${recordId}.json`;
    if (recordId !== "" && listedFiles.has(path)) {
      throw fail(
        `${KEY_MATERIAL_BUNDLE_FILE} lists the record id ${recordId} more than once`,
      );
    }
    listedFiles.add(path);
  }
  for (const path of recordFiles) {
    if (!listedFiles.has(path)) {
      throw fail(`${KEY_MATERIAL_BUNDLE_FILE} does not list ${path}`);
    }
  }
  for (const record of records as readonly unknown[]) {
    const recordId = recordIdOf(record);
    const bytes = verified.get(`records/${recordId}.json`);
    if (
      recordId === "" ||
      bytes === undefined ||
      !isDeepStrictEqual(
        parseJson(bytes.toString("utf8"), "key-material record"),
        record,
      )
    ) {
      throw fail(
        `${KEY_MATERIAL_BUNDLE_FILE} differs from records/${recordId}.json`,
      );
    }
  }
  return aggregate;
}

/**
 * Parse one supplied entry. Each field takes its camelCase or snake_case name.
 * An entry that does not parse is an issue, never a guessed key.
 */
function resolveSuppliedEntry(
  entry: unknown,
  index: number,
): AuthorizedKeyMaterial | KeyMaterialIssue {
  const fallbackId = `supplied-${index}`;
  if (!isObject(entry)) {
    return { recordId: fallbackId, reason: "invalid_entry" };
  }
  const pick = (camel: string, snake: string): unknown =>
    entry[camel] ?? entry[snake];
  const recordId = pick("recordId", "record_id") ?? fallbackId;
  if (!isString(recordId)) {
    return { recordId: fallbackId, reason: "invalid_record_id" };
  }
  const issue = (reason: string): KeyMaterialIssue => ({ recordId, reason });
  const route = entry.route;
  const keyKind = pick("keyKind", "key_kind") ?? "row_key";
  const rowPrefix = pick("rowPrefix", "row_prefix") ?? "";
  const profileScope = entry.profile ?? null;
  const masterKeyGuid = pick("masterKeyGuid", "master_key_guid");
  const provider = entry.provider ?? {};
  const secretBase64 = pick("secretBase64", "secret_base64");
  if (!isOneOf(OSCRYPT_ROUTES, route)) {
    return issue("invalid_route");
  }
  if (!isOneOf(KEY_KINDS, keyKind)) {
    return issue("invalid_key_kind");
  }
  if (!isOneOf(ROW_PREFIXES, rowPrefix)) {
    return issue("invalid_row_prefix");
  }
  if (profileScope !== null && !isString(profileScope)) {
    return issue("invalid_profile");
  }
  if (!isOptionalString(masterKeyGuid)) {
    return issue("invalid_master_key_guid");
  }
  if (
    !isObject(provider) ||
    (provider.platform !== undefined &&
      !isOneOf(PLATFORMS, provider.platform)) ||
    !isOptionalString(provider.name) ||
    !isOptionalString(provider.item) ||
    !isOptionalString(provider.scope)
  ) {
    return issue("invalid_provider");
  }
  if (secretBase64 === undefined) {
    return issue("missing_secret");
  }
  if (!isString(secretBase64)) {
    return issue("invalid_secret");
  }
  const secret = new Uint8Array(Buffer.from(secretBase64, "base64"));
  if (secret.length === 0) {
    return issue("empty_secret");
  }
  return {
    provenance: {
      origin: "supplied",
      recordId,
      route,
      rowPrefix,
      profileScope,
      evidenceSha256: [],
      providerPlatform: provider.platform ?? "unknown",
      providerName: provider.name ?? "supplied",
      providerItem: provider.item ?? "supplied",
      providerScope: provider.scope ?? "supplied",
    },
    keyKind,
    secret,
    ...(masterKeyGuid === undefined ? {} : { masterKeyGuid }),
  };
}

function resolveSupplied(entries: readonly unknown[]): ResolvedKeyMaterial {
  const material: AuthorizedKeyMaterial[] = [];
  const issues: KeyMaterialIssue[] = [];
  entries.forEach((entry, index) => {
    const resolved = resolveSuppliedEntry(entry, index);
    if ("reason" in resolved) {
      issues.push(resolved);
    } else {
      material.push(resolved);
    }
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
  records: readonly unknown[],
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
  for (const [index, record] of records.entries()) {
    if (!isCapturedRecord(record)) {
      issues.push({
        recordId: recordIdOf(record) || `record-${index}`,
        reason: "invalid_record",
      });
      continue;
    }
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
 * Load and resolve authorized key material from an operator-provided file or
 * from a Collector key-material subtree directory. Throws `INVALID_ARGUMENT`
 * only for a structurally unusable file or a subtree that fails verification;
 * individual records that cannot be resolved are reported as typed issues.
 */
export function loadAuthorizedKeyMaterial(
  options: LoadKeyMaterialOptions,
): ResolvedKeyMaterial {
  let isDirectory = false;
  try {
    isDirectory = statSync(options.keyMaterialPath).isDirectory();
  } catch {
    // readJson reports the missing path as INVALID_ARGUMENT.
  }
  const parsed = isDirectory
    ? readVerifiedKeyMaterialSubtree(options.keyMaterialPath)
    : readJson(options.keyMaterialPath);
  if (!isObject(parsed)) {
    throw invalid("Key material file must be a JSON object.");
  }
  if (parsed.schema === "forensix/supplied-key-material/1") {
    if (!Array.isArray(parsed.entries)) {
      throw invalid("Supplied key material file has no entries array.");
    }
    return resolveSupplied(parsed.entries);
  }
  if (parsed.schema === "forensix/key-material-bundle/1") {
    if (!Array.isArray(parsed.records)) {
      throw invalid("Key material bundle has no records array.");
    }
    return resolveCaptured(parsed.records, options.recipientKeyPath);
  }
  throw invalid(
    "Key material file has an unrecognised schema; expected " +
      "forensix/supplied-key-material/1 or forensix/key-material-bundle/1.",
  );
}
