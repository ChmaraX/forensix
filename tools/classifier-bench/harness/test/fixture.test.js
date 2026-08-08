'use strict';
// Fixture validation (V1-V8 from the audit's validation contract) run against
// the real committed fixture, plus the frozen candidate-input projection.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  loadFixture, loadTaxonomy, validateFixture, fixtureCensus,
  candidateView, normalisedInput, titleOnlyInput,
} = require('../lib/fixture');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..', '..');
const rows = loadFixture(path.join(ROOT, 'fixture'));
const taxonomy = loadTaxonomy(ROOT);

test('the committed fixture passes every validation rule', () => {
  const r = validateFixture(rows, taxonomy);
  assert.deepEqual(r.violations, [], `violations: ${JSON.stringify(r.violations.slice(0, 10), null, 2)}`);
  assert.equal(r.ok, true);
});

test('fixture is the owner-approved 208 rows', () => {
  assert.equal(rows.length, 208);
});

test('V8: every in-site search row carries search_query', () => {
  const bad = rows.filter((r) => r.in_site_search && !r.labels.includes('search_query'));
  assert.deepEqual(bad.map((r) => r.row_id), [], 'in-site search endpoints must be labelled consistently with search-engine result pages');
});

test('A4: the census reports TWO personas, matching the recon documents', () => {
  const c = fixtureCensus(rows, taxonomy);
  assert.equal(c.persona_count, 2, 'the 2021 Chromebook and 2021 Takeout packages are the same staged persona');
  assert.equal(c.personas['eli-flatt'], 178);
  assert.equal(c.personas['rafael-shell'], 30);
});

test('census exposes the concentration that limits statistical power', () => {
  const c = fixtureCensus(rows, taxonomy);
  assert.ok(c.distinct_etld1 < c.row_count / 4, 'rows are heavily clustered by domain');
  assert.ok(c.top_domain.share > 0.4, 'one domain dominates and that must be visible');
  assert.ok(c.rows_in_shared_url_groups > 0, 'shared-URL groups must be flagged, not hidden');
});

// AUDIT REGRESSION. scripts/label_fixture.py used `host.startswith("chrome")` as
// its browser-internal guard, which also matched the REAL host chrome.google.com
// and returned it as its own registrable domain. That understated concentration
// and resampled 21 google.com rows as an independent bootstrap cluster. etld1 is
// the bootstrap cluster unit and the power-floor support unit, so this is a
// scoring field, not a cosmetic one.
test('eTLD+1: chrome.google.com collapses to google.com, browser-internal stays internal', () => {
  const webStore = rows.filter((r) => r.url.startsWith('https://chrome.google.com/'));
  assert.ok(webStore.length > 0, 'fixture must still contain Chrome Web Store rows');
  for (const r of webStore) {
    assert.equal(r.etld1, 'google.com', `${r.row_id}: chrome.google.com is a real host under google.com`);
  }

  const internal = rows.filter((r) => /^(chrome|chrome-extension|chrome-native|about):/.test(r.url));
  assert.ok(internal.length > 0, 'fixture must still contain browser-internal rows');
  for (const r of internal) {
    assert.match(r.etld1, /:\/\//, `${r.row_id}: browser-internal rows have no registrable domain`);
    assert.notEqual(r.etld1, 'google.com', 'a browser-internal surface is not a web origin');
  }

  // The concentration the report warns about must be the true one.
  const c = fixtureCensus(rows, taxonomy);
  assert.equal(c.top_domain.etld1, 'google.com');
  assert.equal(c.top_domain.rows, 121, 'google.com is 121 rows once chrome.google.com is folded in');
  assert.ok(c.top_domain.share > 0.58 && c.top_domain.share < 0.59, `top-domain share was ${c.top_domain.share}`);
});

test('zero-gold labels are reported, not silently absent', () => {
  const c = fixtureCensus(rows, taxonomy);
  const zero = Object.entries(c.per_label).filter(([, v]) => v.gold_rows === 0).map(([k]) => k);
  assert.ok(zero.includes('adult_sexual_content'), 'Adult has no gold rows in this fixture and that must be explicit');
  assert.ok(zero.includes('gambling'));
  assert.ok(zero.includes('cryptocurrency_exchanges'));
  assert.ok(zero.includes('employment_job_seeking'));
});

test('M1: the candidate view carries NO gold labels or labeller metadata', () => {
  const v = candidateView(rows[0]);
  assert.deepEqual(Object.keys(v).sort(), ['row_id', 'title', 'url']);
  assert.equal(v.labels, undefined);
  assert.equal(v.rationale, undefined);
  assert.equal(v.ambiguous, undefined);
  assert.equal(v.labeller, undefined);
  assert.throws(() => { 'use strict'; v.title = 'mutated'; }, TypeError, 'the view must be frozen');
});

test('input normalisation is byte-identical and deterministic', () => {
  const r = { title: '  Hello  ', url: '  https://x.test/a  ' };
  assert.equal(normalisedInput(r), 'Hello https://x.test/a');
  assert.equal(titleOnlyInput(r), 'Hello');
  assert.equal(normalisedInput(r), normalisedInput(r));
});

test('the validator actually rejects a broken row', () => {
  const broken = [{ ...rows[0], labels: ['not_a_real_label'] }];
  const r = validateFixture(broken, taxonomy);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'V1'));
});

test('the validator rejects a mutually-exclusive pair', () => {
  const broken = [{ ...rows[0], labels: ['unclassified', 'ads_trackers_infrastructure'] }];
  const r = validateFixture(broken, taxonomy);
  assert.ok(r.violations.some((v) => v.rule === 'V2'));
});

test('the validator rejects a tampered row_id', () => {
  const broken = [{ ...rows[0], row_id: 'row-0000-deadbeefcafe' }];
  const r = validateFixture(broken, taxonomy);
  assert.ok(r.violations.some((v) => v.rule === 'V3'));
});

test('taxonomy carries the frozen supervision text for every core label', () => {
  assert.equal(taxonomy.core.length, 20);
  for (const l of taxonomy.core) {
    assert.ok(l.name && l.name.length > 2, `${l.id} missing name`);
    assert.ok(l.question && l.question.length > 10, `${l.id} missing forensic question`);
    assert.ok(l.boundary && l.boundary.length > 20, `${l.id} missing boundary rule`);
  }
  assert.equal(taxonomy.overlay_in_scope, false, 'overlay scope must be declared, not left implicit');
});
