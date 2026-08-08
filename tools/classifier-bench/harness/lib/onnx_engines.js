'use strict';
// ONNX engines for the three model classes on #136's shortlist.
//
//   Class 1  EmbeddingBag / Model2Vec  (potion-base-2M, potion-base-8M)
//            rank-1 `input_ids` + `offsets`, L2-norm inside the graph.
//   Class 2  BERT encoder              (bge-micro-v2, all-MiniLM-L6-v2)
//            rank-2 `input_ids`, external mean-pool over the attention mask,
//            then external L2-norm.
//   Class 3  DeBERTa-v2 cross-encoder  (nli-deberta-v3-xsmall)
//            pair encoding, N passes per row, logits [contradiction, entailment,
//            neutral].
//
// Determinism: every session is created single-threaded with basic graph
// optimisation. The audit identified default thread counts plus level-3 fusion
// as the standard explanation for data-dependent bitwise divergence across
// hosts, and this is the cheap control for it. The setting is recorded in
// results.json rather than left implicit.

const ort = require('onnxruntime-node');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// NOTE: onnxruntime-node wraps the options object in a Proxy and reads its own
// properties back out during session creation. A frozen object makes that proxy
// invariant check throw, so the canonical settings are stored plainly and every
// session gets a fresh shallow copy via sessionOptions().
const SESSION_OPTIONS = {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'basic',
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  enableCpuMemArena: false,
  enableMemPattern: false,
};

function sessionOptions() {
  return { ...SESSION_OPTIONS, executionProviders: [...SESSION_OPTIONS.executionProviders] };
}

function ortVersion() {
  try {
    return require('onnxruntime-node/package.json').version;
  } catch {
    return 'unknown';
  }
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function extractIds(encoded) {
  const ids = encoded.input_ids;
  if (!ids) throw new Error('No input_ids in tokenizer output');
  if (ids.data !== undefined) return Array.from(ids.data, Number);
  if (Array.isArray(ids)) return ids.flat(Infinity).map(Number);
  if (typeof ids[Symbol.iterator] === 'function') return Array.from(ids, Number);
  throw new Error(`Cannot extract input_ids from: ${ids.constructor?.name ?? typeof ids}`);
}

function extractField(encoded, name, fallbackLength) {
  const v = encoded[name];
  if (!v) return null;
  if (v.data !== undefined) return Array.from(v.data, Number);
  if (Array.isArray(v)) return v.flat(Infinity).map(Number);
  if (typeof v[Symbol.iterator] === 'function') return Array.from(v, Number);
  return new Array(fallbackLength).fill(0);
}

async function loadTokenizer(dir) {
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  return AutoTokenizer.from_pretrained(dir, { local_files_only: true });
}

function l2normalise(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s);
  if (n === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Class 1: Model2Vec / potion EmbeddingBag. */
async function loadEmbeddingBagEngine(modelDir, { modelFile = 'onnx/model.onnx', maxLength = 512 } = {}) {
  const tokenizer = await loadTokenizer(modelDir);
  const modelPath = path.join(modelDir, modelFile);
  const session = await ort.InferenceSession.create(modelPath, sessionOptions());

  async function embed(text) {
    const encoded = tokenizer(text, { padding: false, truncation: true, max_length: maxLength });
    const inputIds = extractIds(encoded);
    const ids = inputIds.length ? inputIds : [0];
    const feeds = {};
    for (const name of session.inputNames) {
      if (name === 'input_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [ids.length]);
      } else if (name === 'offsets') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      } else {
        throw new Error(`EmbeddingBag engine: unhandled ONNX input "${name}"`);
      }
    }
    const out = await session.run(feeds);
    // Graph already L2-normalises (config.json normalize:true); normalise again
    // defensively so cosine == dot holds regardless of export.
    return l2normalise(Float32Array.from(out[session.outputNames[0]].data));
  }

  return {
    kind: 'embedding-bag',
    embed,
    modelPath,
    modelSha256: sha256File(modelPath),
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    maxLength,
  };
}

/** Class 2: BERT encoder with external mean-pool + L2-norm. */
async function loadBertEncoderEngine(modelDir, { modelFile, maxLength = 256 } = {}) {
  const tokenizer = await loadTokenizer(modelDir);
  const modelPath = path.join(modelDir, modelFile);
  const session = await ort.InferenceSession.create(modelPath, sessionOptions());

  // Pooling mode is read, not assumed (1_Pooling/config.json is the authority).
  let poolingMode = 'mean';
  const poolCfgPath = path.join(modelDir, '1_Pooling', 'config.json');
  if (fs.existsSync(poolCfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(poolCfgPath, 'utf8'));
    if (cfg.pooling_mode_cls_token) poolingMode = 'cls';
    else if (cfg.pooling_mode_max_tokens) poolingMode = 'max';
    else if (cfg.pooling_mode_mean_tokens) poolingMode = 'mean';
  }

  async function embed(text) {
    const encoded = tokenizer(text, { padding: false, truncation: true, max_length: maxLength });
    const ids = extractIds(encoded);
    const useIds = ids.length ? ids : [0];
    const mask = extractField(encoded, 'attention_mask', useIds.length) || new Array(useIds.length).fill(1);
    const seq = useIds.length;

    const feeds = {};
    for (const name of session.inputNames) {
      if (name === 'input_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(useIds, BigInt), [1, seq]);
      } else if (name === 'attention_mask') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(mask.slice(0, seq), BigInt), [1, seq]);
      } else if (name === 'token_type_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(new Array(seq).fill(0), BigInt), [1, seq]);
      } else {
        throw new Error(`BERT engine: unhandled ONNX input "${name}"`);
      }
    }

    const out = await session.run(feeds);
    const outName = session.outputNames[0];
    const t = out[outName];
    const dims = t.dims;
    if (dims.length !== 3) {
      throw new Error(`BERT engine: expected rank-3 output [1,seq,hidden], got [${dims.join(',')}] from "${outName}"`);
    }
    const [, seqLen, hidden] = dims;
    const data = t.data;
    const pooled = new Float32Array(hidden);

    if (poolingMode === 'cls') {
      for (let h = 0; h < hidden; h++) pooled[h] = data[h];
    } else if (poolingMode === 'max') {
      for (let h = 0; h < hidden; h++) {
        let m = -Infinity;
        for (let s = 0; s < seqLen; s++) if (mask[s]) m = Math.max(m, data[s * hidden + h]);
        pooled[h] = m === -Infinity ? 0 : m;
      }
    } else {
      let denom = 0;
      for (let s = 0; s < seqLen; s++) denom += mask[s] ? 1 : 0;
      denom = denom || 1;
      for (let s = 0; s < seqLen; s++) {
        if (!mask[s]) continue;
        const base = s * hidden;
        for (let h = 0; h < hidden; h++) pooled[h] += data[base + h];
      }
      for (let h = 0; h < hidden; h++) pooled[h] /= denom;
    }
    return l2normalise(pooled);
  }

  return {
    kind: 'bert-encoder',
    embed,
    modelPath,
    modelSha256: sha256File(modelPath),
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    poolingMode,
    maxLength,
  };
}

/** Class 3: DeBERTa-v2 NLI cross-encoder. */
async function loadCrossEncoderEngine(modelDir, { modelFile, maxLength = 256 } = {}) {
  const tokenizer = await loadTokenizer(modelDir);
  const modelPath = path.join(modelDir, modelFile);
  const session = await ort.InferenceSession.create(modelPath, sessionOptions());

  const cfg = JSON.parse(fs.readFileSync(path.join(modelDir, 'config.json'), 'utf8'));
  const id2label = cfg.id2label || { 0: 'contradiction', 1: 'entailment', 2: 'neutral' };
  const entailIdx = Object.entries(id2label)
    .find(([, v]) => String(v).toLowerCase() === 'entailment')?.[0];
  const contradictIdx = Object.entries(id2label)
    .find(([, v]) => String(v).toLowerCase() === 'contradiction')?.[0];
  if (entailIdx === undefined || contradictIdx === undefined) {
    throw new Error(`Cross-encoder: cannot locate entailment/contradiction in id2label ${JSON.stringify(id2label)}`);
  }

  /** @returns probability of entailment vs contradiction (neutral dropped). */
  async function entailmentProbability(premise, hypothesis) {
    const encoded = tokenizer(premise, {
      text_pair: hypothesis, padding: false, truncation: true, max_length: maxLength,
    });
    const ids = extractIds(encoded);
    const useIds = ids.length ? ids : [0];
    const mask = extractField(encoded, 'attention_mask', useIds.length) || new Array(useIds.length).fill(1);
    const seq = useIds.length;

    const feeds = {};
    for (const name of session.inputNames) {
      if (name === 'input_ids') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(useIds, BigInt), [1, seq]);
      } else if (name === 'attention_mask') {
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(mask.slice(0, seq), BigInt), [1, seq]);
      } else if (name === 'token_type_ids') {
        const tt = extractField(encoded, 'token_type_ids', seq) || new Array(seq).fill(0);
        feeds[name] = new ort.Tensor('int64', BigInt64Array.from(tt.slice(0, seq), BigInt), [1, seq]);
      } else {
        throw new Error(`Cross-encoder: unhandled ONNX input "${name}"`);
      }
    }

    const out = await session.run(feeds);
    const logits = out[session.outputNames[0]].data;
    const e = Number(logits[Number(entailIdx)]);
    const c = Number(logits[Number(contradictIdx)]);
    // 2-way softmax over entail vs contradict, the standard reduction for
    // per-label independent thresholding in a multi-label taxonomy.
    const m = Math.max(e, c);
    const ee = Math.exp(e - m);
    const ec = Math.exp(c - m);
    return ee / (ee + ec);
  }

  return {
    kind: 'cross-encoder',
    entailmentProbability,
    modelPath,
    modelSha256: sha256File(modelPath),
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    id2label,
    maxLength,
  };
}

module.exports = {
  SESSION_OPTIONS,
  sessionOptions,
  ortVersion,
  loadEmbeddingBagEngine,
  loadBertEncoderEngine,
  loadCrossEncoderEngine,
  l2normalise,
  dot,
  sha256File,
};
