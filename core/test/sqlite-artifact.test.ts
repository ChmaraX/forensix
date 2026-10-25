import { createHash } from "node:crypto";
import { chmodSync, readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  readSqlitePasses,
  type VerifiedSqliteFile,
} from "../src/sqlite-artifact.js";

const temporaryRoots: string[] = [];
const blockedDirectories: string[] = [];
const originalTmpdir = process.env.TMPDIR;

afterEach(async () => {
  if (originalTmpdir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = originalTmpdir;
  }
  // Give back the permission that a test took away, then remove the roots.
  for (const directory of blockedDirectories.splice(0)) {
    await chmod(directory, 0o700);
  }
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { force: true, recursive: true });
  }
});

/**
 * A verified database in `root`, and a private temporary directory that
 * `os.tmpdir()` returns, so the test can see the snapshot directories.
 */
async function prepare(): Promise<{
  readonly database: VerifiedSqliteFile;
  readonly snapshots: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "forensix-sqlite-artifact-"));
  temporaryRoots.push(root);
  const snapshots = join(root, "tmp");
  const path = join(root, "Artifact");
  const database = new DatabaseSync(path);
  try {
    database.exec(
      "CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO rows VALUES (1, 'alpha');",
    );
  } finally {
    database.close();
  }
  const bytes = await readFile(path);
  await mkdir(snapshots);
  process.env.TMPDIR = snapshots;
  return {
    database: {
      path,
      manifestPath: "Default/Artifact",
      size: (await stat(path)).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    snapshots,
  };
}

/** Make every snapshot directory of the read impossible to remove. */
function blockCleanup(snapshots: string): void {
  for (const name of readdirSync(snapshots)) {
    const directory = join(snapshots, name);
    chmodSync(directory, 0o500);
    blockedDirectories.push(directory);
  }
}

const readRows = (database: DatabaseSync): readonly unknown[] =>
  database.prepare("SELECT id, value FROM rows ORDER BY id").all();

// A permission change cannot block a removal on Windows or for root, so these
// cases run only where it can.
const canBlockRemoval =
  process.platform !== "win32" && process.getuid?.() !== 0;

describe("readSqlitePasses snapshot cleanup", () => {
  it("removes the snapshots and reports no cleanup failure", async () => {
    const { database, snapshots } = await prepare();
    const passes = await readSqlitePasses({
      artifact: "Artifact",
      database,
      sidecars: [],
      readPass: readRows,
      sidecarOnly: (committed) => committed,
    });
    expect(passes.committed).toEqual([{ id: 1n, value: "alpha" }]);
    expect(passes.recoveryUnavailableReason).toBe("sidecar_not_supplied");
    expect(passes.cleanupFailureReason).toBeNull();
    expect(await readdir(snapshots)).toEqual([]);
  });

  it.runIf(canBlockRemoval)(
    "keeps a successful read when the snapshots cannot be removed",
    async () => {
      const { database, snapshots } = await prepare();
      const passes = await readSqlitePasses({
        artifact: "Artifact",
        database,
        sidecars: [],
        readPass: (open) => {
          const rows = readRows(open);
          blockCleanup(snapshots);
          return rows;
        },
        sidecarOnly: (committed) => committed,
      });
      expect(passes.committed).toEqual([{ id: 1n, value: "alpha" }]);
      expect(passes.recoveryUnavailableReason).toBe("sidecar_not_supplied");
      expect(passes.cleanupFailureReason).toMatch(/^snapshot_cleanup_failed:/);
      expect(await readdir(snapshots)).toHaveLength(1);
    },
  );

  it.runIf(canBlockRemoval)(
    "keeps the read error when the snapshots cannot be removed",
    async () => {
      const { database, snapshots } = await prepare();
      const readError = new Error("schema fault");
      await expect(
        readSqlitePasses({
          artifact: "Artifact",
          database,
          sidecars: [],
          readPass: () => {
            blockCleanup(snapshots);
            throw readError;
          },
          sidecarOnly: (committed) => committed,
        }),
      ).rejects.toBe(readError);
      expect(await readdir(snapshots)).toHaveLength(1);
    },
  );
});
