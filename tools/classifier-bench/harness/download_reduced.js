'use strict';
// Network-enabled Phase A for the reduced-category experiment. It fetches only
// Potion 8M and BGE Micro. No downloaded data is executed in this phase.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MODELS } = require('./models');

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'expected_artifacts.json'), 'utf8')
).artifacts;
const REQUIRED_DIRS = new Set(['potion-base-8M', 'bge-micro-v2']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'forensix-classifier-bench-reduced/1.0 (+ChmaraX/forensix#137)' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`Fetch failed: ${url}: ${lastError.message}`);
}

async function main() {
  const selected = MODELS.filter((model) => REQUIRED_DIRS.has(model.dir));
  if (selected.length !== REQUIRED_DIRS.size) throw new Error('Reduced model selection is incomplete');

  const manifest = {
    profile: 'reduced-7-v1',
    phase: 'A',
    downloaded_at: new Date().toISOString(),
    node_version: process.version,
    platform: `${process.platform}/${process.arch}`,
    models: [],
  };

  for (const model of selected) {
    console.log(`MODEL_ID=${model.id} REVISION=${model.revision}`);
    const entry = { model_id: model.id, dir: model.dir, revision: model.revision, files: [] };
    const base = `https://huggingface.co/${model.id}/resolve/${model.revision}`;

    for (const file of model.files) {
      process.stdout.write(`  ${file} ... `);
      const buffer = await fetchBuffer(`${base}/${file}`);
      const relative = `${model.dir}/${file}`;
      const target = path.join(ARTIFACTS_DIR, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      const digest = sha256(buffer);
      const pin = EXPECTED[relative];
      if (pin && (pin.sha256 !== digest || (pin.bytes && pin.bytes !== buffer.length))) {
        throw new Error(`Pinned artifact mismatch for ${relative}`);
      }
      entry.files.push({
        file,
        bytes: buffer.length,
        sha256: digest,
        verified_against_pin: Boolean(pin),
      });
      console.log(`${buffer.length} bytes sha256=${digest}${pin ? ' [PIN VERIFIED]' : ''}`);
    }
    manifest.models.push(entry);
  }

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'manifest-reduced.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.log('REDUCED_DOWNLOAD_COMPLETE=true');
}

main().catch((error) => {
  console.error('REDUCED_DOWNLOAD_FAILED:', error.stack || error.message);
  process.exit(1);
});
