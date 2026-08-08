'use strict';
// Families 3 / 3b: single-pass embedding + label-name similarity, zero exemplars.
//
// Supervision is ONLY the frozen taxonomy text: each label's name, the forensic
// question it answers, and its boundary rule — all copied verbatim into
// taxonomy.json from research/137-taxonomy-proposal.md §3, which was written and
// frozen BEFORE the fixture was labelled. No fixture row, domain, or title was
// consulted to build the anchor strings. That is what makes this candidate's
// supervision independent of the test set.
//
// The audit found the previous version of this candidate applied its own
// hardcoded abstain margin and overwrote its top-1 before the harness could
// sweep. It no longer decides anything: it returns ungated per-label scores and
// the harness applies every threshold.

const { rawPrediction } = require('../lib/prediction');
const { dot } = require('../lib/onnx_engines');

/**
 * Anchor text per label. Concatenating name + question + boundary gives the
 * static encoder far more lexical surface than a 2-4 word label name, which was
 * the previous run's main handicap. All three fields are frozen supervision.
 */
function anchorText(label) {
  return [label.name, label.question, label.boundary].filter(Boolean).join('. ');
}

async function buildEmbeddingCandidate({ id, family, engine, taxonomy, modelId, revision, artifactDir, licence = null, inputMode = 'title_url' }) {
  const labels = taxonomy.core;
  const anchors = [];
  for (const l of labels) {
    anchors.push({ id: l.id, vec: await engine.embed(anchorText(l)) });
  }

  async function predictRaw(view, inputText) {
    if (!inputText || !inputText.trim()) {
      return rawPrediction({ scores: {}, scoreAxis: 'cosine', note: 'empty input' });
    }
    const v = await engine.embed(inputText);
    const scores = {};
    for (const a of anchors) scores[a.id] = dot(v, a.vec);
    return rawPrediction({ scores, scoreAxis: 'cosine' });
  }

  return {
    id,
    family,
    inputMode,
    requiresModel: true,
    model: { id: modelId, revision, artifact_dir: artifactDir, sha256: engine.modelSha256 },
    licence,
    engine_kind: engine.kind,
    engine_details: {
      input_names: engine.inputNames,
      output_names: engine.outputNames,
      pooling_mode: engine.poolingMode || 'in-graph',
      max_length: engine.maxLength,
    },
    supervision: {
      kind: 'label-names',
      source: 'tools/classifier-bench/taxonomy.json (name + question + boundary), frozen from research/137-taxonomy-proposal.md section 3 before labelling',
      exemplars: [],
      ruleDomains: [],
      texts: labels.map(anchorText),
    },
    // Cosine over L2-normalised vectors is in [-1, 1]; thresholds are swept over
    // the observed range rather than a hand-picked point.
    decision: { absoluteThreshold: 0, marginThreshold: 0, multiLabelDelta: 0.02 },
    sweep: { axis: 'marginThreshold', thresholds: [0, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3] },
    predictRaw,
  };
}

module.exports = { buildEmbeddingCandidate, anchorText };
