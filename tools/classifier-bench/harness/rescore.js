'use strict';
// Re-derive every fixture-dependent metric in results.json from the COMMITTED
// per-row predictions, without re-running inference.
//
// Why this exists
// ---------------
// The audit round changed two things that alter published numbers but cannot
// change what a model predicted:
//
//   1. `scripts/label_fixture.py` had a registrable-domain bug: the
//      browser-internal guard `host.startswith("chrome")` also matched the real
//      host `chrome.google.com`. `etld1` is the bootstrap cluster unit, the
//      power-floor support unit and the leave-one-out group key, so fixing it
//      moves confidence intervals and sensitivity ranges.
//   2. `charitableReport` credited a candidate's ENTIRE predicted set on an
//      ambiguous row, manufacturing gold positives for zero-gold labels.
//
// Neither touches inference: gold labels, thresholds, model artifacts and the
// emitted predictions are all unchanged. Re-running the container would produce
// byte-identical predictions and burn ~20 minutes (and ~2h more for the emulated
// amd64 leg), so the honest and cheaper move is to recompute the SCORING layer
// from the persisted predictions and leave every measured quantity untouched.
//
// What is recomputed here (pure functions of fixture x predictions):
//   per_class, macro/micro F1, label_states, multi-label row metrics, coverage,
//   special-category confusion, confusion pairs, coverage/accuracy sweep,
//   bootstrap CI, leave-one-out sensitivity, leakage diagnostic, charitable
//   scoring, and the fixture census/limitations block.
//
// What is COPIED VERBATIM from the original run, never recomputed (these are
// measurements of the machine, not of the fixture):
//   throughput, disk footprint, determinism hashes, environment, artifact
//   verification, Phase A manifest, model/licence/supervision declarations.
//
// Fidelity is asserted, not assumed: --verify re-derives the ORIGINAL numbers
// against the ORIGINAL fixture and fails if anything drifts. See
// test/rescore.test.js.
//
// Usage:
//   node rescore.js [resultsDir] [--verify]

const fs = require('node:fs');
const path = require('node:path');

const {
  loadFixture, loadTaxonomy, validateFixture, fixtureCensus, sha256File,
} = require('./lib/fixture');
const {
  classificationReport, multiLabelRowMetrics, specialCategoryConfusion,
  confusionPairs, coverageAccuracySweep, bootstrapMacroF1,
  leaveOneOutRanges, charitableReport, leakageDiagnostic,
} = require('./lib/metrics');
const { coverageOf } = require('./lib/prediction');
const { MODEL_LICENCES } = require('./candidates');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..');
const BOOTSTRAP_RESAMPLES = Number(process.env.BOOTSTRAP_RESAMPLES || 2000);

/**
 * Static, non-measured declarations that may be refreshed without re-running
 * inference. A licence is a fact about the model repo, not an observation of
 * this run: recording it does not change any number, and leaving it null left
 * #126 unable to tell which candidates are shippable.
 */
function refreshDeclarations(record) {
  if (record.model && record.model.id && MODEL_LICENCES[record.model.id]) {
    return { ...record, licence: MODEL_LICENCES[record.model.id] };
  }
  return record;
}

/**
 * Rebuild the decision-level Prediction objects consumed by metrics.js from a
 * persisted prediction file. The emitted decision is stored verbatim, so this is
 * a faithful reconstruction rather than a re-derivation.
 */
function predictionsFromFile(fixtureRows, file) {
  const byId = new Map(file.rows.map((r) => [r.row_id, r]));
  return fixtureRows.map((row) => {
    const r = byId.get(row.row_id);
    if (!r) throw new Error(`prediction file is missing fixture row ${row.row_id}`);
    return {
      labels: r.predicted,
      top1: r.top1,
      abstained: r.abstained,
      abstainReason: r.abstain_reason,
      rawTop1: r.raw_top1,
      rawTop1Score: r.raw_top1_score,
      margin: r.margin,
      ranked: r.ranked,
      scoreAxis: r.score_axis,
    };
  });
}

/** Reconstruct the ungated RawPrediction the sweep needs. */
function rawsFromFile(fixtureRows, file) {
  const byId = new Map(file.rows.map((r) => [r.row_id, r]));
  return fixtureRows.map((row) => {
    const r = byId.get(row.row_id);
    const scores = {};
    for (const e of r.ranked || []) scores[e.label] = e.score;
    return {
      scores,
      scoreAxis: r.score_axis,
      // A family-5 miss is a definite "absent", and applyDecision keys on it.
      listHit: r.abstain_reason === 'no-list-entry' ? false : null,
    };
  });
}

function rescoreCandidate(fixtureRows, coreLabelIds, record, predFile) {
  const predictions = predictionsFromFile(fixtureRows, predFile);
  const report = classificationReport(fixtureRows, predictions, coreLabelIds);
  const charitable = charitableReport(fixtureRows, predictions, coreLabelIds);

  let sweep = record.coverage_accuracy_sweep;
  if (Array.isArray(sweep) && sweep.length) {
    const raws = rawsFromFile(fixtureRows, predFile);
    sweep = coverageAccuracySweep(
      fixtureRows, raws, sweep.map((s) => s.threshold), record.decision, sweep[0].axis
    );
  }

  return {
    ...record,
    coverage: coverageOf(predictions),
    macro_f1_fixed_core: report.macro_f1_fixed_core,
    macro_f1_evaluable: report.macro_f1_evaluable,
    macro_f1_powered_only: report.macro_f1_powered_only,
    micro_f1: report.micro_f1,
    multi_label_row_metrics: multiLabelRowMetrics(fixtureRows, predictions),
    label_states: report.label_states,
    per_class: report.per_class,
    charitable_ambiguous_scoring: {
      note: 'Rows the labeller flagged ambiguous are re-scored charitably: on a hit, only the DEFENSIBLE labels (the labeller\'s own set for that row) that the candidate predicted are credited. Predictions outside the labeller\'s set stay false positives, so a zero-gold label can never gain a gold positive. Recorded here in results.json alongside the strict score, never instead of it.',
      macro_f1_evaluable: charitable.macro_f1_evaluable.value,
      micro_f1: charitable.micro_f1,
    },
    special_category_confusion: {
      adult_sexual_content: specialCategoryConfusion(fixtureRows, predictions, 'adult_sexual_content'),
      health_medical: specialCategoryConfusion(fixtureRows, predictions, 'health_medical'),
    },
    confusion_pairs: confusionPairs(fixtureRows, predictions, coreLabelIds),
    coverage_accuracy_sweep: sweep,
    bootstrap_ci: bootstrapMacroF1(fixtureRows, predictions, coreLabelIds, {
      resamples: BOOTSTRAP_RESAMPLES, seed: 137, policy: 'macro_f1_evaluable',
    }),
    sensitivity: leaveOneOutRanges(fixtureRows, predictions, coreLabelIds),
    leakage_diagnostic: leakageDiagnostic(fixtureRows, predictions, coreLabelIds),
  };
}

function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes('--verify');
  const resultsDir = args.find((a) => !a.startsWith('--')) || process.env.RESULTS_DIR || path.join(ROOT, 'results');

  const taxonomy = loadTaxonomy(ROOT);
  const coreLabelIds = taxonomy.core.map((l) => l.id);
  const fixtureRows = loadFixture(path.join(ROOT, 'fixture'));

  const validation = validateFixture(fixtureRows, taxonomy);
  if (!validation.ok) {
    throw new Error(`FIXTURE VALIDATION FAILED:\n${JSON.stringify(validation.violations.slice(0, 40), null, 2)}`);
  }

  const resultsPath = path.join(resultsDir, 'results.json');
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const arch = results.environment.arch;

  const rescored = [];
  const drift = [];
  for (const record of results.candidates) {
    const pf = path.join(resultsDir, 'predictions', `${record.id}.${arch}.main.json`);
    if (!fs.existsSync(pf)) {
      throw new Error(`RESCORE REFUSED: no committed predictions for ${record.id} at ${pf}. `
        + 'Rescoring without the row-level artifact would fabricate numbers.');
    }
    const predFile = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const next = refreshDeclarations(rescoreCandidate(fixtureRows, coreLabelIds, record, predFile));

    const cmp = (name, a, b) => {
      const d = Math.abs((a ?? 0) - (b ?? 0));
      if (d > 1e-12) drift.push({ candidate: record.id, field: name, before: a, after: b, delta: d });
    };
    cmp('macro_f1_evaluable', record.macro_f1_evaluable.value, next.macro_f1_evaluable.value);
    cmp('macro_f1_fixed_core', record.macro_f1_fixed_core.value, next.macro_f1_fixed_core.value);
    cmp('micro_f1', record.micro_f1, next.micro_f1);
    cmp('coverage', record.coverage, next.coverage);
    rescored.push(next);
  }

  if (verifyOnly) {
    // Fidelity gate: against the ORIGINAL fixture nothing may move. Any drift
    // means this path is not a faithful substitute for re-running inference.
    if (drift.length) {
      console.error('RESCORE FIDELITY FAILED — recomputation does not reproduce the committed numbers:');
      console.error(JSON.stringify(drift.slice(0, 20), null, 2));
      process.exit(1);
    }
    console.log(`RESCORE FIDELITY OK: ${rescored.length} candidates reproduce their committed metrics exactly.`);
    return;
  }

  const census = fixtureCensus(fixtureRows, taxonomy);
  results.candidates = rescored;
  results.fixture.census = census;
  results.fixture.limitations = {
    ...results.fixture.limitations,
    row_count: fixtureRows.length,
    persona_count: census.persona_count,
    zero_gold_labels: Object.entries(census.per_label).filter(([, v]) => v.gold_rows === 0).map(([k]) => k),
    adult_recall_measurable: census.per_label.adult_sexual_content.gold_rows > 0,
  };
  results.inputs.digests['fixture/fixture_labelled.json'] = sha256File(path.join(ROOT, 'fixture', 'fixture_labelled.json'));
  results.inputs.digests['fixture/fixture_raw.json'] = sha256File(path.join(ROOT, 'fixture', 'fixture_raw.json'));
  results.inputs.digests['taxonomy.json'] = sha256File(path.join(ROOT, 'taxonomy.json'));
  for (const f of ['lib/metrics.js', 'lib/prediction.js', 'lib/fixture.js', 'lib/contamination.js',
    'lib/onnx_engines.js', 'run_bench.js', 'models.js', 'ut1_category_map.json',
    'candidates/index.js', 'candidates/embedding_labelsim.js',
    'candidates/nli_entailment.js', 'candidates/ut1_domain_list.js']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) results.inputs.digests[`harness/${f}`] = sha256File(p);
  }

  results._generator.rescored_by = {
    script: 'tools/classifier-bench/harness/rescore.js',
    generated_at: new Date().toISOString(),
    reason: 'Fixture-dependent scoring recomputed after two audit fixes: the label_fixture.py registrable-domain bug (etld1 is the bootstrap cluster and power-floor unit) and the charitable-scoring fix that stopped unrelated predictions becoming gold labels.',
    inference_rerun: false,
    inference_rerun_note: 'Predictions were NOT regenerated. Neither fix can change what a model predicted, and every decision was already persisted per row. Throughput, footprint, determinism hashes, environment and artifact verification are copied verbatim from the original run and are NOT re-measured here.',
    recomputed_fields: [
      'per_class', 'macro_f1_fixed_core', 'macro_f1_evaluable', 'macro_f1_powered_only',
      'micro_f1', 'label_states', 'multi_label_row_metrics', 'coverage',
      'special_category_confusion', 'confusion_pairs', 'coverage_accuracy_sweep',
      'bootstrap_ci', 'sensitivity', 'leakage_diagnostic',
      'charitable_ambiguous_scoring', 'fixture.census', 'fixture.limitations',
    ],
    copied_verbatim_fields: [
      'throughput', 'disk_footprint', 'determinism', 'environment',
      'inputs.artifact_verification', 'inputs.phase_a_manifest',
      'model', 'licence', 'supervision', 'supervision_declaration', 'decision',
    ],
    metric_drift_vs_previous_fixture: drift,
  };

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${resultsPath} (rescored ${rescored.length} candidates from committed predictions)`);
  for (const d of drift) {
    console.log(`  moved: ${d.candidate} ${d.field} ${Number(d.before).toFixed(6)} -> ${Number(d.after).toFixed(6)}`);
  }
  if (!drift.length) console.log('  no metric moved');
}

if (require.main === module) main();
module.exports = { predictionsFromFile, rawsFromFile, rescoreCandidate, refreshDeclarations };
