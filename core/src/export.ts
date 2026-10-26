import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  TOOL_VERSION,
  loadCaseSources,
  openCaseReadOnly,
  workingCopyAbsolutePath,
  type CaseSourceRecord,
} from "./case.js";
import {
  readCompletenessStatements,
  type OverviewArtifact,
} from "./case-overview.js";
import { ForensixError } from "./errors.js";
import type { CommitState, FieldState, Provenance } from "./forensic-model.js";
import { redactSecrets } from "./record-redaction.js";
import {
  decodeStoredRecord,
  presentStores,
  storedRecordColumns,
  type RecordStore,
  type RecordStoreKey,
  type StoredRecordRow,
} from "./record-store.js";
import { tableExists } from "./sqlite-artifact.js";

/**
 * The Extract is a scoped, deterministic, citable read over the Case. It never
 * becomes a second record of truth: every row is copied from Findings and
 * Candidates already recorded by an Analysis Run, and the Export Manifest binds
 * the emitted files to an independently reproducible digest.
 *
 * Schema 2 covers every record store of the Case (`RECORD_STORES`), not only
 * History. Compared with schema 1, each row carries its `store`, its `id` is
 * the stable record id `<store>:<rowid>`, and a Candidate row has no
 * `commit_state` (a Candidate has no Commit State).
 */
export const EXTRACT_SCHEMA = "forensix/extract/2" as const;
export const REDACTION_POLICY = "forensix/redaction/1" as const;

export type ExtractCollection = "findings" | "candidates";

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
  readonly artifact: OverviewArtifact;
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
  readonly extractKind: "case";
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

/** A stored row with the result lineage the Extract cites. */
interface StoreRow extends StoredRecordRow {
  readonly source_id: string;
  readonly run_id: string;
  readonly artifact_result_id: bigint;
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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * A locale-independent total order: compares the UTF-8 bytes. Every order
 * the Extract digest or row order depends on uses it, so the host locale can
 * never change an Extract.
 */
function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
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
    compareBytes(left.path, right.path),
  );
  return sha256(Buffer.from(canonicalJson(sorted), "utf8"));
}

export interface RedactedField {
  readonly state: "redacted";
  readonly reason: "plaintext_secret_withheld";
  readonly sha256: string;
}

function parseJsonColumn<T>(value: string, recordId: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new ForensixError(
      "CASE_INVALID",
      "Case contains invalid Extract row JSON.",
      { recordId },
      { cause: error },
    );
  }
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  );
}

function filesystemErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code: unknown }).code)
    : undefined;
}

/**
 * The physical path a write to `path` would reach: the real path of its
 * nearest existing ancestor, joined with the part that does not exist yet.
 * A symbolic link anywhere in the existing part is resolved, so a link that
 * points into the Case or a Source cannot hide the real target.
 */
export async function plannedPhysicalPath(path: string): Promise<string> {
  const target = resolve(path);
  let ancestor = target;
  while (true) {
    try {
      const physicalAncestor = await realpath(ancestor);
      return resolve(physicalAncestor, relative(ancestor, target));
    } catch (error) {
      const code = filesystemErrorCode(error);
      const parent = dirname(ancestor);
      if ((code !== "ENOENT" && code !== "ENOTDIR") || parent === ancestor) {
        throw new ForensixError(
          "INVALID_ARGUMENT",
          "The output path cannot be resolved.",
          { path: target },
          { cause: error },
        );
      }
      ancestor = parent;
    }
  }
}

/** The recorded Source paths a write must never reach. */
function evidencePaths(
  caseDirectory: string,
  sources: readonly CaseSourceRecord[],
): readonly { readonly path: string; readonly sourceId: string }[] {
  const paths: { path: string; sourceId: string }[] = [];
  for (const source of sources) {
    paths.push({ path: source.sourcePath, sourceId: source.sourceId });
    // A bundle's origin path names a path on the acquired machine. Only an
    // absolute path can name a local directory.
    if (
      source.sourceOriginPath !== null &&
      isAbsolute(source.sourceOriginPath)
    ) {
      paths.push({ path: source.sourceOriginPath, sourceId: source.sourceId });
    }
    paths.push({
      path: workingCopyAbsolutePath(caseDirectory, source),
      sourceId: source.sourceId,
    });
  }
  return paths;
}

/**
 * Refuse an output directory inside the Case Directory or inside a recorded
 * Source (or its Working Copy). Both sides are compared as physical paths, so
 * a symbolic link cannot bypass the check. It runs before any directory is
 * created.
 */
async function resolveOutDirectory(
  caseDirectory: string,
  outDirectory: string,
  sources: readonly CaseSourceRecord[],
): Promise<string> {
  const resolvedOut = resolve(outDirectory);
  const physicalOut = await plannedPhysicalPath(resolvedOut);
  const physicalCase = await plannedPhysicalPath(caseDirectory);
  if (
    isWithin(physicalCase, physicalOut) ||
    isWithin(resolve(caseDirectory), resolvedOut)
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "The Extract output directory must be outside the Case Directory.",
      {
        outDirectory: resolvedOut,
        resolvedOutDirectory: physicalOut,
        caseDirectory,
      },
    );
  }
  for (const evidence of evidencePaths(caseDirectory, sources)) {
    const physicalEvidence = await plannedPhysicalPath(evidence.path);
    if (
      isWithin(physicalEvidence, physicalOut) ||
      isWithin(resolve(evidence.path), resolvedOut)
    ) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The Extract output directory must be outside every Source.",
        {
          outDirectory: resolvedOut,
          resolvedOutDirectory: physicalOut,
          sourceId: evidence.sourceId,
          sourcePath: evidence.path,
        },
      );
    }
  }
  return resolvedOut;
}

/** Refuse a target that already holds files, without creating it. */
async function assertEmptyOutDirectory(outDirectory: string): Promise<void> {
  let existing: readonly string[];
  try {
    existing = await readdir(outDirectory);
  } catch (error) {
    if (filesystemErrorCode(error) === "ENOENT") {
      return;
    }
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "The Extract output directory cannot be read.",
      { outDirectory },
      { cause: error },
    );
  }
  if (existing.length > 0) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "The Extract output directory is not empty.",
      { outDirectory: outDirectory },
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
 * The Completeness Statement over every artifact the analyzer attempts. Per
 * (artifact, Source, Profile) the current outcome is the active result when
 * one exists, else the most recent attempt. The exported rows come from the
 * same active results, so a later rerun that produced nothing is never
 * reported while the older active rows are exported.
 */
function buildCompleteness(
  database: DatabaseSync,
): ExtractCompletenessStatement {
  const artifacts = readCompletenessStatements(database).flatMap((statement) =>
    [...statement.artifacts]
      .sort(
        (left, right) =>
          compareBytes(left.sourceId, right.sourceId) ||
          compareBytes(left.profile, right.profile),
      )
      .map(
        (artifact): ExtractCompletenessArtifact => ({
          sourceId: artifact.sourceId,
          profile: artifact.profile,
          artifact: artifact.artifact,
          databasePath: artifact.databasePath,
          outcome: artifact.outcome,
          reason: artifact.reason,
          runId: artifact.runId,
        }),
      ),
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

/** Every artifact-results table of the record stores, in a fixed order. */
function resultsTables(database: DatabaseSync): readonly string[] {
  return [
    ...new Set(presentStores(database).map((store) => store.resultsTable)),
  ];
}

/**
 * The Analysis Runs the Extract cites: every run with an active result (the
 * exported rows come from these), plus every run the Completeness Statement
 * names. `active` marks the first group; only those runs set the Declared
 * Timezone and origin OS of the rows.
 */
function loadRuns(
  database: DatabaseSync,
  completeness: ExtractCompletenessStatement,
): { readonly runs: readonly RunRow[]; readonly activeRunIds: Set<string> } {
  const activeRunIds = new Set<string>();
  for (const table of resultsTables(database)) {
    const rows = database
      .prepare(`SELECT DISTINCT run_id FROM ${table} WHERE active = 1`)
      .all() as unknown as { readonly run_id: string }[];
    for (const row of rows) {
      activeRunIds.add(row.run_id);
    }
  }
  const cited = new Set([
    ...activeRunIds,
    ...completeness.artifacts.map((artifact) => artifact.runId),
  ]);
  if (cited.size === 0 || !tableExists(database, "analysis_runs")) {
    return { runs: [], activeRunIds };
  }
  const runs = (
    database
      .prepare(
        `SELECT run_id, started_at, finished_at, tool_version, invocation_json,
                declared_timezone, declared_origin_os, status
           FROM analysis_runs
          ORDER BY started_at, run_id`,
      )
      .all() as unknown as RunRow[]
  ).filter((run) => cited.has(run.run_id));
  return { runs, activeRunIds };
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

function runHeader(run: RunRow, active: boolean): CanonicalValue {
  return {
    runId: run.run_id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
    toolVersion: run.tool_version,
    declaredTimezone: run.declared_timezone,
    declaredOriginOs: run.declared_origin_os,
    hasActiveResults: active,
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
  readonly store: RecordStoreKey;
  readonly sourceId: string;
  readonly profile: string;
  /** Null for a Candidate: a Candidate has no Commit State. */
  readonly commitState: CommitState | null;
  readonly kind: string;
  readonly id: string;
  readonly runId: string;
  readonly artifactResultId: string;
  readonly provenance: Provenance;
  readonly fields: Readonly<
    Record<string, FieldState<unknown> | RedactedField>
  >;
  readonly extra: Readonly<Record<string, CanonicalValue>>;
}

function jsonlBytes(rows: readonly ExtractRow[]): Buffer {
  if (rows.length === 0) {
    return Buffer.alloc(0);
  }
  const lines = rows.map((row) =>
    canonicalJson({
      record_type: row.recordType,
      collection: row.collection,
      store: row.store,
      source_id: row.sourceId,
      profile: row.profile,
      ...(row.commitState === null ? {} : { commit_state: row.commitState }),
      kind: row.kind,
      id: row.id,
      run_id: row.runId,
      artifact_result_id: row.artifactResultId,
      provenance: row.provenance,
      fields: row.fields,
      ...row.extra,
    }),
  );
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function csvBytes(rows: readonly ExtractRow[], commitState: boolean): Buffer {
  const fieldNames = [
    ...new Set(rows.flatMap((row) => Object.keys(row.fields))),
  ].sort(compareBytes);
  const header = [
    "record_type",
    "collection",
    "store",
    "source_id",
    "profile",
    ...(commitState ? ["commit_state"] : []),
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
      row.store,
      row.sourceId,
      row.profile,
      ...(commitState ? [row.commitState ?? ""] : []),
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

/**
 * The stores the Extract reads: every present store of a requested
 * collection, in `RECORD_STORES` order.
 */
function scopedStores(
  database: DatabaseSync,
  collections: readonly ExtractCollection[],
): readonly RecordStore[] {
  return presentStores(database).filter((store) =>
    collections.includes(
      store.recordType === "finding" ? "findings" : "candidates",
    ),
  );
}

/**
 * Read one store's active rows in a deterministic order (Source, Profile,
 * kind, rank for Candidates, row id; text compares as bytes) and turn each
 * into an Extract row. A secret is withheld unless `includeSecrets` is set.
 */
function loadStoreRows(
  database: DatabaseSync,
  store: RecordStore,
  profiles: readonly string[],
  commitState: CommitState | undefined,
  includeSecrets: boolean,
): { readonly rows: ExtractRow[]; readonly redactedCount: number } {
  const conditions = ["r.active = 1"];
  const parameters: string[] = [];
  if (store.table === "forensic_findings") {
    conditions.push("f.record_type = 'finding'");
  } else if (store.table === "forensic_candidates") {
    conditions.push("f.record_type = 'candidate'");
  }
  if (profiles.length > 0) {
    conditions.push(
      `f.profile_path IN (${profiles.map(() => "?").join(", ")})`,
    );
    parameters.push(...profiles);
  }
  // Only a Finding has a Commit State. A Candidate is never filtered by it.
  if (commitState !== undefined && store.recordType === "finding") {
    conditions.push("f.commit_state = ?");
    parameters.push(commitState);
  }
  const order = [
    "r.source_id",
    "f.profile_path",
    `f.${store.kindColumn}`,
    ...(store.recordType === "candidate" ? ["f.rank"] : []),
    `f.${store.idColumn}`,
  ];
  const stored = database
    .prepare(
      `SELECT ${storedRecordColumns(store)}, r.source_id, r.run_id,
              f.artifact_result_id
         FROM ${store.table} f
         JOIN ${store.resultsTable} r
           ON r.artifact_result_id = f.artifact_result_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY ${order.join(", ")}`,
    )
    .all(...parameters) as unknown as StoreRow[];
  let redactedCount = 0;
  const rows = stored.map((row): ExtractRow => {
    const record = decodeStoredRecord(store, row);
    const redacted = includeSecrets
      ? { item: record, redactedCount: 0 }
      : redactSecrets(record);
    redactedCount += redacted.redactedCount;
    const base = {
      store: store.key,
      sourceId: row.source_id,
      profile: row.profile_path,
      id: record.id,
      runId: row.run_id,
      artifactResultId: row.artifact_result_id.toString(),
      provenance: record.provenance,
      fields: redacted.item.fields,
    };
    if (record.recordType === "finding") {
      return {
        ...base,
        recordType: "finding",
        collection: "findings",
        commitState: record.commitState,
        kind: record.findingKind,
        extra: {},
      };
    }
    return {
      ...base,
      recordType: "candidate",
      collection: "candidates",
      commitState: null,
      kind: record.candidateKind,
      extra:
        "category" in record
          ? {
              category: record.category,
              rank: record.rank,
              supporting_count: record.supportingCount,
            }
          : { rank: record.rank, supporting_count: record.count },
    };
  });
  return { rows, redactedCount };
}

/**
 * Export a Case to an Extract, the stable offline boundary a Report reads.
 *
 * The pass reads the requested collections (Findings and Candidates by default)
 * of every record store from the active artifact results, applies Redaction,
 * and writes the Extract files into an empty output directory. The output
 * directory must be outside the Case Directory and outside every recorded
 * Source. A secret stays redacted unless `includeSecrets` is set. It reads the
 * Case and writes only the Extract; it never mutates a Case row.
 *
 * Returns an `ExportCaseResult` with the Extract paths, digests, and counts.
 */
export async function exportCase(
  options: ExportCaseOptions,
): Promise<ExportCaseResult> {
  const caseDirectory = resolve(options.caseDirectory);
  const collections = options.collections ?? ["findings", "candidates"];
  const includeSecrets = options.includeSecrets ?? false;
  const csv = options.csv ?? false;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const profiles = [...new Set(options.profiles ?? [])].sort(compareBytes);

  const sources = loadCaseSources(caseDirectory);
  const outDirectory = await resolveOutDirectory(
    caseDirectory,
    options.outDirectory,
    sources,
  );
  await assertEmptyOutDirectory(outDirectory);

  const database = openCaseReadOnly(caseDirectory, { readBigInts: true });
  let caseInfo: ReturnType<typeof loadCaseInfo>;
  let completeness: ExtractCompletenessStatement;
  let runs: ReturnType<typeof loadRuns>;
  let stores: readonly RecordStore[];
  const findingRows: ExtractRow[] = [];
  const candidateRows: ExtractRow[] = [];
  let redactedFieldCount = 0;
  try {
    if (!tableExists(database, "forensic_findings")) {
      throw new ForensixError(
        "ANALYSIS_NOT_FOUND",
        "Case has no analysis to export. Run analyse first.",
      );
    }
    caseInfo = loadCaseInfo(database);
    completeness = buildCompleteness(database);
    runs = loadRuns(database, completeness);
    stores = scopedStores(database, collections);
    for (const store of stores) {
      const result = loadStoreRows(
        database,
        store,
        profiles,
        options.commitState,
        includeSecrets,
      );
      redactedFieldCount += result.redactedCount;
      (store.recordType === "finding" ? findingRows : candidateRows).push(
        ...result.rows,
      );
    }
  } finally {
    database.close();
  }

  const redaction: ExtractRedactionState = {
    policy: REDACTION_POLICY,
    state: includeSecrets ? "disclosed" : "redacted",
    plaintextSecretsIncluded: includeSecrets,
    redactedFieldCount,
    binaryPayloadCount: 0,
  };

  const examiner: CanonicalValue =
    options.examiner === undefined
      ? { state: "unavailable", reason: "examiner_not_declared" }
      : { state: "value", value: options.examiner };

  const activeRuns = runs.runs.filter((run) =>
    runs.activeRunIds.has(run.run_id),
  );
  const header = {
    extract_schema: EXTRACT_SCHEMA,
    extractKind: "case",
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
    analysisRuns: runs.runs.map((run) =>
      runHeader(run, runs.activeRunIds.has(run.run_id)),
    ),
    scope: {
      collections: [...collections].sort(compareBytes),
      stores: stores.map((store) => store.key),
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
    emitted.push({ path: FINDINGS_JSONL, bytes: jsonlBytes(findingRows) });
    if (csv) {
      emitted.push({ path: FINDINGS_CSV, bytes: csvBytes(findingRows, true) });
    }
  }
  if (collections.includes("candidates")) {
    emitted.push({ path: CANDIDATES_JSONL, bytes: jsonlBytes(candidateRows) });
    if (csv) {
      emitted.push({
        path: CANDIDATES_CSV,
        bytes: csvBytes(candidateRows, false),
      });
    }
  }

  const manifestFiles: ExtractManifestFile[] = [...emitted]
    .sort((left, right) => compareBytes(left.path, right.path))
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

  // Write every file into a sibling staging directory, then rename it into
  // place: a failed export never leaves a partial Extract in the output path.
  const physicalOut = await plannedPhysicalPath(outDirectory);
  await mkdir(dirname(physicalOut), { recursive: true });
  const staging = `${physicalOut}.tmp-${randomUUID()}`;
  await mkdir(staging);
  try {
    for (const file of emitted) {
      await writeFile(join(staging, file.path), file.bytes, { flag: "wx" });
    }
    await assertEmptyOutDirectory(physicalOut);
    // An empty output directory is replaced; rmdir refuses one that is not.
    await rmdir(physicalOut).catch((error: unknown) => {
      if (filesystemErrorCode(error) !== "ENOENT") {
        throw error;
      }
    });
    await rename(staging, physicalOut);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    status: "ok",
    command: "export",
    extractKind: "case",
    outDirectory,
    findingCount: findingRows.length,
    candidateCount: candidateRows.length,
    csv,
    redaction,
    completeness,
    derivedDigest,
    generatedAt,
    files: emitted.map((file) => file.path).sort(compareBytes),
  };
}
