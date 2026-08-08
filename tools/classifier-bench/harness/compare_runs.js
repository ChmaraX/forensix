'use strict';
// Compares two sets of per-row prediction files and emits a machine-readable
// verdict. Used for (a) separate-process determinism on one architecture,
// (b) cross-architecture comparison of decisions, and (c) Phase A artifact
// parity between two architectures' download manifests.
//
// Usage:
//   node compare_runs.js determinism <resultsDir> <arch> <tagA> <tagB> [...tags]
//   node compare_runs.js cross-arch   <resultsDir> <archA> <archB> <tag> [emulationNote]
//   node compare_runs.js artifacts    <resultsDir> <manifestA> <manifestB> <archA> <archB>
//
// If the required prediction files are absent the comparison reports
// "not measured". It never infers a verdict it did not compute.

const fs = require('node:fs');
const path = require('node:path');

function loadPred(dir, candidateId, arch, tag) {
  const p = path.join(dir, 'predictions', `${candidateId}.${arch}.${tag}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function candidateIdsFrom(resultsDir) {
  const rp = path.join(resultsDir, 'results.json');
  if (!fs.existsSync(rp)) return [];
  return JSON.parse(fs.readFileSync(rp, 'utf8')).candidates.map((c) => c.id);
}

/**
 * Separate-process determinism.
 *
 * The per-run ROW-LEVEL artifacts for the repeat runs (det1/det2) are not
 * committed: they were byte-identical to the main run apart from their run_tag,
 * i.e. ~4 MB of duplication whose only evidentiary content is the digest. This
 * summary IS the retained evidence, so it must preserve every run digest and
 * must refuse to silently downgrade if those inputs are no longer present.
 */
function determinism(resultsDir, arch, tags, options) {
  const previous = (options && options.previous) || null;
  const out = { mode: 'separate-process-determinism', arch, tags, per_candidate: {} };
  out.evidence_note = [
    'Row-level artifacts for the repeat runs are not committed; their decision and',
    'raw-score digests are retained here, and that is what the determinism claim',
    'rests on. Regenerating this file without those runs present would LOSE',
    'evidence, so a previously measured candidate that can no longer be measured is',
    'a hard failure, never a silent downgrade to "not measured".',
  ].join(' ');

  const lost = [];
  for (const id of candidateIdsFrom(resultsDir)) {
    const runs = tags.map((t) => loadPred(resultsDir, id, arch, t)).filter(Boolean);
    if (runs.length < 2) {
      const prior = previous && previous.per_candidate ? previous.per_candidate[id] : null;
      if (prior && prior.measured) {
        lost.push({ id, previously_runs: prior.runs, now_found: runs.length });
        continue;
      }
      out.per_candidate[id] = { measured: false, reason: `need >=2 runs, found ${runs.length}` };
      continue;
    }
    const decisionHashes = [...new Set(runs.map((r) => r.decision_hash))];
    const rawHashes = [...new Set(runs.map((r) => r.raw_score_hash))];
    out.per_candidate[id] = {
      measured: true,
      runs: runs.length,
      match: decisionHashes.length === 1,
      raw_score_match: rawHashes.length === 1,
      decision_hashes: decisionHashes,
      raw_score_hashes: rawHashes,
    };
  }

  if (lost.length) {
    throw new Error(
      'DETERMINISM EVIDENCE WOULD BE LOST: '
      + lost.map((l) => `${l.id} (was ${l.previously_runs} runs, found ${l.now_found})`).join(', ')
      + '. The existing determinism-summary.json records a real measurement for these candidates and '
      + 'the row-level artifacts backing it are no longer on disk. Re-run the repeat processes '
      + '(scripts/reproduce.sh) before regenerating, or the claim loses its evidence.'
    );
  }
  return out;
}

function crossArch(resultsDir, archA, archB, tag, emulationNote) {
  const out = {
    mode: 'cross-architecture',
    arch_a: archA,
    arch_b: archB,
    tag,
    emulation_note: emulationNote || null,
    per_candidate: {},
  };
  for (const id of candidateIdsFrom(resultsDir)) {
    const a = loadPred(resultsDir, id, archA, tag);
    const b = loadPred(resultsDir, id, archB, tag);
    if (!a || !b) {
      out.per_candidate[id] = {
        measured: false,
        reason: `missing predictions for ${!a ? archA : archB}`,
      };
      continue;
    }
    const byId = new Map(b.rows.map((r) => [r.row_id, r]));
    // AUDIT FIX. This used to compare `JSON.stringify(predicted)`, which is
    // ORDER-SENSITIVE: `predicted` is emitted in descending-score order, so a
    // pure rank permutation of an identical label SET counted as a differing
    // decision. That overstated all-MiniLM as 65 differing rows (31%) when the
    // set-level number is 53 (25.5%), and published a lead example whose two
    // sides were the same three labels reordered. Sets and order are now
    // counted and reported separately.
    let differingSets = 0;      // the forensically meaningful number
    let orderOnly = 0;          // same labels, different rank
    let differingRawTop1 = 0;   // the model's own top choice changed
    let bandFlipOnly = 0;       // set differs but raw top-1 did not
    const setExamples = [];
    const orderExamples = [];
    const norm = (xs) => JSON.stringify([...(xs || [])].slice().sort());
    for (const ra of a.rows) {
      const rb = byId.get(ra.row_id);
      if (!rb) continue;
      const sameSequence = JSON.stringify(ra.predicted) === JSON.stringify(rb.predicted);
      const sameSet = norm(ra.predicted) === norm(rb.predicted);
      const rawTop1Changed = ra.raw_top1 !== rb.raw_top1;
      if (rawTop1Changed) differingRawTop1++;
      if (!sameSet) {
        differingSets++;
        if (!rawTop1Changed) bandFlipOnly++;
        if (setExamples.length < 10) {
          setExamples.push({
            row_id: ra.row_id,
            a: ra.predicted,
            b: rb.predicted,
            raw_top1_a: ra.raw_top1,
            raw_top1_b: rb.raw_top1,
            raw_top1_changed: rawTop1Changed,
            url: ra.url.slice(0, 90),
          });
        }
      } else if (!sameSequence) {
        orderOnly++;
        if (orderExamples.length < 5) {
          orderExamples.push({ row_id: ra.row_id, a: ra.predicted, b: rb.predicted, url: ra.url.slice(0, 90) });
        }
      }
    }
    out.per_candidate[id] = {
      measured: true,
      decision_hash_match: a.decision_hash === b.decision_hash,
      raw_score_hash_match: a.raw_score_hash === b.raw_score_hash,
      rows_compared: a.rows.length,
      // The label SET is the decision a report would carry. This is the number
      // to quote.
      differing_label_sets: differingSets,
      // Same labels, different emission order. Not a decision difference.
      differing_label_order_only: orderOnly,
      // Retained for continuity: set differences plus order-only differences,
      // i.e. what the order-sensitive comparison used to report on its own.
      differing_emitted_sequence: differingSets + orderOnly,
      differing_raw_top1: differingRawTop1,
      set_differences_without_raw_top1_change: bandFlipOnly,
      band_flip_note: differingSets > 0
        ? `${bandFlipOnly} of ${differingSets} set differences occur with an UNCHANGED raw top-1: the multi-label emission band admitted or dropped a label, it did not change the model's first choice. ${differingRawTop1} rows changed raw top-1.`
        : 'no set differences',
      differing_examples: setExamples,
      order_only_examples: orderExamples,
    };
  }
  const unmeasured = Object.entries(out.per_candidate).filter(([, v]) => !v.measured).map(([id]) => id);
  out.complete = unmeasured.length === 0;
  out.unmeasured_candidates = unmeasured;
  out.completeness_note = unmeasured.length === 0
    ? `every candidate in results.json has a ${archA} and a ${archB} prediction artifact`
    : `no complete ${archB} prediction artifact exists for ${unmeasured.length} of ${Object.keys(out.per_candidate).length} configurations; they are reported as not measured, never inferred from the ${archA} result`;
  out.note = 'raw_score_hash compares full-precision per-label scores; decision_hash compares the emitted prediction sequence. Bitwise score divergence with identical decisions means the difference never crossed a decision boundary ON THIS FIXTURE, which is an observation, not a guarantee at other scales.';
  out.counting_note = 'differing_label_sets is the decision-level number and the one to quote: it compares label SETS, order-independently. differing_label_order_only counts rows where the same labels were emitted in a different rank order, which is not a decision difference. set_differences_without_raw_top1_change isolates rows where only the multi-label emission band moved, not the model\'s first choice — that band is a fixed, unswept hyperparameter, so those rows measure threshold sensitivity as much as architecture.';
  return out;
}

/**
 * Phase A artifact parity: compares two download manifests file-by-file.
 * The model binaries and the compiled UT1 table are never committed, so their
 * digests are the only durable evidence that both architectures fetched and
 * compiled byte-identical inputs.
 */
function artifactParity(manifestPathA, manifestPathB, archA, archB) {
  const a = JSON.parse(fs.readFileSync(manifestPathA, 'utf8'));
  const b = JSON.parse(fs.readFileSync(manifestPathB, 'utf8'));

  const index = (m) => {
    const map = new Map();
    for (const model of m.models || []) {
      for (const f of model.files || []) map.set(`${model.dir}/${f.file}`, f);
    }
    return map;
  };
  const ia = index(a);
  const ib = index(b);

  const files = [];
  for (const [rel, fa] of ia) {
    const fb = ib.get(rel);
    files.push(fb
      ? { artifact: rel, compared: true, identical: fa.sha256 === fb.sha256, sha256: fa.sha256 === fb.sha256 ? fa.sha256 : null, sha256_a: fa.sha256, sha256_b: fb.sha256, bytes: fa.bytes }
      : { artifact: rel, compared: false, reason: `absent from ${archB} manifest` });
  }
  for (const rel of ib.keys()) {
    if (!ia.has(rel)) files.push({ artifact: rel, compared: false, reason: `absent from ${archA} manifest` });
  }

  const compared = files.filter((f) => f.compared);
  const ut1a = a.ut1 || null;
  const ut1b = b.ut1 || null;
  const ut1 = ut1a && ut1b
    ? {
      compared: true,
      compiled_sha256_match: ut1a.compiled_sha256 === ut1b.compiled_sha256,
      compiled_sha256: ut1a.compiled_sha256 === ut1b.compiled_sha256 ? ut1a.compiled_sha256 : null,
      compiled_sha256_a: ut1a.compiled_sha256,
      compiled_sha256_b: ut1b.compiled_sha256,
      total_hosts_match: ut1a.total_hosts === ut1b.total_hosts,
      total_hosts: ut1a.total_hosts,
      downloaded_on_match: (ut1a.downloaded_on ?? ut1a.snapshot_date) === (ut1b.downloaded_on ?? ut1b.snapshot_date),
      pin_verified_both: Boolean(ut1a.pin_verified) && Boolean(ut1b.pin_verified),
      category_count_match: (ut1a.categories || []).length === (ut1b.categories || []).length,
      category_digest_mismatches: (ut1a.categories || [])
        .filter((ca) => {
          const cb = (ut1b.categories || []).find((x) => x.category === ca.category);
          return !cb || cb.sha256 !== ca.sha256;
        })
        .map((ca) => ca.category),
    }
    : { compared: false, reason: 'one or both manifests carry no UT1 section' };

  return {
    mode: 'phase-a-artifact-parity',
    _generator: {
      script: 'tools/classifier-bench/harness/compare_runs.js',
      generated_at: new Date().toISOString(),
      hand_edited: false,
      inputs: [path.basename(manifestPathA), path.basename(manifestPathB)],
    },
    arch_a: archA,
    arch_b: archB,
    downloaded_at: { [archA]: a.downloaded_at || null, [archB]: b.downloaded_at || null },
    platform: { [archA]: a.platform || null, [archB]: b.platform || null },
    summary: {
      files_compared: compared.length,
      files_identical: compared.filter((f) => f.identical).length,
      files_not_compared: files.length - compared.length,
      all_model_files_identical: compared.length > 0 && compared.every((f) => f.identical),
      ut1_compiled_identical: ut1.compared ? ut1.compiled_sha256_match : null,
    },
    files,
    ut1,
    note: 'Parity of INPUTS only. Identical Phase A digests mean both architectures ran the same bytes; they say nothing about whether inference produced identical outputs — that is measured separately in cross-arch-comparison.json.',
  };
}

function main() {
  const [mode, resultsDir, ...rest] = process.argv.slice(2);
  if (!mode || !resultsDir) {
    console.error('usage: compare_runs.js <determinism|cross-arch> <resultsDir> ...');
    process.exit(2);
  }
  let out, outName;
  if (mode === 'determinism') {
    const [arch, ...tags] = rest;
    outName = 'determinism-summary.json';
    // Load any existing summary so a regeneration that can no longer see the
    // repeat runs fails loudly instead of quietly erasing the measurement.
    const priorPath = path.join(resultsDir, outName);
    const previous = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath, 'utf8')) : null;
    out = determinism(resultsDir, arch, tags, { previous });
  } else if (mode === 'cross-arch') {
    const [archA, archB, tag = 'main', emulationNote] = rest;
    out = crossArch(resultsDir, archA, archB, tag, emulationNote);
    outName = 'cross-arch-comparison.json';
  } else if (mode === 'artifacts') {
    const [manifestA, manifestB, archA = 'a', archB = 'b'] = rest;
    if (!manifestA || !manifestB) {
      console.error('usage: compare_runs.js artifacts <resultsDir> <manifestA> <manifestB> <archA> <archB>');
      process.exit(2);
    }
    out = artifactParity(manifestA, manifestB, archA, archB);
    outName = 'artifact-parity.json';
  } else {
    console.error(`unknown mode: ${mode}`);
    process.exit(2);
  }
  const p = path.join(resultsDir, outName);
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(`Wrote ${p}`);
  if (out.per_candidate) {
    for (const [id, v] of Object.entries(out.per_candidate)) {
      if (!v.measured) { console.log(`  ${id}: not measured`); continue; }
      const verdict = v.match ?? v.decision_hash_match;
      const detail = v.differing_label_sets !== undefined
        ? ` (label sets differ on ${v.differing_label_sets}, order-only ${v.differing_label_order_only}, raw top-1 ${v.differing_raw_top1})`
        : '';
      console.log(`  ${id}: ${verdict}${detail}`);
    }
    if (out.completeness_note) console.log(`  ${out.completeness_note}`);
  } else {
    console.log(`  model files identical: ${out.summary.files_identical}/${out.summary.files_compared}`);
    console.log(`  UT1 compiled digest identical: ${out.summary.ut1_compiled_identical}`);
  }
}

if (require.main === module) main();
module.exports = { determinism, crossArch, artifactParity };
