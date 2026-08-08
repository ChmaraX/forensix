'use strict';
// Guards the code-only rescore path.
//
// `rescore.js` regenerates every fixture-dependent metric from the committed
// per-row predictions instead of re-running inference. That is only legitimate
// if it is EXACT: if reconstruction drifted from what the container measured,
// the published numbers would be a recomputation artefact rather than a
// measurement. These tests pin the two properties that make it safe:
//
//   1. Reconstruction from a persisted prediction file reproduces the decision
//      surface the metrics layer consumes.
//   2. Rescoring the CURRENT results against the CURRENT fixture is idempotent:
//      running it twice moves nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { predictionsFromFile, rawsFromFile, rescoreCandidate } = require('../rescore');
const { loadFixture, loadTaxonomy } = require('../lib/fixture');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..', '..');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results');
const resultsPath = path.join(RESULTS_DIR, 'results.json');
const hasResults = fs.existsSync(resultsPath);

// Fail closed: a caller that explicitly pointed RESULTS_DIR at a directory
// without results must not get a silent green run.
if (process.env.RESULTS_DIR && !hasResults) {
  throw new Error(`RESULTS_DIR=${process.env.RESULTS_DIR} was set but ${resultsPath} is absent; refusing to skip`);
}

test('reconstruction preserves the decision surface exactly', { skip: !hasResults && 'no results.json yet' }, () => {
  const rows = loadFixture(path.join(ROOT, 'fixture'));
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const arch = results.environment.arch;

  for (const c of results.candidates) {
    const pf = path.join(RESULTS_DIR, 'predictions', `${c.id}.${arch}.main.json`);
    assert.ok(fs.existsSync(pf), `${c.id}: committed predictions are the evidence; they must exist`);
    const file = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const preds = predictionsFromFile(rows, file);

    assert.equal(preds.length, rows.length, `${c.id}: every fixture row must be covered`);
    const byId = new Map(file.rows.map((r) => [r.row_id, r]));
    rows.forEach((row, i) => {
      const src = byId.get(row.row_id);
      assert.deepEqual(preds[i].labels, src.predicted, `${c.id}/${row.row_id}: labels must be verbatim`);
      assert.equal(preds[i].abstained, src.abstained);
    });

    // Coverage recomputed from the reconstruction must match what was published.
    const cov = preds.filter((p) => !p.abstained).length / preds.length;
    assert.ok(Math.abs(cov - c.coverage) < 1e-12, `${c.id}: coverage drifted (${cov} vs ${c.coverage})`);
  }
});

test('rescoring is idempotent — a second pass moves nothing', { skip: !hasResults && 'no results.json yet' }, () => {
  const rows = loadFixture(path.join(ROOT, 'fixture'));
  const taxonomy = loadTaxonomy(ROOT);
  const ids = taxonomy.core.map((l) => l.id);
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const arch = results.environment.arch;

  for (const c of results.candidates) {
    const pf = path.join(RESULTS_DIR, 'predictions', `${c.id}.${arch}.main.json`);
    const file = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const again = rescoreCandidate(rows, ids, c, file);
    for (const field of ['macro_f1_evaluable', 'macro_f1_fixed_core', 'macro_f1_powered_only']) {
      assert.ok(
        Math.abs((again[field].value ?? 0) - (c[field].value ?? 0)) < 1e-12,
        `${c.id}/${field}: rescore is not idempotent (${again[field].value} vs ${c[field].value})`
      );
    }
    assert.ok(Math.abs((again.micro_f1 ?? 0) - (c.micro_f1 ?? 0)) < 1e-12, `${c.id}: micro_f1 drifted`);
  }
});

test('rescore refuses to invent numbers when predictions are missing', () => {
  const rows = loadFixture(path.join(ROOT, 'fixture'));
  // A prediction file that does not cover every fixture row must throw rather
  // than silently score the rows it happens to have.
  assert.throws(
    () => predictionsFromFile(rows, { rows: [] }),
    /missing fixture row/,
    'an incomplete prediction artifact must be a hard failure'
  );
});

test('raw reconstruction keeps a family-5 miss as a definite absent', { skip: !hasResults && 'no results.json yet' }, () => {
  const rows = loadFixture(path.join(ROOT, 'fixture'));
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const arch = results.environment.arch;
  const strict = results.candidates.find((c) => c.id.includes('strict'));
  if (!strict) return;
  const file = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'predictions', `${strict.id}.${arch}.main.json`), 'utf8'));
  const raws = rawsFromFile(rows, file);
  const misses = raws.filter((r) => r.listHit === false).length;
  assert.ok(misses > 0, 'the overlap-removed configuration abstains by table miss, not by low score');
});
