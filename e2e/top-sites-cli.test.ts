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

interface TopSiteFinding {
  readonly recordType: "finding";
  readonly findingKind: "top_site";
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
    readonly topSiteId: Field<string>;
    readonly url: Field<string>;
    readonly title: Field<string>;
    readonly urlRank: Field<string>;
    readonly redirects: Field<string>;
  };
}

interface TopSitePage {
  readonly status: "ok";
  readonly command: "top-sites";
  readonly items: readonly TopSiteFinding[];
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

interface TopSiteRow {
  readonly url: string;
  readonly urlRank: bigint;
  readonly title: string;
}

/**
 * Build a Top Sites database faithful to the current Chromium schema
 * (version 5): a `top_sites` table with `url`, `url_rank`, and `title`, keyed
 * by an implicit rowid, plus a self-describing `meta.version`.
 */
async function createTopSites(
  path: string,
  rows: readonly TopSiteRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '5'), ('last_compatible_version', '1');

      CREATE TABLE top_sites (
        url LONGVARCHAR PRIMARY KEY,
        url_rank INTEGER NOT NULL,
        title LONGVARCHAR NOT NULL
      );
    `);
    const insert = database.prepare(
      "INSERT INTO top_sites (url, url_rank, title) VALUES (?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(row.url, row.urlRank, row.title);
    }
  } finally {
    database.close();
  }
}

function insertTopSite(database: DatabaseSync, row: TopSiteRow): void {
  database
    .prepare("INSERT INTO top_sites (url, url_rank, title) VALUES (?, ?, ?)")
    .run(row.url, row.urlRank, row.title);
}

/**
 * Build a version-4 Top Sites database, which still carries the (unused since
 * 2019) `redirects` column dropped by version 5. It proves the reader parses
 * both current schemas and keeps `redirects` as an exact value when present.
 */
async function createTopSitesV4(
  path: string,
  rows: readonly (TopSiteRow & { readonly redirects: string })[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '4'), ('last_compatible_version', '1');

      CREATE TABLE top_sites (
        url LONGVARCHAR PRIMARY KEY,
        url_rank INTEGER NOT NULL,
        title LONGVARCHAR NOT NULL,
        redirects LONGVARCHAR
      );
    `);
    const insert = database.prepare(
      "INSERT INTO top_sites (url, url_rank, title, redirects) VALUES (?, ?, ?, ?)",
    );
    for (const row of rows) {
      insert.run(row.url, row.urlRank, row.title, row.redirects);
    }
  } finally {
    database.close();
  }
}

/**
 * A valid SQLite file that is not a supported Top Sites store: it carries a
 * `meta` table but no `top_sites` table. The analyzer must classify this as
 * unavailable (unreadable/unsupported), distinct from an absent database.
 */
async function createUnsupportedTopSites(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '5');
      CREATE TABLE not_top_sites (url LONGVARCHAR);
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

describe("compiled analyzer CLI Top Sites metadata", () => {
  it("parses Top Sites across Profiles with Field State and Provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-top-sites-e2e-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    await createTopSites(join(source, "Default", "Top Sites"), [
      { url: "https://alpha.example/", urlRank: 0n, title: "Alpha" },
      { url: "https://bravo.example/", urlRank: 1n, title: "Bravo" },
      { url: "https://charlie.example/", urlRank: 2n, title: "Charlie" },
    ]);
    await createTopSites(join(source, "Profile 1", "Top Sites"), [
      { url: "https://delta.example/", urlRank: 0n, title: "Delta" },
    ]);
    const defaultBytes = await readFile(join(source, "Default", "Top Sites"));
    const caseDirectory = join(root, "CASE-TOP-SITES");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      topSites: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        absentProfileCount: 0,
        unavailableProfileCount: 0,
        committedTopSiteCount: 4,
        recoveredTopSiteCount: 0,
      },
    });

    // AC5: bounded, multi-Profile keyset pagination ordered by rank.
    const firstPage = parseJson<TopSitePage>(
      runCli([
        "top-sites",
        "--case",
        caseDirectory,
        "--sort",
        "rank",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage).toMatchObject({ command: "top-sites", limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const [first] = firstPage.items;
    expect(first).toBeDefined();
    // AC1 + AC2: url, title, rank exact against ground truth with Field State
    // and resolvable Provenance.
    expect(first).toMatchObject({
      recordType: "finding",
      findingKind: "top_site",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Top Sites",
        database: "Default/Top Sites",
        table: "top_sites",
        rowId: "1",
      },
      fields: {
        topSiteId: { state: "value", value: "1" },
        url: { state: "value", value: "https://alpha.example/" },
        title: { state: "value", value: "Alpha" },
        urlRank: { state: "value", value: "0" },
      },
    });
    // AC2: a column absent from schema v5 is an absent Field State, never blank.
    expect(first?.fields.redirects).toEqual({ state: "absent" });

    const secondPage = parseJson<TopSitePage>(
      runCli([
        "top-sites",
        "--case",
        caseDirectory,
        "--sort",
        "rank",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const allUrls = [...firstPage.items, ...secondPage.items].map(
      (item) => item.fields.url.state === "value" && item.fields.url.value,
    );
    expect(new Set(allUrls).size).toBe(4);
    expect(
      [...firstPage.items, ...secondPage.items].map((item) => item.profile),
    ).toContain("Profile 1");

    // AC5: search matches url and title.
    const searched = parseJson<TopSitePage>(
      runCli([
        "top-sites",
        "--case",
        caseDirectory,
        "--search",
        "delta",
        "--json",
      ]).stdout,
    );
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.profile).toBe("Profile 1");

    // AC5: multi-Profile selection filter.
    const filtered = parseJson<TopSitePage>(
      runCli([
        "top-sites",
        "--case",
        caseDirectory,
        "--profile",
        "Default",
        "--json",
      ]).stdout,
    );
    expect(filtered.items).toHaveLength(3);
    expect(filtered.items.every((item) => item.profile === "Default")).toBe(
      true,
    );

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(source, "Default", "Top Sites"))).toEqual(
      defaultBytes,
    );
  });

  it("keeps committed and WAL-resident Top Sites separate with Provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-top-sites-wal-"));
    temporaryRoots.push(root);
    const source = join(root, "wal-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const topSitesPath = join(source, "Default", "Top Sites");
    await createTopSites(topSitesPath, [
      { url: "https://committed.example/", urlRank: 0n, title: "Committed" },
    ]);

    const writer = new DatabaseSync(topSitesPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    insertTopSite(writer, {
      url: "https://wal.example/",
      urlRank: 1n,
      title: "WAL",
    });

    const caseDirectory = join(root, "CASE-TOP-SITES-WAL");
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
      topSites: { committedTopSiteCount: 1, recoveredTopSiteCount: 1 },
    });

    // AC3: committed rows only.
    const committed = parseJson<TopSitePage>(
      runCli([
        "top-sites",
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
      provenance: { manifestPath: "Default/Top Sites", rowId: "1" },
      fields: { url: { state: "value", value: "https://committed.example/" } },
    });

    // AC3: sidecar (WAL-resident) rows carry the explicit Commit State and the
    // sidecar Manifest Provenance.
    const recovered = parseJson<TopSitePage>(
      runCli([
        "top-sites",
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
        manifestPath: "Default/Top Sites-wal",
        database: "Default/Top Sites",
        table: "top_sites",
        rowId: "2",
      },
      fields: { url: { state: "value", value: "https://wal.example/" } },
    });
  });

  it("parses the version-4 schema and keeps redirects as an exact value", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-top-sites-v4-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    await createTopSitesV4(join(source, "Default", "Top Sites"), [
      {
        url: "https://legacy.example/",
        urlRank: 0n,
        title: "Legacy",
        redirects: "https://legacy.example/ https://www.legacy.example/",
      },
    ]);
    const caseDirectory = join(root, "CASE-TOP-SITES-V4");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );

    const rows = parseJson<TopSitePage>(
      runCli(["top-sites", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]?.fields).toMatchObject({
      url: { state: "value", value: "https://legacy.example/" },
      redirects: {
        state: "value",
        value: "https://legacy.example/ https://www.legacy.example/",
      },
    });
  });

  it("distinguishes missing Top Sites from an unreadable database", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-top-sites-gap-"));
    temporaryRoots.push(root);
    const source = join(root, "gap-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    // Default: a defensible Top Sites store.
    await createTopSites(join(source, "Default", "Top Sites"), [
      { url: "https://alpha.example/", urlRank: 0n, title: "Alpha" },
    ]);
    // Profile 1: no Top Sites file at all, but a profile marker so it is
    // discovered — the store is absent (missing), not unavailable.
    await mkdir(join(source, "Profile 1"), { recursive: true });
    await writeFile(join(source, "Profile 1", "Login Data"), "not-a-db");
    // Profile 2: a Top Sites file that is a valid SQLite database but has no
    // top_sites table — unreadable/unsupported, so unavailable.
    await createUnsupportedTopSites(join(source, "Profile 2", "Top Sites"));

    const caseDirectory = join(root, "CASE-TOP-SITES-GAP");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // AC4: an unavailable artifact makes the run partial (exit code 2), while
    // the produced and absent artifacts stay distinct in the summary counts.
    expect(analysis.status).toBe(2);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      exitState: "partial",
      topSites: {
        status: "partial",
        profileCount: 3,
        analysedProfileCount: 1,
        absentProfileCount: 1,
        unavailableProfileCount: 1,
        committedTopSiteCount: 1,
      },
    });

    // Only the defensible Profile is queryable; the gap and the failure never
    // fabricate rows.
    const rows = parseJson<TopSitePage>(
      runCli(["top-sites", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]?.profile).toBe("Default");
  });
});
