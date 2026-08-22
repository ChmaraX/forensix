import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CASE_FILENAME } from "../src/case.js";
import { querySiteFindings, querySiteHosts } from "../src/sites-query.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function caseDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-sites-"));
  roots.push(root);
  const database = new DatabaseSync(join(root, CASE_FILENAME));
  database.exec(`
    CREATE TABLE case_info (case_id TEXT);
    INSERT INTO case_info VALUES ('CASE-TEST');
    CREATE TABLE history_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE cookie_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE login_data_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE bookmarks_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE top_sites_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE forensic_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
    CREATE TABLE cookie_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, host_key TEXT);
    CREATE TABLE login_data_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_origin TEXT);
    CREATE TABLE bookmarks_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
    CREATE TABLE top_sites_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
  `);
  database.close();
  return root;
}

function insert(
  directory: string,
  table: string,
  results: string,
  kind: string,
  hostColumn: string,
  hostValue: string,
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
    recorded: { state: "value", value: hostValue },
    missing: { state: "absent" },
  });
  database.prepare(`INSERT INTO ${results} VALUES (?, 1)`).run(id);
  database
    .prepare(
      `INSERT INTO ${table} VALUES (?, ?, 'finding', ?, 'Default', 'committed', ?, ?, ?)`,
    )
    .run(id, id, kind, provenance, fields, hostValue);
  database.close();
}

describe("Sites queries", () => {
  it("lists recorded hosts with per-artifact counts and returns host findings", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/a",
      1,
    );
    insert(
      directory,
      "cookie_findings",
      "cookie_artifact_results",
      "cookie",
      "host_key",
      ".example.com",
      2,
    );
    insert(
      directory,
      "login_data_findings",
      "login_data_artifact_results",
      "login",
      "sort_origin",
      "https://example.com/login",
      3,
    );
    insert(
      directory,
      "bookmarks_findings",
      "bookmarks_artifact_results",
      "bookmark",
      "sort_url",
      "https://other.test/",
      4,
    );

    expect(querySiteHosts({ caseDirectory: directory }).items).toEqual([
      {
        host: "example.com",
        counts: {
          visits: 1,
          cookies: 1,
          saved_logins: 1,
          bookmarks: 0,
          top_sites: 0,
          form_data: 0,
        },
      },
      {
        host: "other.test",
        counts: {
          visits: 0,
          cookies: 0,
          saved_logins: 0,
          bookmarks: 1,
          top_sites: 0,
          form_data: 0,
        },
      },
    ]);
    const findings = querySiteFindings({
      caseDirectory: directory,
      host: "example.com",
    });
    expect(findings.items).toHaveLength(3);
    expect(findings.items.map((item) => item.artifactKind)).toEqual([
      "cookies",
      "saved_logins",
      "visits",
    ]);
    expect(findings.items[0]?.provenance.rowId).toBe("2");
  });

  it("filters host names by search and returns an empty page when nothing matches", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/a",
      1,
    );
    expect(
      querySiteHosts({ caseDirectory: directory, search: "AMPLE" }).items.map(
        (item) => item.host,
      ),
    ).toEqual(["example.com"]);
    expect(
      querySiteHosts({ caseDirectory: directory, search: "missing" }),
    ).toMatchObject({ items: [], nextCursor: null });
    expect(
      querySiteFindings({ caseDirectory: directory, host: "missing.test" }),
    ).toMatchObject({ items: [], nextCursor: null });
  });
});
