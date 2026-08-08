'use strict';
// Phase A (network allowed): fetch and hash model artifacts for every model-backed candidate.
// Extends tools/classifier-bench/spike/download.js to the harness's candidate set.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';

const MODELS = [
  {
    id: 'minishlab/potion-base-2M',
    dir: 'potion-base-2M',
    files: ['onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json', 'special_tokens_map.json'],
  },
];

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'classifier-bench-harness/1.0' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} -> ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { bytes: buf.length, sha256 };
}

async function main() {
  const manifest = { downloaded_at: new Date().toISOString(), models: [] };
  for (const model of MODELS) {
    console.log(`MODEL_ID=${model.id}`);
    const base = `https://huggingface.co/${model.id}/resolve/main`;
    const modelManifest = { model_id: model.id, dir: model.dir, files: [] };
    for (const file of model.files) {
      const url = `${base}/${file}`;
      const dest = path.join(ARTIFACTS_DIR, model.dir, file);
      process.stdout.write(`  ${file} ... `);
      const { bytes, sha256 } = await downloadFile(url, dest);
      console.log(`${bytes} bytes  sha256=${sha256}`);
      modelManifest.files.push({ file, bytes, sha256 });
    }
    manifest.models.push(modelManifest);
  }
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('DOWNLOAD_COMPLETE=true');
}

main().catch((err) => {
  console.error('DOWNLOAD_FAILED:', err.message);
  process.exit(1);
});
