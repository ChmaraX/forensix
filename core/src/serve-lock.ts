import { createHash, randomUUID } from "node:crypto";
import { link, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ForensixError } from "./errors.js";

/**
 * The serve lock tells `analyse` that a `serve` process reads the Case. The
 * lock file is outside the Case Directory, so a read path never writes in the
 * Case. It holds the PID of its owner. A lock whose PID is dead is stale: it is
 * removed and ignored.
 */

/** True when a process with this PID exists (EPERM: it exists, not ours). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function lockPath(caseDirectory: string): Promise<string> {
  const target = resolve(caseDirectory);
  const physical = await realpath(target).catch(() => target);
  const digest = createHash("sha256").update(physical).digest("hex");
  return join(tmpdir(), `forensix-serve-${digest.slice(0, 16)}.lock`);
}

/** The owner PID of the lock, or null when there is no lock. */
async function readOwner(path: string): Promise<number | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const pid = Number(text.trim());
  // Content that is not a PID cannot name a live owner: treat it as stale.
  return Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

/**
 * Refuse with `CASE_IN_USE` when a live process holds the serve lock of the
 * Case. A stale lock is removed and ignored.
 */
export async function assertNoLiveServeLock(
  caseDirectory: string,
): Promise<void> {
  const path = await lockPath(caseDirectory);
  const pid = await readOwner(path);
  if (pid === null) {
    return;
  }
  if (pid > 0 && isProcessAlive(pid)) {
    throw new ForensixError(
      "CASE_IN_USE",
      "A forensix serve process has the Case open. Stop it, then run the command again.",
      { caseDirectory: resolve(caseDirectory), pid, lockPath: path },
    );
  }
  await rm(path, { force: true });
}

/**
 * Take the serve lock of the Case for this process. It refuses with
 * `CASE_IN_USE` when another live process holds it. `release()` removes the
 * lock only while this process still owns it.
 */
export async function acquireServeLock(
  caseDirectory: string,
): Promise<{ release(): Promise<void> }> {
  const path = await lockPath(caseDirectory);
  const owner = `${process.pid}\n`;
  // Write the PID to a private file, then link it into place: the lock never
  // exists without its PID, and the link fails when a lock exists.
  const pending = `${path}.${randomUUID()}`;
  await writeFile(pending, owner, { flag: "wx", mode: 0o600 });
  try {
    for (;;) {
      try {
        await link(pending, path);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      await assertNoLiveServeLock(caseDirectory);
    }
  } finally {
    await rm(pending, { force: true });
  }
  return {
    async release(): Promise<void> {
      if ((await readOwner(path)) === process.pid) {
        await rm(path, { force: true });
      }
    },
  };
}
