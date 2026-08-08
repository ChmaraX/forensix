'use strict';
// Regression tests for the metric defects the ChmaraX/forensix#137 audit proved.
// Each test names the defect it locks down.

const test = require('node:test');
const assert = require('node:assert');

const {
  classificationReport, coverageAccuracySweep, specialCategoryConfusion,
  multiLabelRowMetrics, confusionPairs, bootstrapMacroF1, charitableReport,
  LABEL_STATE,
} = require('../lib/metrics');
const { rawPrediction, applyDecision, coverageOf, UNCLASSIFIED } = require('../lib/prediction');

const LABELS = ['a', 'b', 'unclassified'];

function row(id, labels, etld1 = 'x.test', persona = 'p1') {
  return { row_id: id, title: id, url: `https://${etld1}/${id}`, labels, etld1, persona_id: persona, ambiguous: false };
}
function pred(labels, extra = {}) {
  return {
    labels, top1: labels[0] ?? null,
    abstained: labels.length === 1 && labels[0] === UNCLASSIFIED,
    abstainReason: null, rawTop1: labels[0] ?? null, rawTop1Score: 1, margin: 1,
    ranked: labels.map((l) => ({ label: l, score: 1 })), scoreAxis: 'test', ...extra,
  };
}

test('B6: false positives on a zero-gold label are NOT free', () => {
  // Previously: a label with zero gold rows was dropped from macro-F1 entirely,
  // so a candidate could fire it on every row at no cost.
  const rows = [row('r1', ['a']), row('r2', ['a']), row('r3', ['a'])];
  const clean = rows.map(() => pred(['a']));
  const spammer = rows.map(() => pred(['a', 'b'])); // 'b' has zero gold rows

  const cleanRep = classificationReport(rows, clean, LABELS);
  const spamRep = classificationReport(rows, spammer, LABELS);

  assert.equal(cleanRep.per_class.b.state, LABEL_STATE.NO_GOLD_NO_PREDICTIONS);
  assert.equal(cleanRep.per_class.b.f1, null, 'untestable label must be null, never 0');
  assert.equal(spamRep.per_class.b.state, LABEL_STATE.NO_GOLD_WITH_FP);
  assert.equal(spamRep.per_class.b.f1, 0);
  assert.ok(
    spamRep.macro_f1_evaluable.value < cleanRep.macro_f1_evaluable.value,
    `spamming a zero-gold label must lower macro-F1 (${spamRep.macro_f1_evaluable.value} vs ${cleanRep.macro_f1_evaluable.value})`
  );
});

test('B5: abstention scores identically regardless of how a candidate spells it', () => {
  // Previously: `labels: []` and `labels: ['unclassified']` produced macro-F1
  // 0.5 vs 1.0 for identical behaviour. The single decision function now emits
  // exactly one spelling, so the divergence cannot recur.
  const scores = { a: 0.9, b: 0.1 };
  const listMiss = applyDecision(rawPrediction({ scores: {}, scoreAxis: 'rule-match', listHit: false }), {});
  const lowScore = applyDecision(rawPrediction({ scores, scoreAxis: 'cosine' }), { absoluteThreshold: 0.99 });

  assert.deepEqual(listMiss.labels, [UNCLASSIFIED]);
  assert.deepEqual(lowScore.labels, [UNCLASSIFIED]);
  assert.equal(listMiss.abstained, true);
  assert.equal(lowScore.abstained, true);
  assert.notEqual(listMiss.abstainReason, lowScore.abstainReason, 'reasons must stay distinguishable');
  assert.equal(lowScore.rawTop1, 'a', 'ungated top-1 must survive abstention for the sweep');
});

test('B7: lowering the sweep threshold recovers correct answers', () => {
  // Previously: the candidate collapsed top1 to `unclassified` before the sweep,
  // so extra covered rows at a lower threshold could never score correct — the
  // committed run showed 14 correct at t=0.10 AND 14 at t=0.15.
  const rows = [row('r1', ['a']), row('r2', ['a']), row('r3', ['a'])];
  const raws = [
    rawPrediction({ scores: { a: 0.9, b: 0.1 }, scoreAxis: 'cosine' }), // margin 0.8
    rawPrediction({ scores: { a: 0.5, b: 0.4 }, scoreAxis: 'cosine' }), // margin 0.1
    rawPrediction({ scores: { a: 0.5, b: 0.45 }, scoreAxis: 'cosine' }), // margin 0.05
  ];
  const sweep = coverageAccuracySweep(rows, raws, [0.5, 0.09, 0.01], { absoluteThreshold: 0 }, 'marginThreshold');
  const [high, mid, low] = sweep;

  assert.equal(high.covered_rows, 1);
  assert.equal(mid.covered_rows, 2);
  assert.equal(low.covered_rows, 3);
  assert.ok(low.correct_lenient > mid.correct_lenient, 'more coverage must be able to yield more correct');
  assert.equal(low.correct_lenient, 3);
  assert.equal(low.accuracy_lenient, 1);
});

test('B3/S4: Adult FP is measurable on gold-negative rows; FN is explicitly unmeasurable', () => {
  const rows = [row('r1', ['a']), row('r2', ['a'])];
  const preds = [pred(['a']), pred(['adult_sexual_content'])];
  const conf = specialCategoryConfusion(rows, preds, 'adult_sexual_content');

  assert.equal(conf.gold_positives, 0);
  assert.equal(conf.false_positive.measurable, true, 'FP is measurable against gold-negative rows');
  assert.equal(conf.false_positive.count, 1);
  assert.equal(conf.false_negative.measurable, false, 'FN is not measurable without gold-positive rows');
  assert.equal(conf.false_negative.count, null, 'unmeasurable FN must be null, never 0');
  assert.match(conf.false_negative.note, /UNMEASURABLE/);
});

test('rule-of-three upper bound is emitted when zero false positives are observed', () => {
  const rows = Array.from({ length: 208 }, (_, i) => row(`r${i}`, ['a']));
  const preds = rows.map(() => pred(['a']));
  const conf = specialCategoryConfusion(rows, preds, 'adult_sexual_content');
  assert.equal(conf.false_positive.count, 0);
  assert.ok(Math.abs(conf.false_positive.rate_upper_95 - 3 / 208) < 1e-12);
});

test('macro-F1 policies differ and both are reported', () => {
  const rows = [row('r1', ['a']), row('r2', ['a'])];
  const preds = [pred(['a']), pred(['a'])];
  const rep = classificationReport(rows, preds, LABELS);
  assert.equal(rep.macro_f1_evaluable.value, 1, 'only label a is evaluable and it is perfect');
  assert.ok(rep.macro_f1_fixed_core.value < 1, 'fixed-core averages over untestable labels too');
  assert.equal(rep.macro_f1_fixed_core.label_count, LABELS.length);
});

test('micro-F1, exact-set match and Jaccard are computed for multi-label rows', () => {
  const rows = [row('r1', ['a', 'b']), row('r2', ['a'])];
  const preds = [pred(['a']), pred(['a'])];
  const rep = classificationReport(rows, preds, LABELS);
  const rm = multiLabelRowMetrics(rows, preds);
  assert.ok(rep.micro_f1 > 0 && rep.micro_f1 < 1);
  assert.equal(rm.exact_set_match, 0.5);
  assert.ok(Math.abs(rm.mean_jaccard - 0.75) < 1e-12);
});

test('confusion pairs record what a missed gold label was confused with, including ABSTAIN', () => {
  const rows = [row('r1', ['a']), row('r2', ['a'])];
  const preds = [pred(['b']), pred([UNCLASSIFIED], { abstained: true })];
  const pairs = confusionPairs(rows, preds, LABELS);
  assert.equal(pairs.a.b, 1);
  assert.equal(pairs.a.ABSTAIN, 1);
});

test('bootstrap clusters by eTLD+1 and is deterministic under a fixed seed', () => {
  const rows = [
    row('r1', ['a'], 'one.test'), row('r2', ['a'], 'one.test'),
    row('r3', ['a'], 'two.test'), row('r4', ['b'], 'three.test'),
  ];
  const preds = [pred(['a']), pred(['a']), pred(['b']), pred(['b'])];
  const a = bootstrapMacroF1(rows, preds, LABELS, { resamples: 200, seed: 137 });
  const b = bootstrapMacroF1(rows, preds, LABELS, { resamples: 200, seed: 137 });
  assert.equal(a.applicable, true);
  assert.equal(a.cluster_unit, 'etld1');
  assert.equal(a.cluster_count, 3);
  assert.deepEqual([a.ci95_low, a.ci95_high], [b.ci95_low, b.ci95_high], 'same seed must give the same interval');
});

test('coverage has one definition for every candidate', () => {
  const preds = [pred(['a']), pred([UNCLASSIFIED], { abstained: true }), pred(['b'])];
  assert.ok(Math.abs(coverageOf(preds) - 2 / 3) < 1e-12);
});

test('multi-label emission never mixes unclassified with a positive label', () => {
  const raw = rawPrediction({ scores: { a: 0.9, unclassified: 0.89, b: 0.1 }, scoreAxis: 'cosine' });
  const p = applyDecision(raw, { absoluteThreshold: 0, marginThreshold: 0, multiLabelDelta: 0.05 });
  assert.ok(p.labels.includes('a'));
  assert.ok(!p.labels.includes(UNCLASSIFIED), 'unclassified asserts absence of signal; it cannot co-occur');
});

test('ranking ties break deterministically by label id', () => {
  const raw = rawPrediction({ scores: { b: 0.5, a: 0.5 }, scoreAxis: 'cosine' });
  const p1 = applyDecision(raw, {});
  const p2 = applyDecision(rawPrediction({ scores: { a: 0.5, b: 0.5 }, scoreAxis: 'cosine' }), {});
  assert.equal(p1.top1, 'a');
  assert.equal(p2.top1, 'a', 'insertion order must not change the winner');
});

// AUDIT REGRESSION. charitableReport replaced the gold set with the candidate's
// ENTIRE predicted set on any partial hit, so an unrelated false positive on an
// ambiguous row silently became a true positive. Measured effect on the real
// run: it manufactured gold-positive `adult_sexual_content` rows on a fixture
// whose central claim is that Adult has zero gold rows.
test('charitable scoring can never manufacture a gold positive for a zero-gold label', () => {
  const ambiguous = { ...row('r1', ['a']), ambiguous: true };
  const rows = [ambiguous, row('r2', ['a'], 'y.test'), row('r3', ['a'], 'z.test')];
  // The candidate hits the defensible label 'a' AND fires 'b', which has no gold
  // rows anywhere in this fixture.
  const preds = [pred(['a', 'b']), pred(['a']), pred(['a'])];

  const charitable = charitableReport(rows, preds, LABELS);

  assert.equal(
    charitable.per_class.b.goldPositives, 0,
    'a label with no gold rows must still have no gold rows after charitable re-scoring'
  );
  assert.equal(
    charitable.per_class.b.state, LABEL_STATE.NO_GOLD_WITH_FP,
    'the unrelated prediction must remain a false positive, not become a true positive'
  );
  assert.equal(charitable.per_class.b.tp, 0, 'no true positive may be invented');
  assert.equal(charitable.per_class.b.fp, 1, 'the false positive must survive charity');
});

test('charitable scoring still forgives a defensible alternative on an ambiguous row', () => {
  // Multi-label ambiguous row: the labeller could not choose between a and b.
  // A candidate that picks only 'a' should not be charged for missing 'b'.
  const ambiguous = { ...row('r1', ['a', 'b']), ambiguous: true };
  const rows = [ambiguous];
  const preds = [pred(['a'])];

  const strict = classificationReport(rows, preds, LABELS);
  const charitable = charitableReport(rows, preds, LABELS);

  assert.equal(strict.per_class.b.fn, 1, 'strict scoring charges the miss');
  assert.equal(charitable.per_class.b.fn, 0, 'charitable scoring forgives a defensible alternative');
  assert.equal(charitable.per_class.a.tp, 1);
});

test('charitable scoring leaves non-ambiguous rows untouched', () => {
  const rows = [row('r1', ['a']), row('r2', ['a'], 'y.test')];
  const preds = [pred(['a', 'b']), pred(['a'])];
  const strict = classificationReport(rows, preds, LABELS);
  const charitable = charitableReport(rows, preds, LABELS);
  assert.equal(charitable.per_class.b.fp, strict.per_class.b.fp, 'charity applies only to flagged rows');
  assert.equal(charitable.macro_f1_evaluable.value, strict.macro_f1_evaluable.value);
});
