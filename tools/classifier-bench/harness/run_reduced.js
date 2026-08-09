'use strict';
// Exploratory seven-category run for #137. It reuses the frozen harness logic
// but runs only Potion 8M and BGE Micro against fixture_reduced.json.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const {
  normalisedInput, candidateView, validateFixture, fixtureCensus, sha256File,
} = require('./lib/fixture');
const {
  classificationReport, multiLabelRowMetrics, confusionPairs,
  coverageAccuracySweep, bootstrapMacroF1, leaveOneOutRanges,
  charitableReport, leakageDiagnostic,
} = require('./lib/metrics');
const { applyDecision, coverageOf } = require('./lib/prediction');
const { contaminationGuard } = require('./lib/contamination');
const { selectCandidates } = require('./candidates');
const { ortVersion, SESSION_OPTIONS } = require('./lib/onnx_engines');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results', 'reduced');
const RUN_TAG = process.env.RUN_TAG || 'main';
const BOOTSTRAP_RESAMPLES = Number(process.env.BOOTSTRAP_RESAMPLES || 2000);
const CANDIDATE_IDS = [
  'potion-base-8M-labelsim-v2',
  'bge-micro-v2-labelsim-v2',
];
const ARTIFACT_PREFIXES = ['potion-base-8M/', 'bge-micro-v2/'];

async function assertNetworkIsolated() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    await fetch('https://huggingface.co/', { signal: ctrl.signal });
    clearTimeout(timer);
    return false;
  } catch {
    return true;
  }
}

function dirSizeBytes(dir) {
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else total += fs.statSync(target).size;
    }
  };
  walk(dir);
  return total;
}

function verifyRequiredArtifacts() {
  const expected = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'expected_artifacts.json'), 'utf8')
  ).artifacts;
  const required = Object.entries(expected).filter(([rel]) =>
    ARTIFACT_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
  const checked = [];
  for (const [rel, pin] of required) {
    const target = path.join(ARTIFACTS_DIR, rel);
    if (!fs.existsSync(target)) throw new Error(`Required artifact is missing: ${rel}`);
    const actual = sha256File(target);
    if (actual !== pin.sha256) {
      throw new Error(`Artifact hash mismatch for ${rel}: expected ${pin.sha256}, got ${actual}`);
    }
    checked.push({ artifact: rel, sha256: actual, bytes: fs.statSync(target).size, ok: true });
  }
  if (checked.length !== 2) throw new Error(`Expected two pinned model artifacts, found ${checked.length}`);
  return checked;
}

async function collectRawPredictions(candidate, rows) {
  const views = rows.map(candidateView);
  const inputs = rows.map(normalisedInput);
  await candidate.predictRaw(views[0], inputs[0]);
  const started = performance.now();
  const raws = [];
  for (let i = 0; i < rows.length; i++) {
    raws.push(await candidate.predictRaw(views[i], inputs[i]));
  }
  const wallMs = performance.now() - started;
  return { raws, wallMs, rowsPerSec: rows.length / (wallMs / 1000) };
}

function hashPredictions(predictions) {
  const shape = predictions.map((p) => ({ labels: p.labels, top1: p.top1, abstained: p.abstained }));
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

function hashRawScores(raws) {
  const shape = raws.map((raw) => Object.entries(raw.scores)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([label, score]) => `${label}:${Number(score).toExponential(17)}`).join('|'));
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

function inputDigests() {
  const files = [
    ['taxonomy-reduced.json', path.join(ROOT, 'taxonomy-reduced.json')],
    ['fixture/fixture_reduced.json', path.join(ROOT, 'fixture', 'fixture_reduced.json')],
    ['fixture/fixture_labelled.json', path.join(ROOT, 'fixture', 'fixture_labelled.json')],
    ['harness/run_reduced.js', __filename],
    ['harness/lib/metrics.js', path.join(__dirname, 'lib', 'metrics.js')],
    ['harness/lib/prediction.js', path.join(__dirname, 'lib', 'prediction.js')],
    ['harness/lib/fixture.js', path.join(__dirname, 'lib', 'fixture.js')],
    ['harness/lib/contamination.js', path.join(__dirname, 'lib', 'contamination.js')],
    ['harness/lib/onnx_engines.js', path.join(__dirname, 'lib', 'onnx_engines.js')],
    ['harness/candidates/index.js', path.join(__dirname, 'candidates', 'index.js')],
    ['harness/candidates/embedding_labelsim.js', path.join(__dirname, 'candidates', 'embedding_labelsim.js')],
    ['scripts/make_reduced_fixture.js', path.join(ROOT, 'scripts', 'make_reduced_fixture.js')],
  ];
  return Object.fromEntries(files.map(([name, target]) => [name, sha256File(target)]));
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'taxonomy-reduced.json'), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixture', 'fixture_reduced.json'), 'utf8'));
  const labelIds = taxonomy.core.map((label) => label.id);
  const validation = validateFixture(rows, taxonomy);
  if (!validation.ok) throw new Error(`Reduced fixture validation failed: ${JSON.stringify(validation.violations.slice(0, 20))}`);

  const networkIsolated = await assertNetworkIsolated();
  if (!networkIsolated) throw new Error('Reduced inference run has outbound network access');
  const artifactChecks = verifyRequiredArtifacts();
  const census = fixtureCensus(rows, taxonomy);

  fs.mkdirSync(path.join(RESULTS_DIR, 'predictions'), { recursive: true });
  const manifestPath = path.join(ARTIFACTS_DIR, 'manifest-reduced.json');
  const results = {
    _generator: {
      script: 'tools/classifier-bench/harness/run_reduced.js',
      run_tag: RUN_TAG,
      generated_at: new Date().toISOString(),
      hand_edited: false,
    },
    banner: 'Exploratory post-benchmark reduced-category run. Taxonomy selection is post-hoc; this artifact is not independent confirmation.',
    purpose: 'Measure whether six broad displayed categories plus unclassified improve the two leading embedding candidates.',
    environment: {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      ort_version: ortVersion(),
      ort_session_options: SESSION_OPTIONS,
      network_isolated: networkIsolated,
      docker_image_digest: process.env.IMAGE_DIGEST || null,
    },
    inputs: {
      digests: inputDigests(),
      artifact_verification: artifactChecks,
      phase_a_manifest: fs.existsSync(manifestPath)
        ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        : null,
    },
    fixture: {
      path: 'tools/classifier-bench/fixture/fixture_reduced.json',
      source_fixture: 'tools/classifier-bench/fixture/fixture_labelled.json',
      mapping_script: 'tools/classifier-bench/scripts/make_reduced_fixture.js',
      census,
    },
    taxonomy: {
      id: taxonomy.variant_id,
      core_label_count: labelIds.length,
      source: taxonomy._source,
      post_hoc: true,
      note: taxonomy._note,
      labels: taxonomy.core.map(({ id, name, source_labels }) => ({ id, name, source_labels })),
    },
    operating_point: {
      selection: 'unchanged from the original candidate definitions',
      threshold_calibrated_on_fixture: false,
      note: 'No threshold or label wording was selected from this run. Coverage sweeps remain descriptive only.',
    },
    candidates: [],
    failures: [],
  };

  for (const spec of selectCandidates(CANDIDATE_IDS)) {
    console.log(`\n=== ${spec.id} / reduced-7-v1 ===`);
    try {
      const candidate = await spec.build({ artifactsDir: ARTIFACTS_DIR, taxonomy, fixtureRows: rows });
      candidate.supervision.source = 'tools/classifier-bench/taxonomy-reduced.json (name + question + boundary)';
      const supervision = contaminationGuard(rows, candidate);
      const run1 = await collectRawPredictions(candidate, rows);
      const predictions = run1.raws.map((raw) => applyDecision(raw, candidate.decision));
      const run2 = await collectRawPredictions(candidate, rows);
      const predictions2 = run2.raws.map((raw) => applyDecision(raw, candidate.decision));
      const decisionHash = hashPredictions(predictions);
      const rawScoreHash = hashRawScores(run1.raws);
      const report = classificationReport(rows, predictions, labelIds);
      const charitable = charitableReport(rows, predictions, labelIds);
      const coverage = coverageOf(predictions);

      const record = {
        id: candidate.id,
        family: candidate.family,
        model: candidate.model,
        licence: candidate.licence,
        supervision,
        decision: candidate.decision,
        coverage,
        macro_f1_fixed_core: report.macro_f1_fixed_core,
        macro_f1_evaluable: report.macro_f1_evaluable,
        macro_f1_powered_only: report.macro_f1_powered_only,
        micro_f1: report.micro_f1,
        multi_label_row_metrics: multiLabelRowMetrics(rows, predictions),
        label_states: report.label_states,
        per_class: report.per_class,
        charitable_ambiguous_scoring: {
          macro_f1_evaluable: charitable.macro_f1_evaluable.value,
          micro_f1: charitable.micro_f1,
        },
        confusion_pairs: confusionPairs(rows, predictions, labelIds),
        coverage_accuracy_sweep: coverageAccuracySweep(
          rows, run1.raws, candidate.sweep.thresholds, candidate.decision, candidate.sweep.axis
        ),
        bootstrap_ci: bootstrapMacroF1(rows, predictions, labelIds, {
          resamples: BOOTSTRAP_RESAMPLES,
          seed: 1377,
          policy: 'macro_f1_evaluable',
        }),
        sensitivity: leaveOneOutRanges(rows, predictions, labelIds),
        leakage_diagnostic: leakageDiagnostic(rows, predictions, labelIds),
        determinism: {
          same_process_repeat_match: decisionHash === hashPredictions(predictions2),
          decision_hash: decisionHash,
          raw_score_hash: rawScoreHash,
          separate_process: 'see determinism-summary.json',
        },
        throughput: {
          rows_per_sec: run1.rowsPerSec,
          wall_ms: run1.wallMs,
          projected_100k_row_wall_clock_sec: 100000 / run1.rowsPerSec,
        },
        disk_footprint: {
          bytes: dirSizeBytes(candidate.model.artifact_dir),
        },
      };
      results.candidates.push(record);

      const predictionRows = rows.map((row, index) => ({
        row_id: row.row_id,
        title: row.title,
        url: row.url,
        etld1: row.etld1,
        persona_id: row.persona_id,
        source_gold_20: row.source_labels_20,
        gold: row.labels,
        ambiguous: row.ambiguous,
        predicted: predictions[index].labels,
        top1: predictions[index].top1,
        raw_top1: predictions[index].rawTop1,
        raw_top1_score: predictions[index].rawTop1Score,
        margin: predictions[index].margin,
        abstained: predictions[index].abstained,
        abstain_reason: predictions[index].abstainReason,
        ranked: predictions[index].ranked.slice(0, 7),
      }));
      fs.writeFileSync(
        path.join(RESULTS_DIR, 'predictions', `${candidate.id}.${process.arch}.${RUN_TAG}.json`),
        JSON.stringify({
          candidate_id: candidate.id,
          taxonomy: taxonomy.variant_id,
          arch: process.arch,
          run_tag: RUN_TAG,
          decision_hash: decisionHash,
          raw_score_hash: rawScoreHash,
          rows: predictionRows,
        }, null, 2)
      );

      console.log(
        `  macroF1=${report.macro_f1_fixed_core.value.toFixed(3)}`
        + ` microF1=${report.micro_f1.toFixed(3)}`
        + ` coverage=${(coverage * 100).toFixed(1)}%`
        + ` rows/s=${run1.rowsPerSec.toFixed(0)}`
      );
    } catch (error) {
      console.error(`  FAILED: ${error.message}`);
      results.failures.push({ id: spec.id, error: error.message });
    }
  }

  const filename = RUN_TAG === 'main' ? 'results.json' : `results.${RUN_TAG}.json`;
  fs.writeFileSync(path.join(RESULTS_DIR, filename), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${path.join(RESULTS_DIR, filename)}`);
  if (results.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('REDUCED_BENCH_FAILED:', error.stack || error.message);
  process.exit(1);
});
