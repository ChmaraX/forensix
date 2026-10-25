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
  "--content-boundaries",
  "--page-all",
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
  "--id",
  "--by",
  "--fields",
  "--supporting-rows",
  "--max-output",
  "--audit-log",
  "--log",
]);
/** Options the parser lets repeat. A command accepts a repeat only when the
 *  option is also in its own repeatable set (see {@link assertAllowedOptions}). */
const REPEATABLE_OPTIONS = new Set(["--profile", "--collection", "--kind"]);
/** The repeatable set a command gets when it names none. */
export const DEFAULT_REPEATABLE_OPTIONS: ReadonlySet<string> = new Set([
  "--profile",
  "--collection",
]);

/** U+0000-U+001F and U+007F. No option value or positional may hold one. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function assertNoControlCharacters(value: string, option: string): void {
  if (CONTROL_CHARACTER.test(value)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `The value of ${option} contains a control character.`,
      { option },
    );
  }
}

/**
 * Refuses a control character in any argument before any other handling,
 * including `--help`, which answers before the arguments are parsed.
 */
export function assertArgumentsHaveNoControlCharacters(
  arguments_: readonly string[],
): void {
  arguments_.forEach((argument, index) => {
    const previous = index === 0 ? undefined : arguments_[index - 1];
    const option =
      index === 0
        ? "command"
        : argument.startsWith("--")
          ? "option"
          : previous !== undefined && VALUE_OPTIONS.has(previous)
            ? previous
            : "positional";
    assertNoControlCharacters(argument, option);
  });
}

/**
 * The positional arguments after the command, read without validation: every
 * argument that is not an option and not the value of a known value option.
 * Used where a command failed to parse but its paths must still be known.
 */
export function rawPositionals(arguments_: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    if (argument.startsWith("--")) {
      if (VALUE_OPTIONS.has(argument)) index += 1;
      continue;
    }
    positionals.push(argument);
  }
  return positionals;
}

export function parseArguments(arguments_: readonly string[]): ParsedArguments {
  const [command, ...remaining] = arguments_;
  if (command !== undefined) {
    assertNoControlCharacters(command, "command");
  }
  const positionals: string[] = [];
  const options = new Map<string, OptionValue[]>();

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      assertNoControlCharacters(argument, "positional");
      positionals.push(argument);
      continue;
    }
    assertNoControlCharacters(argument, "option");
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
    assertNoControlCharacters(value, argument);
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
  repeatable: ReadonlySet<string> = DEFAULT_REPEATABLE_OPTIONS,
): void {
  const invalid = [...arguments_.options.keys()].filter(
    (option) => !allowed.has(option),
  );
  if (invalid.length > 0) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `The ${arguments_.command ?? "unknown"} command has invalid options.`,
      { invalidOptions: invalid },
    );
  }
  for (const [option, values] of arguments_.options) {
    if (values.length > 1 && !repeatable.has(option)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `Option is repeated: ${option}`,
        { option },
      );
    }
  }
}

/**
 * Rejects a path option that holds a `..` segment. A relative path that climbs
 * out of the working directory is easy to misread in a Case record; an
 * absolute path is not.
 */
export function assertNoParentSegments(
  arguments_: ParsedArguments,
  option: string,
): void {
  const value = optionValue(arguments_, option);
  if (value !== undefined && value.split(/[\\/]/).includes("..")) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} must not contain a ".." path segment. Use an absolute path.`,
      { option, value },
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
