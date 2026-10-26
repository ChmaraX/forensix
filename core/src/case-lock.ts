import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";

/**
 * The Case lock lets one process at a time use a Case: one `analyse` or one
 * `serve`. It is an exclusive SQLite transaction on a lock database outside
 * the Case Directory, so a read path never writes in the Case. The operating
 * system holds the file lock and releases it when the process ends, also when
 * the process is killed, so there is no stale lock to detect or take over.
 */

export type CaseLockHolder = "analyse" | "serve";

async function lockPath(caseDirectory: string): Promise<string> {
  const target = resolve(caseDirectory);
  const physical = await realpath(target).catch(() => target);
  const digest = createHash("sha256").update(physical).digest("hex");
  return join(tmpdir(), `forensix-case-${digest.slice(0, 16)}.lock`);
}

/** The holder that the lock owner wrote, for the error message only. */
async function readHolder(
  path: string,
): Promise<{ readonly holder?: unknown; readonly pid?: unknown }> {
  try {
    return JSON.parse(await readFile(`${path}.holder.json`, "utf8")) as {
      readonly holder?: unknown;
      readonly pid?: unknown;
    };
  } catch {
    return {};
  }
}

/**
 * Take the Case lock for this process. It refuses with `CASE_IN_USE` when
 * another `analyse` or `serve` holds it. `release()` ends the transaction.
 */
export async function acquireCaseLock(
  caseDirectory: string,
  holder: CaseLockHolder,
): Promise<{ release(): Promise<void> }> {
  const path = await lockPath(caseDirectory);
  const database = new DatabaseSync(path, { timeout: 0 });
  try {
    // The lock database holds no data: an in-memory journal leaves no
    // journal file next to it.
    database.exec("PRAGMA journal_mode = MEMORY; BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    if ((error as { readonly errcode?: number }).errcode !== 5) {
      throw error;
    }
    const owner = await readHolder(path);
    const name =
      owner.holder === "analyse" || owner.holder === "serve"
        ? owner.holder
        : "analyse or serve";
    throw new ForensixError(
      "CASE_IN_USE",
      `A forensix ${name} process uses the Case. Stop it, then run the command again.`,
      {
        caseDirectory: resolve(caseDirectory),
        ...(owner.holder === "analyse" || owner.holder === "serve"
          ? { holder: owner.holder }
          : {}),
        ...(typeof owner.pid === "number" ? { pid: owner.pid } : {}),
        lockPath: path,
      },
    );
  }
  await writeFile(
    `${path}.holder.json`,
    `${JSON.stringify({ holder, pid: process.pid })}\n`,
    { mode: 0o600 },
  );
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      try {
        database.exec("ROLLBACK");
      } finally {
        database.close();
      }
    },
  };
}
