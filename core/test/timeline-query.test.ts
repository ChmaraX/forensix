import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CASE_FILENAME } from "../src/case.js";
import { queryTimeline } from "../src/timeline-query.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function caseDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-timeline-"));
  roots.push(root);
  const database = new DatabaseSync(join(root, CASE_FILENAME));
  database.exec(`
    CREATE TABLE case_info (case_id TEXT);
    INSERT INTO case_info VALUES ('CASE-TEST');
    CREATE TABLE history_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE downloads_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE cookie_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE web_data_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE forensic_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_time TEXT);
    CREATE TABLE downloads_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_start TEXT);
    CREATE TABLE cookie_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_creation TEXT);
    CREATE TABLE web_data_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_last_used TEXT);
  `);
  database.close();
  return root;
}

function insert(
  directory: string,
  table: string,
  resultTable: string,
  kind: string,
  timestamp: string,
  id: number,
): void {
  const database = new DatabaseSync(join(directory, CASE_FILENAME));
  const provenance = JSON.stringify({
    sourceId: "SRC",
    manifestEntryOrdinal: 0,
    manifestEntryId: "SRC:0",
    manifestPath: "Default/History",
    database: "History",
    table,
    rowId: String(id),
  });
  const fields = JSON.stringify({
    recorded: { state: "value", value: timestamp },
    missing: { state: "absent" },
  });
  database.prepare(`INSERT INTO ${resultTable} VALUES (?, 1)`).run(id);
  const timestampColumn =
    table === "forensic_findings"
      ? "sort_time"
      : table === "downloads_findings"
        ? "sort_start"
        : table === "cookie_findings"
          ? "sort_creation"
          : "sort_last_used";
  database
    .prepare(
      `INSERT INTO ${table} (finding_id, artifact_result_id, record_type, finding_kind, profile_path, commit_state, provenance_json, fields_json, ${timestampColumn}) VALUES (?, ?, 'finding', ?, 'Default', 'committed', ?, ?, ?)`,
    )
    .run(id, id, kind, provenance, fields, timestamp);
  database.close();
}

describe("queryTimeline", () => {
  it("merges recorded timestamps and advances with a keyset cursor", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "2024-01-04T00:00:00.000000Z",
      1,
    );
    insert(
      directory,
      "downloads_findings",
      "downloads_artifact_results",
      "download",
      "2024-01-03T00:00:00.000000Z",
      2,
    );
    insert(
      directory,
      "cookie_findings",
      "cookie_artifact_results",
      "cookie",
      "2024-01-02T00:00:00.000000Z",
      3,
    );
    insert(
      directory,
      "web_data_findings",
      "web_data_artifact_results",
      "autofill_entry",
      "2024-01-01T00:00:00.000000Z",
      4,
    );

    const first = queryTimeline({ caseDirectory: directory, limit: 2 });
    expect(first.items.map((item) => item.findingKind)).toEqual([
      "history_visit",
      "download",
    ]);
    expect(first.items[0]?.fields).toEqual({
      recorded: { state: "value", value: "2024-01-04T00:00:00.000000Z" },
      missing: { state: "absent" },
    });
    expect(first.nextCursor).not.toBeNull();

    const second = queryTimeline({
      caseDirectory: directory,
      limit: 2,
      after: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.findingKind)).toEqual([
      "cookie",
      "autofill_entry",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns an empty page when no timestamped findings exist", async () => {
    const directory = await caseDirectory();
    expect(queryTimeline({ caseDirectory: directory })).toMatchObject({
      items: [],
      nextCursor: null,
      limit: 50,
    });
  });
});
