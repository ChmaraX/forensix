import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { CASE_FILENAME } from "./case.js";
import { ForensixError } from "./errors.js";
import { SQLITE_MAX_INTEGER, SQLITE_MIN_INTEGER } from "./forensic-time.js";
import {
  createCandidate,
  type Candidate,
  type CommitState,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";
import { TOPIC_CANDIDATE_KIND } from "./topic-candidates.js";

/**
 * Read-only query surface for topic Candidates.
 *
 * This is deliberately a separate surface from every Finding query. Candidates
 * are ranked hypotheses, not facts: the page carries `Candidate` records
 * (recordType `candidate`) and never `Finding` records, so no consumer of this
 * API can mistake a classifier output for a Finding or a factual summary tile.
 * The query mirrors the shared surface — TYPE-first (`candidateKind`), search,
 * Profile and Commit-State filters, deterministic sort, and keyset pagination.
 */

export type TopicCandidateDirection = "asc" | "desc";
export type TopicCandidateSort = "rank" | "supporting" | "label" | "profile";

export interface TopicCandidateQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  /** Filter to a single taxonomy label id (e.g. `finance_banking`). */
  readonly label?: string;
  readonly sort?: TopicCandidateSort;
  readonly direction?: TopicCandidateDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface TopicCandidatePage {
  readonly status: "ok";
  readonly command: "topic-candidates";
  readonly items: readonly Candidate[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly key: string;
  readonly candidateId: string;
}

interface QueryRow {
  readonly candidate_id: bigint;
  readonly candidate_kind: string;
  readonly rank: bigint;
  readonly supporting_count: bigint;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly cursor_key: string | bigint;
}

const DIRECTIONS = ["asc", "desc"] as const;
const SORTS = ["rank", "supporting", "label", "profile"] as const;
const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const;

interface SortDefinition {
  readonly expression: string;
  readonly kind: "text" | "integer";
}

const SORT_DEFINITIONS: Readonly<Record<TopicCandidateSort, SortDefinition>> = {
  rank: { expression: "c.rank", kind: "integer" },
  supporting: { expression: "c.supporting_count", kind: "integer" },
  label: { expression: "COALESCE(c.topic_label, '')", kind: "text" },
  profile: { expression: "c.profile_path", kind: "text" },
};

function queryFingerprint(input: {
  readonly caseId: string;
  readonly activeArtifactResultIds: readonly string[];
  readonly profiles: readonly string[];
  readonly search: string | null;
  readonly commitState: CommitState | null;
  readonly label: string | null;
  readonly sort: TopicCandidateSort;
  readonly direction: TopicCandidateDirection;
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
      "Topic Candidate cursor is not valid.",
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
    !("candidateId" in parsed) ||
    typeof parsed.candidateId !== "string" ||
    !/^[0-9]+$/.test(parsed.candidateId)
  ) {
    throw new ForensixError(
      "INVALID_CURSOR",
      "Topic Candidate cursor does not belong to this query.",
    );
  }
  return parsed as CursorPayload;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Topic Candidate --limit must be an integer from 1 through 100.",
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
      `Topic Candidate ${name} has an unsupported value.`,
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

function candidateSchemaExists(database: DatabaseSync): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'forensic_candidates'",
      )
      .get() !== undefined
  );
}

function parseCandidate(row: QueryRow): Candidate {
  let provenance: Provenance;
  let fields: ForensicFields;
  try {
    provenance = JSON.parse(row.provenance_json) as Provenance;
    fields = JSON.parse(row.fields_json) as ForensicFields;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Candidate JSON.",
      { candidate_id: row.candidate_id.toString() },
      { cause: error },
    );
  }
  return createCandidate({
    candidateKind: row.candidate_kind,
    rank: Number(row.rank),
    count: Number(row.supporting_count),
    provenance,
    fields,
  });
}

export function queryTopicCandidates(
  input: TopicCandidateQuery,
): TopicCandidatePage {
  const direction = enumValue(
    input.direction,
    "asc",
    DIRECTIONS,
    "--direction",
  );
  const sort = enumValue(input.sort, "rank", SORTS, "--sort");
  const commitState =
    input.commitState === undefined
      ? null
      : enumValue(
          input.commitState,
          "committed",
          COMMIT_STATES,
          "--commit-state",
        );
  const sortDefinition = SORT_DEFINITIONS[sort];
  const sortExpression = sortDefinition.expression;
  const limit = normalizeLimit(input.limit);
  const profiles = [...new Set(input.profiles ?? [])].sort();
  if (profiles.length > 100) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Topic Candidate queries accept at most 100 Profile filters.",
      { profile_count: profiles.length },
    );
  }
  const label = input.label ?? null;
  const search = input.search?.toLocaleLowerCase("en-US") ?? null;

  const database = openCase(input.caseDirectory);
  try {
    if (!candidateSchemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no analysis. Run analyse first.",
      );
    }
    const identity = activeAnalysisIdentity(database);
    const fingerprint = queryFingerprint({
      caseId: identity.caseId,
      activeArtifactResultIds: identity.artifactResultIds,
      profiles,
      search,
      commitState,
      label,
      sort,
      direction,
    });
    const cursor =
      input.after === undefined ? null : decodeCursor(input.after, fingerprint);

    const conditions = [
      "r.active = 1",
      "c.candidate_kind = ?",
      "c.record_type = 'candidate'",
    ];
    const parameters: (string | bigint)[] = [TOPIC_CANDIDATE_KIND];
    if (profiles.length > 0) {
      conditions.push(
        `c.profile_path IN (${profiles.map(() => "?").join(", ")})`,
      );
      parameters.push(...profiles);
    }
    if (commitState !== null) {
      conditions.push("c.commit_state = ?");
      parameters.push(commitState);
    }
    if (label !== null) {
      conditions.push("c.topic_label = ?");
      parameters.push(label);
    }
    if (search !== null) {
      conditions.push("instr(c.search_text, ?) > 0");
      parameters.push(search);
    }
    if (cursor !== null) {
      const operator = direction === "asc" ? ">" : "<";
      conditions.push(
        `(${sortExpression} ${operator} ? OR ` +
          `(${sortExpression} = ? AND c.candidate_id ${operator} ?))`,
      );
      const candidateId = BigInt(cursor.candidateId);
      const integerCursorKey =
        sortDefinition.kind === "integer" && /^-?[0-9]+$/.test(cursor.key)
          ? BigInt(cursor.key)
          : null;
      if (
        candidateId > SQLITE_MAX_INTEGER ||
        (sortDefinition.kind === "integer" &&
          (integerCursorKey === null ||
            integerCursorKey < SQLITE_MIN_INTEGER ||
            integerCursorKey > SQLITE_MAX_INTEGER))
      ) {
        throw new ForensixError(
          "INVALID_CURSOR",
          "Topic Candidate cursor contains an invalid sort key.",
        );
      }
      const cursorKey =
        sortDefinition.kind === "integer"
          ? (integerCursorKey as bigint)
          : cursor.key;
      parameters.push(cursorKey, cursorKey, candidateId);
    }

    parameters.push(BigInt(limit + 1));
    const sqlDirection = direction === "asc" ? "ASC" : "DESC";
    const rows = database
      .prepare(
        `SELECT c.candidate_id, c.candidate_kind, c.rank, c.supporting_count,
                c.provenance_json, c.fields_json,
                ${sortExpression} AS cursor_key
           FROM forensic_candidates c
           JOIN history_artifact_results r
             ON r.artifact_result_id = c.artifact_result_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${sortExpression} ${sqlDirection},
                   c.candidate_id ${sqlDirection}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as QueryRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      status: "ok",
      command: "topic-candidates",
      items: pageRows.map(parseCandidate),
      nextCursor:
        hasNext && last !== undefined
          ? encodeCursor({
              version: 1,
              fingerprint,
              key: last.cursor_key.toString(),
              candidateId: last.candidate_id.toString(),
            })
          : null,
      limit,
    };
  } finally {
    database.close();
  }
}
