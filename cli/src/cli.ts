#!/usr/bin/env node

import {
  ANALYSE_EXIT_CODES,
  ForensixError,
  MINIMUM_NODE_VERSION,
  SOURCE_KINDS,
  TOOL_VERSION,
  analyseCase,
  exportCase,
  ingestSource,
  querySummary,
  renderReport,
  type CommitState,
  type DeclaredOriginOs,
  type ExtractCollection,
  type IngestProgress,
  type IngestResult,
  type SourceKind,
} from "@forensix/core";
import { startDashboardServer } from "@forensix/server";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAllowedOptions,
  assertArgumentsHaveNoControlCharacters,
  assertNoParentSegments,
  enumOption,
  hasOption,
  integerOption,
  optionValue,
  optionValues,
  parseArguments,
  rawPositionals,
  requiredCasePath,
} from "./args.js";
import {
  AUDIT_KEY_BYTES,
  appendAuditEntry,
  assertAuditLogOutsideEvidence,
  verifyAuditLog,
  type AuditStamp,
} from "./audit.js";
import { CliError } from "./cli-error.js";
import {
  PAGED_OUTPUT_OPTIONS,
  QUERY_OUTPUT_OPTIONS,
  RECORD_OUTPUT_OPTIONS,
  readOutputControls,
  runQueryCommand,
} from "./output.js";
import { QUERY_COMMANDS } from "./query-commands.js";
import { listSkills, readSkill } from "./skills.js";
import { commandUsage, fullUsage } from "./usage.js";

/**
 * Release-injected build identity. The release workflow
 * writes `build-info.json` next to the compiled CLI with the published version
 * and the exact git SHA it was built from. When present it is appended to the
 * reported version as `<version>+<gitSha>`. Reading it is a local file read
 * only — no network, no git invocation — so the offline invariant holds.
 */
function resolveToolVersion(): string {
  try {
    const buildInfoPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "build-info.json",
    );
    const info = JSON.parse(readFileSync(buildInfoPath, "utf8")) as {
      readonly version?: unknown;
      readonly gitSha?: unknown;
    };
    if (typeof info.version === "string" && typeof info.gitSha === "string") {
      return `${info.version}+${info.gitSha}`;
    }
  } catch {
    // No build stamp (dev tree): fall back to the compiled tool version.
  }
  return TOOL_VERSION;
}

function nodeVersionIsSupported(version: string): boolean {
  const actual = version.split(".").map((part) => Number(part));
  const minimum = MINIMUM_NODE_VERSION.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart !== minimumPart) {
      return actualPart > minimumPart;
    }
  }
  return true;
}

async function consumeIngest(
  operation: AsyncGenerator<IngestProgress, IngestResult>,
  showProgress: boolean,
): Promise<IngestResult> {
  while (true) {
    const step = await operation.next();
    if (step.done) {
      return step.value;
    }
    if (showProgress) {
      process.stderr.write(`[${step.value.phase}] ${step.value.message}\n`);
    }
  }
}

/**
 * What one command prints. `documents` are JSON objects, one per line (a lazy
 * iterable for paged output); `text` is printed as is. The emitter adds the
 * audit stamp and writes them.
 */
interface CommandOutcome {
  readonly exitCode: number;
  readonly stream: "stdout" | "stderr";
  readonly documents?: Iterable<object>;
  readonly text?: string;
  /** Help and version output, and verifying the audit log itself. */
  readonly skipAudit?: boolean;
  /** Runs after the output is written (serve keeps running). */
  readonly afterEmit?: () => void;
}

/** Options every command accepts. */
const GLOBAL_OPTIONS: readonly string[] = ["--audit-log"];

function allowing(...groups: readonly Iterable<string>[]): Set<string> {
  return new Set([...GLOBAL_OPTIONS, ...groups.flatMap((group) => [...group])]);
}

function printed(document: object, exitCode = 0): CommandOutcome {
  return { exitCode, stream: "stdout", documents: [document] };
}

async function run(
  arguments_: readonly string[],
  auditEnabled: boolean,
): Promise<CommandOutcome> {
  if (!nodeVersionIsSupported(process.versions.node)) {
    throw new ForensixError(
      "UNSUPPORTED_NODE_VERSION",
      `ForensiX needs Node ${MINIMUM_NODE_VERSION} or newer.`,
      { actual: process.versions.node, minimum: MINIMUM_NODE_VERSION },
    );
  }
  assertArgumentsHaveNoControlCharacters(arguments_);
  if (arguments_.length === 0 || arguments_.includes("--help")) {
    const command = arguments_[0];
    const usage = command === undefined ? undefined : commandUsage(command);
    return {
      exitCode: 0,
      stream: "stdout",
      text: usage ?? fullUsage(),
      skipAudit: true,
    };
  }
  if (arguments_.length === 1 && arguments_[0] === "--version") {
    return {
      exitCode: 0,
      stream: "stdout",
      text: `${resolveToolVersion()}\n`,
      skipAudit: true,
    };
  }

  const parsed = parseArguments(arguments_);
  const jsonOutput = hasOption(parsed, "--json");
  if (parsed.command === "ingest") {
    assertAllowedOptions(
      parsed,
      allowing(["--case", "--json", "--include-tier-2", "--source-kind"]),
    );
    if (parsed.positionals.length !== 1) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The ingest command needs one Source path.",
      );
    }
    const sourcePath = parsed.positionals[0];
    if (sourcePath === undefined) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The Source path is missing.",
      );
    }
    const requestedKind =
      optionValue(parsed, "--source-kind") ?? "USER_DATA_DIR";
    if (!SOURCE_KINDS.includes(requestedKind as SourceKind)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Unsupported Source kind: ${String(requestedKind)}`,
      );
    }
    const result = await consumeIngest(
      ingestSource({
        sourcePath,
        sourceKind: requestedKind as SourceKind,
        caseDirectory: requiredCasePath(parsed),
        includeTier2: hasOption(parsed, "--include-tier-2"),
      }),
      !jsonOutput,
    );
    return printed(result);
  }

  if (parsed.command === "analyse") {
    assertAllowedOptions(
      parsed,
      allowing([
        "--case",
        "--json",
        "--timezone",
        "--origin-os",
        "--decrypt",
        "--key-material",
        "--recipient-key",
        "--no-topic-classification",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The analyse command accepts no positional values.",
      );
    }
    const decryptionEnabled = hasOption(parsed, "--decrypt");
    const topicClassificationEnabled = !hasOption(
      parsed,
      "--no-topic-classification",
    );
    const keyMaterialPath = optionValue(parsed, "--key-material");
    const recipientKeyPath = optionValue(parsed, "--recipient-key");
    if (
      !decryptionEnabled &&
      (keyMaterialPath !== undefined || recipientKeyPath !== undefined)
    ) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Key material options require the explicit --decrypt opt-in.",
      );
    }
    const result = await analyseCase({
      caseDirectory: requiredCasePath(parsed),
      declaredTimezone: optionValue(parsed, "--timezone"),
      declaredOriginOs: enumOption(parsed, "--origin-os", [
        "windows",
        "macos",
        "linux",
      ] as const) as DeclaredOriginOs | undefined,
      decryptionEnabled,
      ...(keyMaterialPath === undefined ? {} : { keyMaterialPath }),
      ...(recipientKeyPath === undefined ? {} : { recipientKeyPath }),
      topicClassification: { enabled: topicClassificationEnabled },
      invocation: arguments_,
    });
    return printed(result, ANALYSE_EXIT_CODES[result.exitState]);
  }

  const queryCommand =
    parsed.command === undefined
      ? undefined
      : QUERY_COMMANDS.get(parsed.command);
  if (queryCommand !== undefined) {
    assertAllowedOptions(
      parsed,
      allowing(
        queryCommand.allowedOptions,
        QUERY_OUTPUT_OPTIONS,
        queryCommand.output === "records"
          ? RECORD_OUTPUT_OPTIONS
          : queryCommand.evidence === undefined
            ? []
            : ["--content-boundaries"],
        queryCommand.paged ? PAGED_OUTPUT_OPTIONS : [],
      ),
      queryCommand.repeatableOptions,
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `The ${parsed.command ?? ""} command accepts no positional values.`,
      );
    }
    const controls = readOutputControls(
      parsed,
      queryCommand,
      auditEnabled ? AUDIT_KEY_BYTES : 0,
    );
    return {
      exitCode: 0,
      stream: "stdout",
      documents: runQueryCommand(queryCommand, parsed, controls),
    };
  }

  if (parsed.command === "skill") {
    assertAllowedOptions(parsed, allowing(["--json"]));
    const [action, name, ...extra] = parsed.positionals;
    if (action === "list" && name === undefined) {
      const skills = listSkills();
      if (jsonOutput) {
        return printed({ status: "ok", command: "skill-list", skills });
      }
      return {
        exitCode: 0,
        stream: "stdout",
        text: skills
          .map((skill) => `${skill.name}\t${skill.description}\n`)
          .join(""),
      };
    }
    if (action === "get" && name !== undefined && extra.length === 0) {
      const skill = readSkill(name);
      if (jsonOutput) {
        return printed({ status: "ok", command: "skill-get", ...skill });
      }
      return { exitCode: 0, stream: "stdout", text: skill.content };
    }
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Use forensix skill list, or forensix skill get <name>.",
      { positionals: parsed.positionals },
    );
  }

  if (parsed.command === "audit") {
    assertAllowedOptions(parsed, allowing(["--log", "--json"]));
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "verify") {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Use forensix audit verify --log <audit-log-file>.",
        { positionals: parsed.positionals },
      );
    }
    const log = optionValue(parsed, "--log");
    if (log === undefined) {
      throw new ForensixError("INVALID_ARGUMENT", "Option --log is required.");
    }
    const verification = verifyAuditLog(resolve(log));
    return {
      ...printed(verification, verification.valid ? 0 : 1),
      // Appending to the log under check would change what was checked.
      skipAudit: resolve(log) === auditLogPath(arguments_),
    };
  }

  if (parsed.command === "export") {
    assertAllowedOptions(
      parsed,
      allowing([
        "--case",
        "--json",
        "--out",
        "--collection",
        "--profile",
        "--commit-state",
        "--examiner",
        "--csv",
        "--include-secrets",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The export command accepts no positional values.",
      );
    }
    assertNoParentSegments(parsed, "--out");
    const outDirectory = optionValue(parsed, "--out");
    if (outDirectory === undefined) {
      throw new ForensixError("INVALID_ARGUMENT", "Option --out is required.");
    }
    const collections = optionValues(parsed, "--collection");
    for (const collection of collections) {
      if (collection !== "findings" && collection !== "candidates") {
        throw new ForensixError(
          "INVALID_ARGUMENT",
          `Option --collection has an unsupported value: ${collection}`,
          { option: "--collection", value: collection },
        );
      }
    }
    const result = await exportCase({
      caseDirectory: requiredCasePath(parsed),
      outDirectory,
      examiner: optionValue(parsed, "--examiner"),
      profiles: optionValues(parsed, "--profile"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      collections:
        collections.length === 0
          ? undefined
          : (collections as ExtractCollection[]),
      csv: hasOption(parsed, "--csv"),
      includeSecrets: hasOption(parsed, "--include-secrets"),
    });
    return printed(result);
  }

  if (parsed.command === "report") {
    assertAllowedOptions(parsed, allowing(["--extract", "--out", "--json"]));
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The report command accepts no positional values.",
      );
    }
    assertNoParentSegments(parsed, "--extract");
    assertNoParentSegments(parsed, "--out");
    const extractDirectory = optionValue(parsed, "--extract");
    if (extractDirectory === undefined) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Option --extract is required.",
      );
    }
    const outputPath = optionValue(parsed, "--out");
    if (outputPath === undefined) {
      throw new ForensixError("INVALID_ARGUMENT", "Option --out is required.");
    }
    const result = await renderReport({ extractDirectory, outputPath });
    return printed(result);
  }

  if (parsed.command === "serve") {
    assertAllowedOptions(parsed, allowing(["--case", "--json", "--port"]));
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The serve command accepts no positional values.",
      );
    }
    const port = integerOption(parsed, "--port");
    if (port !== undefined && (port < 0 || port > 65535)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "Option --port must be between 0 and 65535.",
        { port },
      );
    }
    const server = await startDashboardServer({
      caseDirectory: requiredCasePath(parsed),
      port,
    });
    const announcement = {
      status: "ok",
      command: "serve",
      url: server.url,
      host: server.host,
      port: server.port,
      token: server.token,
    };
    return {
      ...printed(announcement),
      afterEmit: () => {
        if (!jsonOutput) {
          process.stderr.write(
            `ForensiX read-only dashboard on ${server.url} (loopback only). ` +
              `Press Ctrl+C to stop.\n`,
          );
        }
        const stop = (): void => {
          void server.close().then(() => {
            process.exit(0);
          });
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        // The listening loopback socket keeps the process alive until stopped.
      },
    };
  }

  throw new ForensixError(
    "INVALID_ARGUMENT",
    `Unknown command: ${parsed.command ?? ""}`,
  );
}

function diagnosticOf(error: unknown, arguments_: readonly string[]): object {
  if (error instanceof ForensixError || error instanceof CliError) {
    return error.toDiagnostic();
  }
  return new ForensixError(
    arguments_[0] === "ingest" ? "INGEST_FAILED" : "ANALYSIS_FAILED",
    "ForensiX stopped before completion.",
    {},
    { cause: error },
  ).toDiagnostic();
}

function failed(error: unknown, arguments_: readonly string[]): CommandOutcome {
  return {
    exitCode: 1,
    stream: "stderr",
    documents: [diagnosticOf(error, arguments_)],
  };
}

/** The value after the first `--audit-log`, else FORENSIX_AUDIT_LOG. Read
 *  from the raw arguments so a command that fails to parse is logged too. */
function auditLogPath(arguments_: readonly string[]): string | undefined {
  const index = arguments_.indexOf("--audit-log");
  const value =
    index === -1 ? process.env.FORENSIX_AUDIT_LOG : arguments_[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    return undefined;
  }
  return resolve(value);
}

function caseDirectoryOf(arguments_: readonly string[]): string | null {
  const index = arguments_.indexOf("--case");
  const value = index === -1 ? undefined : arguments_[index + 1];
  return value === undefined || value.startsWith("--") ? null : resolve(value);
}

/**
 * A closed downstream pipe (`forensix ... | head`) is a normal end: exit 0
 * without a stack trace. A closed stderr never stops a running command.
 */
function guardPipes(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    process.exit(error.code === "EPIPE" ? 0 : 1);
  });
  process.stderr.on("error", () => {
    // Progress and diagnostics are best effort once stderr is closed.
  });
}

function write(stream: "stdout" | "stderr", text: string): void {
  (stream === "stdout" ? process.stdout : process.stderr).write(text);
}

function line(document: object, stamp?: AuditStamp): string {
  return `${JSON.stringify(stamp === undefined ? document : { ...document, audit: stamp })}\n`;
}

/** Writes the outcome. With an audit log, the whole output is built first, its
 *  hash goes into the appended entry, and only then is it printed with the
 *  `audit` stamp; without one, pages stream as they are read. */
function emit(
  outcome: CommandOutcome,
  arguments_: readonly string[],
  logPath: string | undefined,
): number {
  if (logPath === undefined || outcome.skipAudit === true) {
    if (outcome.text !== undefined) {
      write(outcome.stream, outcome.text);
    }
    try {
      for (const document of outcome.documents ?? []) {
        write(outcome.stream, line(document));
      }
    } catch (error) {
      write("stderr", line(diagnosticOf(error, arguments_)));
      return 1;
    }
    return outcome.exitCode;
  }

  const spool = spoolOutput(outcome, arguments_);
  try {
    let stamp: AuditStamp;
    try {
      if (spool.error !== null) throw spool.error;
      stamp = appendAuditEntry(logPath, {
        toolVersion: resolveToolVersion(),
        command: arguments_[0] ?? null,
        argv: arguments_,
        caseDirectory: caseDirectoryOf(arguments_),
        exitCode: spool.outcome.exitCode,
        outputSha256: spool.outputSha256,
      });
    } catch (error) {
      // No unaudited output when an audit log was asked for.
      write("stderr", line(diagnosticOf(error, arguments_)));
      return 1;
    }
    const final = spool.outcome;
    if (final.text !== undefined) {
      write(final.stream, final.text);
    }
    try {
      for (const spooled of readLines(spool.path)) {
        write(final.stream, stampLine(spooled, stamp));
      }
    } catch (error) {
      write("stderr", line(diagnosticOf(auditFailure(error), arguments_)));
      return 1;
    }
    return final.exitCode;
  } finally {
    spool.cleanup();
  }
}

interface Spool {
  /** The outcome to print: the command's, or its error if a page failed. */
  readonly outcome: CommandOutcome;
  readonly path: string;
  readonly outputSha256: string;
  /** A spool failure (temp directory, write): audited output is impossible. */
  readonly error: unknown;
  cleanup(): void;
}

function auditFailure(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : new CliError(
        "AUDIT_LOG_FAILED",
        "The audited output could not be spooled to a temporary file.",
        { cause: error instanceof Error ? error.message : String(error) },
      );
}

/** Writes one outcome's unstamped lines to `path` and hashes them. */
function writeSpool(path: string, source: CommandOutcome): string {
  const hash = createHash("sha256");
  if (source.text !== undefined) hash.update(source.text, "utf8");
  const descriptor = openSync(path, "w", 0o600);
  try {
    for (const document of source.documents ?? []) {
      const text = line(document);
      hash.update(text, "utf8");
      try {
        writeSync(descriptor, text);
      } catch (error) {
        throw new SpoolWriteError(error);
      }
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

/** A write to the spool file failed (as opposed to the command's pages). */
class SpoolWriteError extends Error {
  public constructor(cause: unknown) {
    super("The spool file could not be written.", { cause });
  }
}

/**
 * Writes the unstamped output lines to a private temporary file while hashing
 * them, so an audited --page-all stays in bounded memory. A page that fails
 * part way replaces the whole output with that error (the descriptor is
 * closed first). Every spool file error comes back as AUDIT_LOG_FAILED, and
 * cleanup is best effort.
 */
function spoolOutput(
  outcome: CommandOutcome,
  arguments_: readonly string[],
): Spool {
  let directory: string | undefined;
  const cleanup = (): void => {
    if (directory === undefined) return;
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Best effort: the private temp directory holds only printed output.
    }
  };
  try {
    directory = mkdtempSync(join(tmpdir(), "forensix-audit-"));
    const path = join(directory, "output.ndjson");
    let final = outcome;
    let outputSha256: string;
    try {
      outputSha256 = writeSpool(path, final);
    } catch (error) {
      if (error instanceof SpoolWriteError) throw error.cause;
      // A page failed part way: audit and print only the error.
      final = failed(error, arguments_);
      outputSha256 = writeSpool(path, final);
    }
    return { outcome: final, path, outputSha256, error: null, cleanup };
  } catch (error) {
    return {
      outcome,
      path: "",
      outputSha256: "",
      error: auditFailure(error),
      cleanup,
    };
  }
}

/** Adds the audit stamp as the last key of one printed JSON object line. */
function stampLine(text: string, stamp: AuditStamp): string {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const stampJson = JSON.stringify(stamp);
  if (body === "{}") {
    return `{"audit":${stampJson}}\n`;
  }
  return `${body.slice(0, -1)},"audit":${stampJson}}\n`;
}

/** Reads a file line by line (each line keeps its newline) in fixed chunks. */
function* readLines(path: string): Generator<string> {
  const descriptor = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0);
    while (true) {
      const read = readSync(descriptor, chunk, 0, chunk.length, null);
      if (read === 0) break;
      pending = Buffer.concat([pending, chunk.subarray(0, read)]);
      let newline = pending.indexOf(0x0a);
      while (newline !== -1) {
        yield pending.subarray(0, newline + 1).toString("utf8");
        pending = pending.subarray(newline + 1);
        newline = pending.indexOf(0x0a);
      }
    }
    if (pending.length > 0) yield pending.toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Paths the audit log must stay out of: the Case Directory, the Sources the
 * Case recorded (or the Source being ingested), and an Extract or Report path.
 */
function evidenceRoots(arguments_: readonly string[]): string[] {
  const roots: string[] = [];
  const optionValueOf = (option: string): string | undefined => {
    const index = arguments_.indexOf(option);
    const value = index === -1 ? undefined : arguments_[index + 1];
    return value === undefined || value.startsWith("--") ? undefined : value;
  };
  for (const option of ["--case", "--out", "--extract"]) {
    const value = optionValueOf(option);
    if (value !== undefined) roots.push(resolve(value));
  }
  if (arguments_[0] === "ingest") {
    // From the raw arguments, so a malformed ingest still protects its Source.
    for (const source of rawPositionals(arguments_)) {
      roots.push(resolve(source));
    }
  }
  const caseDirectory = caseDirectoryOf(arguments_);
  if (caseDirectory !== null) {
    try {
      for (const source of querySummary({ caseDirectory }).sources) {
        roots.push(resolve(source.sourcePath));
      }
    } catch {
      // No readable Case: only its directory is protected.
    }
  }
  return roots;
}

guardPipes();
const cliArguments = process.argv.slice(2);
const logPath = auditLogPath(cliArguments);
let auditLog: string | undefined;
let refusedLog: unknown = null;
if (logPath !== undefined) {
  try {
    // Before the command runs: an audit log inside evidence refuses the
    // whole command, so nothing is written to the Case, Source, or Extract.
    auditLog = assertAuditLogOutsideEvidence(
      logPath,
      evidenceRoots(cliArguments),
    );
  } catch (error) {
    refusedLog = error;
  }
}
if (refusedLog !== null) {
  write("stderr", line(diagnosticOf(refusedLog, cliArguments)));
  process.exitCode = 1;
} else {
  let outcome: CommandOutcome;
  try {
    outcome = await run(cliArguments, auditLog !== undefined);
  } catch (error) {
    outcome = failed(error, cliArguments);
  }
  process.exitCode = emit(outcome, cliArguments, auditLog);
  outcome.afterEmit?.();
}
