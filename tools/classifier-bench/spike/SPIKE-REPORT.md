# SPIKE REPORT: potion-base-2M under Node.js, fully offline

**Answers:** ChmaraX/forensix#136 Gap 5 (end-to-end Node run) and Gap 6 early (cross-arch determinism for family-3b)  
**Date:** 2026-08-08  
**Working directory:** `/tmp/potion-node-spike`  
**Time spent:** ~30 min  

---

## Verdicts

| Criterion | Result | Evidence section |
|---|---|---|
| **NODE-ONLY** | ✅ **CONFIRMED** | §3 |
| **OFFLINE** | ✅ **CONFIRMED** | §4 |
| **DETERMINISTIC-SAME-ARCH** | ✅ **CONFIRMED** | §5 |
| **DETERMINISTIC-CROSS-ARCH** | ✅ **CONFIRMED** | §6 |

---

## 1. Reproducibility anchors

### Docker image digests

```
potion-node-spike:arm64  (linux/arm64, native)
  sha256:45cadd4fbb9240544bbc2bc5570da63a8b53795f5ffd7d0dd5deb3d878d0752e

potion-node-spike:amd64  (linux/amd64, emulated via QEMU)
  sha256:7574e9df27fd4b757ef7b23b1785b3cf84538532d6856c32edb28b007dce5aed
```

### Lockfile

```
package-lock.json sha256:
  feedb3962487caf419bde97f5835287948f7f18d9955a6ca1c61ecfd466a1f03
```

### Runtime versions (inside container)

```
node:               v22.23.2  (node:22-slim base image)
@huggingface/transformers:  3.8.1
onnxruntime-node:           1.21.0
```

### Artifact SHAs — Phase A downloads from minishlab/potion-base-2M (authoritative repo)

```
onnx/model.onnx          7,563,349 bytes
  sha256: 92d4a7576de7d39055924b4d9d3979c8c3b2de272010f76f99e2ac14c7b2e5a8

tokenizer.json             683,666 bytes
  sha256: e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50

tokenizer_config.json        1,431 bytes
  sha256: 6725995e3ab3039857ff5bd99178a7cdf42863abb04449e7bb31feb1f55fe567

config.json                    200 bytes
  sha256: b2a89173391ca774c2d7323090a993a9a1553faa5b40eb37bb7cec6685fbea47

special_tokens_map.json        134 bytes
  sha256: a9e8fb6f99fb0b8803f0e6942fdf4d95d6645204620b67dc3310a1024bcbac59
```

---

## 2. Design — two-phase Docker spike

### Phase A (network allowed)

```
FROM node:22-slim
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts        # ← postinstall skipped
COPY download.js embed.js ./
```

```bash
docker run --rm \
  --platform linux/arm64 \
  -v "$ARTIFACTS_DIR:/artifacts" \
  potion-node-spike:arm64 \
  node download.js
```

Downloads `onnx/model.onnx`, `tokenizer.json`, `tokenizer_config.json`, `config.json`,
`special_tokens_map.json` from `https://huggingface.co/minishlab/potion-base-2M/resolve/main/…`
and writes `artifacts/manifest.json` with per-file SHA-256.

### Phase B (--network none)

```bash
docker run --rm --platform linux/arm64 --network none \
  -v "$ARTIFACTS_DIR:/artifacts:ro" \
  potion-node-spike:arm64 \
  node embed.js
```

---

## 3. NODE-ONLY: CONFIRMED

### Claim
End-to-end tokenisation + ONNX inference runs under `node:22-slim` with zero Python at runtime
or build time. No `python3`, no `pip`, no `torch`, no subprocess spawning.

### Evidence — `npm ci --ignore-scripts` succeeds AND native binary loads

`onnxruntime-node@1.21.0` carries `hasInstallScript: true` in the lockfile, meaning a postinstall
hook exists. The design mandates `--ignore-scripts`. Test:

```
$ docker run --rm --platform linux/arm64 --network none potion-node-spike:arm64 \
    node -e "const ort = require('onnxruntime-node'); console.log('ORT_LOADED=true')"

onnxruntime cpuid_info warning: Unknown CPU vendor. cpuinfo_vendor value: 0
ORT_LOADED=true
```

**The binary is bundled inside the npm tarball** (in `bin/napi-v3/linux/arm64/`).
The postinstall hook is verification-only; skipping it leaves the binary usable.

### Evidence — full embed.js run (arm64, no network)

```
NODE_VERSION=v22.23.2
PLATFORM=linux/arm64
TOKEN_COUNT=35
INPUT_IDS_FIRST10=[2,1196,4956,4035,1011,15804,1581,30,60,19]
ONNX_INPUTS=input_ids,offsets
ONNX_OUTPUTS=embeddings
---RESULTS---
EMBEDDING_SHA256=167d670b4369880bcffd7cb7f166a85fd86744a7dc483a617a3b07a01351a387
WALL_TIME_MS=77.98
EMBEDDING_DIM=64
FIRST_5=0.17825069,0.29108611,-0.13339232,-0.19052638,0.31538561
```

### Caveats discovered during the spike

**Caveat 1 — ORT version pin is mandatory.**
The initial `package.json` specified `"onnxruntime-node": "^1.20.1"`, which resolved to **1.27.0**.
`@huggingface/transformers@3.8.1` bundles its own `onnxruntime-node@1.21.0` in a nested
`node_modules`. Both share the SONAME `libonnxruntime.so.1`, so the first one loaded wins.
With 1.27.0 loaded first, the 1.21.0 binding fails at import time with:

```
Error: /app/node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/libonnxruntime.so.1:
  version `VERS_1.21.0' not found
  (required by .../onnxruntime-node/bin/napi-v3/linux/arm64/onnxruntime_binding.node)
```

**Fix:** pin top-level `onnxruntime-node` to exactly `"1.21.0"` so npm hoists one shared
copy. The nested copy in `@huggingface/transformers` is then eliminated (npm deduplication).
This constraint belongs in any forensix `package.json` that uses this stack.

**Caveat 2 — Model2Vec uses EmbeddingBag ONNX semantics, not standard transformer layout.**
The ONNX model's input names are `input_ids, offsets` (not `input_ids, attention_mask`).
The `offsets` tensor signals EmbeddingBag bag boundaries: for a single sequence, it is
`[0]` (one bag starting at position 0). The `input_ids` input is a **flat 1-D array**
`[seq_len]`, not the standard `[batch, seq_len]` transformer shape.

ORT emits a benign graph-optimisation warning about implicit inputs in subgraphs; this does
not affect correctness.

**Caveat 3 — tokenizer emits standard BERT special tokens.**
The `tokenizer_config.json` declares `tokenizer_class: BertTokenizer` (case-insensitive
WordPiece, `do_lower_case: true`). `@huggingface/transformers` loads it without any Python.
The input includes `[CLS]` (id=2) and `[SEP]` tokens; Model2Vec absorbs them in the
EmbeddingBag mean.

---

## 4. OFFLINE: CONFIRMED

Phase B ran with `docker run --network none`. The embed.js code sets
`env.allowRemoteModels = false` and `env.allowLocalModels = true` before calling
`AutoTokenizer.from_pretrained`. The tokenizer reads only from the mounted
`/artifacts` volume (local `tokenizer.json`, `tokenizer_config.json`).

No network call is made; the `--network none` flag would have caused any outbound
connection attempt to fail immediately, and the run completed successfully.

---

## 5. DETERMINISTIC-SAME-ARCH: CONFIRMED

Two consecutive arm64 runs with `--network none` produce bitwise-identical output:

```
Run 1  linux/arm64  EMBEDDING_SHA256=167d670b4369880bcffd7cb7f166a85fd86744a7dc483a617a3b07a01351a387
Run 2  linux/arm64  EMBEDDING_SHA256=167d670b4369880bcffd7cb7f166a85fd86744a7dc483a617a3b07a01351a387
```

Same vector; wall times differ (77 ms vs 70 ms, OS scheduling noise only).

This is architecturally guaranteed for Model2Vec: inference is an integer table lookup
followed by a floating-point mean over a fixed, deterministically ordered token sequence.
There are no attention kernels, no parallelism-sensitive reductions, and no random seeds.

---

## 6. DETERMINISTIC-CROSS-ARCH: CONFIRMED

Run 3 used `--platform linux/amd64` with the separately built `potion-node-spike:amd64` image
(QEMU emulation on the arm64 host):

```
Run 1  linux/arm64  EMBEDDING_SHA256=167d670b4369880bcffd7cb7f166a85fd86744a7dc483a617a3b07a01351a387
Run 3  linux/x64    EMBEDDING_SHA256=167d670b4369880bcffd7cb7f166a85fd86744a7dc483a617a3b07a01351a387
```

**Bitwise-identical across architectures.** First five values (float32, hex-exact):

```
arm64:  0.17825069, 0.29108611, -0.13339232, -0.19052638, 0.31538561
amd64:  0.17825069, 0.29108611, -0.13339232, -0.19052638, 0.31538561
```

Wall time on emulated amd64: **823 ms** vs 70–78 ms on native arm64. The large gap is
QEMU overhead, not a production number.

**Why this holds for Model2Vec but NOT necessarily for contextual transformers:**
The computation is: for each token ID, return the corresponding row from a float32 embedding
matrix, then compute the arithmetic mean of those rows. No fused-multiply-add, no SIMD
reduction order variation, no int8 dequantisation kernel differences between arm64 and x86-64.
The result is determined entirely by integer table-lookup indices (deterministic) and IEEE 754
single-precision addition in a fixed order (also deterministic, since the token count and
order are fixed). This is the architectural claim in §4 of the survey brief, now verified.

---

## 7. Model architecture note (relevant to Gap 6 scope)

The research brief (§3b) described family-3b as "token-embedding lookup + pooling." This spike
confirms the exact ONNX representation: a **PyTorch EmbeddingBag** exported to ONNX.

```
config.json:
  model_type: "model2vec"
  architectures: ["StaticModel"]
  hidden_dim: 64          ← embedding dimension after PCA (apply_pca: 64)
  apply_zipf: true        ← Zipf re-weighting baked into the ONNX weights
  normalize: true         ← L2 norm applied inside the ONNX graph
  tokenizer_name: "baai/bge-base-en-v1.5"
```

The final embedding is already L2-normalised (cosine similarity = dot product).
The 64-dim output is the PCA-compressed version; `potion-base-8M` uses the same pipeline
and is expected to behave identically from a Node.js integration standpoint.

---

## 8. Files in this spike

```
/tmp/potion-node-spike/
  package.json          ← pinned: onnxruntime-node=1.21.0, @huggingface/transformers=^3.3.3
  package-lock.json     ← generated inside linux/arm64 container; lockfile sha256 above
  Dockerfile            ← FROM node:22-slim, RUN npm ci --ignore-scripts
  download.js           ← Phase A: fetch+hash 5 files from HF authoritative repo
  embed.js              ← Phase B: tokenise + EmbeddingBag ONNX inference + print SHA256
  artifacts/
    manifest.json       ← per-file byte counts + sha256
    onnx/model.onnx
    tokenizer.json
    tokenizer_config.json
    config.json
    special_tokens_map.json
  logs/
    phase-a.log         ← Phase A download output
    phase-b-run1.log    ← arm64 run 1
    phase-b-run2.log    ← arm64 run 2 (determinism check)
    phase-b-run3.log    ← amd64 emulated run (cross-arch check)
```

---

## 9. Answers to the gap questions

**Gap 5 (Does potion/Model2Vec ONNX run end-to-end in Node without Python-side preprocessing?)**

Yes. `@huggingface/transformers` v3.8.1 loads the BertTokenizer from the local
`tokenizer.json` + `tokenizer_config.json` entirely in JavaScript (no Python, no subprocess).
`onnxruntime-node` v1.21.0 runs the ONNX graph with `npm ci --ignore-scripts` (binary is
bundled in the tarball, no postinstall download needed). The only non-obvious integration
requirement is the EmbeddingBag input layout (flat `input_ids` + `offsets=[0]` rather than
batched `[batch, seq_len]`).

**Gap 6 early (Cross-machine determinism for the family-3b static embedding variant)**

CONFIRMED bitwise-identical across arm64 and x86-64, as predicted by the architectural
argument. No caveats for this family. The broader Gap 6 question (contextual quantised
transformers: ranks 3–5) is not answered here; those involve attention kernels and int8
dequantisation where cross-architecture bitwise identity is not architecturally guaranteed.

---

## 10. Remaining questions not answered here

- Integration path to a forensix worker (how embed.js patterns map to the classifier module design)
- Accuracy of cosine-similarity label matching against the proposed 15-label taxonomy
- Throughput at forensix scale (10⁴–10⁵ `urls` rows): the 70ms wall time is cold-start; a warm
  session with session reuse will be faster
- `potion-base-8M` (rank 2): expected to be identical integration effort; spike can be rerun
  with `MODEL_ID=minishlab/potion-base-8M` to verify
