// Single-source Chrome History schema for the offline verification harness and
// the scale gate. Both drive the compiled analyzer CLI, so they must seed the
// exact same ground-truth schema; keeping the DDL here prevents silent drift
// between the golden Extract and the scale gate.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Chrome History schema (version 70) shared by every fixture seeder. */
export const CHROME_HISTORY_DDL = `
  CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
  INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
  CREATE TABLE urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url LONGVARCHAR, title LONGVARCHAR,
    visit_count INTEGER DEFAULT 0 NOT NULL,
    typed_count INTEGER DEFAULT 0 NOT NULL,
    last_visit_time INTEGER NOT NULL,
    hidden INTEGER DEFAULT 0 NOT NULL
  );
  CREATE TABLE visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
    from_visit INTEGER, external_referrer_url TEXT,
    transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER,
    visit_duration INTEGER DEFAULT 0 NOT NULL,
    incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
    opener_visit INTEGER, originator_cache_guid TEXT,
    originator_visit_id INTEGER, originator_from_visit INTEGER,
    originator_opener_visit INTEGER,
    is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
    consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
    visited_link_id INTEGER, app_id TEXT
  );
  CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
`;

/**
 * Create a Chrome History database at `path`, run the shared schema DDL, then
 * invoke `seed(database)` to insert fixture rows.
 * @param {string} path
 * @param {(database: DatabaseSync) => void} seed
 */
export function createHistoryDatabase(path, seed) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(CHROME_HISTORY_DDL);
    seed(database);
  } finally {
    database.close();
  }
}

/**
 * Write the minimal Chrome User Data Dir scaffold (a `Local State` file) into
 * `sourceDirectory`, which must already exist.
 * @param {string} sourceDirectory
 */
export function writeLocalState(sourceDirectory) {
  writeFileSync(`${sourceDirectory}/Local State`, "{}\n");
}
