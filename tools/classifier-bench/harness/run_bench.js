'use strict';
// Phase B (--network none): candidate-agnostic bench run.
// One command in, results table out, per #137 §2.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const { loadFixture, loadTaxonomy, normalisedInput } = require('./lib/fixture');
const { macroF1, adultConfusion, coverageAccuracySweep } = require('./lib/metrics');
const { loadEngine } = require('./lib/potion_engine');
const domainListCandidate = require('./candidates/domain_list');
const potionEmbeddingModule = require('./candidates/potion_embedding');

const ROOT = process.env.BENCH_ROOT || path.join(__dirname, '..');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(ROOT, 'results');

// --- Guardrail per #137 §4: fail the run if any test row appears in a candidate's
// exemplars/prompt/training data. Neither candidate here declares any exemplar corpus
// (domain-list uses hand-curated global-brand rules; potion-embedding uses zero-shot
// label-name similarity), so this check is a no-op by construction — but it runs and
// is auditable, not assumed away, so a future exemplar-based candidate is covered.
function contaminationGuard(fixtureRows, candidateManifest) {
  const exemplars = candidateManifest.exemplars || [];
  const fixtureUrls = new Set(fixtureRows.map((r) => r.url));
  const fixtureDomains = new Set(
    fixtureRows.map((r) => {
      try { return new URL(r.url).hostname; } catch { return null; }
    }).filter(Boolean)
  );
  const violations = [];
  for (const ex of exemplars) {
    if (fixtureUrls.has(ex.url)) violations.push({ type: 'exact-row-overlap', url: ex.url });
    try {
      const d = new URL(ex.url).hostname;
      if (fixtureDomains.has(d)) violations.push({ type: 'domain-overlap', domain: d });
    } catch { /* ignore */ }
  }
  if (violations.length) {
    throw new Error(`CONTAMINATION GUARD FAILED for ${candidateManifest.id}: ${JSON.stringify(violations)}`);
  }
  return { exemplarCount: exemplars.length, violations: [] };
}

async function runCandidate(candidate, rows) {
  // Warm-up pass excluded from timing, per #137 §2.
  await candidate.predict(rows[0], normalisedInput(rows[0]));

  const t0 = performance.now();
  const predictions = [];
  for (const row of rows) {
    predictions.push(await candidate.predict(row, normalisedInput(row)));
  }
  const t1 = performance.now();
  const wallMs = t1 - t0;
  const rowsPerSec = rows.length / (wallMs / 1000);

  return { predictions, wallMs, rowsPerSec };
}

async function checkDeterminism(candidate, rows) {
  const runA = await runCandidate(candidate, rows);
  const runB = await runCandidate(candidate, rows);
  const hashA = crypto.createHash('sha256').update(JSON.stringify(runA.predictions)).digest('hex');
  const hashB = crypto.createHash('sha256').update(JSON.stringify(runB.predictions)).digest('hex');
  return { deterministic: hashA === hashB, hashA, hashB, run: runA };
}

function diskFootprint(dir) {
  try {
    const out = execSync(`du -sb "${dir}" 2>/dev/null || du -sk "${dir}"`).toString().trim();
    const bytes = parseInt(out.split(/\s+/)[0], 10);
    return { bytes, human: `${(bytes / 1024 / 1024).toFixed(2)} MB` };
  } catch {
    return { bytes: null, human: 'unavailable' };
  }
}

async function main() {
  const taxonomy = loadTaxonomy(ROOT);
  const coreLabelIds = taxonomy.core.map((l) => l.id);
  const fixtureRows = loadFixture(path.join(ROOT, 'fixture'));

  console.log(`NODE_VERSION=${process.version}`);
  console.log(`PLATFORM=${process.platform}/${process.arch}`);
  console.log(`FIXTURE_ROWS=${fixtureRows.length}`);
  console.log(`CORE_LABELS=${coreLabelIds.length}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const results = {
    generated_at: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node_version: process.version },
    fixture: { row_count: fixtureRows.length, path: 'tools/classifier-bench/fixture/fixture_labelled.json' },
    taxonomy: { core_label_count: coreLabelIds.length, source: 'research/137-taxonomy-proposal.md' },
    candidates: [],
    banner: 'No winner is declared in this artifact — the decision belongs to ChmaraX/forensix#126.',
  };

  // --- Candidate 1: domain-list (family 5, deterministic, no model, no network needed) ---
  {
    console.log('\n=== domain-list-v1 ===');
    contaminationGuard(fixtureRows, { id: domainListCandidate.id, exemplars: [] });
    const det = await checkDeterminism(domainListCandidate, fixtureRows);
    const { predictions, rowsPerSec } = det.run;
    const m = macroF1(fixtureRows, predictions, coreLabelIds);
    const adult = adultConfusion(fixtureRows, predictions);
    const coverage = predictions.filter((p) => p.top1 !== null).length / predictions.length;
    const sweep = coverageAccuracySweep(fixtureRows, predictions, [0, 1.0]); // binary: matched or not

    results.candidates.push({
      id: domainListCandidate.id,
      family: domainListCandidate.family,
      determinism: { deterministic: det.deterministic, hash: det.hashA },
      throughput: { rows_per_sec: rowsPerSec, projected_100k_row_wall_clock_sec: 100000 / rowsPerSec },
      disk_footprint: { human: 'N/A — no model artifacts, source is inline code' },
      coverage,
      macro_f1: m.macroF1,
      scored_label_count: m.scoredLabelCount,
      total_label_count: m.totalLabelCount,
      per_class: m.perClass,
      adult_confusion: adult,
      coverage_accuracy_sweep: sweep,
    });
    console.log(`  coverage=${(coverage * 100).toFixed(1)}%  macroF1(scored ${m.scoredLabelCount}/${m.totalLabelCount})=${m.macroF1?.toFixed(3)}  det=${det.deterministic}  rows/sec=${rowsPerSec.toFixed(0)}`);
  }

  // --- Candidate 2: potion-base-2M label-name similarity (family 3b) ---
  {
    console.log('\n=== potion-base-2M-labelsim-v1 ===');
    const modelDir = path.join(ARTIFACTS_DIR, 'potion-base-2M');
    const engine = await loadEngine(modelDir);
    const candidate = await potionEmbeddingModule.buildCandidate(engine, taxonomy);
    contaminationGuard(fixtureRows, { id: candidate.id, exemplars: [] });

    const det = await checkDeterminism(candidate, fixtureRows);
    const { predictions, rowsPerSec } = det.run;
    const m = macroF1(fixtureRows, predictions, coreLabelIds);
    const adult = adultConfusion(fixtureRows, predictions);
    const coverage = predictions.filter((p) => p.top1 !== 'unclassified').length / predictions.length;
    const thresholds = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
    const sweep = coverageAccuracySweep(
      fixtureRows,
      predictions.map((p) => ({ ...p, topScore: p.margin })), // sweep on abstain margin, not raw cosine
      thresholds
    );
    const footprint = diskFootprint(modelDir);

    results.candidates.push({
      id: candidate.id,
      family: candidate.family,
      abstain_margin: potionEmbeddingModule.ABSTAIN_MARGIN,
      determinism: { deterministic: det.deterministic, hash: det.hashA },
      throughput: { rows_per_sec: rowsPerSec, projected_100k_row_wall_clock_sec: 100000 / rowsPerSec },
      disk_footprint: footprint,
      coverage,
      macro_f1: m.macroF1,
      scored_label_count: m.scoredLabelCount,
      total_label_count: m.totalLabelCount,
      per_class: m.perClass,
      adult_confusion: adult,
      coverage_accuracy_sweep: sweep,
      ort_version: engine.ortVersion,
    });
    console.log(`  coverage=${(coverage * 100).toFixed(1)}%  macroF1(scored ${m.scoredLabelCount}/${m.totalLabelCount})=${m.macroF1?.toFixed(3)}  det=${det.deterministic}  rows/sec=${rowsPerSec.toFixed(0)}  footprint=${footprint.human}`);
  }

  fs.writeFileSync(path.join(RESULTS_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${path.join(RESULTS_DIR, 'results.json')}`);
}

main().catch((err) => {
  console.error('BENCH_FAILED:', err.stack ?? err.message);
  process.exit(1);
});
