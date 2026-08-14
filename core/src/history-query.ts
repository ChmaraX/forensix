import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  createFinding,
  type CommitState,
  type Finding,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";

export type HistoryView = "visits" | "activity" | "most-visited" | "durations";
export type HistoryDirection = "asc" | "desc";
export type HistorySort =
  | "visit-time"
  | "local-time"
  | "url"
  | "duration"
  | "visit-count"
  | "profile";

export interface HistoryQuery {
  readonly caseDirectory: string;
  readonly view?: HistoryView;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly transition?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: HistorySort;
  readonly direction?: HistoryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface HistoryPage {
  readonly status: "ok";
  readonly command: "history";
  readonly view: HistoryView;
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly key: string;
  readonly findingId: string;
}

interface QueryRow {
  readonly finding_id: bigint;
  readonly finding_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string | bigint;
}

interface SortDefinition {
  readonly expression: string;
  readonly kind: "text" | "integer";
}

const HISTORY_VIEWS = [
  "visits",
  "activity",
  "most-visited",
  "durations",
] as const;
const HISTORY_DIRECTIONS = ["asc", "desc"] as const;
const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const;
const VIEW_KINDS: Readonly<Record<HistoryView, string>> = {
  visits: "history_visit",
  activity: "history_activity_summary",
  "most-visited": "history_most_visited_summary",
  durations: "history_duration_summary",
};

const SORTS: Readonly<Record<HistorySort, SortDefinition>> = {
  "visit-time": { expression: "COALESCE(f.sort_time, '')", kind: "text" },
  "local-time": { expression: "COALESCE(f.sort_time, '')", kind: "text" },
  url: { expression: "COALESCE(f.sort_url, '')", kind: "text" },
  duration: { expression: "COALESCE(f.sort_duration, -1)", kind: "integer" },
  "visit-count": {
    expression: "COALESCE(f.sort_count, -1)",
    kind: "integer",
  },
  profile: { expression: "f.profile_path", kind: "text" },
};

const VIEW_SORTS: Readonly<Record<HistoryView, readonly HistorySort[]>> = {
  visits: ["visit-time", "url", "duration", "profile"],
  activity: ["local-time", "visit-count", "duration", "profile"],
  "most-visited": ["visit-count", "url", "profile"],
  durations: ["duration", "visit-count", "url", "profile"],
};

const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;

const DEFAULT_SORT: Readonly<Record<HistoryView, HistorySort>> = {
  visits: "visit-time",
  activity: "local-time",
  "most-visited": "visit-count",
  durations: "duration",
};

function queryFingerprint(input: {
  readonly caseId: string;
  readonly activeArtifactResultIds: readonly string[];
  readonly view: HistoryView;
  readonly profiles: readonly string[];
  readonly search: string | null;
  readonly commitState: CommitState | null;
  readonly transition: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: HistorySort;
  readonly direction: HistoryDirection;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  value: string,
  expectedFingerprint: string,
): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "History cursor is not valid.",
      {},
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("fingerprint" in parsed) ||
    parsed.fingerprint !== expectedFingerprint ||
    !("key" in parsed) ||
    typeof parsed.key !== "string" ||
    !("findingId" in parsed) ||
    typeof parsed.findingId !== "string" ||
    !/^[0-9]+$/.test(parsed.findingId)
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "History cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "History --limit must be an integer from 1 through 100.",
      { limit },
    );
  }
  return limit;
}

function normalizeInstant(
  value: string | undefined,
  option: string,
): string | null {
  if (value === undefined) {
    return null;
  }
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
      `History ${option} must be an ISO 8601 instant with an offset.`,
      { value },
    );
  }
  const fraction = (match[7] ?? "").padEnd(6, "0");
  const milliseconds = date.toISOString();
  return `${milliseconds.slice(0, -5)}.${milliseconds.slice(-4, -1)}${fraction.slice(3)}Z`;
}

function enumValue<const Values extends readonly string[]>(
  value: string | undefined,
  fallback: Values[number],
  values: Values,
  name: string,
): Values[number] {
  const result = value ?? fallback;
  if (!values.includes(result)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `History ${name} has an unsupported value.`,
      { value: result, allowed: values },
    );
  }
  return result;
}

function activeAnalysisIdentity(database: DatabaseSync): {
  readonly caseId: string;
  readonly artifactResultIds: readonly string[];
} {
  const caseRow = database
    .prepare("SELECT case_id FROM case_info LIMIT 1")
    .get();
  if (typeof caseRow?.case_id !== "string") {
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  }
  const resultRows = database
    .prepare(
      `SELECT artifact_result_id
         FROM history_artifact_results
        WHERE active = 1
        ORDER BY artifact_result_id`,
    )
    .all();
  return {
    caseId: caseRow.case_id,
    artifactResultIds: resultRows.map((row) => String(row.artifact_result_id)),
  };
}

function openCase(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(resolve(caseDirectory), CASE_FILENAME));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href, { readOnly: true, readBigInts: true });
}

function findingSchemaExists(database: DatabaseSync): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'forensic_findings'",
      )
      .get() !== undefined
  );
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

export function queryHistory(input: HistoryQuery): HistoryPage {
  const view = enumValue(input.view, "visits", HISTORY_VIEWS, "--view");
  const direction = enumValue(
    input.direction,
    "desc",
    HISTORY_DIRECTIONS,
    "--direction",
  );
  const sort = input.sort ?? DEFAULT_SORT[view];
  if (!(sort in SORTS) || !VIEW_SORTS[view].includes(sort)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `History sort ${sort} is not available for ${view}.`,
      { view, sort, allowed: VIEW_SORTS[view] },
    );
  }
  const commitState =
    input.commitState === undefined
      ? null
      : enumValue(
          input.commitState,
          "committed",
          COMMIT_STATES,
          "--commit-state",
        );
  const sortDefinition = SORTS[sort];
  const limit = normalizeLimit(input.limit);
  const profiles = [...new Set(input.profiles ?? [])].sort();
  if (profiles.length > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "History queries accept at most 100 Profile filters.",
      { profile_count: profiles.length },
    );
  }
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;
  const transition = input.transition?.toLocaleLowerCase("en-US") ?? null;
  const from = normalizeInstant(input.from, "--from");
  const to = normalizeInstant(input.to, "--to");
  if (view !== "visits" && (from !== null || to !== null)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "History time bounds apply only to the visits view.",
      { view },
    );
  }
  if (view !== "visits" && transition !== null) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "History transition filters apply only to the visits view.",
      { view },
    );
  }
  if (from !== null && to !== null && from > to) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "History --from must not be later than --to.",
    );
  }

  const database = openCase(input.caseDirectory);
  try {
    if (!findingSchemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no History analysis. Run analyse first.",
      );
    }
    const identity = activeAnalysisIdentity(database);
    const fingerprint = queryFingerprint({
      caseId: identity.caseId,
      activeArtifactResultIds: identity.artifactResultIds,
      view,
      profiles,
      search,
      commitState,
      transition,
      from,
      to,
      sort,
      direction,
    });
    const cursor =
      input.after === undefined ? null : decodeCursor(input.after, fingerprint);

    const conditions = [
      "r.active = 1",
      "f.finding_kind = ?",
      "f.record_type = 'finding'",
    ];
    const parameters: (string | bigint)[] = [VIEW_KINDS[view]];
    if (profiles.length > 0) {
      conditions.push(
        `f.profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (commitState !== null) {
      conditions.push("f.commit_state = ?");
      parameters.push(commitState);
    }
    if (search !== null) {
      conditions.push("instr(f.search_text, ?) > 0");
      parameters.push(search);
    }
    if (transition !== null) {
      conditions.push("f.transition_core = ?");
      parameters.push(transition);
    }
    if (from !== null) {
      conditions.push("f.sort_time >= ?");
      parameters.push(from);
    }
    if (to !== null) {
      conditions.push("f.sort_time <= ?");
      parameters.push(to);
    }
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortDefinition.expression} ${operator} ? OR ` +
          `(${sortDefinition.expression} = ? AND f.finding_id ${operator} ?))`,
      );
      const findingId = BigInt(cursor.findingId);
      const integerCursorKey =
        sortDefinition.kind === "integer" && /^-?[0-9]+$/.test(cursor.key)
          ? BigInt(cursor.key)
          : null;
      if (
        findingId > SQLITE_MAX_INTEGER ||
        (sortDefinition.kind === "integer" &&
          (integerCursorKey === null ||
            integerCursorKey < SQLITE_MIN_INTEGER ||
            integerCursorKey > SQLITE_MAX_INTEGER))
      ) {
        throw new ForensixError(
          "INVALID_CURSOR",
          "History cursor contains an invalid sort key.",
        );
      }
      const cursorKey =
        sortDefinition.kind === "integer"
          ? (integerCursorKey as bigint)
          : cursor.key;
      parameters.push(cursorKey, cursorKey, findingId);
    }

    parameters.push(BigInt(limit + 1));
    const sqlDirection = direction === "asc" ? "ASC" : "DESC";
    const rows = database
      .prepare(
        `SELECT f.finding_id, f.finding_kind, f.profile_path,
                f.commit_state, f.provenance_json, f.fields_json,
                ${sortDefinition.expression} AS cursor_key
           FROM forensic_findings f
           JOIN history_artifact_results r
             ON r.artifact_result_id = f.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortDefinition.expression} ${sqlDirection},
                   f.finding_id ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "history",
      view,
      items: pageRows.map(parseFinding),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              version: 1,
              fingerprint,
              key: last.cursor_key.toString(),
              findingId: last.finding_id.toString(),
            })
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
