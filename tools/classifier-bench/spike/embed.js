'use strict';
// Phase B: tokenize + embed using onnxruntime-node and @huggingface/transformers.
// Runs with --network none; must be fully offline.

const ort = require('onnxruntime-node');
const crypto = require('node:crypto');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const TEXT = 'Best index funds for 2026 : r/investing https://www.reddit.com/r/investing/comments/1a2b3c/';

// ── Normalise the various formats @huggingface/transformers may return ────────
function extractIds(encoded) {
  const ids = encoded.input_ids;
  if (!ids) throw new Error('No input_ids in tokenizer output');

  // v3 Tensor object (has .data TypedArray + .dims)
  if (ids.data !== undefined) {
    return Array.from(ids.data, Number);
  }
  // Plain nested or flat array
  if (Array.isArray(ids)) {
    return ids.flat(Infinity).map(Number);
  }
  // Any other iterable TypedArray (Int32Array, BigInt64Array, …)
  if (typeof ids[Symbol.iterator] === 'function') {
    return Array.from(ids, Number);
  }
  throw new Error(`Cannot extract input_ids from: ${ids.constructor?.name ?? typeof ids}`);
}

async function main() {
  // @huggingface/transformers is ESM-only in v3; dynamic import is the bridge.
  const { AutoTokenizer, env } = await import('@huggingface/transformers');

  // Strict offline: no network access from @huggingface/transformers
  env.allowRemoteModels = false;
  env.allowLocalModels  = true;

  console.log(`NODE_VERSION=${process.version}`);
  console.log(`PLATFORM=${process.platform}/${process.arch}`);
  console.log(`ARTIFACTS_DIR=${ARTIFACTS_DIR}`);
  console.log(`ORT_VERSION=${ort.env?.versions?.ortRelease ?? 'unknown'}`);

  const t0 = performance.now();

  // ── 1. TOKENIZE ─────────────────────────────────────────────────────────────
  const tokenizer = await AutoTokenizer.from_pretrained(ARTIFACTS_DIR, {
    local_files_only: true,
  });

  const encoded = tokenizer(TEXT, {
    padding:    false,
    truncation: true,
    max_length: 512,
  });

  const inputIds = extractIds(encoded);
  console.log(`TOKEN_COUNT=${inputIds.length}`);
  console.log(`INPUT_IDS_FIRST10=${JSON.stringify(inputIds.slice(0, 10))}`);

  // ── 2. LOAD ONNX MODEL ───────────────────────────────────────────────────────
  const modelPath = path.join(ARTIFACTS_DIR, 'onnx', 'model.onnx');
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders:    ['cpu'],
    graphOptimizationLevel: 'all',
  });

  console.log(`ONNX_INPUTS=${session.inputNames.join(',')}`);
  console.log(`ONNX_OUTPUTS=${session.outputNames.join(',')}`);

  // ── 3. BUILD FEEDS ───────────────────────────────────────────────────────────
  // Model2Vec ONNX uses EmbeddingBag semantics:
  //   input_ids : 1-D flat token array  [seq_len]
  //   offsets   : 1-D bag-start array   [batch_size]  e.g. [0] for one sequence
  // (NOT the same as a transformer's [batch, seq_len] layout)
  const feeds = {};
  for (const name of session.inputNames) {
    let tensor;
    if (name === 'input_ids') {
      // Flat 1-D sequence for EmbeddingBag
      tensor = new ort.Tensor('int64',
        BigInt64Array.from(inputIds, BigInt), [inputIds.length]);
    } else if (name === 'offsets') {
      // One bag starting at position 0
      tensor = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    } else if (name === 'attention_mask') {
      tensor = new ort.Tensor('int64',
        BigInt64Array.from(inputIds, () => 1n), [1, inputIds.length]);
    } else if (name === 'token_type_ids') {
      tensor = new ort.Tensor('int64',
        BigInt64Array.from(inputIds, () => 0n), [1, inputIds.length]);
    } else {
      throw new Error(`Unhandled ONNX input: "${name}"`);
    }
    feeds[name] = tensor;
  }

  // ── 4. RUN INFERENCE ─────────────────────────────────────────────────────────
  const results = await session.run(feeds);
  const t1 = performance.now();

  // ── 5. HASH EMBEDDING ────────────────────────────────────────────────────────
  const outputName = session.outputNames[0];
  const floatData  = Float32Array.from(results[outputName].data);

  const sha256 = crypto.createHash('sha256')
    .update(Buffer.from(floatData.buffer))
    .digest('hex');

  console.log('---RESULTS---');
  console.log(`EMBEDDING_SHA256=${sha256}`);
  console.log(`WALL_TIME_MS=${(t1 - t0).toFixed(2)}`);
  console.log(`EMBEDDING_DIM=${floatData.length}`);
  console.log(`FIRST_5=${Array.from(floatData.slice(0, 5)).map(v => v.toFixed(8)).join(',')}`);
}

main().catch(err => {
  console.error('FATAL:', err.stack ?? err.message ?? String(err));
  process.exit(1);
});
