import { ForensixError } from "@forensix/core";

/**
 * Command-line argument parsing shared by the CLI entry point and the
 * declarative query-command table. This module owns the option vocabulary and
 * the typed accessors; it performs no I/O and holds no forensic logic.
 */

export type OptionValue = string | true;

export interface ParsedArguments {
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

export function parseArguments(arguments_: readonly string[]): ParsedArguments {
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

export function hasOption(
  arguments_: ParsedArguments,
  option: string,
): boolean {
  return arguments_.options.has(option);
}

export function optionValues(
  arguments_: ParsedArguments,
  option: string,
): string[] {
  return (arguments_.options.get(option) ?? []).filter(
    (value): value is string => typeof value === "string",
  );
}

export function optionValue(
  arguments_: ParsedArguments,
  option: string,
): string | undefined {
  return optionValues(arguments_, option)[0];
}

export function requiredCasePath(arguments_: ParsedArguments): string {
  const casePath = optionValue(arguments_, "--case");
  if (casePath === undefined) {
    throw new ForensixError("INVALID_ARGUMENT", "Option --case is required.");
  }
  return casePath;
}

export function assertAllowedOptions(
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

export function enumOption<const Values extends readonly string[]>(
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

export function integerOption(
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
