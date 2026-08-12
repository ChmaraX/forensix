#!/usr/bin/env node

import {
  ForensixError,
  MINIMUM_NODE_VERSION,
  TOOL_VERSION,
  ingestUserDataDir,
  preflightAnalysis,
  type IngestProgress,
  type IngestResult,
} from "@forensix/core";

const USAGE = `Usage:
  forensix ingest <user-data-dir> --case <case-directory> [--include-tier-2] [--json]
  forensix analyse --case <case-directory> [--json]
  forensix --version
`;

interface ParsedArguments {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  const [command, ...remaining] = arguments_;
  const positionals: string[] = [];
  const options = new Map<string, string | true>();

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (options.has(argument)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Option is repeated: ${argument}`,
      );
    }
    if (argument === "--json" || argument === "--include-tier-2") {
      options.set(argument, true);
      continue;
    }
    if (argument === "--case") {
      const value = remaining[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new ForensixError(
          "INVALID_ARGUMENT",
          "Option --case needs a path.",
        );
      }
      options.set(argument, value);
      index += 1;
      continue;
    }
    throw new ForensixError("INVALID_ARGUMENT", `Unknown option: ${argument}`);
  }

  return { command, positionals, options };
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

function requiredCasePath(arguments_: ParsedArguments): string {
  const casePath = arguments_.options.get("--case");
  if (typeof casePath !== "string") {
    throw new ForensixError("INVALID_ARGUMENT", "Option --case is required.");
  }
  return casePath;
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

async function run(arguments_: readonly string[]): Promise<number> {
  if (!nodeVersionIsSupported(process.versions.node)) {
    throw new ForensixError(
      "UNSUPPORTED_NODE_VERSION",
      `ForensiX needs Node ${MINIMUM_NODE_VERSION} or newer.`,
      { actual: process.versions.node, minimum: MINIMUM_NODE_VERSION },
    );
  }
  if (arguments_.length === 0 || arguments_.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (arguments_.length === 1 && arguments_[0] === "--version") {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }

  const parsed = parseArguments(arguments_);
  const jsonOutput = parsed.options.has("--json");
  if (parsed.command === "ingest") {
    if (parsed.positionals.length !== 1) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The ingest command needs one User Data Dir path.",
      );
    }
    const unknownIngestOptions = [...parsed.options.keys()].filter(
      (option) =>
        option !== "--case" &&
        option !== "--json" &&
        option !== "--include-tier-2",
    );
    if (unknownIngestOptions.length > 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The ingest command has an invalid option.",
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
      ingestUserDataDir({
        sourcePath,
        caseDirectory: requiredCasePath(parsed),
        includeTier2: parsed.options.has("--include-tier-2"),
      }),
      !jsonOutput,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "analyse") {
    if (
      parsed.positionals.length !== 0 ||
      parsed.options.has("--include-tier-2")
    ) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The analyse command accepts only --case and --json.",
      );
    }
    const result = await preflightAnalysis(requiredCasePath(parsed));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  throw new ForensixError(
    "INVALID_ARGUMENT",
    `Unknown command: ${parsed.command ?? ""}`,
  );
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  const diagnostic =
    error instanceof ForensixError
      ? error.toDiagnostic()
      : new ForensixError(
          "INGEST_FAILED",
          "ForensiX stopped before completion.",
          {},
          {
            cause: error,
          },
        ).toDiagnostic();
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = 1;
}
