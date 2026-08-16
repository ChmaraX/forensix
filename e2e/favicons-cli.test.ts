import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

interface FaviconFinding {
  readonly recordType: "finding";
  readonly findingKind: "favicon";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly sourceId: string;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
    readonly supportingRows?: readonly {
      readonly table: string;
      readonly rowId: string;
    }[];
  };
  readonly fields: {
    readonly bitmapId: Field<string>;
    readonly iconId: Field<string>;
    readonly iconUrl: Field<string>;
    readonly iconType: Field<string>;
    readonly iconTypeRaw: Field<string>;
    readonly width: Field<string>;
    readonly height: Field<string>;
    readonly lastUpdated: Field<{ readonly raw: string; readonly utc: string }>;
    readonly lastRequested: Field<unknown>;
    readonly payloadSha256: Field<string>;
    readonly payloadBytes: Field<string>;
    readonly payloadPath: Field<string>;
    readonly pageUrls: Field<readonly string[]>;
    readonly pageAssociationCount: Field<string>;
    readonly unreadablePageAssociationCount: Field<string>;
  };
}

interface FaviconPage {
  readonly status: "ok";
  readonly command: "favicons";
  readonly items: readonly FaviconFinding[];
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

const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

interface IconInput {
  readonly iconUrl: string;
  readonly iconType: number;
  readonly width: number;
  readonly height: number;
  readonly imageData: Uint8Array | null;
  readonly lastUpdatedMicros: bigint;
  readonly pageUrls: readonly string[];
}

/**
 * Build a Favicons database faithful to the current Chromium schema
 * (version 8): `favicons` (icon URL + type), `favicon_bitmaps` (payload blob at
 * one pixel size, `last_updated`/`last_requested` as base::Time internal
 * values), and `icon_mapping` (page URL to icon association), plus a
 * self-describing `meta.version`.
 */
async function createFavicons(
  path: string,
  icons: readonly IconInput[],
  version = 8,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '${version}'), ('last_compatible_version', '1');

      CREATE TABLE favicons (
        id INTEGER PRIMARY KEY,
        url LONGVARCHAR NOT NULL,
        icon_type INTEGER DEFAULT 0
      );
      CREATE TABLE favicon_bitmaps (
        id INTEGER PRIMARY KEY,
        icon_id INTEGER NOT NULL,
        last_updated INTEGER DEFAULT 0,
        image_data BLOB,
        width INTEGER DEFAULT 0,
        height INTEGER DEFAULT 0,
        last_requested INTEGER DEFAULT 0
      );
      CREATE TABLE icon_mapping (
        id INTEGER PRIMARY KEY,
        page_url LONGVARCHAR NOT NULL,
        icon_id INTEGER NOT NULL
      );
    `);
    const insertIcon = database.prepare(
      "INSERT INTO favicons (url, icon_type) VALUES (?, ?)",
    );
    const insertBitmap = database.prepare(
      "INSERT INTO favicon_bitmaps (icon_id, last_updated, image_data, width, height, last_requested) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertMapping = database.prepare(
      "INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)",
    );
    for (const icon of icons) {
      const iconId = insertIcon.run(icon.iconUrl, icon.iconType)
        .lastInsertRowid as number;
      insertBitmap.run(
        iconId,
        icon.lastUpdatedMicros,
        icon.imageData,
        icon.width,
        icon.height,
        icon.lastUpdatedMicros,
      );
      for (const pageUrl of icon.pageUrls) {
        insertMapping.run(pageUrl, iconId);
      }
    }
  } finally {
    database.close();
  }
}

/** A valid SQLite file that is not a supported Favicons store. */
async function createUnsupportedFavicons(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '8');
      CREATE TABLE not_favicons (url LONGVARCHAR);
    `);
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

describe("compiled analyzer CLI Favicons metadata", () => {
  it("parses Favicons across Profiles with payloads as hashed files", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-favicons-e2e-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");

    const alphaPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);
    const bravoPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0b, 0x0c]);
    const alphaSha = createHash("sha256").update(alphaPng).digest("hex");
    // 2021-01-01T00:00:00Z in base::Time internal microseconds since 1601.
    const alphaMicros =
      BigInt(Date.UTC(2021, 0, 1)) * 1000n + WINDOWS_EPOCH_OFFSET_MICROS;
    await createFavicons(join(source, "Default", "Favicons"), [
      {
        iconUrl: "https://alpha.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: alphaPng,
        lastUpdatedMicros: alphaMicros,
        pageUrls: ["https://alpha.example/", "https://alpha.example/about"],
      },
      {
        iconUrl: "https://bravo.example/touch.png",
        iconType: 2,
        width: 32,
        height: 32,
        imageData: bravoPng,
        lastUpdatedMicros: alphaMicros,
        pageUrls: ["https://bravo.example/"],
      },
    ]);
    await createFavicons(join(source, "Profile 1", "Favicons"), [
      {
        iconUrl: "https://delta.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: new Uint8Array([0x11, 0x22, 0x33]),
        lastUpdatedMicros: alphaMicros,
        pageUrls: ["https://delta.example/"],
      },
    ]);
    const defaultBytes = await readFile(join(source, "Default", "Favicons"));
    const caseDirectory = join(root, "CASE-FAVICONS");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      favicons: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        absentProfileCount: 0,
        unavailableProfileCount: 0,
        committedFaviconCount: 3,
        recoveredFaviconCount: 0,
        payloadFileCount: 3,
      },
    });

    // Each payload is a separately hashed file named by its SHA-256, and
    // the row references it by digest and path rather than inlining base64.
    const payloadOnDisk = await readFile(
      join(caseDirectory, "favicon-payloads", alphaSha),
    );
    expect(new Uint8Array(payloadOnDisk)).toEqual(alphaPng);

    // Bounded, multi-Profile keyset pagination ordered by icon URL.
    const firstPage = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--sort",
        "icon-url",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage).toMatchObject({ command: "favicons", limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const [first] = firstPage.items;
    expect(first).toBeDefined();
    // Icon metadata and page URLs exact against ground truth with
    // Field State, resolvable Provenance, and Commit State.
    expect(first).toMatchObject({
      recordType: "finding",
      findingKind: "favicon",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Favicons",
        database: "Default/Favicons",
        table: "favicon_bitmaps",
        rowId: "1",
      },
      fields: {
        iconUrl: {
          state: "value",
          value: "https://alpha.example/favicon.ico",
        },
        iconType: { state: "value", value: "favicon" },
        width: { state: "value", value: "16" },
        payloadSha256: { state: "value", value: alphaSha },
        payloadPath: {
          state: "value",
          value: `favicon-payloads/${alphaSha}`,
        },
        payloadBytes: { state: "value", value: String(alphaPng.byteLength) },
        pageAssociationCount: { state: "value", value: "2" },
      },
    });
    // Every associated page URL is traced from the one payload Finding.
    expect(first?.fields.pageUrls).toEqual({
      state: "value",
      value: ["https://alpha.example/", "https://alpha.example/about"],
    });
    // The icon and mapping rows are cited as supporting Provenance.
    const supportingTables = (first?.provenance.supportingRows ?? []).map(
      (row) => row.table,
    );
    expect(supportingTables).toContain("favicons");
    expect(supportingTables).toContain("icon_mapping");
    // Base::Time internal value decoded to an exact UTC instant.
    expect(first?.fields.lastUpdated).toMatchObject({
      state: "value",
      value: { utc: "2021-01-01T00:00:00.000000Z" },
    });

    const secondPage = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--sort",
        "icon-url",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const allIconUrls = [...firstPage.items, ...secondPage.items].map(
      (item) =>
        item.fields.iconUrl.state === "value" && item.fields.iconUrl.value,
    );
    expect(new Set(allIconUrls).size).toBe(3);
    expect(
      [...firstPage.items, ...secondPage.items].map((item) => item.profile),
    ).toContain("Profile 1");

    // Search matches icon URL and page URLs.
    const searched = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--search",
        "delta",
        "--json",
      ]).stdout,
    );
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.profile).toBe("Profile 1");

    // Multi-Profile selection filter.
    const filtered = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--profile",
        "Default",
        "--json",
      ]).stdout,
    );
    expect(filtered.items).toHaveLength(2);
    expect(filtered.items.every((item) => item.profile === "Default")).toBe(
      true,
    );

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(source, "Default", "Favicons"))).toEqual(
      defaultBytes,
    );
  });

  it("keeps bitmap-less icons and their page associations as Findings", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-favicons-nobitmap-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const micros = 13_000_000_000_000_000n;

    // One icon WITH a cached bitmap, and one known favicon that Chromium
    // recorded on a page visit but never downloaded: a favicons row and its
    // icon_mapping with no favicon_bitmaps row. Neither the icon URL nor its
    // page association may be dropped.
    const path = join(source, "Default", "Favicons");
    await createFavicons(path, [
      {
        iconUrl: "https://cached.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: new Uint8Array([0x01, 0x02]),
        lastUpdatedMicros: micros,
        pageUrls: ["https://cached.example/"],
      },
    ]);
    const writer = new DatabaseSync(path);
    try {
      const iconId = writer
        .prepare("INSERT INTO favicons (url, icon_type) VALUES (?, 1)")
        .run("https://known.example/favicon.ico").lastInsertRowid as number;
      writer
        .prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)")
        .run("https://known.example/", iconId);
    } finally {
      writer.close();
    }

    const caseDirectory = join(root, "CASE-FAVICONS-NOBITMAP");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );

    const rows = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--sort",
        "icon-url",
        "--json",
      ]).stdout,
    );
    expect(rows.items).toHaveLength(2);
    const known = rows.items.find(
      (item) =>
        item.fields.iconUrl.state === "value" &&
        item.fields.iconUrl.value === "https://known.example/favicon.ico",
    );
    expect(known).toBeDefined();
    // The bitmap-less Finding keeps the icon URL and its page association, cites
    // the favicons row as Provenance, and reports no cached payload.
    expect(known).toMatchObject({
      commitState: "committed",
      provenance: { table: "favicons", database: "Default/Favicons" },
      fields: {
        bitmapId: { state: "absent" },
        payloadSha256: { state: "absent" },
        payloadPath: { state: "absent" },
        pageUrls: { state: "value", value: ["https://known.example/"] },
        pageAssociationCount: { state: "value", value: "1" },
      },
    });
  });

  it("distinguishes a missing payload from an unreadable payload value", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-favicons-payload-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const micros = 13_000_000_000_000_000n;

    const path = join(source, "Default", "Favicons");
    await createFavicons(path, [
      {
        iconUrl: "https://missing.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: null,
        lastUpdatedMicros: micros,
        pageUrls: ["https://missing.example/"],
      },
    ]);
    // A second icon whose image_data column holds a non-blob value: a
    // representation/read failure, distinct from a NULL missing payload.
    const writer = new DatabaseSync(path);
    try {
      const iconId = writer
        .prepare("INSERT INTO favicons (url, icon_type) VALUES (?, 1)")
        .run("https://corrupt.example/favicon.ico").lastInsertRowid as number;
      writer
        .prepare(
          "INSERT INTO favicon_bitmaps (icon_id, last_updated, image_data, width, height, last_requested) VALUES (?, ?, ?, 16, 16, ?)",
        )
        .run(iconId, micros, "not-a-blob", micros);
      writer
        .prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)")
        .run("https://corrupt.example/", iconId);
    } finally {
      writer.close();
    }

    const caseDirectory = join(root, "CASE-FAVICONS-PAYLOAD");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );

    const rows = parseJson<FaviconPage>(
      runCli([
        "favicons",
        "--case",
        caseDirectory,
        "--sort",
        "icon-url",
        "--json",
      ]).stdout,
    );
    expect(rows.items).toHaveLength(2);
    const [corrupt, missing] = rows.items;
    // Missing payload: NULL image_data is an absent Field State.
    expect(missing?.fields).toMatchObject({
      iconUrl: { state: "value", value: "https://missing.example/favicon.ico" },
      payloadSha256: { state: "absent" },
      payloadPath: { state: "absent" },
    });
    // Read failure: a non-blob value is an unavailable Field State, never
    // confused with a missing payload.
    expect(corrupt?.fields.payloadSha256).toMatchObject({
      state: "unavailable",
      reason: "unsupported_value",
    });
    expect(corrupt?.fields.payloadPath).toMatchObject({
      state: "unavailable",
    });
  });

  it("keeps committed and WAL-resident associations separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-favicons-wal-"));
    temporaryRoots.push(root);
    const source = join(root, "wal-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const micros = 13_000_000_000_000_000n;
    const committedIcon = new Uint8Array([0x01, 0x02, 0x03]);
    const walIcon = new Uint8Array([0x04, 0x05, 0x06, 0x07]);
    const faviconsPath = join(source, "Default", "Favicons");
    await createFavicons(faviconsPath, [
      {
        iconUrl: "https://committed.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: committedIcon,
        lastUpdatedMicros: micros,
        pageUrls: ["https://committed.example/"],
      },
    ]);

    const writer = new DatabaseSync(faviconsPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    const walIconId = writer
      .prepare("INSERT INTO favicons (url, icon_type) VALUES (?, 1)")
      .run("https://wal.example/favicon.ico").lastInsertRowid as number;
    writer
      .prepare(
        "INSERT INTO favicon_bitmaps (icon_id, last_updated, image_data, width, height, last_requested) VALUES (?, ?, ?, 16, 16, ?)",
      )
      .run(walIconId, micros, walIcon, micros);
    writer
      .prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)")
      .run("https://wal.example/", walIconId);

    const caseDirectory = join(root, "CASE-FAVICONS-WAL");
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
      favicons: { committedFaviconCount: 1, recoveredFaviconCount: 1 },
    });

    // Committed rows only.
    const committed = parseJson<FaviconPage>(
      runCli([
        "favicons",
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
      provenance: { manifestPath: "Default/Favicons" },
      fields: {
        iconUrl: {
          state: "value",
          value: "https://committed.example/favicon.ico",
        },
      },
    });

    // Sidecar (WAL-resident) associations carry the explicit Commit State
    // and the sidecar Manifest Provenance.
    const recovered = parseJson<FaviconPage>(
      runCli([
        "favicons",
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
        manifestPath: "Default/Favicons-wal",
        database: "Default/Favicons",
        table: "favicon_bitmaps",
      },
      fields: {
        iconUrl: { state: "value", value: "https://wal.example/favicon.ico" },
        pageUrls: { state: "value", value: ["https://wal.example/"] },
      },
    });
  });

  it("distinguishes missing Favicons from an unreadable database", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-favicons-gap-"));
    temporaryRoots.push(root);
    const source = join(root, "gap-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const micros = 13_000_000_000_000_000n;
    // Default: a defensible Favicons store.
    await createFavicons(join(source, "Default", "Favicons"), [
      {
        iconUrl: "https://alpha.example/favicon.ico",
        iconType: 1,
        width: 16,
        height: 16,
        imageData: new Uint8Array([0x01]),
        lastUpdatedMicros: micros,
        pageUrls: ["https://alpha.example/"],
      },
    ]);
    // Profile 1: no Favicons file at all — absent (missing), not unavailable.
    await mkdir(join(source, "Profile 1"), { recursive: true });
    await writeFile(join(source, "Profile 1", "Login Data"), "not-a-db");
    // Profile 2: a valid SQLite database but no favicon tables — unavailable.
    await createUnsupportedFavicons(join(source, "Profile 2", "Favicons"));

    const caseDirectory = join(root, "CASE-FAVICONS-GAP");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // An unavailable artifact makes the run partial (exit code 2), while
    // produced and absent artifacts stay distinct in the summary counts.
    expect(analysis.status).toBe(2);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      exitState: "partial",
      favicons: {
        status: "partial",
        profileCount: 3,
        analysedProfileCount: 1,
        absentProfileCount: 1,
        unavailableProfileCount: 1,
        committedFaviconCount: 1,
      },
    });

    const rows = parseJson<FaviconPage>(
      runCli(["favicons", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]?.profile).toBe("Default");
  });
});
