'use strict';
// Candidate registry. The scorer never names a candidate; it iterates this list.
//
// The audit found `run_bench.js` held two hardcoded, copy-pasted candidate blocks
// with per-candidate coverage rules and sweep axes inline — meaning adding a
// candidate required editing the scorer, the one component that must stay fixed.
// Every candidate now conforms to one manifest/load/predictRaw contract:
//
//   { id, family, inputMode, supervision, decision, sweep, predictRaw }
//
// and the harness supplies the fixture, applies every threshold, and scores.

const path = require('node:path');
const {
  loadEmbeddingBagEngine, loadBertEncoderEngine, loadCrossEncoderEngine,
} = require('../lib/onnx_engines');
const { buildEmbeddingCandidate } = require('./embedding_labelsim');
const { buildNliCandidate } = require('./nli_entailment');
const { buildUt1Candidate } = require('./ut1_domain_list');

/**
 * Model licences, read off the AUTHORITATIVE repo (model card front matter or an
 * in-repo LICENSE file), captured offline under research/_raw/licences/.
 *
 * #126 has to pick something shippable, so a candidate sitting in a comparison
 * table without a licence is not decision-ready. Recorded here rather than left
 * null.
 *
 * Note on bge-micro-v2: its model card front matter carries NO `license:` key,
 * but the repo ships a LICENSE file with full MIT text (Copyright (c) 2023
 * Benjamin Anderson). The file is the authority; a tag-only check finds nothing
 * and would wrongly report it as unlicensed.
 */
const MODEL_LICENCES = {
  'minishlab/potion-base-2M': {
    name: 'MIT', holder: 'MinishLab',
    authority: 'model card front matter (`license: mit`)',
    source: 'https://huggingface.co/minishlab/potion-base-2M',
    capture: 'research/_raw/licences/minishlab__potion-base-2M.md',
    note: 'Permissive; redistributable with attribution. No standalone LICENSE file on the HF repo.',
  },
  'minishlab/potion-base-8M': {
    name: 'MIT', holder: 'MinishLab',
    authority: 'model card front matter (`license: mit`)',
    source: 'https://huggingface.co/minishlab/potion-base-8M',
    capture: 'research/_raw/licences/minishlab__potion-base-8M.md',
    note: 'Permissive; redistributable with attribution. No standalone LICENSE file on the HF repo.',
  },
  'TaylorAI/bge-micro-v2': {
    name: 'MIT', holder: 'Benjamin Anderson',
    authority: 'in-repo LICENSE file (full MIT text, Copyright (c) 2023 Benjamin Anderson)',
    source: 'https://huggingface.co/TaylorAI/bge-micro-v2/raw/main/LICENSE',
    capture: 'research/_raw/licences/TaylorAI__bge-micro-v2.md',
    note: 'The model card front matter declares NO license key; the in-repo LICENSE file is the authority. A tag-only check finds nothing and would wrongly report this model as unlicensed.',
  },
  'sentence-transformers/all-MiniLM-L6-v2': {
    name: 'Apache-2.0', holder: 'sentence-transformers (UKP Lab)',
    authority: 'model card front matter (`license: apache-2.0`)',
    source: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
    capture: 'research/_raw/licences/sentence-transformers__all-MiniLM-L6-v2.md',
    note: 'Permissive; redistributable with attribution and NOTICE retention.',
  },
  'cross-encoder/nli-deberta-v3-xsmall': {
    name: 'Apache-2.0', holder: 'cross-encoder (UKP Lab)',
    authority: 'model card front matter (`license: apache-2.0`)',
    source: 'https://huggingface.co/cross-encoder/nli-deberta-v3-xsmall',
    capture: 'research/_raw/licences/cross-encoder__nli-deberta-v3-xsmall.md',
    note: 'Permissive; redistributable with attribution and NOTICE retention.',
  },
};

/**
 * Each entry declares how to build itself. `build` receives
 * { artifactsDir, taxonomy, fixtureRows } and returns a candidate.
 */
const REGISTRY = [
  // UT1 is ONE shortlisted option run in TWO configurations. They answer
  // different questions and neither may be quoted as the other:
  //   strict-overlap-removed -> contamination lower bound
  //   full-external-list     -> realistic independent-list measurement
  {
    id: 'ut1-domain-list-v2-strict',
    family: '5-deterministic-domain-list',
    shortlisted_option: 'ut1',
    order: 1,
    build: ({ artifactsDir, fixtureRows }) => buildUt1Candidate({
      id: 'ut1-domain-list-v2-strict',
      family: '5-deterministic-domain-list',
      compiledPath: path.join(artifactsDir, 'ut1', 'compiled.json'),
      fixtureRows,
      removeFixtureOverlap: true,
      configuration: 'strict-overlap-removed',
    }),
  },
  {
    id: 'ut1-domain-list-v2-full',
    family: '5-deterministic-domain-list',
    shortlisted_option: 'ut1',
    order: 2,
    build: ({ artifactsDir, fixtureRows }) => buildUt1Candidate({
      id: 'ut1-domain-list-v2-full',
      family: '5-deterministic-domain-list',
      compiledPath: path.join(artifactsDir, 'ut1', 'compiled.json'),
      fixtureRows,
      removeFixtureOverlap: false,
      configuration: 'full-external-list',
    }),
  },
  {
    id: 'potion-base-2M-labelsim-v2',
    family: '3b-static-embedding-labelsim',
    shortlisted_option: 'potion-base-2M',
    order: 3,
    build: async ({ artifactsDir, taxonomy }) => {
      const dir = path.join(artifactsDir, 'potion-base-2M');
      const engine = await loadEmbeddingBagEngine(dir);
      return buildEmbeddingCandidate({
        id: 'potion-base-2M-labelsim-v2',
        family: '3b-static-embedding-labelsim',
        engine, taxonomy,
        modelId: 'minishlab/potion-base-2M',
        licence: MODEL_LICENCES['minishlab/potion-base-2M'],
        revision: '389b9f64be5aa4ae7a6bc6fe95ef20ce485ae5da',
        artifactDir: dir,
      });
    },
  },
  {
    id: 'potion-base-8M-labelsim-v2',
    family: '3b-static-embedding-labelsim',
    shortlisted_option: 'potion-base-8M',
    order: 4,
    build: async ({ artifactsDir, taxonomy }) => {
      const dir = path.join(artifactsDir, 'potion-base-8M');
      const engine = await loadEmbeddingBagEngine(dir);
      return buildEmbeddingCandidate({
        id: 'potion-base-8M-labelsim-v2',
        family: '3b-static-embedding-labelsim',
        engine, taxonomy,
        modelId: 'minishlab/potion-base-8M',
        licence: MODEL_LICENCES['minishlab/potion-base-8M'],
        revision: 'bf8b056651a2c21b8d2565580b8569da283cab23',
        artifactDir: dir,
      });
    },
  },
  {
    id: 'bge-micro-v2-labelsim-v2',
    family: '3-contextual-embedding-labelsim',
    shortlisted_option: 'bge-micro-v2',
    order: 5,
    build: async ({ artifactsDir, taxonomy }) => {
      const dir = path.join(artifactsDir, 'bge-micro-v2');
      const engine = await loadBertEncoderEngine(dir, { modelFile: 'onnx/model_quantized.onnx', maxLength: 256 });
      return buildEmbeddingCandidate({
        id: 'bge-micro-v2-labelsim-v2',
        family: '3-contextual-embedding-labelsim',
        engine, taxonomy,
        modelId: 'TaylorAI/bge-micro-v2',
        licence: MODEL_LICENCES['TaylorAI/bge-micro-v2'],
        revision: '3edf6d7de0faa426b09780416fe61009f26ae589',
        artifactDir: dir,
      });
    },
  },
  {
    id: 'all-MiniLM-L6-v2-labelsim-v2',
    family: '3-contextual-embedding-labelsim',
    shortlisted_option: 'all-MiniLM-L6-v2',
    order: 6,
    build: async ({ artifactsDir, taxonomy }) => {
      const dir = path.join(artifactsDir, 'all-MiniLM-L6-v2');
      const engine = await loadBertEncoderEngine(dir, { modelFile: 'onnx/model_qint8_arm64.onnx', maxLength: 256 });
      return buildEmbeddingCandidate({
        id: 'all-MiniLM-L6-v2-labelsim-v2',
        family: '3-contextual-embedding-labelsim',
        engine, taxonomy,
        modelId: 'sentence-transformers/all-MiniLM-L6-v2',
        licence: MODEL_LICENCES['sentence-transformers/all-MiniLM-L6-v2'],
        revision: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
        artifactDir: dir,
      });
    },
  },
  {
    id: 'nli-deberta-v3-xsmall-entailment-v2',
    family: '2-entailment-cross-encoder',
    shortlisted_option: 'nli-deberta-v3-xsmall',
    order: 7,
    build: async ({ artifactsDir, taxonomy }) => {
      const dir = path.join(artifactsDir, 'nli-deberta-v3-xsmall');
      const engine = await loadCrossEncoderEngine(dir, { modelFile: 'onnx/model_qint8_arm64.onnx', maxLength: 256 });
      return buildNliCandidate({
        id: 'nli-deberta-v3-xsmall-entailment-v2',
        family: '2-entailment-cross-encoder',
        engine, taxonomy,
        modelId: 'cross-encoder/nli-deberta-v3-xsmall',
        licence: MODEL_LICENCES['cross-encoder/nli-deberta-v3-xsmall'],
        revision: 'a150876415327c80daeff35ca6f68f5ed8cf5c24',
        artifactDir: dir,
      });
    },
  },
];

function selectCandidates(only) {
  if (!only || !only.length) return REGISTRY.slice().sort((a, b) => a.order - b.order);
  const want = new Set(only);
  const picked = REGISTRY.filter((c) => want.has(c.id));
  const missing = only.filter((id) => !REGISTRY.some((c) => c.id === id));
  if (missing.length) throw new Error(`Unknown candidate id(s): ${missing.join(', ')}`);
  return picked.sort((a, b) => a.order - b.order);
}

module.exports = { REGISTRY, selectCandidates, MODEL_LICENCES };
