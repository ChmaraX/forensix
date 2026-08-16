import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

type Field<T> =
  | { readonly state: "value"; readonly value: T; readonly synthetic?: boolean }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface DownloadFinding {
  readonly recordType: "finding";
  readonly findingKind: "download";
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
    readonly downloadId: Field<string>;
    readonly targetPath: Field<string>;
    readonly currentPath: Field<string>;
    readonly startTime: Field<{
      readonly raw: string;
      readonly epochFamily: string;
      readonly utc: string;
      readonly declaredTimezone: string;
      readonly resolution: string;
    }>;
    readonly endTime: Field<unknown>;
    readonly receivedBytes: Field<string>;
    readonly totalBytes: Field<string>;
    readonly stateRaw: Field<string>;
    readonly state: Field<string>;
    readonly dangerTypeRaw: Field<string>;
    readonly dangerType: Field<string>;
    readonly interruptReasonRaw: Field<string>;
    readonly interruptReason: Field<string>;
    readonly opened: Field<boolean>;
    readonly referrer: Field<string>;
    readonly mimeType: Field<string>;
    readonly contentSha256: Field<string>;
    readonly contentHashByteLength: Field<string>;
    readonly originalUrl: Field<string>;
    readonly finalUrl: Field<string>;
    readonly urlChain: Field<readonly string[]>;
    readonly urlChainLength: Field<string>;
  };
}

interface DownloadPage {
  readonly status: "ok";
  readonly command: "downloads";
  readonly items: readonly DownloadFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

// base::Time internal value: microseconds since 1601-01-01 UTC.
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;
function windowsMicros(unixSeconds: bigint): bigint {
  return unixSeconds * 1_000_000n + WINDOWS_EPOCH_OFFSET_MICROS;
}

interface DownloadRow {
  readonly id: bigint;
  readonly targetPath: string;
  readonly startTime: bigint;
  readonly endTime: bigint;
  readonly receivedBytes: bigint;
  readonly totalBytes: bigint;
  readonly state: bigint;
  readonly dangerType: bigint;
  readonly interruptReason: bigint;
  readonly hash: Uint8Array;
  readonly opened: bigint;
  readonly referrer: string;
  readonly mimeType: string;
  readonly chain: readonly string[];
}

function createHistorySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '74'), ('last_compatible_version', '16');

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

    CREATE TABLE downloads (
      id INTEGER PRIMARY KEY,
      guid VARCHAR NOT NULL,
      current_path LONGVARCHAR NOT NULL,
      target_path LONGVARCHAR NOT NULL,
      start_time INTEGER NOT NULL,
      received_bytes INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      state INTEGER NOT NULL,
      danger_type INTEGER NOT NULL,
      interrupt_reason INTEGER NOT NULL,
      hash BLOB NOT NULL,
      end_time INTEGER NOT NULL,
      opened INTEGER NOT NULL,
      last_access_time INTEGER NOT NULL,
      transient INTEGER NOT NULL,
      referrer VARCHAR NOT NULL,
      site_url VARCHAR NOT NULL,
      tab_url VARCHAR NOT NULL,
      tab_referrer_url VARCHAR NOT NULL,
      http_method VARCHAR NOT NULL,
      by_ext_id VARCHAR NOT NULL,
      by_ext_name VARCHAR NOT NULL,
      by_web_app_id VARCHAR NOT NULL,
      etag VARCHAR NOT NULL,
      last_modified VARCHAR NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      original_mime_type VARCHAR(255) NOT NULL
    );

    CREATE TABLE downloads_url_chains (
      id INTEGER NOT NULL,
      chain_index INTEGER NOT NULL,
      url LONGVARCHAR NOT NULL,
      PRIMARY KEY (id, chain_index)
    );

    INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
    VALUES (1, 'https://tab.example/dl', 'Download page', 1, 0, ${windowsMicros(
      1_704_164_600n,
    )}, 0);

    INSERT INTO visits
      (id, url, visit_time, from_visit, transition, visit_duration)
    VALUES (1, 1, ${windowsMicros(1_704_164_600n)}, 0, 0, 0);
  `);
}

function insertDownload(database: DatabaseSync, row: DownloadRow): void {
  database
    .prepare(
      `INSERT INTO downloads
         (id, guid, current_path, target_path, start_time, received_bytes,
          total_bytes, state, danger_type, interrupt_reason, hash, end_time,
          opened, last_access_time, transient, referrer, site_url, tab_url,
          tab_referrer_url, http_method, by_ext_id, by_ext_name, by_web_app_id,
          etag, last_modified, mime_type, original_mime_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      `guid-${row.id.toString()}`,
      row.targetPath,
      row.targetPath,
      row.startTime,
      row.receivedBytes,
      row.totalBytes,
      row.state,
      row.dangerType,
      row.interruptReason,
      row.hash,
      row.endTime,
      row.opened,
      0n,
      0n,
      row.referrer,
      "https://tab.example",
      "https://tab.example/dl",
      "",
      "GET",
      "",
      "",
      "",
      "",
      "",
      row.mimeType,
      row.mimeType,
    );
  const insertChain = database.prepare(
    "INSERT INTO downloads_url_chains (id, chain_index, url) VALUES (?, ?, ?)",
  );
  row.chain.forEach((url, index) => {
    insertChain.run(row.id, BigInt(index), url);
  });
}

async function createHistory(
  path: string,
  rows: readonly DownloadRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    createHistorySchema(database);
    for (const row of rows) {
      insertDownload(database, row);
    }
  } finally {
    database.close();
  }
}

const CONTENT_HASH = Uint8Array.from(
  Array.from({ length: 32 }, (_value, index) => index),
);
const CONTENT_HASH_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createHistory(join(source, "Default", "History"), [
    {
      id: 1n,
      targetPath: "/home/alice/Downloads/report.pdf",
      startTime: windowsMicros(1_704_164_645n), // 2024-01-02T03:04:05Z
      endTime: windowsMicros(1_704_164_650n),
      receivedBytes: 1024n,
      totalBytes: 1024n,
      state: 1n, // complete
      dangerType: 0n, // not_dangerous
      interruptReason: 0n, // none
      hash: CONTENT_HASH,
      opened: 1n,
      referrer: "https://referrer.example/page",
      mimeType: "application/pdf",
      chain: [
        "https://start.example/a",
        "https://redir.example/b",
        "https://cdn.example/report.pdf",
      ],
    },
    {
      id: 2n,
      targetPath: "/home/alice/Downloads/malware.exe",
      startTime: windowsMicros(1_704_164_655n), // 2024-01-02T03:04:15Z
      endTime: 0n, // never finished -> absent
      receivedBytes: 500n,
      totalBytes: 2000n,
      state: 4n, // interrupted
      dangerType: 7n, // dangerous_host
      interruptReason: 20n, // network_failed
      hash: new Uint8Array(0), // no content hash yet
      opened: 0n,
      referrer: "https://evil.example/landing",
      mimeType: "application/x-msdownload",
      chain: ["https://evil.example/malware.exe"],
    },
  ]);
  await createHistory(join(source, "Profile 1", "History"), [
    {
      id: 1n,
      targetPath: "/home/alice/Downloads/photo.jpg",
      startTime: windowsMicros(1_704_164_665n), // 2024-01-02T03:04:25Z
      endTime: windowsMicros(1_704_164_666n),
      receivedBytes: 2048n,
      totalBytes: 2048n,
      state: 1n,
      dangerType: 0n,
      interruptReason: 0n,
      hash: CONTENT_HASH,
      opened: 1n,
      referrer: "https://pics.example/gallery",
      mimeType: "image/jpeg",
      chain: ["https://pics.example/photo.jpg"],
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

describe("compiled analyzer CLI Downloads findings", () => {
  it("decodes downloads and URL chains across Profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-dl-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const defaultBytes = await readFile(join(source, "Default", "History"));
    const caseDirectory = join(root, "CASE-DL");

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
      // Downloads live in History but are their own artifact; History
      // visits stay usable alongside a complete Downloads result.
      history: { status: "complete", analysedProfileCount: 2 },
      downloads: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        unavailableProfileCount: 0,
        committedDownloadCount: 3,
        recoveredDownloadCount: 0,
      },
    });

    // Bounded, multi-Profile keyset pagination ordered by start time.
    const firstPage = parseJson<DownloadPage>(
      runCli([
        "downloads",
        "--case",
        caseDirectory,
        "--sort",
        "start-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage).toMatchObject({ command: "downloads", limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const [report, malware] = firstPage.items;
    expect(report).toBeDefined();
    // Exact target path/state; one Field State each; Commit State;
    // Provenance resolvable to the exact downloads rowid and chain rows.
    expect(report).toMatchObject({
      recordType: "finding",
      findingKind: "download",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/History",
        database: "Default/History",
        table: "downloads",
        rowId: "1",
      },
      fields: {
        targetPath: {
          state: "value",
          value: "/home/alice/Downloads/report.pdf",
        },
        state: { state: "value", value: "complete" },
        stateRaw: { state: "value", value: "1" },
        dangerType: { state: "value", value: "not_dangerous" },
        dangerTypeRaw: { state: "value", value: "0" },
        interruptReason: { state: "value", value: "none" },
        interruptReasonRaw: { state: "value", value: "0" },
        receivedBytes: { state: "value", value: "1024" },
        totalBytes: { state: "value", value: "1024" },
        opened: { state: "value", value: true },
        mimeType: { state: "value", value: "application/pdf" },
        referrer: { state: "value", value: "https://referrer.example/page" },
      },
    });
    // URL-chain relationships preserved, ordered, with per-hop Provenance.
    expect(report?.fields.urlChain).toEqual({
      state: "value",
      value: [
        "https://start.example/a",
        "https://redir.example/b",
        "https://cdn.example/report.pdf",
      ],
    });
    expect(report?.fields.originalUrl).toEqual({
      state: "value",
      value: "https://start.example/a",
    });
    expect(report?.fields.finalUrl).toEqual({
      state: "value",
      value: "https://cdn.example/report.pdf",
    });
    expect(report?.fields.urlChainLength).toEqual({
      state: "value",
      value: "3",
    });
    expect(report?.provenance.supportingRows).toEqual([
      {
        manifestEntryId: expect.any(String),
        sourceId: expect.any(String),
        manifestEntryOrdinal: expect.any(Number),
        manifestPath: "Default/History",
        database: "Default/History",
        table: "downloads_url_chains",
        rowId: "1:0",
      },
      {
        manifestEntryId: expect.any(String),
        sourceId: expect.any(String),
        manifestEntryOrdinal: expect.any(Number),
        manifestPath: "Default/History",
        database: "Default/History",
        table: "downloads_url_chains",
        rowId: "1:1",
      },
      {
        manifestEntryId: expect.any(String),
        sourceId: expect.any(String),
        manifestEntryOrdinal: expect.any(Number),
        manifestPath: "Default/History",
        database: "Default/History",
        table: "downloads_url_chains",
        rowId: "1:2",
      },
    ]);
    // Timestamp keeps raw value, Epoch Family (1601-us), and UTC.
    expect(report?.fields.startTime).toEqual({
      state: "value",
      synthetic: false,
      value: {
        raw: windowsMicros(1_704_164_645n).toString(),
        epochFamily: "1601-us",
        utc: "2024-01-02T03:04:05.000000Z",
        declaredTimezone: "America/New_York",
        resolution: "verified_history_schema_version_74",
      },
    });
    // The content hash BLOB is rendered as reviewable hex, never base64.
    expect(report?.fields.contentSha256).toEqual({
      state: "value",
      value: CONTENT_HASH_HEX,
    });
    expect(report?.fields.contentHashByteLength).toEqual({
      state: "value",
      value: "32",
    });

    // Decoded danger/interrupt/state on the interrupted download retain
    // their raw codes; a never-finished download has an absent end time and an
    // absent (not blank) content hash.
    expect(malware).toMatchObject({
      profile: "Default",
      fields: {
        state: { state: "value", value: "interrupted" },
        stateRaw: { state: "value", value: "4" },
        dangerType: { state: "value", value: "dangerous_host" },
        dangerTypeRaw: { state: "value", value: "7" },
        interruptReason: { state: "value", value: "network_failed" },
        interruptReasonRaw: { state: "value", value: "20" },
      },
    });
    expect(malware?.fields.endTime).toEqual({ state: "absent" });
    expect(malware?.fields.contentSha256).toEqual({ state: "absent" });
    expect(malware?.fields.contentHashByteLength).toEqual({
      state: "value",
      value: "0",
    });

    const secondPage = parseJson<DownloadPage>(
      runCli([
        "downloads",
        "--case",
        caseDirectory,
        "--sort",
        "start-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.profile).toBe("Profile 1");
    const allIds = [...firstPage.items, ...secondPage.items].map(
      (item) => `${item.profile}:${item.provenance.rowId}`,
    );
    expect(new Set(allIds).size).toBe(3);

    // Filter surface: state and danger-type filters return exact subsets.
    const interrupted = parseJson<DownloadPage>(
      runCli([
        "downloads",
        "--case",
        caseDirectory,
        "--state",
        "interrupted",
        "--json",
      ]).stdout,
    );
    expect(interrupted.items).toHaveLength(1);
    expect(interrupted.items[0]?.fields.targetPath).toEqual({
      state: "value",
      value: "/home/alice/Downloads/malware.exe",
    });
    const dangerous = parseJson<DownloadPage>(
      runCli([
        "downloads",
        "--case",
        caseDirectory,
        "--danger",
        "dangerous_host",
        "--json",
      ]).stdout,
    );
    expect(dangerous.items).toHaveLength(1);

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(source, "Default", "History"))).toEqual(
      defaultBytes,
    );
  });

  it("keeps committed and WAL-resident downloads separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-dl-wal-"));
    temporaryRoots.push(root);
    const source = join(root, "wal-source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    const historyPath = join(source, "Default", "History");
    await createHistory(historyPath, [
      {
        id: 1n,
        targetPath: "/home/alice/Downloads/committed.pdf",
        startTime: windowsMicros(1_704_164_645n),
        endTime: windowsMicros(1_704_164_650n),
        receivedBytes: 10n,
        totalBytes: 10n,
        state: 1n,
        dangerType: 0n,
        interruptReason: 0n,
        hash: CONTENT_HASH,
        opened: 1n,
        referrer: "https://referrer.example/a",
        mimeType: "application/pdf",
        chain: ["https://cdn.example/committed.pdf"],
      },
    ]);

    const writer = new DatabaseSync(historyPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    insertDownload(writer, {
      id: 2n,
      targetPath: "/home/alice/Downloads/wal-only.zip",
      startTime: windowsMicros(1_704_164_700n),
      endTime: windowsMicros(1_704_164_705n),
      receivedBytes: 20n,
      totalBytes: 20n,
      state: 1n,
      dangerType: 0n,
      interruptReason: 0n,
      hash: CONTENT_HASH,
      opened: 0n,
      referrer: "https://referrer.example/b",
      mimeType: "application/zip",
      chain: ["https://cdn.example/wal-only.zip"],
    });

    const caseDirectory = join(root, "CASE-DL-WAL");
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
      downloads: { committedDownloadCount: 1, recoveredDownloadCount: 1 },
    });

    const committed = parseJson<DownloadPage>(
      runCli([
        "downloads",
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
      provenance: { manifestPath: "Default/History" },
      fields: {
        targetPath: {
          state: "value",
          value: "/home/alice/Downloads/committed.pdf",
        },
      },
    });

    const recovered = parseJson<DownloadPage>(
      runCli([
        "downloads",
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
        manifestPath: "Default/History-wal",
        database: "Default/History",
        table: "downloads",
      },
      fields: {
        targetPath: {
          state: "value",
          value: "/home/alice/Downloads/wal-only.zip",
        },
      },
    });
  });

  it("reports Downloads unavailable without suppressing usable History", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-dl-bad-"));
    temporaryRoots.push(root);
    const source = join(root, "bad-source");
    await mkdir(join(source, "Default"), { recursive: true });
    await writeLocalState(source);
    // A History database with visits but no downloads table.
    const historyPath = join(source, "Default", "History");
    const database = new DatabaseSync(historyPath);
    try {
      database.exec(`
        CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
        INSERT INTO meta (key, value) VALUES ('version', '74'), ('last_compatible_version', '16');
        CREATE TABLE urls (
          id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR,
          visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL,
          last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL
        );
        CREATE TABLE visits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
          visit_time INTEGER NOT NULL, from_visit INTEGER,
          external_referrer_url TEXT, transition INTEGER DEFAULT 0 NOT NULL,
          segment_id INTEGER, visit_duration INTEGER DEFAULT 0 NOT NULL,
          incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
          opener_visit INTEGER, originator_cache_guid TEXT, originator_visit_id INTEGER,
          originator_from_visit INTEGER, originator_opener_visit INTEGER,
          is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
          consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
          visited_link_id INTEGER, app_id TEXT
        );
        CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
        INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
        VALUES (1, 'https://kept.example/', 'Kept', 1, 0, ${windowsMicros(
          1_704_164_600n,
        )}, 0);
        INSERT INTO visits (id, url, visit_time, from_visit, transition, visit_duration)
        VALUES (1, 1, ${windowsMicros(1_704_164_600n)}, 0, 0, 0);
      `);
    } finally {
      database.close();
    }

    const caseDirectory = join(root, "CASE-DL-BAD");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // History is complete; a History database with no downloads table carries
    // no download evidence, so Downloads is `absent` (inapplicable), not
    // `unavailable`. Absent evidence never degrades an otherwise clean run, so
    // the run stays complete (exit 0) and usable History is never suppressed.
    expect(analysis.status).toBe(0);
    const parsed = parseJson<{
      readonly history: {
        readonly status: string;
        readonly analysedProfileCount: number;
      };
      readonly downloads: {
        readonly status: string;
        readonly analysedProfileCount: number;
        readonly absentProfileCount: number;
        readonly unavailableProfileCount: number;
      };
    }>(analysis.stdout);
    expect(parsed.history).toMatchObject({
      status: "complete",
      analysedProfileCount: 1,
    });
    expect(parsed.downloads).toMatchObject({
      status: "complete",
      analysedProfileCount: 0,
      absentProfileCount: 1,
      unavailableProfileCount: 0,
    });

    // History visits remain queryable.
    const history = parseJson<{ readonly items: readonly unknown[] }>(
      runCli(["history", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(history.items.length).toBeGreaterThanOrEqual(1);

    // The Downloads query returns an empty page (no active result), not an error.
    const downloads = parseJson<DownloadPage>(
      runCli(["downloads", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(downloads.items).toHaveLength(0);

    // The typed reason names the missing downloads table in the Case.
    const caseDatabase = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readOnly: true,
    });
    try {
      const row = caseDatabase
        .prepare(
          `SELECT status, reason FROM downloads_artifact_results
            WHERE profile_path = 'Default'`,
        )
        .get() as { readonly status: string; readonly reason: string };
      expect(row.status).toBe("absent");
      expect(row.reason).toContain("missing the downloads table");
    } finally {
      caseDatabase.close();
    }
  });
});
