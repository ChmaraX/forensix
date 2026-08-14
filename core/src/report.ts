import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ForensixError } from "./errors.js";
import { TOOL_VERSION } from "./case.js";
import {
  EXTRACT_FILES,
  computeDerivedDigest,
  type ExtractManifestFile,
} from "./export.js";

/**
 * The Report is a self-contained, human-readable rendering of a single Extract.
 * It is a strict downstream of the Extract boundary: the generator reads ONLY
 * the files an export (#169) already emitted and NEVER opens the Case. Because
 * every value is copied out of the Extract, two Reports of the same Extract
 * bytes are byte-identical, and any Case-only change that was never re-exported
 * cannot reach the Report.
 */
export const REPORT_SCHEMA = "forensix/report/1" as const;

const HEADER_FILE = EXTRACT_FILES.header;
const MANIFEST_FILE = EXTRACT_FILES.manifest;
const GENERATION_FILE = EXTRACT_FILES.generation;
const FINDINGS_JSONL = EXTRACT_FILES.findingsJsonl;
const CANDIDATES_JSONL = EXTRACT_FILES.candidatesJsonl;

export interface RenderReportOptions {
  readonly extractDirectory: string;
  readonly outputPath: string;
}

export interface RenderReportResult {
  readonly status: "ok";
  readonly command: "report";
  readonly reportSchema: typeof REPORT_SCHEMA;
  readonly extractDirectory: string;
  readonly reportPath: string;
  readonly extractSchema: string;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly derivedDigest: string;
  readonly recomputedDigest: string;
  readonly integrity: "verified" | "altered";
  readonly generatedAt: string;
  readonly bytes: number;
}

interface ExtractManifest {
  readonly extract_schema?: string;
  readonly files?: readonly ExtractManifestFile[];
  readonly derivedDigest?: string;
}

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { readonly [key: string]: Json };

interface ExtractRow {
  readonly record_type?: string;
  readonly collection?: string;
  readonly source_id?: string;
  readonly profile?: string;
  readonly commit_state?: string;
  readonly kind?: string;
  readonly id?: string;
  readonly run_id?: string;
  readonly provenance?: Record<string, Json>;
  readonly fields?: Record<string, Json>;
  readonly rank?: number;
  readonly supporting_count?: number;
  readonly [key: string]: Json | undefined;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readExtractFile(
  extractDirectory: string,
  name: string,
): Promise<Buffer | undefined> {
  try {
    return await readFile(join(extractDirectory, name));
  } catch {
    return undefined;
  }
}

function parseJson<T>(bytes: Buffer, name: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    throw new ForensixError(
      "EXTRACT_INVALID",
      `The Extract file ${name} is not valid JSON.`,
      { file: name },
      { cause: error },
    );
  }
}

function parseJsonl(bytes: Buffer | undefined, name: string): ExtractRow[] {
  if (bytes === undefined) {
    return [];
  }
  const text = bytes.toString("utf8").trim();
  if (text.length === 0) {
    return [];
  }
  return text.split("\n").map((line, index) => {
    try {
      return JSON.parse(line) as ExtractRow;
    } catch (error) {
      throw new ForensixError(
        "EXTRACT_INVALID",
        `The Extract file ${name} has an invalid row.`,
        { file: name, line: index + 1 },
        { cause: error },
      );
    }
  });
}

/**
 * Recompute the Export Manifest derived digest from the bytes currently on
 * disk. A match binds the Report to the exact Extract it was generated from; a
 * mismatch is surfaced as an explicit "altered" integrity note rather than a
 * silent success, because the Report must never overstate the evidence.
 */
async function recomputeDigest(
  extractDirectory: string,
  manifest: ExtractManifest,
): Promise<{
  readonly recomputed: string;
  readonly integrity: "verified" | "altered";
}> {
  const files = manifest.files ?? [];
  const entries: ExtractManifestFile[] = [];
  for (const file of files) {
    const bytes = await readExtractFile(extractDirectory, file.path);
    if (bytes === undefined) {
      return { recomputed: "", integrity: "altered" };
    }
    entries.push({
      path: file.path,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    });
  }
  const recomputed = computeDerivedDigest(entries);
  const integrity =
    manifest.derivedDigest !== undefined &&
    recomputed === manifest.derivedDigest
      ? "verified"
      : "altered";
  return { recomputed, integrity };
}

const COMMIT_STATE_LABELS: Readonly<Record<string, string>> = {
  committed: "committed",
  wal_resident: "sidecar — WAL",
  journal_resident: "sidecar — rollback-journal",
};

function commitStateLabel(commitState: string | undefined): string {
  if (commitState === undefined) {
    return "unavailable — commit_state_absent";
  }
  return COMMIT_STATE_LABELS[commitState] ?? commitState;
}

function isSidecar(commitState: string | undefined): boolean {
  return commitState === "wal_resident" || commitState === "journal_resident";
}

/**
 * Render a single Field State to HTML. Empty string, absent, and unavailable
 * are the three states AC4 requires to read differently WITHOUT relying on
 * color: each carries a distinct word ("empty string", "absent",
 * "unavailable — <reason>"), so a monochrome or screen-read Report stays
 * unambiguous.
 */
function renderFieldValue(value: Json): string {
  if (value === null) {
    return `<span class="fx-state fx-null">null value</span>`;
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return `<span class="fx-state fx-empty">empty string</span>`;
    }
    return `<span class="fx-value">${escapeHtml(value)}</span>`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `<span class="fx-value">${escapeHtml(String(value))}</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `<span class="fx-state fx-empty">empty list</span>`;
    }
    return `<span class="fx-value">${value
      .map((item) => renderFieldValue(item))
      .join('<span class="fx-sep">, </span>')}</span>`;
  }
  // Structured value (for example a timestamp with Epoch Family, Declared
  // Timezone, and the asserted UTC instant). Keys are rendered verbatim so
  // timestamp semantics are preserved rather than flattened to one string.
  const pairs = Object.entries(value).map(
    ([key, inner]) =>
      `<span class="fx-kv"><span class="fx-k">${escapeHtml(
        key,
      )}</span>=${renderFieldValue(inner)}</span>`,
  );
  return `<span class="fx-object">${pairs.join(
    '<span class="fx-sep">, </span>',
  )}</span>`;
}

function renderFieldState(state: Json): string {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return `<span class="fx-state fx-unavailable">unavailable — malformed_field</span>`;
  }
  const record = state as Record<string, Json>;
  const kind = record.state;
  if (kind === "value") {
    return renderFieldValue(record.value ?? null);
  }
  if (kind === "absent") {
    return `<span class="fx-state fx-absent">absent</span>`;
  }
  if (kind === "unavailable") {
    const reason =
      typeof record.reason === "string" ? record.reason : "unspecified";
    return `<span class="fx-state fx-unavailable">unavailable — ${escapeHtml(
      reason,
    )}</span>`;
  }
  if (kind === "redacted") {
    const reason =
      typeof record.reason === "string" ? record.reason : "unspecified";
    const hash = typeof record.sha256 === "string" ? record.sha256 : "";
    return `<span class="fx-state fx-redacted">redacted — ${escapeHtml(
      reason,
    )}</span>${
      hash.length > 0
        ? `<span class="fx-hash" title="withheld value digest">sha256:${escapeHtml(
            hash.slice(0, 16),
          )}…</span>`
        : ""
    }`;
  }
  return `<span class="fx-state fx-unavailable">unavailable — malformed_field</span>`;
}

function renderFields(fields: Record<string, Json> | undefined): string {
  if (fields === undefined || Object.keys(fields).length === 0) {
    return `<span class="fx-state fx-absent">no fields</span>`;
  }
  const rows = Object.keys(fields)
    .sort()
    .map(
      (name) =>
        `<div class="fx-field"><span class="fx-fname">${escapeHtml(
          name,
        )}</span><span class="fx-fval">${renderFieldState(
          fields[name] ?? null,
        )}</span></div>`,
    );
  return `<div class="fx-fields">${rows.join("")}</div>`;
}

function renderProvenance(
  provenance: Record<string, Json> | undefined,
): string {
  if (provenance === undefined) {
    return `<span class="fx-state fx-unavailable">unavailable — provenance_absent</span>`;
  }
  const table = typeof provenance.table === "string" ? provenance.table : "?";
  const rowId = provenance.rowId === undefined ? "?" : String(provenance.rowId);
  const manifestPath =
    typeof provenance.manifestPath === "string" ? provenance.manifestPath : "";
  const database =
    typeof provenance.database === "string" ? provenance.database : "";
  const supporting = Array.isArray(provenance.supportingRows)
    ? provenance.supportingRows.length
    : 0;
  const cite = `${manifestPath}${database.length > 0 ? `/${database}` : ""}#${table}:${rowId}`;
  return `<span class="fx-prov" title="${escapeHtml(cite)}">${escapeHtml(
    `${table}:${rowId}`,
  )}</span>${
    supporting > 0
      ? `<span class="fx-support">+${supporting} supporting</span>`
      : ""
  }`;
}

function renderRow(row: ExtractRow, isCandidate: boolean): string {
  const recordType = row.record_type ?? (isCandidate ? "candidate" : "finding");
  const kind = row.kind ?? "unknown";
  const typeCell = `<td class="fx-type"><span class="fx-badge fx-badge-${escapeHtml(
    recordType,
  )}">${escapeHtml(recordType.toUpperCase())}</span><span class="fx-kind">${escapeHtml(
    kind,
  )}</span>${
    isCandidate
      ? `<span class="fx-rank">rank ${escapeHtml(
          String(row.rank ?? "?"),
        )} · ${escapeHtml(String(row.supporting_count ?? 0))} supporting</span>`
      : ""
  }</td>`;
  return `<tr>${typeCell}<td>${escapeHtml(
    row.profile ?? "unavailable — profile_absent",
  )}</td><td>${escapeHtml(commitStateLabel(row.commit_state))}</td><td>${escapeHtml(
    row.source_id ?? "?",
  )}</td><td>${renderProvenance(row.provenance)}</td><td>${renderFields(
    row.fields,
  )}</td></tr>`;
}

function renderRowGroup(
  title: string,
  rows: readonly ExtractRow[],
  isCandidate: boolean,
): string {
  if (rows.length === 0) {
    return `<h4>${escapeHtml(title)} <span class="fx-count">0 rows</span></h4><p class="fx-note">No rows in this Commit State.</p>`;
  }
  const body = rows.map((row) => renderRow(row, isCandidate)).join("");
  return `<h4>${escapeHtml(title)} <span class="fx-count">${
    rows.length
  } rows</span></h4><table class="fx-rows"><thead><tr><th>Type</th><th>Profile</th><th>Commit State</th><th>Source</th><th>Provenance</th><th>Fields</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderCollection(
  title: string,
  rows: readonly ExtractRow[],
  isCandidate: boolean,
): string {
  const committed = rows.filter((row) => !isSidecar(row.commit_state));
  const sidecar = rows.filter((row) => isSidecar(row.commit_state));
  return `<section class="fx-collection"><h3>${escapeHtml(title)} <span class="fx-count">${
    rows.length
  } total</span></h3>${renderRowGroup(
    "Committed",
    committed,
    isCandidate,
  )}${renderRowGroup(
    "Sidecar (WAL / rollback-journal)",
    sidecar,
    isCandidate,
  )}</section>`;
}

function keyValueTable(pairs: readonly (readonly [string, string])[]): string {
  const rows = pairs
    .map(
      ([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${value}</td></tr>`,
    )
    .join("");
  return `<table class="fx-kvtable"><tbody>${rows}</tbody></table>`;
}

function textOrUnavailable(value: Json | undefined, reason: string): string {
  if (value === undefined || value === null) {
    return `<span class="fx-state fx-unavailable">unavailable — ${escapeHtml(
      reason,
    )}</span>`;
  }
  if (typeof value === "object") {
    // A common { state, value } / { state, reason } Field State shape from the
    // header. Delegate to the single Field-State renderer so state branching
    // lives in one place.
    return renderFieldState(value);
  }
  const text = String(value);
  return text.length === 0
    ? `<span class="fx-state fx-empty">empty string</span>`
    : `<span class="fx-value">${escapeHtml(text)}</span>`;
}

function renderCompleteness(
  completeness: Record<string, Json> | undefined,
): string {
  if (completeness === undefined) {
    return `<p class="fx-note">The Extract carried no Completeness Statement.</p>`;
  }
  const artifacts = Array.isArray(completeness.artifacts)
    ? (completeness.artifacts as Record<string, Json>[])
    : [];
  const summary = keyValueTable([
    ["Attempted", escapeHtml(String(completeness.attempted ?? "?"))],
    ["Produced", escapeHtml(String(completeness.produced ?? "?"))],
    ["Absent", escapeHtml(String(completeness.absent ?? "?"))],
    ["Unavailable", escapeHtml(String(completeness.unavailable ?? "?"))],
  ]);
  const rows = artifacts
    .map((artifact) => {
      const outcome = String(artifact.outcome ?? "?");
      const reason =
        artifact.reason === null || artifact.reason === undefined
          ? '<span class="fx-state fx-absent">no reason</span>'
          : `<span class="fx-value">${escapeHtml(String(artifact.reason))}</span>`;
      return `<tr><td><span class="fx-outcome fx-outcome-${escapeHtml(
        outcome,
      )}">${escapeHtml(outcome)}</span></td><td>${escapeHtml(
        String(artifact.artifact ?? "?"),
      )}</td><td>${escapeHtml(String(artifact.sourceId ?? "?"))}</td><td>${escapeHtml(
        String(artifact.profile ?? "?"),
      )}</td><td>${reason}</td></tr>`;
    })
    .join("");
  return `${summary}<table class="fx-rows"><thead><tr><th>Outcome</th><th>Artifact</th><th>Source</th><th>Profile</th><th>Reason</th></tr></thead><tbody>${
    rows.length > 0
      ? rows
      : '<tr><td colspan="5" class="fx-note">No artifact outcomes recorded.</td></tr>'
  }</tbody></table>`;
}

function renderScope(scope: Record<string, Json> | undefined): string {
  if (scope === undefined) {
    return `<p class="fx-note">The Extract carried no scope declaration.</p>`;
  }
  const collections = Array.isArray(scope.collections)
    ? (scope.collections as Json[]).map((item) => String(item)).join(", ")
    : "?";
  const profiles = Array.isArray(scope.profiles)
    ? (scope.profiles as Json[]).map((item) => String(item)).join(", ")
    : String(scope.profiles ?? "all");
  const csv =
    scope.csv !== null && typeof scope.csv === "object"
      ? `enabled=${String((scope.csv as Record<string, Json>).enabled)} · lossy=${String(
          (scope.csv as Record<string, Json>).lossy,
        )}`
      : "n/a";
  return keyValueTable([
    ["Collections", escapeHtml(collections)],
    ["Profiles", escapeHtml(profiles)],
    ["Commit State", escapeHtml(String(scope.commitState ?? "all"))],
    ["Active results only", escapeHtml(String(scope.activeResultsOnly ?? "?"))],
    ["CSV profile", escapeHtml(csv)],
  ]);
}

function renderRedaction(redaction: Record<string, Json> | undefined): string {
  if (redaction === undefined) {
    return `<p class="fx-note">The Extract carried no Redaction State.</p>`;
  }
  const state = String(redaction.state ?? "?");
  return keyValueTable([
    ["Policy", escapeHtml(String(redaction.policy ?? "?"))],
    [
      "State",
      `<span class="fx-redaction fx-redaction-${escapeHtml(
        state,
      )}">${escapeHtml(state)}</span>`,
    ],
    [
      "Plaintext secrets included",
      escapeHtml(String(redaction.plaintextSecretsIncluded ?? "?")),
    ],
    [
      "Redacted field count",
      escapeHtml(String(redaction.redactedFieldCount ?? "?")),
    ],
    [
      "Binary payload count",
      escapeHtml(String(redaction.binaryPayloadCount ?? "?")),
    ],
  ]);
}

function renderSources(sources: Json | undefined): string {
  if (!Array.isArray(sources) || sources.length === 0) {
    return `<p class="fx-note">The Extract listed no Sources.</p>`;
  }
  const rows = (sources as Record<string, Json>[])
    .map(
      (source) =>
        `<tr><td>${escapeHtml(String(source.sourceId ?? "?"))}</td><td>${escapeHtml(
          String(source.sourceKind ?? "?"),
        )}</td><td>${escapeHtml(
          String(source.sourcePath ?? "?"),
        )}</td><td class="fx-mono">${escapeHtml(
          String(source.evidenceSetDigest ?? "?"),
        )}</td></tr>`,
    )
    .join("");
  return `<table class="fx-rows"><thead><tr><th>Source</th><th>Kind</th><th>Path</th><th>Evidence Set Digest</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRuns(runs: Json | undefined): string {
  if (!Array.isArray(runs) || runs.length === 0) {
    return `<p class="fx-note">The Extract listed no Analysis Runs.</p>`;
  }
  const rows = (runs as Record<string, Json>[])
    .map(
      (run) =>
        `<tr><td class="fx-mono">${escapeHtml(
          String(run.runId ?? "?"),
        )}</td><td>${escapeHtml(String(run.status ?? "?"))}</td><td>${escapeHtml(
          String(run.startedAt ?? "?"),
        )}</td><td>${escapeHtml(
          String(run.declaredTimezone ?? "?"),
        )}</td><td>${escapeHtml(String(run.toolVersion ?? "?"))}</td></tr>`,
    )
    .join("");
  return `<table class="fx-rows"><thead><tr><th>Run</th><th>Status</th><th>Started</th><th>Declared Timezone</th><th>Tool</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.45; color: #1a1a1a; background: #fafafa; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; border-bottom: 2px solid #444; padding-bottom: .25rem; }
h3 { font-size: 1.05rem; margin: 1.25rem 0 .5rem; }
h4 { font-size: .95rem; margin: 1rem 0 .35rem; color: #333; }
p { margin: .35rem 0; }
.fx-banner { border: 2px solid #1a5; background: #eafaf0; padding: .75rem 1rem; border-radius: 6px; margin: 1rem 0; font-weight: 600; }
.fx-banner.fx-altered { border-color: #b30; background: #fdecea; }
.fx-sub { color: #555; font-size: .85rem; }
.fx-mono, .fx-hash, .fx-prov { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .82rem; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0; background: #fff; }
th, td { border: 1px solid #ccc; padding: .35rem .5rem; text-align: left; vertical-align: top; font-size: .85rem; }
th { background: #f0f0f0; }
.fx-kvtable { max-width: 640px; }
.fx-kvtable th { width: 40%; }
.fx-count, .fx-sub { font-weight: 400; color: #666; font-size: .8rem; }
.fx-note { color: #666; font-style: italic; }
.fx-badge { display: inline-block; font-size: .7rem; font-weight: 700; padding: .05rem .35rem; border-radius: 3px; border: 1px solid #444; margin-right: .35rem; letter-spacing: .04em; }
.fx-badge-finding { background: #e7f0ff; border-color: #2b6; }
.fx-badge-candidate { background: #fff4e0; border-color: #d80; }
.fx-kind { font-weight: 600; }
.fx-rank { display: block; color: #666; font-size: .75rem; }
.fx-fields { display: flex; flex-direction: column; gap: .15rem; }
.fx-field { display: grid; grid-template-columns: minmax(9rem, 12rem) 1fr; gap: .5rem; }
.fx-fname { font-weight: 600; font-size: .8rem; color: #333; }
.fx-value { }
.fx-object, .fx-kv { font-size: .82rem; }
.fx-k { color: #555; }
.fx-sep { color: #999; }
.fx-support { display: block; color: #666; font-size: .75rem; }
/* Field State markers: each uses a distinct WORD, never color alone. */
.fx-state { font-style: italic; }
.fx-empty { color: #7a5; border-bottom: 1px dotted #7a5; }
.fx-empty::before { content: "⌀ "; font-style: normal; }
.fx-null { color: #857; border-bottom: 1px dotted #857; }
.fx-absent { color: #888; text-decoration: line-through dotted; }
.fx-unavailable { color: #a40; font-weight: 600; }
.fx-unavailable::before { content: "⚠ "; }
.fx-redacted { color: #405; font-weight: 600; }
.fx-hash { color: #666; margin-left: .35rem; }
.fx-outcome, .fx-redaction { font-weight: 700; padding: .05rem .3rem; border-radius: 3px; border: 1px solid currentColor; font-size: .75rem; }
.fx-outcome-produced { color: #161; }
.fx-outcome-absent { color: #666; }
.fx-outcome-unavailable { color: #a40; }
.fx-redaction-redacted { color: #405; }
.fx-redaction-disclosed { color: #a40; }
.fx-legend dt { font-weight: 700; margin-top: .4rem; }
footer { margin-top: 2.5rem; color: #666; font-size: .8rem; border-top: 1px solid #ccc; padding-top: .75rem; }
`;

function buildHtml(input: {
  readonly header: Record<string, Json>;
  readonly manifest: ExtractManifest;
  readonly generatedAt: string;
  readonly recomputedDigest: string;
  readonly integrity: "verified" | "altered";
  readonly findings: readonly ExtractRow[];
  readonly candidates: readonly ExtractRow[];
}): string {
  const { header, manifest, generatedAt, recomputedDigest, integrity } = input;
  const caseInfo =
    header.case !== null && typeof header.case === "object"
      ? (header.case as Record<string, Json>)
      : {};
  const extractSchema = String(
    header.extract_schema ?? manifest.extract_schema ?? "?",
  );
  const declaredDigest = manifest.derivedDigest ?? "?";
  const bannerClass =
    integrity === "verified" ? "fx-banner" : "fx-banner fx-altered";
  const integrityLine =
    integrity === "verified"
      ? `Extract integrity verified. This Report was generated only from Extract <span class="fx-mono">${escapeHtml(
          declaredDigest,
        )}</span>. The Case was not read.`
      : `Extract integrity: ALTERED. The Extract bytes on disk no longer match the recorded Export Manifest digest (recorded <span class="fx-mono">${escapeHtml(
          declaredDigest,
        )}</span>, recomputed <span class="fx-mono">${escapeHtml(
          recomputedDigest,
        )}</span>). This Report reflects the Extract as found. The Case was not read.`;

  const legend = `
    <dl class="fx-legend">
      <dt><span class="fx-state fx-empty">empty string</span></dt>
      <dd>The field carries a value that is the zero-length string. This is a recorded value, not a missing one.</dd>
      <dt><span class="fx-state fx-absent">absent</span></dt>
      <dd>The field was not present in the Source row. No value was recorded.</dd>
      <dt><span class="fx-state fx-unavailable">unavailable — reason</span></dt>
      <dd>The value could not be established. A typed reason is always given; the value is never silently blank.</dd>
      <dt><span class="fx-state fx-redacted">redacted — reason</span></dt>
      <dd>A plaintext secret was withheld by the Redaction State. The withheld value stays citable through its digest.</dd>
    </dl>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>ForensiX Report — ${escapeHtml(String(caseInfo.caseId ?? "unknown Case"))}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>ForensiX Report</h1>
<p class="fx-sub">Report schema ${escapeHtml(REPORT_SCHEMA)} · Extract schema ${escapeHtml(
    extractSchema,
  )} · rendered by forensix ${escapeHtml(TOOL_VERSION)}</p>
<div class="${bannerClass}">${integrityLine}</div>

<h2>Case &amp; generation</h2>
${keyValueTable([
  ["Case", escapeHtml(String(caseInfo.caseId ?? "unavailable — case_absent"))],
  ["Case schema version", escapeHtml(String(caseInfo.schemaVersion ?? "?"))],
  ["Case created", escapeHtml(String(caseInfo.createdAt ?? "?"))],
  ["Examiner", textOrUnavailable(header.examiner, "examiner_not_declared")],
  [
    "Declared Timezone",
    textOrUnavailable(header.declaredTimezone, "no_active_analysis_run"),
  ],
  [
    "Declared origin OS",
    textOrUnavailable(header.declaredOriginOs, "no_active_analysis_run"),
  ],
  ["Extract generated at", escapeHtml(generatedAt)],
  [
    "Export Manifest digest",
    `<span class="fx-mono">${escapeHtml(String(declaredDigest))}</span>`,
  ],
])}

<h2>Scope</h2>
${renderScope(header.scope as Record<string, Json> | undefined)}

<h2>Redaction State</h2>
${renderRedaction(header.redaction as Record<string, Json> | undefined)}

<h2>Completeness Statement</h2>
<p class="fx-sub">Recorded before any result row, so the coverage of the analysis is read before its content.</p>
${renderCompleteness(header.completeness as Record<string, Json> | undefined)}

<h2>Sources</h2>
${renderSources(header.sources)}

<h2>Analysis Runs</h2>
${renderRuns(header.analysisRuns)}

<h2>Findings</h2>
${renderCollection("Findings", input.findings, false)}

<h2>Candidates</h2>
${renderCollection("Candidates", input.candidates, true)}

<h2>How to read Field State</h2>
${legend}

<footer>
Self-contained ForensiX Report. No network resources are loaded at view time.
Generated solely from the Extract; the Case is never consulted.
</footer>
</body>
</html>
`;
}

export async function renderReport(
  options: RenderReportOptions,
): Promise<RenderReportResult> {
  const extractDirectory = resolve(options.extractDirectory);
  const outputPath = resolve(options.outputPath);

  let directoryStat;
  try {
    directoryStat = await stat(extractDirectory);
  } catch (error) {
    throw new ForensixError(
      "EXTRACT_NOT_FOUND",
      "The Extract directory does not exist.",
      { extract_directory: extractDirectory },
      { cause: error },
    );
  }
  if (!directoryStat.isDirectory()) {
    throw new ForensixError(
      "EXTRACT_NOT_FOUND",
      "The Extract path is not a directory.",
      { extract_directory: extractDirectory },
    );
  }

  const headerBytes = await readExtractFile(extractDirectory, HEADER_FILE);
  if (headerBytes === undefined) {
    throw new ForensixError(
      "EXTRACT_NOT_FOUND",
      "The Extract directory has no export_header.json. Run export first.",
      { extract_directory: extractDirectory },
    );
  }
  const header = parseJson<Record<string, Json>>(headerBytes, HEADER_FILE);

  const manifestBytes = await readExtractFile(extractDirectory, MANIFEST_FILE);
  const manifest: ExtractManifest =
    manifestBytes === undefined
      ? {}
      : parseJson<ExtractManifest>(manifestBytes, MANIFEST_FILE);

  const generationBytes = await readExtractFile(
    extractDirectory,
    GENERATION_FILE,
  );
  const generation =
    generationBytes === undefined
      ? {}
      : parseJson<Record<string, Json>>(generationBytes, GENERATION_FILE);
  const generatedAt =
    typeof generation.generatedAt === "string"
      ? generation.generatedAt
      : "unavailable — generation_instant_absent";

  const collections =
    header.scope !== null &&
    typeof header.scope === "object" &&
    Array.isArray((header.scope as Record<string, Json>).collections)
      ? ((header.scope as Record<string, Json>).collections as Json[]).map(
          (item) => String(item),
        )
      : ["findings", "candidates"];

  const findings = collections.includes("findings")
    ? parseJsonl(
        await readExtractFile(extractDirectory, FINDINGS_JSONL),
        FINDINGS_JSONL,
      )
    : [];
  const candidates = collections.includes("candidates")
    ? parseJsonl(
        await readExtractFile(extractDirectory, CANDIDATES_JSONL),
        CANDIDATES_JSONL,
      )
    : [];

  const { recomputed, integrity } = await recomputeDigest(
    extractDirectory,
    manifest,
  );

  const html = buildHtml({
    header,
    manifest,
    generatedAt,
    recomputedDigest: recomputed,
    integrity,
    findings,
    candidates,
  });
  const bytes = Buffer.from(html, "utf8");
  await writeFile(outputPath, bytes);

  return {
    status: "ok",
    command: "report",
    reportSchema: REPORT_SCHEMA,
    extractDirectory,
    reportPath: outputPath,
    extractSchema: String(
      header.extract_schema ?? manifest.extract_schema ?? "unknown",
    ),
    findingCount: findings.length,
    candidateCount: candidates.length,
    derivedDigest: String(manifest.derivedDigest ?? ""),
    recomputedDigest: recomputed,
    integrity,
    generatedAt,
    bytes: bytes.byteLength,
  };
}
