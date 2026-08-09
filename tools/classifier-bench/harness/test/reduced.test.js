'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateFixture, fixtureCensus } = require('../lib/fixture');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..', '..');
const { projectRows } = require(path.join(ROOT, 'scripts', 'make_reduced_fixture'));
const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy-reduced.json'), 'utf8'));
const sourceRows = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixture', 'fixture_labelled.json'), 'utf8'));
const reducedRows = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixture', 'fixture_reduced.json'), 'utf8'));

test('reduced fixture is a deterministic projection of the frozen fixture', () => {
  assert.deepEqual(reducedRows, projectRows(sourceRows, taxonomy));
  assert.equal(reducedRows.length, 208);
  assert.ok(reducedRows.every((row) => row.source_labels_20.length > 0));
});

test('reduced fixture and taxonomy satisfy the shared validation contract', () => {
  const validation = validateFixture(reducedRows, taxonomy);
  assert.deepEqual(validation.violations, []);
  const census = fixtureCensus(reducedRows, taxonomy);
  assert.equal(census.row_count, 208);
  assert.equal(census.persona_count, 2);
  assert.equal(census.multi_label_rows, 51);
  assert.deepEqual(
    Object.fromEntries(Object.entries(census.per_label).map(([id, value]) => [id, value.gold_rows])),
    {
      communication_social: 27,
      search_query: 66,
      news_entertainment: 43,
      technology_work: 66,
      shopping_finance: 26,
      travel_transport_accommodation: 21,
      unclassified: 10,
    }
  );
});

test('reduced taxonomy accounts for every original core label exactly once', () => {
  const mapped = taxonomy.core.flatMap((label) => label.source_labels || []);
  const excluded = taxonomy.excluded_source_labels;
  assert.equal(new Set(mapped).size, mapped.length);
  assert.equal(mapped.filter((label) => excluded.includes(label)).length, 0);
  const original = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy.json'), 'utf8'))
    .core.map((label) => label.id).sort();
  assert.deepEqual([...mapped, ...excluded].sort(), original);
});

const reducedResultsDir = process.env.REDUCED_RESULTS_DIR || path.join(ROOT, 'results', 'reduced');

test('generated reduced results contain both candidates and complete row evidence', { skip: !fs.existsSync(reducedResultsDir) }, () => {
  const dir = reducedResultsDir;
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  assert.equal(results.environment.network_isolated, true);
  assert.equal(results.taxonomy.id, 'reduced-7-v1');
  assert.equal(results.taxonomy.post_hoc, true);
  assert.equal(results.taxonomy.core_label_count, 7);
  assert.equal(results.fixture.census.row_count, 208);
  assert.deepEqual(results.failures, []);
  assert.deepEqual(
    results.candidates.map((candidate) => candidate.id).sort(),
    ['bge-micro-v2-labelsim-v2', 'potion-base-8M-labelsim-v2']
  );
  const determinismPath = path.join(dir, 'determinism-summary.json');
  const determinism = fs.existsSync(determinismPath)
    ? JSON.parse(fs.readFileSync(determinismPath, 'utf8'))
    : null;
  for (const candidate of results.candidates) {
    assert.equal(candidate.determinism.same_process_repeat_match, true);
    assert.equal(Object.keys(candidate.per_class).length, 7);
    assert.equal(candidate.macro_f1_fixed_core.label_count, 7);
    const mainPath = path.join(dir, 'predictions', `${candidate.id}.${process.arch}.main.json`);
    const main = JSON.parse(fs.readFileSync(mainPath, 'utf8'));
    assert.equal(main.rows.length, 208);
    assert.equal(main.taxonomy, 'reduced-7-v1');

    if (determinism) {
      assert.equal(determinism.per_candidate[candidate.id].measured, true);
      assert.equal(determinism.per_candidate[candidate.id].runs, 3);
      assert.equal(determinism.per_candidate[candidate.id].match, true);
      assert.equal(determinism.per_candidate[candidate.id].raw_score_match, true);
    } else {
      for (const tag of ['det1', 'det2']) {
        const repeatPath = path.join(dir, 'predictions', `${candidate.id}.${process.arch}.${tag}.json`);
        assert.equal(fs.existsSync(repeatPath), true, `missing ${repeatPath}`);
      }
    }
  }
});
