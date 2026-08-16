import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const CBC_IV = Buffer.alloc(16, 0x20);
const CBC_SALT = Buffer.from("saltysalt", "latin1");

function pkcs7Pad(data: Buffer): Buffer {
  const pad = 16 - (data.length % 16);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

/** Encrypt a value exactly as a GNOME Keyring / KWallet OSCrypt v11 blob. */
function sealV11(passphrase: string, plaintext: string): Uint8Array {
  const key = pbkdf2Sync(passphrase, CBC_SALT, 1, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, CBC_IV);
  cipher.setAutoPadding(false);
  const body = Buffer.concat([
    cipher.update(pkcs7Pad(Buffer.from(plaintext, "utf8"))),
    cipher.final(),
  ]);
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
});
