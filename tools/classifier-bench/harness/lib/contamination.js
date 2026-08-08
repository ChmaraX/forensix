'use strict';
// Contamination guard, ChmaraX/forensix#137 §4 — rewritten to FAIL CLOSED.
//
// The audit proved the previous guard was structurally incapable of firing: both
// call sites passed a literal `{ exemplars: [] }`, so whatever a candidate
// declared was discarded. It also compared full hostnames while the brief
// claimed eTLD+1 matching, so an exemplar on `google.com` would not have flagged
// a fixture row on `mail.google.com`.
//
// Rules now enforced:
//   1. A candidate MUST declare `supervision`. Absent or malformed => throw.
//      Silence is not evidence of independence.
//   2. Supervision is checked at the REGISTRABLE DOMAIN (eTLD+1) level, using
//      the `tldts` public-suffix implementation bundled into the image at build
//      time. No network access, deterministic offline.
//   3. A domain->label rule table IS supervision. The previous family-5
//      candidate was hand-curated against the same boundaries as the gold labels
//      and declared nothing, which is exactly the channel the guard missed.
//   4. Any intersection with the fixture is a hard failure, not a warning.

const { getDomain } = require('tldts');

const SUPERVISION_KINDS = Object.freeze([
  'label-names',        // taxonomy names/questions/boundaries only
  'hypothesis-template', // NLI template over label names
  'external-list',      // third-party curated table, e.g. UT1
  'exemplars',          // per-label example rows
  'none',
]);

function registrable(urlOrHost) {
  if (!urlOrHost) return null;
  const s = String(urlOrHost);
  // Browser-internal surfaces have no registrable domain; treat the scheme as
  // the key so they can still be compared for overlap.
  if (/^(chrome|chrome-extension|chrome-native|about|file):/i.test(s)) {
    return s.split(/[/?#]/)[0].replace(/:$/, '');
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const d = getDomain(new URL(withScheme).hostname);
    return d || new URL(withScheme).hostname || null;
  } catch {
    return getDomain(s) || null;
  }
}

function fixtureDomainSet(fixtureRows) {
  const set = new Set();
  for (const r of fixtureRows) {
    const d = registrable(r.url);
    if (d) set.add(d.toLowerCase());
  }
  return set;
}

function fixtureUrlSet(fixtureRows) {
  return new Set(fixtureRows.map((r) => r.url));
}

/**
 * @param fixtureRows  the held-out rows
 * @param candidate    must expose `.supervision`
 * @returns { supervision_kind, checked_units, violations: [] }
 * @throws on missing/invalid supervision, or on any overlap
 */
function contaminationGuard(fixtureRows, candidate) {
  const id = candidate && candidate.id ? candidate.id : '<unnamed candidate>';
  const sup = candidate && candidate.supervision;

  if (!sup || typeof sup !== 'object') {
    throw new Error(
      `CONTAMINATION GUARD FAILED for ${id}: no \`supervision\` declaration. ` +
      `Every candidate must declare its supervision; the guard fails closed.`
    );
  }
  if (!SUPERVISION_KINDS.includes(sup.kind)) {
    throw new Error(
      `CONTAMINATION GUARD FAILED for ${id}: unknown supervision.kind="${sup.kind}". ` +
      `Expected one of: ${SUPERVISION_KINDS.join(', ')}`
    );
  }

  const fixtureDomains = fixtureDomainSet(fixtureRows);
  const fixtureUrls = fixtureUrlSet(fixtureRows);
  const violations = [];

  // (a) Exemplar rows: exact URL and registrable-domain overlap.
  for (const ex of sup.exemplars || []) {
    const exUrl = typeof ex === 'string' ? ex : ex.url;
    if (!exUrl) continue;
    if (fixtureUrls.has(exUrl)) {
      violations.push({ type: 'exact-row-overlap', url: exUrl });
    }
    const d = registrable(exUrl);
    if (d && fixtureDomains.has(d.toLowerCase())) {
      violations.push({ type: 'etld1-overlap', unit: 'exemplar', domain: d });
    }
  }

  // (b) Rule tables / domain lists. A domain->label map IS supervision.
  for (const host of sup.ruleDomains || []) {
    const d = registrable(host);
    if (d && fixtureDomains.has(d.toLowerCase())) {
      violations.push({ type: 'etld1-overlap', unit: 'rule-domain', domain: d, declared: host });
    }
  }

  // (c) Free-text supervision (templates, label names) must not embed a fixture
  // registrable domain verbatim.
  //
  // Only real dotted domains are checked. Browser-internal pseudo-schemes reduce
  // to bare scheme words like `chrome` or `file`, and matching those as substrings
  // flags ordinary English in a label description ("File sharing..." contains
  // "file"). That is a false positive, not contamination, and it would make the
  // guard unusable — a guard that cries wolf gets disabled, which is worse than
  // one that is narrow and honest about its scope.
  const textCheckable = [...fixtureDomains].filter((d) => d.includes('.'));
  for (const text of sup.texts || []) {
    if (typeof text !== 'string') continue;
    const lower = text.toLowerCase();
    for (const d of textCheckable) {
      if (lower.includes(d)) {
        violations.push({ type: 'text-domain-mention', domain: d, text: text.slice(0, 120) });
      }
    }
  }

  if (violations.length) {
    throw new Error(
      `CONTAMINATION GUARD FAILED for ${id}: ${violations.length} overlap(s) with the held-out fixture: ` +
      JSON.stringify(violations.slice(0, 20))
    );
  }

  return {
    candidate_id: id,
    supervision_kind: sup.kind,
    supervision_source: sup.source || null,
    supervision_sha256: sup.sha256 || null,
    exemplar_count: (sup.exemplars || []).length,
    rule_domain_count: (sup.ruleDomains || []).length,
    checked_units: { fixture_etld1: fixtureDomains.size, fixture_urls: fixtureUrls.size },
    matching_unit: 'registrable-domain (eTLD+1) via tldts public suffix list',
    violations: [],
  };
}

module.exports = { contaminationGuard, registrable, fixtureDomainSet, SUPERVISION_KINDS };
