import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

interface AnalyseResult {
  readonly command: "analyse";
  readonly analysisStatus: "ready";
  readonly runId: string;
  readonly exitState: "complete" | "partial" | "failed";
  readonly artifactCount: number;
  readonly history: {
    readonly status: "complete" | "partial";
    readonly profileCount: number;
    readonly analysedProfileCount: number;
    readonly unavailableProfileCount: number;
    readonly findingCount: number;
  };
}

interface HistoryPage {
  readonly status: "ok";
  readonly items: readonly {
    readonly provenance: { readonly rowId: string };
  }[];
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

async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/**
 * Build a minimal but valid Chrome History database with one recorded visit.
 * Schema version 70 lets the Analyzer resolve timestamps without a Declared
 * Origin OS, so the resulting artifact is `complete`.
 */
async function createValidHistory(
  path: string,
  urlHost: string,
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
    database
      .prepare(
        `INSERT INTO urls
           (id, url, title, visit_count, typed_count, last_visit_time, hidden)
         VALUES (1, ?, ?, 1, 0, 13348638245123456, 0)`,
      )
      .run(`https://${urlHost}/`, `Title ${urlHost}`);
    database
      .prepare(
        `INSERT INTO visits
           (id, url, visit_time, from_visit, external_referrer_url, transition,
            segment_id, visit_duration, incremented_omnibox_typed_score,
            opener_visit, originator_cache_guid, originator_visit_id,
            originator_from_visit, originator_opener_visit, is_known_to_sync,
            consider_for_ntp_most_visited, visited_link_id, app_id)
         VALUES (1, 1, 13348638245123456, 0, '', 1, 0, 100, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL)`,
      )
      .run();
  } finally {
    database.close();
  }
}

interface CaseReader {
  readonly runs: readonly {
    readonly run_id: string;
    readonly started_at: string;
    readonly finished_at: string | null;
    readonly tool_version: string;
    readonly invocation_json: string;
    readonly status: string;
  }[];
  readonly runSourceCount: number;
  readonly artifactResults: readonly {
    readonly artifact_result_id: bigint;
    readonly run_id: string;
    readonly profile_path: string;
    readonly status: string;
    readonly reason: string | null;
    readonly active: bigint;
  }[];
  readonly activeResults: readonly {
    readonly artifact_result_id: bigint;
    readonly run_id: string;
    readonly profile_path: string;
  }[];
  readonly findingRunIds: readonly string[];
  readonly activeFindingCount: number;
  readonly activeVisitFindingCount: number;
}

function readCase(caseDirectory: string): CaseReader {
  const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
    readOnly: true,
    readBigInts: true,
  });
  try {
    const runs = database
      .prepare(
        `SELECT run_id, started_at, finished_at, tool_version, invocation_json, status
           FROM analysis_runs ORDER BY started_at, run_id`,
      )
      .all() as unknown as CaseReader["runs"];
    const runSourceCount = Number(
      (
        database
          .prepare("SELECT count(*) AS count FROM analysis_run_sources")
          .get() as { readonly count: bigint }
      ).count,
    );
    const artifactResults = database
      .prepare(
        `SELECT artifact_result_id, run_id, profile_path, status, reason, active
           FROM history_artifact_results
          ORDER BY artifact_result_id`,
      )
      .all() as unknown as CaseReader["artifactResults"];
    const activeResults = database
      .prepare(
        `SELECT artifact_result_id, run_id, profile_path
           FROM history_artifact_results WHERE active = 1
          ORDER BY profile_path`,
      )
      .all() as unknown as CaseReader["activeResults"];
    const findingRunIds = (
      database
        .prepare(
          "SELECT DISTINCT run_id FROM forensic_findings ORDER BY run_id",
        )
        .all() as unknown as { readonly run_id: string }[]
    ).map((row) => row.run_id);
    const activeFindingCount = Number(
      (
        database
          .prepare(
            `SELECT count(*) AS count
               FROM forensic_findings f
               JOIN history_artifact_results r
                 ON r.artifact_result_id = f.artifact_result_id
              WHERE r.active = 1`,
          )
          .get() as { readonly count: bigint }
      ).count,
    );
    const activeVisitFindingCount = Number(
      (
        database
          .prepare(
            `SELECT count(*) AS count
               FROM forensic_findings f
               JOIN history_artifact_results r
                 ON r.artifact_result_id = f.artifact_result_id
              WHERE r.active = 1 AND f.finding_kind = 'history_visit'`,
          )
          .get() as { readonly count: bigint }
      ).count,
    );
    return {
      runs,
      runSourceCount,
      artifactResults,
      activeResults,
      findingRunIds,
      activeFindingCount,
      activeVisitFindingCount,
    };
  } finally {
    database.close();
  }
}

async function ingestUserDataDir(
  source: string,
  caseDirectory: string,
): Promise<void> {
  await writeFixtureFile(join(source, "Local State"), "{}\n");
  const ingest = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
  expect(ingest.status).toBe(0);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Analysis Run identity and supersede", () => {
  it("records run identity and supersedes each artifact while retaining lineage", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-run-supersede-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await createValidHistory(
      join(source, "Default", "History"),
      "alpha.example",
    );
    const caseDirectory = join(root, "CASE-SUPERSEDE");
    await ingestUserDataDir(source, caseDirectory);

    const first = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(first.status).toBe(0);
    const firstResult = parseJson<AnalyseResult>(first.stdout);
    expect(firstResult).toMatchObject({
      command: "analyse",
      exitState: "complete",
      history: { status: "complete", unavailableProfileCount: 0 },
    });
    expect(firstResult.history.findingCount).toBeGreaterThan(0);

    const second = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(second.status).toBe(0);
    const secondResult = parseJson<AnalyseResult>(second.stdout);
    expect(secondResult.exitState).toBe("complete");
    expect(secondResult.runId).not.toBe(firstResult.runId);

    const state = readCase(caseDirectory);

    // AC1: each Analysis Run records id, start, end, tool version, command
    // line, Source, and exit state.
    expect(state.runs).toHaveLength(2);
    for (const runRow of state.runs) {
      expect(runRow.started_at).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(runRow.finished_at).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(Date.parse(runRow.finished_at as string)).toBeGreaterThanOrEqual(
        Date.parse(runRow.started_at),
      );
      expect(runRow.tool_version.length).toBeGreaterThan(0);
      expect(JSON.parse(runRow.invocation_json)).toContain("analyse");
      expect(runRow.status).toBe("complete");
    }
    expect(state.runs.map((runRow) => runRow.run_id)).toEqual([
      firstResult.runId,
      secondResult.runId,
    ]);
    expect(state.runSourceCount).toBe(2);

    // AC2: the rerun supersedes at artifact granularity, every prior row is
    // retained (lineage), and exactly one row stays active.
    expect(state.artifactResults).toHaveLength(2);
    expect(state.activeResults).toHaveLength(1);
    expect(state.activeResults[0]?.run_id).toBe(secondResult.runId);
    const supersededRun = state.artifactResults.find(
      (row) => row.active === 0n,
    );
    expect(supersededRun?.run_id).toBe(firstResult.runId);
    expect(state.findingRunIds).toEqual(
      [firstResult.runId, secondResult.runId].sort(),
    );

    // Supersede, not accumulate: active Findings equal one run's worth even
    // though both runs' rows are retained in the Case.
    expect(state.activeFindingCount).toBe(firstResult.history.findingCount);

    // Queries resolve only the latest run's Findings, not both runs combined.
    const page = parseJson<HistoryPage>(
      runCli(["history", "--case", caseDirectory, "--limit", "100", "--json"])
        .stdout,
    );
    expect(page.items.length).toBe(state.activeVisitFindingCount);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("records a failed Analysis Run and a failed rerun supersedes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-run-failed-"));
    temporaryRoots.push(root);

    // A first run whose only artifact is unreadable records the failed exit
    // state and supersedes nothing.
    const brokenSource = join(root, "broken");
    await writeFixtureFile(
      join(brokenSource, "Default", "History"),
      "not-a-sqlite-database\n",
    );
    const brokenCase = join(root, "CASE-FAILED");
    await ingestUserDataDir(brokenSource, brokenCase);

    const failed = runCli(["analyse", "--case", brokenCase, "--json"]);
    expect(failed.status).toBe(3);
    expect(parseJson<AnalyseResult>(failed.stdout)).toMatchObject({
      exitState: "failed",
      history: { analysedProfileCount: 0, unavailableProfileCount: 1 },
    });
    const failedState = readCase(brokenCase);
    expect(failedState.runs).toHaveLength(1);
    expect(failedState.runs[0]?.status).toBe("failed");
    expect(failedState.runs[0]?.finished_at).toMatch(/^\d{4}/);
    expect(failedState.activeResults).toHaveLength(0);
    expect(failedState.artifactResults[0]?.status).toBe("unavailable");
    expect(failedState.artifactResults[0]?.reason).not.toBeNull();
    expect(failedState.activeFindingCount).toBe(0);

    // A failed rerun over previously good results must not supersede them.
    const goodSource = join(root, "good");
    await createValidHistory(
      join(goodSource, "Default", "History"),
      "beta.example",
    );
    const goodCase = join(root, "CASE-FAILED-RERUN");
    await ingestUserDataDir(goodSource, goodCase);

    const clean = runCli(["analyse", "--case", goodCase, "--json"]);
    expect(clean.status).toBe(0);
    const cleanResult = parseJson<AnalyseResult>(clean.stdout);
    const before = readCase(goodCase);
    expect(before.activeResults).toHaveLength(1);
    const activeBefore = before.activeResults[0]?.artifact_result_id;

    // Corrupt the Working Copy so the rerun fails Working Copy verification.
    await writeFile(
      join(goodCase, "working-copy", "Default", "History"),
      "tampered\n",
    );
    const rerun = runCli(["analyse", "--case", goodCase, "--json"]);
    expect(rerun.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(rerun.stderr)).toMatchObject({
      code: "WORKING_COPY_INTEGRITY_REFUSAL",
    });

    // No new run recorded, the earlier active result is untouched, and the
    // prior run's Findings stay queryable.
    const after = readCase(goodCase);
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]?.run_id).toBe(cleanResult.runId);
    expect(after.activeResults).toHaveLength(1);
    expect(after.activeResults[0]?.artifact_result_id).toBe(activeBefore);
    const page = parseJson<HistoryPage>(
      runCli(["history", "--case", goodCase, "--limit", "100", "--json"])
        .stdout,
    );
    expect(page.items.length).toBe(after.activeVisitFindingCount);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("isolates a failing artifact so other artifacts stay queryable across reruns", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-run-partial-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await createValidHistory(
      join(source, "Default", "History"),
      "good.example",
    );
    await writeFixtureFile(
      join(source, "Profile 1", "History"),
      "not-a-sqlite-database\n",
    );
    const caseDirectory = join(root, "CASE-PARTIAL");
    await ingestUserDataDir(source, caseDirectory);

    const first = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // AC5: a partial analysis has its own exit code.
    expect(first.status).toBe(2);
    const firstResult = parseJson<AnalyseResult>(first.stdout);
    expect(firstResult).toMatchObject({
      exitState: "partial",
      history: {
        status: "partial",
        analysedProfileCount: 1,
        unavailableProfileCount: 1,
      },
    });

    const firstState = readCase(caseDirectory);
    expect(firstState.runs[0]?.status).toBe("partial");
    // Only the defensible Default artifact is active; the failing Profile 1
    // artifact supersedes nothing.
    expect(firstState.activeResults).toHaveLength(1);
    expect(firstState.activeResults[0]?.profile_path).toBe("Default");
    const failingFirst = firstState.artifactResults.find(
      (row) => row.profile_path === "Profile 1",
    );
    expect(failingFirst?.status).toBe("unavailable");
    expect(failingFirst?.active).toBe(0n);

    // AC4: the healthy artifact's Findings stay queryable despite the failure.
    const goodPage = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--profile",
        "Default",
        "--limit",
        "100",
        "--json",
      ]).stdout,
    );
    expect(goodPage.items.length).toBeGreaterThan(0);

    // Rerun: the Default artifact supersedes its prior row, Profile 1 stays
    // unavailable and untouched.
    const second = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(second.status).toBe(2);
    const secondResult = parseJson<AnalyseResult>(second.stdout);

    const secondState = readCase(caseDirectory);
    expect(secondState.runs).toHaveLength(2);
    // Two runs each wrote a Default and a Profile 1 artifact row (lineage).
    expect(secondState.artifactResults).toHaveLength(4);
    expect(secondState.activeResults).toHaveLength(1);
    expect(secondState.activeResults[0]?.profile_path).toBe("Default");
    expect(secondState.activeResults[0]?.run_id).toBe(secondResult.runId);
    // No Profile 1 artifact result is ever active.
    expect(
      secondState.artifactResults.filter(
        (row) => row.profile_path === "Profile 1" && row.active === 1n,
      ),
    ).toHaveLength(0);

    const rerunPage = parseJson<HistoryPage>(
      runCli([
        "history",
        "--case",
        caseDirectory,
        "--profile",
        "Default",
        "--limit",
        "100",
        "--json",
      ]).stdout,
    );
    expect(rerunPage.items.length).toBe(secondState.activeVisitFindingCount);
    expect(rerunPage.items.length).toBeGreaterThan(0);
  });
});
