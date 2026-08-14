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
  queryCookies,
  queryCredentials,
  queryHistory,
  type CommitState,
  type CookieDirection,
  type CookieSort,
  type CredentialDirection,
  type CredentialSort,
  type DeclaredOriginOs,
  type ExtractCollection,
  type HistoryDirection,
  type HistorySort,
  type HistoryView,
  type IngestProgress,
  type IngestResult,
  type SourceKind,
} from "@forensix/core";

const USAGE = `Usage:
  forensix ingest <source> --case <case-directory> [--source-kind <kind>] [--include-tier-2] [--json]
  forensix analyse --case <case-directory> [--timezone <iana-zone>] [--origin-os <windows|macos|linux>] [--json]
  forensix history --case <case-directory> [--view <visits|activity|most-visited|durations>]
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--transition <name>] [--from <instant>] [--to <instant>]
                   [--sort <field>] [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix cookies --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--host <host-key>] [--same-site <name>]
                   [--sort <host|name|creation-time|expires-time|last-access-time|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix credentials --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--sort <created-time|last-used-time|origin|username|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix export --case <case-directory> --out <output-directory>
                   [--collection <findings|candidates>]... [--profile <profile>]...
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--examiner <name>] [--csv] [--include-secrets] [--json]
  forensix --version

Source kinds:
  USER_DATA_DIR (default), PROFILE_DIR, FILESYSTEM_ROOT, IMAGE_CONTAINER, ACQUISITION_BUNDLE

analyse exit codes:
  0  clean    every artifact produced defensible results
  2  partial  some artifacts were unavailable; other results stay queryable
  3  failed   the analysis produced no defensible artifact result
  1  error    usage error, missing Case, or Working Copy integrity refusal
`;

type OptionValue = string | true;

interface ParsedArguments {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, readonly OptionValue[]>;
}

const FLAG_OPTIONS = new Set([
  "--json",
  "--include-tier-2",
  "--csv",
  "--include-secrets",
]);
const VALUE_OPTIONS = new Set([
  "--case",
  "--source-kind",
  "--timezone",
  "--origin-os",
  "--view",
  "--profile",
  "--search",
  "--commit-state",
  "--transition",
  "--from",
  "--to",
  "--host",
  "--same-site",
  "--sort",
  "--direction",
  "--limit",
  "--after",
  "--out",
  "--collection",
  "--examiner",
]);
const REPEATABLE_OPTIONS = new Set(["--profile", "--collection"]);

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
      new Set(["--case", "--json", "--include-tier-2", "--source-kind"]),
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
    return ANALYSE_EXIT_CODES[result.exitState];
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

  if (parsed.command === "cookies") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--host",
        "--same-site",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The cookies command accepts no positional values.",
      );
    }
    const result = queryCookies({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      host: optionValue(parsed, "--host"),
      sameSite: optionValue(parsed, "--same-site"),
      sort: enumOption(parsed, "--sort", [
        "host",
        "name",
        "creation-time",
        "expires-time",
        "last-access-time",
        "profile",
      ] as const) as CookieSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | CookieDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "credentials") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The credentials command accepts no positional values.",
      );
    }
    const result = queryCredentials({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      sort: enumOption(parsed, "--sort", [
        "created-time",
        "last-used-time",
        "origin",
        "username",
        "profile",
      ] as const) as CredentialSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | CredentialDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "export") {
    assertAllowedOptions(
      parsed,
      new Set([
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
