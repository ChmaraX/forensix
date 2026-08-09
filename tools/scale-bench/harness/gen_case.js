'use strict';
// CLI: node gen_case.js <dbPath> <rows> <plain|candidates> [seed]
const fs = require('fs');
const Database = require('better-sqlite3');
const { generateCase } = require('./generate');

const [, , dbPath, rowsArg, arm, seedArg] = process.argv;
const rows = parseInt(rowsArg, 10);
const withCandidates = arm === 'candidates';
const seed = seedArg ? parseInt(seedArg, 10) : 42;

for (const ext of ['', '-wal', '-shm']) {
  const p = dbPath + ext;
  if (fs.existsSync(p)) fs.rmSync(p);
}

const t0 = process.hrtime.bigint();
const db = new Database(dbPath);
generateCase(db, { visitRows: rows, withCandidates, seed, runId: `bench-${rows}-${arm}` });
db.close();
const t1 = process.hrtime.bigint();

const sizeBytes = fs.statSync(dbPath).size;
const walBytes = fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0;

process.stdout.write(
  JSON.stringify({ rows, arm, generate_ms: Number(t1 - t0) / 1e6, case_file_bytes: sizeBytes, wal_bytes: walBytes })
);
