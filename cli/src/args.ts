import { ForensixError, parseOption } from "@forensix/core";

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
  "--page-all",
]);
const VALUE_OPTIONS = new Set([
  "--case",
  "--dir",
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
]);
/** The only options that may repeat. A command that reads one of them as a
 *  single value refuses a repeat (see {@link optionValue}). */
const REPEATABLE_OPTIONS = new Set(["--profile", "--collection", "--kind"]);

/** U+0000-U+001F and U+007F. No option value or positional may hold one. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

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
    if (CONTROL_CHARACTER.test(argument)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `The value of ${option} contains a control character.`,
        { option },
      );
    }
  });
}

/** Call {@link assertArgumentsHaveNoControlCharacters} first. */
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

/** The one value of an option; a repeat is INVALID_ARGUMENT. */
export function optionValue(
  arguments_: ParsedArguments,
  option: string,
): string | undefined {
  const values = optionValues(arguments_, option);
  if (values.length > 1) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option is repeated: ${option}`,
      { option },
    );
  }
  return values[0];
}

export function requiredOption(
  arguments_: ParsedArguments,
  option: string,
): string {
  const value = optionValue(arguments_, option);
  if (value === undefined) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} is required.`,
      { option },
    );
  }
  return value;
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
      { invalidOptions: invalid },
    );
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
  return parseOption(optionValue(arguments_, option), option, values);
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
