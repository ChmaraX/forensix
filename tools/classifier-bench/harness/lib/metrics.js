'use strict';
// Metrics per #137 §3: macro-F1 + per-class F1, confusion (Adult FP/FN called out both
// directions), coverage-vs-accuracy sweep, throughput, determinism, disk footprint.

function perClassCounts(rows, predictions, coreLabelIds) {
  const counts = {};
  for (const id of coreLabelIds) counts[id] = { tp: 0, fp: 0, fn: 0, tn: 0, goldPositives: 0 };

  rows.forEach((row, i) => {
    const gold = new Set(row.labels);
    const pred = new Set(predictions[i].labels);
    for (const id of coreLabelIds) {
      const g = gold.has(id);
      const p = pred.has(id);
      if (g) counts[id].goldPositives++;
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
    ? null
    : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function macroF1(rows, predictions, coreLabelIds) {
  const counts = perClassCounts(rows, predictions, coreLabelIds);
  const perClass = {};
  const scored = [];
  for (const id of coreLabelIds) {
    const c = counts[id];
    const { precision, recall, f1 } = f1FromCounts(c);
    perClass[id] = { ...c, precision, recall, f1 };
    // Labels with zero gold-positive rows in this fixture cannot be scored — report,
    // do not silently fold into the average (LABELLING-GUIDE.md "Open gaps").
    if (c.goldPositives > 0) scored.push(f1 === null ? 0 : f1);
  }
  const macro = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
  return { macroF1: macro, scoredLabelCount: scored.length, totalLabelCount: coreLabelIds.length, perClass };
}

// Adult false positives/negatives, both directions, called out separately per #137 §3.
function adultConfusion(rows, predictions) {
  const ADULT = 'adult_sexual_content';
  let fp = 0, fn = 0, tp = 0, tn = 0, goldPositives = 0;
  rows.forEach((row, i) => {
    const g = row.labels.includes(ADULT);
    const p = predictions[i].labels.includes(ADULT);
    if (g) goldPositives++;
    if (g && p) tp++;
    else if (!g && p) fp++;
    else if (g && !p) fn++;
    else tn++;
  });
  return goldPositives === 0
    ? { note: 'no Adult-labelled rows in this fixture — FP/FN cannot be measured, only asserted absent-in-sample', fp, fn, tp, tn, goldPositives }
    : { fp, fn, tp, tn, goldPositives };
}

// Coverage-vs-accuracy sweep as the abstain threshold moves, per #137 §3.
// Requires predictions[i].topScore (0..1) alongside predictions[i].top1 (single best label).
function coverageAccuracySweep(rows, predictions, thresholds) {
  return thresholds.map((t) => {
    let covered = 0, correct = 0;
    rows.forEach((row, i) => {
      const p = predictions[i];
      if (p.topScore === null || p.topScore === undefined) return; // candidate has no score axis
      if (p.topScore >= t) {
        covered++;
        if (row.labels.includes(p.top1)) correct++;
      }
    });
    return {
      threshold: t,
      coverage: rows.length ? covered / rows.length : 0,
      accuracyOnCovered: covered ? correct / covered : null,
      coveredRows: covered,
    };
  });
}

module.exports = { perClassCounts, f1FromCounts, macroF1, adultConfusion, coverageAccuracySweep };
