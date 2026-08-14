import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type Field<T> =
  | { readonly state: "value"; readonly value: T; readonly synthetic?: boolean }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface CredentialFinding {
  readonly recordType: "finding";
  readonly findingKind: "login_credential";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly sourceId: string;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
  };
  readonly fields: {
    readonly credentialId: Field<string>;
    readonly originUrl: Field<string>;
    readonly signonRealm: Field<string>;
    readonly usernameValue: Field<string>;
    readonly secret: Field<string>;
    readonly secretEncryptionScheme: Field<string>;
    readonly secretEncryptionPrefix: Field<string>;
    readonly secretByteLength: Field<string>;
    readonly dateCreated: Field<{
      readonly raw: string;
      readonly epochFamily: string;
      readonly utc: string;
      readonly declaredTimezone: string;
      readonly resolution: string;
    }>;
    readonly dateLastUsed: Field<unknown>;
    readonly timesUsed: Field<string>;
    readonly federationUrl: Field<string>;
  };
}

interface CredentialPage {
  readonly status: "ok";
  readonly command: "credentials";
  readonly items: readonly CredentialFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

function runCli(arguments_: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

interface LoginRow {
  readonly id: bigint;
  readonly originUrl: string;
  readonly signonRealm: string;
  readonly usernameValue: string;
  readonly passwordValue: Uint8Array | null;
  readonly dateCreated: bigint;
  readonly dateLastUsed: bigint;
  readonly scheme: bigint;
  readonly timesUsed: bigint;
  readonly federationUrl: string;
}

function createLoginsSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '43'), ('last_compatible_version', '1');

    CREATE TABLE logins (
      origin_url VARCHAR NOT NULL,
      action_url VARCHAR,
      username_element VARCHAR,
      username_value VARCHAR,
      password_element VARCHAR,
      password_value BLOB,
      signon_realm VARCHAR NOT NULL,
      date_created INTEGER NOT NULL,
      blacklisted_by_user INTEGER NOT NULL,
      scheme INTEGER NOT NULL,
      password_type INTEGER,
      times_used INTEGER,
      form_data BLOB,
      display_name VARCHAR,
      icon_url VARCHAR,
      federation_url VARCHAR,
      skip_zero_click INTEGER,
      generation_upload_status INTEGER,
      possible_username_pairs BLOB,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_last_used INTEGER NOT NULL DEFAULT 0,
      moving_blocked_for BLOB,
      date_password_modified INTEGER NOT NULL DEFAULT 0,
      keychain_identifier BLOB
    );
  `);
}

function insertLogin(database: DatabaseSync, row: LoginRow): void {
  database
    .prepare(
      `INSERT INTO logins
         (id, origin_url, action_url, username_element, username_value,
          password_element, password_value, signon_realm, date_created,
          blacklisted_by_user, scheme, password_type, times_used, display_name,
          icon_url, federation_url, skip_zero_click, generation_upload_status,
          date_last_used, date_password_modified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .run(
      row.id,
      row.originUrl,
      `${row.originUrl}login`,
      "username",
      row.usernameValue,
      "password",
      row.passwordValue,
      row.signonRealm,
      row.dateCreated,
      row.scheme,
      row.timesUsed,
      `Account ${row.id}`,
      `${row.originUrl}favicon.ico`,
      row.federationUrl,
      row.dateLastUsed,
      row.dateCreated,
    );
}

async function createLoginData(
  path: string,
  rows: readonly LoginRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    createLoginsSchema(database);
    for (const row of rows) {
      insertLogin(database, row);
    }
  } finally {
    database.close();
  }
}

const V10_SECRET = new Uint8Array([
  0x76, 0x31, 0x30, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11,
]);
const V20_SECRET = new Uint8Array([
  0x76, 0x32, 0x30, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
]);
const DPAPI_SECRET = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0xaa, 0xbb]);

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "{}\n");
  await createLoginData(join(source, "Default", "Login Data"), [
    {
      id: 1n,
      originUrl: "https://alpha.example/",
      signonRealm: "https://alpha.example/",
      usernameValue: "alice@alpha.example",
      passwordValue: V10_SECRET,
      dateCreated: 13_348_638_245_123_456n,
      dateLastUsed: 13_348_638_305_456_000n,
      scheme: 0n,
      timesUsed: 4n,
      federationUrl: "",
    },
    {
      id: 2n,
      originUrl: "https://bank.example/",
      signonRealm: "https://bank.example/",
      usernameValue: "bob@bank.example",
      passwordValue: V20_SECRET,
      dateCreated: 13_348_638_400_000_000n,
      dateLastUsed: 13_348_638_500_000_000n,
      scheme: 0n,
      timesUsed: 9n,
      federationUrl: "",
    },
    {
      id: 3n,
      originUrl: "https://federated.example/",
      signonRealm: "federation://federated.example/accounts.google.com",
      usernameValue: "carol@federated.example",
      passwordValue: new Uint8Array(0),
      dateCreated: 13_348_638_600_000_000n,
      dateLastUsed: 0n,
      scheme: 0n,
      timesUsed: 0n,
      federationUrl: "https://accounts.google.com/",
    },
  ]);
  await createLoginData(join(source, "Profile 1", "Login Data"), [
    {
      id: 5n,
      originUrl: "https://gamma.example/",
      signonRealm: "https://gamma.example/",
      usernameValue: "dave@gamma.example",
      passwordValue: DPAPI_SECRET,
      dateCreated: 13_361_718_600_000_000n,
      dateLastUsed: 13_361_718_700_000_000n,
      scheme: 0n,
      timesUsed: 1n,
      federationUrl: "",
    },
  ]);
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Login Data credential metadata", () => {
  it("parses credential metadata across Profiles without decrypting secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-login-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const defaultBytes = await readFile(join(source, "Default", "Login Data"));
    const caseDirectory = join(root, "CASE-LOGIN");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      "America/New_York",
      "--json",
    ]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      loginData: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        unavailableProfileCount: 0,
        committedCredentialCount: 4,
        recoveredCredentialCount: 0,
      },
    });

    // AC5: bounded, multi-Profile keyset pagination ordered by creation time.
    const firstPage = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--sort",
        "created-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage).toMatchObject({ command: "credentials", limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const [alpha] = firstPage.items;
    expect(alpha).toBeDefined();
    // AC1 + AC2 + AC5: origin, username, timestamp, and Provenance are present
    // and available independently of any secret decryption.
    expect(alpha).toMatchObject({
      recordType: "finding",
      findingKind: "login_credential",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Login Data",
        database: "Default/Login Data",
        table: "logins",
        rowId: "1",
      },
      fields: {
        credentialId: { state: "value", value: "1" },
        originUrl: { state: "value", value: "https://alpha.example/" },
        signonRealm: { state: "value", value: "https://alpha.example/" },
        usernameValue: { state: "value", value: "alice@alpha.example" },
        timesUsed: { state: "value", value: "4" },
      },
    });
    // AC4: timestamp keeps raw value, Epoch Family, and UTC instant.
    expect(alpha?.fields.dateCreated).toEqual({
      state: "value",
      synthetic: false,
      value: {
        raw: "13348638245123456",
        epochFamily: "1601-us",
        utc: "2024-01-02T03:04:05.123456Z",
        declaredTimezone: "America/New_York",
        resolution: "verified_login_data_schema_version_43",
      },
    });
    // AC3: an encrypted secret is unavailable with a typed reason, never blank.
    expect(alpha?.fields.secret).toEqual({
      state: "unavailable",
      reason: "encrypted_secret_without_key_material",
    });
    expect(alpha?.fields.secretEncryptionScheme).toEqual({
      state: "value",
      value: "v10",
    });
    expect(alpha?.fields.secretEncryptionPrefix).toEqual({
      state: "value",
      value: "v10",
    });
    expect(alpha?.fields.secretByteLength).toEqual({
      state: "value",
      value: "9",
    });

    const secondPage = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--sort",
        "created-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const allIds = [...firstPage.items, ...secondPage.items].map(
      (item) => item.provenance.rowId,
    );
    expect(new Set(allIds).size).toBe(4);
    expect(
      [...firstPage.items, ...secondPage.items].map((item) => item.profile),
    ).toContain("Profile 1");

    // v20 App-Bound wrapper is recognised; secret still unavailable.
    const bank = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--search",
        "bank.example",
        "--json",
      ]).stdout,
    ).items;
    expect(bank).toHaveLength(1);
    expect(bank[0]?.fields.secretEncryptionScheme).toEqual({
      state: "value",
      value: "v20",
    });
    expect(bank[0]?.fields.secret.state).toBe("unavailable");

    // A federated credential stores no secret: absent, not unavailable/blank.
    const federated = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--search",
        "federated.example",
        "--json",
      ]).stdout,
    ).items;
    expect(federated).toHaveLength(1);
    expect(federated[0]?.fields.secret).toEqual({ state: "absent" });
    expect(federated[0]?.fields.federationUrl).toEqual({
      state: "value",
      value: "https://accounts.google.com/",
    });
    expect(federated[0]?.fields.dateLastUsed).toEqual({ state: "absent" });

    // An unrecognised wrapper keeps the raw prefix bytes as retained metadata.
    const gamma = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--profile",
        "Profile 1",
        "--json",
      ]).stdout,
    ).items;
    expect(gamma).toHaveLength(1);
    expect(gamma[0]?.fields.secret).toEqual({
      state: "unavailable",
      reason: "encrypted_secret_without_key_material",
    });
    expect(gamma[0]?.fields.secretEncryptionScheme).toEqual({
      state: "unavailable",
      reason: "unsupported_value",
    });
    expect(gamma[0]?.fields.secretEncryptionPrefix).toEqual({
      state: "value",
      value: "010000",
    });

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(source, "Default", "Login Data"))).toEqual(
      defaultBytes,
    );
  });

  it("keeps committed and WAL-resident credentials separate with Provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-login-wal-"));
    temporaryRoots.push(root);
    const source = join(root, "wal-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const loginPath = join(source, "Default", "Login Data");
    await createLoginData(loginPath, [
      {
        id: 1n,
        originUrl: "https://committed.example/",
        signonRealm: "https://committed.example/",
        usernameValue: "committed@example",
        passwordValue: V10_SECRET,
        dateCreated: 13_348_638_245_123_456n,
        dateLastUsed: 13_348_638_245_123_456n,
        scheme: 0n,
        timesUsed: 1n,
        federationUrl: "",
      },
    ]);

    const writer = new DatabaseSync(loginPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    insertLogin(writer, {
      id: 2n,
      originUrl: "https://wal.example/",
      signonRealm: "https://wal.example/",
      usernameValue: "wal@example",
      passwordValue: V20_SECRET,
      dateCreated: 13_348_638_400_000_000n,
      dateLastUsed: 13_348_638_400_000_000n,
      scheme: 0n,
      timesUsed: 2n,
      federationUrl: "",
    });

    const caseDirectory = join(root, "CASE-LOGIN-WAL");
    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      writer.close();
    }
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      loginData: { committedCredentialCount: 1, recoveredCredentialCount: 1 },
    });

    const committed = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--commit-state",
        "committed",
        "--json",
      ]).stdout,
    );
    expect(committed.items).toHaveLength(1);
    expect(committed.items[0]).toMatchObject({
      commitState: "committed",
      provenance: { manifestPath: "Default/Login Data", rowId: "1" },
    });

    const recovered = parseJson<CredentialPage>(
      runCli([
        "credentials",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--json",
      ]).stdout,
    );
    expect(recovered.items).toHaveLength(1);
    expect(recovered.items[0]).toMatchObject({
      commitState: "wal_resident",
      provenance: {
        manifestPath: "Default/Login Data-wal",
        database: "Default/Login Data",
        table: "logins",
        rowId: "2",
      },
      fields: {
        originUrl: { state: "value", value: "https://wal.example/" },
      },
    });
  });
});
