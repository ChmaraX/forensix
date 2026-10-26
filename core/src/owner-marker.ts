import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A ForensiX owner record names the process that owns a temporary directory
 * or a lock. A sweep removes a directory only when its record is a ForensiX
 * record and its PID is dead. A missing, unreadable or foreign record keeps
 * the directory.
 */
interface ForensixOwner {
  readonly tool: "forensix";
  readonly pid: number;
  readonly nonce: string;
}

/** True unless the PID surely names no process (EPERM: it exists, not ours). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function newOwner(): ForensixOwner {
  return { tool: "forensix", pid: process.pid, nonce: randomUUID() };
}

/** The ForensiX owner record in `text`, or null when it is not one. */
function parseOwner(text: string): ForensixOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { tool, pid, nonce } = value as Record<string, unknown>;
  return tool === "forensix" &&
    Number.isSafeInteger(pid) &&
    (pid as number) > 0 &&
    typeof nonce === "string" &&
    nonce.length > 0
    ? (value as ForensixOwner)
    : null;
}

const OWNER_MARKER_FILE = ".forensix-owner";

/** Write the owner record of this process into `directory`. */
export async function writeOwnerMarker(directory: string): Promise<void> {
  await writeFile(
    join(directory, OWNER_MARKER_FILE),
    `${JSON.stringify(newOwner())}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

/** True only when `directory` holds a ForensiX owner record of a dead PID. */
export async function ownerIsDead(directory: string): Promise<boolean> {
  const text = await readFile(join(directory, OWNER_MARKER_FILE), "utf8").catch(
    () => null,
  );
  const owner = text === null ? null : parseOwner(text);
  return owner !== null && !isProcessAlive(owner.pid);
}

/** Remove the owner record of `directory`. */
export async function removeOwnerMarker(directory: string): Promise<void> {
  await rm(join(directory, OWNER_MARKER_FILE));
}
