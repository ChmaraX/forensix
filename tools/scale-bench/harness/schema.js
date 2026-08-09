'use strict';

// Schema is Chrome's real `urls`/`visits` DDL, verified against research/118-chrome-artifacts-today.md
// (which itself cites live-sourced Chromium schema dumps). This is deliberately the artifact shape,
// not an invented one — the ticket asks for "History rows" and History's own schema is documented.
//
// `candidates` is new: a v2-shaped table per CONTEXT.md's Export/Case terms and #123/#139/#160's
// settled rule that Candidates NEVER share a table with Findings and carry rank+count+provenance.
// It is not Chrome's schema — it is ForensiX's, and it exists here only to give the "with Candidates
// present, roughly doubling volume" arm something concrete to query.

function createSchema(db) {
  db.exec(`
    CREATE TABLE meta (
      key   LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY,
      value LONGVARCHAR
    );

    CREATE TABLE urls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      url             LONGVARCHAR,
      title           LONGVARCHAR,
      visit_count     INTEGER DEFAULT 0 NOT NULL,
      typed_count     INTEGER DEFAULT 0 NOT NULL,
      last_visit_time INTEGER NOT NULL,
      hidden          INTEGER DEFAULT 0 NOT NULL
    );

    CREATE TABLE visits (
      id             INTEGER PRIMARY KEY,
      url            INTEGER NOT NULL,
      visit_time     INTEGER NOT NULL,
      from_visit     INTEGER,
      transition     INTEGER DEFAULT 0 NOT NULL,
      segment_id     INTEGER,
      visit_duration INTEGER DEFAULT 0 NOT NULL,
      source         INTEGER
    );

    -- Candidate: a ranked heuristic possibility with count and provenance, never a Finding
    -- (#123, #139, #160). Provenance is a path back to source rows, here just the visit id.
    CREATE TABLE candidates (
      id           INTEGER PRIMARY KEY,
      visit_id     INTEGER NOT NULL,
      label        TEXT NOT NULL,
      rank         INTEGER NOT NULL,
      count        INTEGER NOT NULL,
      confidence   REAL NOT NULL,
      run_id       TEXT NOT NULL
    );

    -- The one index the ticket's own contract (#130 keyset pages) requires: visit_time is the
    -- paging/sort key for the per-artifact History view.
    CREATE INDEX idx_visits_time ON visits(visit_time, id);
    CREATE INDEX idx_visits_url  ON visits(url);
    CREATE INDEX idx_urls_time   ON urls(last_visit_time);

    -- Deliberately NO index on visit_duration: it is the "columns a per-artifact view actually
    -- offers" non-indexed filter+sort arm (budget row 4a).
  `);
  db.prepare(`INSERT INTO meta(key, value) VALUES ('version', '1'), ('last_compatible_version', '1')`).run();
}

module.exports = { createSchema };
