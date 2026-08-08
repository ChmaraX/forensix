'use strict';
// Family 2: multi-pass entailment (zero-shot NLI cross-encoder).
//
// Cost model from #136: N forward passes per row for an N-label taxonomy, versus
// 1 for every other family. With 20 core labels and 208 rows that is 4,160
// passes per run over an 87 MB int8 DeBERTa. That cost is the finding, not a
// surprise — it is measured here rather than argued.
//
// Supervision is the hypothesis template plus the frozen taxonomy text. The
// template is written from the taxonomy's own wording and contains no fixture
// domain, title, or example. It is declared verbatim in the candidate manifest
// so a reader can check that claim.

const { rawPrediction } = require('../lib/prediction');

const HYPOTHESIS_TEMPLATE = 'This web page is about {label}.';

function hypothesisFor(label) {
  return HYPOTHESIS_TEMPLATE.replace('{label}', label.name.toLowerCase());
}

async function buildNliCandidate({ id, family, engine, taxonomy, modelId, revision, artifactDir, licence = null, inputMode = 'title_url', maxPremiseChars = 400 }) {
  const labels = taxonomy.core;
  const hypotheses = labels.map((l) => ({ id: l.id, text: hypothesisFor(l) }));

  async function predictRaw(view, inputText) {
    if (!inputText || !inputText.trim()) {
      return rawPrediction({ scores: {}, scoreAxis: 'entailment-probability', note: 'empty input' });
    }
    // Long URLs would otherwise consume the whole 256-token budget and push the
    // hypothesis out of the window entirely.
    const premise = inputText.slice(0, maxPremiseChars);
    const scores = {};
    for (const h of hypotheses) {
      scores[h.id] = await engine.entailmentProbability(premise, h.text);
    }
    return rawPrediction({ scores, scoreAxis: 'entailment-probability' });
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
      id2label: engine.id2label,
      max_length: engine.maxLength,
      max_premise_chars: maxPremiseChars,
      passes_per_row: labels.length,
    },
    supervision: {
      kind: 'hypothesis-template',
      source: 'HYPOTHESIS_TEMPLATE over taxonomy.json label names, frozen from research/137-taxonomy-proposal.md section 3',
      template: HYPOTHESIS_TEMPLATE,
      exemplars: [],
      ruleDomains: [],
      texts: hypotheses.map((h) => h.text),
    },
    // Entailment probabilities are per-label independently normalised, so an
    // absolute bar is the natural gate for multi-label emission.
    decision: { absoluteThreshold: 0.5, marginThreshold: 0, multiLabelDelta: 0.05 },
    sweep: { axis: 'absoluteThreshold', thresholds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95] },
    predictRaw,
  };
}

module.exports = { buildNliCandidate, HYPOTHESIS_TEMPLATE, hypothesisFor };
