import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { ManifestEntry } from "../src/manifest.js";
import {
  readSqlitePasses,
  resolveProfileDatabase,
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
      ordinal: 0,
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
    expect(passes.recovery).toEqual({
      status: "unavailable",
      reason: "sidecar_not_supplied",
    });
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
      expect(passes.recovery).toEqual({
        status: "unavailable",
        reason: "sidecar_not_supplied",
      });
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

/** A snapshot directory as a read leaves it, with a copied secret store. */
async function leftSnapshot(
  snapshots: string,
  name: string,
  ownerPid: number | null,
): Promise<string> {
  const directory = join(snapshots, name);
  await mkdir(join(directory, "1"), { recursive: true });
  await writeFile(join(directory, "1", "Login Data"), "copied secrets");
  if (ownerPid !== null) {
    await writeFile(join(directory, "owner.pid"), String(ownerPid));
  }
  return name;
}

describe("readSqlitePasses stale snapshot sweep", () => {
  it("removes the snapshots of dead processes before the first read", async () => {
    const { database, snapshots } = await prepare();
    // The child has exited when spawnSync returns, so its PID is dead.
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    expect(deadPid).toBeGreaterThan(0);
    await leftSnapshot(
      snapshots,
      "forensix-login-data-snapshot-Ab12Cd",
      deadPid,
    );
    const live = await leftSnapshot(
      snapshots,
      "forensix-cookies-snapshot-Ef34Gh",
      process.pid,
    );
    // A process stopped before it wrote its PID leaves no owner file.
    const ownerlessOld = await leftSnapshot(
      snapshots,
      "forensix-history-snapshot-Ij56Kl",
      null,
    );
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(snapshots, ownerlessOld), twoHoursAgo, twoHoursAgo);
    const ownerlessNew = await leftSnapshot(
      snapshots,
      "forensix-favicons-snapshot-Mn78Op",
      null,
    );
    const unrelated = await leftSnapshot(
      snapshots,
      "forensix-acquisition-Qr90St",
      deadPid,
    );

    const passes = await readSqlitePasses({
      artifact: "Login Data",
      database,
      sidecars: [],
      readPass: readRows,
      sidecarOnly: (committed) => committed,
    });

    expect(passes.committed).toEqual([{ id: 1n, value: "alpha" }]);
    expect((await readdir(snapshots)).sort()).toEqual(
      [live, ownerlessNew, unrelated].sort(),
    );
  });

  it("records the owner PID in the snapshot directory of a read", async () => {
    const { database, snapshots } = await prepare();
    let owners: string[] = [];
    await readSqlitePasses({
      artifact: "Cookies",
      database,
      sidecars: [],
      readPass: (open) => {
        owners = readdirSync(snapshots).map((name) =>
          readFileSync(join(snapshots, name, "owner.pid"), "utf8"),
        );
        return readRows(open);
      },
      sidecarOnly: (committed) => committed,
    });
    expect(owners).toEqual([String(process.pid)]);
    expect(await readdir(snapshots)).toEqual([]);
  });
});

function manifestEntry(
  path: string,
  state: ManifestEntry["state"],
  copied = state === "value",
): ManifestEntry {
  return {
    path,
    state,
    unavailable_reason: state === "unavailable" ? "permission_denied" : null,
    node_type: state === "value" ? "file" : "absent",
    file_kind: path.includes("-") ? "sidecar" : "database",
    selection_tier: "tier_1",
    copied,
    unclassified: false,
    size: state === "value" ? 4096 : null,
    mtime_ns: null,
    hash_algorithm: "sha-256",
    sha256: state === "value" ? "a".repeat(64) : null,
    link_target: null,
  };
}

describe("resolveProfileDatabase", () => {
  const resolve = (
    entries: readonly ManifestEntry[],
    relativePaths: readonly [string, ...string[]],
  ) =>
    resolveProfileDatabase({
      source: { sourceId: "SRC", entries },
      profile: "Default",
      workingCopyPath: join("case", "working-copy"),
      label: "cookies",
      relativePaths,
    });

  it("reports a missing Manifest entry as unavailable, and an absent one as absent", () => {
    expect(resolve([], ["Network/Cookies", "Cookies"])).toMatchObject({
      readable: false,
      header: {
        status: "unavailable",
        manifestEntryOrdinal: null,
        databasePath: "Default/Network/Cookies",
        reason: "cookies_manifest_entry_missing",
      },
    });
    expect(
      resolve(
        [manifestEntry("Default/Network/Cookies", "absent")],
        ["Network/Cookies", "Cookies"],
      ),
    ).toMatchObject({
      readable: false,
      header: {
        status: "absent",
        manifestEntryOrdinal: 0,
        reason: "cookies_absent",
      },
    });
  });

  it("falls back only past an absent entry and takes every hashed sidecar", () => {
    const entries = [
      manifestEntry("Default/Cookies", "value"),
      manifestEntry("Default/Cookies-journal", "absent"),
      manifestEntry("Default/Cookies-shm", "value"),
      manifestEntry("Default/Cookies-wal", "value"),
      manifestEntry("Default/Network/Cookies", "absent"),
    ];
    const resolved = resolve(entries, ["Network/Cookies", "Cookies"]);
    expect(resolved.readable && resolved.target.database).toMatchObject({
      manifestPath: "Default/Cookies",
      ordinal: 0,
    });
    expect(
      resolved.readable &&
        resolved.target.sidecars.map((sidecar) => [
          sidecar.manifestPath,
          sidecar.ordinal,
        ]),
    ).toEqual([
      ["Default/Cookies-shm", 2],
      ["Default/Cookies-wal", 3],
    ]);
    // A store that exists but is unreadable is never replaced by the legacy
    // copy.
    expect(
      resolve(
        [
          entries[0] as ManifestEntry,
          manifestEntry("Default/Network/Cookies", "unavailable"),
        ],
        ["Network/Cookies", "Cookies"],
      ),
    ).toMatchObject({
      readable: false,
      header: {
        status: "unavailable",
        databasePath: "Default/Network/Cookies",
        reason: "cookies_unavailable:permission_denied",
      },
    });
  });
});
