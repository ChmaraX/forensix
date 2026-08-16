import {
  createCipheriv,
  createHmac,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  decryptOscryptValue,
  loadAuthorizedKeyMaterial,
  schemeOf,
  type AuthorizedKeyMaterial,
  type KeyMaterialProvenance,
  type OscryptRoute,
} from "../src/index.js";
import { associatedDataLine } from "../src/key-material.js";

const CBC_IV = Buffer.alloc(16, 0x20);
const CBC_SALT = Buffer.from("saltysalt", "latin1");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

function pkcs7Pad(data: Buffer): Buffer {
  const pad = 16 - (data.length % 16);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

function deriveCbcKey(route: OscryptRoute, passphrase: string): Buffer {
  const iterations = route === "macos-keychain" ? 1003 : 1;
  const secret = route === "linux-basic" ? "peanuts" : passphrase;
  return pbkdf2Sync(secret, CBC_SALT, iterations, 16, "sha1");
}

function sealCbc(key: Buffer, prefix: string, plaintext: string): Uint8Array {
  const cipher = createCipheriv("aes-128-cbc", key, CBC_IV);
  cipher.setAutoPadding(false);
  const body = Buffer.concat([
    cipher.update(pkcs7Pad(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]);
  return new Uint8Array(Buffer.concat([Buffer.from(prefix, "latin1"), body]));
}

function sealGcm(key: Buffer, plaintext: string): Uint8Array {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(
    Buffer.concat([Buffer.from("v10", "latin1"), nonce, body, tag]),
  );
}

function provenance(
  route: OscryptRoute,
  rowPrefix: KeyMaterialProvenance["rowPrefix"],
  overrides: Partial<KeyMaterialProvenance> = {},
): KeyMaterialProvenance {
  return {
    origin: "supplied",
    recordId: `test-${route}`,
    route,
    rowPrefix,
    providerPlatform: "unknown",
    providerName: "test",
    providerItem: "test",
    providerScope: "test",
    profileScope: null,
    evidenceSha256: [],
    ...overrides,
  };
}

describe("offline OSCrypt decryption engine", () => {
  it("classifies a blob by its own prefix", () => {
    expect(schemeOf(Buffer.from("v10abc"))).toBe("v10");
    expect(schemeOf(Buffer.from("v11abc"))).toBe("v11");
    expect(schemeOf(Buffer.from("v20abc"))).toBe("v20");
    expect(schemeOf(Buffer.from([0x01, 0x00, 0x00, 0x00]))).toBe("legacy");
  });

  // With no opt-in the caller never calls the engine; with opt-in but no
  // matching material the row stays unavailable with a distinct typed reason.
  it("returns no_authorized_key_material when nothing matches", () => {
    const outcome = decryptOscryptValue({
      ciphertext: sealCbc(deriveCbcKey("linux-basic", ""), "v10", "hunter2"),
      profile: "Default",
      keyMaterial: [],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "no_authorized_key_material",
    });
  });

  // Linux basic, GNOME Keyring, KWallet, and macOS Keychain all resolve to
  // AES-128-CBC and round-trip from a passphrase within their evidenced bounds.
  it.each([
    ["linux-basic", "v10", "peanuts"],
    ["gnome-keyring", "v11", "keyring-secret"],
    ["kwallet", "v11", "kwallet-secret"],
    ["macos-keychain", "v10", "keychain-secret"],
  ] as const)("decrypts the %s route", (route, prefix, passphrase) => {
    const key = deriveCbcKey(route, passphrase);
    const ciphertext = sealCbc(key, prefix, "s3cr3t-value");
    const material: AuthorizedKeyMaterial = {
      provenance: provenance(route, prefix),
      keyKind: "passphrase",
      secret: new Uint8Array(Buffer.from(passphrase, "utf8")),
    };
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [material],
    });
    expect(outcome.state).toBe("value");
    if (outcome.state === "value") {
      expect(Buffer.from(outcome.plaintext).toString("utf8")).toBe(
        "s3cr3t-value",
      );
      expect(outcome.route).toBe(route);
    }
  });

  it("decrypts a pre-derived CBC row key", () => {
    const key = deriveCbcKey("gnome-keyring", "abc");
    const ciphertext = sealCbc(key, "v11", "row-key-plaintext");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("gnome-keyring", "v11"),
          keyKind: "row_key",
          secret: new Uint8Array(key),
        },
      ],
    });
    expect(outcome.state).toBe("value");
  });

  // Windows v10 AES-256-GCM route.
  it("decrypts the Windows v10 GCM route", () => {
    const key = randomBytes(32);
    const ciphertext = sealGcm(key, "windows-secret");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-v10", "v10"),
          keyKind: "row_key",
          secret: new Uint8Array(key),
        },
      ],
    });
    expect(outcome.state).toBe("value");
    if (outcome.state === "value") {
      expect(Buffer.from(outcome.plaintext).toString("utf8")).toBe(
        "windows-secret",
      );
    }
  });

  // A mixed-version database dispatches each row independently by prefix.
  it("dispatches mixed v10 and v11 rows independently", () => {
    const cbcKey = deriveCbcKey("gnome-keyring", "pw");
    const gcmKey = randomBytes(32);
    const material: AuthorizedKeyMaterial[] = [
      {
        provenance: provenance("gnome-keyring", "v11"),
        keyKind: "row_key",
        secret: new Uint8Array(cbcKey),
      },
      {
        provenance: provenance("windows-dpapi-v10", "v10"),
        keyKind: "row_key",
        secret: new Uint8Array(gcmKey),
      },
    ];
    const v11 = decryptOscryptValue({
      ciphertext: sealCbc(cbcKey, "v11", "linux-row"),
      profile: "Default",
      keyMaterial: material,
    });
    const v10 = decryptOscryptValue({
      ciphertext: sealGcm(gcmKey, "windows-row"),
      profile: "Default",
      keyMaterial: material,
    });
    expect(v11.state).toBe("value");
    expect(v10.state).toBe("value");
  });

  // V20 App-Bound is never unwrapped, even with key material present.
  it("never unwraps a v20 App-Bound blob", () => {
    const outcome = decryptOscryptValue({
      ciphertext: new Uint8Array(Buffer.from("v20deadbeef", "latin1")),
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-v10", "v10"),
          keyKind: "row_key",
          secret: new Uint8Array(randomBytes(32)),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "unsupported_app_bound_v20",
    });
  });

  // Wrong credentials, malformed stores, and missing context stay distinct.
  it("reports a wrong CBC key as decryption_wrong_key", () => {
    const ciphertext = sealCbc(
      deriveCbcKey("gnome-keyring", "right"),
      "v11",
      "value",
    );
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("gnome-keyring", "v11"),
          keyKind: "row_key",
          secret: new Uint8Array(deriveCbcKey("gnome-keyring", "wrong")),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "decryption_wrong_key",
    });
  });

  it("reports a wrong GCM key as decryption_wrong_key", () => {
    const ciphertext = sealGcm(randomBytes(32), "value");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-v10", "v10"),
          keyKind: "row_key",
          secret: new Uint8Array(randomBytes(32)),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "decryption_wrong_key",
    });
  });

  it("reports a malformed CBC blob distinctly", () => {
    const outcome = decryptOscryptValue({
      ciphertext: new Uint8Array(Buffer.from("v11short", "latin1")),
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("gnome-keyring", "v11"),
          keyKind: "row_key",
          secret: new Uint8Array(deriveCbcKey("gnome-keyring", "pw")),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "decryption_malformed_ciphertext",
    });
  });

  it("scopes key material to its Profile", () => {
    const key = deriveCbcKey("gnome-keyring", "pw");
    const material: AuthorizedKeyMaterial = {
      provenance: provenance("gnome-keyring", "v11", {
        profileScope: "Default",
      }),
      keyKind: "row_key",
      secret: new Uint8Array(key),
    };
    const ciphertext = sealCbc(key, "v11", "value");
    expect(
      decryptOscryptValue({
        ciphertext,
        profile: "Profile 1",
        keyMaterial: [material],
      }),
    ).toEqual({ state: "unavailable", reason: "no_authorized_key_material" });
    expect(
      decryptOscryptValue({
        ciphertext,
        profile: "Default",
        keyMaterial: [material],
      }).state,
    ).toBe("value");
  });
});

// A faithful legacy DPAPI blob (AES-256 + SHA-512), built to prove the offline
// unwrap end to end without any live key store.
function buildLegacyDpapiBlob(
  masterKey: Buffer,
  masterKeyGuid: Buffer,
  plaintext: string,
): Uint8Array {
  const salt = randomBytes(16);
  const hmacSalt = randomBytes(16);
  const sessionKey = createHmac("sha512", masterKey).update(salt).digest();
  const cipher = createCipheriv(
    "aes-256-cbc",
    sessionKey.subarray(0, 32),
    sessionKey.subarray(32, 48),
  );
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([
    cipher.update(pkcs7Pad(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]);
  const u32 = (value: number): Buffer => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    return buffer;
  };
  const lengthPrefixed = (value: Buffer): Buffer =>
    Buffer.concat([u32(value.length), value]);
  const signedBody = Buffer.concat([
    u32(1), // master-key structure version
    masterKeyGuid,
    u32(0), // flags
    u32(0), // description length
    u32(0x6610), // AES-256 alg id
    u32(256), // key length bits
    lengthPrefixed(salt),
    u32(0), // strong entropy length
    u32(0x800e), // SHA-512 alg id
    u32(512), // hash length bits
    lengthPrefixed(hmacSalt),
    lengthPrefixed(ciphertext),
  ]);
  const signKey = createHmac("sha512", masterKey).update(hmacSalt).digest();
  const sign = createHmac("sha512", signKey).update(signedBody).digest();
  return new Uint8Array(
    Buffer.concat([
      u32(1), // dwVersion
      randomBytes(16), // provider GUID
      signedBody,
      lengthPrefixed(sign),
    ]),
  );
}

describe("offline legacy Windows DPAPI route", () => {
  const masterKey = randomBytes(64);
  const guid = randomBytes(16);

  it("unwraps a legacy DPAPI blob with a supplied master key", () => {
    const ciphertext = buildLegacyDpapiBlob(masterKey, guid, "legacy-secret");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-legacy", ""),
          keyKind: "dpapi_master_key",
          secret: new Uint8Array(masterKey),
        },
      ],
    });
    expect(outcome.state).toBe("value");
    if (outcome.state === "value") {
      expect(Buffer.from(outcome.plaintext).toString("utf8")).toBe(
        "legacy-secret",
      );
      expect(outcome.route).toBe("windows-dpapi-legacy");
    }
  });

  it("reports a wrong master key as decryption_authentication_failed", () => {
    const ciphertext = buildLegacyDpapiBlob(masterKey, guid, "legacy-secret");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-legacy", ""),
          keyKind: "dpapi_master_key",
          secret: new Uint8Array(randomBytes(64)),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "decryption_authentication_failed",
    });
  });

  it("reports a malformed DPAPI blob distinctly", () => {
    const outcome = decryptOscryptValue({
      ciphertext: new Uint8Array(randomBytes(24)),
      profile: "Default",
      keyMaterial: [
        {
          provenance: provenance("windows-dpapi-legacy", ""),
          keyKind: "dpapi_master_key",
          secret: new Uint8Array(masterKey),
        },
      ],
    });
    expect(outcome).toEqual({
      state: "unavailable",
      reason: "decryption_malformed_ciphertext",
    });
  });
});

describe("captured key material contract", () => {
  it("unseals a Collector-sealed row key with the recipient private key", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-keymat-"));
    temporaryRoots.push(root);
    const recipient = generateKeyPairSync("x25519");
    const rowKey = pbkdf2Sync("keyring-secret", CBC_SALT, 1, 16, "sha1");

    const record = {
      schema_version: "forensix/key-material-record/1" as const,
      record_id: "udd-0-default",
      capture_state: "captured" as const,
      key_kind: "oscrypt_row_key" as const,
      usable_row_key: true,
      provider: {
        platform: "linux" as const,
        name: "gnome-keyring",
        item: "Chrome Safe Storage",
        scope: "user",
      },
      context: [{ name: "profile", value: "Default" }],
      policy: { row_prefix: "v11" as const, support: "supported" as const },
      evidence: [],
      sealed_material: null as unknown,
    };
    const aad = Buffer.from(associatedDataLine(record as never), "utf8");

    const ephemeral = generateKeyPairSync("x25519");
    const shared = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: recipient.publicKey,
    });
    const salt = randomBytes(16);
    const sealKey = Buffer.from(
      hkdfSync("sha256", shared, salt, "forensix/key-material-seal/1", 32),
    );
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sealKey, nonce);
    cipher.setAAD(aad);
    const sealedBody = Buffer.concat([cipher.update(rowKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ephemeralRaw = ephemeral.publicKey
      .export({ type: "spki", format: "der" })
      .subarray(-32);

    const sealedRecord = {
      ...record,
      sealed_material: {
        algorithm: "x25519-hkdf-sha256-aes-256-gcm",
        recipient_fingerprint: `sha256:${"0".repeat(64)}`,
        ephemeral_public_key: Buffer.from(ephemeralRaw).toString("base64"),
        salt: salt.toString("base64"),
        nonce: nonce.toString("base64"),
        ciphertext: Buffer.concat([sealedBody, tag]).toString("base64"),
        associated_data_sha256: "0".repeat(64),
      },
    };

    const bundlePath = join(root, "key-material.json");
    const keyPath = join(root, "recipient.pem");
    await writeFile(
      bundlePath,
      JSON.stringify({
        schema: "forensix/key-material-bundle/1",
        records: [sealedRecord],
      }),
    );
    await writeFile(
      keyPath,
      recipient.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    );

    const resolved = loadAuthorizedKeyMaterial({
      keyMaterialPath: bundlePath,
      recipientKeyPath: keyPath,
    });
    expect(resolved.issues).toEqual([]);
    expect(resolved.material).toHaveLength(1);
    const material = resolved.material[0];
    expect(material?.provenance.route).toBe("gnome-keyring");
    expect(material?.provenance.profileScope).toBe("Default");
    expect(
      Buffer.from(material?.secret ?? new Uint8Array()).equals(rowKey),
    ).toBe(true);

    // The unsealed row key decrypts a v11 blob end to end.
    const ciphertext = sealCbc(rowKey, "v11", "captured-secret");
    const outcome = decryptOscryptValue({
      ciphertext,
      profile: "Default",
      keyMaterial: resolved.material,
    });
    expect(outcome.state).toBe("value");
    if (outcome.state === "value") {
      expect(Buffer.from(outcome.plaintext).toString("utf8")).toBe(
        "captured-secret",
      );
    }
  });

  it("skips an unsupported v20 App-Bound record without guessing a key", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-keymat-v20-"));
    temporaryRoots.push(root);
    const bundlePath = join(root, "key-material.json");
    await writeFile(
      bundlePath,
      JSON.stringify({
        schema: "forensix/key-material-bundle/1",
        records: [
          {
            schema_version: "forensix/key-material-record/1",
            record_id: "udd-0-appbound",
            capture_state: "unsupported",
            key_kind: "oscrypt_row_key",
            usable_row_key: false,
            provider: {
              platform: "windows",
              name: "DPAPI",
              item: "app-bound",
              scope: "user",
            },
            context: [],
            policy: {
              row_prefix: "v20",
              support: "unsupported",
              reason: "unsupported-google-app-bound-key-variant",
            },
            evidence: [],
            sealed_material: null,
          },
        ],
      }),
    );
    const resolved = loadAuthorizedKeyMaterial({ keyMaterialPath: bundlePath });
    expect(resolved.material).toEqual([]);
    expect(resolved.issues).toEqual([
      {
        recordId: "udd-0-appbound",
        reason: "unsupported-google-app-bound-key-variant",
      },
    ]);
  });
});
