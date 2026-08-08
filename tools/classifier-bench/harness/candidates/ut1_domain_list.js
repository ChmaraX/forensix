'use strict';
// Family 5: deterministic domain list, sourced from UT1 (Université Toulouse 1
// Capitole) — a third-party blacklist curated years before this fixture existed.
//
// This REPLACES the previous hand-written `domain-list-v1`, which the audit
// showed was co-authored with the gold labels: 23 of its 51 entries appeared in
// the fixture and 22 of those were also hard-coded rules in the labelling
// script, producing a near-tautological 98.9% accuracy on covered rows. That
// candidate is deleted, not demoted.
//
// Attribution (required): UT1 blacklists are published by Université Toulouse 1
// Capitole under CC BY-SA 4.0. A compiled host->label table derived from them is
// a derivative work and inherits the share-alike obligation. Source:
// https://dsi.ut-capitole.fr/blacklists/ (rel="license" -> CC BY-SA 4.0).
//
// Independence discipline, in order:
//   1. The archive is fetched in Phase A inside Docker, pinned by the upstream
//      MD5SUM.LST entry and re-hashed with SHA-256.
//   2. The category -> taxonomy mapping (ut1_category_map.json) is authored from
//      UT1's own published category descriptions, never from fixture rows.
//   3. Fixture overlap is handled by running TWO CONFIGURATIONS of this one
//      shortlisted option, because a single number cannot answer both questions:
//
//        `strict-overlap-removed` — every fixture eTLD+1 is deleted from the
//          table before measurement. This is the contamination LOWER BOUND. On
//          this fixture it measures 0% coverage, because UT1's entries for these
//          domains ARE the only entries that can fire. That zero is a real and
//          reportable result about the guard, not about UT1's quality.
//
//        `full-external-list` — the table as UT1 publishes it. This is the
//          realistic measurement of an independent third-party list. Its overlap
//          with the fixture is not author-side leakage: nobody on this project
//          selected UT1's entries, and a real filter list covering real domains
//          is the normal case, not contamination. The audit's finding concerned
//          a hand-written list authored by the same person who wrote the gold
//          labels; that channel does not exist here.
//
//      Both are published with explicit names. Neither may be quoted as the other.

const fs = require('node:fs');
const path = require('node:path');
const { rawPrediction } = require('../lib/prediction');
const { registrable } = require('../lib/contamination');

function hostOf(url) {
  try {
    if (/^(chrome|chrome-extension|chrome-native|about|file):/i.test(url)) return null;
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param compiledPath  JSON produced by Phase A: { host: [labelIds] }
 * @param fixtureRows   used ONLY to strip overlapping domains, never to add any
 * @param removeFixtureOverlap  true => strict lower-bound configuration
 */
function buildUt1Candidate({ id, family, compiledPath, fixtureRows, inputMode = 'title_url', removeFixtureOverlap = true, configuration }) {
  const compiled = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
  const table = compiled.table || {};
  const meta = compiled.meta || {};

  const fixtureDomains = new Set();
  for (const r of fixtureRows) {
    const d = registrable(r.url);
    if (d) fixtureDomains.add(d.toLowerCase());
  }

  // Overlap removal is applied as a LOOKUP-TIME FILTER rather than by copying
  // the table: the compiled artifact has ~4.8M entries and rebuilding it exhausts
  // the V8 heap. The filter is exactly equivalent (a host whose registrable
  // domain is in the fixture can never return a hit) and the removal count is
  // still measured, by scanning keys without materialising a second object.
  const removed = [];
  let removedCount = 0;
  if (removeFixtureOverlap) {
    for (const host in table) {
      const d = registrable(host);
      if (d && fixtureDomains.has(d.toLowerCase())) {
        removedCount++;
        if (removed.length < 20) removed.push(host);
      }
    }
  }

  const blocked = (host) => {
    if (!removeFixtureOverlap) return false;
    const d = registrable(host);
    return Boolean(d && fixtureDomains.has(d.toLowerCase()));
  };

  const cleaned = table;

  // Registrable-domain fallback.
  //
  // The compiled table has ~4.8M entries, so materialising an eTLD+1 index over
  // all of them (Object.entries + a Map of Sets) exhausts the V8 heap. The
  // lookup below walks the host's own parent labels instead, which is O(labels
  // in the hostname) per query and allocates nothing up front. `adult` alone
  // contributes 4.6M hosts, so this is not a micro-optimisation.
  function lookup(url) {
    const host = hostOf(url);
    if (!host) return null;
    if (blocked(host)) return null;   // strict configuration: overlap removed
    if (cleaned[host]) return cleaned[host];
    const stripped = host.replace(/^www\./, '');
    if (cleaned[stripped]) return cleaned[stripped];
    // Walk up to, but not past, the registrable domain.
    const reg = registrable(host);
    if (!reg) return null;
    const regLower = reg.toLowerCase();
    let cur = stripped;
    while (cur && cur.length >= regLower.length) {
      if (cleaned[cur]) return cleaned[cur];
      if (cur === regLower) break;
      const dot = cur.indexOf('.');
      if (dot === -1) break;
      cur = cur.slice(dot + 1);
    }
    return null;
  }

  async function predictRaw(view) {
    const hit = lookup(view.url);
    if (!hit || hit.length === 0) {
      // A definite "looked it up, not in the table" — CONTEXT.md `absent`,
      // not a low score. The harness turns this into abstention with
      // abstainReason 'no-list-entry'.
      return rawPrediction({ scores: {}, scoreAxis: 'rule-match', listHit: false });
    }
    const scores = {};
    for (const l of hit) scores[l] = 1;
    return rawPrediction({ scores, scoreAxis: 'rule-match', listHit: true });
  }

  return {
    id,
    family,
    inputMode,
    configuration: configuration || (removeFixtureOverlap ? 'strict-overlap-removed' : 'full-external-list'),
    shortlisted_option: 'UT1 domain list (family 5)',
    configuration_note: removeFixtureOverlap
      ? 'STRICT LOWER BOUND. Every fixture registrable domain was deleted from the table before measurement, so nothing can score on a domain shared with the held-out set. On this fixture that removes exactly the entries that could have fired.'
      : 'REALISTIC INDEPENDENT-LIST MEASUREMENT. The table as UT1 publishes it. Overlap with the fixture is not author-side leakage: UT1 curated these entries independently of this project, and a filter list covering common domains is its normal behaviour.',
    requiresModel: false,
    engine_kind: 'lookup-table',
    engine_details: {
      compiled_from: meta.source_url || 'https://dsi.ut-capitole.fr/blacklists/download/',
      // UT1 publishes a rolling snapshot with no upstream version identifier.
      // This is the fetch date, not a release; identity is the compiled digest.
      downloaded_on: meta.downloaded_on || meta.snapshot_date || null,
      upstream_version: null,
      upstream_version_note: meta.upstream_version_note
        || 'UT1 publishes a rolling snapshot with no version identifier; the compiled table is pinned by digest in harness/expected_artifacts.json.',
      categories_used: meta.categories_used || [],
      overlap_removal_applied: removeFixtureOverlap,
      entries_before_overlap_removal: meta.total_hosts ?? null,
      entries_after_overlap_removal: meta.total_hosts !== undefined && meta.total_hosts !== null
        ? meta.total_hosts - removedCount
        : null,
      fixture_overlap_entries_removed: removedCount,
      fixture_overlap_examples: removed.slice(0, 20),
      removal_note: removeFixtureOverlap
        ? 'Every fixture eTLD+1 was removed from the table BEFORE measurement. Measured coverage is therefore a strict lower bound on production coverage.'
        : 'No removal applied. This configuration measures the published list as-is.',
    },
    licence: {
      name: 'CC BY-SA 4.0',
      holder: 'Université Toulouse 1 Capitole',
      source: 'https://dsi.ut-capitole.fr/blacklists/',
      note: 'Compiled host->label table is a derivative work and inherits share-alike obligations. Attribution required in any shipped artifact.',
    },
    supervision: {
      kind: 'external-list',
      source: `UT1 blacklists, rolling snapshot downloaded ${meta.downloaded_on || meta.snapshot_date || '(undated)'} (no upstream version; pinned by compiled digest)`,
      sha256: meta.category_map_sha256 || null,
      exemplars: [],
      // The compiled table is far too large to declare entry-by-entry, and the
      // guard's job here is not to re-derive it: run_bench.js measures the actual
      // post-configuration fixture hit count and records it, which is the
      // property that matters. Declared explicitly rather than left implied.
      ruleDomains: [],
      rule_domain_declaration_note:
        `table has ${meta.total_hosts ?? 'unknown'} entries; overlap is measured directly by run_bench.js (post_removal_fixture_hits) rather than declared entry-by-entry`,
      overlap_removal_applied: removeFixtureOverlap,
      mapping_file: 'harness/ut1_category_map.json',
      mapping_note: 'Authored from UT1 published category descriptions only, never from fixture rows.',
      independence_argument: 'UT1 is curated by Universite Toulouse 1 Capitole independently of this project and predates this fixture. Its entries were not selected by the author of the gold labels, which is the contamination channel the audit identified in the previous hand-written list.',
    },
    // A list hit is categorical: there is no score axis to sweep.
    decision: { absoluteThreshold: 0, marginThreshold: 0, multiLabelDelta: 0 },
    sweep: { axis: null, thresholds: [], applicable: false, reason: 'family 5 emits a categorical list hit; there is no continuous score to threshold' },
    predictRaw,
    _debug: { removedCount, tableSize: meta.total_hosts ?? null },
  };
}

module.exports = { buildUt1Candidate };
