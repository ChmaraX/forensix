import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

type Field<T> =
  | { readonly state: "value"; readonly value: T }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface CredentialFinding {
  readonly fields: {
    readonly usernameValue: Field<string>;
    readonly secret: Field<string>;
    readonly secretEncryptionScheme: Field<string>;
    readonly secretDecryptionRoute: Field<string>;
    readonly secretKeyMaterialRecordId: Field<string>;
  };
}

interface CredentialPage {
  readonly items: readonly CredentialFinding[];
}

interface CookieFinding {
  readonly fields: {
    readonly hostKey: { readonly state: "value"; readonly value: string };
    readonly value: Field<string>;
    readonly valueDecryptionRoute: Field<string>;
    readonly valueKeyMaterialRecordId: Field<string>;
  };
}

interface CookiePage {
  readonly items: readonly CookieFinding[];
}

const CBC_IV = Buffer.alloc(16, 0x20);
const CBC_SALT = Buffer.from("saltysalt", "latin1");

function pkcs7Pad(data: Buffer): Buffer {
  const pad = 16 - (data.length % 16);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

/** Encrypt a value exactly as a GNOME Keyring / KWallet OSCrypt v11 blob. */
function sealV11(
  passphrase: string,
  plaintext: string | Uint8Array,
): Uint8Array {
  const key = pbkdf2Sync(passphrase, CBC_SALT, 1, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, CBC_IV);
  cipher.setAutoPadding(false);
  const bytes =
    typeof plaintext === "string"
      ? Buffer.from(plaintext, "utf8")
      : Buffer.from(plaintext);
  const body = Buffer.concat([cipher.update(pkcs7Pad(bytes)), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from("v11", "latin1"), body]));
}

const V20_SECRET = new Uint8Array([0x76, 0x32, 0x30, 0x01, 0x02, 0x03]);

function createLoginsSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '43'), ('last_compatible_version', '1');
    CREATE TABLE logins (
      origin_url VARCHAR NOT NULL,
      username_value VARCHAR,
      password_value BLOB,
      signon_realm VARCHAR NOT NULL,
      date_created INTEGER NOT NULL,
      blacklisted_by_user INTEGER NOT NULL,
      scheme INTEGER NOT NULL,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_last_used INTEGER NOT NULL DEFAULT 0,
      date_password_modified INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function createLoginData(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    createLoginsSchema(database);
    const insert = database.prepare(
      `INSERT INTO logins
         (id, origin_url, username_value, password_value, signon_realm,
          date_created, blacklisted_by_user, scheme, date_last_used)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    );
    insert.run(
      1n,
      "https://alpha.example/",
      "alice@alpha.example",
      sealV11("keyring-secret", "top-secret-password"),
      "https://alpha.example/",
      13_348_638_245_123_456n,
      13_348_638_305_456_000n,
    );
    insert.run(
      2n,
      "https://bank.example/",
      "bob@bank.example",
      V20_SECRET,
      "https://bank.example/",
      13_348_638_400_000_000n,
      13_348_638_500_000_000n,
    );
  } finally {
    database.close();
  }
}

/** SHA-256 of a Cookie `host_key`, the binding Chromium prepends from v24. */
function hostKeyHash(hostKey: string): Buffer {
  return createHash("sha256").update(hostKey, "utf8").digest();
}

interface SealedCookie {
  readonly host: string;
  readonly name: string;
  readonly encryptedValue: Uint8Array;
}

/** A Chromium Cookies store at `version` holding v11-sealed values only. */
async function createSealedCookies(
  path: string,
  version: number,
  cookies: readonly SealedCookie[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '${String(version)}'), ('last_compatible_version', '${String(version)}');
      CREATE TABLE cookies (
        creation_utc INTEGER NOT NULL,
        host_key TEXT NOT NULL,
        top_frame_site_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL,
        expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL,
        is_httponly INTEGER NOT NULL,
        last_access_utc INTEGER NOT NULL,
        has_expires INTEGER NOT NULL DEFAULT 1,
        is_persistent INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 1,
        samesite INTEGER NOT NULL DEFAULT -1,
        source_scheme INTEGER NOT NULL DEFAULT 0,
        source_port INTEGER NOT NULL DEFAULT -1,
        last_update_utc INTEGER NOT NULL DEFAULT 0,
        source_type INTEGER NOT NULL DEFAULT 0,
        has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0
      );
    `);
    const insert = database.prepare(
      `INSERT INTO cookies
         (creation_utc, host_key, top_frame_site_key, name, value,
          encrypted_value, path, expires_utc, is_secure, is_httponly,
          last_access_utc)
       VALUES (?, ?, '', ?, '', ?, '/', 13400000000000000, 1, 1, ?)`,
    );
    for (const cookie of cookies) {
      insert.run(
        13_348_638_245_123_456n,
        cookie.host,
        cookie.name,
        cookie.encryptedValue,
        13_348_640_000_000_000n,
      );
    }
  } finally {
    database.close();
  }
}

function keyringEntry(recordId: string, profile: string): unknown {
  return {
    recordId,
    route: "gnome-keyring",
    keyKind: "passphrase",
    rowPrefix: "v11",
    profile,
    secretBase64: Buffer.from("keyring-secret", "utf8").toString("base64"),
    provider: {
      platform: "linux",
      name: "gnome-keyring",
      item: "Chrome Safe Storage",
      scope: "user",
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI offline OSCrypt decryption", () => {
  it("decrypts supported secrets only on opt-in with authorized key material", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-decrypt-e2e-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    const loginPath = join(source, "Default", "Login Data");
    await createLoginData(loginPath);
    const sourceBytes = await readFile(loginPath);

    const keyMaterialPath = join(root, "key-material.json");
    await writeFile(
      keyMaterialPath,
      JSON.stringify({
        schema: "forensix/supplied-key-material/1",
        entries: [
          {
            recordId: "op-gnome-default",
            route: "gnome-keyring",
            keyKind: "passphrase",
            rowPrefix: "v11",
            profile: "Default",
            secretBase64: Buffer.from("keyring-secret", "utf8").toString(
              "base64",
            ),
            provider: {
              platform: "linux",
              name: "gnome-keyring",
              item: "Chrome Safe Storage",
              scope: "user",
            },
          },
        ],
      }),
    );

    const caseDirectory = join(root, "CASE-DECRYPT");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    // Without the opt-in the secret stays unavailable with the historic
    // typed reason, even though the store contains a supported v11 blob.
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const sealed = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--search",
        "alpha.example",
        "--json",
      ]).stdout,
    ).items;
    expect(sealed[0]?.fields.secret).toEqual({
      state: "unavailable",
      reason: "encrypted_secret_without_key_material",
    });

    // Key-material options are rejected without the --decrypt opt-in.
    const misuse = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--key-material",
      keyMaterialPath,
      "--json",
    ]);
    expect(misuse.status).toBe(1);

    // Opt-in plus authorized key material with Provenance.
    const analysis = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--decrypt",
      "--key-material",
      keyMaterialPath,
      "--json",
    ]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      decryption: {
        enabled: true,
        keyMaterialCount: 1,
        keyMaterialIssueCount: 0,
      },
    });

    const decrypted = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--search",
        "alpha.example",
        "--include-secrets",
        "--json",
      ]).stdout,
    ).items;
    // The v11 GNOME Keyring blob is decrypted to plaintext and cites
    // its route and key-material record.
    expect(decrypted[0]?.fields.secret).toEqual({
      state: "value",
      value: "top-secret-password",
    });
    expect(decrypted[0]?.fields.secretDecryptionRoute).toEqual({
      state: "value",
      value: "gnome-keyring",
    });
    expect(decrypted[0]?.fields.secretKeyMaterialRecordId).toEqual({
      state: "value",
      value: "op-gnome-default",
    });

    // Without --include-secrets the CLI prints the decrypted secret only as a
    // hash that matches it, never as text.
    const withheld = runCli([
      "credentials",
      "--case",
      caseDirectory,
      "--search",
      "alpha.example",
      "--json",
    ]).stdout;
    expect(withheld).not.toContain("top-secret-password");
    const redacted = parseJson<
      CredentialPage & {
        readonly redaction: { readonly redactedFieldCount: number };
      }
    >(withheld);
    expect(redacted.redaction).toEqual({
      state: "redacted",
      redactedFieldCount: 1,
    });
    expect(redacted.items[0]?.fields.secret).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: createHash("sha256")
        .update(JSON.stringify("top-secret-password"))
        .digest("hex"),
    });

    // The v20 App-Bound secret is never unwrapped, even with opt-in.
    const appBound = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--search",
        "bank.example",
        "--json",
      ]).stdout,
    ).items;
    expect(appBound[0]?.fields.secret).toEqual({
      state: "unavailable",
      reason: "unsupported_app_bound_v20",
    });

    // The Analyzer never writes Source bytes.
    expect(await readFile(loginPath)).toEqual(sourceBytes);
  });

  it("verifies and strips the v24 host_key hash of decrypted Cookie values", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-decrypt-cookies-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    const modernPath = join(source, "Default", "Network", "Cookies");
    await createSealedCookies(modernPath, 24, [
      {
        // Written by Chromium 24+: SHA-256(host_key) then the value.
        host: ".bound.example",
        name: "sid",
        encryptedValue: sealV11(
          "keyring-secret",
          Buffer.concat([
            hostKeyHash(".bound.example"),
            Buffer.from("bound-session-value", "utf8"),
          ]),
        ),
      },
      {
        // A row moved from another host: the binding names a different host.
        host: ".forged.example",
        name: "sid",
        encryptedValue: sealV11(
          "keyring-secret",
          Buffer.concat([
            hostKeyHash(".bound.example"),
            Buffer.from("moved-session-value", "utf8"),
          ]),
        ),
      },
      {
        // Plaintext shorter than the hash: there is no binding to verify.
        host: ".short.example",
        name: "sid",
        encryptedValue: sealV11("keyring-secret", "tiny"),
      },
    ]);
    // A version 23 store has no binding: the decrypted bytes are the value.
    const olderPath = join(source, "Profile 1", "Network", "Cookies");
    await createSealedCookies(olderPath, 23, [
      {
        host: ".older.example",
        name: "sid",
        encryptedValue: sealV11("keyring-secret", "older-unbound-value"),
      },
    ]);
    const sourceBytes = [await readFile(modernPath), await readFile(olderPath)];

    const keyMaterialPath = join(root, "key-material.json");
    await writeFile(
      keyMaterialPath,
      JSON.stringify({
        schema: "forensix/supplied-key-material/1",
        entries: [
          keyringEntry("op-gnome-default", "Default"),
          keyringEntry("op-gnome-profile-1", "Profile 1"),
        ],
      }),
    );
    const caseDirectory = join(root, "CASE-DECRYPT-COOKIES");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    expect(
      runCli([
        "analyse",
        "--case",
        caseDirectory,
        "--decrypt",
        "--key-material",
        keyMaterialPath,
        "--json",
      ]).status,
    ).toBe(0);

    const cookies = parseJson<CookiePage>(
      runCli([
        "cookies",
        "--case",
        caseDirectory,
        "--sort",
        "host",
        "--direction",
        "asc",
        "--include-secrets",
        "--json",
      ]).stdout,
    ).items;
    const byHost = Object.fromEntries(
      cookies.map((cookie) => [cookie.fields.hostKey.value, cookie.fields]),
    );
    expect(Object.keys(byHost).sort()).toEqual([
      ".bound.example",
      ".forged.example",
      ".older.example",
      ".short.example",
    ]);
    // The verified binding is removed; only the cookie value remains.
    expect(byHost[".bound.example"]?.value).toEqual({
      state: "value",
      value: "bound-session-value",
    });
    expect(byHost[".bound.example"]?.valueKeyMaterialRecordId).toEqual({
      state: "value",
      value: "op-gnome-default",
    });
    // A wrong or missing binding is never stripped by guess.
    for (const host of [".forged.example", ".short.example"]) {
      expect(byHost[host]?.value).toEqual({
        state: "unavailable",
        reason: "cookie_host_key_hash_mismatch",
      });
      expect(byHost[host]?.valueDecryptionRoute).toEqual({ state: "absent" });
    }
    // Before version 24 the decrypted bytes are kept unchanged.
    expect(byHost[".older.example"]?.value).toEqual({
      state: "value",
      value: "older-unbound-value",
    });

    expect([await readFile(modernPath), await readFile(olderPath)]).toEqual(
      sourceBytes,
    );
  });
});

describe("compiled analyzer CLI with Collector-captured key material", () => {
  // The fixture is the exact output of the Go Collector for one captured GNOME
  // libsecret row key and one unavailable KWallet record. The Collector test
  // TestKeyMaterialSubtreeMatchesSharedGolden keeps it byte-identical to the
  // Collector output.
  const fixture = resolve(
    "collector/contracts/key-material/fixtures/captured-v1",
  );
  const recipientKey = join(fixture, "recipient-private.pem");

  it("decrypts with a verified Collector key-material subtree and refuses a damaged one", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-captured-keys-e2e-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    await createLoginData(join(source, "Default", "Login Data"));
    const caseDirectory = join(root, "CASE-CAPTURED");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    // The operator passes the subtree as it is in the Acquisition Bundle.
    const subtree = join(root, "BUNDLE", "key_material", "alice", "udd-1");
    await cp(join(fixture, "subtree"), subtree, { recursive: true });

    const analyse = (keyMaterial: string) =>
      runCli([
        "analyse",
        "--case",
        caseDirectory,
        "--decrypt",
        "--key-material",
        keyMaterial,
        "--recipient-key",
        recipientKey,
        "--json",
      ]);
    const secretOf = () =>
      parseJson<CredentialPage>(
        runCli([
          "credentials",
          "--case",
          caseDirectory,
          "--search",
          "alpha.example",
          "--include-secrets",
          "--json",
        ]).stdout,
      ).items[0]?.fields;

    const fromSubtree = analyse(subtree);
    expect(fromSubtree.stderr).toBe("");
    expect(fromSubtree.status).toBe(0);
    // The unavailable KWallet record is a typed issue, never a guessed key.
    expect(
      parseJson<Record<string, unknown>>(fromSubtree.stdout),
    ).toMatchObject({
      decryption: {
        enabled: true,
        keyMaterialCount: 1,
        keyMaterialIssueCount: 1,
      },
    });
    expect(secretOf()).toMatchObject({
      secret: { state: "value", value: "top-secret-password" },
      secretDecryptionRoute: { state: "value", value: "gnome-keyring" },
      secretKeyMaterialRecordId: {
        state: "value",
        value: "linux-libsecret-v11-1",
      },
    });

    // The aggregate file in the subtree is also a valid input.
    const fromFile = analyse(join(subtree, "key_material_bundle.json"));
    expect(fromFile.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(fromFile.stdout)).toMatchObject({
      decryption: { keyMaterialCount: 1 },
    });

    // A subtree whose bytes no longer match its key-material Manifest is
    // refused before any record is used.
    const damaged = join(root, "DAMAGED", "udd-1");
    await cp(subtree, damaged, { recursive: true });
    const recordPath = join(damaged, "records", "linux-libsecret-v11-1.json");
    await writeFile(
      recordPath,
      (await readFile(recordPath, "utf8")).replace(
        "live_account_session",
        "other_account_session",
      ),
    );
    const refused = analyse(damaged);
    expect(refused.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(refused.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
      message: expect.stringContaining(
        "records/linux-libsecret-v11-1.json does not match the key-material Manifest",
      ) as unknown,
    });

    // An aggregate that lists one record id twice has the same record count
    // as records/, but it never names records/linux-kwallet-unavailable.json.
    // The key-material Manifest and its header are sealed again, so only the
    // record-set check can refuse it.
    const duplicated = join(root, "DUPLICATED", "udd-1");
    await cp(subtree, duplicated, { recursive: true });
    const aggregatePath = join(duplicated, "key_material_bundle.json");
    const aggregate = JSON.parse(await readFile(aggregatePath, "utf8")) as {
      readonly records: readonly { readonly record_id: string }[];
    };
    const libsecret = aggregate.records.find(
      (record) => record.record_id === "linux-libsecret-v11-1",
    );
    expect(aggregate.records).toHaveLength(2);
    const aggregateBytes = Buffer.from(
      `${JSON.stringify({ ...aggregate, records: [libsecret, libsecret] }, null, 2)}\n`,
    );
    await writeFile(aggregatePath, aggregateBytes);
    const manifestPath = join(duplicated, "key_material_manifest.jsonl");
    const manifestText = (await readFile(manifestPath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => {
        const entry = JSON.parse(line) as Record<string, unknown>;
        return JSON.stringify(
          entry.path === "key_material_bundle.json"
            ? {
                ...entry,
                size: aggregateBytes.length,
                sha256: createHash("sha256")
                  .update(aggregateBytes)
                  .digest("hex"),
              }
            : entry,
        );
      })
      .join("\n");
    const manifestBytes = Buffer.from(`${manifestText}\n`);
    await writeFile(manifestPath, manifestBytes);
    const headerPath = join(duplicated, "key_material_manifest_header.json");
    const header = JSON.parse(await readFile(headerPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      headerPath,
      JSON.stringify({
        ...header,
        manifest_digest: createHash("sha256")
          .update(manifestBytes)
          .digest("hex"),
      }),
    );
    const refusedDuplicate = analyse(duplicated);
    expect(refusedDuplicate.status, refusedDuplicate.stdout).toBe(1);
    expect(
      parseJson<Record<string, unknown>>(refusedDuplicate.stderr),
    ).toMatchObject({
      code: "INVALID_ARGUMENT",
      message: expect.stringContaining(
        "key_material_bundle.json lists the record id linux-libsecret-v11-1 more than once",
      ) as unknown,
    });
  });
});
