#!/usr/bin/env node
// ForensiX offline verification harness (issue #188, AC1–AC3).
//
// One offline command drives the *compiled* analyzer CLI from a recorded
// Source through ingest -> analyse -> export and returns a structured report of
// capability, invariant, fixture, and failure details. It runs entirely
// offline: no network, only the local compiled CLI and local git metadata.
//
// The report is a single JSON document on stdout. A short human summary goes to
// stderr. Exit code is 0 only when every capability, invariant, and fixture
// check passed.
//
// Capability table rule (AC3): a capability is either PASS (supported and
// exercised) or UNCOVERED. Every UNCOVERED capability must be backed by a
// tested typed refusal from the CLI — a structured ForensixError with a code
// and exit status 1 — never a crash or a silently wrong answer.
//
// Golden Extract rule (AC2): each fixture pins the reproducible Extract digest
// to a golden file. `FORENSIX_UPDATE_GOLDEN=1` rewrites goldens locally, but is
// refused when `CI` is set so goldens can never be rewritten inside CI.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const COMPILED_CLI = resolve(REPO_ROOT, "cli/dist/cli.js");
const GOLDEN_DIR = resolve(
  REPO_ROOT,
  "e2e/fixtures/offline-verification/golden",
);
const REPORT_SCHEMA = "forensix/offline-verification/1";

const updateGolden = process.env.FORENSIX_UPDATE_GOLDEN === "1";
const inCi = process.env.CI !== undefined && process.env.CI !== "";

/** @typedef {{ status: number | null, stdout: string, stderr: string }} CliResult */

/** @param {readonly string[]} argv @returns {CliResult} */
function runCli(argv) {
  const result = spawnSync(process.execPath, [COMPILED_CLI, ...argv], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** @param {string} value */
function parseJson(value) {
  return JSON.parse(value.trim());
}

/** @param {Buffer} data */
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return "unknown";
}

// --- Deterministic Chrome ground-truth fixture -----------------------------
//
// A minimal but real Chrome History schema (version 70) with exactly two
// committed visits over two URLs, plus a visit_source row. The row values are
// seeded and fixed, so downstream row counts and field values are ground truth.

/** @param {string} path */
function seedGroundTruthHistory(path) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
        from_visit INTEGER, external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER, originator_cache_guid TEXT,
        originator_visit_id INTEGER, originator_from_visit INTEGER,
        originator_opener_visit INTEGER,
        is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER, app_id TEXT
      );
      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES
        (10, 'https://alpha.example/start', 'Alpha start', 1, 1, 13348638245123456, 0),
        (11, 'https://alpha.example/redirected', 'Alpha redirected', 1, 0, 13348638305456000, 0);
      INSERT INTO visits
        (id, url, visit_time, from_visit, external_referrer_url, transition,
         segment_id, visit_duration, incremented_omnibox_typed_score,
         opener_visit, originator_cache_guid, originator_visit_id,
         originator_from_visit, originator_opener_visit, is_known_to_sync,
         consider_for_ntp_most_visited, visited_link_id, app_id)
      VALUES
        (1, 10, 13348638245123456, 0, '', 268435457, 0, 2500000, 1, 0, 'origin-cache-guid', 1001, 0, 0, 1, 1, 2001, 'com.example.browser'),
        (2, 11, 13348638305456000, 1, '', 1610612736, 0, 5000000, 1, 0, 'origin-cache-guid', 1002, 0, 0, 1, 1, 2002, 'com.example.browser');
      INSERT INTO visit_source (id, source) VALUES (2, 2);
    `);
  } finally {
    database.close();
  }
}

/** @param {string} root */
function makeGroundTruthSource(root) {
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "Local State"), "{}\n");
  seedGroundTruthHistory(join(source, "Default", "History"));
  return source;
}

/** A History file with a valid SQLite header but a corrupt body. */
function makeBrokenSource(root) {
  const source = join(root, "broken-source");
  mkdirSync(join(source, "Default"), { recursive: true });
  writeFileSync(join(source, "Local State"), "{}\n");
  // Valid SQLite magic header then garbage: opens but fails integrity/reads.
  const header = Buffer.from("SQLite format 3\u0000", "binary");
  const garbage = Buffer.alloc(4096 - header.length, 0x7a);
  writeFileSync(
    join(source, "Default", "History"),
    Buffer.concat([header, garbage]),
  );
  return source;
}

// --- Report accumulator -----------------------------------------------------

const capabilities = [];
const invariants = [];
const fixtures = [];
const failures = [];

/** @param {string} scope @param {string} name @param {string} message */
function fail(scope, name, message) {
  failures.push({ scope, name, message });
}

/**
 * Record a supported capability that was actually exercised.
 * @param {string} name @param {boolean} exercised @param {string} [detail]
 */
function capabilityPass(name, exercised, detail) {
  if (exercised) {
    capabilities.push({ name, status: "PASS", detail: detail ?? null });
  } else {
    capabilities.push({ name, status: "PASS", detail: detail ?? null });
    fail("capability", name, "expected PASS but capability was not exercised");
  }
}

/**
 * Record an unsupported capability. It is UNCOVERED only if the CLI refused it
 * with a typed error code and exit status 1. Anything else is a failure.
 * @param {string} name @param {CliResult} result
 */
function capabilityUncovered(name, result) {
  let code = null;
  if (result.status === 1) {
    try {
      const parsed = parseJson(result.stderr);
      if (parsed && typeof parsed.code === "string") {
        code = parsed.code;
      }
    } catch {
      code = null;
    }
  }
  capabilities.push({
    name,
    status: "UNCOVERED",
    refusal: code ? { code } : null,
  });
  if (code === null) {
    fail(
      "capability",
      name,
      `unsupported behavior must fail through a typed refusal (exit 1 + code); got status ${result.status}`,
    );
  }
}

/** @param {string} name @param {boolean} ok @param {string} detail */
function invariant(name, ok, detail) {
  invariants.push({ name, status: ok ? "pass" : "fail", detail });
  if (!ok) {
    fail("invariant", name, detail);
  }
}

// --- Golden Extract handling ------------------------------------------------

const UUID_GLOBAL_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Redact values that are inherently per-acquisition — random Case/Source/Run
 * UUIDs (including composite ids such as `<sourceId>:<ordinal>`) and absolute
 * filesystem paths — while keeping every stable forensic value: field values,
 * table/rowId Provenance, Commit State, transition semantics, and ordinals.
 *
 * The golden is deliberately taken over the Findings/Candidates *records*, not
 * over physical file digests. A freshly created SQLite file is not guaranteed
 * byte-reproducible across acquisitions, so the Evidence Set and Working Copy
 * digests differ per run even for identical logical content. The record-level
 * fingerprint is the reproducible whole-Extract ground truth.
 * @param {unknown} value
 */
function redactVolatile(value) {
  if (typeof value === "string") {
    let out = value.replace(UUID_GLOBAL_RE, "<uuid>");
    if (out.startsWith("/") || /^[A-Za-z]:[\\/]/.test(out)) {
      out = "<path>";
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactVolatile(item));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactVolatile(v);
    }
    return out;
  }
  return value;
}

/**
 * A stable digest over the whole Extract's forensic records: every Finding and
 * Candidate row across both collection files, with volatile identifiers
 * redacted. Header, manifest, and generation files are excluded because they
 * carry acquisition-local digests, paths, and instants.
 * @param {string} directory
 */
function normalizedExtractDigest(directory) {
  const files = readExtract(directory);
  const normalized = {};
  for (const name of Object.keys(files).sort()) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    normalized[name] = files[name]
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => redactVolatile(JSON.parse(line)));
  }
  return sha256(Buffer.from(JSON.stringify(normalized), "utf8"));
}

/** @param {string} fixtureName @param {string} derivedDigest */
function checkGolden(fixtureName, derivedDigest) {
  const goldenPath = join(GOLDEN_DIR, `${fixtureName}.json`);
  if (updateGolden) {
    if (inCi) {
      fail(
        "golden",
        fixtureName,
        "golden updates are disabled in CI (FORENSIX_UPDATE_GOLDEN with CI set)",
      );
      return { status: "update_refused" };
    }
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(
      goldenPath,
      `${JSON.stringify({ fixture: fixtureName, derivedDigest }, null, 2)}\n`,
    );
    return { status: "updated" };
  }
  let golden;
  try {
    golden = parseJson(readFileSync(goldenPath, "utf8"));
  } catch {
    fail("golden", fixtureName, `golden missing: ${goldenPath}`);
    return { status: "missing" };
  }
  if (golden.derivedDigest !== derivedDigest) {
    fail(
      "golden",
      fixtureName,
      `golden Extract digest mismatch: expected ${golden.derivedDigest}, got ${derivedDigest}`,
    );
    return { status: "mismatch" };
  }
  return { status: "match" };
}

// --- Fixture: Chrome ground truth + core invariants -------------------------

/** @param {string} root */
function runGroundTruthFixture(root) {
  const checks = [];
  const source = makeGroundTruthSource(root);
  const sourceHistory = join(source, "Default", "History");
  const sourceDigestBefore = sha256(readFileSync(sourceHistory));
  const caseDirectory = join(root, "CASE");

  const ingest = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
  capabilityPass("ingest.profile-dir", ingest.status === 0);
  checks.push({ name: "ingest", ok: ingest.status === 0 });
  if (ingest.status !== 0) {
    fixtures.push({ name: "chrome-ground-truth", status: "fail", checks });
    return;
  }

  const analyse = runCli([
    "analyse",
    "--case",
    caseDirectory,
    "--timezone",
    "America/New_York",
    "--json",
  ]);
  const analyseOk = analyse.status === 0;
  capabilityPass("analyse.history", analyseOk);
  checks.push({ name: "analyse", ok: analyseOk });
  if (analyseOk) {
    const summary = parseJson(analyse.stdout);
    const rowsOk =
      summary.history?.committedVisitCount === 2 &&
      summary.history?.recoveredVisitCount === 0 &&
      summary.history?.profileCount === 1;
    invariant(
      "row-counts.ground-truth",
      rowsOk,
      `expected 2 committed / 0 recovered / 1 profile, got ${JSON.stringify(summary.history)}`,
    );
    checks.push({ name: "exact-row-counts", ok: rowsOk });
  }

  // Seeded field ground truth via the history view.
  const historyPage = runCli([
    "history",
    "--case",
    caseDirectory,
    "--view",
    "visits",
    "--sort",
    "visit-time",
    "--direction",
    "asc",
    "--limit",
    "10",
    "--json",
  ]);
  let fieldsOk = false;
  if (historyPage.status === 0) {
    const page = parseJson(historyPage.stdout);
    const first = page.items?.[0];
    fieldsOk =
      first?.fields?.url?.value === "https://alpha.example/start" &&
      first?.fields?.visitTime?.value?.utc === "2024-01-02T03:04:05.123456Z" &&
      first?.fields?.transitionCore?.value === "typed";
  }
  capabilityPass("history.query.keyset", historyPage.status === 0);
  invariant(
    "seeded-fields.ground-truth",
    fieldsOk,
    "first visit must decode seeded url/timestamp/transition exactly",
  );
  checks.push({ name: "seeded-fields", ok: fieldsOk });

  // Export -> whole golden Extract + deterministic rerun.
  const extractOne = join(root, "extract-1");
  const extractTwo = join(root, "extract-2");
  const exportOne = runCli([
    "export",
    "--case",
    caseDirectory,
    "--out",
    extractOne,
    "--json",
  ]);
  const exportTwo = runCli([
    "export",
    "--case",
    caseDirectory,
    "--out",
    extractTwo,
    "--json",
  ]);
  const exportOk = exportOne.status === 0 && exportTwo.status === 0;
  capabilityPass("export.findings", exportOk);
  capabilityPass(
    "export.candidates",
    exportOk && parseJson(exportOne.stdout).candidateCount === 0,
    "candidates collection produced (count 0)",
  );
  checks.push({ name: "export", ok: exportOk });

  if (exportOk) {
    const summaryOne = parseJson(exportOne.stdout);
    const summaryTwo = parseJson(exportTwo.stdout);
    invariant(
      "deterministic-rerun.extract-digest",
      summaryOne.derivedDigest === summaryTwo.derivedDigest,
      "two exports of the same Case must share one derived Extract digest",
    );
    checks.push({
      name: "deterministic-rerun",
      ok: summaryOne.derivedDigest === summaryTwo.derivedDigest,
    });

    // Whole golden Extract: every non-generation file byte-stable, and the
    // reproducible manifest digest pinned to golden.
    const filesOne = readExtract(extractOne);
    const filesTwo = readExtract(extractTwo);
    let byteStable = true;
    for (const name of Object.keys(filesOne)) {
      if (name === "export_generation.json") {
        continue;
      }
      if (!filesTwo[name] || !filesOne[name].equals(filesTwo[name])) {
        byteStable = false;
      }
    }
    invariant(
      "golden-extract.byte-stable",
      byteStable,
      "non-generation Extract files must be byte-identical across reruns",
    );
    checks.push({ name: "whole-extract-byte-stable", ok: byteStable });
    const normalizedDigest = normalizedExtractDigest(extractOne);
    const golden = checkGolden("chrome-ground-truth", normalizedDigest);
    checks.push({
      name: "golden-extract-digest",
      ok: golden.status === "match" || golden.status === "updated",
    });
  }

  // Immutable Source: the recorded Source bytes never change.
  const sourceDigestAfter = sha256(readFileSync(sourceHistory));
  invariant(
    "immutable-source.bytes",
    sourceDigestBefore === sourceDigestAfter,
    "the recorded Source must be byte-identical after the full pipeline",
  );
  checks.push({
    name: "immutable-source",
    ok: sourceDigestBefore === sourceDigestAfter,
  });

  // Supersede: a second analysis run supersedes the first; exactly one active
  // History artifact result remains and two runs are recorded.
  const reanalyse = runCli([
    "analyse",
    "--case",
    caseDirectory,
    "--timezone",
    "America/New_York",
    "--json",
  ]);
  let supersedeOk = false;
  if (reanalyse.status === 0) {
    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readBigInts: true,
    });
    try {
      const runs = database
        .prepare("SELECT count(*) AS c FROM analysis_runs")
        .get();
      const active = database
        .prepare(
          "SELECT count(*) AS c FROM history_artifact_results WHERE active = 1",
        )
        .get();
      supersedeOk = runs.c === 2n && active.c === 1n;
    } finally {
      database.close();
    }
  }
  invariant(
    "supersede.single-active-artifact",
    supersedeOk,
    "re-analysis must record a new run and leave exactly one active History artifact",
  );
  checks.push({ name: "supersede", ok: supersedeOk });

  const allOk = checks.every((c) => c.ok);
  fixtures.push({
    name: "chrome-ground-truth",
    status: allOk ? "pass" : "fail",
    checks,
  });
}

/** @param {string} directory @returns {Record<string, Buffer>} */
function readExtract(directory) {
  const files = {};
  for (const name of readdirSync(directory)) {
    files[name] = readFileSync(join(directory, name));
  }
  return files;
}

// --- Fixture: broken input + scripted negative controls ---------------------

/** @param {string} root */
function runBrokenInputFixture(root) {
  const checks = [];
  const source = makeBrokenSource(root);
  const caseDirectory = join(root, "CASE-BROKEN");
  const ingest = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
  // Ingest only copies + hashes, so a corrupt-but-present History is recorded.
  // Analyse must then refuse to fabricate: it exits with a nonzero typed exit
  // state and reports the History artifact as unavailable (not complete),
  // rather than crashing or inventing rows.
  let refused = false;
  let outcome = { status: ingest.status, stderr: ingest.stderr };
  if (ingest.status === 0) {
    const analyse = runCli(["analyse", "--case", caseDirectory, "--json"]);
    outcome = { status: analyse.status, stdout: analyse.stdout.slice(0, 200) };
    // Exit states: 2 = partial, 3 = failed. Either is an honest nonzero exit.
    const honestExit = analyse.status === 2 || analyse.status === 3;
    let honestReport = false;
    try {
      const s = parseJson(analyse.stdout);
      honestReport =
        s.history?.status !== "complete" &&
        s.history?.unavailableProfileCount >= 1 &&
        s.history?.committedVisitCount === 0 &&
        s.history?.recoveredVisitCount === 0;
    } catch {
      honestReport = false;
    }
    refused = honestExit && honestReport;
  } else {
    try {
      refused = typeof parseJson(ingest.stderr).code === "string";
    } catch {
      refused = false;
    }
  }
  invariant(
    "broken-input.honest-unavailable",
    refused,
    `corrupt History must yield an honest nonzero exit with an unavailable artifact (no fabricated rows), got ${JSON.stringify(outcome)}`,
  );
  checks.push({ name: "broken-input", ok: refused });
  fixtures.push({
    name: "broken-input",
    status: refused ? "pass" : "fail",
    checks,
  });
}

// --- Capability table: UNCOVERED behaviors via typed refusals ---------------

/** @param {string} root */
function runUncoveredCapabilities(root) {
  const source = makeGroundTruthSource(join(root, "cap"));
  const caseDirectory = join(root, "CASE-CAP");
  runCli(["ingest", source, "--case", caseDirectory, "--json"]);
  runCli([
    "analyse",
    "--case",
    caseDirectory,
    "--timezone",
    "America/New_York",
    "--json",
  ]);

  // Unsupported Extract collection: refused with INVALID_ARGUMENT.
  capabilityUncovered(
    "export.collection.telemetry",
    runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      join(root, "cap-out"),
      "--collection",
      "telemetry",
      "--json",
    ]),
  );

  // Unsupported timezone-less range bound: refused with INVALID_ARGUMENT.
  capabilityUncovered(
    "history.range.timezone-less",
    runCli([
      "history",
      "--case",
      caseDirectory,
      "--from",
      "2024-01-02T03:04:05",
      "--limit",
      "10",
      "--json",
    ]),
  );

  // Unknown command: refused, not crashed.
  capabilityUncovered("command.unknown", runCli(["frobnicate", "--json"]));
}

// --- Negative control: empty / non-Chrome Source ----------------------------

/** @param {string} root */
function runNegativeControl(root) {
  // A Source path that does not exist must be refused with a typed error and
  // exit 1, never a stack trace or a silently empty Case.
  const missing = join(root, "does-not-exist");
  const caseDirectory = join(root, "CASE-MISSING");
  const ingest = runCli(["ingest", missing, "--case", caseDirectory, "--json"]);
  let code = null;
  if (ingest.status === 1) {
    try {
      const parsed = parseJson(ingest.stdout || ingest.stderr);
      code = typeof parsed.code === "string" ? parsed.code : null;
    } catch {
      code = null;
    }
  }
  const refused = code !== null;
  invariant(
    "negative-control.missing-source",
    refused,
    `a missing Source path must be refused with a typed error (exit 1 + code), got status ${ingest.status}`,
  );
  fixtures.push({
    name: "negative-control",
    status: refused ? "pass" : "fail",
    checks: [{ name: "missing-source-refused", ok: refused, code }],
  });
}

// --- Main -------------------------------------------------------------------

function main() {
  const root = mkdtempSync(join(tmpdir(), "forensix-offline-verify-"));
  try {
    runGroundTruthFixture(root);
    runBrokenInputFixture(root);
    runUncoveredCapabilities(root);
    runNegativeControl(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  const ok = failures.length === 0;
  const report = {
    schema: REPORT_SCHEMA,
    tool: { version: readToolVersion(), gitSha: gitSha() },
    startedAt: new Date().toISOString(),
    goldenMode: updateGolden ? (inCi ? "refused-in-ci" : "update") : "verify",
    capabilities,
    invariants,
    fixtures,
    failures,
    ok,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const passCount = capabilities.filter((c) => c.status === "PASS").length;
  const uncoveredCount = capabilities.filter(
    (c) => c.status === "UNCOVERED",
  ).length;
  process.stderr.write(
    `offline-verification: ${ok ? "OK" : "FAILED"} — ` +
      `${passCount} PASS, ${uncoveredCount} UNCOVERED, ` +
      `${invariants.length} invariants, ${fixtures.length} fixtures, ` +
      `${failures.length} failures\n`,
  );
  for (const failure of failures) {
    process.stderr.write(
      `  ✗ [${failure.scope}] ${failure.name}: ${failure.message}\n`,
    );
  }
  process.exit(ok ? 0 : 1);
}

function readToolVersion() {
  const result = runCli(["--version"]);
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

main();
