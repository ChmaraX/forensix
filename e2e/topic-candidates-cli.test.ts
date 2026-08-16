import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

async function createHistory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
        visit_time INTEGER NOT NULL, from_visit INTEGER, external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER, originator_cache_guid TEXT, originator_visit_id INTEGER,
        originator_from_visit INTEGER, originator_opener_visit INTEGER,
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
    database
      .prepare(
        `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
         VALUES (10, 'https://chase.com/x', 'brokerage account', 1, 1, 13350000000000000, 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO visits
           (id, url, visit_time, from_visit, external_referrer_url, transition,
            segment_id, visit_duration, incremented_omnibox_typed_score,
            opener_visit, originator_cache_guid, originator_visit_id,
            originator_from_visit, originator_opener_visit, is_known_to_sync,
            consider_for_ntp_most_visited, visited_link_id, app_id)
         VALUES (1, 10, 13350000000000000, 0, '', 0, 0, 0, 1, 0, '', 0, 0, 0, 1, 1, 0, '')`,
      )
      .run();
  } finally {
    database.close();
  }
}

async function buildCase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-topic-cli-"));
  temporaryRoots.push(root);
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createHistory(join(source, "Default", "History"));
  const caseDirectory = join(root, "CASE");
  expect(
    runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
  ).toBe(0);
  return caseDirectory;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) =>
        rm(root, { force: true, recursive: true }).catch(() => undefined),
      ),
  );
});

interface TopicCandidatePage {
  readonly status: "ok";
  readonly command: "topic-candidates";
  readonly items: readonly { readonly recordType: string }[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

describe("topic-candidates CLI", () => {
  it("records typed model unavailability during analyse without failing History", async () => {
    const caseDirectory = await buildCase();
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    const result = parseJson<{
      readonly history: {
        readonly candidateCount: number;
        readonly findingCount: number;
      };
      readonly topicCandidates: {
        readonly status: string;
        readonly reason: string | null;
        readonly candidateCount: number;
      };
    }>(analysis.stdout);
    // No ONNX model ships in the repo: the analyser records a typed reason and
    // keeps History fully usable.
    expect(result.topicCandidates.status).toBe("unavailable");
    expect(result.topicCandidates.reason).toBe("model_artifact_missing");
    expect(result.topicCandidates.candidateCount).toBe(0);
    expect(result.history.candidateCount).toBe(0);
    expect(result.history.findingCount).toBeGreaterThan(0);
  });

  it("marks classification disabled when analyse opts out", async () => {
    const caseDirectory = await buildCase();
    const analysis = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--no-topic-classification",
      "--json",
    ]);
    expect(analysis.status).toBe(0);
    expect(
      parseJson<{ readonly topicCandidates: { readonly status: string } }>(
        analysis.stdout,
      ).topicCandidates.status,
    ).toBe("disabled");
  });

  it("serves a bounded topic-candidates page over the Candidate collection", async () => {
    const caseDirectory = await buildCase();
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    const page = runCli([
      "topic-candidates",
      "--case",
      caseDirectory,
      "--sort",
      "rank",
      "--json",
    ]);
    expect(page.status).toBe(0);
    const parsed = parseJson<TopicCandidatePage>(page.stdout);
    expect(parsed.command).toBe("topic-candidates");
    expect(parsed.limit).toBe(50);
    expect(Array.isArray(parsed.items)).toBe(true);
    for (const item of parsed.items) {
      expect(item.recordType).toBe("candidate");
    }
  });

  it("rejects unsupported sort and positional arguments", async () => {
    const caseDirectory = await buildCase();
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    expect(
      runCli([
        "topic-candidates",
        "--case",
        caseDirectory,
        "--sort",
        "confidence",
        "--json",
      ]).status,
    ).toBe(1);
    expect(
      runCli(["topic-candidates", "--case", caseDirectory, "stray"]).status,
    ).toBe(1);
  });
});
