'use strict';

const { createSchema } = require('./schema');

// Confounder control (research/159-scale-and-latency-evidence.md §8.3): "Generator artefacts —
// synthetic URLs of uniform length, perfectly ascending timestamps, or all-distinct values give
// unrealistic b-tree and sort behaviour." So this generator is deliberately skewed:
//  - a small set of "hot" domains take most of the visits (research/137's real-world finding was
//    one domain at 58.2% of rows; we use a milder but still real Zipf-like skew)
//  - visit_time is monotonic-ish but jittered, never perfectly ascending against `id`
//  - title lengths and visit_duration vary
//  - roughly 1 url per ~6 visits (revisits), not 1:1

const DOMAINS = [
  'google.com', 'youtube.com', 'github.com', 'mail.example.com', 'docs.example.com',
  'news.example.net', 'shop.example.org', 'forum.example.io', 'wiki.example.org',
  'social.example.app', 'stream.example.tv', 'bank.example.finance', 'cloud.example.dev',
  'maps.example.com', 'search.example.co',
];
// Zipf-like weight: DOMAINS[0] is most frequent.
const DOMAIN_WEIGHTS = DOMAINS.map((_, i) => 1 / (i + 1));
const DOMAIN_TOTAL = DOMAIN_WEIGHTS.reduce((a, b) => a + b, 0);

function pickDomain(rand) {
  let r = rand() * DOMAIN_TOTAL;
  for (let i = 0; i < DOMAINS.length; i++) {
    r -= DOMAIN_WEIGHTS[i];
    if (r <= 0) return DOMAINS[i];
  }
  return DOMAINS[DOMAINS.length - 1];
}

// Deterministic PRNG (mulberry32) so every generated Case at a given (rows, seed) is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLE_WORDS = [
  'Dashboard', 'Report', 'Overview', 'Search results for', 'Account settings', 'Inbox',
  'Thread', 'Article', 'Product', 'Checkout', 'Login', 'Profile', 'Repository', 'Pull request',
  'Issue', 'Documentation', 'News', 'Video', 'Photos', 'Maps', 'Weather', 'Calendar',
];

function randTitle(rand) {
  const n = 2 + Math.floor(rand() * 4);
  let s = '';
  for (let i = 0; i < n; i++) s += (i ? ' ' : '') + TITLE_WORDS[Math.floor(rand() * TITLE_WORDS.length)];
  return s + ' - ' + Math.floor(rand() * 1e6).toString(36);
}

const CHROME_EPOCH_OFFSET_US = 11644473600000000n; // 1601-01-01 -> unix epoch, microseconds

function toChromeTime(msSinceEpoch) {
  return BigInt(Math.round(msSinceEpoch)) * 1000n + CHROME_EPOCH_OFFSET_US;
}

/**
 * Populate `db` with `visitRows` History visits (and a proportionate `urls` table), optionally
 * with a Candidates arm at ~`visitRows` rows (roughly doubling volume, per the ticket).
 */
function generateCase(db, { visitRows, withCandidates, seed = 42, runId = 'bench-run' }) {
  createSchema(db);
  const rand = mulberry32(seed);

  db.pragma('journal_mode = WAL');
  // Durability setting recorded, not silently defaulted (research doc §3: this is a Case-integrity
  // question). WAL/NORMAL is better-sqlite3's own headline performance guidance; recorded in the
  // environment block by the caller.

  const urlCount = Math.max(1, Math.round(visitRows / 6)); // ~6 revisits per URL, not 1:1
  const now = Date.now();
  const spanMs = 90 * 24 * 3600 * 1000; // 90-day window — research doc §9.1's Chromium expiry bound
  const startMs = now - spanMs;

  const insertUrl = db.prepare(
    `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?,?,?,?,?,?,?)`
  );
  const insertVisit = db.prepare(
    `INSERT INTO visits (id, url, visit_time, from_visit, transition, segment_id, visit_duration, source) VALUES (?,?,?,?,?,?,?,?)`
  );
  const insertCandidate = db.prepare(
    `INSERT INTO candidates (id, visit_id, label, rank, count, confidence, run_id) VALUES (?,?,?,?,?,?,?)`
  );

  const urlVisitCounts = new Array(urlCount + 1).fill(0);

  const genUrls = db.transaction((count) => {
    for (let i = 1; i <= count; i++) {
      const domain = pickDomain(rand);
      const path = '/p/' + Math.floor(rand() * 1e7).toString(36);
      insertUrl.run(
        i,
        `https://${domain}${path}`,
        randTitle(rand),
        0, // visit_count patched implicitly (not re-derived; out of scope for this bench)
        rand() < 0.08 ? 1 + Math.floor(rand() * 5) : 0,
        toChromeTime(startMs + spanMs).toString(),
        rand() < 0.02 ? 1 : 0
      );
    }
  });
  genUrls(urlCount);

  const CHUNK = 20000;
  let lastVisitId = null;
  const genVisits = db.transaction((fromId, toId) => {
    for (let id = fromId; id <= toId; id++) {
      const urlId = 1 + Math.floor(rand() * urlCount);
      urlVisitCounts[urlId]++;
      // Jittered, non-perfectly-ascending time within the 90-day window (confounder control).
      const frac = (id - 1) / visitRows;
      const jitterMs = (rand() - 0.5) * 6 * 3600 * 1000; // +/- 3h jitter
      const t = startMs + frac * spanMs + jitterMs;
      const fromVisit = rand() < 0.3 && lastVisitId ? lastVisitId : null;
      insertVisit.run(
        id,
        urlId,
        toChromeTime(t).toString(),
        fromVisit,
        Math.floor(rand() * 11),
        rand() < 0.5 ? Math.floor(rand() * 1000) : null,
        Math.floor(rand() * rand() * 600000), // skewed duration, not uniform
        rand() < 0.05 ? 0 : 1
      );
      lastVisitId = id;
    }
  });
  for (let from = 1; from <= visitRows; from += CHUNK) {
    genVisits(from, Math.min(visitRows, from + CHUNK - 1));
  }

  if (withCandidates) {
    const labels = ['likely-shopping', 'likely-financial', 'automated-fetch', 'possible-typo-domain'];
    const genCandidates = db.transaction((fromId, toId) => {
      let cid = fromId;
      for (let vid = fromId; vid <= toId; vid++) {
        // ~1 candidate per visit on average -> "roughly doubles the volume", not exactly.
        if (rand() < 0.9) {
          insertCandidate.run(
            cid,
            vid,
            labels[Math.floor(rand() * labels.length)],
            1 + Math.floor(rand() * 3),
            1 + Math.floor(rand() * 20),
            Math.round(rand() * 1000) / 1000,
            runId
          );
          cid++;
        }
      }
    });
    for (let from = 1; from <= visitRows; from += CHUNK) {
      genCandidates(from, Math.min(visitRows, from + CHUNK - 1));
    }
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('ANALYZE');
  db.pragma('optimize');
}

module.exports = { generateCase, toChromeTime, CHROME_EPOCH_OFFSET_US };
