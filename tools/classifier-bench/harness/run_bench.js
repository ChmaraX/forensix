'use strict';
// Phase B (--network none): candidate-agnostic bench run.
// One command in, results.json + per-row predictions out. No hand edits.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const {
  loadFixture, loadTaxonomy, normalisedInput, titleOnlyInput,
  candidateView, validateFixture, fixtureCensus, sha256File,
} = require('./lib/fixture');
const {
  classificationReport, multiLabelRowMetrics, specialCategoryConfusion,
  confusionPairs, coverageAccuracySweep, bootstrapMacroF1,
  leaveOneOutRanges, charitableReport, leakageDiagnostic,
} = require('./lib/metrics');
const { applyDecision, coverageOf } = require('./lib/prediction');
const { contaminationGuard, registrable } = require('./lib/contamination');
const { selectCandidates } = require('./candidates');
const { ortVersion, SESSION_OPTIONS } = require('./lib/onnx_engines');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results');
const ONLY = (process.env.BENCH_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const RUN_TAG = process.env.RUN_TAG || 'main';
const BOOTSTRAP_RESAMPLES = Number(process.env.BOOTSTRAP_RESAMPLES || 2000);

/** Phase B must be offline. Assert it rather than trusting the flag. */
async function assertNetworkIsolated() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    await fetch('https://huggingface.co/', { signal: ctrl.signal });
    clearTimeout(timer);
    return { network_isolated: false, note: 'WARNING: outbound request succeeded; Phase B was not run with --network none' };
  } catch {
    return { network_isolated: true, note: 'outbound request failed as expected' };
  }
}

function dirSizeBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch { /* ignore */ } }
    }
  };
  if (!fs.existsSync(dir)) return null;
  walk(dir);
  return total;
}

/**
 * Re-hash the pinned large model artifacts before any inference.
 *
 * Scope, stated precisely because the prose used to overstate it: this pins the
 * SIX large binaries in expected_artifacts.json (5 ONNX graphs + the DeBERTa
 * sentencepiece model). All 40 Phase A files are revision-pinned at their URL
 * and digest-recorded in the Phase A manifest; the 34 small tokenizer/config
 * blobs are not additionally pinned here because their upstream git blob oids
 * are not SHA-256 values.
 *
 * AUDIT FIX: a MISSING artifact used to be recorded as {present:false, ok:false}
 * and the run continued, so only a post-hoc test caught it. Absence and mismatch
 * are both now hard failures.
 */
function verifyArtifactHashes() {
  const expPath = path.join(__dirname, 'expected_artifacts.json');
  const expected = JSON.parse(fs.readFileSync(expPath, 'utf8')).artifacts;
  const checked = [];
  for (const [rel, exp] of Object.entries(expected)) {
    const p = path.join(ARTIFACTS_DIR, rel);
    if (!fs.existsSync(p)) {
      throw new Error(`PHASE B ARTIFACT MISSING ${rel}: refusing to benchmark against an absent pinned artifact. Re-run Phase A.`);
    }
    const actual = sha256File(p);
    if (actual !== exp.sha256) {
      throw new Error(`PHASE B ARTIFACT HASH MISMATCH ${rel}: expected ${exp.sha256}, got ${actual}`);
    }
    checked.push({ artifact: rel, present: true, ok: true, sha256: actual, bytes: fs.statSync(p).size });
  }
  return checked;
}

async function collectRawPredictions(candidate, rows) {
  const inputFor = candidate.inputMode === 'title_only' ? titleOnlyInput : normalisedInput;
  const views = rows.map(candidateView);
  const inputs = rows.map(inputFor);

  // Warm-up excluded from timing, per #137 §2.
  await candidate.predictRaw(views[0], inputs[0]);

  const t0 = performance.now();
  const raws = [];
  for (let i = 0; i < rows.length; i++) {
    raws.push(await candidate.predictRaw(views[i], inputs[i]));
  }
  const wallMs = performance.now() - t0;
  return { raws, wallMs, rowsPerSec: rows.length / (wallMs / 1000) };
}

function hashPredictions(preds) {
  // Hash the decision surface, not floats, so the digest is meaningful across
  // runs; raw scores are hashed separately at full precision.
  const shape = preds.map((p) => ({ labels: p.labels, top1: p.top1, abstained: p.abstained }));
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

function hashRawScores(raws) {
  const shape = raws.map((r) => Object.entries(r.scores).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}:${Number(v).toExponential(17)}`).join('|'));
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

async function main() {
  const taxonomy = loadTaxonomy(ROOT);
  const coreLabelIds = taxonomy.core.map((l) => l.id);
  const fixtureRows = loadFixture(path.join(ROOT, 'fixture'));

  const validation = validateFixture(fixtureRows, taxonomy);
  if (!validation.ok) {
    throw new Error(`FIXTURE VALIDATION FAILED:\n${JSON.stringify(validation.violations.slice(0, 40), null, 2)}`);
  }
  const census = fixtureCensus(fixtureRows, taxonomy);
  const isolation = await assertNetworkIsolated();
  const artifactChecks = verifyArtifactHashes();

  console.log(`NODE_VERSION=${process.version}`);
  console.log(`PLATFORM=${process.platform}/${process.arch}`);
  console.log(`ORT_VERSION=${ortVersion()}`);
  console.log(`FIXTURE_ROWS=${fixtureRows.length} PERSONAS=${census.persona_count} ETLD1=${census.distinct_etld1}`);
  console.log(`NETWORK_ISOLATED=${isolation.network_isolated}`);
  console.log(`ARTIFACTS_VERIFIED=${artifactChecks.filter((c) => c.ok).length}/${artifactChecks.length}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const predictionsDir = path.join(RESULTS_DIR, 'predictions');
  fs.mkdirSync(predictionsDir, { recursive: true });

  let phaseAManifest = null;
  const manifestPath = path.join(ARTIFACTS_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) phaseAManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const inputDigests = {
    'fixture/fixture_labelled.json': sha256File(path.join(ROOT, 'fixture', 'fixture_labelled.json')),
    'fixture/fixture_raw.json': sha256File(path.join(ROOT, 'fixture', 'fixture_raw.json')),
    'taxonomy.json': sha256File(path.join(ROOT, 'taxonomy.json')),
  };
  for (const f of ['lib/metrics.js', 'lib/prediction.js', 'lib/fixture.js', 'lib/contamination.js',
    'lib/onnx_engines.js', 'run_bench.js', 'models.js', 'ut1_category_map.json',
    'candidates/index.js', 'candidates/embedding_labelsim.js',
    'candidates/nli_entailment.js', 'candidates/ut1_domain_list.js']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) inputDigests[`harness/${f}`] = sha256File(p);
  }

  const results = {
    _generator: {
      script: 'tools/classifier-bench/harness/run_bench.js',
      run_tag: RUN_TAG,
      argv: process.argv.slice(2),
      generated_at: new Date().toISOString(),
      hand_edited: false,
      note: 'Generated by code only. Any field not emitted by this script is a hand edit and invalidates the artifact.',
    },
    banner: 'No winner is declared in this artifact — the decision belongs to ChmaraX/forensix#126.',
    environment: {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      ort_version: ortVersion(),
      ort_session_options: SESSION_OPTIONS,
      network_isolated: isolation.network_isolated,
      network_isolation_note: isolation.note,
      docker_image_digest: process.env.IMAGE_DIGEST || null,
      cpu_count: require('node:os').cpus().length,
    },
    inputs: { digests: inputDigests, artifact_verification: artifactChecks, phase_a_manifest: phaseAManifest },
    fixture: {
      path: 'tools/classifier-bench/fixture/fixture_labelled.json',
      census,
      limitations: {
        row_count: fixtureRows.length,
        requested_by_issue: '500+',
        persona_count: census.persona_count,
        persona_note: 'CONFIRMED two personas: the 2021 Chromebook and 2021 Takeout packages are the same staged persona (research/_raw/137-chromebook-recon.md:400). Earlier artifacts said three.',
        zero_gold_labels: Object.entries(census.per_label).filter(([, v]) => v.gold_rows === 0).map(([k]) => k),
        adult_recall_measurable: census.per_label.adult_sexual_content.gold_rows > 0,
        adult_note: 'Adult FALSE POSITIVES are measurable against gold-negative rows. Adult FALSE NEGATIVES (recall) are UNMEASURABLE: this fixture has no Adult-positive rows. Never reported as 0.',
        non_english_rows: 0,
        held_out_split: 'IMPOSSIBLE at this domain count; any threshold selected from the sweep is selected and reported on the same rows.',
      },
    },
    taxonomy: {
      core_label_count: coreLabelIds.length,
      source: 'research/137-taxonomy-proposal.md section 3',
      overlay_in_scope: taxonomy.overlay_in_scope === true,
      overlay_note: 'Overlay labels are declared out of scope for this bench: no candidate emits them and the fixture carries no overlay gold rows.',
    },
    shortlisted_options: {
      note: 'ChmaraX/forensix#136 shortlisted six options. Some options are run in more than one CONFIGURATION; configurations of one option are not separate options and must not be counted as such.',
      expected: ['ut1', 'potion-base-2M', 'potion-base-8M', 'bge-micro-v2', 'all-MiniLM-L6-v2', 'nli-deberta-v3-xsmall'],
    },
    candidates: [],
    failures: [],
  };

  for (const spec of selectCandidates(ONLY)) {
    console.log(`\n=== ${spec.id} ===`);
    const started = Date.now();
    try {
      const candidate = await spec.build({ artifactsDir: ARTIFACTS_DIR, taxonomy, fixtureRows });

      // Fail-closed contamination guard. Runs BEFORE any measurement.
      const guard = contaminationGuard(fixtureRows, candidate);
      // Extra check for large declared tables: verify no surviving entry shares a
      // registrable domain with the fixture, without materialising the whole list.
      if (candidate.engine_kind === 'lookup-table') {
        const fixtureDomains = new Set(fixtureRows.map((r) => registrable(r.url)).filter(Boolean).map((d) => d.toLowerCase()));
        let leaks = 0;
        for (const row of fixtureRows) {
          const raw = await candidate.predictRaw(candidateView(row), normalisedInput(row));
          if (raw.listHit === true) leaks++;
        }
        guard.post_removal_fixture_hits = leaks;
        guard.post_removal_note = leaks === 0
          ? 'zero fixture rows match the compiled table after overlap removal — coverage is a strict lower bound'
          : `${leaks} fixture rows still match after removal; investigate before quoting coverage`;
        guard.fixture_etld1_count = fixtureDomains.size;
      }

      const run1 = await collectRawPredictions(candidate, fixtureRows);
      const predictions = run1.raws.map((r) => applyDecision(r, candidate.decision));

      // Same-process repeat, then a separate-process digest is compared by the
      // caller (run_determinism.sh) — the audit showed an in-process double run
      // cannot detect fresh-process nondeterminism.
      const run2 = await collectRawPredictions(candidate, fixtureRows);
      const predictions2 = run2.raws.map((r) => applyDecision(r, candidate.decision));
      const decisionHash = hashPredictions(predictions);
      const rawHash = hashRawScores(run1.raws);

      const report = classificationReport(fixtureRows, predictions, coreLabelIds);
      const charitable = charitableReport(fixtureRows, predictions, coreLabelIds);
      const rowMetrics = multiLabelRowMetrics(fixtureRows, predictions);
      const coverage = coverageOf(predictions);

      const sweep = candidate.sweep && candidate.sweep.axis
        ? coverageAccuracySweep(fixtureRows, run1.raws, candidate.sweep.thresholds, candidate.decision, candidate.sweep.axis)
        : { applicable: false, reason: candidate.sweep?.reason || 'candidate exposes no continuous score axis' };

      const bootstrap = bootstrapMacroF1(fixtureRows, predictions, coreLabelIds, {
        resamples: BOOTSTRAP_RESAMPLES, seed: 137, policy: 'macro_f1_evaluable',
      });

      const footprintDir = candidate.model?.artifact_dir
        || (candidate.engine_kind === 'lookup-table' ? path.join(ARTIFACTS_DIR, 'ut1') : null);
      const bytes = footprintDir ? dirSizeBytes(footprintDir) : null;

      const record = {
        id: candidate.id,
        family: candidate.family,
        shortlisted_option: spec.shortlisted_option || candidate.shortlisted_option || candidate.id,
        configuration: candidate.configuration || 'default',
        configuration_note: candidate.configuration_note || null,
        input_mode: candidate.inputMode,
        engine_kind: candidate.engine_kind,
        engine_details: candidate.engine_details || null,
        model: candidate.model || null,
        licence: candidate.licence || null,
        supervision: guard,
        supervision_declaration: {
          kind: candidate.supervision.kind,
          source: candidate.supervision.source,
          template: candidate.supervision.template || null,
          mapping_file: candidate.supervision.mapping_file || null,
        },
        decision: candidate.decision,
        determinism: {
          same_process_repeat_match: decisionHash === hashPredictions(predictions2),
          decision_hash: decisionHash,
          raw_score_hash: rawHash,
          separate_process: 'compared externally; see results/determinism-<arch>.json',
          cross_architecture: 'see results/cross-arch-comparison.json; unmeasured unless that file exists',
        },
        throughput: {
          rows_per_sec: run1.rowsPerSec,
          wall_ms: run1.wallMs,
          projected_100k_row_wall_clock_sec: 100000 / run1.rowsPerSec,
        },
        disk_footprint: { bytes, human: bytes === null ? 'not measured' : `${(bytes / 1024 / 1024).toFixed(2)} MB` },
        coverage,
        coverage_definition: 'fraction of rows where the candidate did not abstain; one definition for every candidate',
        abstain_breakdown: predictions.reduce((m, p) => {
          const k = p.abstainReason || 'none';
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {}),
        macro_f1_fixed_core: report.macro_f1_fixed_core,
        macro_f1_evaluable: report.macro_f1_evaluable,
        macro_f1_powered_only: report.macro_f1_powered_only,
        micro_f1: report.micro_f1,
        multi_label_row_metrics: rowMetrics,
        label_states: report.label_states,
        per_class: report.per_class,
        charitable_ambiguous_scoring: {
          note: 'Rows the labeller flagged ambiguous are re-scored charitably (any defensible label counts). Published alongside strict, never instead of it.',
          macro_f1_evaluable: charitable.macro_f1_evaluable.value,
          micro_f1: charitable.micro_f1,
        },
        special_category_confusion: {
          adult_sexual_content: specialCategoryConfusion(fixtureRows, predictions, 'adult_sexual_content'),
          health_medical: specialCategoryConfusion(fixtureRows, predictions, 'health_medical'),
        },
        confusion_pairs: confusionPairs(fixtureRows, predictions, coreLabelIds),
        coverage_accuracy_sweep: sweep,
        bootstrap_ci: bootstrap,
        sensitivity: leaveOneOutRanges(fixtureRows, predictions, coreLabelIds),
        leakage_diagnostic: leakageDiagnostic(fixtureRows, predictions, coreLabelIds),
        elapsed_sec: (Date.now() - started) / 1000,
      };
      results.candidates.push(record);

      // Row-level predictions, persisted for error analysis and re-scoring.
      const rowsOut = fixtureRows.map((row, i) => ({
        row_id: row.row_id,
        title: row.title,
        url: row.url,
        etld1: row.etld1,
        persona_id: row.persona_id,
        gold: row.labels,
        ambiguous: row.ambiguous,
        predicted: predictions[i].labels,
        top1: predictions[i].top1,
        raw_top1: predictions[i].rawTop1,
        raw_top1_score: predictions[i].rawTop1Score,
        margin: predictions[i].margin,
        abstained: predictions[i].abstained,
        abstain_reason: predictions[i].abstainReason,
        score_axis: predictions[i].scoreAxis,
        ranked: predictions[i].ranked.slice(0, 5),
      }));
      fs.writeFileSync(
        path.join(predictionsDir, `${candidate.id}.${process.arch}.${RUN_TAG}.json`),
        JSON.stringify({ candidate_id: candidate.id, arch: process.arch, run_tag: RUN_TAG, decision_hash: decisionHash, raw_score_hash: rawHash, rows: rowsOut }, null, 2)
      );

      console.log(
        `  coverage=${(coverage * 100).toFixed(1)}%` +
        `  macroF1(evaluable ${report.macro_f1_evaluable.label_count})=${report.macro_f1_evaluable.value?.toFixed(3)}` +
        `  macroF1(fixed20)=${report.macro_f1_fixed_core.value?.toFixed(3)}` +
        `  microF1=${report.micro_f1?.toFixed(3)}` +
        `  det=${record.determinism.same_process_repeat_match}` +
        `  rows/s=${run1.rowsPerSec.toFixed(0)}` +
        `  ${record.disk_footprint.human}` +
        `  ${record.elapsed_sec.toFixed(1)}s`
      );
    } catch (err) {
      console.error(`  CANDIDATE FAILED: ${err.message}`);
      results.failures.push({ id: spec.id, error: err.message, stack: String(err.stack || '').split('\n').slice(0, 6).join('\n') });
    }
  }

  const outPath = path.join(RESULTS_DIR, RUN_TAG === 'main' ? 'results.json' : `results.${RUN_TAG}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`Candidates run: ${results.candidates.length}, failures: ${results.failures.length}`);
  if (results.failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('BENCH_FAILED:', err.stack ?? err.message);
  process.exit(1);
});
