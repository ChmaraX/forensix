'use strict';
// Metrics per ChmaraX/forensix#137 §3, rewritten after the audit round.
//
// What the audit proved wrong in the previous version, and what is fixed here:
//
//  1. Zero-gold labels were dropped from macro-F1, so false positives on them
//     were free. A candidate that fired `adult_sexual_content` on every row
//     scored identically to one that never fired it. FIXED: a label with zero
//     gold rows but >=1 prediction has precision 0 and DOES enter the
//     evaluable-label macro. Both macro policies are published.
//  2. `f1: null` meant two opposite things ("unscorable" and "scored zero").
//     FIXED: every per-class entry carries an explicit `state` enum.
//  3. Adult FP and FN were conflated and both reported unmeasurable. With 208
//     gold-negative rows, FP is fully measurable and FN is not. FIXED: reported
//     separately, with a rule-of-three upper bound on the measurable direction.
//  4. The sweep scored correctness against an already-collapsed top-1. FIXED:
//     the sweep recomputes the decision from ungated `ranked` scores.
//  5. No confusion pairs, no micro-F1, no per-row multi-label metric, no CIs.
//     All added. Bootstrap resamples eTLD+1 clusters, not rows, because 208 rows
//     sit on ~43 registrable domains and a row-level bootstrap understates the
//     interval.
//
// Nothing here ever emits 0 for an unmeasured quantity.

const { UNCLASSIFIED, applyDecision } = require('./prediction');

const LABEL_STATE = Object.freeze({
  SCORED: 'scored',
  NO_GOLD_NO_PREDICTIONS: 'no-gold-rows-no-predictions',
  NO_GOLD_WITH_FP: 'no-gold-rows-false-positives-only',
  UNDERPOWERED: 'underpowered',
});

// Power floor, declared up front so it gates what may be quoted rather than
// being chosen after seeing the numbers.
const POWER_FLOOR = Object.freeze({ minGoldRows: 10, minDistinctEtld1: 3 });

function perClassCounts(rows, predictions, labelIds) {
  const counts = {};
  for (const id of labelIds) {
    counts[id] = { tp: 0, fp: 0, fn: 0, tn: 0, goldPositives: 0, predictedPositives: 0 };
  }
  rows.forEach((row, i) => {
    const gold = new Set(row.labels);
    const pred = new Set(predictions[i].labels);
    for (const id of labelIds) {
      const g = gold.has(id);
      const p = pred.has(id);
      if (g) counts[id].goldPositives++;
      if (p) counts[id].predictedPositives++;
      if (g && p) counts[id].tp++;
      else if (!g && p) counts[id].fp++;
      else if (g && !p) counts[id].fn++;
      else counts[id].tn++;
    }
  });
  return counts;
}

function f1FromCounts(c) {
  const precision = c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? (precision === null && recall === null ? null : 0)
    : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

/** Distinct eTLD+1 count among rows carrying a given gold label. */
function goldDomainSupport(rows, labelId) {
  const s = new Set();
  for (const r of rows) if (r.labels.includes(labelId)) s.add(r.etld1 || r.url);
  return s.size;
}

/**
 * Per-class table plus two macro-F1 policies.
 *
 * fixedCore    — average over ALL 20 core labels, per
 *                research/137-taxonomy-proposal.md §3 ("macro-F1 averaged over
 *                exactly those 20"). Labels with neither gold rows nor
 *                predictions contribute 0, which is why this is published
 *                alongside, not instead of, the evaluable policy: it is
 *                dominated by what the fixture cannot test.
 * evaluable    — average over labels that have >=1 gold row OR >=1 prediction
 *                from this candidate. This is the honest comparative number and
 *                it still charges for zero-gold false positives.
 */
function classificationReport(rows, predictions, labelIds) {
  const counts = perClassCounts(rows, predictions, labelIds);
  const perClass = {};
  const fixedCoreValues = [];
  const evaluableValues = [];
  const evaluableLabels = [];
  const poweredValues = [];
  const poweredLabels = [];
  const underpowered = [];
  const noGoldNoPred = [];
  const noGoldWithFp = [];

  for (const id of labelIds) {
    const c = counts[id];
    const { precision, recall, f1 } = f1FromCounts(c);
    const domainSupport = goldDomainSupport(rows, id);

    let state;
    let effectiveF1;
    if (c.goldPositives === 0 && c.predictedPositives === 0) {
      state = LABEL_STATE.NO_GOLD_NO_PREDICTIONS;
      effectiveF1 = null;              // genuinely unmeasured, never 0
    } else if (c.goldPositives === 0) {
      // Only false positives are possible. Precision is 0, recall undefined.
      // F1 is 0 and that is a real measurement of harm, not an absence.
      state = LABEL_STATE.NO_GOLD_WITH_FP;
      effectiveF1 = 0;
      noGoldWithFp.push(id);
    } else if (c.goldPositives < POWER_FLOOR.minGoldRows || domainSupport < POWER_FLOOR.minDistinctEtld1) {
      state = LABEL_STATE.UNDERPOWERED;
      effectiveF1 = f1 === null ? 0 : f1;
      underpowered.push(id);
    } else {
      state = LABEL_STATE.SCORED;
      effectiveF1 = f1 === null ? 0 : f1;
    }

    if (state === LABEL_STATE.NO_GOLD_NO_PREDICTIONS) noGoldNoPred.push(id);

    perClass[id] = {
      ...c,
      precision,
      recall,
      f1: effectiveF1,
      state,
      gold_domain_support: domainSupport,
      reason: state === LABEL_STATE.SCORED ? null : state,
    };

    // Fixed-core policy: an untestable label contributes 0 to a 20-label mean.
    fixedCoreValues.push(effectiveF1 === null ? 0 : effectiveF1);

    if (state !== LABEL_STATE.NO_GOLD_NO_PREDICTIONS) {
      evaluableValues.push(effectiveF1);
      evaluableLabels.push(id);
    }
    if (state === LABEL_STATE.SCORED) {
      poweredValues.push(effectiveF1);
      poweredLabels.push(id);
    }
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // Micro-F1 over all label decisions.
  const agg = Object.values(counts).reduce(
    (a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }),
    { tp: 0, fp: 0, fn: 0 }
  );
  const microF1 = (2 * agg.tp + agg.fp + agg.fn) === 0
    ? null
    : (2 * agg.tp) / (2 * agg.tp + agg.fp + agg.fn);

  return {
    per_class: perClass,
    macro_f1_fixed_core: {
      value: mean(fixedCoreValues),
      policy: 'mean over all core labels; labels with no gold rows and no predictions contribute 0',
      label_count: labelIds.length,
    },
    macro_f1_evaluable: {
      value: mean(evaluableValues),
      policy: 'mean over labels with >=1 gold row OR >=1 prediction; zero-gold false positives score 0 and are included',
      label_count: evaluableLabels.length,
      labels: evaluableLabels,
    },
    macro_f1_powered_only: {
      value: mean(poweredValues),
      policy: `mean over labels clearing the declared power floor (>=${POWER_FLOOR.minGoldRows} gold rows AND >=${POWER_FLOOR.minDistinctEtld1} distinct eTLD+1)`,
      label_count: poweredLabels.length,
      labels: poweredLabels,
    },
    micro_f1: microF1,
    label_states: {
      underpowered,
      no_gold_no_predictions: noGoldNoPred,
      no_gold_false_positives_only: noGoldWithFp,
    },
    totals: agg,
  };
}

/** Per-row multi-label agreement: exact set match and Jaccard. */
function multiLabelRowMetrics(rows, predictions) {
  let exact = 0;
  let jaccardSum = 0;
  rows.forEach((row, i) => {
    const g = new Set(row.labels);
    const p = new Set(predictions[i].labels);
    const inter = [...g].filter((x) => p.has(x)).length;
    const union = new Set([...g, ...p]).size;
    if (inter === g.size && inter === p.size) exact++;
    jaccardSum += union === 0 ? 1 : inter / union;
  });
  return {
    exact_set_match: rows.length ? exact / rows.length : null,
    mean_jaccard: rows.length ? jaccardSum / rows.length : null,
  };
}

/**
 * Special-category confusion, reported per label with the two directions kept
 * apart. research/137-taxonomy-proposal.md requires this for labels 13 and 14.
 */
function specialCategoryConfusion(rows, predictions, labelId) {
  let tp = 0, fp = 0, fn = 0, tn = 0, goldPositives = 0;
  rows.forEach((row, i) => {
    const g = row.labels.includes(labelId);
    const p = predictions[i].labels.includes(labelId);
    if (g) goldPositives++;
    if (g && p) tp++;
    else if (!g && p) fp++;
    else if (g && !p) fn++;
    else tn++;
  });
  const goldNegatives = rows.length - goldPositives;
  // Rule of three: with 0 events in n trials the 95% upper bound is 3/n.
  const fpRateUpper95 = goldNegatives > 0 && fp === 0 ? 3 / goldNegatives : null;
  return {
    label: labelId,
    tp, fp, fn, tn,
    gold_positives: goldPositives,
    gold_negatives: goldNegatives,
    false_positive: {
      measurable: goldNegatives > 0,
      count: goldNegatives > 0 ? fp : null,
      rate: goldNegatives > 0 ? fp / goldNegatives : null,
      rate_upper_95: fpRateUpper95,
      note: goldNegatives > 0
        ? `measured against ${goldNegatives} gold-negative rows`
        : 'no gold-negative rows',
    },
    false_negative: {
      measurable: goldPositives > 0,
      count: goldPositives > 0 ? fn : null,
      rate: goldPositives > 0 ? fn / goldPositives : null,
      note: goldPositives > 0
        ? `measured against ${goldPositives} gold-positive rows`
        : 'UNMEASURABLE: this fixture has no gold-positive rows for this label. Recall cannot be estimated and must not be reported as 0.',
    },
  };
}

/**
 * Confusion pairs for multi-label output: for every gold label a row carries
 * that the candidate missed, record what the candidate predicted instead.
 * ABSTAIN is a first-class column.
 */
function confusionPairs(rows, predictions, labelIds) {
  const pairs = {};
  const bump = (g, p) => {
    pairs[g] = pairs[g] || {};
    pairs[g][p] = (pairs[g][p] || 0) + 1;
  };
  rows.forEach((row, i) => {
    const pred = predictions[i];
    const predSet = new Set(pred.labels);
    for (const g of row.labels) {
      if (predSet.has(g)) { bump(g, g); continue; }
      if (pred.abstained) { bump(g, 'ABSTAIN'); continue; }
      for (const p of pred.labels) bump(g, p);
    }
  });
  return pairs;
}

/**
 * Coverage-vs-accuracy sweep computed from UNGATED scores.
 *
 * Every point re-runs the decision at that threshold, so lowering the threshold
 * genuinely recovers the label the model ranked first. Both accuracy notions
 * are published: LENIENT (top-1 in gold set) and STRICT (predicted set == gold
 * set), because a lenient single-label number next to a multi-label macro-F1 is
 * not commensurable.
 */
function coverageAccuracySweep(rows, rawPredictions, thresholds, decisionTemplate, axis) {
  return thresholds.map((t) => {
    const decision = { ...decisionTemplate, [axis]: t };
    let covered = 0, lenientCorrect = 0, strictCorrect = 0;
    rows.forEach((row, i) => {
      const p = applyDecision(rawPredictions[i], decision);
      if (p.abstained) return;
      covered++;
      if (row.labels.includes(p.top1)) lenientCorrect++;
      const g = new Set(row.labels);
      const pr = new Set(p.labels);
      if (g.size === pr.size && [...g].every((x) => pr.has(x))) strictCorrect++;
    });
    return {
      threshold: t,
      axis,
      coverage: rows.length ? covered / rows.length : 0,
      covered_rows: covered,
      accuracy_lenient: covered ? lenientCorrect / covered : null,
      accuracy_strict: covered ? strictCorrect / covered : null,
      correct_lenient: lenientCorrect,
      correct_strict: strictCorrect,
    };
  });
}

/** Deterministic seeded PRNG (mulberry32) so bootstrap CIs are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Domain-cluster bootstrap. Resamples eTLD+1 groups with replacement, not rows:
 * the rows are not independent (the top registrable domain alone carries a
 * majority of them), so a row-level bootstrap reports an interval narrower than
 * the evidence supports.
 *
 * This is a PERCENTILE interval, not bias-corrected (BCa). The evaluable label
 * set is recomputed per resample, so the estimand moves slightly between
 * resamples and the median sits a little below the point estimate. Both are
 * emitted so a reader can see that gap rather than infer a bias that is not
 * there.
 */
function bootstrapMacroF1(rows, predictions, labelIds, { resamples = 2000, seed = 137, policy = 'macro_f1_evaluable' } = {}) {
  const clusters = new Map();
  rows.forEach((row, i) => {
    const key = row.etld1 || row.url;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(i);
  });
  const clusterKeys = [...clusters.keys()];
  if (clusterKeys.length < 2) {
    return { applicable: false, reason: 'fewer than two domain clusters' };
  }

  const rand = mulberry32(seed);
  const values = [];
  for (let b = 0; b < resamples; b++) {
    const idx = [];
    for (let k = 0; k < clusterKeys.length; k++) {
      const pick = clusterKeys[Math.floor(rand() * clusterKeys.length)];
      idx.push(...clusters.get(pick));
    }
    const rs = idx.map((i) => rows[i]);
    const ps = idx.map((i) => predictions[i]);
    const rep = classificationReport(rs, ps, labelIds);
    const v = rep[policy]?.value;
    if (v !== null && v !== undefined && Number.isFinite(v)) values.push(v);
  }
  if (!values.length) return { applicable: false, reason: 'no finite resamples' };
  values.sort((a, b) => a - b);
  const q = (p) => values[Math.min(values.length - 1, Math.max(0, Math.floor(p * (values.length - 1))))];
  const pointValue = classificationReport(rows, predictions, labelIds)[policy]?.value ?? null;
  return {
    applicable: true,
    policy,
    resamples: values.length,
    seed,
    cluster_unit: 'etld1',
    cluster_count: clusterKeys.length,
    interval_type: 'percentile (not bias-corrected)',
    point_estimate: Number.isFinite(pointValue) ? pointValue : null,
    ci95_low: q(0.025),
    ci95_high: q(0.975),
    median: q(0.5),
    note: 'The evaluable label set is recomputed per resample, so the median can sit below the point estimate. Compare point_estimate and median before reading the interval as a bias estimate.',
  };
}

/** Leave-one-domain-out and leave-one-persona-out sensitivity. */
function leaveOneOutRanges(rows, predictions, labelIds, policy = 'macro_f1_evaluable') {
  const run = (keep) => {
    const rs = [], ps = [];
    rows.forEach((r, i) => { if (keep(r)) { rs.push(r); ps.push(predictions[i]); } });
    if (!rs.length) return null;
    const v = classificationReport(rs, ps, labelIds)[policy]?.value;
    return Number.isFinite(v) ? v : null;
  };
  const byKey = (field) => {
    const keys = [...new Set(rows.map((r) => r[field]).filter(Boolean))];
    const out = keys.map((k) => ({ [field]: k, macro_f1_without: run((r) => r[field] !== k) }))
      .filter((x) => x.macro_f1_without !== null);
    const vals = out.map((x) => x.macro_f1_without);
    return {
      dropped: out.sort((a, b) => a.macro_f1_without - b.macro_f1_without).slice(0, 5),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
    };
  };
  return {
    policy,
    leave_one_etld1_out: byKey('etld1'),
    leave_one_persona_out: byKey('persona_id'),
  };
}

/**
 * Charitable scoring for rows the labeller itself flagged `ambiguous: true`.
 * Those rows carry more than one defensible label set; scoring them as hard gold
 * penalises a candidate for choosing the alternative the labeller could not
 * decide between. Published alongside strict, never instead of it.
 *
 * AUDIT FIX. The previous version replaced the gold set with the candidate's
 * ENTIRE predicted set on any partial hit, so every unrelated false positive on
 * an ambiguous row silently became a true positive. Measured consequence: it
 * manufactured gold-positive `adult_sexual_content` rows (2 for all-MiniLM, 3
 * for bge-micro-v2) on a fixture whose central honesty claim is that Adult has
 * ZERO gold rows, and inflated macro-F1 by up to +0.038.
 *
 * The charity is now bounded to what the flag actually licenses: on a hit, only
 * the DEFENSIBLE labels (the labeller's own set) that the candidate predicted
 * are credited. Predictions outside the labeller's set remain false positives,
 * so a zero-gold label can never gain a gold positive here. That invariant is
 * asserted in test/metrics.test.js.
 */
function charitableReport(rows, predictions, labelIds) {
  const adjusted = rows.map((row, i) => {
    if (!row.ambiguous) return row;
    const pred = new Set(predictions[i].labels);
    const defensibleHits = row.labels.filter((l) => pred.has(l));
    // Credit only the defensible labels the candidate actually chose; never
    // import a label the labeller did not consider defensible for this row.
    return defensibleHits.length ? { ...row, labels: defensibleHits } : row;
  });
  return classificationReport(adjusted, predictions, labelIds);
}

/** Leakage diagnostic: near-perfect precision on covered rows is a red flag. */
function leakageDiagnostic(rows, predictions, labelIds) {
  const counts = perClassCounts(rows, predictions, labelIds);
  let covered = 0, correct = 0;
  rows.forEach((row, i) => {
    const p = predictions[i];
    if (p.abstained) return;
    covered++;
    if (row.labels.includes(p.top1)) correct++;
  });
  const perfect = Object.entries(counts)
    .filter(([, c]) => c.tp > 0 && c.fp === 0)
    .map(([id]) => id);
  return {
    covered_rows: covered,
    top1_accuracy_on_covered: covered ? correct / covered : null,
    classes_at_precision_1: perfect.length,
    classes_at_precision_1_list: perfect,
    note: 'A candidate curated against the same boundaries as the gold labels shows near-1.0 precision on many classes. Treat high values as a prompt for adjudication, not as quality.',
  };
}

module.exports = {
  LABEL_STATE,
  POWER_FLOOR,
  perClassCounts,
  f1FromCounts,
  classificationReport,
  multiLabelRowMetrics,
  specialCategoryConfusion,
  confusionPairs,
  coverageAccuracySweep,
  bootstrapMacroF1,
  leaveOneOutRanges,
  charitableReport,
  leakageDiagnostic,
  mulberry32,
  UNCLASSIFIED,
};
