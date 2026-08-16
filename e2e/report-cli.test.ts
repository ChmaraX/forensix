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

interface ReportSummary {
  readonly status: "ok";
  readonly command: "report";
  readonly reportSchema: string;
  readonly extractSchema: string;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly derivedDigest: string;
  readonly recomputedDigest: string;
  readonly integrity: "verified" | "altered";
  readonly reportPath: string;
  readonly generatedAt: string;
  readonly bytes: number;
}

async function createHistory(path: string): Promise<void> {
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
      INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES (1, 'https://alpha.example/', 'Alpha', 1, 0, 13348638245123456, 0);
      INSERT INTO visits
        (id, url, visit_time, from_visit, external_referrer_url, transition,
         segment_id, visit_duration, incremented_omnibox_typed_score,
         opener_visit, originator_cache_guid, originator_visit_id,
         originator_from_visit, originator_opener_visit, is_known_to_sync,
         consider_for_ntp_most_visited, visited_link_id, app_id)
      VALUES (1, 1, 13348638245123456, 0, '', 1, 0, 100, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL);
    `);
  } finally {
    database.close();
  }
}

async function ingestAndAnalyse(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "{}\n");
  await createHistory(join(source, "Default", "History"));
  const caseDirectory = join(root, "CASE-REPORT");
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
  return caseDirectory;
}

function exportExtract(caseDirectory: string, outDirectory: string): void {
  expect(
    runCli(["export", "--case", caseDirectory, "--out", outDirectory, "--json"])
      .status,
  ).toBe(0);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI HTML Report", () => {
  it("renders one self-contained HTML artifact that preserves Extract semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-report-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);
    const extract = join(root, "extract");
    exportExtract(caseDirectory, extract);

    const reportPath = join(root, "report.html");
    const command = runCli([
      "report",
      "--extract",
      extract,
      "--out",
      reportPath,
      "--json",
    ]);
    expect(command.status).toBe(0);
    const summary = parseJson<ReportSummary>(command.stdout);

    // The Report is derived from the Extract, not the Case.
    expect(summary.command).toBe("report");
    expect(summary.extractSchema).toBe("forensix/extract/1");
    expect(summary.findingCount).toBeGreaterThan(0);
    // Integrity: An untouched Extract verifies against its Manifest.
    expect(summary.integrity).toBe("verified");
    expect(summary.recomputedDigest).toBe(summary.derivedDigest);

    const html = await readFile(reportPath, "utf8");

    // One self-contained HTML file with no runtime network dependency.
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/src\s*=/i);
    expect(html).not.toMatch(/url\(\s*https?:/i);

    // Scope, Redaction State, Completeness Statement, Finding vs Candidate
    // type, Commit State, Provenance, and timestamp semantics are all present.
    expect(html).toContain("Scope");
    expect(html).toContain("Redaction State");
    expect(html).toContain("Completeness Statement");
    expect(html).toContain("forensix/redaction/1");
    expect(html).toContain("FINDING");
    expect(html).toContain("Candidates");
    expect(html).toContain("committed");
    // timestamp semantics preserved: Epoch Family + Declared Timezone survive.
    expect(html).toContain("epochFamily");
    expect(html).toContain("America/New_York");
    // Provenance citation survives to the Report.
    expect(html).toContain("visits:1");
  });

  it("renders empty string, absent, and unavailable differently with words", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-report-states-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);
    const extract = join(root, "extract");
    exportExtract(caseDirectory, extract);

    // Rewrite one Finding row so a single record carries all three states.
    const findingsPath = join(extract, "findings.jsonl");
    const first = (await readFile(findingsPath, "utf8")).trim().split("\n")[0];
    const row = JSON.parse(first) as Record<string, unknown>;
    row.fields = {
      emptyOne: { state: "value", value: "" },
      absentOne: { state: "absent" },
      unavailableOne: {
        state: "unavailable",
        reason: "encrypted_secret_without_key_material",
      },
    };
    await writeFile(findingsPath, `${JSON.stringify(row)}\n`);

    const reportPath = join(root, "states.html");
    expect(
      runCli(["report", "--extract", extract, "--out", reportPath, "--json"])
        .status,
    ).toBe(0);
    const html = await readFile(reportPath, "utf8");

    // Distinct WORDS, not color alone.
    expect(html).toContain(">empty string<");
    expect(html).toContain(">absent<");
    expect(html).toContain(
      "unavailable — encrypted_secret_without_key_material",
    );
    // The three markers use three different words.
    expect(html).not.toContain(">empty<absent");
  });

  it("changing an Extract row changes the Report; Case-only changes never bypass the boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-report-boundary-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);
    const extract = join(root, "extract");
    exportExtract(caseDirectory, extract);

    const reportPath = join(root, "report.html");
    expect(
      runCli(["report", "--extract", extract, "--out", reportPath, "--json"])
        .status,
    ).toBe(0);
    const baseline = await readFile(reportPath, "utf8");
    expect(baseline).toContain("https://alpha.example/");

    // (a) Change a row in the Extract → the Report changes to match.
    const findingsPath = join(extract, "findings.jsonl");
    const mutated = (await readFile(findingsPath, "utf8")).replaceAll(
      "https://alpha.example/",
      "https://mutated.example/",
    );
    expect(mutated).toContain("https://mutated.example/");
    await writeFile(findingsPath, mutated);

    const changedPath = join(root, "report-changed.html");
    const changed = parseJson<ReportSummary>(
      runCli(["report", "--extract", extract, "--out", changedPath, "--json"])
        .stdout,
    );
    const changedHtml = await readFile(changedPath, "utf8");
    expect(changedHtml).toContain("https://mutated.example/");
    expect(changedHtml).not.toContain("https://alpha.example/");
    expect(changedHtml).not.toBe(baseline);
    // The edited Extract no longer matches its recorded Manifest digest.
    expect(changed.integrity).toBe("altered");

    // Restore the Extract to its exported bytes.
    await writeFile(
      findingsPath,
      mutated.replaceAll("https://mutated.example/", "https://alpha.example/"),
    );

    // (b) Change ONLY the Case, leaving the Extract untouched. The Report is
    // generated from the same Extract and must be byte-identical to baseline,
    // proving the Case change cannot bypass the Extract boundary.
    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readBigInts: true,
    });
    try {
      const update = database
        .prepare(
          "UPDATE forensic_findings SET fields_json = REPLACE(fields_json, 'alpha.example', 'caseonly.example')",
        )
        .run();
      // Guard against a vacuous negative: the Case must really have changed, so
      // the byte-identical Report below proves the Extract boundary held.
      expect(Number(update.changes)).toBeGreaterThan(0);
    } finally {
      database.close();
    }

    const afterCasePath = join(root, "report-after-case.html");
    expect(
      runCli(["report", "--extract", extract, "--out", afterCasePath, "--json"])
        .status,
    ).toBe(0);
    const afterCaseHtml = await readFile(afterCasePath, "utf8");
    expect(afterCaseHtml).toBe(baseline);
    expect(afterCaseHtml).not.toContain("caseonly.example");
    expect(afterCaseHtml).toContain("https://alpha.example/");
  });

  it("refuses --case and a missing Extract, and never accepts a Case path", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-report-guard-"));
    temporaryRoots.push(root);

    // The report command must not accept --case: its only input is an Extract.
    const withCase = runCli([
      "report",
      "--case",
      join(root, "CASE"),
      "--out",
      join(root, "r.html"),
    ]);
    expect(withCase.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(withCase.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    // A directory without an Extract header is rejected.
    const empty = join(root, "empty");
    await mkdir(empty, { recursive: true });
    const missing = runCli([
      "report",
      "--extract",
      empty,
      "--out",
      join(root, "r.html"),
      "--json",
    ]);
    expect(missing.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(missing.stderr)).toMatchObject({
      code: "EXTRACT_NOT_FOUND",
    });
  });
});
