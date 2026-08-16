import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Absolute path to the compiled analyzer CLI every e2e spec spawns. */
export const compiledCli = resolve("cli/dist/cli.js");

export interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the compiled analyzer CLI once and capture its normalized result. Every
 * e2e spec drives the same compiled binary the same way through this helper.
 */
export function runCli(arguments_: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Parse trimmed CLI stdout as JSON with a caller-supplied result type. */
export function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

/**
 * Seed the minimal Chrome User Data Dir scaffold: a `Local State` file inside an
 * already-created source directory. Defaults to the empty-object marker every
 * fixture uses; pass `contents` for the rare source that needs a populated
 * Local State.
 */
export async function writeLocalState(
  sourceDirectory: string,
  contents = "{}\n",
): Promise<void> {
  await writeFile(join(sourceDirectory, "Local State"), contents);
}
