#!/usr/bin/env node

import {
  ANALYSE_EXIT_CODES,
  COMMIT_STATES,
  ForensixError,
  MINIMUM_NODE_VERSION,
  SOURCE_KINDS,
  TOOL_VERSION,
  analyseCase,
  exportCase,
  ingestSource,
  parseOption,
  renderReport,
  type DeclaredOriginOs,
  type ExtractCollection,
  type IngestProgress,
  type IngestResult,
} from "@forensix/core";
import { startDashboardServer } from "@forensix/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  requiredOption,
} from "./args.js";
import { CliError } from "./cli-error.js";
import {
  PAGED_OUTPUT_OPTIONS,
  RECORD_OUTPUT_OPTIONS,
  readOutputControls,
  runQueryCommand,
} from "./output.js";
import { QUERY_COMMANDS } from "./query-commands.js";
import {
  DEFAULT_SKILLS_DIRECTORY,
  installSkill,
  listSkills,
  outdatedSkillCopies,
  readSkill,
} from "./skills.js";
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
 * iterable for paged output); `text` is printed as is.
 */
interface CommandOutcome {
  readonly exitCode: number;
  readonly stream: "stdout" | "stderr";
  readonly documents?: Iterable<object>;
  readonly text?: string;
  /** Runs after the output is written (serve keeps running). */
  readonly afterEmit?: () => void;
}

const ORIGIN_OSES = [
  "windows",
  "macos",
  "linux",
] as const satisfies readonly DeclaredOriginOs[];
const EXTRACT_COLLECTIONS = [
  "findings",
  "candidates",
] as const satisfies readonly ExtractCollection[];

function allowing(...groups: readonly Iterable<string>[]): Set<string> {
  return new Set(groups.flatMap((group) => [...group]));
}

function printed(document: object, exitCode = 0): CommandOutcome {
  return { exitCode, stream: "stdout", documents: [document] };
}

async function run(arguments_: readonly string[]): Promise<CommandOutcome> {
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
    };
  }
  if (arguments_.length === 1 && arguments_[0] === "--version") {
    return {
      exitCode: 0,
      stream: "stdout",
      text: `${resolveToolVersion()}\n`,
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
    const result = await consumeIngest(
      ingestSource({
        sourcePath,
        sourceKind:
          enumOption(parsed, "--source-kind", SOURCE_KINDS) ?? "USER_DATA_DIR",
        caseDirectory: requiredOption(parsed, "--case"),
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
      caseDirectory: requiredOption(parsed, "--case"),
      declaredTimezone: optionValue(parsed, "--timezone"),
      declaredOriginOs: enumOption(parsed, "--origin-os", ORIGIN_OSES),
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
        queryCommand.output === "records" ? RECORD_OUTPUT_OPTIONS : [],
        queryCommand.paged ? PAGED_OUTPUT_OPTIONS : [],
      ),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `The ${parsed.command ?? ""} command accepts no positional values.`,
      );
    }
    const controls = readOutputControls(parsed, queryCommand);
    return {
      exitCode: 0,
      stream: "stdout",
      documents: runQueryCommand(queryCommand, parsed, controls),
    };
  }

  if (parsed.command === "skill") {
    assertAllowedOptions(parsed, allowing(["--json", "--dir"]));
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
    if (action === "get" && extra.length === 0) {
      const skill = readSkill(name);
      if (jsonOutput) {
        return printed({ status: "ok", command: "skill-get", ...skill });
      }
      return { exitCode: 0, stream: "stdout", text: skill.content };
    }
    if (action === "install" && name === undefined) {
      const installed = installSkill(
        optionValue(parsed, "--dir") ?? DEFAULT_SKILLS_DIRECTORY,
      );
      return printed({ status: "ok", command: "skill-install", ...installed });
    }
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Use forensix skill get [name], forensix skill list, or forensix skill install [--dir <skills-directory>].",
      { positionals: parsed.positionals },
    );
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
    const outDirectory = requiredOption(parsed, "--out");
    const collections = optionValues(parsed, "--collection").map((value) =>
      parseOption(value, "--collection", EXTRACT_COLLECTIONS),
    );
    const result = await exportCase({
      caseDirectory: requiredOption(parsed, "--case"),
      outDirectory,
      examiner: optionValue(parsed, "--examiner"),
      profiles: optionValues(parsed, "--profile"),
      commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
      collections: collections.length === 0 ? undefined : collections,
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
    const extractDirectory = requiredOption(parsed, "--extract");
    const outputPath = requiredOption(parsed, "--out");
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
      caseDirectory: requiredOption(parsed, "--case"),
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
        // Closing the server releases its Case lock.
        const stop = (): void => {
          void server.close().finally(() => {
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

function line(document: object): string {
  return `${JSON.stringify(document)}\n`;
}

/** Writes the outcome; paged output streams as it is read. */
function emit(outcome: CommandOutcome, arguments_: readonly string[]): number {
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

/**
 * Warns once on stderr when an installed copy of the agent skill differs from
 * the one bundled with this CLI. Skipped for `skill`, help, and version.
 */
function warnOutdatedSkill(arguments_: readonly string[]): void {
  const command = arguments_[0];
  if (
    command === undefined ||
    command === "skill" ||
    command === "--version" ||
    arguments_.includes("--help")
  ) {
    return;
  }
  const outdated = outdatedSkillCopies();
  if (outdated.length === 0) return;
  write(
    "stderr",
    line({
      status: "warning",
      code: "SKILL_OUTDATED",
      message:
        "An installed ForensiX skill differs from this CLI version. " +
        "Run forensix skill install --dir <its skills directory> to update it.",
      details: { paths: outdated },
    }),
  );
}

guardPipes();
const cliArguments = process.argv.slice(2);
warnOutdatedSkill(cliArguments);
let outcome: CommandOutcome;
try {
  outcome = await run(cliArguments);
} catch (error) {
  outcome = failed(error, cliArguments);
}
process.exitCode = emit(outcome, cliArguments);
outcome.afterEmit?.();
