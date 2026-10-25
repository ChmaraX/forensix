import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function createHistory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');

      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url LONGVARCHAR,
        title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0 NOT NULL
      );

      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url INTEGER NOT NULL,
        visit_time INTEGER NOT NULL,
        from_visit INTEGER,
        external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL,
        segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER,
        originator_cache_guid TEXT,
        originator_visit_id INTEGER,
        originator_from_visit INTEGER,
        originator_opener_visit INTEGER,
        is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER,
        app_id TEXT
      );

      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      INSERT INTO urls
        (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES (1, 'https://alpha.example/', 'Alpha', 1, 0, 13348638245123456, 0);
      INSERT INTO visits
        (id, url, visit_time, from_visit, external_referrer_url, transition,
         segment_id, visit_duration, incremented_omnibox_typed_score,
         opener_visit, originator_cache_guid, originator_visit_id,
         originator_from_visit, originator_opener_visit, is_known_to_sync,
         consider_for_ntp_most_visited, visited_link_id, app_id)
      VALUES (1, 1, 13348638245123456, 0, '', 1, 0, 100, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL);
    `);
  } finally {
    database.close();
  }
}

async function ingestAndAnalyse(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createHistory(join(source, "Default", "History"));
  const caseDirectory = join(root, "CASE-EXPORT");
  expect(
    runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
  ).toBe(0);
  expect(
    runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      "America/New_York",
      "--json",
    ]).status,
  ).toBe(0);
  return caseDirectory;
}

/*
 * A multi-artifact Source: History visits and a download, a plaintext Cookie
 * value, a saved login whose v11 (GNOME Keyring) password is decrypted at
 * analyse time, and a Bookmarks file. The History visits also give identity
 * Candidates (behavior_frequent_host).
 */
const COOKIE_SECRET = "cookie-session-9f3e";
const LOGIN_SECRET = "alpha-pass-7731";
const LOGIN_USERNAME = "ada.lovelace";
const KEYRING_PASSPHRASE = "export-keyring-secret";
const DOWNLOAD_URL = "https://files.example/ledger.xlsx";
const BOOKMARK_URL = "https://bookmarked.example/";

/** Chrome (WebKit) microseconds since 1601-01-01 for an ISO instant. */
function chromeTime(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1000n + 11_644_473_600_000_000n;
}

/** Encrypt like a Linux GNOME Keyring OSCrypt v11 blob. */
function sealV11(passphrase: string, plaintext: string): Uint8Array {
  const key = pbkdf2Sync(
    passphrase,
    Buffer.from("saltysalt", "latin1"),
    1,
    16,
    "sha1",
  );
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  cipher.setAutoPadding(false);
  const data = Buffer.from(plaintext, "utf8");
  const pad = 16 - (data.length % 16);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([data, Buffer.alloc(pad, pad)])),
    cipher.final(),
  ]);
  return new Uint8Array(Buffer.concat([Buffer.from("v11", "latin1"), body]));
}

async function createHistoryWithDownload(path: string): Promise<void> {
  await createHistory(path);
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES (2, 'https://alpha.example/inbox', 'Inbox', 1, 0, 13348638345123456, 0);
      INSERT INTO visits
        (id, url, visit_time, from_visit, external_referrer_url, transition,
         segment_id, visit_duration, incremented_omnibox_typed_score,
         opener_visit, originator_cache_guid, originator_visit_id,
         originator_from_visit, originator_opener_visit, is_known_to_sync,
         consider_for_ntp_most_visited, visited_link_id, app_id)
      VALUES (2, 2, 13348638345123456, 1, '', 0, 0, 200, 0, 0, '', 0, 0, 0, 0, 1, 0, NULL);
      CREATE TABLE downloads (
        id INTEGER PRIMARY KEY, guid VARCHAR NOT NULL,
        current_path LONGVARCHAR NOT NULL, target_path LONGVARCHAR NOT NULL,
        start_time INTEGER NOT NULL, received_bytes INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL, state INTEGER NOT NULL,
        danger_type INTEGER NOT NULL, interrupt_reason INTEGER NOT NULL,
        hash BLOB NOT NULL, end_time INTEGER NOT NULL, opened INTEGER NOT NULL,
        last_access_time INTEGER NOT NULL, transient INTEGER NOT NULL,
        referrer VARCHAR NOT NULL, site_url VARCHAR NOT NULL,
        tab_url VARCHAR NOT NULL, tab_referrer_url VARCHAR NOT NULL,
        http_method VARCHAR NOT NULL, by_ext_id VARCHAR NOT NULL,
        by_ext_name VARCHAR NOT NULL, by_web_app_id VARCHAR NOT NULL,
        etag VARCHAR NOT NULL, last_modified VARCHAR NOT NULL,
        mime_type VARCHAR(255) NOT NULL, original_mime_type VARCHAR(255) NOT NULL
      );
      CREATE TABLE downloads_url_chains (
        id INTEGER NOT NULL, chain_index INTEGER NOT NULL, url LONGVARCHAR NOT NULL,
        PRIMARY KEY (id, chain_index)
      );
    `);
    const start = chromeTime("2024-03-12T15:00:00Z");
    database
      .prepare(
        `INSERT INTO downloads
           (id, guid, current_path, target_path, start_time, received_bytes,
            total_bytes, state, danger_type, interrupt_reason, hash, end_time,
            opened, last_access_time, transient, referrer, site_url, tab_url,
            tab_referrer_url, http_method, by_ext_id, by_ext_name,
            by_web_app_id, etag, last_modified, mime_type, original_mime_type)
         VALUES (1, 'guid-ledger', '/home/ada/Downloads/ledger.xlsx',
                 '/home/ada/Downloads/ledger.xlsx', ?, 2048, 2048, 1, 0, 0,
                 x'00', ?, 0, 0, 0, 'https://files.example/',
                 'https://files.example/', 'https://files.example/',
                 'https://files.example/', 'GET', '', '', '', '', '',
                 'application/vnd.ms-excel', 'application/vnd.ms-excel')`,
      )
      .run(start, start + 4_000_000n);
    database
      .prepare(
        "INSERT INTO downloads_url_chains (id, chain_index, url) VALUES (1, 0, ?)",
      )
      .run(DOWNLOAD_URL);
  } finally {
    database.close();
  }
}

function createCookies(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '24'), ('last_compatible_version', '24');
      CREATE TABLE cookies (
        creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
        top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
        value TEXT NOT NULL, encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
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
    database
      .prepare(
        `INSERT INTO cookies
           (creation_utc, host_key, top_frame_site_key, name, value,
            encrypted_value, path, expires_utc, is_secure, is_httponly,
            last_access_utc)
         VALUES (?, '.alpha.example', '', 'session', ?, x'', '/', ?, 1, 1, ?)`,
      )
      .run(
        chromeTime("2024-03-11T09:30:00Z"),
        COOKIE_SECRET,
        chromeTime("2030-01-01T00:00:00Z"),
        chromeTime("2024-03-13T18:00:00Z"),
      );
  } finally {
    database.close();
  }
}

function createLoginData(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '43'), ('last_compatible_version', '1');
      CREATE TABLE logins (
        origin_url VARCHAR NOT NULL, username_value VARCHAR,
        password_value BLOB, signon_realm VARCHAR NOT NULL,
        date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL,
        scheme INTEGER NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_last_used INTEGER NOT NULL DEFAULT 0,
        date_password_modified INTEGER NOT NULL DEFAULT 0
      );
    `);
    database
      .prepare(
        `INSERT INTO logins
           (id, origin_url, username_value, password_value, signon_realm,
            date_created, blacklisted_by_user, scheme, date_last_used)
         VALUES (1, 'https://alpha.example/', ?, ?, 'https://alpha.example/',
                 ?, 0, 0, ?)`,
      )
      .run(
        LOGIN_USERNAME,
        sealV11(KEYRING_PASSPHRASE, LOGIN_SECRET),
        chromeTime("2024-03-11T09:00:00Z"),
        chromeTime("2024-03-11T10:00:00Z"),
      );
  } finally {
    database.close();
  }
}

async function writeKeyMaterial(path: string): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({
      schema: "forensix/supplied-key-material/1",
      entries: [
        {
          recordId: "export-e2e-gnome",
          route: "gnome-keyring",
          keyKind: "passphrase",
          rowPrefix: "v11",
          profile: "Default",
          secretBase64: Buffer.from(KEYRING_PASSPHRASE, "utf8").toString(
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
}

/** Ingests and analyses the multi-artifact Source; returns both paths. */
async function buildMultiArtifactCase(root: string): Promise<{
  readonly caseDirectory: string;
  readonly source: string;
}> {
  const source = join(root, "source");
  const profile = join(source, "Default");
  await mkdir(join(profile, "Network"), { recursive: true });
  await writeLocalState(source);
  await createHistoryWithDownload(join(profile, "History"));
  createCookies(join(profile, "Network", "Cookies"));
  createLoginData(join(profile, "Login Data"));
  await writeFile(
    join(profile, "Bookmarks"),
    JSON.stringify({
      checksum: "abc123",
      roots: {
        bookmark_bar: {
          type: "folder",
          id: "1",
          name: "Bookmarks bar",
          children: [
            {
              type: "url",
              id: "5",
              guid: "guid-bookmarked",
              name: "Bookmarked",
              url: BOOKMARK_URL,
              date_added: "13350000001000000",
            },
          ],
        },
        other: { type: "folder", id: "2", name: "Other", children: [] },
        synced: { type: "folder", id: "3", name: "Mobile", children: [] },
      },
      version: 1,
    }),
  );
  const keyMaterial = join(root, "key-material.json");
  await writeKeyMaterial(keyMaterial);
  const caseDirectory = join(root, "CASE-MULTI");
  expect(
    runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
  ).toBe(0);
  const analyse = runCli([
    "analyse",
    "--case",
    caseDirectory,
    "--timezone",
    "UTC",
    "--decrypt",
    "--key-material",
    keyMaterial,
    "--no-topic-classification",
    "--json",
  ]);
  expect(analyse.status, analyse.stderr).toBe(0);
  return { caseDirectory, source };
}

interface ExtractLine {
  readonly record_type: "finding" | "candidate";
  readonly collection: string;
  readonly store: string;
  readonly source_id: string;
  readonly profile: string;
  readonly commit_state?: string;
  readonly kind: string;
  readonly id: string;
  readonly run_id: string;
  readonly artifact_result_id: string;
  readonly provenance: Record<string, unknown>;
  readonly fields: Record<string, Record<string, unknown>>;
  readonly rank?: number;
  readonly supporting_count?: number;
  readonly category?: string;
}

function readLines(bytes: Buffer | undefined): ExtractLine[] {
  const text = String(bytes ?? "").trim();
  return text === ""
    ? []
    : text.split("\n").map((line) => JSON.parse(line) as ExtractLine);
}

interface CompletenessEntry {
  readonly artifact: string;
  readonly sourceId: string;
  readonly profile: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly runId: string;
}

interface ExportSummary {
  readonly status: "ok";
  readonly command: "export";
  readonly extractKind: "case";
  readonly outDirectory: string;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly csv: boolean;
  readonly redaction: {
    readonly policy: string;
    readonly state: "redacted" | "disclosed";
    readonly plaintextSecretsIncluded: boolean;
    readonly redactedFieldCount: number;
    readonly binaryPayloadCount: number;
  };
  readonly completeness: {
    readonly attempted: number;
    readonly produced: number;
    readonly absent: number;
    readonly unavailable: number;
  };
  readonly derivedDigest: string;
  readonly generatedAt: string;
  readonly files: readonly string[];
}

async function readOut(outDirectory: string): Promise<Record<string, Buffer>> {
  const names = await readdir(outDirectory);
  const files: Record<string, Buffer> = {};
  for (const name of names) {
    files[name] = await readFile(join(outDirectory, name));
  }
  return files;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI canonical Extract export", () => {
  it("emits a versioned header, separate collections, and a reproducible Manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    const outDirectory = join(root, "extract");
    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      outDirectory,
      "--examiner",
      "Jane Doe",
      "--csv",
      "--json",
    ]);
    expect(command.status).toBe(0);
    const summary = parseJson<ExportSummary>(command.stdout);

    // Findings and Candidates are separate collections.
    expect(summary.findingCount).toBeGreaterThan(0);
    expect(summary.files).toEqual(
      [
        "candidates.jsonl",
        "candidates.lossy.csv",
        "export_generation.json",
        "export_header.json",
        "export_manifest.json",
        "findings.jsonl",
        "findings.lossy.csv",
      ].sort(),
    );

    const files = await readOut(outDirectory);

    // Versioned JSON header with mandatory Case, Source, tool, examiner,
    // timezone, scope, and Redaction State data.
    const header = JSON.parse(String(files["export_header.json"])) as Record<
      string,
      unknown
    >;
    expect(header).toMatchObject({
      extract_schema: "forensix/extract/2",
      extractKind: "case",
      case: { schemaVersion: 2, toolVersion: expect.any(String) },
      tool: { name: "forensix", version: expect.any(String) },
      examiner: { state: "value", value: "Jane Doe" },
      declaredTimezone: { state: "value", value: "America/New_York" },
      scope: {
        collections: ["candidates", "findings"],
        profiles: "all",
        commitState: "all",
        activeResultsOnly: true,
        csv: { enabled: true, lossy: true },
      },
      redaction: {
        policy: "forensix/redaction/1",
        state: "redacted",
        plaintextSecretsIncluded: false,
        binaryPayloadCount: 0,
      },
    });
    expect(String((header.case as Record<string, unknown>).caseId)).toMatch(
      /[0-9a-f-]{36}/,
    );
    expect(Array.isArray(header.sources)).toBe(true);
    expect((header.sources as unknown[]).length).toBe(1);
    expect(Array.isArray(header.analysisRuns)).toBe(true);
    expect((header.analysisRuns as unknown[]).length).toBe(1);

    // The Completeness Statement records attempted, produced, absent, and
    // unavailable artifacts and lives in the header, before any result row.
    const completeness = header.completeness as {
      readonly attempted: number;
      readonly produced: number;
      readonly absent: number;
      readonly unavailable: number;
      readonly artifacts: readonly CompletenessEntry[];
    };
    expect(completeness.attempted).toBe(completeness.artifacts.length);
    expect(
      completeness.produced + completeness.absent + completeness.unavailable,
    ).toBe(completeness.attempted);
    expect(
      completeness.artifacts.find((entry) => entry.artifact === "History"),
    ).toMatchObject({ profile: "Default", outcome: "produced" });

    // Each JSONL Finding row preserves Provenance, Field State, Commit
    // State, and timestamp semantics.
    const findingLines = String(files["findings.jsonl"])
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(findingLines.length).toBe(summary.findingCount);
    const visit = findingLines.find(
      (row) => row.kind === "history_visit",
    ) as Record<string, unknown>;
    expect(visit).toMatchObject({
      record_type: "finding",
      collection: "findings",
      store: "history",
      id: expect.stringMatching(/^history:[0-9]+$/),
      commit_state: "committed",
      provenance: { table: "visits", rowId: "1" },
    });
    const visitFields = visit.fields as Record<string, Record<string, unknown>>;
    expect(visitFields.url).toMatchObject({
      state: "value",
      value: "https://alpha.example/",
    });
    expect(visitFields.visitTime).toMatchObject({
      state: "value",
      value: { epochFamily: "1601-us", declaredTimezone: "America/New_York" },
    });
    expect(visitFields.appId).toMatchObject({ state: "absent" });

    // No result cell carries a base64 binary payload; binaries would be
    // separate hashed files instead.
    expect(String(files["findings.jsonl"])).not.toContain('"base64"');
    expect(summary.redaction.binaryPayloadCount).toBe(0);

    // The CSV profile is explicitly lossy and uses record_type first.
    const csvHeaderLine = String(files["findings.lossy.csv"])
      .split("\n")[0]
      ?.split(",");
    expect(csvHeaderLine?.[0]).toBe("record_type");
    expect(header.scope).toMatchObject({ csv: { lossy: true } });

    // The Export Manifest digest is independently reproducible from the
    // emitted file bytes.
    const manifest = JSON.parse(String(files["export_manifest.json"])) as {
      readonly files: readonly {
        readonly path: string;
        readonly sha256: string;
        readonly size: number;
      }[];
      readonly derivedDigest: string;
      readonly quarantinedGenerationFile: string;
    };
    expect(manifest.quarantinedGenerationFile).toBe("export_generation.json");
    for (const entry of manifest.files) {
      const bytes = files[entry.path];
      expect(bytes).toBeDefined();
      expect(sha256(bytes as Buffer)).toBe(entry.sha256);
      expect((bytes as Buffer).byteLength).toBe(entry.size);
    }
    expect(manifest.files.map((entry) => entry.path)).not.toContain(
      "export_manifest.json",
    );
    expect(manifest.files.map((entry) => entry.path)).not.toContain(
      "export_generation.json",
    );
    const independentDigest = sha256(
      Buffer.from(JSON.stringify(manifest.files), "utf8"),
    );
    expect(independentDigest).toBe(manifest.derivedDigest);
    expect(summary.derivedDigest).toBe(manifest.derivedDigest);

    // The quarantined generation instant is isolated in one file.
    const generation = JSON.parse(
      String(files["export_generation.json"]),
    ) as Record<string, unknown>;
    expect(generation.generatedAt).toBe(summary.generatedAt);
    expect(generation.derivedDigest).toBe(manifest.derivedDigest);
  });

  it("produces byte-identical exports except for the quarantined generation instant", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-repro-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    const outOne = join(root, "extract-1");
    const outTwo = join(root, "extract-2");
    expect(
      runCli(["export", "--case", caseDirectory, "--out", outOne, "--json"])
        .status,
    ).toBe(0);
    expect(
      runCli(["export", "--case", caseDirectory, "--out", outTwo, "--json"])
        .status,
    ).toBe(0);

    const first = await readOut(outOne);
    const second = await readOut(outTwo);
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
    for (const name of Object.keys(first)) {
      if (name === "export_generation.json") {
        expect((first[name] as Buffer).equals(second[name] as Buffer)).toBe(
          false,
        );
      } else {
        expect((first[name] as Buffer).equals(second[name] as Buffer)).toBe(
          true,
        );
      }
    }
  });

  it("exports every record store with kind-aware redaction and a full Completeness Statement", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-multi-"));
    temporaryRoots.push(root);
    const { caseDirectory } = await buildMultiArtifactCase(root);

    const redactedOut = join(root, "redacted");
    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      redactedOut,
      "--csv",
      "--json",
    ]);
    expect(command.status, command.stderr).toBe(0);
    const summary = parseJson<ExportSummary>(command.stdout);
    const files = await readOut(redactedOut);
    const findings = readLines(files["findings.jsonl"]);
    const candidates = readLines(files["candidates.jsonl"]);
    expect(summary.findingCount).toBe(findings.length);
    expect(summary.candidateCount).toBe(candidates.length);

    // Every analysed artifact reaches the Extract, not only History.
    const findingStores = new Set(findings.map((row) => row.store));
    for (const store of [
      "history",
      "cookies",
      "logins",
      "downloads",
      "bookmarks",
    ]) {
      expect(findingStores).toContain(store);
    }
    expect(findings.find((row) => row.store === "downloads")?.fields).toSatisfy(
      (fields: unknown) => JSON.stringify(fields).includes(DOWNLOAD_URL),
    );
    expect(
      findings.find((row) => row.store === "bookmarks")?.fields.url,
    ).toEqual({ state: "value", value: BOOKMARK_URL });

    // Identity Candidates are in the Candidate collection, ranked, and carry
    // no Commit State.
    const host = candidates.find(
      (row) => row.kind === "behavior_frequent_host",
    );
    expect(host).toMatchObject({
      record_type: "candidate",
      collection: "candidates",
      store: "identity-candidates",
      category: "behavior",
      rank: 1,
    });
    for (const row of candidates) {
      expect(row).not.toHaveProperty("commit_state");
    }
    for (const row of findings) {
      expect(row.commit_state).toBe("committed");
    }

    // Each row cites its stable record id; ids never collide across stores.
    const ids = [...findings, ...candidates].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of [...findings, ...candidates]) {
      expect(row.id).toMatch(new RegExp(`^${row.store}:[0-9]+$`));
    }

    // Only the kind's secret fields are withheld, each with its hash. The
    // metadata about the secret (scheme, route, length) stays readable.
    const cookie = findings.find((row) => row.store === "cookies");
    expect(cookie?.fields.value).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: sha256(Buffer.from(JSON.stringify(COOKIE_SECRET), "utf8")),
    });
    const login = findings.find((row) => row.store === "logins");
    expect(login?.fields.secret).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: sha256(Buffer.from(JSON.stringify(LOGIN_SECRET), "utf8")),
    });
    expect(login?.fields.usernameValue).toEqual({
      state: "value",
      value: LOGIN_USERNAME,
    });
    expect(login?.fields.secretEncryptionScheme).toMatchObject({
      state: "value",
      value: "v11",
    });
    expect(login?.fields.secretDecryptionRoute).toMatchObject({
      state: "value",
    });
    expect(summary.redaction).toMatchObject({
      state: "redacted",
      plaintextSecretsIncluded: false,
      redactedFieldCount: 2,
    });
    for (const [name, bytes] of Object.entries(files)) {
      expect(String(bytes), name).not.toContain(COOKIE_SECRET);
      expect(String(bytes), name).not.toContain(LOGIN_SECRET);
    }

    // The lossy CSV of Candidates has no Commit State column.
    expect(String(files["findings.lossy.csv"]).split("\n")[0]).toContain(
      "commit_state",
    );
    expect(String(files["candidates.lossy.csv"]).split("\n")[0]).not.toContain(
      "commit_state",
    );

    // The Completeness Statement covers every artifact the analyzer
    // attempts, and its counts agree with its rows.
    const header = JSON.parse(String(files["export_header.json"])) as {
      readonly scope: { readonly stores: readonly string[] };
      readonly completeness: {
        readonly attempted: number;
        readonly produced: number;
        readonly artifacts: readonly CompletenessEntry[];
      };
    };
    expect([
      ...new Set(header.completeness.artifacts.map((row) => row.artifact)),
    ]).toEqual([
      "History",
      "Cookies",
      "Login Data",
      "Top Sites",
      "Web Data",
      "Favicons",
      "Candidates",
      "Downloads",
      "Bookmarks",
      "Preferences",
      "Cache",
    ]);
    expect(header.completeness.attempted).toBe(
      header.completeness.artifacts.length,
    );
    const outcome = (artifact: string): string | undefined =>
      header.completeness.artifacts.find(
        (row) => row.artifact === artifact && row.profile === "Default",
      )?.outcome;
    for (const artifact of [
      "History",
      "Cookies",
      "Login Data",
      "Downloads",
      "Bookmarks",
      "Candidates",
    ]) {
      expect(outcome(artifact), artifact).toBe("produced");
    }
    expect(header.scope.stores).toEqual(
      expect.arrayContaining([
        "history",
        "identity-candidates",
        "cookies",
        "logins",
        "downloads",
        "bookmarks",
      ]),
    );

    // With the explicit opt-in the same secrets are disclosed.
    const disclosedOut = join(root, "disclosed");
    const disclosedCommand = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      disclosedOut,
      "--include-secrets",
      "--json",
    ]);
    expect(disclosedCommand.status, disclosedCommand.stderr).toBe(0);
    const disclosed = parseJson<ExportSummary>(disclosedCommand.stdout);
    expect(disclosed.redaction).toMatchObject({
      state: "disclosed",
      plaintextSecretsIncluded: true,
      redactedFieldCount: 0,
    });
    const disclosedFindings = readLines(
      await readFile(join(disclosedOut, "findings.jsonl")),
    );
    expect(
      disclosedFindings.find((row) => row.store === "cookies")?.fields.value,
    ).toMatchObject({ state: "value", value: COOKIE_SECRET });
    expect(
      disclosedFindings.find((row) => row.store === "logins")?.fields.secret,
    ).toMatchObject({ state: "value", value: LOGIN_SECRET });
  });

  it("reports the active result its rows come from, not a later rerun that produced nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-rerun-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    // Record a later Analysis Run whose History attempt ended unavailable. A
    // rerun that produces nothing supersedes nothing: the earlier result
    // stays active and its rows stay current.
    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"));
    let activeRunId: string;
    try {
      const active = database
        .prepare(
          `SELECT r.run_id, r.source_id, r.profile_path, r.database_path,
                  r.manifest_entry_ordinal
             FROM history_artifact_results r
            WHERE r.active = 1`,
        )
        .get() as Record<string, string | number>;
      activeRunId = active.run_id as string;
      database
        .prepare(
          `INSERT INTO analysis_runs
             (run_id, artifact, started_at, finished_at, tool_version,
              invocation_json, declared_timezone, declared_origin_os, status)
           SELECT 'later-failed-run', artifact, '2999-01-01T00:00:00.000Z',
                  '2999-01-01T00:00:01.000Z', tool_version, invocation_json,
                  declared_timezone, declared_origin_os, 'partial'
             FROM analysis_runs WHERE run_id = ?`,
        )
        .run(activeRunId);
      database
        .prepare(
          `INSERT INTO history_artifact_results
             (run_id, source_id, profile_path, artifact,
              manifest_entry_ordinal, database_path, recovery_status, status,
              reason, active)
           VALUES ('later-failed-run', ?, ?, 'History', ?, ?, 'unavailable',
                   'unavailable', 'database_locked', 0)`,
        )
        .run(
          active.source_id as string,
          active.profile_path as string,
          active.manifest_entry_ordinal as number,
          active.database_path as string,
        );
    } finally {
      database.close();
    }

    const outDirectory = join(root, "extract");
    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      outDirectory,
      "--json",
    ]);
    expect(command.status, command.stderr).toBe(0);
    const files = await readOut(outDirectory);
    const findings = readLines(files["findings.jsonl"]);
    expect(findings.length).toBeGreaterThan(0);
    for (const row of findings.filter((line) => line.store === "history")) {
      expect(row.run_id).toBe(activeRunId);
    }
    const header = JSON.parse(String(files["export_header.json"])) as {
      readonly completeness: {
        readonly artifacts: readonly CompletenessEntry[];
      };
    };
    const history = header.completeness.artifacts.filter(
      (row) => row.artifact === "History",
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      outcome: "produced",
      runId: activeRunId,
    });
  });

  it("keeps the Extract out of the Case and every Source, also through a symbolic link", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-guard-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);
    const source = join(root, "source");
    const sourceLink = join(root, "source-link");
    const caseLink = join(root, "case-link");
    await symlink(source, sourceLink);
    await symlink(caseDirectory, caseLink);

    const refused = (outDirectory: string, written: string): void => {
      const command = runCli([
        "export",
        "--case",
        caseDirectory,
        "--out",
        outDirectory,
        "--json",
      ]);
      expect(command.status, outDirectory).toBe(1);
      expect(parseJson<Record<string, unknown>>(command.stderr)).toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      // The refusal happens before any directory is made.
      expect(existsSync(written), written).toBe(false);
    };

    refused(join(caseDirectory, "extract"), join(caseDirectory, "extract"));
    refused(join(caseLink, "extract"), join(caseDirectory, "extract"));
    refused(join(source, "extract"), join(source, "extract"));
    refused(
      join(source, "Default", "extract"),
      join(source, "Default", "extract"),
    );
    refused(join(sourceLink, "extract"), join(source, "extract"));

    const outDirectory = join(root, "used");
    await mkdir(outDirectory, { recursive: true });
    await writeFile(join(outDirectory, "keep.txt"), "existing\n");
    const nonEmpty = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      outDirectory,
      "--json",
    ]);
    expect(nonEmpty.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(nonEmpty.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("refuses to export a Case without analysis", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-noanalysis-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    await createHistory(join(source, "Default", "History"));
    const caseDirectory = join(root, "CASE-NO-ANALYSIS");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      join(root, "extract"),
      "--json",
    ]);
    expect(command.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(command.stderr)).toMatchObject({
      code: "ANALYSIS_NOT_FOUND",
    });
  });
});
