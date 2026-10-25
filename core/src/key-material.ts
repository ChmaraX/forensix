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
  const recordFiles = [...verified.keys()].filter((path) =>
    path.startsWith("records/"),
  );
  if (records === null || records.length !== recordFiles.length) {
    throw fail(`${KEY_MATERIAL_BUNDLE_FILE} does not list every record`);
  }
  for (const record of records as readonly unknown[]) {
    const recordId =
      record !== null && typeof record === "object" && "record_id" in record
        ? String(record.record_id)
        : "";
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
