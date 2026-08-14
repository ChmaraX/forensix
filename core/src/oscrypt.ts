import {
  createDecipheriv,
  createHmac,
  pbkdf2Sync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Offline OSCrypt decryption engine.
 *
 * This module is a pure, offline function library. It performs NO input or
 * output: no network, no provider daemons, no live suspect key store, and it
 * never touches Source bytes. It receives already-copied ciphertext and
 * authorized key material (resolved by {@link ./key-material}) and returns a
 * typed decryption outcome per row. Decryption is only ever attempted when an
 * authorized investigator has opted in and supplied or captured key material
 * with Provenance; the caller enforces that gate.
 *
 * Chromium wraps each stored secret with a scheme prefix so a mixed-version
 * database can be dispatched row by row:
 *
 * - `v10` / `v11`: on Linux and macOS an AES-128-CBC blob keyed by a row key the
 *   provider (Linux basic password, GNOME Keyring, KWallet, or the macOS
 *   Keychain) derives; on Windows a `v10` blob is AES-256-GCM keyed by the
 *   DPAPI-protected key from `Local State`.
 * - `v20`: Google App-Bound encryption. Never unwrapped; always a stable typed
 *   unavailable reason.
 * - No recognised prefix: a legacy Windows DPAPI blob, unwrapped offline only
 *   when the operator supplies the decrypted DPAPI master key.
 */

/**
 * A supported decryption route. Each route names an evidenced provider path and
 * fixes the algorithm the engine applies. `linux-basic`, `gnome-keyring`,
 * `kwallet`, and `macos-keychain` all resolve to AES-128-CBC and differ only in
 * how their row key is derived; `windows-dpapi-v10` is AES-256-GCM;
 * `windows-dpapi-legacy` is a raw DPAPI blob.
 */
export type OscryptRoute =
  | "linux-basic"
  | "gnome-keyring"
  | "kwallet"
  | "macos-keychain"
  | "windows-dpapi-v10"
  | "windows-dpapi-legacy";

export const OSCRYPT_ROUTES: readonly OscryptRoute[] = [
  "linux-basic",
  "gnome-keyring",
  "kwallet",
  "macos-keychain",
  "windows-dpapi-v10",
  "windows-dpapi-legacy",
] as const;

/** The scheme a stored blob declares by its leading prefix. */
export type OscryptScheme = "v10" | "v11" | "v20" | "legacy";

/**
 * Distinct, stable typed reasons for a value that stays unavailable after an
 * opted-in decryption attempt. They keep wrong credentials, malformed stores,
 * missing context, authentication failures, and unsupported routes separable
 * (never a guessed unwrap and never a blank).
 */
export type DecryptionFailureReason =
  | "unsupported_app_bound_v20"
  | "unsupported_encryption_route"
  | "no_authorized_key_material"
  | "decryption_wrong_key"
  | "decryption_malformed_ciphertext"
  | "decryption_missing_context"
  | "decryption_authentication_failed";

/**
 * Provenance for a single unit of authorized key material. Every decrypted
 * value cites the record it was authorized by, so a Finding never asserts a
 * plaintext secret without a resolvable chain of custody.
 */
export interface KeyMaterialProvenance {
  /** `supplied` (operator-authored) or `captured` (sealed by the Collector). */
  readonly origin: "supplied" | "captured";
  readonly recordId: string;
  readonly route: OscryptRoute;
  readonly rowPrefix: "" | "v10" | "v11" | "v20";
  readonly providerPlatform: "darwin" | "linux" | "windows" | "unknown";
  readonly providerName: string;
  readonly providerItem: string;
  readonly providerScope: string;
  /** Profile the material is scoped to, or `null` when it applies to all. */
  readonly profileScope: string | null;
  /** SHA-256 evidence references from the sealed record, when present. */
  readonly evidenceSha256: readonly string[];
}

/**
 * Resolved, authorized key material ready for offline use. The engine never
 * derives this from a live store; {@link ./key-material} produces it from
 * operator-supplied input or from unsealed Collector-captured records.
 */
export interface AuthorizedKeyMaterial {
  readonly provenance: KeyMaterialProvenance;
  /**
   * `row_key`: a pre-derived symmetric row key (16 bytes for CBC routes, 32 for
   * the Windows GCM route). `passphrase`: a provider secret the engine expands
   * with the route's evidenced PBKDF2 parameters. `dpapi_master_key`: a
   * decrypted DPAPI master key for the legacy route.
   */
  readonly keyKind: "row_key" | "passphrase" | "dpapi_master_key";
  readonly secret: Uint8Array;
  /**
   * The legacy DPAPI master-key GUID this material unwraps, lower-case. When
   * present, a blob whose master-key GUID differs is `decryption_missing_context`.
   */
  readonly masterKeyGuid?: string;
}

/**
 * Decryption configuration threaded from the `analyse` command into each
 * parser. `enabled` is the explicit operator opt-in; it is `false` by default,
 * and while it is `false` no key material is consulted and encrypted values
 * stay `unavailable` with the historic `encrypted_secret_without_key_material`
 * reason.
 */
export interface DecryptionSettings {
  readonly enabled: boolean;
  readonly keyMaterial: readonly AuthorizedKeyMaterial[];
}

export const DECRYPTION_DISABLED: DecryptionSettings = {
  enabled: false,
  keyMaterial: [],
};

export type DecryptionOutcome =
  | {
      readonly state: "value";
      readonly plaintext: Uint8Array;
      readonly route: OscryptRoute;
      readonly provenance: KeyMaterialProvenance;
    }
  | { readonly state: "unavailable"; readonly reason: DecryptionFailureReason };

const CBC_ROUTES: ReadonlySet<OscryptRoute> = new Set([
  "linux-basic",
  "gnome-keyring",
  "kwallet",
  "macos-keychain",
]);

const CBC_IV = Buffer.alloc(16, 0x20);
const CBC_SALT = Buffer.from("saltysalt", "latin1");
const LINUX_BASIC_PASSWORD = Buffer.from("peanuts", "latin1");

class DecryptionFailure extends Error {
  public readonly reason: DecryptionFailureReason;

  public constructor(reason: DecryptionFailureReason) {
    super(reason);
    this.name = "DecryptionFailure";
    this.reason = reason;
  }
}

/**
 * Classify a stored blob by its leading three bytes. A `v10`, `v11`, or `v20`
 * ASCII prefix selects the matching scheme; anything else is treated as a
 * legacy blob so the row can still be dispatched to the DPAPI route.
 */
export function schemeOf(ciphertext: Uint8Array): OscryptScheme {
  if (ciphertext.length >= 3) {
    const prefix = String.fromCharCode(
      ciphertext[0] ?? 0,
      ciphertext[1] ?? 0,
      ciphertext[2] ?? 0,
    );
    if (prefix === "v10") {
      return "v10";
    }
    if (prefix === "v11") {
      return "v11";
    }
    if (prefix === "v20") {
      return "v20";
    }
  }
  return "legacy";
}

function schemePrefix(scheme: OscryptScheme): "" | "v10" | "v11" | "v20" {
  return scheme === "legacy" ? "" : scheme;
}

/**
 * Whether a piece of key material can be dispatched to a row of this scheme.
 * The row prefix must match (or the material must be prefix-agnostic), and the
 * route family must be compatible with the scheme: legacy blobs only ever go to
 * the DPAPI legacy route, and the DPAPI legacy route never claims a v-prefixed
 * blob.
 */
function keyMaterialMatches(
  material: AuthorizedKeyMaterial,
  scheme: OscryptScheme,
  profile: string,
): boolean {
  const provenance = material.provenance;
  if (provenance.profileScope !== null && provenance.profileScope !== profile) {
    return false;
  }
  if (
    provenance.rowPrefix !== "" &&
    provenance.rowPrefix !== schemePrefix(scheme)
  ) {
    return false;
  }
  if (scheme === "legacy") {
    return provenance.route === "windows-dpapi-legacy";
  }
  return provenance.route !== "windows-dpapi-legacy";
}

function deriveCbcKey(material: AuthorizedKeyMaterial): Buffer {
  if (material.keyKind === "row_key") {
    if (material.secret.length !== 16) {
      throw new DecryptionFailure("decryption_missing_context");
    }
    return Buffer.from(material.secret);
  }
  if (material.keyKind !== "passphrase") {
    throw new DecryptionFailure("unsupported_encryption_route");
  }
  const iterations = material.provenance.route === "macos-keychain" ? 1003 : 1;
  const password =
    material.provenance.route === "linux-basic"
      ? LINUX_BASIC_PASSWORD
      : Buffer.from(material.secret);
  return pbkdf2Sync(password, CBC_SALT, iterations, 16, "sha1");
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const padLength = buffer[buffer.length - 1] ?? 0;
  if (padLength < 1 || padLength > 16 || padLength > buffer.length) {
    throw new DecryptionFailure("decryption_wrong_key");
  }
  for (
    let index = buffer.length - padLength;
    index < buffer.length;
    index += 1
  ) {
    if (buffer[index] !== padLength) {
      throw new DecryptionFailure("decryption_wrong_key");
    }
  }
  return buffer.subarray(0, buffer.length - padLength);
}

function decryptCbc(
  material: AuthorizedKeyMaterial,
  ciphertext: Uint8Array,
): Uint8Array {
  const body = ciphertext.subarray(3);
  if (body.length === 0 || body.length % 16 !== 0) {
    throw new DecryptionFailure("decryption_malformed_ciphertext");
  }
  const key = deriveCbcKey(material);
  const decipher = createDecipheriv("aes-128-cbc", key, CBC_IV);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(body), decipher.final()]);
  return pkcs7Unpad(padded);
}

function decryptGcm(
  material: AuthorizedKeyMaterial,
  ciphertext: Uint8Array,
): Uint8Array {
  if (material.keyKind !== "row_key" || material.secret.length !== 32) {
    throw new DecryptionFailure("decryption_missing_context");
  }
  // v10 (3) + nonce (12) + ciphertext + tag (16).
  if (ciphertext.length < 3 + 12 + 16) {
    throw new DecryptionFailure("decryption_malformed_ciphertext");
  }
  const nonce = ciphertext.subarray(3, 15);
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const body = ciphertext.subarray(15, ciphertext.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(material.secret),
    nonce,
  );
  decipher.setAuthTag(Buffer.from(tag));
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // A failed tag means the row key does not authenticate this ciphertext.
    throw new DecryptionFailure("decryption_wrong_key");
  }
}

interface LegacyDpapiBlob {
  readonly masterKeyGuid: string;
  readonly salt: Buffer;
  readonly hmacSalt: Buffer;
  readonly ciphertext: Buffer;
  readonly sign: Buffer;
  /** Region covered by the integrity signature. */
  readonly signed: Buffer;
}

function readGuid(view: Buffer, offset: number): string {
  // A DPAPI GUID is stored as little-endian Data1/2/3 then big-endian Data4.
  const d1 = view.readUInt32LE(offset).toString(16).padStart(8, "0");
  const d2 = view
    .readUInt16LE(offset + 4)
    .toString(16)
    .padStart(4, "0");
  const d3 = view
    .readUInt16LE(offset + 6)
    .toString(16)
    .padStart(4, "0");
  const d4 = view.subarray(offset + 8, offset + 10).toString("hex");
  const d5 = view.subarray(offset + 10, offset + 16).toString("hex");
  return `${d1}-${d2}-${d3}-${d4}-${d5}`;
}

/**
 * Parse a legacy Windows DPAPI blob. The layout mirrors the documented
 * `DATA_BLOB` structure used by CryptProtectData. A structural problem is a
 * `decryption_malformed_ciphertext` failure; the caller never guesses.
 */
function parseLegacyDpapiBlob(blob: Uint8Array): LegacyDpapiBlob {
  const view = Buffer.from(blob);
  try {
    let offset = 4; // dwVersion
    offset += 16; // provider GUID
    const signedStart = offset;
    offset += 4; // master-key structure version
    const masterKeyGuid = readGuid(view, offset);
    offset += 16;
    offset += 4; // flags
    const descriptionLength = view.readUInt32LE(offset);
    offset += 4 + descriptionLength;
    offset += 4; // crypt algorithm id
    offset += 4; // crypt algorithm key length
    const saltLength = view.readUInt32LE(offset);
    offset += 4;
    const salt = view.subarray(offset, offset + saltLength);
    offset += saltLength;
    const strongLength = view.readUInt32LE(offset);
    offset += 4 + strongLength; // optional strong-password entropy
    offset += 4; // hash algorithm id
    offset += 4; // hash algorithm length
    const hmacSaltLength = view.readUInt32LE(offset);
    offset += 4;
    const hmacSalt = view.subarray(offset, offset + hmacSaltLength);
    offset += hmacSaltLength;
    const cipherLength = view.readUInt32LE(offset);
    offset += 4;
    const ciphertext = view.subarray(offset, offset + cipherLength);
    offset += cipherLength;
    const signedEnd = offset;
    const signLength = view.readUInt32LE(offset);
    offset += 4;
    const sign = view.subarray(offset, offset + signLength);
    offset += signLength;
    if (
      offset !== view.length ||
      saltLength === 0 ||
      cipherLength === 0 ||
      cipherLength % 16 !== 0
    ) {
      throw new DecryptionFailure("decryption_malformed_ciphertext");
    }
    return {
      masterKeyGuid,
      salt,
      hmacSalt,
      ciphertext,
      sign,
      signed: view.subarray(signedStart, signedEnd),
    };
  } catch (error) {
    if (error instanceof DecryptionFailure) {
      throw error;
    }
    throw new DecryptionFailure("decryption_malformed_ciphertext");
  }
}

/**
 * Unwrap a legacy Windows DPAPI blob offline with a decrypted master key. The
 * derivation follows the documented AES-256 + SHA-512 CryptProtectData path:
 * an HMAC session key over the blob salt yields the AES key and IV, and a
 * second HMAC over the signed region proves the master key is authentic. A
 * blob for a different master-key GUID is `decryption_missing_context`; a
 * signature mismatch is `decryption_authentication_failed`.
 */
function decryptLegacyDpapi(
  material: AuthorizedKeyMaterial,
  ciphertext: Uint8Array,
): Uint8Array {
  if (material.keyKind !== "dpapi_master_key") {
    throw new DecryptionFailure("decryption_missing_context");
  }
  const blob = parseLegacyDpapiBlob(ciphertext);
  if (
    material.masterKeyGuid !== undefined &&
    material.masterKeyGuid.toLowerCase() !== blob.masterKeyGuid.toLowerCase()
  ) {
    throw new DecryptionFailure("decryption_missing_context");
  }
  const masterKey = Buffer.from(material.secret);
  const sessionKey = createHmac("sha512", masterKey).update(blob.salt).digest();
  const signKey = createHmac("sha512", masterKey)
    .update(blob.hmacSalt)
    .digest();
  const expectedSign = createHmac("sha512", signKey)
    .update(blob.signed)
    .digest();
  if (
    blob.sign.length !== expectedSign.length ||
    !timingSafeEqual(blob.sign, expectedSign)
  ) {
    throw new DecryptionFailure("decryption_authentication_failed");
  }
  const key = sessionKey.subarray(0, 32);
  const iv = sessionKey.subarray(32, 48);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([
    decipher.update(blob.ciphertext),
    decipher.final(),
  ]);
  return pkcs7Unpad(padded);
}

function decryptWith(
  material: AuthorizedKeyMaterial,
  scheme: OscryptScheme,
  ciphertext: Uint8Array,
): Uint8Array {
  if (material.provenance.route === "windows-dpapi-v10") {
    return decryptGcm(material, ciphertext);
  }
  if (material.provenance.route === "windows-dpapi-legacy") {
    return decryptLegacyDpapi(material, ciphertext);
  }
  if (CBC_ROUTES.has(material.provenance.route)) {
    return decryptCbc(material, ciphertext);
  }
  throw new DecryptionFailure("unsupported_encryption_route");
}

/**
 * Decrypt one stored blob offline. Dispatch is per row, driven by the blob's
 * own scheme prefix, so a database mixing `v10`, `v11`, and `v20` rows is
 * handled correctly. `v20` App-Bound blobs are never unwrapped. When no
 * authorized key material matches the row it is `no_authorized_key_material`;
 * when candidates match but every attempt fails, the last attempt's typed
 * reason is returned so distinct failure modes stay separable. An unexpected
 * (non-decryption) error is never masked as a wrong key; it propagates so the
 * parser records it plainly instead of a guessed forensic outcome.
 */
export function decryptOscryptValue(options: {
  readonly ciphertext: Uint8Array;
  readonly profile: string;
  readonly keyMaterial: readonly AuthorizedKeyMaterial[];
}): DecryptionOutcome {
  const scheme = schemeOf(options.ciphertext);
  if (scheme === "v20") {
    return { state: "unavailable", reason: "unsupported_app_bound_v20" };
  }
  const candidates = options.keyMaterial.filter((material) =>
    keyMaterialMatches(material, scheme, options.profile),
  );
  if (candidates.length === 0) {
    return { state: "unavailable", reason: "no_authorized_key_material" };
  }
  let failure: DecryptionFailureReason = "no_authorized_key_material";
  for (const material of candidates) {
    try {
      const plaintext = decryptWith(material, scheme, options.ciphertext);
      return {
        state: "value",
        plaintext,
        route: material.provenance.route,
        provenance: material.provenance,
      };
    } catch (error) {
      if (error instanceof DecryptionFailure) {
        failure = error.reason;
        continue;
      }
      throw error;
    }
  }
  return { state: "unavailable", reason: failure };
}
