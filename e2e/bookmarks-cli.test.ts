import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

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

type Field<T> = FieldValue<T> | Unavailable | Absent;

interface BookmarkFinding {
  readonly recordType: "finding";
  readonly findingKind: "bookmark";
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
  readonly fields: Record<string, Field<unknown>>;
}

interface BookmarkPage {
  readonly status: "ok";
  readonly command: "bookmarks";
  readonly items: readonly BookmarkFinding[];
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Default primary Bookmarks: three URL bookmarks across two roots and a nested
// folder, plus one bookmark whose date_added is the wrong type (unavailable).
const DEFAULT_BOOKMARKS = {
  checksum: "abc123",
  roots: {
    bookmark_bar: {
      type: "folder",
      id: "1",
      guid: "guid-bar",
      name: "Bookmarks bar",
      date_added: "13350000000000000",
      children: [
        {
          type: "url",
          id: "5",
          guid: "guid-example",
          name: "Example",
          url: "https://example.com/",
          date_added: "13350000001000000",
          date_last_used: "0",
        },
        {
          type: "folder",
          id: "6",
          name: "Work",
          children: [
            {
              type: "url",
              id: "7",
              guid: "guid-docs",
              name: "Docs",
              url: "https://docs.example.com/",
              date_added: "13350000002000000",
              date_last_used: "13360000000000000",
            },
          ],
        },
      ],
    },
    other: {
      type: "folder",
      id: "2",
      name: "Other bookmarks",
      children: [
        {
          type: "url",
          id: "8",
          name: "News",
          url: "https://news.example.com/",
          date_added: 12345,
        },
      ],
    },
    synced: {
      type: "folder",
      id: "3",
      name: "Mobile bookmarks",
      children: [],
    },
  },
  version: 1,
};

// Default backup Bookmarks: a distinct earlier state of the same profile. The
// primary "Example" points at example.com; the backup keeps the superseded
// old.example.com value under the same node id. The two must never merge.
const DEFAULT_BOOKMARKS_BAK = {
  checksum: "old000",
  roots: {
    bookmark_bar: {
      type: "folder",
      id: "1",
      name: "Bookmarks bar",
      children: [
        {
          type: "url",
          id: "5",
          name: "Example (old)",
          url: "https://old.example.com/",
          date_added: "13340000000000000",
        },
      ],
    },
    other: { type: "folder", id: "2", name: "Other bookmarks", children: [] },
    synced: { type: "folder", id: "3", name: "Mobile bookmarks", children: [] },
  },
  version: 1,
};

const PROFILE_ONE_BOOKMARKS = {
  roots: {
    bookmark_bar: {
      type: "folder",
      id: "1",
      name: "Bookmarks bar",
      children: [
        {
          type: "url",
          id: "9",
          name: "Search",
          url: "https://search.example.com/",
          date_added: "13350500000000000",
        },
      ],
    },
    other: { type: "folder", id: "2", name: "Other bookmarks", children: [] },
    synced: { type: "folder", id: "3", name: "Mobile bookmarks", children: [] },
  },
  version: 1,
};

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(join(source, "Default"), { recursive: true });
  await mkdir(join(source, "Profile 1"), { recursive: true });
  await writeJson(join(source, "Default", "Bookmarks"), DEFAULT_BOOKMARKS);
  await writeJson(
    join(source, "Default", "Bookmarks.bak"),
    DEFAULT_BOOKMARKS_BAK,
  );
  // Profile 1 has only a primary file, so its backup is expected-but-absent.
  await writeJson(
    join(source, "Profile 1", "Bookmarks"),
    PROFILE_ONE_BOOKMARKS,
  );
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Bookmark Finding pipeline", () => {
  it("parses primary and backup Bookmarks across Profiles with exact fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bookmarks-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const primaryBytes = await readFile(join(source, "Default", "Bookmarks"));
    const caseDirectory = join(root, "CASE-BOOKMARKS");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    // AC1: current and backup Bookmarks parsed across all Profiles. Two
    // Profiles, two files each: Default has both, Profile 1 backup is absent.
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      bookmarks: {
        status: "complete",
        profileCount: 2,
        primaryAnalysedCount: 2,
        backupAnalysedCount: 1,
        absentCount: 1,
        unavailableCount: 0,
        bookmarkCount: 5,
        findingCount: 5,
      },
    });

    // AC5: default sort is by name ascending across every Profile and file.
    const all = parseJson<BookmarkPage>(
      runCli(["bookmarks", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(all.items.map((row) => row.fields.name)).toEqual([
      { state: "value", value: "Docs" },
      { state: "value", value: "Example" },
      { state: "value", value: "Example (old)" },
      { state: "value", value: "News" },
      { state: "value", value: "Search" },
    ]);

    // AC2: URL, name, folder ancestry, source file, and timestamps are exact.
    const docs = all.items.find(
      (row) => (row.fields.name as FieldValue<string>).value === "Docs",
    );
    expect(docs).toMatchObject({
      findingKind: "bookmark",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Bookmarks",
        database: "Default/Bookmarks",
        table: "bookmarks",
        rowId: "7",
      },
      fields: {
        bookmarkId: { state: "value", value: "7" },
        guid: { state: "value", value: "guid-docs" },
        name: { state: "value", value: "Docs" },
        url: { state: "value", value: "https://docs.example.com/" },
        sourceFile: { state: "value", value: "Bookmarks" },
        rootFolder: { state: "value", value: "bookmark_bar" },
        parentFolder: { state: "value", value: "Work" },
        folderPath: {
          state: "value",
          value: "Bookmarks bar / Work",
          synthetic: true,
        },
        dateAdded: {
          state: "value",
          value: {
            raw: "13350000002000000",
            epochFamily: "1601-us",
            utc: "2024-01-17T21:20:02.000000Z",
            resolution: "webkit_bookmarks_epoch",
          },
        },
        dateLastUsed: {
          state: "value",
          value: {
            raw: "13360000000000000",
            epochFamily: "1601-us",
            utc: "2024-05-12T15:06:40.000000Z",
          },
        },
      },
    });

    // AC2: the Chrome "never used" sentinel 0 is absent, not a bogus instant.
    const example = all.items.find(
      (row) =>
        (row.fields.name as FieldValue<string>).value === "Example" &&
        row.profile === "Default",
    );
    expect(example?.fields.dateLastUsed).toEqual({ state: "absent" });
    expect(example?.fields.dateAdded).toMatchObject({
      state: "value",
      value: { utc: "2024-01-17T21:20:01.000000Z" },
    });

    // AC2: a wrong-typed date is unavailable with a typed reason, never blank.
    const news = all.items.find(
      (row) => (row.fields.name as FieldValue<string>).value === "News",
    );
    expect(news?.fields.dateAdded).toEqual({
      state: "unavailable",
      reason: "unsupported_value",
    });
    expect(news?.fields.rootFolder).toEqual({ state: "value", value: "other" });
    expect(news?.fields.folderPath).toEqual({
      state: "value",
      value: "Other bookmarks",
      synthetic: true,
    });

    // AC3: the primary and backup "Example" records both exist, carry distinct
    // Provenance (different source file), and are never merged into one.
    const backup = all.items.find(
      (row) =>
        (row.fields.name as FieldValue<string>).value === "Example (old)",
    );
    expect(backup).toMatchObject({
      profile: "Default",
      provenance: {
        manifestPath: "Default/Bookmarks.bak",
        database: "Default/Bookmarks.bak",
        rowId: "5",
      },
      fields: {
        sourceFile: { state: "value", value: "Bookmarks.bak" },
        url: { state: "value", value: "https://old.example.com/" },
      },
    });
    expect(example?.provenance.manifestPath).toBe("Default/Bookmarks");
    expect(example?.fields.url).toEqual({
      state: "value",
      value: "https://example.com/",
    });
    // Same node id "5" in two files, but two distinct Findings.
    expect(example?.provenance.rowId).toBe("5");
    expect(backup?.provenance.rowId).toBe("5");
    expect(example?.provenance.manifestPath).not.toBe(
      backup?.provenance.manifestPath,
    );

    // AC5: source filter isolates primary from backup.
    const primaryOnly = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--source",
        "primary",
        "--json",
      ]).stdout,
    );
    expect(
      primaryOnly.items.every(
        (row) =>
          (row.fields.sourceFile as FieldValue<string>).value === "Bookmarks",
      ),
    ).toBe(true);
    expect(primaryOnly.items).toHaveLength(4);

    const backupOnly = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--source",
        "backup",
        "--json",
      ]).stdout,
    );
    expect(backupOnly.items).toHaveLength(1);
    expect(backupOnly.items[0]?.provenance.manifestPath).toBe(
      "Default/Bookmarks.bak",
    );

    // AC5: Profile filter narrows to one Profile.
    const profileOne = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--profile",
        "Profile 1",
        "--json",
      ]).stdout,
    );
    expect(profileOne.items).toHaveLength(1);
    expect(profileOne.items[0]?.fields.name).toEqual({
      state: "value",
      value: "Search",
    });

    // AC5: search matches name, URL, and folder path (case-insensitive).
    const searched = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--search",
        "docs.example.com",
        "--json",
      ]).stdout,
    );
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.fields.name).toEqual({
      state: "value",
      value: "Docs",
    });

    // AC5: sort by date-added ascending, with keyset pagination and a cursor.
    const firstPage = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--source",
        "primary",
        "--sort",
        "date-added",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    // News has an unavailable date_added (COALESCE sentinel -1), so it sorts
    // first; Search (2024-01-23) sorts after Example (2024-01-17).
    expect(firstPage.items.map((row) => row.fields.name)).toEqual([
      { state: "value", value: "News" },
      { state: "value", value: "Example" },
    ]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = parseJson<BookmarkPage>(
      runCli([
        "bookmarks",
        "--case",
        caseDirectory,
        "--source",
        "primary",
        "--sort",
        "date-added",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    expect(secondPage.items.map((row) => row.fields.name)).toEqual([
      { state: "value", value: "Docs" },
      { state: "value", value: "Search" },
    ]);

    // AC5: broken input rejected.
    const badLimit = runCli([
      "bookmarks",
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

    // AC5: a stale cursor after re-analysis is rejected.
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const stale = runCli([
      "bookmarks",
      "--case",
      caseDirectory,
      "--source",
      "primary",
      "--sort",
      "date-added",
      "--direction",
      "asc",
      "--limit",
      "2",
      "--after",
      firstPage.nextCursor as string,
      "--json",
    ]);
    expect(stale.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(stale.stderr)).toMatchObject({
      code: "INVALID_CURSOR",
    });

    // AC1: analysis never mutates the Source bytes.
    expect(await readFile(join(source, "Default", "Bookmarks"))).toEqual(
      primaryBytes,
    );
  });

  it("reports malformed JSON as unavailable and a missing file as absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bookmarks-bad-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(join(source, "Default"), { recursive: true });
    await mkdir(join(source, "Profile 1"), { recursive: true });
    // Default's primary is byte-intact but unparseable (unavailable); its
    // backup is simply missing (absent). Profile 1 keeps a valid primary so the
    // Case still has a defensible, queryable Bookmarks result.
    await writeFile(
      join(source, "Default", "Bookmarks"),
      "{ not valid json ,,",
    );
    await writeJson(
      join(source, "Profile 1", "Bookmarks"),
      PROFILE_ONE_BOOKMARKS,
    );
    const caseDirectory = join(root, "CASE-BOOKMARKS-BAD");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    // AC4: the malformed primary is unavailable and the missing files are
    // absent. Bookmarks are JSON-derived and do not drive the Analysis Run exit
    // state (like Preferences metadata), so the run stays clean while the
    // bookmarks summary reports its own partial health.
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      exitState: "complete",
      bookmarks: {
        status: "partial",
        primaryAnalysedCount: 1,
        backupAnalysedCount: 0,
        absentCount: 2,
        unavailableCount: 1,
        findingCount: 1,
      },
    });

    // AC4: the defensible Profile 1 bookmark is still queryable.
    const results = parseJson<BookmarkPage>(
      runCli(["bookmarks", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(results.items).toHaveLength(1);
    expect(results.items[0]?.profile).toBe("Profile 1");
    expect(results.items[0]?.fields.name).toEqual({
      state: "value",
      value: "Search",
    });
  });
});
