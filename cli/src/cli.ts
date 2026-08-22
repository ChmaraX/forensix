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
  renderReport,
  type CommitState,
  type DeclaredOriginOs,
  type ExtractCollection,
  type IngestProgress,
  type IngestResult,
  type SourceKind,
} from "@forensix/core";
import { startDashboardServer } from "@forensix/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAllowedOptions,
  enumOption,
  hasOption,
  integerOption,
  optionValue,
  optionValues,
  parseArguments,
  requiredCasePath,
} from "./args.js";
import { QUERY_COMMANDS } from "./query-commands.js";

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

const USAGE = `Usage:
  forensix ingest <source> --case <case-directory> [--source-kind <kind>] [--include-tier-2] [--json]
  forensix analyse --case <case-directory> [--timezone <iana-zone>] [--origin-os <windows|macos|linux>]
                   [--decrypt --key-material <path> [--recipient-key <path>]] [--json]
  forensix timeline --case <case-directory> [--from <instant>] [--to <instant>]
                   [--direction <asc|desc>] [--limit <1-100>] [--after <cursor>] [--json]
  forensix site-hosts --case <case-directory> [--search <text>]
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix site-findings --case <case-directory> --host <host>
                   [--limit <1-100>] [--after <cursor>] [--json]
  forensix completeness --case <case-directory> [--json]
  forensix profiles --case <case-directory> [--json]
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

  const queryCommand =
    parsed.command === undefined
      ? undefined
      : QUERY_COMMANDS.get(parsed.command);
  if (queryCommand !== undefined) {
    assertAllowedOptions(parsed, queryCommand.allowedOptions);
    if (parsed.positionals.length !== 0) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `The ${parsed.command} command accepts no positional values.`,
      );
    }
    const result = queryCommand.execute(parsed);
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
