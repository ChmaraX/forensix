import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  createFinding,
  type Finding,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";

export type SiteArtifactKind =
  | "visits"
  | "cookies"
  | "saved_logins"
  | "bookmarks"
  | "top_sites"
  | "form_data";

export interface SiteHost {
  readonly host: string;
  readonly counts: Readonly<Record<SiteArtifactKind, number>>;
}

export interface SiteHostQuery {
  readonly caseDirectory: string;
  readonly limit?: number;
  readonly after?: string;
  readonly search?: string;
}

export interface SiteFindingsQuery {
  readonly caseDirectory: string;
  readonly host: string;
  readonly limit?: number;
  readonly after?: string;
}

export interface SiteHostPage {
  readonly status: "ok";
  readonly command: "site-hosts";
  readonly items: readonly SiteHost[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export interface SiteFinding extends Finding {
  readonly artifactKind: SiteArtifactKind;
}

export interface SiteFindingsPage {
  readonly status: "ok";
  readonly command: "site-findings";
  readonly items: readonly SiteFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface StoredRow {
  readonly finding_id: bigint;
  readonly finding_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly host_value: string | null;
  readonly artifact_kind: SiteArtifactKind;
}

const ARTIFACT_KINDS: readonly SiteArtifactKind[] = [
  "visits",
  "cookies",
  "saved_logins",
  "bookmarks",
  "top_sites",
  "form_data",
];
const TABLES = [
  [
    "forensic_findings",
    "history_artifact_results",
    "history_visit",
    "visits",
    "sort_url",
  ],
  [
    "cookie_findings",
    "cookie_artifact_results",
    "cookie",
    "cookies",
    "host_key",
  ],
  [
    "login_data_findings",
    "login_data_artifact_results",
    "login",
    "saved_logins",
    "sort_origin",
  ],
  [
    "bookmarks_findings",
    "bookmarks_artifact_results",
    "bookmark",
    "bookmarks",
    "sort_url",
  ],
  [
    "top_sites_findings",
    "top_sites_artifact_results",
    "top_site",
    "top_sites",
    "sort_url",
  ],
] as const;

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function normalizeLimit(value: number | undefined, label: string): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `${label} --limit must be an integer from 1 through 100.`,
      { limit },
    );
  }
  return limit;
}

function hostKey(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  // A URL hostname and Chrome's cookie host key name the recorded host; no
  // domain expansion or relationship scoring is performed here.
  if (value.startsWith(".")) return value.slice(1).toLocaleLowerCase("en-US");
  try {
    return new URL(value).hostname.toLocaleLowerCase("en-US") || null;
  } catch {
    return null;
  }
}

function schemaExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

function rows(database: DatabaseSync): StoredRow[] {
  const available = TABLES.filter(
    ([table, results]) =>
      schemaExists(database, table) && schemaExists(database, results),
  );
  if (available.length === 0)
    throw new ForensixError(
      "ANALYSIS_NOT_FOUND",
      "Case has no Sites analysis. Run analyse first.",
    );
  return available.flatMap(
    ([table, results, findingKind, artifactKind, hostColumn]) =>
      database
        .prepare(
          `SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state, f.provenance_json, f.fields_json, f.${hostColumn} AS host_value, '${artifactKind}' AS artifact_kind FROM ${table} f JOIN ${results} r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.finding_kind = ?`,
        )
        .all(findingKind) as unknown as StoredRow[],
  );
}

function fingerprint(
  database: DatabaseSync,
  query: Record<string, unknown>,
): string {
  const caseRow = database
    .prepare("SELECT case_id FROM case_info LIMIT 1")
    .get();
  if (typeof caseRow?.case_id !== "string")
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  return createHash("sha256")
    .update(JSON.stringify({ caseId: caseRow.case_id, query }))
    .digest("hex");
}

function cursor(
  value: string | undefined,
  expected: string,
  label: string,
): string | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.version === 1 &&
      parsed.fingerprint === expected &&
      typeof parsed.key === "string"
    )
      return parsed.key;
  } catch {
    /* typed error below */
  }
  throw new ForensixError(
    "INVALID_CURSOR",
    `${label} cursor does not belong to this query.`,
  );
}

function nextCursor(fingerprintValue: string, key: string): string {
  return Buffer.from(
    JSON.stringify({ version: 1, fingerprint: fingerprintValue, key }),
    "utf8",
  ).toString("base64url");
}

function parseFinding(row: StoredRow): Finding {
  let provenance: Provenance;
  let fields: ForensicFields;
  try {
    provenance = JSON.parse(row.provenance_json) as Provenance;
    fields = JSON.parse(row.fields_json) as ForensicFields;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Finding JSON.",
      { finding_id: row.finding_id.toString() },
      { cause: error },
    );
  }
  return createFinding({
    findingKind: row.finding_kind,
    profile: row.profile_path,
    commitState: row.commit_state as Finding["commitState"],
    provenance,
    fields,
  });
}

export function querySiteHosts(input: SiteHostQuery): SiteHostPage {
  const limit = normalizeLimit(input.limit, "Sites");
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;
  const database = openCase(input.caseDirectory);
  try {
    const query = { search };
    const fingerprintValue = fingerprint(database, query);
    const after = cursor(input.after, fingerprintValue, "Sites");
    const grouped = new Map<string, Record<SiteArtifactKind, number>>();
    for (const row of rows(database)) {
      const host = hostKey(row.host_value);
      if (host === null || (search !== null && !host.includes(search)))
        continue;
      const counts =
        grouped.get(host) ??
        (Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])) as Record<
          SiteArtifactKind,
          number
        >);
      counts[row.artifact_kind]++;
      grouped.set(host, counts);
    }
    const all = [...grouped.entries()]
      .map(([host, counts]) => ({ host, counts }))
      .sort((a, b) => a.host.localeCompare(b.host));
    const filtered =
      after === null ? all : all.filter((item) => item.host > after);
    const page = filtered.slice(0, limit);
    const lastHost = page.at(-1);
    return {
      status: "ok",
      command: "site-hosts",
      items: page,
      nextCursor:
        filtered.length > limit && lastHost !== undefined
          ? nextCursor(fingerprintValue, lastHost.host)
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}

export function querySiteFindings(input: SiteFindingsQuery): SiteFindingsPage {
  const limit = normalizeLimit(input.limit, "Sites");
  const host = input.host.toLocaleLowerCase("en-US");
  if (host.length === 0)
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Sites --host must not be empty.",
    );
  const database = openCase(input.caseDirectory);
  try {
    const fingerprintValue = fingerprint(database, { host });
    const after = cursor(input.after, fingerprintValue, "Sites");
    const all = rows(database)
      .filter((row) => hostKey(row.host_value) === host)
      .sort(
        (a, b) =>
          a.artifact_kind.localeCompare(b.artifact_kind) ||
          (a.finding_id < b.finding_id ? -1 : 1),
      );
    const keyed = all.map((row) => ({
      row,
      key: `${row.artifact_kind}:${row.finding_id}`,
    }));
    const filtered =
      after === null ? keyed : keyed.filter((item) => item.key > after);
    const page = filtered.slice(0, limit);
    const lastEntry = page.at(-1);
    return {
      status: "ok",
      command: "site-findings",
      items: page.map(({ row }) => ({
        ...parseFinding(row),
        artifactKind: row.artifact_kind,
      })),
      nextCursor:
        filtered.length > limit && lastEntry !== undefined
          ? nextCursor(fingerprintValue, lastEntry.key)
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
