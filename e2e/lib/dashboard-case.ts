/**
 * The browser E2E's fixture Case and its live `forensix serve`.
 *
 * `buildDashboardCase(root)` writes one Chrome User Data Dir, then ingests and
 * analyses it with the compiled CLI into `<root>/case`. The Source holds
 * exactly the shapes the dashboard scenarios need:
 *
 *  - History: `HISTORY_DAYS` days of committed visits on alpha.example
 *    (more than one 100-row page), plus `WAL_VISIT_COUNT` visits that live
 *    only in the `History-wal` sidecar (recovered rows), the oldest of them
 *    `RECOVERED_TARGET_URL`;
 *  - a download from `DOWNLOAD_ONLY_HOST`, a host no visit, cookie or login
 *    names;
 *  - two saved logins with v11 (GNOME Keyring) passwords, decrypted at
 *    analyse time from supplied key material, so the dashboard holds clear
 *    passwords it must hide until revealed;
 *  - one plaintext cookie value (a session secret);
 *  - analyse runs with topic classification off, so the Case has no topic
 *    Candidates and no topic-model state to report.
 *
 * `startDashboard(caseDirectory)` spawns `forensix serve --port 0 --json` and
 * returns the announced URL; `stop()` kills it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { compiledCli, runCli, writeLocalState } from "./harness.js";

export const PROFILE = "Default";
/** Committed visits: one every 20 minutes over the Case days below. */
export const HISTORY_DAYS = ["2024-03-11", "2024-03-12", "2024-03-13"];
export const VISITS_PER_DAY = 60;
/** Visits written only to the WAL sidecar (recovered on analyse). */
export const WAL_VISIT_COUNT = 120;
/** The oldest recovered visit: last in the newest-first Recovered list. */
export const RECOVERED_TARGET_URL = "https://recovered.example/target";
export const RECOVERED_TARGET_TITLE = "Recovered target visit";
/** The oldest committed visit: last in the newest-first Timeline. */
export const OLDEST_VISIT_URL = "https://alpha.example/page-0";

/** Seen only as a download's URL, tab and referrer. */
export const DOWNLOAD_ONLY_HOST = "downloads-only.example";
export const DOWNLOAD_FILE_NAME = "Quarterly_Ledger_2024.xlsx";

export const LOGINS = [
  {
    id: 1n,
    origin: "https://alpha.example/",
    username: "ada.lovelace",
    password: "alpha-pass-7731",
  },
  {
    id: 2n,
    origin: "https://beta.example/",
    username: "grace.hopper",
    password: "beta-pass-4410",
  },
] as const;

export const COOKIE = {
  host: ".alpha.example",
  name: "session",
  value: "cookie-session-9f3e",
} as const;

export const TIMEZONE = "UTC";

const KEYRING_PASSPHRASE = "dashboard-keyring-secret";

/** Chrome (WebKit) microseconds since 1601-01-01 for an ISO instant. */
export function chromeTime(iso: string): bigint {
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

const HISTORY_SCHEMA = `
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
`;

export interface Visit {
  readonly id: bigint;
  readonly url: string;
  readonly title: string;
  readonly time: bigint;
}

function insertVisits(database: DatabaseSync, visits: readonly Visit[]): void {
  const insertUrl = database.prepare(
    `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
     VALUES (?, ?, ?, 1, 0, ?, 0)`,
  );
  const insertVisit = database.prepare(
    `INSERT INTO visits
       (id, url, visit_time, from_visit, external_referrer_url, transition,
        segment_id, visit_duration, incremented_omnibox_typed_score,
        opener_visit, originator_cache_guid, originator_visit_id,
        originator_from_visit, originator_opener_visit, is_known_to_sync,
        consider_for_ntp_most_visited, visited_link_id, app_id)
     VALUES (?, ?, ?, 0, '', 1, 0, 1000000, 0, 0, '', 0, 0, 0, 0, 1, 0, '')`,
  );
  for (const visit of visits) {
    insertUrl.run(visit.id, visit.url, visit.title, visit.time);
    insertVisit.run(visit.id, visit.id, visit.time);
  }
}

function committedVisits(): Visit[] {
  const visits: Visit[] = [];
  for (const [dayIndex, day] of HISTORY_DAYS.entries()) {
    for (let slot = 0; slot < VISITS_PER_DAY; slot += 1) {
      const index = dayIndex * VISITS_PER_DAY + slot;
      const minutes = 8 * 60 + slot * 10;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      visits.push({
        id: BigInt(index + 1),
        url: `https://alpha.example/page-${String(index)}`,
        title: `Alpha page ${String(index)}`,
        time: chromeTime(`${day}T${hh}:${mm}:00Z`),
      });
    }
  }
  return visits;
}

function walVisits(): Visit[] {
  // Every recovered visit is a minute apart on the first Case day, before
  // any committed visit, the target first (oldest).
  return Array.from({ length: WAL_VISIT_COUNT }, (_, index) => {
    const minutes = index;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return {
      id: BigInt(10_000 + index),
      url:
        index === 0
          ? RECOVERED_TARGET_URL
          : `https://recovered.example/item-${String(index)}`,
      title:
        index === 0 ? RECOVERED_TARGET_TITLE : `Recovered ${String(index)}`,
      time: chromeTime(`${HISTORY_DAYS[0] ?? ""}T${hh}:${mm}:30Z`),
    };
  });
}

/** History with committed visits and a download, then an open writer holding
 *  `WAL_VISIT_COUNT` more visits in an uncheckpointed WAL. The caller closes
 *  the writer after ingest (closing would checkpoint the WAL away). */
function createHistory(
  path: string,
  extraVisits: readonly Visit[],
): DatabaseSync {
  const database = new DatabaseSync(path);
  try {
    database.exec(HISTORY_SCHEMA);
    insertVisits(database, [...committedVisits(), ...extraVisits]);
    const start = chromeTime(`${HISTORY_DAYS[1] ?? ""}T15:00:00Z`);
    const fileUrl = `https://${DOWNLOAD_ONLY_HOST}/files/${DOWNLOAD_FILE_NAME}`;
    database
      .prepare(
        `INSERT INTO downloads
           (id, guid, current_path, target_path, start_time, received_bytes,
            total_bytes, state, danger_type, interrupt_reason, hash, end_time,
            opened, last_access_time, transient, referrer, site_url, tab_url,
            tab_referrer_url, http_method, by_ext_id, by_ext_name,
            by_web_app_id, etag, last_modified, mime_type, original_mime_type)
         VALUES (1, 'guid-ledger', ?, ?, ?, 20480, 20480, 1, 0, 0, x'00', ?,
                 0, 0, 0, ?, ?, ?, ?, 'GET', '', '', '', '', '',
                 'application/vnd.ms-excel', 'application/vnd.ms-excel')`,
      )
      .run(
        `/home/ada/Downloads/${DOWNLOAD_FILE_NAME}`,
        `/home/ada/Downloads/${DOWNLOAD_FILE_NAME}`,
        start,
        start + 4_000_000n,
        `https://${DOWNLOAD_ONLY_HOST}/`,
        `https://${DOWNLOAD_ONLY_HOST}/`,
        `https://${DOWNLOAD_ONLY_HOST}/files`,
        `https://${DOWNLOAD_ONLY_HOST}/`,
      );
    database
      .prepare(
        "INSERT INTO downloads_url_chains (id, chain_index, url) VALUES (1, 0, ?)",
      )
      .run(fileUrl);
  } finally {
    database.close();
  }
  const writer = new DatabaseSync(path);
  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    PRAGMA wal_checkpoint(TRUNCATE);
  `);
  insertVisits(writer, walVisits());
  return writer;
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
    const insert = database.prepare(
      `INSERT INTO logins
         (id, origin_url, username_value, password_value, signon_realm,
          date_created, blacklisted_by_user, scheme, date_last_used)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    );
    for (const [index, login] of LOGINS.entries()) {
      const day = HISTORY_DAYS[index] ?? HISTORY_DAYS[0] ?? "";
      insert.run(
        login.id,
        login.origin,
        login.username,
        sealV11(KEYRING_PASSPHRASE, login.password),
        login.origin,
        chromeTime(`${day}T09:00:00Z`),
        chromeTime(`${day}T10:00:00Z`),
      );
    }
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
         VALUES (?, ?, '', ?, ?, x'', '/', ?, 1, 1, ?)`,
      )
      .run(
        chromeTime(`${HISTORY_DAYS[0] ?? ""}T09:30:00Z`),
        COOKIE.host,
        COOKIE.name,
        COOKIE.value,
        chromeTime("2030-01-01T00:00:00Z"),
        chromeTime(`${HISTORY_DAYS[2] ?? ""}T18:00:00Z`),
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
          recordId: "dashboard-e2e-gnome",
          route: "gnome-keyring",
          keyKind: "passphrase",
          rowPrefix: "v11",
          profile: PROFILE,
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

function mustRun(
  arguments_: readonly string[],
  exitCodes: readonly number[] = [0],
): void {
  const result = runCli(arguments_);
  if (result.status === null || !exitCodes.includes(result.status)) {
    throw new Error(
      `forensix ${arguments_[0] ?? ""} failed (${String(result.status)}): ${result.stderr}${result.stdout}`,
    );
  }
}

/** Optional additions for callers that need more than the dashboard shapes
 *  (the agent eval). The default build ignores all of them. */
export interface DashboardCaseOptions {
  /** More committed History visits. Their ids must not collide with the
   *  base visits (1 to 180 and 10000 to 10119). */
  readonly extraVisits?: readonly Visit[];
  /** Writes more artifacts into the Profile directory before ingest. */
  readonly extendProfile?: (profileDirectory: string) => Promise<void>;
  /** The analyse exit codes to accept (default `[0]`). Use `[2]` when the
   *  Source has an artifact that is planned to be unavailable. */
  readonly analyseExitCodes?: readonly number[];
}

/** Writes the Source under `root`, ingests and analyses it into
 *  `<root>/case`, and returns that Case directory. `root` must be empty. */
export async function buildDashboardCase(
  root: string,
  options: DashboardCaseOptions = {},
): Promise<string> {
  const source = join(root, "source");
  const profile = join(source, PROFILE);
  await mkdir(join(profile, "Network"), { recursive: true });
  await writeLocalState(source);
  createLoginData(join(profile, "Login Data"));
  createCookies(join(profile, "Network", "Cookies"));
  const keyMaterial = join(root, "key-material.json");
  await writeKeyMaterial(keyMaterial);
  await options.extendProfile?.(profile);
  const caseDirectory = join(root, "case");
  const writer = createHistory(
    join(profile, "History"),
    options.extraVisits ?? [],
  );
  try {
    mustRun(["ingest", source, "--case", caseDirectory, "--json"]);
  } finally {
    writer.close();
  }
  mustRun(
    [
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      TIMEZONE,
      "--decrypt",
      "--key-material",
      keyMaterial,
      "--no-topic-classification",
      "--json",
    ],
    options.analyseExitCodes,
  );
  return caseDirectory;
}

export interface Dashboard {
  /** The dashboard's address (`http://127.0.0.1:<port>/`). */
  readonly url: string;
  /** The per-run API token (for the test's own API reads). */
  readonly token: string;
  readonly stop: () => void;
}

/** Starts `forensix serve` on the Case and waits for its announcement. */
export async function startDashboard(
  caseDirectory: string,
): Promise<Dashboard> {
  const child: ChildProcess = spawn(
    process.execPath,
    [compiledCli, "serve", "--case", caseDirectory, "--port", "0", "--json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  };
  let buffer = "";
  let errors = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString("utf8");
  });
  try {
    return await new Promise<Dashboard>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error(`serve did not announce in time: ${errors}`));
      }, 15_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const line = buffer.split("\n")[0];
        if (line === undefined || !buffer.includes("\n")) {
          return;
        }
        clearTimeout(timer);
        const parsed = JSON.parse(line) as {
          readonly url: string;
          readonly token: string;
        };
        resolvePromise({ url: parsed.url, token: parsed.token, stop });
      });
      child.on("error", rejectPromise);
      child.on("exit", (code) => {
        clearTimeout(timer);
        rejectPromise(
          new Error(`serve exited early (${String(code)}): ${errors}`),
        );
      });
    });
  } catch (error) {
    stop();
    throw error;
  }
}

/** A `GET /api/<route>` against the running dashboard, as the page sends it. */
export async function readApi<T>(
  dashboard: Dashboard,
  route: string,
  parameters: Readonly<Record<string, string>> = {},
): Promise<T> {
  const base = dashboard.url.replace(/\/$/, "");
  const query = new URLSearchParams(parameters).toString();
  const response = await fetch(
    `${base}/api/${route}${query === "" ? "" : `?${query}`}`,
    { headers: { "x-forensix-token": dashboard.token, origin: base } },
  );
  if (!response.ok) {
    throw new Error(`GET ${route} answered ${String(response.status)}`);
  }
  return (await response.json()) as T;
}

/** Ensures a directory's parent exists (for artifact paths). */
export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
