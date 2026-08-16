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

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHistoryDatabase,
  runCompiledCli,
  writeLocalState,
} from "./lib/chrome-history-schema.mjs";

const rowCount = Number.parseInt(process.argv[2] ?? "25000", 10);
const budgetMs = Number.parseInt(process.argv[3] ?? "180000", 10);

if (!Number.isInteger(rowCount) || rowCount < 1) {
  process.stderr.write(`invalid row count: ${process.argv[2]}\n`);
  process.exit(2);
}

const runCli = runCompiledCli;

/** @param {string} path @param {number} count */
function seedHistory(path, count) {
  createHistoryDatabase(path, (database) => {
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
  });
}

function main() {
  const root = mkdtempSync(join(tmpdir(), "forensix-scale-"));
  const started = Date.now();
  try {
    const source = join(root, "source");
    mkdirSync(source, { recursive: true });
    writeLocalState(source);
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
