'use strict';
// Schema tests for the generated artifacts. These guard against the audit's
// finding that results.json contained fields no code emitted (hand edits), and
// that the leaderboard rendered unmeasured cells as if they were measured.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, '..', '..', 'results');
const resultsPath = path.join(RESULTS_DIR, 'results.json');
const hasResults = fs.existsSync(resultsPath);

// Fail closed. `scripts/reproduce.sh` used to run these tests without mounting
// the results volume, so RESULTS_DIR resolved to a non-existent path and 8 of 9
// checks silently skipped with exit 0 -- the guard against hand-edited artifacts
// was itself a no-op in the documented reproduce path. A caller that explicitly
// names a results directory must never get a green run from an absent one.
if (process.env.RESULTS_DIR && !hasResults) {
  throw new Error(
    `RESULTS_DIR=${process.env.RESULTS_DIR} was set but ${resultsPath} is absent; `
    + 'refusing to skip the artifact-integrity checks. Mount the results volume or unset RESULTS_DIR.'
  );
}

test('results.json exists and declares its generator', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  assert.ok(r._generator, 'must carry generator identity so hand edits are detectable');
  assert.equal(r._generator.script, 'tools/classifier-bench/harness/run_bench.js');
  assert.equal(r._generator.hand_edited, false);
  assert.match(r.banner, /No winner is declared/);
});

test('results.json records environment, digests and artifact verification', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  assert.ok(r.environment.node_version);
  assert.ok(r.environment.ort_version && r.environment.ort_version !== 'unknown', 'ORT version must resolve');
  assert.equal(r.environment.ort_session_options.intraOpNumThreads, 1, 'threads must be pinned for determinism');
  assert.equal(r.environment.network_isolated, true, 'Phase B must run with --network none');
  assert.ok(r.inputs.digests['fixture/fixture_labelled.json'], 'fixture digest must be embedded');
  assert.ok(r.inputs.digests['taxonomy.json']);
  assert.ok(r.inputs.digests['harness/lib/metrics.js'], 'scorer digest must be embedded');
  assert.ok(Array.isArray(r.inputs.artifact_verification));
  for (const a of r.inputs.artifact_verification) {
    assert.equal(a.ok, true, `artifact ${a.artifact} failed hash verification`);
  }
});

test('results.json states fixture limitations honestly', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const lim = r.fixture.limitations;
  assert.equal(lim.row_count, 208);
  assert.equal(lim.persona_count, 2);
  assert.equal(lim.adult_recall_measurable, false);
  assert.match(lim.adult_note, /UNMEASURABLE/);
  assert.ok(lim.zero_gold_labels.includes('adult_sexual_content'));
});

test('every candidate record has the required shape', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  assert.ok(r.candidates.length > 0, 'at least one candidate must have run');
  for (const c of r.candidates) {
    assert.ok(c.id && c.family, 'candidate needs id and family');
    assert.ok(c.supervision, `${c.id} must record its contamination-guard result`);
    assert.deepEqual(c.supervision.violations, [], `${c.id} must have zero contamination violations`);
    assert.ok(c.macro_f1_evaluable && c.macro_f1_evaluable.policy, `${c.id} must state its macro policy`);
    assert.ok(c.macro_f1_fixed_core, `${c.id} must publish both macro policies`);
    assert.ok(c.per_class, `${c.id} must publish per-class detail`);
    assert.ok(c.special_category_confusion.adult_sexual_content, `${c.id} must report Adult confusion`);
    assert.ok(c.special_category_confusion.health_medical, `${c.id} must report Health confusion`);
    assert.equal(
      c.special_category_confusion.adult_sexual_content.false_negative.measurable, false,
      'Adult FN must be declared unmeasurable on this fixture'
    );
    assert.notEqual(
      c.special_category_confusion.adult_sexual_content.false_negative.count, 0,
      'unmeasurable Adult FN must never be rendered as 0'
    );
    // Every per-class entry must carry an explicit state, never a bare null F1.
    for (const [label, pc] of Object.entries(c.per_class)) {
      assert.ok(pc.state, `${c.id}/${label} missing state`);
      if (pc.f1 === null) {
        assert.equal(pc.state, 'no-gold-rows-no-predictions', `${c.id}/${label} null F1 must mean untestable`);
      }
    }
  }
});

test('per-row predictions are persisted for every candidate', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const dir = path.join(RESULTS_DIR, 'predictions');
  assert.ok(fs.existsSync(dir), 'predictions directory must exist');
  const files = fs.readdirSync(dir);
  for (const c of r.candidates) {
    assert.ok(files.some((f) => f.startsWith(`${c.id}.`)), `no per-row predictions for ${c.id}`);
  }
});

test('leaderboard.md is generated and never claims an unmeasured value', () => {
  const lb = path.join(RESULTS_DIR, 'leaderboard.md');
  if (!fs.existsSync(lb)) return; // generated after a run
  const text = fs.readFileSync(lb, 'utf8');
  assert.match(text, /No winner is declared/);
  assert.match(text, /Generated by code/);
  assert.ok(!/✅ yes \| ✅ yes/.test(text), 'must not render unmeasured determinism as a tick');

  // Every candidate the cross-arch comparison could not measure must render as
  // "not measured" in the leaderboard. The previous assertion only regex-checked
  // for a tick string the current generator cannot emit, so it could not fail.
  const crossFile = path.join(RESULTS_DIR, 'cross-arch-comparison.json');
  if (fs.existsSync(crossFile)) {
    const cross = JSON.parse(fs.readFileSync(crossFile, 'utf8'));
    for (const id of cross.unmeasured_candidates || []) {
      const line = text.split('\n').find((l) => l.includes(`\`${id}\``) && l.includes('|'));
      assert.ok(line, `${id} must appear in a leaderboard table`);
      assert.match(
        line, /not measured/,
        `${id} has no cross-arch artifact and must render as "not measured", never as a verdict`
      );
    }
  }
});

test('leaderboard publishes all three macro policies and both special-category labels', { skip: !hasResults && 'no results.json yet' }, () => {
  const lb = path.join(RESULTS_DIR, 'leaderboard.md');
  if (!fs.existsSync(lb)) return;
  const text = fs.readFileSync(lb, 'utf8');
  assert.match(text, /macro-F1 \(fixed 20\)/, 'the frozen taxonomy policy must be published');
  assert.match(text, /macro-F1 \(evaluable\)/, 'the evaluable policy must be published');
  assert.match(text, /macro-F1 \(powered 7\)/, 'the like-for-like policy must not be computed then suppressed');
  assert.match(text, /Health FP/, 'health_medical is a special-category label and must be published beside Adult');
  assert.match(text, /Health FN/);
  assert.match(text, /Adult FP/);
  assert.match(text, /No ordering (in this bench is statistically supportable|here is stable)/i,
    'the leaderboard must say plainly that its ordering is not a ranking');
});

test('leaderboard does not make a blanket list-tier claim that its own table contradicts', { skip: !hasResults && 'no results.json yet' }, () => {
  const lb = path.join(RESULTS_DIR, 'leaderboard.md');
  if (!fs.existsSync(lb)) return;
  const text = fs.readFileSync(lb, 'utf8');
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const hasFullConfig = r.candidates.some((c) => c.engine_details && c.engine_details.overlap_removal_applied === false);
  if (hasFullConfig) {
    assert.ok(
      !/\*\*Production coverage for the list tier\.\*\* Every fixture registrable domain was removed/.test(text),
      'an unconditional removal claim is false while an as-published configuration is in the same table'
    );
    assert.match(text, /Neither bounds production coverage/,
      'the limitation must distinguish the strict and full configurations');
  }
});

const detPath = path.join(RESULTS_DIR, 'determinism-summary.json');
test('determinism-summary.json covers every candidate with an explicit measured flag', { skip: !fs.existsSync(detPath) && 'no determinism summary yet' }, () => {
  const det = JSON.parse(fs.readFileSync(detPath, 'utf8'));
  assert.equal(det.mode, 'separate-process-determinism');
  assert.ok(det.tags.length >= 2, 'a separate-process check needs at least two runs');
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  for (const c of r.candidates) {
    const v = det.per_candidate[c.id];
    assert.ok(v, `${c.id} missing from the determinism summary`);
    assert.equal(typeof v.measured, 'boolean');
    if (v.measured) {
      assert.equal(typeof v.match, 'boolean', `${c.id} must state a verdict`);
      assert.ok(Array.isArray(v.decision_hashes) && v.decision_hashes.length >= 1);
    } else {
      assert.ok(v.reason, `${c.id} unmeasured entries must say why`);
    }
  }
});

const crossPath = path.join(RESULTS_DIR, 'cross-arch-comparison.json');
test('cross-arch-comparison.json never infers a verdict it did not compute', { skip: !fs.existsSync(crossPath) && 'no cross-arch comparison yet' }, () => {
  const cross = JSON.parse(fs.readFileSync(crossPath, 'utf8'));
  assert.equal(cross.mode, 'cross-architecture');
  assert.ok(cross.arch_a && cross.arch_b);
  assert.equal(typeof cross.complete, 'boolean');
  assert.ok(Array.isArray(cross.unmeasured_candidates));
  for (const [id, v] of Object.entries(cross.per_candidate)) {
    if (v.measured) {
      assert.equal(typeof v.decision_hash_match, 'boolean', `${id} must state a decision verdict`);
      assert.equal(typeof v.raw_score_hash_match, 'boolean');
      // Label SETS and label ORDER are different questions and must be counted
      // separately: `predicted` is emitted in score order, so a rank permutation
      // of an identical set is not a decision difference.
      assert.equal(typeof v.differing_label_sets, 'number', `${id} must count set-level differences`);
      assert.equal(typeof v.differing_label_order_only, 'number', `${id} must count order-only differences separately`);
      assert.equal(typeof v.differing_raw_top1, 'number');
      assert.equal(typeof v.set_differences_without_raw_top1_change, 'number');
      assert.ok(
        v.differing_label_sets <= v.rows_compared,
        `${id}: cannot differ on more rows than were compared`
      );
      assert.equal(
        v.differing_emitted_sequence, v.differing_label_sets + v.differing_label_order_only,
        `${id}: sequence differences must decompose into set + order`
      );
      assert.ok(
        v.set_differences_without_raw_top1_change <= v.differing_label_sets,
        `${id}: band-only flips are a subset of set differences`
      );
      if (v.decision_hash_match) {
        assert.equal(v.differing_label_sets, 0, `${id}: identical decision hash implies identical label sets`);
      }
      for (const ex of v.differing_examples || []) {
        const a = [...ex.a].sort();
        const b = [...ex.b].sort();
        assert.notDeepEqual(
          a, b,
          `${id}/${ex.row_id}: a set-difference example must not be the same labels reordered`
        );
      }
    } else {
      assert.equal(v.decision_hash_match, undefined, `${id} unmeasured must carry no verdict at all`);
      assert.equal(v.differing_label_sets, undefined, `${id} unmeasured must carry no count either`);
      assert.ok(v.reason, `${id} unmeasured entries must say why`);
      assert.ok(cross.unmeasured_candidates.includes(id), `${id} must be listed as unmeasured`);
      assert.equal(cross.complete, false);
    }
  }
});

test('every candidate declares a licence so #126 can tell what is shippable', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  for (const c of r.candidates) {
    assert.ok(c.licence, `${c.id} must record a licence`);
    assert.ok(c.licence.name && c.licence.name !== 'null', `${c.id} licence needs a name`);
    assert.ok(c.licence.holder, `${c.id} licence needs a holder`);
    assert.ok(c.licence.source, `${c.id} licence needs an authoritative source`);
  }
});

test('charitable scoring never invents gold rows for a zero-gold label', { skip: !hasResults && 'no results.json yet' }, () => {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const zeroGold = r.fixture.limitations.zero_gold_labels;
  assert.ok(zeroGold.includes('adult_sexual_content'));
  for (const c of r.candidates) {
    // The charitable score must never exceed the strict score by an implausible
    // margin, and Adult must still be reported as having no gold rows.
    assert.equal(
      c.special_category_confusion.adult_sexual_content.gold_positives, 0,
      `${c.id}: Adult must still have zero gold rows after all re-scoring`
    );
    for (const label of zeroGold) {
      assert.equal(
        c.per_class[label].goldPositives, 0,
        `${c.id}/${label}: a zero-gold label must never acquire gold positives`
      );
    }
  }
});

const parityPath = path.join(RESULTS_DIR, 'artifact-parity.json');
test('artifact-parity.json compares Phase A digests and nothing more', { skip: !fs.existsSync(parityPath) && 'no artifact parity yet' }, () => {
  const p = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
  assert.equal(p.mode, 'phase-a-artifact-parity');
  assert.equal(p._generator.hand_edited, false);
  assert.ok(p.summary.files_compared > 0, 'parity with nothing compared is not evidence');
  assert.equal(
    p.summary.all_model_files_identical,
    p.summary.files_identical === p.summary.files_compared
  );
  for (const f of p.files) {
    if (f.compared) assert.equal(typeof f.identical, 'boolean');
    else assert.ok(f.reason, `${f.artifact} must say why it was not compared`);
  }
  assert.match(p.note, /INPUTS only/);
});
