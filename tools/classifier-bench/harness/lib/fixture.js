'use strict';
// Fixture loading, the frozen candidate input projection, and fixture validation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function loadFixture(fixtureDir) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, 'fixture_labelled.json'), 'utf8'));
}

function loadTaxonomy(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'taxonomy.json'), 'utf8'));
}

// The one normalisation every candidate sees identically (#137 §2), derived
// from #136's input contract: title + " " + url and nothing else.
function normalisedInput(row) {
  const title = (row.title || '').trim();
  const url = (row.url || '').trim();
  return `${title} ${url}`.trim();
}

// Title-only variant. #136 never established whether the URL helps or is token
// noise for short-text encoders, so both are measured rather than assumed.
function titleOnlyInput(row) {
  return (row.title || '').trim();
}

/**
 * A candidate must never see gold labels, rationale, ambiguity flags, or the
 * labeller id. The audit found the raw fixture row was passed straight through,
 * putting `row.labels` in scope inside every `predict()`. Frozen projection.
 */
function candidateView(row) {
  return Object.freeze({
    row_id: row.row_id,
    title: row.title,
    url: row.url,
  });
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * Fixture validator. Assertions V1-V8 from the audit's validation contract.
 * Returns { ok, violations } — the caller decides whether to throw.
 */
function validateFixture(rows, taxonomy) {
  const violations = [];
  const coreIds = new Set(taxonomy.core.map((l) => l.id));
  const seenRowIds = new Set();

  rows.forEach((row, i) => {
    const where = `row[${i}] ${row.row_id}`;

    // V1: 1..20 labels, all in the core taxonomy, no duplicates.
    if (!Array.isArray(row.labels) || row.labels.length < 1) {
      violations.push({ rule: 'V1', where, detail: 'empty or missing label set' });
    } else {
      if (new Set(row.labels).size !== row.labels.length) {
        violations.push({ rule: 'V1', where, detail: `duplicate labels: ${row.labels.join(',')}` });
      }
      for (const l of row.labels) {
        if (!coreIds.has(l)) violations.push({ rule: 'V1', where, detail: `label not in taxonomy core: ${l}` });
      }
    }

    // V2: mutually exclusive pairs.
    for (const pair of taxonomy.mutually_exclusive || []) {
      if (pair.every((l) => (row.labels || []).includes(l))) {
        violations.push({ rule: 'V2', where, detail: `mutually exclusive pair both present: ${pair.join(' + ')}` });
      }
    }

    // V3: content-addressed row id, unique.
    const digest = crypto.createHash('sha256')
      .update(`${row.title}\u0000${row.url}`).digest('hex').slice(0, 12);
    if (!String(row.row_id).endsWith(digest)) {
      violations.push({ rule: 'V3', where, detail: `row_id does not end in sha256(title\\0url)[:12] = ${digest}` });
    }
    if (seenRowIds.has(row.row_id)) {
      violations.push({ rule: 'V3', where, detail: 'duplicate row_id' });
    }
    seenRowIds.add(row.row_id);

    // V5: census fields present.
    for (const f of ['persona_id', 'stratum', 'etld1', 'url_group_id', 'ambiguous']) {
      if (row[f] === undefined || row[f] === null) {
        violations.push({ rule: 'V5', where, detail: `missing census field: ${f}` });
      }
    }

    // Provenance must survive (CONTEXT.md: Provenance).
    if (!row.provenance || !row.provenance.source || !row.provenance.source_sha256) {
      violations.push({ rule: 'P', where, detail: 'missing provenance' });
    }

    // V8: in-site search consistency.
    if (row.in_site_search === true && !(row.labels || []).includes('search_query')) {
      violations.push({ rule: 'V8', where, detail: 'in-site search row missing search_query' });
    }
  });

  return { ok: violations.length === 0, violations };
}

/** Census used to gate what may be claimed (A1-A4 in the audit contract). */
function fixtureCensus(rows, taxonomy) {
  const count = (f) => rows.reduce((m, r) => (m[r[f]] = (m[r[f]] || 0) + 1, m), {});
  const domains = count('etld1');
  const sortedDomains = Object.entries(domains).sort((a, b) => b[1] - a[1]);
  const top12 = sortedDomains.slice(0, 12).reduce((s, [, n]) => s + n, 0);

  const perLabel = {};
  for (const l of taxonomy.core) {
    const gold = rows.filter((r) => r.labels.includes(l.id));
    perLabel[l.id] = {
      gold_rows: gold.length,
      distinct_etld1: new Set(gold.map((r) => r.etld1)).size,
      distinct_personas: new Set(gold.map((r) => r.persona_id)).size,
      ambiguous_rows: gold.filter((r) => r.ambiguous).length,
    };
  }

  return {
    row_count: rows.length,
    distinct_urls: new Set(rows.map((r) => r.url)).size,
    distinct_titles: new Set(rows.map((r) => r.title)).size,
    distinct_etld1: Object.keys(domains).length,
    personas: count('persona_id'),
    persona_count: Object.keys(count('persona_id')).length,
    strata: count('stratum'),
    top_domain: sortedDomains[0] ? { etld1: sortedDomains[0][0], rows: sortedDomains[0][1], share: sortedDomains[0][1] / rows.length } : null,
    top12_domain_share: rows.length ? top12 / rows.length : null,
    rows_in_shared_url_groups: rows.filter((r) => r.url_group_shared).length,
    multi_label_rows: rows.filter((r) => r.labels.length > 1).length,
    ambiguous_rows: rows.filter((r) => r.ambiguous).length,
    per_label: perLabel,
  };
}

module.exports = {
  loadFixture,
  loadTaxonomy,
  normalisedInput,
  titleOnlyInput,
  candidateView,
  validateFixture,
  fixtureCensus,
  sha256File,
};
