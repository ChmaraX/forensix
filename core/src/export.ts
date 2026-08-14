import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  CASE_FILENAME,
  TOOL_VERSION,
  loadCaseSources,
  type CaseSourceRecord,
} from "./case.js";
import { ForensixError } from "./errors.js";
import type {
  CommitState,
  FieldState,
  ForensicFields,
  Provenance,
} from "./forensic-model.js";

/**
 * The Extract is a scoped, deterministic, citable read over the Case. It never
 * becomes a second record of truth: every row is copied from Findings and
 * Candidates already recorded by an Analysis Run, and the Export Manifest binds
 * the emitted files to an independently reproducible digest.
 */
export const EXTRACT_SCHEMA = "forensix/extract/1" as const;
export const REDACTION_POLICY = "forensix/redaction/1" as const;

export type ExtractCollection = "findings" | "candidates";

/**
 * Field names whose value is treated as a plaintext secret. Such values are
 * withheld by default and only disclosed with an explicit opt-in. The match is
 * a case-insensitive substring so `password_value`, `encrypted_value`, and
 * similar names are covered without an exhaustive list.
 */
const SECRET_FIELD_PATTERNS = [
  "password",
  "passphrase",
  "secret",
  "token",
  "credential",
  "cookie_value",
  "encrypted_value",
  "private_key",
] as const;

/**
 * Field names that are secrets by exact match rather than substring. The Cookie
 * Finding's decrypted plaintext lives in a field named exactly `value`; it must
 * be withheld by default without over-matching metadata fields such as
 * `encryptedValueByteLength`.
 */
const SECRET_FIELD_EXACT = new Set(["value"]);

export interface ExportCaseOptions {
  readonly caseDirectory: string;
  readonly outDirectory: string;
  readonly examiner?: string;
  readonly profiles?: readonly string[];
  readonly commitState?: CommitState;
  readonly collections?: readonly ExtractCollection[];
  readonly csv?: boolean;
  readonly includeSecrets?: boolean;
  /**
   * The single quarantined generation instant. It is injectable so tests can
   * assert byte-identical exports; it defaults to the current time.
   */
  readonly generatedAt?: string;
}

export interface ExtractRedactionState {
  readonly policy: typeof REDACTION_POLICY;
  readonly state: "redacted" | "disclosed";
  readonly plaintextSecretsIncluded: boolean;
  readonly redactedFieldCount: number;
  readonly binaryPayloadCount: number;
}

export interface ExtractCompletenessArtifact {
  readonly sourceId: string;
  readonly profile: string;
  readonly artifact: "History";
  readonly databasePath: string;
  readonly outcome: "produced" | "absent" | "unavailable";
  readonly reason: string | null;
  readonly runId: string;
}

export interface ExtractCompletenessStatement {
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly artifacts: readonly ExtractCompletenessArtifact[];
}

export interface ExtractManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ExtractManifest {
  readonly extract_schema: typeof EXTRACT_SCHEMA;
  readonly files: readonly ExtractManifestFile[];
  readonly quarantinedGenerationFile: string;
  readonly derivedDigest: string;
}

export interface ExportCaseResult {
  readonly status: "ok";
  readonly command: "export";
  readonly extractKind: "history";
  readonly outDirectory: string;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly csv: boolean;
  readonly redaction: ExtractRedactionState;
  readonly completeness: ExtractCompletenessStatement;
  readonly derivedDigest: string;
  readonly generatedAt: string;
  readonly files: readonly string[];
}

/**
 * The canonical Extract file layout. This is the single source of truth for
 * the filenames the export produces and the report consumes, so a rename can
 * never silently desynchronize the producer from the verifier.
 */
export const EXTRACT_FILES = {
  header: "export_header.json",
  findingsJsonl: "findings.jsonl",
  candidatesJsonl: "candidates.jsonl",
  findingsCsv: "findings.lossy.csv",
  candidatesCsv: "candidates.lossy.csv",
  manifest: "export_manifest.json",
  generation: "export_generation.json",
} as const;

const HEADER_FILE = EXTRACT_FILES.header;
const FINDINGS_JSONL = EXTRACT_FILES.findingsJsonl;
const CANDIDATES_JSONL = EXTRACT_FILES.candidatesJsonl;
const FINDINGS_CSV = EXTRACT_FILES.findingsCsv;
const CANDIDATES_CSV = EXTRACT_FILES.candidatesCsv;
const MANIFEST_FILE = EXTRACT_FILES.manifest;
const GENERATION_FILE = EXTRACT_FILES.generation;

interface FindingRow {
  readonly finding_id: bigint;
  readonly finding_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly source_id: string;
  readonly run_id: string;
  readonly artifact_result_id: bigint;
}

interface CandidateRow {
  readonly candidate_id: bigint;
  readonly candidate_kind: string;
  readonly profile_path: string;
  readonly commit_state: string;
  readonly rank: bigint;
  readonly supporting_count: bigint;
  readonly provenance_json: string;
  readonly fields_json: string;
  readonly source_id: string;
  readonly run_id: string;
  readonly artifact_result_id: bigint;
}

interface ArtifactResultRow {
  readonly source_id: string;
  readonly profile_path: string;
  readonly database_path: string;
  readonly status: string;
  readonly reason: string | null;
  readonly run_id: string;
  readonly artifact_result_id: bigint;
  readonly started_at: string;
}

interface RunRow {
  readonly run_id: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly tool_version: string;
  readonly invocation_json: string;
  readonly declared_timezone: string;
  readonly declared_origin_os: string | null;
  readonly status: string;
}

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Order object keys so repeated exports of the same Case are byte-identical.
 * Every emitted JSON document flows through this function.
 */
function canonicalize(value: unknown): CanonicalValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value as CanonicalValue;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The single source of truth for the Extract derived digest. Both the export
 * (producer) and the report (verifier) hash the manifest file list through this
 * function, so the verifier can never drift from the producer's canonical key
 * ordering or path sort. The sort is applied here (not assumed of the caller)
 * so an unsorted manifest still hashes deterministically.
 */
export function computeDerivedDigest(
  files: readonly ExtractManifestFile[],
): string {
  const sorted = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  return sha256(Buffer.from(canonicalJson(sorted), "utf8"));
}

export function isSecretFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SECRET_FIELD_EXACT.has(lower) ||
    SECRET_FIELD_PATTERNS.some((pattern) => lower.includes(pattern))
  );
}

export interface RedactedField {
  readonly state: "redacted";
  readonly reason: "plaintext_secret_withheld";
  readonly sha256: string;
}

/**
 * Replace every plaintext-secret value with a typed, hashed marker unless
 * secrets were explicitly opted in. The hash keeps the withheld value citable
 * without disclosing it, and non-secret Field State is preserved unchanged.
 */
export function redactFields(
  fields: ForensicFields,
  includeSecrets: boolean,
): {
  readonly fields: Readonly<
    Record<string, FieldState<unknown> | RedactedField>
  >;
  readonly redactedCount: number;
} {
  if (includeSecrets) {
    return { fields, redactedCount: 0 };
  }
  let redactedCount = 0;
  const result: Record<string, FieldState<unknown> | RedactedField> = {};
  for (const [name, state] of Object.entries(fields)) {
    if (isSecretFieldName(name) && state.state === "value") {
      result[name] = {
        state: "redacted",
        reason: "plaintext_secret_withheld",
        sha256: sha256(Buffer.from(canonicalJson(state.value), "utf8")),
      };
      redactedCount += 1;
    } else {
      result[name] = state;
    }
  }
  return { fields: result, redactedCount };
}

function parseJsonColumn<T>(value: string, findingId: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Extract row JSON.",
      { record_id: findingId },
      { cause: error },
    );
  }
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

function profileFilter(
  profiles: readonly string[],
  parameters: string[],
): string {
  if (profiles.length === 0) {
    return "";
  }
  parameters.push(...profiles);
  return ` AND f.profile_path IN (${profiles.map(() => "?").join(", ")})`;
}

function resolveOutDirectory(
  caseDirectory: string,
  outDirectory: string,
): string {
  const resolvedCase = resolve(caseDirectory);
  const resolvedOut = resolve(outDirectory);
  const difference = relative(resolvedCase, resolvedOut);
  if (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "The Extract output directory must be outside the Case Directory.",
      { out_directory: resolvedOut, case_directory: resolvedCase },
    );
  }
  return resolvedOut;
}

async function assertEmptyOutDirectory(outDirectory: string): Promise<void> {
  await mkdir(outDirectory, { recursive: true });
  const existing = await readdir(outDirectory);
  if (existing.length > 0) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "The Extract output directory is not empty.",
      { out_directory: outDirectory },
    );
  }
}

function loadCaseInfo(database: DatabaseSync): {
  readonly caseId: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly toolVersion: string;
} {
  const row = database
    .prepare(
      "SELECT case_id, schema_version, created_at, tool_version FROM case_info LIMIT 1",
    )
    .get() as
    | {
        readonly case_id: string;
        readonly schema_version: bigint;
        readonly created_at: string;
        readonly tool_version: string;
      }
    | undefined;
  if (row === undefined) {
    throw new ForensixError("CASE_INVALID", "Case identity is missing.");
  }
  return {
    caseId: row.case_id,
    schemaVersion: Number(row.schema_version),
    createdAt: row.created_at,
    toolVersion: row.tool_version,
  };
}

/**
 * Reduce the retained artifact-result lineage to the current outcome per
 * (Source, Profile, artifact) by keeping the most recent Analysis Run. This is
 * what the Completeness Statement reports before any result row is read.
 */
function buildCompleteness(
  database: DatabaseSync,
): ExtractCompletenessStatement {
  const rows = database
    .prepare(
      `SELECT r.source_id, r.profile_path, r.database_path, r.status,
              r.reason, r.run_id, r.artifact_result_id, a.started_at
         FROM history_artifact_results r
         JOIN analysis_runs a ON a.run_id = r.run_id
        ORDER BY r.source_id, r.profile_path`,
    )
    .all() as unknown as ArtifactResultRow[];
  const latest = new Map<string, ArtifactResultRow>();
  for (const row of rows) {
    const key = `${row.source_id}\u0000${row.profile_path}`;
    const current = latest.get(key);
    if (
      current === undefined ||
      row.started_at > current.started_at ||
      (row.started_at === current.started_at &&
        row.artifact_result_id > current.artifact_result_id)
    ) {
      latest.set(key, row);
    }
  }
  const artifacts = [...latest.values()]
    .map((row): ExtractCompletenessArtifact => {
      const outcome =
        row.status === "complete"
          ? "produced"
          : row.status === "absent"
            ? "absent"
            : "unavailable";
      return {
        sourceId: row.source_id,
        profile: row.profile_path,
        artifact: "History",
        databasePath: row.database_path,
        outcome,
        reason: row.reason,
        runId: row.run_id,
      };
    })
    .sort((left, right) =>
      left.sourceId === right.sourceId
        ? left.profile.localeCompare(right.profile)
        : left.sourceId.localeCompare(right.sourceId),
    );
  return {
    attempted: artifacts.length,
    produced: artifacts.filter((row) => row.outcome === "produced").length,
    absent: artifacts.filter((row) => row.outcome === "absent").length,
    unavailable: artifacts.filter((row) => row.outcome === "unavailable")
      .length,
    artifacts,
  };
}

function loadActiveRuns(database: DatabaseSync): readonly RunRow[] {
  return database
    .prepare(
      `SELECT DISTINCT a.run_id, a.started_at, a.finished_at, a.tool_version,
              a.invocation_json, a.declared_timezone, a.declared_origin_os,
              a.status
         FROM analysis_runs a
         JOIN history_artifact_results r ON r.run_id = a.run_id
        WHERE r.active = 1
        ORDER BY a.started_at, a.run_id`,
    )
    .all() as unknown as RunRow[];
}

function commonField<T>(
  values: readonly T[],
  emptyReason: string,
  conflictReason: string,
): { readonly state: "value"; readonly value: T } | UnavailableStatement {
  const distinct = [...new Set(values.map((value) => JSON.stringify(value)))];
  if (values.length === 0) {
    return { state: "unavailable", reason: emptyReason };
  }
  if (distinct.length > 1) {
    return { state: "unavailable", reason: conflictReason };
  }
  return { state: "value", value: values[0] as T };
}

interface UnavailableStatement {
  readonly state: "unavailable";
  readonly reason: string;
}

function sourceHeader(source: CaseSourceRecord): CanonicalValue {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourcePath: source.sourcePath,
    sourceOriginPath: source.sourceOriginPath,
    manifestId: source.manifestId,
    manifestPath: source.manifestPath,
    evidenceSetDigest: source.evidenceSetDigest,
    workingCopyDigest: source.workingCopyDigest,
  };
}

function runHeader(run: RunRow): CanonicalValue {
  return {
    runId: run.run_id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
    toolVersion: run.tool_version,
    declaredTimezone: run.declared_timezone,
    declaredOriginOs: run.declared_origin_os,
    invocation: parseJsonColumn<readonly string[]>(
      run.invocation_json,
      run.run_id,
    ),
  };
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render a Field State as a single lossy CSV cell. Structure, provenance, and
 * non-value Field State collapse to typed markers, which is why the CSV profile
 * is explicitly lossy and never authoritative.
 */
function csvFieldCell(state: FieldState<unknown> | RedactedField): string {
  if (state.state === "absent") {
    return "[absent]";
  }
  if (state.state === "unavailable") {
    return `[unavailable:${state.reason}]`;
  }
  if (state.state === "redacted") {
    return `[redacted:${state.reason}]`;
  }
  const value = state.value;
  if (value === null) {
    return "[absent]";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  if (typeof value === "object" && "utc" in value) {
    return String((value as { readonly utc: unknown }).utc);
  }
  return "[object]";
}

interface ExtractRow {
  readonly recordType: "finding" | "candidate";
  readonly collection: ExtractCollection;
  readonly sourceId: string;
  readonly profile: string;
  readonly commitState: string;
  readonly kind: string;
  readonly id: string;
  readonly runId: string;
  readonly artifactResultId: string;
  readonly provenance: Provenance;
  readonly fields: Readonly<
    Record<string, FieldState<unknown> | RedactedField>
  >;
  readonly extra: CanonicalValue;
}

function jsonlBytes(rows: readonly ExtractRow[]): Buffer {
  if (rows.length === 0) {
    return Buffer.alloc(0);
  }
  const lines = rows.map((row) =>
    canonicalJson({
      record_type: row.recordType,
      collection: row.collection,
      source_id: row.sourceId,
      profile: row.profile,
      commit_state: row.commitState,
      kind: row.kind,
      id: row.id,
      run_id: row.runId,
      artifact_result_id: row.artifactResultId,
      provenance: row.provenance,
      fields: row.fields,
      ...(row.extra as Record<string, CanonicalValue>),
    }),
  );
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function csvBytes(rows: readonly ExtractRow[]): Buffer {
  const fieldNames = [
    ...new Set(rows.flatMap((row) => Object.keys(row.fields))),
  ].sort();
  const header = [
    "record_type",
    "collection",
    "source_id",
    "profile",
    "commit_state",
    "kind",
    "id",
    "provenance",
    ...fieldNames.map((name) => `field.${name}`),
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const provenance = `${row.provenance.manifestPath}#${row.provenance.table}:${row.provenance.rowId}`;
    const cells = [
      row.recordType,
      row.collection,
      row.sourceId,
      row.profile,
      row.commitState,
      row.kind,
      row.id,
      provenance,
      ...fieldNames.map((name) => {
        const field = row.fields[name];
        return field === undefined ? "[absent]" : csvFieldCell(field);
      }),
    ];
    lines.push(cells.map(csvCell).join(","));
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function loadFindingRows(
  database: DatabaseSync,
  profiles: readonly string[],
  commitState: CommitState | undefined,
  includeSecrets: boolean,
): { readonly rows: ExtractRow[]; readonly redactedCount: number } {
  const parameters: string[] = [];
  const filter = profileFilter(profiles, parameters);
  let commitFilter = "";
  if (commitState !== undefined) {
    commitFilter = " AND f.commit_state = ?";
    parameters.push(commitState);
  }
  const findingRows = database
    .prepare(
      `SELECT f.finding_id, f.finding_kind, f.profile_path, f.commit_state,
              f.provenance_json, f.fields_json, f.source_id, f.run_id,
              f.artifact_result_id
         FROM forensic_findings f
         JOIN history_artifact_results r
           ON r.artifact_result_id = f.artifact_result_id
        WHERE r.active = 1 AND f.record_type = 'finding'${filter}${commitFilter}
        ORDER BY f.source_id, f.profile_path, f.finding_kind, f.finding_id`,
    )
    .all(...parameters) as unknown as FindingRow[];
  let redactedCount = 0;
  const rows = findingRows.map((row): ExtractRow => {
    const id = row.finding_id.toString();
    const provenance = parseJsonColumn<Provenance>(row.provenance_json, id);
    const rawFields = parseJsonColumn<ForensicFields>(row.fields_json, id);
    const redacted = redactFields(rawFields, includeSecrets);
    redactedCount += redacted.redactedCount;
    return {
      recordType: "finding",
      collection: "findings",
      sourceId: row.source_id,
      profile: row.profile_path,
      commitState: row.commit_state,
      kind: row.finding_kind,
      id,
      runId: row.run_id,
      artifactResultId: row.artifact_result_id.toString(),
      provenance,
      fields: redacted.fields,
      extra: {},
    };
  });
  return { rows, redactedCount };
}

function loadCandidateRows(
  database: DatabaseSync,
  profiles: readonly string[],
  commitState: CommitState | undefined,
  includeSecrets: boolean,
): { readonly rows: ExtractRow[]; readonly redactedCount: number } {
  const parameters: string[] = [];
  const filter = profileFilter(profiles, parameters);
  let commitFilter = "";
  if (commitState !== undefined) {
    commitFilter = " AND f.commit_state = ?";
    parameters.push(commitState);
  }
  const candidateRows = database
    .prepare(
      `SELECT f.candidate_id, f.candidate_kind, f.profile_path, f.commit_state,
              f.rank, f.supporting_count, f.provenance_json, f.fields_json,
              r.source_id, f.run_id, f.artifact_result_id
         FROM forensic_candidates f
         JOIN history_artifact_results r
           ON r.artifact_result_id = f.artifact_result_id
        WHERE r.active = 1 AND f.record_type = 'candidate'${filter}${commitFilter}
        ORDER BY r.source_id, f.profile_path, f.candidate_kind, f.rank,
                 f.candidate_id`,
    )
    .all(...parameters) as unknown as CandidateRow[];
  let redactedCount = 0;
  const rows = candidateRows.map((row): ExtractRow => {
    const id = row.candidate_id.toString();
    const provenance = parseJsonColumn<Provenance>(row.provenance_json, id);
    const rawFields = parseJsonColumn<ForensicFields>(row.fields_json, id);
    const redacted = redactFields(rawFields, includeSecrets);
    redactedCount += redacted.redactedCount;
    return {
      recordType: "candidate",
      collection: "candidates",
      sourceId: row.source_id,
      profile: row.profile_path,
      commitState: row.commit_state,
      kind: row.candidate_kind,
      id,
      runId: row.run_id,
      artifactResultId: row.artifact_result_id.toString(),
      provenance,
      fields: redacted.fields,
      extra: {
        rank: Number(row.rank),
        supporting_count: Number(row.supporting_count),
      },
    };
  });
  return { rows, redactedCount };
}

export async function exportCase(
  options: ExportCaseOptions,
): Promise<ExportCaseResult> {
  const caseDirectory = resolve(options.caseDirectory);
  const outDirectory = resolveOutDirectory(caseDirectory, options.outDirectory);
  const collections = options.collections ?? ["findings", "candidates"];
  const includeSecrets = options.includeSecrets ?? false;
  const csv = options.csv ?? false;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const profiles = [...new Set(options.profiles ?? [])].sort();

  await assertEmptyOutDirectory(outDirectory);

  const sources = loadCaseSources(caseDirectory);
  const database = openCase(caseDirectory);
  let caseInfo: ReturnType<typeof loadCaseInfo>;
  let completeness: ExtractCompletenessStatement;
  let activeRuns: readonly RunRow[];
  let findingResult: { rows: ExtractRow[]; redactedCount: number };
  let candidateResult: { rows: ExtractRow[]; redactedCount: number };
  try {
    if (!findingSchemaExists(database)) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no analysis to export. Run analyse first.",
      );
    }
    caseInfo = loadCaseInfo(database);
    completeness = buildCompleteness(database);
    activeRuns = loadActiveRuns(database);
    findingResult = collections.includes("findings")
      ? loadFindingRows(database, profiles, options.commitState, includeSecrets)
      : { rows: [], redactedCount: 0 };
    candidateResult = collections.includes("candidates")
      ? loadCandidateRows(
          database,
          profiles,
          options.commitState,
          includeSecrets,
        )
      : { rows: [], redactedCount: 0 };
  } finally {
    database.close();
  }

  const redaction: ExtractRedactionState = {
    policy: REDACTION_POLICY,
    state: includeSecrets ? "disclosed" : "redacted",
    plaintextSecretsIncluded: includeSecrets,
    redactedFieldCount:
      findingResult.redactedCount + candidateResult.redactedCount,
    binaryPayloadCount: 0,
  };

  const examiner: CanonicalValue =
    options.examiner === undefined
      ? { state: "unavailable", reason: "examiner_not_declared" }
      : { state: "value", value: options.examiner };

  const header = {
    extract_schema: EXTRACT_SCHEMA,
    extractKind: "history",
    case: {
      caseId: caseInfo.caseId,
      schemaVersion: caseInfo.schemaVersion,
      createdAt: caseInfo.createdAt,
      toolVersion: caseInfo.toolVersion,
    },
    tool: { name: "forensix", version: TOOL_VERSION },
    examiner,
    declaredTimezone: commonField(
      activeRuns.map((run) => run.declared_timezone),
      "no_active_analysis_run",
      "multiple_declared_timezones",
    ),
    declaredOriginOs: commonField(
      activeRuns.map((run) => run.declared_origin_os),
      "no_active_analysis_run",
      "multiple_declared_origin_os",
    ),
    sources: sources.map(sourceHeader),
    analysisRuns: activeRuns.map(runHeader),
    scope: {
      collections: [...collections].sort(),
      profiles: profiles.length === 0 ? "all" : profiles,
      commitState: options.commitState ?? "all",
      activeResultsOnly: true,
      csv: { enabled: csv, lossy: true },
    },
    redaction,
    completeness,
  };

  const emitted: { readonly path: string; readonly bytes: Buffer }[] = [
    {
      path: HEADER_FILE,
      bytes: Buffer.from(`${canonicalJson(header)}\n`, "utf8"),
    },
  ];
  if (collections.includes("findings")) {
    emitted.push({
      path: FINDINGS_JSONL,
      bytes: jsonlBytes(findingResult.rows),
    });
    if (csv) {
      emitted.push({ path: FINDINGS_CSV, bytes: csvBytes(findingResult.rows) });
    }
  }
  if (collections.includes("candidates")) {
    emitted.push({
      path: CANDIDATES_JSONL,
      bytes: jsonlBytes(candidateResult.rows),
    });
    if (csv) {
      emitted.push({
        path: CANDIDATES_CSV,
        bytes: csvBytes(candidateResult.rows),
      });
    }
  }

  const manifestFiles: ExtractManifestFile[] = [...emitted]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({
      path: file.path,
      sha256: sha256(file.bytes),
      size: file.bytes.byteLength,
    }));
  const derivedDigest = computeDerivedDigest(manifestFiles);
  const manifest: ExtractManifest = {
    extract_schema: EXTRACT_SCHEMA,
    files: manifestFiles,
    quarantinedGenerationFile: GENERATION_FILE,
    derivedDigest,
  };
  emitted.push({
    path: MANIFEST_FILE,
    bytes: Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"),
  });
  emitted.push({
    path: GENERATION_FILE,
    bytes: Buffer.from(
      `${canonicalJson({
        extract_schema: EXTRACT_SCHEMA,
        generatedAt,
        derivedDigest,
      })}\n`,
      "utf8",
    ),
  });

  for (const file of emitted) {
    await writeFile(join(outDirectory, file.path), file.bytes);
  }

  return {
    status: "ok",
    command: "export",
    extractKind: "history",
    outDirectory,
    findingCount: findingResult.rows.length,
    candidateCount: candidateResult.rows.length,
    csv,
    redaction,
    completeness,
    derivedDigest,
    generatedAt,
    files: emitted.map((file) => file.path).sort(),
  };
}
