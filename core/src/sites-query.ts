import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { openCaseReadOnly } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  createFinding,
  type CommitState,
  type Finding,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";
import { resolveCommitState, resolveProfiles } from "./finding-query.js";
import {
  recordStoreForTable,
  withRecordId,
  type Identified,
} from "./record-store.js";
import {
  SITE_HOST_FIELDS,
  siteHostsOf,
  type SiteHostFieldState,
} from "./site-host-key.js";

/** The evidence kinds Sites groups by host. Each is one Case table; which
 *  of a row's fields put it on a host is `SITE_HOST_FIELDS`. */
export type SiteArtifactKind =
  | "visits"
  | "cookies"
  | "saved_logins"
  | "bookmarks"
  | "top_sites"
  | "downloads"
  | "cache"
  | "favicons";

export interface SiteHost {
  readonly host: string;
  /** Rows per artifact kind, every Commit State. A row on several hosts (a
   *  download's redirect chain, a favicon's page URLs) counts on each. */
  readonly counts: Readonly<Record<SiteArtifactKind, number>>;
  /** Rows per artifact kind that are committed (saved), so a figure can count
   *  saved rows without summing in WAL- or journal-resident ones. */
  readonly savedCounts: Readonly<Record<SiteArtifactKind, number>>;
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
  /** Only these artifact kinds (`visits`, `cookies`, ...). */
  readonly kinds?: readonly string[];
  /** Only rows of these Profiles. */
  readonly profiles?: readonly string[];
  readonly commitState?: CommitState;
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
  /** The fields that record this host, in `SITE_HOST_FIELDS` order (a
   *  download's "urlChain" and "referrer", a favicon's "pageUrls"). */
  readonly hostFields: readonly string[];
}

export interface SiteFindingsPage {
  readonly status: "ok";
  readonly command: "site-findings";
  readonly items: readonly Identified<SiteFinding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

/** One Case table Sites groups, and the write-time columns that copy a host
 *  field's string value (read instead of the fields JSON; any other host
 *  field is read from the JSON in SQL, never materialised in full). */
interface SiteTable {
  readonly table: string;
  readonly results: string;
  readonly findingKind: string;
  readonly artifactKind: SiteArtifactKind;
  readonly columns: Readonly<Record<string, string>>;
}

/** Ordered by artifact kind, the order rows page in. */
const TABLES: readonly SiteTable[] = [
  {
    table: "forensic_findings",
    results: "history_artifact_results",
    findingKind: "history_visit",
    artifactKind: "visits",
    columns: { url: "sort_url" },
  },
  {
    table: "cookie_findings",
    results: "cookie_artifact_results",
    findingKind: "cookie",
    artifactKind: "cookies",
    columns: { hostKey: "host_key" },
  },
  {
    table: "login_data_findings",
    results: "login_data_artifact_results",
    findingKind: "login_credential",
    artifactKind: "saved_logins",
    columns: { originUrl: "sort_origin" },
  },
  {
    table: "bookmarks_findings",
    results: "bookmarks_artifact_results",
    findingKind: "bookmark",
    artifactKind: "bookmarks",
    columns: { url: "sort_url" },
  },
  {
    table: "top_sites_findings",
    results: "top_sites_artifact_results",
    findingKind: "top_site",
    artifactKind: "top_sites",
    columns: { url: "sort_url" },
  },
  {
    table: "downloads_findings",
    results: "downloads_artifact_results",
    findingKind: "download",
    artifactKind: "downloads",
    columns: {},
  },
  {
    table: "cache_findings",
    results: "cache_artifact_results",
    findingKind: "cache_entry",
    artifactKind: "cache",
    columns: { key: "sort_key" },
  },
  {
    table: "favicon_findings",
    results: "favicon_artifact_results",
    findingKind: "favicon",
    artifactKind: "favicons",
    columns: { iconUrl: "sort_icon_url" },
  },
];

const ARTIFACT_KINDS: readonly SiteArtifactKind[] = TABLES.map(
  (table) => table.artifactKind,
);

/** The artifact kinds `querySiteFindings` accepts in `kinds`. */
export const SITE_ARTIFACT_KINDS: readonly SiteArtifactKind[] = ARTIFACT_KINDS;

/** A row as the host pass reads it: identity, Commit State, and each host
 *  it is on with the fields that put it there. */
interface HostRow {
  readonly table: SiteTable;
  readonly id: bigint;
  readonly committed: boolean;
  readonly hosts: ReadonlyMap<string, readonly string[]>;
}

interface StoredRow {
  readonly finding_id: bigint;
  readonly finding_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly provenance_json: string;
  readonly fields_json: string;
}

export function openSitesCase(caseDirectory: string): DatabaseSync {
  return openCaseReadOnly(caseDirectory, { readBigInts: true });
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

export function schemaExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

function invalidJson(table: string, cause: unknown): ForensixError {
  return new ForensixError(
    "CASE_INVALID",
    "Case contains invalid Finding JSON.",
    { table },
    { cause },
  );
}

/** A field-state object read from the fields JSON in SQL
 *  (`json_extract(fields_json, '$.<field>')`), or undefined when none. */
export function parseFieldState(
  raw: unknown,
  table: string,
): SiteHostFieldState | undefined {
  if (typeof raw !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw invalidJson(table, error);
  }
  return typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { state?: unknown }).state === "string"
    ? (parsed as SiteHostFieldState)
    : undefined;
}

/** A host field's recorded state from its SQL read: a column copy is the
 *  value itself (null: none), a JSON read is the field-state object. */
function fieldStateOf(
  fromColumn: boolean,
  raw: unknown,
  table: string,
): SiteHostFieldState | undefined {
  if (!fromColumn) return parseFieldState(raw, table);
  return typeof raw === "string" ? { state: "value", value: raw } : undefined;
}

/** Runs a Sites read, reporting malformed fields JSON (which fails
 *  `json_extract`) as an invalid Case rather than an unknown error. */
export function readingJson<T>(table: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && /malformed JSON/i.test(error.message))
      throw invalidJson(table, error);
    throw error;
  }
}

/** Optional row filters of a site-findings read. */
interface HostRowFilter {
  readonly kinds: readonly string[];
  readonly profiles: readonly string[];
  readonly commitState: CommitState | null;
}

const NO_FILTER: HostRowFilter = { kinds: [], profiles: [], commitState: null };

/**
 * Every active row of every Sites table, read for its hosts only: id,
 * Commit State and the host fields (no provenance, no whole fields JSON).
 */
function hostRows(
  database: DatabaseSync,
  filter: HostRowFilter = NO_FILTER,
): HostRow[] {
  const available = TABLES.filter(
    (table) =>
      schemaExists(database, table.table) &&
      schemaExists(database, table.results),
  );
  if (available.length === 0)
    throw new ForensixError(
      "ANALYSIS_NOT_FOUND",
      "Case has no Sites analysis. Run analyse first.",
    );
  const filterSql: string[] = [];
  const filterParameters: string[] = [];
  if (filter.profiles.length > 0) {
    filterSql.push(
      `f.profile_path IN (${filter.profiles.map(() => "?").join(", ")})`,
    );
    filterParameters.push(...filter.profiles);
  }
  if (filter.commitState !== null) {
    filterSql.push("f.commit_state = ?");
    filterParameters.push(filter.commitState);
  }
  const selected =
    filter.kinds.length === 0
      ? available
      : available.filter((table) => filter.kinds.includes(table.artifactKind));
  return selected.flatMap((table) => {
    const entries = SITE_HOST_FIELDS[table.findingKind] ?? [];
    const reads = entries.map((entry, index) => {
      const column = table.columns[entry.field];
      return {
        fromColumn: column !== undefined,
        sql:
          column !== undefined
            ? `f.${column} AS h${String(index)}`
            : `json_extract(f.fields_json, '$.${entry.field}') AS h${String(index)}`,
      };
    });
    const stored = readingJson(table.table, () =>
      database
        .prepare(
          `SELECT f.finding_id, f.commit_state${reads.map((read) => `, ${read.sql}`).join("")} FROM ${table.table} f JOIN ${table.results} r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.finding_kind = ?${filterSql.map((condition) => ` AND ${condition}`).join("")}`,
        )
        .all(table.findingKind, ...filterParameters),
    );
    return stored.flatMap((row) => {
      const fields: Record<string, SiteHostFieldState | undefined> = {};
      entries.forEach((entry, index) => {
        fields[entry.field] = fieldStateOf(
          reads[index]?.fromColumn ?? false,
          row[`h${String(index)}`],
          table.table,
        );
      });
      const hosts = siteHostsOf(table.findingKind, fields);
      return hosts.size === 0
        ? []
        : [
            {
              table,
              id: row.finding_id as bigint,
              committed: row.commit_state === "committed",
              hosts,
            },
          ];
    });
  });
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

/** Code-unit (or numeric) order: the order every Sites keyset pages in. */
function compare<T extends string | bigint>(left: T, right: T): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A site-findings cursor key, `<artifact kind>:<finding id>`, or null. */
function findingPosition(
  key: string,
): { readonly kind: string; readonly id: bigint } | null {
  const match = /^([a-z_]+):([0-9]+)$/.exec(key);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { kind: match[1], id: BigInt(match[2]) };
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
      { findingId: row.finding_id.toString() },
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

/** The full stored rows behind one page, read only for that page. */
function storedRows(
  database: DatabaseSync,
  page: readonly HostRow[],
): Map<string, StoredRow> {
  const found = new Map<string, StoredRow>();
  for (const table of TABLES) {
    const ids = page.filter((row) => row.table === table).map((row) => row.id);
    if (ids.length === 0) continue;
    const rows = database
      .prepare(
        `SELECT finding_id, finding_kind, profile_path, commit_state, provenance_json, fields_json FROM ${table.table} WHERE finding_id IN (${ids.map(() => "?").join(", ")})`,
      )
      .all(...ids) as unknown as StoredRow[];
    for (const row of rows)
      found.set(`${table.artifactKind}:${String(row.finding_id)}`, row);
  }
  return found;
}

export function querySiteHosts(input: SiteHostQuery): SiteHostPage {
  const limit = normalizeLimit(input.limit, "Sites");
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;
  const database = openSitesCase(input.caseDirectory);
  try {
    const query = { search };
    const fingerprintValue = fingerprint(database, query);
    const after = cursor(input.after, fingerprintValue, "Sites");
    const zeroCounts = () =>
      Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])) as Record<
        SiteArtifactKind,
        number
      >;
    const grouped = new Map<
      string,
      {
        counts: Record<SiteArtifactKind, number>;
        savedCounts: Record<SiteArtifactKind, number>;
      }
    >();
    for (const row of hostRows(database)) {
      for (const host of row.hosts.keys()) {
        if (search !== null && !host.includes(search)) continue;
        const entry = grouped.get(host) ?? {
          counts: zeroCounts(),
          savedCounts: zeroCounts(),
        };
        entry.counts[row.table.artifactKind]++;
        if (row.committed) entry.savedCounts[row.table.artifactKind]++;
        grouped.set(host, entry);
      }
    }
    // Code-unit order, the same order the cursor's `host > after` filter
    // uses: a locale collation would page hosts out of order (and skip or
    // repeat some) whenever punctuation sorts differently.
    const all = [...grouped.entries()]
      .map(([host, entry]) => ({ host, ...entry }))
      .sort((a, b) => compare(a.host, b.host));
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
  const kinds = [...new Set(input.kinds ?? [])].sort();
  for (const kind of kinds) {
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Sites --kind has an unsupported value.",
        { value: kind, allowed: ARTIFACT_KINDS },
      );
    }
  }
  const profiles = resolveProfiles(input.profiles, "Sites");
  const commitState = resolveCommitState(input.commitState, "Sites");
  const database = openSitesCase(input.caseDirectory);
  try {
    const fingerprintValue = fingerprint(database, {
      host,
      kinds,
      profiles,
      commitState,
    });
    const after = cursor(input.after, fingerprintValue, "Sites");
    const position = after === null ? null : findingPosition(after);
    if (after !== null && position === null)
      throw new ForensixError(
        "INVALID_CURSOR",
        "Sites cursor does not belong to this query.",
      );
    // Keyset on (artifact kind, numeric finding id), the sort order itself:
    // comparing the joined key as a string would put id 10 before id 9.
    const filtered = hostRows(database, { kinds, profiles, commitState })
      .filter((row) => row.hosts.has(host))
      .filter(
        (row) =>
          position === null ||
          (compare(row.table.artifactKind, position.kind) ||
            compare(row.id, position.id)) > 0,
      )
      .sort(
        (a, b) =>
          compare(a.table.artifactKind, b.table.artifactKind) ||
          compare(a.id, b.id),
      );
    const page = filtered.slice(0, limit);
    const stored = storedRows(database, page);
    const items = page.map((row): Identified<SiteFinding> => {
      const key = `${row.table.artifactKind}:${String(row.id)}`;
      const full = stored.get(key);
      if (full === undefined)
        throw new ForensixError("CASE_INVALID", "Sites row is missing.", {
          key,
        });
      return {
        ...withRecordId(
          recordStoreForTable(row.table.table).key,
          row.id,
          parseFinding(full),
        ),
        artifactKind: row.table.artifactKind,
        hostFields: row.hosts.get(host) ?? [],
      };
    });
    const lastRow = page.at(-1);
    return {
      status: "ok",
      command: "site-findings",
      items,
      nextCursor:
        filtered.length > limit && lastRow !== undefined
          ? nextCursor(
              fingerprintValue,
              `${lastRow.table.artifactKind}:${String(lastRow.id)}`,
            )
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
