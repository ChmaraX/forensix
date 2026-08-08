'use strict';
// One prediction schema for every candidate (ChmaraX/forensix#137 §2).
//
// The audit round found that the two original candidates spelled abstention two
// different ways (`labels: []` vs `labels: ['unclassified']`) and that one of
// them collapsed its own top-1 to `unclassified` BEFORE the harness swept
// thresholds — which made every sweep point below the candidate's own hardcoded
// margin arithmetically incapable of scoring correct.
//
// The fix, encoded here:
//   1. A candidate NEVER applies an abstention rule. It returns ungated,
//      per-label scores only. `applyDecision()` in this module is the single
//      place any threshold is applied, so the sweep can recompute every point
//      from raw scores.
//   2. Abstention has exactly one spelling on the way out: the taxonomy's
//      `unclassified` label, per research/137-taxonomy-proposal.md §3
//      ("A row with an empty label set is a malformed fixture row ...
//      Abstention is spelled Unclassified").
//   3. `abstainReason` distinguishes "the list had no entry" from "the model was
//      unsure". Those are different sentences in a forensic report and must not
//      both render as a bare `unclassified`. This mirrors CONTEXT.md's Field
//      State discipline: `absent` (looked, not there) is not `unavailable`.

const UNCLASSIFIED = 'unclassified';

const ABSTAIN_REASONS = Object.freeze({
  NO_LIST_ENTRY: 'no-list-entry',       // family 5: looked it up, not in the table
  BELOW_THRESHOLD: 'below-threshold',   // model scored every label under the bar
  EMPTY_INPUT: 'empty-input',           // nothing to classify
  MODEL_RANKED_UNCLASSIFIED: 'model-ranked-unclassified',
});

/**
 * A RawPrediction is what a candidate returns. It carries no decision.
 *   scores: { [labelId]: number }  ungated, comparable within a row
 *   scoreAxis: 'cosine' | 'entailment-probability' | 'rule-match' | ...
 *   listHit:  boolean | null       family-5 only; null when not applicable
 */
function rawPrediction({ scores, scoreAxis, listHit = null, note = null }) {
  if (!scores || typeof scores !== 'object') {
    throw new Error('rawPrediction requires a scores object');
  }
  return { scores, scoreAxis, listHit, note };
}

function rankScores(scores) {
  return Object.entries(scores)
    .map(([label, score]) => ({ label, score }))
    // Deterministic tie-break by label id, so two runs cannot differ on ties.
    .sort((a, b) => (b.score - a.score) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * The single decision function. Candidates never call this; the harness does.
 *
 * @param raw          RawPrediction
 * @param decision     { absoluteThreshold, marginThreshold, multiLabelDelta }
 * @returns Prediction consumed by metrics.js
 */
function applyDecision(raw, decision) {
  const {
    absoluteThreshold = 0,
    marginThreshold = 0,
    multiLabelDelta = null,
  } = decision || {};

  // `unclassified` is a real class in the taxonomy, but a candidate scoring it
  // highly is a positive assertion of "no signal", not an abstention. Keep it in
  // the ranking so it can be scored like any other label.
  const ranked = rankScores(raw.scores);
  const top1 = ranked[0] || null;
  const top2 = ranked[1] || null;
  const margin = top1 && top2 ? top1.score - top2.score : (top1 ? top1.score : null);

  // Family 5 with no table entry: a definite "absent", not a low score.
  if (raw.listHit === false) {
    return {
      labels: [UNCLASSIFIED],
      top1: UNCLASSIFIED,
      abstained: true,
      abstainReason: ABSTAIN_REASONS.NO_LIST_ENTRY,
      rawTop1: null,
      rawTop1Score: null,
      margin: null,
      ranked,
      scoreAxis: raw.scoreAxis,
    };
  }

  if (!top1) {
    return {
      labels: [UNCLASSIFIED],
      top1: UNCLASSIFIED,
      abstained: true,
      abstainReason: ABSTAIN_REASONS.EMPTY_INPUT,
      rawTop1: null,
      rawTop1Score: null,
      margin: null,
      ranked,
      scoreAxis: raw.scoreAxis,
    };
  }

  const belowAbsolute = top1.score < absoluteThreshold;
  const belowMargin = marginThreshold > 0 && margin !== null && margin < marginThreshold;

  if (belowAbsolute || belowMargin) {
    return {
      labels: [UNCLASSIFIED],
      top1: UNCLASSIFIED,
      abstained: true,
      abstainReason: ABSTAIN_REASONS.BELOW_THRESHOLD,
      // rawTop1 is preserved so the sweep can recompute a lower threshold and
      // recover the label the model actually ranked first. This is the exact
      // defect the audit found in the original run.
      rawTop1: top1.label,
      rawTop1Score: top1.score,
      margin,
      ranked,
      scoreAxis: raw.scoreAxis,
    };
  }

  // Multi-label emission: every label within `multiLabelDelta` of the top score
  // that also clears the absolute bar. `null` delta means single-label.
  let labels = [top1.label];
  if (multiLabelDelta !== null && multiLabelDelta !== undefined) {
    labels = ranked
      .filter((r) => r.score >= absoluteThreshold && (top1.score - r.score) <= multiLabelDelta)
      .map((r) => r.label);
    // `unclassified` asserts absence of signal; it cannot co-occur with a
    // positive label (taxonomy.json mutually_exclusive, and the same rule the
    // fixture is validated against).
    if (labels.length > 1) labels = labels.filter((l) => l !== UNCLASSIFIED);
    if (labels.length === 0) labels = [top1.label];
  }

  const abstained = labels.length === 1 && labels[0] === UNCLASSIFIED;
  return {
    labels,
    top1: top1.label,
    abstained,
    abstainReason: abstained ? ABSTAIN_REASONS.MODEL_RANKED_UNCLASSIFIED : null,
    rawTop1: top1.label,
    rawTop1Score: top1.score,
    margin,
    ranked,
    scoreAxis: raw.scoreAxis,
  };
}

/** Coverage has one definition for every candidate: rows not abstaining. */
function coverageOf(predictions) {
  if (!predictions.length) return 0;
  return predictions.filter((p) => !p.abstained).length / predictions.length;
}

module.exports = {
  UNCLASSIFIED,
  ABSTAIN_REASONS,
  rawPrediction,
  rankScores,
  applyDecision,
  coverageOf,
};
