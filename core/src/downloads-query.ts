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

export type DownloadSort =
  | "start-time"
  | "end-time"
  | "target-path"
  | "state"
  | "total-bytes"
  | "profile";
export type DownloadDirection = "asc" | "desc";

export interface DownloadQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly state?: string;
  readonly dangerType?: string;
  readonly sort?: DownloadSort;
  readonly direction?: DownloadDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface DownloadPage {
  readonly status: "ok";
  readonly command: "downloads";
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

const DOWNLOAD_SORTS = [
  "start-time",
  "end-time",
  "target-path",
  "state",
  "total-bytes",
  "profile",
] as const;
const DOWNLOAD_DIRECTIONS = ["asc", "desc"] as const;
const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const;
const DOWNLOAD_KIND = "download";

const SORTS: Readonly<Record<DownloadSort, SortDefinition>> = {
  "start-time": { expression: "COALESCE(f.sort_start, '')", kind: "text" },
  "end-time": { expression: "COALESCE(f.sort_end, '')", kind: "text" },
  "target-path": { expression: "COALESCE(f.sort_target, '')", kind: "text" },
  state: { expression: "COALESCE(f.sort_state, '')", kind: "text" },
  "total-bytes": { expression: "COALESCE(f.sort_bytes, -1)", kind: "integer" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807n;
const SQLITE_MIN_INTEGER = -9_223_372_036_854_775_808n;

function queryFingerprint(input: {
  readonly caseId: string;
  readonly activeArtifactResultIds: readonly string[];
  readonly profiles: readonly string[];
  readonly search: string | null;
  readonly commitState: CommitState | null;
  readonly state: string | null;
  readonly dangerType: string | null;
  readonly sort: DownloadSort;
  readonly direction: DownloadDirection;
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
      "Downloads cursor is not valid.",
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
      "Downloads cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Downloads --limit must be an integer from 1 through 100.",
      { limit },
    );
  }
  return limit;
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
      `Downloads ${name} has an unsupported value.`,
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
         FROM downloads_artifact_results
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
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'downloads_findings'",
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
      "Case contains invalid Downloads Finding JSON.",
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

export function queryDownloads(input: DownloadQuery): DownloadPage {
  const direction = enumValue(
    input.direction,
    "desc",
    DOWNLOAD_DIRECTIONS,
    "--direction",
  );
  const sort = enumValue(input.sort, "start-time", DOWNLOAD_SORTS, "--sort");
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
      "Downloads queries accept at most 100 Profile filters.",
      { profile_count: profiles.length },
    );
  }
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;
  const state = input.state?.toLocaleLowerCase("en-US") ?? null;
  const dangerType = input.dangerType?.toLocaleLowerCase("en-US") ?? null;

  const database = openCase(input.caseDirectory);
  try {
    if (!findingSchemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no Downloads analysis. Run analyse first.",
      );
    }
    const identity = activeAnalysisIdentity(database);
    const fingerprint = queryFingerprint({
      caseId: identity.caseId,
      activeArtifactResultIds: identity.artifactResultIds,
      profiles,
      search,
      commitState,
      state,
      dangerType,
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
    const parameters: (string | bigint)[] = [DOWNLOAD_KIND];
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
    if (state !== null) {
      conditions.push("f.sort_state = ?");
      parameters.push(state);
    }
    if (dangerType !== null) {
      conditions.push("f.danger_type = ?");
      parameters.push(dangerType);
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
          "Downloads cursor contains an invalid sort key.",
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
           FROM downloads_findings f
           JOIN downloads_artifact_results r
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
      command: "downloads",
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
