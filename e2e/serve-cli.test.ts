import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
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
  return source;
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
    const source = await createSource(root);
    const caseDirectory = join(root, "CASE-SERVE");

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

    // Multi-Profile filter data is exposed.
    const profiles = (await (
      await fetch(`${base}/api/profiles`, { headers: auth })
    ).json()) as { readonly profiles: readonly string[] };
    expect([...profiles.profiles].sort()).toEqual(["Default", "Profile 1"]);

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

    // The HTML shell injects the per-run token and loads the client bundle.
    const shell = await (await fetch(`${base}/`, { headers: auth })).text();
    expect(shell).toContain("__FORENSIX_TOKEN__");
    expect(shell).toContain('src="/index.js"');
    const bundle = await (
      await fetch(`${base}/index.js`, { headers: auth })
    ).text();
    expect(bundle).toContain("CLIENT_IMPLEMENTATION_ISSUE");

    await stopServers();
  }, 30_000);
});
