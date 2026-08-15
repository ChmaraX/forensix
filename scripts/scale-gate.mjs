#!/usr/bin/env node
// ForensiX scale gate (issue #188, AC4).
//
// Drives the compiled analyzer CLI through ingest -> analyse -> export over a
// seeded History of N visits and asserts the pipeline completes within a finite
// wall-clock budget while returning the exact expected row count. The default
// size is a bounded CI gate; the million-row case is invoked manually before a
// release with a larger budget:
//
//   node scripts/scale-gate.mjs 25000    180000   # CI gate (default)
//   node scripts/scale-gate.mjs 1000000  1800000  # manual pre-release
//
// Exit 0 only when the counts are exact and the run stayed within budget.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const rowCount = Number.parseInt(process.argv[2] ?? "25000", 10);
const budgetMs = Number.parseInt(process.argv[3] ?? "180000", 10);
const COMPILED_CLI = resolve("cli/dist/cli.js");

if (!Number.isInteger(rowCount) || rowCount < 1) {
  process.stderr.write(`invalid row count: ${process.argv[2]}\n`);
  process.exit(2);
}

/** @param {readonly string[]} argv */
function runCli(argv) {
  return spawnSync(process.execPath, [COMPILED_CLI, ...argv], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** @param {string} path @param {number} count */
function seedHistory(path, count) {
  mkdirSync(dirname(path), { recursive: true });
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
    `);
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
       VALUES (?, ?, ?, 0, '', 1, 0, ?, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL)`,
    );
    const base = 13_348_638_245_123_456n;
    database.exec("BEGIN");
    for (let i = 1; i <= count; i += 1) {
      const id = BigInt(i);
      const visitTime = base + id;
      insertUrl.run(id, `https://scale.example/${i}`, `Visit ${i}`, visitTime);
      insertVisit.run(id, id, visitTime, id);
    }
    database.exec("COMMIT");
  } finally {
    database.close();
  }
}

function main() {
  const root = mkdtempSync(join(tmpdir(), "forensix-scale-"));
  const started = Date.now();
  try {
    const source = join(root, "source");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "Local State"), "{}\n");
    const seedStart = Date.now();
    seedHistory(join(source, "Default", "History"), rowCount);
    const seedMs = Date.now() - seedStart;

    const caseDirectory = join(root, "CASE");
    const pipelineStart = Date.now();
    const ingest = runCli([
      "ingest",
      source,
      "--case",
      caseDirectory,
      "--json",
    ]);
    if (ingest.status !== 0) {
      throw new Error(`ingest failed (${ingest.status}): ${ingest.stderr}`);
    }
    const analyse = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      "UTC",
      "--json",
    ]);
    if (analyse.status !== 0) {
      throw new Error(`analyse failed (${analyse.status}): ${analyse.stderr}`);
    }
    const summary = JSON.parse(analyse.stdout);
    const committed = summary.history?.committedVisitCount;
    if (committed !== rowCount) {
      throw new Error(
        `expected ${rowCount} committed visits, got ${committed}`,
      );
    }
    const exportOut = join(root, "extract");
    const exported = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      exportOut,
      "--json",
    ]);
    if (exported.status !== 0) {
      throw new Error(`export failed (${exported.status}): ${exported.stderr}`);
    }
    const pipelineMs = Date.now() - pipelineStart;
    const totalMs = Date.now() - started;

    const report = {
      schema: "forensix/scale-gate/1",
      rowCount,
      budgetMs,
      seedMs,
      pipelineMs,
      totalMs,
      withinBudget: pipelineMs <= budgetMs,
      committedVisitCount: committed,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.withinBudget) {
      process.stderr.write(
        `scale-gate: FAILED — pipeline ${pipelineMs}ms exceeded budget ${budgetMs}ms\n`,
      );
      process.exit(1);
    }
    process.stderr.write(
      `scale-gate: OK — ${rowCount} visits in ${pipelineMs}ms (budget ${budgetMs}ms)\n`,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

main();
