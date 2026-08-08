'use strict';
// Shared Model2Vec/potion ONNX embedding engine, extracted from tools/classifier-bench/spike/embed.js
// (ChmaraX/forensix#137 spike, all four verdicts CONFIRMED). Same EmbeddingBag input contract.
const ort = require('onnxruntime-node');
const path = require('node:path');

function extractIds(encoded) {
  const ids = encoded.input_ids;
  if (!ids) throw new Error('No input_ids in tokenizer output');
  if (ids.data !== undefined) return Array.from(ids.data, Number);
  if (Array.isArray(ids)) return ids.flat(Infinity).map(Number);
  if (typeof ids[Symbol.iterator] === 'function') return Array.from(ids, Number);
  throw new Error(`Cannot extract input_ids from: ${ids.constructor?.name ?? typeof ids}`);
}

async function loadEngine(artifactsDir) {
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;

  const tokenizer = await AutoTokenizer.from_pretrained(artifactsDir, { local_files_only: true });
  const modelPath = path.join(artifactsDir, 'onnx', 'model.onnx');
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  async function embed(text) {
    const encoded = tokenizer(text, { padding: false, truncation: true, max_length: 512 });
    const inputIds = extractIds(encoded);
    const feeds = {};
    for (const name of session.inputNames) {
      if (name === 'input_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(inputIds, BigInt), [inputIds.length]);
      } else if (name === 'offsets') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      } else if (name === 'attention_mask') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(inputIds, () => 1n), [1, inputIds.length]);
      } else if (name === 'token_type_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(inputIds, () => 0n), [1, inputIds.length]);
      } else {
        throw new Error(`Unhandled ONNX input: "${name}"`);
      }
    }
    const results = await session.run(feeds);
    const outputName = session.outputNames[0];
    return Float32Array.from(results[outputName].data);
  }

  return { embed, ortVersion: ort.env?.versions?.ortRelease ?? 'unknown' };
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

module.exports = { loadEngine, dot };
