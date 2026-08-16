import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

interface FieldValue<T> {
  readonly state: "value";
  readonly value: T;
  readonly synthetic?: boolean;
}

interface TimestampValue {
  readonly raw: string;
  readonly epochFamily: "1601-us" | "unix-us";
  readonly utc: string;
  readonly declaredTimezone: string;
  readonly resolution: string;
}

interface HistoryFinding {
  readonly recordType: "finding";
  readonly findingKind: "history_visit";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly manifestEntryId: string;
    readonly sourceId: string;
    readonly manifestEntryOrdinal: number;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
  };
  readonly fields: {
    readonly visitId: FieldValue<string>;
    readonly url: FieldValue<string>;
    readonly title: FieldValue<string>;
    readonly visitTime: FieldValue<TimestampValue>;
    readonly fromVisit: FieldValue<string>;
    readonly externalReferrerUrl: FieldValue<string>;
    readonly transitionRaw: FieldValue<string>;
    readonly transitionCore: FieldValue<string>;
    readonly transitionQualifiers: FieldValue<readonly string[]>;
    readonly redirectFromVisitId:
      | FieldValue<string>
      | { readonly state: "absent" };
    readonly redirectToVisitIds: FieldValue<readonly string[]>;
    readonly visitSource: FieldValue<string>;
    readonly visitDurationMicros: FieldValue<string>;
    readonly originatorCacheGuid: FieldValue<string>;
    readonly appId: FieldValue<string>;
  };
}

interface HistoryPage {
  readonly status: "ok";
  readonly command: "history";
  readonly view: "visits";
  readonly items: readonly HistoryFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

async function createHistory(
  path: string,
  rows: readonly {
    readonly id: bigint;
    readonly urlId: bigint;
    readonly url: string;
    readonly title: string;
    readonly visitTime: bigint;
    readonly fromVisit: bigint;
    readonly transition: bigint;
    readonly duration: bigint;
    readonly source?: bigint;
  }[],
): Promise<void> {
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
      CREATE TABLE segments (id INTEGER PRIMARY KEY, name VARCHAR, url_id INTEGER NON NULL);
      CREATE TABLE segment_usage (
        id INTEGER PRIMARY KEY,
        segment_id INTEGER NOT NULL,
        time_slot INTEGER NOT NULL,
        visit_count INTEGER DEFAULT 0 NOT NULL
      );
    `);

    const insertUrl = database.prepare(
      `INSERT INTO urls
         (id, url, title, visit_count, typed_count, last_visit_time, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertVisit = database.prepare(
      `INSERT INTO visits
         (id, url, visit_time, from_visit, external_referrer_url, transition,
          segment_id, visit_duration, incremented_omnibox_typed_score,
          opener_visit, originator_cache_guid, originator_visit_id,
          originator_from_visit, originator_opener_visit, is_known_to_sync,
          consider_for_ntp_most_visited, visited_link_id, app_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSource = database.prepare(
      "INSERT INTO visit_source (id, source) VALUES (?, ?)",
    );

    const counts = new Map<bigint, number>();
    for (const row of rows) {
      counts.set(row.urlId, (counts.get(row.urlId) ?? 0) + 1);
    }
    const urls = new Map(rows.map((row) => [row.urlId, row]));
    for (const row of urls.values()) {
      insertUrl.run(
        row.urlId,
        row.url,
        row.title,
        counts.get(row.urlId) ?? 0,
        1,
        row.visitTime,
        0,
      );
    }
    for (const row of rows) {
      insertVisit.run(
        row.id,
        row.urlId,
        row.visitTime,
        row.fromVisit,
        row.fromVisit === 0n ? "" : "https://external.example/referrer",
        row.transition,
        0,
        row.duration,
        1,
        0,
        "origin-cache-guid",
        row.id + 1000n,
        0,
        0,
        1,
        1,
        row.id + 2000n,
        "com.example.browser",
      );
      if (row.source !== undefined) {
        insertSource.run(row.id, row.source);
      }
    }
  } finally {
    database.close();
  }
}

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createHistory(join(source, "Default", "History"), [
    {
      id: 1n,
      urlId: 10n,
      url: "https://alpha.example/start",
      title: "Alpha start",
      visitTime: 13_348_638_245_123_456n,
      fromVisit: 0n,
      transition: 0x10000001n,
      duration: 2_500_000n,
    },
    {
      id: 2n,
      urlId: 11n,
      url: "https://alpha.example/redirected",
      title: "Alpha redirected",
      visitTime: 13_348_638_305_456_000n,
      fromVisit: 1n,
      transition: 0x60000000n,
      duration: 5_000_000n,
      source: 2n,
    },
  ]);
  await createHistory(join(source, "Profile 1", "History"), [
    {
      id: 7n,
      urlId: 70n,
      url: "https://beta.example/",
      title: "Beta",
      visitTime: 13_361_718_600_000_000n,
      fromVisit: 0n,
      transition: 8n,
      duration: 750_000n,
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
  const historyPath = join(source, "Default", "History");
  await createHistory(historyPath, [
    {
      id: 1n,
      urlId: 10n,
      url: "https://committed.example/",
      title: "Committed",
      visitTime: 13_348_638_245_123_456n,
      fromVisit: 0n,
      transition: 1n,
      duration: 100n,
    },
    {
      id: 3n,
      urlId: 30n,
      url: "https://visit-update.example/",
      title: "Visit update",
      visitTime: 13_348_638_250_000_000n,
      fromVisit: 0n,
      transition: 1n,
      duration: 300n,
    },
    {
      id: 4n,
      urlId: 40n,
      url: "https://url-deleted.example/",
      title: "URL deleted",
      visitTime: 13_348_638_251_000_000n,
      fromVisit: 0n,
      transition: 1n,
      duration: 400n,
      source: 2n,
    },
  ]);
  const writer = new DatabaseSync(historyPath);
  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  writer
    .prepare("UPDATE urls SET title = ? WHERE id = ?")
    .run("URL changed in WAL", 10n);
  writer
    .prepare("UPDATE visits SET visit_duration = ? WHERE id = ?")
    .run(333n, 3n);
  writer.prepare("DELETE FROM urls WHERE id = ?").run(40n);
  writer.prepare("DELETE FROM visit_source WHERE id = ?").run(4n);
  writer
    .prepare(
      `INSERT INTO urls
         (id, url, title, visit_count, typed_count, last_visit_time, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      20n,
      "https://wal.example/",
      "WAL resident",
      1,
      0,
      13_348_638_305_456_000n,
      0,
    );
  writer
    .prepare(
      `INSERT INTO visits
         (id, url, visit_time, from_visit, external_referrer_url, transition,
          segment_id, visit_duration, incremented_omnibox_typed_score,
          opener_visit, originator_cache_guid, originator_visit_id,
          originator_from_visit, originator_opener_visit, is_known_to_sync,
          consider_for_ntp_most_visited, visited_link_id, app_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      2n,
      20n,
      13_348_638_305_456_000n,
      1n,
      "",
      0x60000000n,
      0n,
      200n,
      0,
      0n,
      "",
      0n,
      0n,
      0n,
      0,
      1,
      0n,
      null,
    );
  return { source, writer };
}

async function createHotJournalSource(root: string): Promise<{
  readonly source: string;
  readonly writer: ChildProcess;
}> {
  const source = join(root, "journal-source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  const rows = Array.from({ length: 300 }, (_, index) => {
    const id = BigInt(index + 1);
    return {
      id,
      urlId: id + 1000n,
      url:
        index === 0
          ? "https://journal-target.example/"
          : `https://filler-${index}.example/${"x".repeat(900)}`,
      title: index === 0 ? "Journal target" : `Filler ${index}`,
      visitTime: 13_348_638_245_123_456n + id,
      fromVisit: 0n,
      transition: 1n,
      duration: id,
    };
  });
  const historyPath = join(source, "Default", "History");
  await createHistory(historyPath, rows);
  const childCode = `
    import { DatabaseSync } from "node:sqlite";
    const database = new DatabaseSync(process.argv[1]);
    database.exec("PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; PRAGMA cache_spill=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;");
    database.prepare("DELETE FROM visits WHERE id = 1").run();
    database.prepare("DELETE FROM urls WHERE id = 1001").run();
    const update = database.prepare("UPDATE visits SET app_id = ? WHERE id = ?");
    for (let id = 2; id <= 300; id += 1) {
      update.run("changed-" + "y".repeat(1000), id);
    }
    process.stdout.write("READY\\n");
    setInterval(() => undefined, 1000);
  `;
  const writer = spawn(
    process.execPath,
    ["--input-type=module", "-e", childCode, historyPath],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  if (writer.stdout === null) {
    throw new Error("Hot-journal writer has no stdout.");
  }
  let output = "";
  for await (const chunk of writer.stdout) {
    output += String(chunk);
    if (output.includes("READY")) {
      break;
    }
  }
  if (!output.includes("READY")) {
    throw new Error(
      "Hot-journal writer stopped before the transaction spilled.",
    );
  }
  return { source, writer };
}

async function stopHotJournalWriter(writer: ChildProcess): Promise<void> {
  if (writer.exitCode !== null || writer.signalCode !== null) {
    return;
  }
  writer.kill("SIGKILL");
  await once(writer, "exit");
}

async function createLegacyHistorySource(root: string): Promise<string> {
  const source = join(root, "legacy-source");
  await mkdir(join(source, "Default"), { recursive: true });
  await writeLocalState(source);
  const database = new DatabaseSync(join(source, "Default", "History"));
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '16'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url LONGVARCHAR,
        title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY,
        url INTEGER NOT NULL,
        visit_time INTEGER NOT NULL,
        from_visit INTEGER,
        transition INTEGER DEFAULT 0 NOT NULL,
        segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL
      );
      INSERT INTO urls VALUES (
        1, 'https://legacy.example/', 'Legacy', 1, 0,
        1704164645123456, 0
      );
      INSERT INTO visits VALUES (
        1, 1, 1704164645123456, 0, 1, 0, 42, 0
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

describe("compiled analyzer CLI History Finding pipeline", () => {
  it("analyses committed History across Profiles and returns bounded keyset pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-history-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const sourceHistoryBytes = await readFile(
      join(source, "Default", "History"),
    );
    const caseDirectory = join(root, "CASE-HISTORY");

    const ingest = runCli([
      "ingest",
      source,
      "--case",
      caseDirectory,
      "--json",
    ]);
    expect(ingest.status).toBe(0);

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
      status: "verified",
      command: "analyse",
      analysisStatus: "ready",
      artifactCount: 2,
      history: {
        status: "complete",
        profileCount: 2,
        committedVisitCount: 3,
        recoveredVisitCount: 0,
      },
    });

    const firstCommand = runCli([
      "history",
      "--case",
      caseDirectory,
      "--view",
      "visits",
      "--sort",
      "visit-time",
      "--direction",
      "asc",
      "--limit",
      "2",
      "--json",
    ]);
    expect(firstCommand.status).toBe(0);
    const first = parseJson<HistoryPage>(firstCommand.stdout);
    expect(first).toMatchObject({
      status: "ok",
      command: "history",
      view: "visits",
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items.map((row) => row.profile)).toEqual([
      "Default",
      "Default",
    ]);

    const [start, redirected] = first.items;
    expect(start).toBeDefined();
    expect(start).toMatchObject({
      recordType: "finding",
      findingKind: "history_visit",
      profile: "Default",
      commitState: "committed",
      provenance: {
        sourceId: expect.any(String),
        manifestEntryId: expect.any(String),
        manifestEntryOrdinal: expect.any(Number),
        manifestPath: "Default/History",
        database: "Default/History",
        table: "visits",
        rowId: "1",
      },
      fields: {
        visitId: { state: "value", value: "1" },
        url: { state: "value", value: "https://alpha.example/start" },
        title: { state: "value", value: "Alpha start" },
        visitTime: {
          state: "value",
          value: {
            raw: "13348638245123456",
            epochFamily: "1601-us",
            utc: "2024-01-02T03:04:05.123456Z",
            declaredTimezone: "America/New_York",
            resolution: "verified_schema_version_70",
          },
          synthetic: false,
        },
        fromVisit: { state: "value", value: "0" },
        externalReferrerUrl: { state: "value", value: "" },
        transitionRaw: { state: "value", value: "268435457" },
        transitionCore: { state: "value", value: "typed" },
        transitionQualifiers: {
          state: "value",
          value: ["chain_start"],
        },
        redirectToVisitIds: { state: "value", value: ["2"] },
        visitSource: { state: "value", value: "browsed" },
        visitDurationMicros: { state: "value", value: "2500000" },
        originatorCacheGuid: {
          state: "value",
          value: "origin-cache-guid",
        },
        appId: { state: "value", value: "com.example.browser" },
      },
    });
    expect(redirected?.fields).toMatchObject({
      redirectFromVisitId: { state: "value", value: "1" },
      transitionCore: { state: "value", value: "link" },
      transitionQualifiers: {
        state: "value",
        value: ["chain_end", "client_redirect"],
      },
      visitSource: { state: "value", value: "extension" },
    });

    const secondCommand = runCli([
      "history",
      "--case",
      caseDirectory,
      "--view",
      "visits",
      "--sort",
      "visit-time",
      "--direction",
      "asc",
      "--limit",
      "2",
      "--after",
      first.nextCursor as string,
      "--json",
    ]);
    expect(secondCommand.status).toBe(0);
    const second = parseJson<HistoryPage>(secondCommand.stdout);
    expect(second.items.map((row) => row.profile)).toEqual(["Profile 1"]);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.items, ...second.items].map((row) => row.provenance.rowId),
      ).size,
    ).toBe(3);

    const filtered = runCli([
      "history",
      "--case",
      caseDirectory,
      "--view",
      "visits",
      "--profile",
      "Default",
      "--profile",
      "Profile 1",
      "--commit-state",
      "committed",
      "--search",
      "beta.example",
      "--sort",
      "url",
      "--direction",
      "asc",
      "--limit",
      "10",
      "--json",
    ]);
    expect(filtered.status).toBe(0);
    expect(parseJson<HistoryPage>(filtered.stdout).items).toMatchObject([
      {
        recordType: "finding",
        profile: "Profile 1",
        fields: {
          url: { state: "value", value: "https://beta.example/" },
        },
      },
    ]);

    const microsecondRange = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--search",
        "alpha.example",
        "--from",
        "2024-01-02T03:04:05.123Z",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(microsecondRange.items).toHaveLength(2);

    const exactMicrosecondRange = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--search",
        "alpha.example",
        "--from",
        "2024-01-02T03:04:05.123456Z",
        "--to",
        "2024-01-02T03:04:05.123456Z",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(exactMicrosecondRange.items).toHaveLength(1);
    expect(exactMicrosecondRange.items[0]?.provenance.rowId).toBe("1");

    const timezoneLess = runCli([
      "history",
      "--case",
      caseDirectory,
      "--from",
      "2024-01-02T03:04:05",
      "--limit",
      "10",
      "--json",
    ]);
    expect(timezoneLess.status).toBe(1);
    expect(
      parseJson<Record<string, unknown>>(timezoneLess.stderr),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });

    const invalidCalendar = runCli([
      "history",
      "--case",
      caseDirectory,
      "--from",
      "2024-02-30T03:04:05Z",
      "--limit",
      "10",
      "--json",
    ]);
    expect(invalidCalendar.status).toBe(1);
    expect(
      parseJson<Record<string, unknown>>(invalidCalendar.stderr),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });

    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const staleCursor = runCli([
      "history",
      "--case",
      caseDirectory,
      "--view",
      "visits",
      "--sort",
      "visit-time",
      "--direction",
      "asc",
      "--limit",
      "2",
      "--after",
      first.nextCursor as string,
      "--json",
    ]);
    expect(staleCursor.status).toBe(1);
    expect(
      parseJson<Record<string, unknown>>(staleCursor.stderr),
    ).toMatchObject({ code: "INVALID_CURSOR" });

    expect(await readFile(join(source, "Default", "History"))).toEqual(
      sourceHistoryBytes,
    );
  });

  it("returns auditable activity, most-visited, and duration summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-history-summary-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const caseDirectory = join(root, "CASE-SUMMARY");
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

    const activity = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--view",
        "activity",
        "--sort",
        "local-time",
        "--direction",
        "asc",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(activity.items[0]?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "visits", rowId: "2" }),
        expect.objectContaining({ table: "urls", rowId: "10" }),
        expect.objectContaining({ table: "urls", rowId: "11" }),
        expect.objectContaining({ table: "visit_source", rowId: "2" }),
      ]),
    );
    expect(activity.items[0]).toMatchObject({
      recordType: "finding",
      findingKind: "history_activity_summary",
      profile: "Default",
      commitState: "committed",
      fields: {
        localDate: { state: "value", value: "2024-01-01" },
        localHour: { state: "value", value: "22" },
        declaredTimezone: {
          state: "value",
          value: "America/New_York",
        },
        supportingVisitCount: { state: "value", value: "2" },
        visitsWithDurationCount: { state: "value", value: "2" },
        visitsWithoutDurationCount: { state: "value", value: "0" },
        totalDurationMicros: { state: "value", value: "7500000" },
      },
    });
    const mostVisited = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--view",
        "most-visited",
        "--search",
        "redirected",
        "--sort",
        "visit-count",
        "--direction",
        "desc",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(mostVisited.items).toMatchObject([
      {
        recordType: "finding",
        findingKind: "history_most_visited_summary",
        fields: {
          url: {
            state: "value",
            value: "https://alpha.example/redirected",
          },
          supportingVisitCount: { state: "value", value: "1" },
        },
      },
    ]);

    const durations = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--view",
        "durations",
        "--profile",
        "Default",
        "--sort",
        "duration",
        "--direction",
        "desc",
        "--limit",
        "1",
        "--json",
      ]).stdout,
    );
    expect(durations.items).toHaveLength(1);
    expect(durations.items[0]).toMatchObject({
      recordType: "finding",
      findingKind: "history_duration_summary",
      fields: {
        supportingVisitCount: { state: "value", value: "1" },
        visitsWithDurationCount: { state: "value", value: "1" },
        visitsWithoutDurationCount: { state: "value", value: "0" },
        totalDurationMicros: { state: "value", value: "5000000" },
        averageDurationMicros: { state: "value", value: "5000000" },
      },
    });
    expect(durations.nextCursor).not.toBeNull();
    const decodedCursor = JSON.parse(
      Buffer.from(durations.nextCursor as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const oversizedCursor = Buffer.from(
      JSON.stringify({ ...decodedCursor, key: "9223372036854775808" }),
      "utf8",
    ).toString("base64url");
    const oversized = runCli([
      "history",
      "--case",
      caseDirectory,
      "--view",
      "durations",
      "--profile",
      "Default",
      "--sort",
      "duration",
      "--direction",
      "desc",
      "--limit",
      "1",
      "--after",
      oversizedCursor,
      "--json",
    ]);
    expect(oversized.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(oversized.stderr)).toMatchObject({
      code: "INVALID_CURSOR",
    });
  });

  it("keeps WAL-resident visits separate with sidecar Provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-history-wal-"));
    temporaryRoots.push(root);
    const { source, writer } = await createWalSource(root);
    const caseDirectory = join(root, "CASE-WAL");
    try {
      const ingest = runCli([
        "ingest",
        source,
        "--case",
        caseDirectory,
        "--json",
      ]);
      expect(ingest.status).toBe(0);
    } finally {
      writer.close();
    }

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      history: {
        committedVisitCount: 3,
        recoveredVisitCount: 4,
        candidateCount: 0,
      },
    });

    const committed = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "committed",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(committed.items).toHaveLength(3);
    const committedParent = committed.items.find(
      (item) => item.provenance.rowId === "1",
    );
    expect(committedParent?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifestPath: "Default/History-wal",
          table: "visits",
          rowId: "2",
        }),
      ]),
    );
    expect(committedParent).toMatchObject({
      commitState: "committed",
      provenance: { manifestPath: "Default/History" },
      fields: {
        url: { state: "value", value: "https://committed.example/" },
        redirectToVisitIds: { state: "value", value: ["2"] },
      },
    });

    const recovered = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--search",
        "wal.example",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(recovered.items).toHaveLength(1);
    expect(recovered.items[0]).toMatchObject({
      commitState: "wal_resident",
      provenance: {
        manifestPath: "Default/History-wal",
        database: "Default/History",
        table: "visits",
        rowId: "2",
      },
      fields: {
        url: { state: "value", value: "https://wal.example/" },
        redirectFromVisitId: { state: "value", value: "1" },
      },
    });
    expect(recovered.items[0]?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifestPath: "Default/History-wal",
          table: "urls",
          rowId: "20",
        }),
      ]),
    );
    const recoveredProvenanceKeys = (
      recovered.items[0]?.provenance.supportingRows ?? []
    ).map(
      (row) =>
        `${row.manifestEntryId}:${row.database}:${row.table}:${row.rowId}`,
    );
    expect(new Set(recoveredProvenanceKeys).size).toBe(
      recoveredProvenanceKeys.length,
    );

    const urlOnly = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--search",
        "url changed in wal",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(urlOnly.items).toHaveLength(1);
    expect(urlOnly.items[0]).toMatchObject({
      provenance: {
        manifestPath: "Default/History",
        table: "visits",
        rowId: "1",
      },
      fields: { title: { state: "value", value: "URL changed in WAL" } },
    });
    expect(urlOnly.items[0]?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifestPath: "Default/History-wal",
          table: "urls",
          rowId: "10",
        }),
      ]),
    );

    const visitOnly = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--search",
        "visit-update.example",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(visitOnly.items).toHaveLength(1);
    expect(visitOnly.items[0]).toMatchObject({
      provenance: {
        manifestPath: "Default/History-wal",
        table: "visits",
        rowId: "3",
      },
      fields: { visitDurationMicros: { state: "value", value: "333" } },
    });
    expect(visitOnly.items[0]?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifestPath: "Default/History",
          table: "urls",
          rowId: "30",
        }),
      ]),
    );

    const deletedJoinedRows = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--sort",
        "visit-time",
        "--direction",
        "asc",
        "--limit",
        "100",
        "--json",
      ]).stdout,
    ).items.find((item) => item.provenance.rowId === "4");
    expect(deletedJoinedRows).toMatchObject({
      provenance: {
        manifestPath: "Default/History",
        table: "visits",
        rowId: "4",
      },
      fields: {
        url: { state: "unavailable", reason: "related_row_missing" },
        visitSource: { state: "value", value: "browsed" },
      },
    });
    expect(deletedJoinedRows?.provenance.supportingRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifestPath: "Default/History-wal",
          table: "urls",
          rowId: "40",
        }),
        expect.objectContaining({
          manifestPath: "Default/History-wal",
          table: "visit_source",
          rowId: "4",
        }),
      ]),
    );
    // Same headroom as the rollback-journal test: the read-write recovery pass
    // checkpoints a hot WAL on a freshly-copied snapshot, which Windows CI can
    // transiently refuse and retry (see openDatabaseSync). Finite, not
    // disabled: a genuine hang still fails within this ceiling.
  }, 60_000);

  it("recovers rollback-journal rows without merging their Commit State", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-history-journal-"));
    temporaryRoots.push(root);
    const { source, writer } = await createHotJournalSource(root);
    const caseDirectory = join(root, "CASE-JOURNAL");
    try {
      const ingest = runCli([
        "ingest",
        source,
        "--case",
        caseDirectory,
        "--json",
      ]);
      expect(ingest.status).toBe(0);
    } finally {
      await stopHotJournalWriter(writer);
    }

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      history: {
        committedVisitCount: expect.any(Number),
        recoveredVisitCount: 300,
        candidateCount: 0,
      },
    });

    const committed = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "committed",
        "--search",
        "journal-target",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(committed.items).toHaveLength(0);

    const recovered = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--commit-state",
        "journal_resident",
        "--search",
        "journal-target",
        "--limit",
        "10",
        "--json",
      ]).stdout,
    );
    expect(recovered.items).toHaveLength(1);
    expect(recovered.items[0]).toMatchObject({
      recordType: "finding",
      commitState: "journal_resident",
      provenance: {
        manifestPath: "Default/History-journal",
        database: "Default/History",
        table: "visits",
        rowId: "1",
      },
      fields: {
        url: {
          state: "value",
          value: "https://journal-target.example/",
        },
      },
    });
    // Finite (not disabled): the compiled CLI opens a freshly-copied working
    // snapshot that still carries a hot rollback journal while a live writer
    // holds the source. On Windows CI the open can be transiently refused and
    // retried (see openDatabaseSync), so allow more headroom than the 30s
    // default while still failing a genuine hang.
  }, 60_000);

  it("requires Declared Origin OS for version-16 epochs without creating Candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-history-origin-"));
    temporaryRoots.push(root);
    const source = await createLegacyHistorySource(root);
    const caseDirectory = join(root, "CASE-ORIGIN");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const withoutOrigin = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--json",
    ]);
    expect(withoutOrigin.status).toBe(0);
    expect(
      parseJson<Record<string, unknown>>(withoutOrigin.stdout),
    ).toMatchObject({
      history: { candidateCount: 0, declaredOriginOs: null },
    });
    const unavailableTimestamp = parseJson<HistoryPage>(
      runCli(["history", "--case", caseDirectory, "--limit", "10", "--json"])
        .stdout,
    );
    expect(unavailableTimestamp.items[0]).toMatchObject({
      recordType: "finding",
      fields: {
        visitTime: {
          state: "unavailable",
          reason: "epoch_requires_declared_origin_os",
        },
        externalReferrerUrl: { state: "absent" },
        appId: { state: "absent" },
      },
    });

    const withOrigin = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--origin-os",
      "linux",
      "--timezone",
      "UTC",
      "--json",
    ]);
    expect(withOrigin.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(withOrigin.stdout)).toMatchObject(
      {
        history: { candidateCount: 0, declaredOriginOs: "linux" },
      },
    );
    const resolvedTimestamp = parseJson<HistoryPage>(
      runCli(["history", "--case", caseDirectory, "--limit", "10", "--json"])
        .stdout,
    );
    expect(resolvedTimestamp.items).toHaveLength(1);
    expect(resolvedTimestamp.items[0]).toMatchObject({
      recordType: "finding",
      fields: {
        visitTime: {
          state: "value",
          value: {
            raw: "1704164645123456",
            epochFamily: "unix-us",
            utc: "2024-01-02T03:04:05.123456Z",
            declaredTimezone: "UTC",
            resolution: "verified_schema_version_16_declared_origin_os_linux",
          },
          synthetic: false,
        },
      },
    });

    const caseDatabase = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readBigInts: true,
    });
    try {
      expect(
        caseDatabase
          .prepare("SELECT count(*) AS count FROM analysis_runs")
          .get(),
      ).toEqual({ count: 2n });
      expect(
        caseDatabase
          .prepare("SELECT count(*) AS count FROM forensic_candidates")
          .get(),
      ).toEqual({ count: 0n });
      expect(
        caseDatabase
          .prepare(
            "SELECT count(*) AS count FROM history_artifact_results WHERE active = 1",
          )
          .get(),
      ).toEqual({ count: 1n });
    } finally {
      caseDatabase.close();
    }
  });
});
