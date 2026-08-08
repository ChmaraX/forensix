'use strict';
// Family 3b (single-pass embedding + label-name similarity, zero exemplars), per
// research/136-approach-survey.md family 3/3b and research/137-taxonomy-proposal.md.
//
// Contamination note: this candidate's ONLY supervision is the taxonomy's own label
// names (research/137-taxonomy-proposal.md §3) — no exemplar rows, no training data,
// nothing sourced from the fixture at all. "Supervision needed: None for label-name
// similarity" per the approach survey's family-3 row. There is nothing for the
// guardrail script to check for overlap because there is no exemplar corpus.

const { dot } = require('../lib/potion_engine');

const ABSTAIN_MARGIN = 0.15; // top1 must beat top2 by this cosine margin, else abstain

async function buildCandidate(engine, taxonomy) {
  const coreLabels = taxonomy.core.filter((l) => l.id !== 'unclassified');
  const labelVectors = [];
  for (const l of coreLabels) {
    labelVectors.push({ id: l.id, vec: await engine.embed(l.name) });
  }

  async function predict(row, normalisedInputText) {
    const rowVec = await engine.embed(normalisedInputText);
    const scored = labelVectors
      .map((lv) => ({ id: lv.id, score: dot(rowVec, lv.vec) }))
      .sort((a, b) => b.score - a.score);
    const top1 = scored[0];
    const top2 = scored[1];
    const margin = top1.score - (top2 ? top2.score : 0);
    if (margin < ABSTAIN_MARGIN) {
      return { labels: ['unclassified'], top1: 'unclassified', topScore: top1.score, margin, allScores: scored };
    }
    return { labels: [top1.id], top1: top1.id, topScore: top1.score, margin, allScores: scored };
  }

  return { id: 'potion-base-2M-labelsim-v1', family: '3b-embedding-labelname-similarity', requiresModel: true, predict };
}

module.exports = { buildCandidate, ABSTAIN_MARGIN };
