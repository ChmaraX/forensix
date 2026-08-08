'use strict';
// The contamination guard must FAIL CLOSED. The audit proved the previous guard
// was structurally incapable of firing: call sites passed a literal
// `{ exemplars: [] }`, so a candidate's declaration was discarded entirely.

const test = require('node:test');
const assert = require('node:assert');
const { contaminationGuard, registrable } = require('../lib/contamination');

const FIXTURE = [
  { url: 'https://mail.google.com/mail/' },
  { url: 'https://www.vrbo.com/1234' },
  { url: 'https://chick-fil-a.com/menu' },
  { url: 'chrome://newtab/' },
];

test('a candidate that declares no supervision is REJECTED', () => {
  assert.throws(
    () => contaminationGuard(FIXTURE, { id: 'silent' }),
    /no `supervision` declaration/,
    'silence must not be treated as evidence of independence'
  );
});

test('an unknown supervision kind is REJECTED', () => {
  assert.throws(
    () => contaminationGuard(FIXTURE, { id: 'x', supervision: { kind: 'vibes' } }),
    /unknown supervision.kind/
  );
});

test('an exemplar sharing a fixture URL is caught', () => {
  assert.throws(
    () => contaminationGuard(FIXTURE, {
      id: 'exemplar-leak',
      supervision: { kind: 'exemplars', exemplars: [{ url: 'https://mail.google.com/mail/' }] },
    }),
    /exact-row-overlap|etld1-overlap/
  );
});

test('an exemplar on a SUBDOMAIN of a fixture domain is caught (eTLD+1 matching)', () => {
  // The previous guard compared full hostnames, so an exemplar on `google.com`
  // would not have flagged a fixture row on `mail.google.com`.
  assert.throws(
    () => contaminationGuard(FIXTURE, {
      id: 'subdomain-leak',
      supervision: { kind: 'exemplars', exemplars: [{ url: 'https://drive.google.com/file/1' }] },
    }),
    /etld1-overlap/,
    'registrable-domain matching must catch a different subdomain of the same site'
  );
});

test('a rule table containing a fixture domain is caught — a domain list IS supervision', () => {
  assert.throws(
    () => contaminationGuard(FIXTURE, {
      id: 'rule-table-leak',
      supervision: { kind: 'external-list', exemplars: [], ruleDomains: ['www.vrbo.com', 'example.org'] },
    }),
    /rule-domain/
  );
});

test('supervision text mentioning a fixture domain verbatim is caught', () => {
  assert.throws(
    () => contaminationGuard(FIXTURE, {
      id: 'template-leak',
      supervision: { kind: 'hypothesis-template', texts: ['This page is like chick-fil-a.com'] },
    }),
    /text-domain-mention/
  );
});

test('a bare scheme word in a label description is NOT a false positive', () => {
  // Browser-internal rows (`chrome://`, `file://`) reduce to bare scheme words.
  // Substring-matching those against supervision text flags ordinary English:
  // the label "File sharing, Cloud storage & Transfer" contains "file". A guard
  // that fires on that gets switched off, which is worse than one that is narrow.
  const fixtureWithInternalRows = [
    { url: 'chrome://newtab/' },
    { url: 'file:///tmp/x' },
    { url: 'https://mail.google.com/mail/' },
  ];
  const r = contaminationGuard(fixtureWithInternalRows, {
    id: 'label-names-with-file',
    supervision: {
      kind: 'label-names',
      texts: [
        'File sharing, Cloud storage & Transfer. How did the data leave?',
        'This web page is about chrome extensions.',
      ],
    },
  });
  assert.deepEqual(r.violations, []);
});

test('a real dotted fixture domain in supervision text is STILL caught', () => {
  assert.throws(
    () => contaminationGuard(
      [{ url: 'chrome://newtab/' }, { url: 'https://www.vrbo.com/1' }],
      { id: 'x', supervision: { kind: 'label-names', texts: ['see vrbo.com for travel'] } }
    ),
    /text-domain-mention/,
    'narrowing to dotted domains must not disable the check that matters'
  );
});

test('clean label-name supervision passes and reports what it checked', () => {
  const r = contaminationGuard(FIXTURE, {
    id: 'clean',
    supervision: {
      kind: 'label-names',
      source: 'taxonomy.json',
      exemplars: [],
      ruleDomains: [],
      texts: ['Search & Query. What did the subject look for, in their own words?'],
    },
  });
  assert.deepEqual(r.violations, []);
  assert.equal(r.supervision_kind, 'label-names');
  assert.ok(r.checked_units.fixture_etld1 > 0);
  assert.match(r.matching_unit, /registrable-domain/);
});

test('registrable() reduces subdomains and tolerates browser-internal schemes', () => {
  assert.equal(registrable('https://mail.google.com/x'), 'google.com');
  assert.equal(registrable('www.vrbo.com'), 'vrbo.com');
  assert.equal(registrable('https://a.b.co.uk/'), 'b.co.uk');
  assert.equal(registrable('chrome://newtab/'), 'chrome');
});
