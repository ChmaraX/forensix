'use strict';
// Phase A (network allowed, inside Docker): fetch, hash and verify every model
// artifact, then compile the UT1 domain table.
//
// Fixes applied after the audit:
//   * Revision-pinned URLs instead of `/resolve/main/`.
//   * SHA-256 verified against expected_artifacts.json — a mismatch is a hard
//     failure, not a silently recorded difference.
//   * UT1 archives verified against the upstream MD5SUM.LST entry AND re-hashed
//     with SHA-256, then compiled to a host->label table that Phase B consumes
//     offline.
//
// Nothing here runs on the host: all untrusted download and extraction happens
// inside the disposable container.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { MODELS, UT1_CATEGORIES, UT1_BASE } = require('./models');

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/artifacts';
const EXPECTED_FILE = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_artifacts.json'), 'utf8'));
const EXPECTED = EXPECTED_FILE.artifacts;
const UT1_PIN = EXPECTED_FILE.ut1 || null;
const CATEGORY_MAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'ut1_category_map.json'), 'utf8'));

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

async function fetchBuffer(url, { maxRetries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'forensix-classifier-bench/2.0 (+ChmaraX/forensix#137)' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`fetch failed after ${maxRetries} attempts: ${url} :: ${lastErr.message}`);
}

async function downloadModels(manifest) {
  for (const model of MODELS) {
    console.log(`MODEL_ID=${model.id} REVISION=${model.revision}`);
    const base = `https://huggingface.co/${model.id}/resolve/${model.revision}`;
    const entry = { model_id: model.id, dir: model.dir, revision: model.revision, files: [] };

    for (const file of model.files) {
      const url = `${base}/${file}`;
      const dest = path.join(ARTIFACTS_DIR, model.dir, file);
      process.stdout.write(`  ${file} ... `);
      const buf = await fetchBuffer(url);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      const digest = sha256(buf);

      const key = `${model.dir}/${file}`;
      const exp = EXPECTED[key];
      if (exp) {
        if (exp.sha256 !== digest) {
          throw new Error(
            `ARTIFACT HASH MISMATCH for ${key}\n  expected ${exp.sha256}\n  actual   ${digest}\n` +
            `  Upstream drifted or the download is corrupt. Refusing to benchmark.`
          );
        }
        if (exp.bytes && exp.bytes !== buf.length) {
          throw new Error(`ARTIFACT SIZE MISMATCH for ${key}: expected ${exp.bytes}, got ${buf.length}`);
        }
        console.log(`${buf.length} bytes  sha256=${digest}  [VERIFIED against expected_artifacts.json]`);
      } else {
        console.log(`${buf.length} bytes  sha256=${digest}  [recorded]`);
      }
      entry.files.push({ file, bytes: buf.length, sha256: digest, verified_against_pin: Boolean(exp) });
    }
    manifest.models.push(entry);
  }
}

/** Extract `domains` from a UT1 category tarball, in-process (no shell-out). */
function extractDomainsFromTarGz(buf, category) {
  const tar = zlib.gunzipSync(buf);
  const domains = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) { offset += 512; continue; }
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField, 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const bare = name.replace(/^\.\//, '');
    if (bare === `${category}/domains` || bare.endsWith('/domains')) {
      const content = tar.subarray(dataStart, dataEnd).toString('utf8');
      for (const line of content.split('\n')) {
        const h = line.trim().toLowerCase();
        if (h && !h.startsWith('#')) domains.push(h);
      }
    }
    offset = dataEnd + ((512 - (size % 512)) % 512);
  }
  return domains;
}

async function compileUt1(manifest) {
  console.log('\nUT1_COMPILE start');
  const md5List = (await fetchBuffer(`${UT1_BASE}/MD5SUM.LST`)).toString('utf8');
  const md5ByFile = {};
  for (const line of md5List.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{32})\s+(\S+)$/);
    if (m) md5ByFile[m[2]] = m[1];
  }

  const mapping = CATEGORY_MAP.mapping;
  const table = Object.create(null);
  const perCategory = [];
  // NOT a snapshot version. UT1 publishes a rolling snapshot at a stable URL
  // with no upstream version identifier, so this records only WHEN we fetched.
  // Identity comes from the compiled digest pinned in expected_artifacts.json.
  const downloadedOn = new Date().toISOString().slice(0, 10);

  for (const category of UT1_CATEGORIES) {
    const labels = mapping[category];
    if (!labels) {
      console.log(`  ${category}: SKIP (not in ut1_category_map.json mapping)`);
      continue;
    }
    const file = `${category}.tar.gz`;
    process.stdout.write(`  ${category} ... `);
    const buf = await fetchBuffer(`${UT1_BASE}/${file}`);
    const gotMd5 = md5(buf);
    const wantMd5 = md5ByFile[file];
    // Fail closed. A requested category with no upstream MD5 entry is an
    // unverified input, and silently compiling it into the table would put
    // unattested data behind a measured number.
    if (!wantMd5) {
      throw new Error(`UT1 ${file} has no MD5SUM.LST entry; refusing unverified input`);
    }
    if (wantMd5 !== gotMd5) {
      throw new Error(`UT1 MD5 MISMATCH for ${file}: expected ${wantMd5}, got ${gotMd5}`);
    }
    const domains = extractDomainsFromTarGz(buf, category);
    for (const host of domains) {
      const cur = table[host];
      if (cur) { for (const l of labels) if (!cur.includes(l)) cur.push(l); }
      else table[host] = [...labels];
    }
    console.log(`${domains.length} domains -> ${labels.join('+')}  md5=${gotMd5} [VERIFIED vs MD5SUM.LST]`);
    perCategory.push({
      category, file, labels,
      domains: domains.length,
      bytes: buf.length,
      md5: gotMd5,
      md5_verified: true,
      sha256: sha256(buf),
    });
  }

  const compiled = {
    meta: {
      source_url: `${UT1_BASE}/`,
      downloaded_on: downloadedOn,
      upstream_version: null,
      upstream_version_note: 'UT1 publishes a rolling snapshot with no version identifier. `downloaded_on` is a fetch date, not an upstream release. The compiled table is identified by compiled_sha256, pinned in harness/expected_artifacts.json.',
      licence: 'CC BY-SA 4.0',
      licence_holder: 'Universite Toulouse 1 Capitole',
      licence_url: 'https://dsi.ut-capitole.fr/blacklists/',
      attribution_required: true,
      md5sum_list_sha256: sha256(Buffer.from(md5List)),
      categories_used: perCategory.map((c) => c.category),
      category_map_sha256: sha256(fs.readFileSync(path.join(__dirname, 'ut1_category_map.json'))),
      per_category: perCategory,
      total_hosts: Object.keys(table).length,
      note: 'Compiled offline from UT1 category archives. Fixture eTLD+1 overlap is removed by the candidate BEFORE measurement; this table is the raw compile.',
    },
    table,
  };

  const outPath = path.join(ARTIFACTS_DIR, 'ut1', 'compiled.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(compiled));
  const outSha = sha256(fs.readFileSync(outPath));
  const totalHosts = Object.keys(table).length;
  console.log(`UT1_COMPILE done: ${totalHosts} hosts -> ${outPath} sha256=${outSha}`);

  // Pin check. Without this a re-run silently compiles a DIFFERENT 4.8M-host
  // table and republishes two of seven configurations against it with no
  // failure signal. Re-pinning must be a deliberate act, not a side effect.
  if (UT1_PIN && UT1_PIN.compiled_sha256) {
    if (UT1_PIN.compiled_sha256 !== outSha) {
      if (!process.env.UT1_REPIN) {
        throw new Error(
          `UT1 COMPILED TABLE DRIFT: expected ${UT1_PIN.compiled_sha256} (${UT1_PIN.total_hosts} hosts, `
          + `downloaded_on ${UT1_PIN.downloaded_on}), got ${outSha} (${totalHosts} hosts). `
          + 'UT1 publishes a rolling snapshot, so upstream changed. Results measured against a '
          + 'different table are not comparable to the published run. Review the diff, then re-pin '
          + 'deliberately with UT1_REPIN=1 and regenerate every downstream artifact.'
        );
      }
      console.log(`UT1_REPIN=1: accepting drifted table ${outSha} (was ${UT1_PIN.compiled_sha256}); downstream artifacts MUST be regenerated.`);
    } else {
      console.log(`UT1_PIN_VERIFIED=true sha256=${outSha} hosts=${totalHosts}`);
    }
  } else {
    console.log('UT1_PIN_ABSENT: no pin in expected_artifacts.json; this run cannot be reproduced by digest.');
  }

  manifest.ut1 = {
    downloaded_on: downloadedOn,
    upstream_version: null,
    total_hosts: totalHosts,
    compiled_sha256: outSha,
    pinned_sha256: UT1_PIN ? UT1_PIN.compiled_sha256 : null,
    pin_verified: Boolean(UT1_PIN && UT1_PIN.compiled_sha256 === outSha),
    repin_override_used: Boolean(process.env.UT1_REPIN),
    categories: perCategory,
    licence: 'CC BY-SA 4.0 (Universite Toulouse 1 Capitole)',
  };
}

async function main() {
  const manifest = {
    downloaded_at: new Date().toISOString(),
    phase: 'A',
    node_version: process.version,
    platform: `${process.platform}/${process.arch}`,
    models: [],
  };
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await downloadModels(manifest);
  await compileUt1(manifest);

  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nDOWNLOAD_COMPLETE=true');
}

main().catch((err) => {
  console.error('DOWNLOAD_FAILED:', err.stack ?? err.message);
  process.exit(1);
});
