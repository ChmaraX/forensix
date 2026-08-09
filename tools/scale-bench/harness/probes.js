'use strict';

// P0-P4 cost-centre attribution, per research/159-scale-and-latency-evidence.md §8.4.
// Each probe runs the *same* full scan of `visits`, adding one layer, so the differences
// isolate SQLite engine cost from JS marshalling cost from object-construction cost from
// NDJSON-encoding cost. Rows are discarded (P0-P3) or written to /dev/null (P4) — nothing
// here is a real Export; it exists only to answer "where does the cost sit".

function hrms(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

function median(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Single-shot probe timings are noise-sensitive at smaller row counts (a GC pause or scheduler
// tick can dominate a <15ms measurement) — median-of-3 removes that without the cost of a full
// 30-rep loop over a 10^6-row full-table scan.
function hrmsMedian(fn, reps = 3) {
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(hrms(fn));
  return median(samples);
}

function probeP0_plan(db, sql) {
  return db.prepare('EXPLAIN QUERY PLAN ' + sql).all();
}

function probeP1_engineOnly(db) {
  // .pluck() returns the first column only — near-zero JS object construction (§3, §8.4).
  const stmt = db.prepare('SELECT visit_time FROM visits ORDER BY visit_time, id').pluck();
  let n = 0;
  return hrmsMedian(() => {
    for (const _ of stmt.iterate()) n++;
  });
}

function probeP2_rawArrays(db) {
  const stmt = db.prepare(
    'SELECT v.id, v.url, v.visit_time, v.transition, v.visit_duration, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id'
  ).raw();
  let n = 0;
  return hrmsMedian(() => {
    for (const _ of stmt.iterate()) n++;
  });
}

function probeP3_objects(db) {
  const stmt = db.prepare(
    'SELECT v.id, v.url, v.visit_time, v.transition, v.visit_duration, u.url as page_url, u.title FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id'
  );
  let n = 0;
  return hrmsMedian(() => {
    for (const _ of stmt.iterate()) n++;
  });
}

function probeP4_ndjsonEncode(db) {
  const stmt = db.prepare(
    'SELECT v.id, v.url, v.visit_time, v.transition, v.visit_duration, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id'
  ).raw();
  const cols = ['id', 'url', 'visit_time', 'transition', 'visit_duration', 'page_url', 'title'];
  let bytes = 0;
  return hrmsMedian(() => {
    for (const row of stmt.iterate()) {
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      bytes += JSON.stringify(obj).length + 1; // +1 for newline, as NDJSON would emit
    }
  });
}

function runAttribution(db) {
  const planSql =
    'SELECT v.id, v.url, v.visit_time, v.transition, v.visit_duration, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id';
  return {
    eqp: probeP0_plan(db, planSql),
    p1_engine_ms: probeP1_engineOnly(db),
    p2_raw_ms: probeP2_rawArrays(db),
    p3_object_ms: probeP3_objects(db),
    p4_ndjson_ms: probeP4_ndjsonEncode(db),
  };
}

module.exports = { runAttribution, probeP0_plan };
