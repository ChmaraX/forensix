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
  | { readonly state: "value"; readonly value: T }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface CandidateRecord {
  readonly recordType: "candidate";
  readonly candidateKind: string;
  readonly category: "identity" | "behavior";
  readonly profile: string;
  readonly rank: number;
  readonly supportingCount: number;
  readonly provenance: {
    readonly manifestPath: string;
    readonly table: string;
    readonly rowId: string;
    readonly supportingRows?: readonly unknown[];
  };
  readonly fields: {
    readonly candidateValue: Field<string>;
    readonly supportingCount: Field<string>;
    readonly evidenceBasis: Field<string>;
  };
}

interface CandidatePage {
  readonly status: "ok";
  readonly command: "candidates";
  readonly items: readonly CandidateRecord[];
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

interface AutofillRow {
  readonly name: string;
  readonly value: string;
}

async function createWebData(
  path: string,
  rows: readonly AutofillRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
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
    `);
    const insert = database.prepare(
      `INSERT INTO autofill (name, value, value_lower, date_created, date_last_used, count)
       VALUES (?, ?, ?, 1704164645, 1704164645, 1)`,
    );
    for (const row of rows) {
      insert.run(row.name, row.value, row.value.toLocaleLowerCase("en-US"));
    }
  } finally {
    database.close();
  }
}

async function createHistory(
  path: string,
  urls: readonly string[],
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
      `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
       VALUES (?, ?, ?, ?, ?, 13300000000000000, 0)`,
    );
    const insertVisit = database.prepare(
      `INSERT INTO visits
         (id, url, visit_time, from_visit, external_referrer_url, transition,
          segment_id, visit_duration, incremented_omnibox_typed_score,
          opener_visit, originator_cache_guid, originator_visit_id,
          originator_from_visit, originator_opener_visit, is_known_to_sync,
          consider_for_ntp_most_visited, visited_link_id, app_id)
       VALUES (?, ?, 13300000000000000, 0, '', 805306368, 0, 0, 1, 0,
               'guid', ?, 0, 0, 1, 1, ?, 'app')`,
    );
    urls.forEach((url, index) => {
      const urlId = index + 1;
      insertUrl.run(urlId, url, `Title ${String(urlId)}`, 1, urlId);
      insertVisit.run(urlId, urlId, urlId + 1000, urlId + 2000);
    });
  } finally {
    database.close();
  }
}

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "Local State"),
    `${JSON.stringify({ variations_country: "us" })}\n`,
  );

  // Default Profile: identity evidence from autofill + Preferences account.
  await createWebData(join(source, "Default", "Web Data"), [
    { name: "name", value: "Ada Lovelace" },
    { name: "fullname", value: "Ada Lovelace" },
    { name: "name", value: "A. Lovelace" },
    { name: "email", value: "ada@analytical.example" },
    { name: "phone", value: "+1-555-0100" },
    { name: "shipping_address", value: "12 Analytical Way" },
    { name: "country", value: "US" },
  ]);
  await writeFile(
    join(source, "Default", "Preferences"),
    `${JSON.stringify({
      profile: { name: "Ada" },
      account_info: [
        {
          email: "ada@analytical.example",
          full_name: "Ada Lovelace",
          gaia: "1",
        },
      ],
    })}\n`,
  );
  await createHistory(join(source, "Default", "History"), [
    "https://news.example/a",
    "https://news.example/b",
    "https://news.example/c",
    "https://shop.example/x",
    "https://www.google.com/search?q=babbage+engine",
  ]);

  // Profile 1: distinct identity evidence, proving multi-Profile separation.
  await createWebData(join(source, "Profile 1", "Web Data"), [
    { name: "name", value: "Grace Hopper" },
  ]);
  await writeFile(
    join(source, "Profile 1", "Preferences"),
    `${JSON.stringify({ profile: { name: "Grace" } })}\n`,
  );
  await createHistory(join(source, "Profile 1", "History"), [
    "https://compiler.example/home",
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

describe("compiled analyzer CLI identity and behavior Candidates", () => {
  it("emits ranked nominal Candidates with Provenance while leaving source rows untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-candidates-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const webBytes = await readFile(join(source, "Default", "Web Data"));
    const caseDirectory = join(root, "CASE-CAND");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    // The run is queryable (clean or partial); Candidate generation is derived
    // and never changes the exit-code semantics of the source artifacts.
    expect(
      runCli(["analyse", "--case", caseDirectory, "--json"]).status,
    ).not.toBe(1);

    // AC: every heuristic is nominal + ranked. The Candidate list returns rows
    // only, like every other artifact list; Completeness is a separate route.
    const all = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--limit",
        "100",
        "--json",
      ]).stdout,
    );
    expect(all.command).toBe("candidates");
    expect(all.items.length).toBeGreaterThan(0);
    for (const item of all.items) {
      expect(item.recordType).toBe("candidate");
      expect(item.rank).toBeGreaterThanOrEqual(1);
      expect(item.supportingCount).toBeGreaterThanOrEqual(1);
      expect(item.provenance.rowId.length).toBeGreaterThan(0);
      // A Candidate is never a Finding: it carries no Commit State.
      expect((item as Record<string, unknown>).commitState).toBeUndefined();
    }

    // AC: conflicting names surface as a ranked list; the most-supported wins.
    const names = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--kind",
        "identity_name",
        "--profile",
        "Default",
        "--json",
      ]).stdout,
    );
    const topName = names.items[0];
    expect(topName?.category).toBe("identity");
    expect(topName?.rank).toBe(1);
    expect(topName?.fields.candidateValue).toEqual({
      state: "value",
      value: "Ada Lovelace",
    });
    // Autofill (x2) plus the Preferences account full_name = three source rows.
    expect(topName?.supportingCount).toBe(3);
    expect(topName?.provenance.supportingRows?.length).toBe(2);

    // AC: behavior habit from History, ranked by visit count.
    const hosts = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--kind",
        "behavior_frequent_host",
        "--profile",
        "Default",
        "--json",
      ]).stdout,
    );
    expect(hosts.items[0]?.fields.candidateValue).toEqual({
      state: "value",
      value: "news.example",
    });
    expect(hosts.items[0]?.supportingCount).toBe(3);

    // AC: category filter partitions identity vs behavior.
    const behavior = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--category",
        "behavior",
        "--json",
      ]).stdout,
    );
    expect(behavior.items.length).toBeGreaterThan(0);
    expect(behavior.items.every((item) => item.category === "behavior")).toBe(
      true,
    );

    // AC: search matches nominal value text.
    const search = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--search",
        "babbage",
        "--json",
      ]).stdout,
    );
    expect(search.items).toHaveLength(1);
    expect(search.items[0]?.candidateKind).toBe("behavior_search_query");

    // AC: multi-Profile separation — Profile 1 owns only its own name.
    const profile1 = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--profile",
        "Profile 1",
        "--kind",
        "identity_name",
        "--json",
      ]).stdout,
    );
    expect(profile1.items).toHaveLength(1);
    expect(profile1.items[0]?.fields.candidateValue).toEqual({
      state: "value",
      value: "Grace Hopper",
    });

    // AC: bounded keyset pagination is stable and non-overlapping.
    const firstPage = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--sort",
        "kind",
        "--limit",
        "3",
        "--json",
      ]).stdout,
    );
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = parseJson<CandidatePage>(
      runCli([
        "candidates",
        "--case",
        caseDirectory,
        "--sort",
        "kind",
        "--limit",
        "3",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const firstIds = new Set(
      firstPage.items.map(
        (item) => `${item.profile}:${item.candidateKind}:${String(item.rank)}`,
      ),
    );
    for (const item of secondPage.items) {
      expect(
        firstIds.has(
          `${item.profile}:${item.candidateKind}:${String(item.rank)}`,
        ),
      ).toBe(false);
    }

    // AC: Candidate generation never changes the source rows it reads, and the
    // underlying artifact queries still return their Findings unchanged.
    expect(await readFile(join(source, "Default", "Web Data"))).toEqual(
      webBytes,
    );
    const autofill = parseJson<{ readonly items: readonly unknown[] }>(
      runCli(["autofill", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(autofill.items.length).toBe(8);
    const metadata = parseJson<{ readonly items: readonly unknown[] }>(
      runCli(["metadata", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(metadata.items.length).toBeGreaterThan(0);
  });
});
