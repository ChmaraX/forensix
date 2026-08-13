#!/usr/bin/env node

import {
  ForensixError,
  MINIMUM_NODE_VERSION,
  TOOL_VERSION,
  analyseCase,
  ingestUserDataDir,
  queryHistory,
  type CommitState,
  type DeclaredOriginOs,
  type HistoryDirection,
  type HistorySort,
  type HistoryView,
  type IngestProgress,
  type IngestResult,
} from "@forensix/core";

const USAGE = `Usage:
  forensix ingest <user-data-dir> --case <case-directory> [--include-tier-2] [--json]
  forensix analyse --case <case-directory> [--timezone <iana-zone>] [--origin-os <windows|macos|linux>] [--json]
  forensix history --case <case-directory> [--view <visits|activity|most-visited|durations>]
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--transition <name>] [--from <instant>] [--to <instant>]
                   [--sort <field>] [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix --version
`;

type OptionValue = string | true;

interface ParsedArguments {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, readonly OptionValue[]>;
}

const FLAG_OPTIONS = new Set(["--json", "--include-tier-2"]);
const VALUE_OPTIONS = new Set([
  "--case",
  "--timezone",
  "--origin-os",
  "--view",
  "--profile",
  "--search",
  "--commit-state",
  "--transition",
  "--from",
  "--to",
  "--sort",
  "--direction",
  "--limit",
  "--after",
]);
const REPEATABLE_OPTIONS = new Set(["--profile"]);

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  const [command, ...remaining] = arguments_;
  const positionals: string[] = [];
  const options = new Map<string, OptionValue[]>();

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (!FLAG_OPTIONS.has(argument) && !VALUE_OPTIONS.has(argument)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Unknown option: ${argument}`,
      );
    }
    const existing = options.get(argument);
    if (existing !== undefined && !REPEATABLE_OPTIONS.has(argument)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Option is repeated: ${argument}`,
      );
    }
    if (FLAG_OPTIONS.has(argument)) {
      options.set(argument, [true]);
      continue;
    }
    const value = remaining[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Option ${argument} needs a value.`,
      );
    }
    options.set(argument, [...(existing ?? []), value]);
    index += 1;
  }

  return { command, positionals, options };
}

function hasOption(arguments_: ParsedArguments, option: string): boolean {
  return arguments_.options.has(option);
}

function optionValues(arguments_: ParsedArguments, option: string): string[] {
  return (arguments_.options.get(option) ?? []).filter(
    (value): value is string => typeof value === "string",
  );
}

function optionValue(
  arguments_: ParsedArguments,
  option: string,
): string | undefined {
  return optionValues(arguments_, option)[0];
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
  const casePath = optionValue(arguments_, "--case");
  if (casePath === undefined) {
    throw new ForensixError("INVALID_ARGUMENT", "Option --case is required.");
  }
  return casePath;
}

function assertAllowedOptions(
  arguments_: ParsedArguments,
  allowed: ReadonlySet<string>,
): void {
  const invalid = [...arguments_.options.keys()].filter(
    (option) => !allowed.has(option),
  );
  if (invalid.length > 0) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `The ${arguments_.command ?? "unknown"} command has invalid options.`,
      { invalid_options: invalid },
    );
  }
}

function enumOption<const Values extends readonly string[]>(
  arguments_: ParsedArguments,
  option: string,
  values: Values,
): Values[number] | undefined {
  const value = optionValue(arguments_, option);
  if (value === undefined) {
    return undefined;
  }
  if (!values.includes(value)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} has an unsupported value: ${value}`,
      { option, value, allowed: values },
    );
  }
  return value as Values[number];
}

function integerOption(
  arguments_: ParsedArguments,
  option: string,
): number | undefined {
  const value = optionValue(arguments_, option);
  if (value === undefined) {
    return undefined;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} must be an integer.`,
      { option, value },
    );
  }
  return Number(value);
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
  const jsonOutput = hasOption(parsed, "--json");
  if (parsed.command === "ingest") {
    assertAllowedOptions(
      parsed,
      new Set(["--case", "--json", "--include-tier-2"]),
    );
    if (parsed.positionals.length !== 1) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The ingest command needs one User Data Dir path.",
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
        includeTier2: hasOption(parsed, "--include-tier-2"),
      }),
      !jsonOutput,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "analyse") {
    assertAllowedOptions(
      parsed,
      new Set(["--case", "--json", "--timezone", "--origin-os"]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The analyse command accepts no positional values.",
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
      invocation: arguments_,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "history") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--view",
        "--profile",
        "--search",
        "--commit-state",
        "--transition",
        "--from",
        "--to",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The history command accepts no positional values.",
      );
    }
    const result = queryHistory({
      caseDirectory: requiredCasePath(parsed),
      view: enumOption(parsed, "--view", [
        "visits",
        "activity",
        "most-visited",
        "durations",
      ] as const) as HistoryView | undefined,
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      transition: optionValue(parsed, "--transition"),
      from: optionValue(parsed, "--from"),
      to: optionValue(parsed, "--to"),
      sort: enumOption(parsed, "--sort", [
        "visit-time",
        "local-time",
        "url",
        "duration",
        "visit-count",
        "profile",
      ] as const) as HistorySort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | HistoryDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
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
          process.argv[2] === "ingest" ? "INGEST_FAILED" : "ANALYSIS_FAILED",
          "ForensiX stopped before completion.",
          {},
          { cause: error },
        ).toDiagnostic();
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exitCode = 1;
}
