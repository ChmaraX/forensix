'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { collectEnvironment } = require('./environment');

const ROW_COUNTS = [1e4, 1e5, 1e6].map((n) => Math.round(n));
const ARMS = ['plain', 'candidates'];
const OPS = ['cold_open', 'first_page', 'deep_page', 'filter_sort_indexed', 'filter_sort_nonindexed', 'attribution', 'export', 'report'];

const DATA_DIR = path.join(__dirname, '..', 'data');
const RESULTS_DIR = path.join(__dirname, '..', 'results');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RESULTS_DIR, { recursive: true });

function runNode(scriptRelPath, args) {
  const out = execFileSync('node', [path.join(__dirname, scriptRelPath), ...args], {
    maxBuffer: 1024 * 1024 * 64,
  });
  return JSON.parse(out.toString());
}

async function main() {
  const environment = collectEnvironment();
  const runs = [];
  const generation = [];

  const only = process.env.SCALE_BENCH_ONLY; // e.g. "10000:plain" for a quick smoke run
  for (const rows of ROW_COUNTS) {
    for (const arm of ARMS) {
      if (only && only !== `${rows}:${arm}`) continue;
      const dbPath = path.join(DATA_DIR, `case-${rows}-${arm}.db`);
      const outDir = path.join(DATA_DIR, `out-${rows}-${arm}`);
      fs.mkdirSync(outDir, { recursive: true });

      process.stderr.write(`[gen] rows=${rows} arm=${arm}\n`);
      const gen = runNode('gen_case.js', [dbPath, String(rows), arm]);
      generation.push(gen);

      for (const op of OPS) {
        // maxRSS is a monotonic process-lifetime high-water mark (§4.3) and these two ops have
        // small absolute baselines (~50-100MB), so their maxRSS *ratio* budgets (rows 7, 11) and
        // scaling budget (row 8) are sensitive to background-load noise between runs (research
        // doc §8.3: "re-run any arm whose max is >5x its p50"). Each is run as 3 independent
        // child-process trials (never repeated in one process — that would accumulate, exactly
        // the confound rows 7/8 already flag for the two-pass Candidates arm) and the *median*
        // trial is kept.
        const TRIALS = op === 'export' || op === 'report' ? 3 : op === 'attribution' ? 3 : 1;
        let chosen = null;
        const trialResults = [];
        for (let t = 0; t < TRIALS; t++) {
          process.stderr.write(`[run] rows=${rows} arm=${arm} op=${op} trial=${t + 1}/${TRIALS}\n`);
          const params = JSON.stringify({ dbPath, op, rows, arm, outDir });
          trialResults.push(runNode('op_runner.js', [params]));
        }
        if (TRIALS === 1) {
          chosen = trialResults[0];
        } else if (op === 'attribution') {
          // No single .ms field to sort by — take the per-field median across trials instead.
          const med = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
          chosen = { ...trialResults[0] };
          chosen.result = {
            eqp: trialResults[0].result.eqp,
            p1_engine_ms: med(trialResults.map((r) => r.result.p1_engine_ms)),
            p2_raw_ms: med(trialResults.map((r) => r.result.p2_raw_ms)),
            p3_object_ms: med(trialResults.map((r) => r.result.p3_object_ms)),
            p4_ndjson_ms: med(trialResults.map((r) => r.result.p4_ndjson_ms)),
          };
          chosen.maxRSS = med(trialResults.map((r) => r.maxRSS));
          chosen.trials = trialResults.map((r) => ({ p1: r.result.p1_engine_ms, p2: r.result.p2_raw_ms, p3: r.result.p3_object_ms, p4: r.result.p4_ndjson_ms }));
        } else {
          const byMs = [...trialResults].sort((a, b) => a.result.ms - b.result.ms);
          chosen = byMs[Math.floor(byMs.length / 2)];
          chosen.trials = trialResults.map((r) => ({ ms: r.result.ms, maxRSS: r.maxRSS }));
        }
        runs.push(chosen);
        fs.writeFileSync(path.join(RESULTS_DIR, 'results.partial.json'), JSON.stringify({ environment, generation, runs }, null, 2));
      }
    }
  }

  fs.writeFileSync(path.join(RESULTS_DIR, 'results.json'), JSON.stringify({ environment, generation, runs }, null, 2));
  process.stderr.write('Done. results/results.json written.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
