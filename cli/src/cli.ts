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
  queryAutofill,
  queryBookmarks,
  queryCache,
  queryCandidates,
  queryCookies,
  queryCredentials,
  queryDownloads,
  queryFavicons,
  queryHistory,
  queryMetadata,
  queryTopicCandidates,
  queryTopSites,
  renderReport,
  type AutofillDirection,
  type AutofillSort,
  type CandidateDirection,
  type CandidateSort,
  type BookmarkDirection,
  type BookmarkSort,
  type BookmarkSource,
  type CacheDirection,
  type CacheRecordType,
  type CacheSort,
  type CommitState,
  type CookieDirection,
  type CookieSort,
  type CredentialDirection,
  type CredentialSort,
  type DownloadDirection,
  type DownloadSort,
  type FaviconDirection,
  type FaviconSort,
  type TopicCandidateDirection,
  type TopicCandidateSort,
  type TopSiteDirection,
  type TopSiteSort,
  type DeclaredOriginOs,
  type ExtractCollection,
  type HistoryDirection,
  type HistorySort,
  type HistoryView,
  type IngestProgress,
  type IngestResult,
  type MetadataDirection,
  type MetadataSort,
  type MetadataType,
  type SourceKind,
} from "@forensix/core";
import { startDashboardServer } from "@forensix/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Release-injected build identity (issue #188, AC6). The release workflow
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

const USAGE = `Usage:
  forensix ingest <source> --case <case-directory> [--source-kind <kind>] [--include-tier-2] [--json]
  forensix analyse --case <case-directory> [--timezone <iana-zone>] [--origin-os <windows|macos|linux>]
                   [--decrypt --key-material <path> [--recipient-key <path>]] [--json]
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
  forensix top-sites --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--sort <rank|url|title|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix topic-candidates --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--label <topic-id>]
                   [--sort <rank|supporting|label|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix autofill --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--sort <created-time|last-used-time|field-name|value|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix candidates --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--category <identity|behavior>] [--kind <candidate-kind>]
                   [--sort <rank|kind|supporting-count|value|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix favicons --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--sort <icon-url|page-url|last-updated|width|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix cache --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--record-type <finding|candidate>] [--backend <simple>]
                   [--sort <key|last-used|size|entry-hash|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix downloads --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--state <in_progress|complete|cancelled|interrupted>]
                   [--danger <danger-type>]
                   [--sort <start-time|end-time|target-path|state|total-bytes|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix metadata --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--type <browser_metadata|profile_metadata>]
                   [--sort <type|profile>] [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix bookmarks --case <case-directory>
                   [--profile <profile>]... [--search <text>]
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--source <primary|backup>]
                   [--sort <name|url|date-added|folder|profile>]
                   [--direction <asc|desc>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix serve --case <case-directory> [--port <port>] [--json]
  forensix export --case <case-directory> --out <output-directory>
                   [--collection <findings|candidates>]... [--profile <profile>]...
                   [--commit-state <committed|wal_resident|journal_resident>]
                   [--examiner <name>] [--csv] [--include-secrets] [--json]
  forensix report --extract <extract-directory> --out <report.html> [--json]
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
  "--decrypt",
  "--no-topic-classification",
]);
const VALUE_OPTIONS = new Set([
  "--case",
  "--port",
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
  "--state",
  "--danger",
  "--category",
  "--kind",
  "--type",
  "--source",
  "--record-type",
  "--backend",
  "--sort",
  "--direction",
  "--limit",
  "--after",
  "--out",
  "--collection",
  "--examiner",
  "--extract",
  "--key-material",
  "--recipient-key",
  "--label",
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
    process.stdout.write(`${resolveToolVersion()}\n`);
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
      new Set([
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

  if (parsed.command === "metadata") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--type",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The metadata command accepts no positional values.",
      );
    }
    const result = queryMetadata({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      type: enumOption(parsed, "--type", [
        "browser_metadata",
        "profile_metadata",
      ] as const) as MetadataType | undefined,
      sort: enumOption(parsed, "--sort", ["type", "profile"] as const) as
        | MetadataSort
        | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | MetadataDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "bookmarks") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--source",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The bookmarks command accepts no positional values.",
      );
    }
    const result = queryBookmarks({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      source: enumOption(parsed, "--source", ["primary", "backup"] as const) as
        | BookmarkSource
        | undefined,
      sort: enumOption(parsed, "--sort", [
        "name",
        "url",
        "date-added",
        "folder",
        "profile",
      ] as const) as BookmarkSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | BookmarkDirection
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

  if (parsed.command === "top-sites") {
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
        "The top-sites command accepts no positional values.",
      );
    }
    const result = queryTopSites({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      sort: enumOption(parsed, "--sort", [
        "rank",
        "url",
        "title",
        "profile",
      ] as const) as TopSiteSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | TopSiteDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "topic-candidates") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--label",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The topic-candidates command accepts no positional values.",
      );
    }
    const result = queryTopicCandidates({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      label: optionValue(parsed, "--label"),
      sort: enumOption(parsed, "--sort", [
        "rank",
        "supporting",
        "label",
        "profile",
      ] as const) as TopicCandidateSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | TopicCandidateDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "favicons") {
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
        "The favicons command accepts no positional values.",
      );
    }
    const result = queryFavicons({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      sort: enumOption(parsed, "--sort", [
        "icon-url",
        "page-url",
        "last-updated",
        "width",
        "profile",
      ] as const) as FaviconSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | FaviconDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "cache") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--record-type",
        "--backend",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The cache command accepts no positional values.",
      );
    }
    const result = queryCache({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      recordType: enumOption(parsed, "--record-type", [
        "finding",
        "candidate",
      ] as const) as CacheRecordType | undefined,
      backend: optionValue(parsed, "--backend"),
      sort: enumOption(parsed, "--sort", [
        "key",
        "last-used",
        "size",
        "entry-hash",
        "profile",
      ] as const) as CacheSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | CacheDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "autofill") {
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
        "The autofill command accepts no positional values.",
      );
    }
    const result = queryAutofill({
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
        "field-name",
        "value",
        "profile",
      ] as const) as AutofillSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | AutofillDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "candidates") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--category",
        "--kind",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The candidates command accepts no positional values.",
      );
    }
    const result = queryCandidates({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      category: enumOption(parsed, "--category", [
        "identity",
        "behavior",
      ] as const),
      kind: optionValue(parsed, "--kind"),
      sort: enumOption(parsed, "--sort", [
        "rank",
        "kind",
        "supporting-count",
        "value",
        "profile",
      ] as const) as CandidateSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | CandidateDirection
        | undefined,
      limit: integerOption(parsed, "--limit"),
      after: optionValue(parsed, "--after"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "downloads") {
    assertAllowedOptions(
      parsed,
      new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--state",
        "--danger",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
    );
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The downloads command accepts no positional values.",
      );
    }
    const result = queryDownloads({
      caseDirectory: requiredCasePath(parsed),
      profiles: optionValues(parsed, "--profile"),
      search: optionValue(parsed, "--search"),
      commitState: enumOption(parsed, "--commit-state", [
        "committed",
        "wal_resident",
        "journal_resident",
      ] as const) as CommitState | undefined,
      state: optionValue(parsed, "--state"),
      dangerType: optionValue(parsed, "--danger"),
      sort: enumOption(parsed, "--sort", [
        "start-time",
        "end-time",
        "target-path",
        "state",
        "total-bytes",
        "profile",
      ] as const) as DownloadSort | undefined,
      direction: enumOption(parsed, "--direction", ["asc", "desc"] as const) as
        | DownloadDirection
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

  if (parsed.command === "report") {
    assertAllowedOptions(parsed, new Set(["--extract", "--out", "--json"]));
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "The report command accepts no positional values.",
      );
    }
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
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (parsed.command === "serve") {
    assertAllowedOptions(parsed, new Set(["--case", "--json", "--port"]));
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
    process.stdout.write(`${JSON.stringify(announcement)}\n`);
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
