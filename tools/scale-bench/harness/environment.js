'use strict';
const os = require('os');
const v8 = require('v8');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

function collectEnvironment() {
  const tmp = require('path').join(require('os').tmpdir(), `scale-bench-env-${Date.now()}.db`);
  const db = new Database(tmp);
  db.pragma('journal_mode = WAL');
  const sqliteVersion = db.prepare('select sqlite_version()').pluck().get();
  const journalMode = db.pragma('journal_mode', { simple: true });
  const synchronous = db.pragma('synchronous', { simple: true });
  const cacheSize = db.pragma('cache_size', { simple: true });
  const tempStore = db.pragma('temp_store', { simple: true });
  const mmapSize = db.pragma('mmap_size', { simple: true });
  const pageSize = db.pragma('page_size', { simple: true });
  db.close();
  require('fs').rmSync(tmp, { force: true });
  require('fs').rmSync(tmp + '-wal', { force: true });
  require('fs').rmSync(tmp + '-shm', { force: true });

  let betterSqlite3Version = 'unknown';
  try {
    betterSqlite3Version = require('better-sqlite3/package.json').version;
  } catch {}

  let cpuModel = os.cpus()?.[0]?.model || 'unknown';

  return {
    node_version: process.version,
    arch: process.arch,
    platform: process.platform,
    v8_heap_size_limit_bytes: v8.getHeapStatistics().heap_size_limit,
    max_string_length_units: require('buffer').constants.MAX_STRING_LENGTH,
    better_sqlite3_version: betterSqlite3Version,
    sqlite_version: sqliteVersion,
    journal_mode: journalMode,
    synchronous,
    cache_size: cacheSize,
    temp_store: tempStore,
    mmap_size: mmapSize,
    page_size: pageSize,
    cpu_model: cpuModel,
    cpu_count: os.cpus()?.length,
    total_mem_bytes: os.totalmem(),
    // Node's docs say maxRSS is bytes on Darwin / KiB on Linux (both via getrusage). Empirically
    // verified against process.memoryUsage().rss on this Node build (v24) instead of trusting that
    // claim: allocating a 200MB buffer moved maxRSS by ~246000, i.e. KB, on macOS too. Recorded as
    // measured, not assumed — this is exactly the kind of platform/version drift #159's own
    // evidence doc warns about (§4.3).
    maxrss_units: 'KiB (empirically verified on this Node build, not assumed from docs)',
    generated_at: new Date().toISOString(),
  };
}

module.exports = { collectEnvironment };
