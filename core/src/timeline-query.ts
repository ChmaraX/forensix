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

export type TimelineDirection = "asc" | "desc";

export interface TimelineQuery {
  readonly caseDirectory: string;
  readonly limit?: number;
  readonly after?: string;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: TimelineDirection;
}

export interface TimelinePage {
  readonly status: "ok";
  readonly command: "timeline";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly key: string;
  readonly findingId: string;
  readonly findingKind: string;
}

interface QueryRow {
  readonly finding_id: bigint;
  readonly finding_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string;
}

const DIRECTIONS = ["asc", "desc"] as const;

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Timeline --limit must be an integer from 1 through 100.",
      { limit },
    );
  }
  return limit;
}

function normalizeInstant(
  value: string | undefined,
  option: string,
): string | null {
  if (value === undefined) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  const date = new Date(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    match === null ||
    Number.isNaN(date.getTime()) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Timeline ${option} must be an ISO 8601 instant with an offset.`,
      { value },
    );
  }
  const fraction = (match[7] ?? "").padEnd(6, "0");
  const milliseconds = date.toISOString();
  return `${milliseconds.slice(0, -5)}.${milliseconds.slice(-4, -1)}${fraction.slice(3)}Z`;
}

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function decodeCursor(value: string, fingerprint: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Timeline cursor is not valid.",
      {},
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !(
      "version" in parsed &&
      parsed.version === 1 &&
      "fingerprint" in parsed &&
      parsed.fingerprint === fingerprint &&
      "key" in parsed &&
      typeof parsed.key === "string" &&
      "findingId" in parsed &&
      typeof parsed.findingId === "string" &&
      /^[0-9]+$/.test(parsed.findingId) &&
      "findingKind" in parsed &&
      typeof parsed.findingKind === "string"
    )
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Timeline cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function parseFinding(row: QueryRow): Finding {
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
  if (
    row.commit_state !== "committed" &&
    row.commit_state !== "wal_resident" &&
    row.commit_state !== "journal_resident"
  ) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains an invalid Commit State.",
      { finding_id: row.finding_id.toString() },
    );
  }
  return createFinding({
    findingKind: row.finding_kind,
    profile: row.profile_path,
    commitState: row.commit_state,
    provenance,
    fields,
  });
}

/** Merges only recorded timestamps; it does not infer events or alter Findings. */
export function queryTimeline(input: TimelineQuery): TimelinePage {
  const direction = input.direction ?? "desc";
  if (!DIRECTIONS.includes(direction)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Timeline --direction has an unsupported value.",
      { value: direction, allowed: DIRECTIONS },
    );
  }
  const limit = normalizeLimit(input.limit);
  const from = normalizeInstant(input.from, "--from");
  const to = normalizeInstant(input.to, "--to");
  if (from !== null && to !== null && from > to)
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Timeline --from must not be later than --to.",
    );

  const database = openCase(input.caseDirectory);
  try {
    const requiredTables = [
      "forensic_findings",
      "downloads_findings",
      "cookie_findings",
      "web_data_findings",
    ];
    for (const table of requiredTables) {
      if (
        database
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?",
          )
          .get(table) === undefined
      ) {
        throw new ForensixError(
          "ANALYSIS_NOT_FOUND",
          "Case has no Timeline analysis. Run analyse first.",
        );
      }
    }
    const caseRow = database
      .prepare("SELECT case_id FROM case_info LIMIT 1")
      .get();
    if (typeof caseRow?.case_id !== "string")
      throw new ForensixError("CASE_INVALID", "Case identity is missing.");
    const results = database
      .prepare(
        `SELECT artifact_result_id FROM history_artifact_results WHERE active = 1
      UNION ALL SELECT artifact_result_id FROM downloads_artifact_results WHERE active = 1
      UNION ALL SELECT artifact_result_id FROM cookie_artifact_results WHERE active = 1
      UNION ALL SELECT artifact_result_id FROM web_data_artifact_results WHERE active = 1
      ORDER BY artifact_result_id`,
      )
      .all()
      .map((row) => String(row.artifact_result_id));
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          caseId: caseRow.case_id,
          activeArtifactResultIds: results,
          from,
          to,
          direction,
        }),
      )
      .digest("hex");
    const cursor =
      input.after === undefined ? null : decodeCursor(input.after, fingerprint);
    const branches = [
      "SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state, f.provenance_json, f.fields_json, f.sort_time AS cursor_key FROM forensic_findings f JOIN history_artifact_results r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.finding_kind = 'history_visit' AND f.sort_time IS NOT NULL",
      "SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state, f.provenance_json, f.fields_json, f.sort_start AS cursor_key FROM downloads_findings f JOIN downloads_artifact_results r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.sort_start IS NOT NULL",
      "SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state, f.provenance_json, f.fields_json, f.sort_creation AS cursor_key FROM cookie_findings f JOIN cookie_artifact_results r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.sort_creation IS NOT NULL",
      "SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state, f.provenance_json, f.fields_json, f.sort_last_used AS cursor_key FROM web_data_findings f JOIN web_data_artifact_results r ON r.artifact_result_id = f.artifact_result_id WHERE r.active = 1 AND f.record_type = 'finding' AND f.finding_kind = 'autofill_entry' AND f.sort_last_used IS NOT NULL",
    ];
    const conditions: string[] = [];
    const parameters: (string | bigint)[] = [];
    if (from !== null) {
      conditions.push("cursor_key >= ?");
      parameters.push(from);
    }
    if (to !== null) {
      conditions.push("cursor_key <= ?");
      parameters.push(to);
    }
    const order = direction === "asc" ? "ASC" : "DESC";
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(cursor_key ${operator} ? OR (cursor_key = ? AND (finding_kind ${operator} ? OR (finding_kind = ? AND finding_id ${operator} ?))))`,
      );
      parameters.push(
        cursor.key,
        cursor.key,
        cursor.findingKind,
        cursor.findingKind,
        BigInt(cursor.findingId),
      );
    }
    parameters.push(BigInt(limit + 1));
    const rows = database
      .prepare(
        `SELECT * FROM (${branches.join(" UNION ALL ")}) WHERE ${conditions.length === 0 ? "1 = 1" : conditions.join(" AND ")} ORDER BY cursor_key ${order}, finding_kind ${order}, finding_id ${order} LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "timeline",
      items: pageRows.map(parseFinding),
      nextCursor:
        hasNext && last !== undefined
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                fingerprint,
                key: last.cursor_key,
                findingId: last.finding_id.toString(),
                findingKind: last.finding_kind,
              }),
              "utf8",
            ).toString("base64url")
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
