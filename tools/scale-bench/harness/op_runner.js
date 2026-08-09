'use strict';

// One (rowCount x arm x operation) measurement, run in its own child process so that
// process.resourceUsage().maxRSS (a monotonic high-water mark for the process's whole life,
// per research/159-scale-and-latency-evidence.md §4.3) reflects *this operation alone* against
// a constant Node+better-sqlite3 startup baseline, comparable across row counts.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { runAttribution, probeP0_plan } = require('./probes');

const PAGE_SIZE = 50;
const WARMUP = 5;
const REPS = 30;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    max_ms: sorted[sorted.length - 1],
    min_ms: sorted[0],
  };
}

function hrms(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

function timedReps(fn, warmup = WARMUP, reps = REPS) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < reps; i++) samples.push(hrms(fn));
  return stats(samples);
}

function firstPageQuery(db) {
  return db.prepare(
    `SELECT v.id, v.visit_time, v.transition, v.visit_duration, u.url, u.title
     FROM visits v JOIN urls u ON u.id = v.url
     ORDER BY v.visit_time, v.id LIMIT ?`
  );
}

function deepPageCursor(db, rows) {
  const anchorId = Math.max(1, Math.floor(rows * 0.9));
  const row = db.prepare('SELECT visit_time FROM visits WHERE id = ?').get(anchorId);
  return { visit_time: row.visit_time, id: anchorId };
}

function deepPageQuery(db) {
  return db.prepare(
    `SELECT v.id, v.visit_time, v.transition, v.visit_duration, u.url, u.title
     FROM visits v JOIN urls u ON u.id = v.url
     WHERE (v.visit_time > @vt) OR (v.visit_time = @vt AND v.id > @id)
     ORDER BY v.visit_time, v.id LIMIT @limit`
  );
}

function indexedThreshold(db, rows) {
  const anchorId = Math.max(1, Math.floor(rows * 0.5));
  const row = db.prepare('SELECT visit_time FROM visits WHERE id = ?').get(anchorId);
  return row.visit_time;
}

function filterSortIndexedQuery(db) {
  // Filter and sort both on visit_time (idx_visits_time) — the indexed arm (budget row 4).
  return db.prepare(
    `SELECT v.id, v.visit_time, v.transition, v.visit_duration, u.url, u.title
     FROM visits v JOIN urls u ON u.id = v.url
     WHERE v.visit_time > @threshold
     ORDER BY v.visit_time, v.id LIMIT @limit`
  );
}

function filterSortNonIndexedQuery(db) {
  // Filter and sort on visit_duration — deliberately unindexed (budget row 4a, §2.3/§2.4).
  return db.prepare(
    `SELECT v.id, v.visit_time, v.transition, v.visit_duration, u.url, u.title
     FROM visits v JOIN urls u ON u.id = v.url
     WHERE v.visit_duration > @threshold
     ORDER BY v.visit_duration, v.id LIMIT @limit`
  );
}

function runColdOpen(dbPath) {
  // "Cold" here = a brand-new connection + first usable view, in a brand-new process, with no
  // prior warm plan cache. NOT OS-page-cache-cold (unattainable cross-platform without root) —
  // recorded as a limitation, not silently assumed away.
  const ms = hrms(() => {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');
    db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get();
    firstPageQuery(db).all(PAGE_SIZE);
    db.close();
  });
  return { ms };
}

async function exportExtract(db, outDir, rows, arm) {
  const extractPath = path.join(outDir, 'extract-visits.ndjson');
  const stmt = db
    .prepare(
      `SELECT v.id, v.url, v.visit_time, v.transition, v.visit_duration, u.url as page_url, u.title
       FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id`
    )
    .raw();
  const cols = ['id', 'url_id', 'visit_time', 'transition', 'visit_duration', 'page_url', 'title'];

  let rowsOut = 0;
  let bytesOut = 0;
  function* toLines() {
    for (const r of stmt.iterate()) {
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = r[i];
      const line = JSON.stringify(obj) + '\n';
      bytesOut += Buffer.byteLength(line);
      rowsOut++;
      yield line;
    }
  }

  const t0 = process.hrtime.bigint();
  await pipeline(Readable.from(toLines()), fs.createWriteStream(extractPath));
  let candidatesRowsOut = 0;
  let candidatesBytesOut = 0;
  if (arm === 'candidates') {
    const candPath = path.join(outDir, 'extract-candidates.ndjson');
    const cstmt = db
      .prepare(`SELECT id, visit_id, label, rank, count, confidence, run_id FROM candidates`)
      .raw();
    const ccols = ['id', 'visit_id', 'label', 'rank', 'count', 'confidence', 'run_id'];
    function* toCandLines() {
      for (const r of cstmt.iterate()) {
        const obj = {};
        for (let i = 0; i < ccols.length; i++) obj[ccols[i]] = r[i];
        const line = JSON.stringify(obj) + '\n';
        candidatesBytesOut += Buffer.byteLength(line);
        candidatesRowsOut++;
        yield line;
      }
    }
    await pipeline(Readable.from(toCandLines()), fs.createWriteStream(candPath));
  }
  const t1 = process.hrtime.bigint();

  return {
    ms: Number(t1 - t0) / 1e6,
    rows_out: rowsOut,
    bytes_out: bytesOut,
    candidates_rows_out: candidatesRowsOut,
    candidates_bytes_out: candidatesBytesOut,
    extract_path: extractPath,
  };
}

async function generateReport(outDir, arm) {
  // Report is generated FROM the Extract (CONTEXT.md), never from the Case. Streams the NDJSON
  // and keeps only a bounded preview (first/last 25 rows) + running counts in memory, so memory
  // does not grow with row count (budget row 11) and the rendered table never exceeds the DOM
  // budget (row 12 — Lighthouse ~1400-node ceiling, research doc §5.2).
  const extractPath = path.join(outDir, 'extract-visits.ndjson');
  const readline = require('readline');
  const rl = readline.createInterface({ input: fs.createReadStream(extractPath), crlfDelay: Infinity });

  const PREVIEW = 25;
  const head = [];
  const tail = [];
  let count = 0;
  let transitionCounts = {};

  const t0 = process.hrtime.bigint();
  for await (const line of rl) {
    if (!line) continue;
    const row = JSON.parse(line);
    count++;
    transitionCounts[row.transition] = (transitionCounts[row.transition] || 0) + 1;
    if (head.length < PREVIEW) head.push(row);
    tail.push(row);
    if (tail.length > PREVIEW) tail.shift();
  }

  const rowsToHtml = (rows) =>
    rows
      .map(
        (r) =>
          `<tr><td>${r.id}</td><td>${r.visit_time}</td><td>${r.transition}</td><td>${r.visit_duration}</td><td>${escapeHtml(r.page_url || '')}</td><td>${escapeHtml(r.title || '')}</td></tr>`
      )
      .join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ForensiX Report</title></head><body>
<h1>History — Report</h1>
<p>Completeness Statement: attempted ${count}, produced ${count}, unavailable(reason): none — synthetic bench Case.</p>
<p>Total rows: ${count}</p>
<h2>First ${head.length} rows</h2>
<table border="1"><tr><th>id</th><th>visit_time</th><th>transition</th><th>visit_duration</th><th>url</th><th>title</th></tr>
${rowsToHtml(head)}
</table>
<h2>Last ${tail.length} rows</h2>
<table border="1"><tr><th>id</th><th>visit_time</th><th>transition</th><th>visit_duration</th><th>url</th><th>title</th></tr>
${rowsToHtml(tail)}
</table>
</body></html>`;
  const reportPath = path.join(outDir, 'report.html');
  fs.writeFileSync(reportPath, html);
  const t1 = process.hrtime.bigint();

  // DOM node count estimate for the rendered artifact: ~7 nodes/row (tr + 6 td) x 2 tables.
  const domNodes = (head.length + tail.length) * 7 + 20;

  return { ms: Number(t1 - t0) / 1e6, rows_scanned: count, dom_nodes: domNodes, report_path: reportPath, bytes: Buffer.byteLength(html) };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function main() {
  const params = JSON.parse(process.argv[2]);
  const { dbPath, op, rows, arm, outDir } = params;

  let result;
  if (op === 'cold_open') {
    const reps = [];
    for (let i = 0; i < 5; i++) reps.push(runColdOpen(dbPath).ms);
    result = { timing: stats(reps) };
  } else {
    const db = new Database(dbPath, { readonly: true });
    db.pragma('journal_mode = WAL');

    if (op === 'first_page') {
      const stmt = firstPageQuery(db);
      const timing = timedReps(() => stmt.all(PAGE_SIZE));
      const eqp = probeP0_plan(db, `SELECT * FROM visits v JOIN urls u ON u.id = v.url ORDER BY v.visit_time, v.id LIMIT ${PAGE_SIZE}`);
      result = { timing, eqp };
    } else if (op === 'deep_page') {
      const cursor = deepPageCursor(db, rows);
      const stmt = deepPageQuery(db);
      const timing = timedReps(() => stmt.all({ vt: cursor.visit_time, id: cursor.id, limit: PAGE_SIZE }));
      const eqp = probeP0_plan(
        db,
        `SELECT * FROM visits v JOIN urls u ON u.id = v.url WHERE (v.visit_time > ${cursor.visit_time}) ORDER BY v.visit_time, v.id LIMIT ${PAGE_SIZE}`
      );
      result = { timing, eqp, cursor };
    } else if (op === 'filter_sort_indexed') {
      const threshold = indexedThreshold(db, rows);
      const stmt = filterSortIndexedQuery(db);
      const timing = timedReps(() => stmt.all({ threshold, limit: PAGE_SIZE }));
      const eqp = probeP0_plan(
        db,
        `SELECT * FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_time > ${threshold} ORDER BY v.visit_time, v.id LIMIT ${PAGE_SIZE}`
      );
      result = { timing, eqp, threshold };
    } else if (op === 'filter_sort_nonindexed') {
      const threshold = 50000; // ~half of visit_duration's [0, 600000) skewed range
      const stmt = filterSortNonIndexedQuery(db);
      const timing = timedReps(() => stmt.all({ threshold, limit: PAGE_SIZE }), 3, 10); // fewer reps: this arm is expected to be slow at 1e6
      const eqp = probeP0_plan(
        db,
        `SELECT * FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_duration > ${threshold} ORDER BY v.visit_duration, v.id LIMIT ${PAGE_SIZE}`
      );
      result = { timing, eqp, threshold };
    } else if (op === 'attribution') {
      result = runAttribution(db);
    } else if (op === 'export') {
      result = await exportExtract(db, outDir, rows, arm);
    } else if (op === 'report') {
      result = await generateReport(outDir, arm);
    } else {
      throw new Error('unknown op: ' + op);
    }
    db.close();
  }

  const usage = process.resourceUsage();
  const output = {
    op,
    rows,
    arm,
    result,
    maxRSS: usage.maxRSS, // KiB on Linux, bytes on macOS per Node docs — normalised in make_report.js
    platform: process.platform,
  };
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(String(err.stack || err));
  process.exit(1);
});
