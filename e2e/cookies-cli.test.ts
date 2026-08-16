import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

interface FieldValue<T> {
  readonly state: "value";
  readonly value: T;
  readonly synthetic?: boolean;
}

interface Unavailable {
  readonly state: "unavailable";
  readonly reason: string;
}

interface Absent {
  readonly state: "absent";
}

interface TimestampValue {
  readonly raw: string;
  readonly epochFamily: "1601-us";
  readonly utc: string;
  readonly declaredTimezone: string;
  readonly resolution: string;
}

interface CookieFinding {
  readonly recordType: "finding";
  readonly findingKind: "cookie";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly sourceId: string;
    readonly manifestEntryId: string;
    readonly manifestEntryOrdinal: number;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
  };
  readonly fields: {
    readonly cookieId: FieldValue<string>;
    readonly hostKey: FieldValue<string>;
    readonly name: FieldValue<string>;
    readonly path: FieldValue<string>;
    readonly value: FieldValue<string> | Unavailable | Absent;
    readonly isEncrypted: FieldValue<boolean>;
    readonly encryptedValueScheme: FieldValue<string> | Unavailable | Absent;
    readonly encryptedValueByteLength: FieldValue<string> | Absent;
    readonly isSecure: FieldValue<boolean>;
    readonly isHttpOnly: FieldValue<boolean>;
    readonly sameSite: FieldValue<string> | Unavailable | Absent;
    readonly sourceScheme: FieldValue<string> | Unavailable | Absent;
    readonly sourcePort: FieldValue<string> | Absent;
    readonly creationTime: FieldValue<TimestampValue> | Unavailable | Absent;
    readonly expiresTime: FieldValue<TimestampValue> | Unavailable | Absent;
    readonly lastAccessTime: FieldValue<TimestampValue> | Unavailable | Absent;
  };
}

interface CookiePage {
  readonly status: "ok";
  readonly command: "cookies";
  readonly items: readonly CookieFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface Cookie {
  readonly host: string;
  readonly topFrameSiteKey?: string;
  readonly name: string;
  readonly value: string;
  readonly encryptedValue: Uint8Array | null;
  readonly path: string;
  readonly creationUtc: bigint;
  readonly expiresUtc: bigint;
  readonly lastAccessUtc: bigint;
  readonly lastUpdateUtc?: bigint;
  readonly isSecure: bigint;
  readonly isHttpOnly: bigint;
  readonly isPersistent?: bigint;
  readonly hasExpires?: bigint;
  readonly priority?: bigint;
  readonly samesite?: bigint;
  readonly sourceScheme?: bigint;
  readonly sourcePort?: bigint;
  readonly sourceType?: bigint;
  readonly hasCrossSiteAncestor?: bigint;
}

function prefixed(prefix: string, body: string): Uint8Array {
  return new Uint8Array([...Buffer.from(prefix), ...Buffer.from(body)]);
}

async function createModernCookies(
  path: string,
  cookies: readonly Cookie[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '24'), ('last_compatible_version', '24');
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
          last_access_utc, has_expires, is_persistent, priority, samesite,
          source_scheme, source_port, last_update_utc, source_type,
          has_cross_site_ancestor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const cookie of cookies) {
      insert.run(
        cookie.creationUtc,
        cookie.host,
        cookie.topFrameSiteKey ?? "",
        cookie.name,
        cookie.value,
        cookie.encryptedValue ?? new Uint8Array(),
        cookie.path,
        cookie.expiresUtc,
        cookie.isSecure,
        cookie.isHttpOnly,
        cookie.lastAccessUtc,
        cookie.hasExpires ?? 1n,
        cookie.isPersistent ?? 1n,
        cookie.priority ?? 1n,
        cookie.samesite ?? -1n,
        cookie.sourceScheme ?? 0n,
        cookie.sourcePort ?? -1n,
        cookie.lastUpdateUtc ?? 0n,
        cookie.sourceType ?? 0n,
        cookie.hasCrossSiteAncestor ?? 0n,
      );
    }
  } finally {
    database.close();
  }
}

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createModernCookies(join(source, "Default", "Network", "Cookies"), [
    {
      host: ".alpha.example",
      name: "session",
      value: "",
      encryptedValue: prefixed("v10", "sealed-alpha-session"),
      path: "/",
      creationUtc: 13_348_638_245_123_456n,
      expiresUtc: 13_400_000_000_000_000n,
      lastAccessUtc: 13_348_640_000_000_000n,
      isSecure: 1n,
      isHttpOnly: 1n,
      samesite: 1n,
      sourceScheme: 2n,
      sourcePort: 443n,
    },
    {
      host: ".beta.example",
      name: "pref",
      value: "en-US",
      encryptedValue: null,
      path: "/app",
      creationUtc: 13_348_638_305_456_000n,
      expiresUtc: 0n,
      lastAccessUtc: 13_348_650_000_000_000n,
      isSecure: 0n,
      isHttpOnly: 0n,
      hasExpires: 0n,
      isPersistent: 0n,
      samesite: 0n,
      sourceScheme: 1n,
      sourcePort: 80n,
    },
  ]);
  await createModernCookies(join(source, "Profile 1", "Network", "Cookies"), [
    {
      host: ".gamma.example",
      name: "id",
      value: "",
      encryptedValue: prefixed("v20", "sealed-gamma-id-app-bound"),
      path: "/",
      creationUtc: 13_361_718_600_000_000n,
      expiresUtc: 13_400_000_000_000_000n,
      lastAccessUtc: 13_361_720_000_000_000n,
      isSecure: 1n,
      isHttpOnly: 1n,
      samesite: 2n,
    },
  ]);
  return source;
}

async function createWalSource(root: string): Promise<{
  readonly source: string;
  readonly writer: DatabaseSync;
}> {
  const source = join(root, "wal-source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  const cookiePath = join(source, "Default", "Network", "Cookies");
  await createModernCookies(cookiePath, [
    {
      host: ".committed.example",
      name: "c",
      value: "committed-plain",
      encryptedValue: null,
      path: "/",
      creationUtc: 13_348_638_245_123_456n,
      expiresUtc: 13_400_000_000_000_000n,
      lastAccessUtc: 13_348_640_000_000_000n,
      isSecure: 1n,
      isHttpOnly: 0n,
    },
  ]);
  const writer = new DatabaseSync(cookiePath);
  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  writer
    .prepare(
      `INSERT INTO cookies
         (creation_utc, host_key, top_frame_site_key, name, value,
          encrypted_value, path, expires_utc, is_secure, is_httponly,
          last_access_utc, has_expires, is_persistent, priority, samesite,
          source_scheme, source_port, last_update_utc, source_type,
          has_cross_site_ancestor)
       VALUES (?, ?, '', ?, ?, ?, '/', ?, 1, 1, ?, 1, 1, 1, 0, 2, 443, 0, 0, 0)`,
    )
    .run(
      13_348_638_305_456_000n,
      ".wal.example",
      "wal-cookie",
      "",
      prefixed("v11", "sealed-wal-cookie"),
      13_400_000_000_000_000n,
      13_348_660_000_000_000n,
    );
  return { source, writer };
}

async function createLegacyCookies(root: string): Promise<string> {
  const source = join(root, "legacy-source");
  await mkdir(join(source, "Default"), { recursive: true });
  await writeLocalState(source);
  const database = new DatabaseSync(join(source, "Default", "Cookies"));
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '7'), ('last_compatible_version', '5');
      CREATE TABLE cookies (
        creation_utc INTEGER NOT NULL,
        host_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB DEFAULT '',
        path TEXT NOT NULL,
        expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL,
        is_httponly INTEGER NOT NULL,
        last_access_utc INTEGER NOT NULL
      );
      INSERT INTO cookies VALUES (
        13348638245123456, '.legacy.example', 'old', 'legacy-plain', '',
        '/', 13400000000000000, 0, 0, 13348638245123456
      );
    `);
  } finally {
    database.close();
  }
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Cookie Finding pipeline", () => {
  it("parses cookies across Profiles without decryption and paginates", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cookies-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const sourceBytes = await readFile(
      join(source, "Default", "Network", "Cookies"),
    );
    const caseDirectory = join(root, "CASE-COOKIES");

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
      cookies: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        committedCookieCount: 3,
        recoveredCookieCount: 0,
        findingCount: 3,
      },
    });

    // Keyset pagination, multi-Profile, sort by host ascending.
    const first = parseJson<CookiePage>(
      runCli([
        "cookies",
        "--case",
        caseDirectory,
        "--sort",
        "host",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items.map((row) => row.fields.hostKey.value)).toEqual([
      ".alpha.example",
      ".beta.example",
    ]);

    // Exact external fields against ground truth.
    const alpha = first.items[0];
    expect(alpha).toMatchObject({
      recordType: "finding",
      findingKind: "cookie",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Network/Cookies",
        database: "Default/Network/Cookies",
        table: "cookies",
        rowId: "1",
      },
      fields: {
        hostKey: { state: "value", value: ".alpha.example" },
        name: { state: "value", value: "session" },
        path: { state: "value", value: "/" },
        isSecure: { state: "value", value: true },
        isHttpOnly: { state: "value", value: true },
        sameSite: { state: "value", value: "lax" },
        sourceScheme: { state: "value", value: "secure" },
        sourcePort: { state: "value", value: "443" },
        // Platform-conditional timestamp resolved from verified schema.
        creationTime: {
          state: "value",
          value: {
            raw: "13348638245123456",
            epochFamily: "1601-us",
            utc: "2024-01-02T03:04:05.123456Z",
            declaredTimezone: "America/New_York",
            resolution: "verified_schema_version_24",
          },
          synthetic: false,
        },
      },
    });

    // Encrypted value is unavailable with a typed reason, never blank.
    expect(alpha?.fields.value).toEqual({
      state: "unavailable",
      reason: "encrypted_secret_without_key_material",
    });
    expect(alpha?.fields.isEncrypted).toEqual({ state: "value", value: true });
    expect(alpha?.fields.encryptedValueScheme).toEqual({
      state: "value",
      value: "v10",
    });
    expect(alpha?.fields.encryptedValueByteLength.state).toBe("value");

    // A session cookie (expires 0) has an absent expiry, plaintext value kept.
    const beta = first.items[1];
    expect(beta?.fields.value).toEqual({ state: "value", value: "en-US" });
    expect(beta?.fields.isEncrypted).toEqual({ state: "value", value: false });
    expect(beta?.fields.encryptedValueScheme).toEqual({ state: "absent" });
    expect(beta?.fields.expiresTime).toEqual({ state: "absent" });

    const second = parseJson<CookiePage>(
      runCli([
        "cookies",
        "--case",
        caseDirectory,
        "--sort",
        "host",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        first.nextCursor as string,
        "--json",
      ]).stdout,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]).toMatchObject({
      profile: "Profile 1",
      fields: {
        hostKey: { state: "value", value: ".gamma.example" },
        encryptedValueScheme: { state: "value", value: "v20" },
        value: {
          state: "unavailable",
          reason: "encrypted_secret_without_key_material",
        },
      },
    });

    // Search + host filter + multi-Profile filter.
    const filtered = parseJson<CookiePage>(
      runCli([
        "cookies",
        "--case",
        caseDirectory,
        "--profile",
        "Default",
        "--profile",
        "Profile 1",
        "--host",
        ".gamma.example",
        "--json",
      ]).stdout,
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.fields.name).toEqual({
      state: "value",
      value: "id",
    });

    // Broken input rejected.
    const badLimit = runCli([
      "cookies",
      "--case",
      caseDirectory,
      "--limit",
      "0",
      "--json",
    ]);
    expect(badLimit.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(badLimit.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    // A stale cursor after re-analysis is rejected.
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const stale = runCli([
      "cookies",
      "--case",
      caseDirectory,
      "--sort",
      "host",
      "--direction",
      "asc",
      "--limit",
      "2",
      "--after",
      first.nextCursor as string,
      "--json",
    ]);
    expect(stale.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(stale.stderr)).toMatchObject({
      code: "INVALID_CURSOR",
    });

    // The Source bytes are never mutated by analysis.
    expect(
      await readFile(join(source, "Default", "Network", "Cookies")),
    ).toEqual(sourceBytes);
  });

  it("keeps committed and WAL-resident cookies separate with Provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cookies-wal-"));
    temporaryRoots.push(root);
    const { source, writer } = await createWalSource(root);
    const caseDirectory = join(root, "CASE-COOKIES-WAL");
    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      writer.close();
    }

    expect(
      parseJson<Record<string, unknown>>(
        runCli(["analyse", "--case", caseDirectory, "--json"]).stdout,
      ),
    ).toMatchObject({
      cookies: { committedCookieCount: 1, recoveredCookieCount: 1 },
    });

    const committed = parseJson<CookiePage>(
      runCli([
        "cookies",
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
      provenance: { manifestPath: "Default/Network/Cookies", table: "cookies" },
      fields: { hostKey: { state: "value", value: ".committed.example" } },
    });

    const walResident = parseJson<CookiePage>(
      runCli([
        "cookies",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--json",
      ]).stdout,
    );
    expect(walResident.items).toHaveLength(1);
    expect(walResident.items[0]).toMatchObject({
      commitState: "wal_resident",
      provenance: {
        manifestPath: "Default/Network/Cookies-wal",
        database: "Default/Network/Cookies",
        table: "cookies",
      },
      fields: {
        hostKey: { state: "value", value: ".wal.example" },
        value: {
          state: "unavailable",
          reason: "encrypted_secret_without_key_material",
        },
        encryptedValueScheme: { state: "value", value: "v11" },
      },
    });
  });

  it("requires Declared Origin OS for legacy Cookie epochs", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cookies-origin-"));
    temporaryRoots.push(root);
    const source = await createLegacyCookies(root);
    const caseDirectory = join(root, "CASE-COOKIES-ORIGIN");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const withoutOrigin = parseJson<CookiePage>(
      runCli(["cookies", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(withoutOrigin.items).toHaveLength(1);
    expect(withoutOrigin.items[0]?.fields.creationTime).toEqual({
      state: "unavailable",
      reason: "epoch_requires_declared_origin_os",
    });
    // Even a legacy plaintext cookie keeps a defined value Field State.
    expect(withoutOrigin.items[0]?.fields.value).toEqual({
      state: "value",
      value: "legacy-plain",
    });

    expect(
      runCli([
        "analyse",
        "--case",
        caseDirectory,
        "--origin-os",
        "windows",
        "--timezone",
        "UTC",
        "--json",
      ]).status,
    ).toBe(0);
    const withOrigin = parseJson<CookiePage>(
      runCli(["cookies", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(withOrigin.items[0]?.fields.creationTime).toMatchObject({
      state: "value",
      value: {
        raw: "13348638245123456",
        epochFamily: "1601-us",
        utc: "2024-01-02T03:04:05.123456Z",
        resolution: "verified_schema_version_7_declared_origin_os_windows",
      },
    });
  });
});
