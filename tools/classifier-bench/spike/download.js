'use strict';
// Phase A: download authoritative artifacts from minishlab/potion-base-2M
// Runs with network access; records SHA-256 of every file.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MODEL_ID = 'minishlab/potion-base-2M';
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';

const FILES = [
  'onnx/model.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'special_tokens_map.json',
];

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'potion-node-spike/1.0' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} → ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { bytes: buf.length, sha256 };
}

async function main() {
  console.log(`MODEL_ID=${MODEL_ID}`);
  console.log(`ARTIFACTS_DIR=${ARTIFACTS_DIR}`);
  const manifest = { model_id: MODEL_ID, downloaded_at: new Date().toISOString(), files: [] };

  for (const file of FILES) {
    const url = `${BASE_URL}/${file}`;
    const dest = path.join(ARTIFACTS_DIR, file);
    process.stdout.write(`  Downloading ${file} ... `);
    const { bytes, sha256 } = await downloadFile(url, dest);
    console.log(`${bytes} bytes  sha256=${sha256}`);
    manifest.files.push({ file, bytes, sha256 });
  }

  const manifestPath = path.join(ARTIFACTS_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest → ${manifestPath}`);
  console.log('DOWNLOAD_COMPLETE=true');
}

main().catch(err => {
  console.error('DOWNLOAD_FAILED:', err.message);
  process.exit(1);
});
