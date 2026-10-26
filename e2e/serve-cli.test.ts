import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { compiledCli, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];
const runningServers: ChildProcessWithoutNullStreams[] = [];

interface Announcement {
  readonly status: "ok";
  readonly command: "serve";
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

interface FieldState {
  readonly state: "value" | "absent" | "unavailable";
  readonly value?: unknown;
  readonly reason?: string;
}

interface Finding {
  readonly recordType: "finding";
  readonly findingKind: string;
  readonly profile: string;
  readonly commitState: string;
  readonly fields: Readonly<Record<string, FieldState>>;
}

interface Page {
  readonly status: "ok";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

function rawGet(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<number> {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolvePromise(response.statusCode ?? 0);
        });
      },
    );
    request.on("error", rejectPromise);
    request.end();
  });
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
        url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
        from_visit INTEGER, external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER, originator_cache_guid TEXT,
        originator_visit_id INTEGER, originator_from_visit INTEGER,
        originator_opener_visit INTEGER,
        is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER, app_id TEXT
      );
      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      CREATE TABLE segments (id INTEGER PRIMARY KEY, name VARCHAR, url_id INTEGER NON NULL);
      CREATE TABLE segment_usage (
        id INTEGER PRIMARY KEY, segment_id INTEGER NOT NULL,
        time_slot INTEGER NOT NULL, visit_count INTEGER DEFAULT 0 NOT NULL
      );
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
      INSERT INTO downloads
        (id, guid, current_path, target_path, start_time, received_bytes,
         total_bytes, state, danger_type, interrupt_reason, hash, end_time,
         opened, last_access_time, transient, referrer, site_url, tab_url,
         tab_referrer_url, http_method, by_ext_id, by_ext_name, by_web_app_id,
         etag, last_modified, mime_type, original_mime_type)
      VALUES (
        1, 'guid-1', '/home/alice/Downloads/report.pdf',
        '/home/alice/Downloads/report.pdf', 13348638245123456, 1024, 1024,
        1, 0, 0, x'00', 13348638255123456, 0, 0, 0, '', 'https://alpha.example',
        'https://alpha.example/report.pdf', '', 'GET', '', '', '', '', '',
        'application/pdf', 'application/pdf'
      );
      INSERT INTO downloads_url_chains (id, chain_index, url)
      VALUES (1, 0, 'https://alpha.example/report.pdf');
    `);
    const insertUrl = database.prepare(
      `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
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
    for (const row of rows) {
      insertUrl.run(row.urlId, row.url, row.title, 1, 1, row.visitTime, 0);
      insertVisit.run(
        row.id,
        row.urlId,
        row.visitTime,
        row.fromVisit,
        "",
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
    }
  } finally {
    database.close();
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Minimal single-row `autofill` table for the `Web Data` database. */
function createWebDataDatabase(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '133'), ('last_compatible_version', '83');
      CREATE TABLE autofill (
        name VARCHAR,
        value VARCHAR,
        value_lower VARCHAR,
        date_created INTEGER DEFAULT 0,
        date_last_used INTEGER DEFAULT 0,
        count INTEGER DEFAULT 1,
        PRIMARY KEY (name, value)
      );
      INSERT INTO autofill (name, value, value_lower, date_created, date_last_used, count)
      VALUES ('email', 'ada@example.com', 'ada@example.com', 1704164645, 1704164645, 1);
    `);
  } finally {
    database.close();
  }
}

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
      ],
    },
    other: { type: "folder", id: "2", name: "Other bookmarks", children: [] },
    synced: { type: "folder", id: "3", name: "Mobile bookmarks", children: [] },
  },
  version: 1,
};

/** A modern (version 24) Cookies database. */
function createCookies(
  path: string,
  rows: readonly { readonly host: string; readonly name: string }[],
): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '24'), ('last_compatible_version', '24');
    CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
      top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL, path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL,
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
  for (const row of rows) insertCookie(database, row);
  return database;
}

function insertCookie(
  database: DatabaseSync,
  row: { readonly host: string; readonly name: string },
): void {
  database
    .prepare(
      `INSERT INTO cookies
         (creation_utc, host_key, top_frame_site_key, name, value,
          encrypted_value, path, expires_utc, is_secure, is_httponly,
          last_access_utc)
       VALUES (13348638245123456, ?, '', ?, 'plain', x'', '/', 13400000000000000, 1, 0, 13348640000000000)`,
    )
    .run(row.host, row.name);
}

/** A version 8 Favicons database with one icon used by `pageUrls`. */
function createFavicons(
  path: string,
  icon: {
    readonly iconUrl: string;
    readonly width: number;
    readonly imageData: Uint8Array;
    readonly pageUrls: readonly string[];
  },
): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '8'), ('last_compatible_version', '1');
      CREATE TABLE favicons (id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL, icon_type INTEGER DEFAULT 0);
      CREATE TABLE favicon_bitmaps (
        id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL,
        last_updated INTEGER DEFAULT 0, image_data BLOB,
        width INTEGER DEFAULT 0, height INTEGER DEFAULT 0,
        last_requested INTEGER DEFAULT 0
      );
      CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL, icon_id INTEGER NOT NULL);
    `);
    database
      .prepare("INSERT INTO favicons (id, url, icon_type) VALUES (1, ?, 1)")
      .run(icon.iconUrl);
    database
      .prepare(
        "INSERT INTO favicon_bitmaps (icon_id, last_updated, image_data, width, height, last_requested) VALUES (1, 13348638245123456, ?, ?, ?, 13348638245123456)",
      )
      .run(icon.imageData, icon.width, icon.width);
    for (const pageUrl of icon.pageUrls)
      database
        .prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, 1)")
        .run(pageUrl);
  } finally {
    database.close();
  }
}

/** A Login Data database (version 43) holding one saved login. */
function createLoginData(path: string, originUrl: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '43'), ('last_compatible_version', '1');
      CREATE TABLE logins (
        origin_url VARCHAR NOT NULL, action_url VARCHAR,
        username_element VARCHAR, username_value VARCHAR,
        password_element VARCHAR, password_value BLOB,
        signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL,
        blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL,
        password_type INTEGER, times_used INTEGER, form_data BLOB,
        display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR,
        skip_zero_click INTEGER, generation_upload_status INTEGER,
        possible_username_pairs BLOB,
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_last_used INTEGER NOT NULL DEFAULT 0,
        moving_blocked_for BLOB,
        date_password_modified INTEGER NOT NULL DEFAULT 0,
        keychain_identifier BLOB
      );
    `);
    database
      .prepare(
        `INSERT INTO logins
           (origin_url, action_url, username_element, username_value,
            password_element, password_value, signon_realm, date_created,
            blacklisted_by_user, scheme, times_used, date_last_used)
         VALUES (?, ?, 'username', 'ada', 'password', x'763130deadbeef', ?, 13348638245123456, 0, 0, 1, 13348638245123456)`,
      )
      .run(originUrl, `${originUrl}login`, originUrl);
  } finally {
    database.close();
  }
}

/** A download whose every recorded URL is on `host` and nowhere else in
 *  the fixture. */
function addDownloadOnlyHost(historyPath: string, host: string): void {
  const database = new DatabaseSync(historyPath);
  try {
    database.exec(`
      INSERT INTO downloads
        (id, guid, current_path, target_path, start_time, received_bytes,
         total_bytes, state, danger_type, interrupt_reason, hash, end_time,
         opened, last_access_time, transient, referrer, site_url, tab_url,
         tab_referrer_url, http_method, by_ext_id, by_ext_name, by_web_app_id,
         etag, last_modified, mime_type, original_mime_type)
      VALUES (
        2, 'guid-2', '/home/alice/Downloads/tool.zip',
        '/home/alice/Downloads/tool.zip', 13361718600000000, 2048, 2048,
        1, 0, 0, x'00', 13361718610000000, 0, 0, 0, '', '', '', '', 'GET',
        '', '', '', '', '', 'application/zip', 'application/zip'
      );
      INSERT INTO downloads_url_chains (id, chain_index, url)
      VALUES (2, 0, 'https://${host}/tool.zip');
    `);
  } finally {
    database.close();
  }
}

/** The 1x1 PNG the fixture's alpha.example favicon recovers. */
const ALPHA_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
/** A host the fixture records in a download's URL chain only. */
const DOWNLOAD_ONLY_HOST = "files-only.example";

async function createSource(root: string): Promise<{
  readonly source: string;
  /** Holds the Cookies WAL open until ingest has copied it. */
  readonly cookieWriter: DatabaseSync;
}> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source, JSON.stringify({ variations_country: "us" }));
  await writeJson(join(source, "Default", "Preferences"), {
    profile: { name: "Ada" },
    account_info: [{ email: "ada@example.com", gaia: "1122334455" }],
  });
  await writeJson(join(source, "Default", "Bookmarks"), DEFAULT_BOOKMARKS);
  createWebDataDatabase(join(source, "Default", "Web Data"));
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
      url: "https://alpha.example/next",
      title: "Alpha next",
      visitTime: 13_348_638_305_456_000n,
      fromVisit: 1n,
      transition: 1n,
      duration: 5_000_000n,
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
  addDownloadOnlyHost(join(source, "Profile 1", "History"), DOWNLOAD_ONLY_HOST);
  createLoginData(
    join(source, "Default", "Login Data"),
    "https://alpha.example/",
  );
  createFavicons(join(source, "Default", "Favicons"), {
    iconUrl: "https://alpha.example/favicon.ico",
    width: 32,
    imageData: ALPHA_PNG,
    pageUrls: ["https://alpha.example/start"],
  });
  // Cookie host keys: a domain cookie (".alpha.example") and a host-only
  // cookie ("alpha.example") are one Sites host; a host-only cookie on
  // www stays its own host. One more domain cookie lives only in the WAL.
  await mkdir(join(source, "Default", "Network"), { recursive: true });
  const cookieWriter = createCookies(
    join(source, "Default", "Network", "Cookies"),
    [
      { host: ".alpha.example", name: "domain" },
      { host: "alpha.example", name: "host-only" },
      { host: "www.alpha.example", name: "www-only" },
    ],
  );
  cookieWriter.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  insertCookie(cookieWriter, { host: ".alpha.example", name: "recovered" });
  return { source, cookieWriter };
}

async function startServer(caseDirectory: string): Promise<Announcement> {
  const child = spawn(
    process.execPath,
    [compiledCli, "serve", "--case", caseDirectory, "--port", "0", "--json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  runningServers.push(child);
  let buffer = "";
  return await new Promise<Announcement>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error("serve did not announce in time"));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split("\n").find((entry) => entry.trim().length > 0);
      if (line === undefined) {
        return;
      }
      try {
        const parsed = JSON.parse(line) as Announcement;
        if (parsed.command === "serve") {
          clearTimeout(timer);
          resolvePromise(parsed);
        }
      } catch {
        // Wait for a complete line.
      }
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectPromise(new Error(`serve exited early with code ${String(code)}`));
    });
  });
}

async function stopServers(): Promise<void> {
  for (const child of runningServers.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

afterEach(async () => {
  await stopServers();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI read-only Case dashboard", () => {
  it("serves a loopback, token-gated, read-only surface over the analyzer core", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-serve-e2e-"));
    temporaryRoots.push(root);
    const { source, cookieWriter } = await createSource(root);
    const caseDirectory = join(root, "CASE-SERVE");

    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      cookieWriter.close();
    }
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

    const server = await startServer(caseDirectory);
    // Loopback bind, no host option, per-run token.
    expect(server.host).toBe("127.0.0.1");
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(server.token.length).toBeGreaterThanOrEqual(32);
    const base = server.url.replace(/\/$/, "");
    const authToken = { "x-forensix-token": server.token };
    // The browser page always sends a same-origin loopback Origin; simulate it.
    const auth = { ...authToken, origin: base };

    // A request without the per-run token is rejected (token gate first).
    const noToken = await fetch(`${base}/api/history`);
    expect(noToken.status).toBe(401);

    // A non-loopback Origin is rejected even with a valid token.
    const badOrigin = await fetch(`${base}/api/history`, {
      headers: { ...authToken, origin: "https://evil.example" },
    });
    expect(badOrigin.status).toBe(403);

    // Hardening: A token with an absent Origin and no same-origin Fetch
    // Metadata proof is rejected — "loopback Origin only", not "or no Origin".
    const absentOrigin = await fetch(`${base}/api/history`, {
      headers: authToken,
    });
    expect(absentOrigin.status).toBe(403);

    // A same-origin GET that omits Origin but carries Fetch Metadata is allowed,
    // so the real browser dashboard keeps working.
    expect(
      await rawGet(server.port, "/api/history?limit=1", {
        ...authToken,
        "sec-fetch-site": "same-origin",
      }),
    ).toBe(200);

    // Hardening: A loopback socket but a spoofed (rebinding) Host is
    // rejected by the Host allowlist.
    expect(
      await rawGet(server.port, "/api/history", {
        ...authToken,
        host: "evil.example",
      }),
    ).toBe(403);

    // A loopback Origin with the token is accepted.
    const okOrigin = await fetch(`${base}/api/history?limit=10`, {
      headers: auth,
    });
    expect(okOrigin.status).toBe(200);

    // The token is never accepted from the URL; a query-param token is ignored.
    const queryToken = await fetch(
      `${base}/api/history?token=${encodeURIComponent(server.token)}`,
      { headers: { origin: base } },
    );
    expect(queryToken.status).toBe(401);

    // Read-only: Only GET is answered; writes/methods are refused.
    const post = await fetch(`${base}/api/history`, {
      method: "POST",
      headers: auth,
    });
    expect(post.status).toBe(405);

    // There is no ingest/analyse/export route at all.
    for (const route of ["ingest", "analyse", "export"]) {
      const response = await fetch(`${base}/api/${route}`, { headers: auth });
      expect(response.status).toBe(400);
    }

    // Completeness is available before rows and typed per artifact.
    const completeness = (await (
      await fetch(`${base}/api/completeness`, { headers: auth })
    ).json()) as {
      readonly caseId: string;
      readonly statements: readonly {
        readonly artifact: string;
        readonly attempted: number;
        readonly produced: number;
      }[];
    };
    expect(completeness.caseId.length).toBeGreaterThan(0);
    const history = completeness.statements.find(
      (entry) => entry.artifact === "History",
    );
    expect(history?.attempted).toBe(2);
    expect(history?.produced).toBe(2);

    // Multi-Profile filter data is exposed. "." is the Source-scoped
    // (browser-level) Preferences row's profile sentinel, present because the
    // fixture now includes a Metadata (Preferences) Finding.
    const profiles = (await (
      await fetch(`${base}/api/profiles`, { headers: auth })
    ).json()) as { readonly profiles: readonly string[] };
    expect([...profiles.profiles].sort()).toEqual([
      ".",
      "Default",
      "Profile 1",
    ]);

    // Candidate Completeness comes from the shared completeness route,
    // exactly like every other artifact — not embedded in the list response.
    const candidatesStatement = completeness.statements.find(
      (entry) => entry.artifact === "Candidates",
    );
    expect(candidatesStatement?.attempted).toBe(2);
    expect(candidatesStatement?.produced).toBe(2);
    // The list route returns ranked rows only, with the shared filters.
    const candidates = (await (
      await fetch(
        `${base}/api/candidates?category=behavior&kind=behavior_frequent_host&profile=Default&limit=10`,
        { headers: auth },
      )
    ).json()) as {
      readonly items: readonly {
        readonly recordType: string;
        readonly candidateKind: string;
        readonly category: string;
        readonly rank: number;
        readonly supportingCount: number;
        readonly fields: {
          readonly candidateValue: { readonly value: string };
        };
      }[];
    };
    expect(candidates.items[0]).toMatchObject({
      recordType: "candidate",
      candidateKind: "behavior_frequent_host",
      category: "behavior",
      rank: 1,
    });
    expect(candidates.items[0]?.fields.candidateValue.value).toBe(
      "alpha.example",
    );

    // Sites: the host list and one host's rows, served like every list route.
    const siteHosts = await fetch(`${base}/api/site-hosts?limit=100`, {
      headers: auth,
    });
    expect(siteHosts.status).toBe(200);
    const hostsPage = (await siteHosts.json()) as {
      readonly command: string;
      readonly items: readonly {
        readonly host: string;
        readonly counts: Readonly<Record<string, number>>;
        readonly savedCounts: Readonly<Record<string, number>>;
      }[];
      readonly limit: number;
    };
    expect(hostsPage.command).toBe("site-hosts");
    expect(hostsPage.limit).toBe(100);
    const alpha = hostsPage.items.find((item) => item.host === "alpha.example");
    expect(alpha?.counts.visits).toBeGreaterThan(0);
    expect(alpha?.savedCounts.visits).toBeGreaterThan(0);
    const siteFindings = await fetch(
      `${base}/api/site-findings?host=alpha.example&limit=100`,
      { headers: auth },
    );
    expect(siteFindings.status).toBe(200);
    const findingsPage = (await siteFindings.json()) as {
      readonly command: string;
      readonly items: readonly { readonly artifactKind: string }[];
    };
    expect(findingsPage.command).toBe("site-findings");
    expect(findingsPage.items.length).toBeGreaterThan(0);
    expect(findingsPage.items.map((item) => item.artifactKind)).toContain(
      "visits",
    );
    // The shared limit contract (1-100) holds on the Sites routes too.
    for (const path of [
      "site-hosts?limit=101",
      "site-findings?host=alpha.example&limit=101",
    ]) {
      const response = await fetch(`${base}/api/${path}`, { headers: auth });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { readonly code: string }).code).toBe(
        "INVALID_ARGUMENT",
      );
    }

    // Sites membership, counted and listed by core over the real Case.
    const allHosts = new Map(hostsPage.items.map((item) => [item.host, item]));
    // Host-only and domain cookie host keys are one host; www is its own.
    // The WAL-resident cookie counts, but never as saved.
    expect(alpha?.counts.cookies).toBe(3);
    expect(alpha?.savedCounts.cookies).toBe(2);
    expect(allHosts.get("www.alpha.example")?.counts.cookies).toBe(1);
    expect(allHosts.get("www.alpha.example")?.counts.visits).toBe(0);
    // Saved logins are on their origin's host.
    expect(alpha?.counts.saved_logins).toBe(1);
    expect(alpha?.savedCounts.saved_logins).toBe(1);
    // Downloads and favicons are on their hosts too.
    expect(alpha?.counts.downloads).toBe(2);
    expect(alpha?.counts.favicons).toBe(1);
    // A host recorded only in a download's URL chain is listed.
    expect(allHosts.get(DOWNLOAD_ONLY_HOST)).toMatchObject({
      counts: { downloads: 1, visits: 0, cookies: 0 },
      savedCounts: { downloads: 1 },
    });
    expect(hostsPage.items.some((item) => "form_data" in item.counts)).toBe(
      false,
    );
    const onlyDownload = (await (
      await fetch(
        `${base}/api/site-findings?host=${DOWNLOAD_ONLY_HOST}&limit=100`,
        { headers: auth },
      )
    ).json()) as {
      readonly items: readonly {
        readonly artifactKind: string;
        readonly hostFields: readonly string[];
        readonly findingKind: string;
      }[];
    };
    expect(onlyDownload.items).toEqual([
      expect.objectContaining({
        artifactKind: "downloads",
        findingKind: "download",
        hostFields: ["urlChain"],
      }),
    ]);

    // A host's rows page by cursor to the end, each row exactly once, in
    // the same order as one full page.
    type SitePage = {
      readonly items: readonly {
        readonly artifactKind: string;
        readonly commitState: string;
        readonly provenance: {
          readonly manifestPath: string;
          readonly rowId?: string;
        };
      }[];
      readonly nextCursor: string | null;
    };
    const rowKey = (item: SitePage["items"][number]) =>
      `${item.artifactKind}:${item.provenance.manifestPath}:${item.provenance.rowId ?? ""}:${item.commitState}`;
    const fullAlpha = (await (
      await fetch(`${base}/api/site-findings?host=alpha.example&limit=100`, {
        headers: auth,
      })
    ).json()) as SitePage;
    expect(fullAlpha.nextCursor).toBeNull();
    const paged: string[] = [];
    let after: string | null = null;
    let firstCursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query: string =
        after === null ? "" : `&after=${encodeURIComponent(after)}`;
      const response: Response = await fetch(
        `${base}/api/site-findings?host=alpha.example&limit=2${query}`,
        { headers: auth },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as SitePage;
      paged.push(...body.items.map(rowKey));
      firstCursor ??= body.nextCursor;
      after = body.nextCursor;
      if (after === null) break;
    }
    expect(after).toBeNull();
    expect(paged).toEqual(fullAlpha.items.map(rowKey));
    expect(new Set(paged).size).toBe(paged.length);
    expect(paged.length).toBeGreaterThan(4);

    // A missing host and a forged cursor are client errors, never a 500.
    const noHost = await fetch(`${base}/api/site-findings?limit=10`, {
      headers: auth,
    });
    expect(noHost.status).toBe(400);
    expect(((await noHost.json()) as { readonly code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
    const cursorPayload = JSON.parse(
      Buffer.from(firstCursor ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    for (const forged of [
      Buffer.from(
        JSON.stringify({ ...cursorPayload, key: "visits:not-a-number" }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ ...cursorPayload, fingerprint: "0".repeat(64) }),
      ).toString("base64url"),
      "not-a-cursor",
    ]) {
      const response = await fetch(
        `${base}/api/site-findings?host=alpha.example&limit=2&after=${encodeURIComponent(forged)}`,
        { headers: auth },
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { readonly code: string }).code).toBe(
        "INVALID_CURSOR",
      );
    }

    // A known host's recovered favicon comes back inline; a host without
    // one is an explicit null.
    const favicons = await fetch(
      `${base}/api/site-favicons?host=alpha.example&host=${DOWNLOAD_ONLY_HOST}`,
      { headers: auth },
    );
    expect(favicons.status).toBe(200);
    expect(await favicons.json()).toEqual({
      status: "ok",
      command: "site-favicons",
      icons: {
        "alpha.example": `data:image/png;base64,${ALPHA_PNG.toString("base64")}`,
        [DOWNLOAD_ONLY_HOST]: null,
      },
    });

    // Activity rows carry the declared timezone their days were bucketed in;
    // the dashboard turns a clicked day into that zone's day bounds.
    const activity = (await (
      await fetch(`${base}/api/history?view=activity&limit=100`, {
        headers: auth,
      })
    ).json()) as {
      readonly items: readonly {
        readonly fields: {
          readonly declaredTimezone?: { readonly value?: unknown };
        };
      }[];
    };
    expect(activity.items.length).toBeGreaterThan(0);
    expect(
      new Set(
        activity.items.map((item) => item.fields.declaredTimezone?.value),
      ),
    ).toEqual(new Set(["America/New_York"]));

    // Keyset pagination returns bounded pages with a cursor.
    const firstPage = (await (
      await fetch(`${base}/api/history?sort=visit-time&direction=asc&limit=1`, {
        headers: auth,
      })
    ).json()) as Page;
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.items[0]?.findingKind).toBe("history_visit");
    const secondPage = (await (
      await fetch(
        `${base}/api/history?sort=visit-time&direction=asc&limit=1&after=${encodeURIComponent(
          firstPage.nextCursor ?? "",
        )}`,
        { headers: auth },
      )
    ).json()) as Page;
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.fields.url).not.toEqual(
      firstPage.items[0]?.fields.url,
    );

    // Multi-Profile + search filters compose.
    const filtered = (await (
      await fetch(
        `${base}/api/history?profile=Profile%201&search=beta.example&limit=10`,
        { headers: auth },
      )
    ).json()) as Page;
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.profile).toBe("Profile 1");

    // Committed and sidecar rows are separate lists (one Commit State each).
    const committed = (await (
      await fetch(`${base}/api/history?commit-state=committed&limit=100`, {
        headers: auth,
      })
    ).json()) as Page;
    expect(committed.items).toHaveLength(3);
    expect(
      committed.items.every((row) => row.commitState === "committed"),
    ).toBe(true);
    const walResident = (await (
      await fetch(`${base}/api/history?commit-state=wal_resident&limit=100`, {
        headers: auth,
      })
    ).json()) as Page;
    expect(walResident.items).toHaveLength(0);

    // The four previously unreachable core queries are now routed: each
    // returns its own `command` tag and requires the per-run token exactly
    // like every other route.
    const metadata = (await (
      await fetch(`${base}/api/metadata?type=profile_metadata&limit=10`, {
        headers: auth,
      })
    ).json()) as Page & { readonly command: string };
    expect(metadata.command).toBe("metadata");
    expect(metadata.items.length).toBeGreaterThan(0);
    expect(
      metadata.items.every((row) => row.findingKind === "profile_metadata"),
    ).toBe(true);

    const downloads = (await (
      await fetch(`${base}/api/downloads?limit=10`, { headers: auth })
    ).json()) as Page & { readonly command: string };
    expect(downloads.command).toBe("downloads");
    // Both fixture History databases carry the same `downloads` schema (the
    // real `downloads` table always shares Chrome's History database), so one
    // download row exists per Profile, plus Profile 1's download-only host.
    expect(downloads.items).toHaveLength(3);
    expect(downloads.items.every((row) => row.findingKind === "download")).toBe(
      true,
    );

    const bookmarks = (await (
      await fetch(`${base}/api/bookmarks?source=primary&limit=10`, {
        headers: auth,
      })
    ).json()) as Page & { readonly command: string };
    expect(bookmarks.command).toBe("bookmarks");
    expect(bookmarks.items.length).toBeGreaterThan(0);
    expect(bookmarks.items.every((row) => row.findingKind === "bookmark")).toBe(
      true,
    );

    const autofill = (await (
      await fetch(`${base}/api/autofill?limit=10`, { headers: auth })
    ).json()) as Page & { readonly command: string };
    expect(autofill.command).toBe("autofill");
    expect(autofill.items).toHaveLength(1);
    expect(autofill.items[0]?.findingKind).toBe("autofill_entry");

    // The token gate applies uniformly to the newly wired routes too.
    for (const route of ["metadata", "downloads", "bookmarks", "autofill"]) {
      const unauthorized = await fetch(`${base}/api/${route}`);
      expect(unauthorized.status).toBe(401);
    }

    const shellResponse = await fetch(`${base}/`, { headers: auth });
    // The typeface ships inside the bundle as a data: URI; the policy admits
    // exactly that and no font origin.
    expect(shellResponse.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'",
    );
    const shell = await shellResponse.text();
    expect(shell).toContain("__FORENSIX_TOKEN__");
    expect(shell).toContain('src="/index.js"');
    const bundle = await (
      await fetch(`${base}/index.js`, { headers: auth })
    ).text();
    expect(bundle).toContain("CLIENT_IMPLEMENTATION_ISSUE");

    await stopServers();
  }, 30_000);
});

describe("compiled analyzer CLI dashboard origin check", () => {
  it("accepts only the exact dashboard origin, not another loopback port or scheme", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-serve-origin-"));
    temporaryRoots.push(root);
    const { source, cookieWriter } = await createSource(root);
    const caseDirectory = join(root, "CASE-ORIGIN");
    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      cookieWriter.close();
    }
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

    const server = await startServer(caseDirectory);
    const base = server.url.replace(/\/$/, "");
    const token = { "x-forensix-token": server.token };
    const otherPort =
      server.port === 65_535 ? server.port - 1 : server.port + 1;
    const historyWithOrigin = async (origin: string) => {
      const response = await fetch(`${base}/api/history?limit=1`, {
        headers: { ...token, origin },
      });
      return {
        status: response.status,
        body: (await response.json()) as { readonly code?: string },
      };
    };

    // Same origin: the page this server serves.
    expect((await historyWithOrigin(base)).status).toBe(200);

    // Another app on loopback (different port, other loopback name, other
    // scheme) is a different origin, even with a leaked token.
    for (const origin of [
      `http://127.0.0.1:${otherPort}`,
      `http://localhost:${otherPort}`,
      `https://127.0.0.1:${server.port}`,
      "http://127.0.0.1",
    ]) {
      const refused = await historyWithOrigin(origin);
      expect(refused, origin).toEqual({
        status: 403,
        body: expect.objectContaining({ code: "FORBIDDEN_ORIGIN" }),
      });
    }

    // The anchor is the Host the request was made to: a page loaded from
    // localhost:<port> calls the API with that Host and Origin.
    expect(
      await rawGet(server.port, "/api/history?limit=1", {
        ...token,
        host: `localhost:${server.port}`,
        origin: `http://localhost:${server.port}`,
      }),
    ).toBe(200);
    // An Origin that names a different loopback host than Host is refused.
    expect(
      await rawGet(server.port, "/api/history?limit=1", {
        ...token,
        host: `127.0.0.1:${server.port}`,
        origin: `http://localhost:${server.port}`,
      }),
    ).toBe(403);

    await stopServers();
  }, 30_000);

  it("refuses analyse and a second serve of the same Case while serve runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-serve-lock-"));
    temporaryRoots.push(root);
    const { source, cookieWriter } = await createSource(root);
    const caseDirectory = join(root, "CASE-LOCK");
    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      cookieWriter.close();
    }
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const caseFiles = (await readdir(caseDirectory)).sort();

    await startServer(caseDirectory);
    const serving = runningServers.at(-1);
    const analyse = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analyse.status).toBe(1);
    expect(JSON.parse(analyse.stderr.trim())).toMatchObject({
      code: "CASE_IN_USE",
      details: { holder: "serve", pid: serving?.pid },
    });
    await expect(startServer(caseDirectory)).rejects.toThrow(
      "serve exited early with code 1",
    );
    // The lock lives outside the Case Directory: serve writes nothing there.
    expect((await readdir(caseDirectory)).sort()).toEqual(caseFiles);

    // A stopped serve releases the lock, so analyse runs again.
    serving?.kill("SIGTERM");
    if (serving !== undefined) await once(serving, "exit");
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
  }, 30_000);
});
