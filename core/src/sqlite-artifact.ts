import { lstat, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import type { CommitState } from "./forensic-model.js";
import { openDatabaseSync } from "./sqlite-open.js";
import { readStableRegularFile } from "./stable-file.js";

/**
 * A single raw SQLite cell, preserved exactly as stored. Every artifact
 * pipeline keeps values in this shape so the Finding layer can classify each
 * Field State (value, absent, or unavailable) without lossy coercion.
 */
export type RawSqliteValue = null | string | bigint | Uint8Array;

/**
 * A working-copy source file whose bytes were verified against the acquisition
 * manifest. The snapshot step re-verifies size and SHA-256 before any read, so
 * the analyzer never touches a file that drifted from its recorded evidence.
 */
export interface VerifiedSqliteFile {
  readonly path: string;
  readonly manifestPath: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * Open a lock-free, read-only immutable view of a snapshot database. The
 * `immutable=1` URI parameter tells SQLite the file cannot change underneath
 * it, so it reads the committed image without acquiring any lock.
 */
export function immutableDatabase(path: string): DatabaseSync {
  const url = pathToFileURL(path);
  url.searchParams.set("immutable", "1");
  return openDatabaseSync(url.href, {
    readOnly: true,
    readBigInts: true,
  });
}

/**
 * Keep a cell value exactly as SQLite stored it. A JavaScript number is
 * accepted only when it is a safe integer; any other value cannot be preserved
 * exactly and stops the read.
 */
export function normalizeSqliteValue(
  value: unknown,
  artifact: string,
): RawSqliteValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new ForensixError(
    "ANALYSIS_FAILED",
    `${artifact} contains a value that cannot be preserved exactly.`,
  );
}

/** The first `PRAGMA integrity_check` result line, or `unavailable`. */
export function readIntegrity(database: DatabaseSync): string {
  const row = database.prepare("PRAGMA integrity_check(1)").get();
  return String(row?.integrity_check ?? "unavailable");
}

/**
 * A stable text image of raw SQLite values (bigint, blob, Map, arrays and
 * plain objects). Two rows with the same image hold the same exact bytes.
 */
export function sqliteFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") {
      return `${item.toString()}n`;
    }
    if (item instanceof Uint8Array) {
      return `blob:${Buffer.from(item).toString("base64")}`;
    }
    if (item instanceof Map) {
      return [...(item as Map<unknown, unknown>).entries()];
    }
    return item;
  });
}

/**
 * Return the sidecar-pass rows that the committed pass does not hold with the
 * same exact image. `rowKey` gives the row identity (normally the rowid); a
 * row without an identity is always kept as sidecar evidence.
 */
export function sidecarOnlyRows<Row>(
  committed: readonly Row[],
  sidecar: readonly Row[],
  rowKey: (row: Row) => string | null,
): Row[] {
  const committedByKey = new Map<string, string>();
  for (const row of committed) {
    const key = rowKey(row);
    if (key !== null) {
      committedByKey.set(key, sqliteFingerprint(row));
    }
  }
  return sidecar.filter((row) => {
    const key = rowKey(row);
    const committedImage = key === null ? undefined : committedByKey.get(key);
    return (
      committedImage === undefined || committedImage !== sqliteFingerprint(row)
    );
  });
}

/** The rowid text of a raw value, or `null` when it is not an integer. */
export function integerKey(value: unknown): string | null {
  return typeof value === "bigint" ? value.toString() : null;
}

export function tableExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table) !== undefined
  );
}

export function tableColumns(
  database: DatabaseSync,
  table: string,
): Set<string> {
  return new Set(
    database
      .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
      .all(table)
      .map((row) => String(row.name)),
  );
}

async function writeAll(destination: FileHandle, chunk: Buffer): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    const result = await destination.write(
      chunk,
      written,
      chunk.length - written,
    );
    written += result.bytesWritten;
  }
}

export async function snapshotVerifiedFile(
  source: VerifiedSqliteFile,
  destinationPath: string,
): Promise<void> {
  let stats;
  try {
    stats = await lstat(source.path, { bigint: true });
  } catch {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_missing" },
    ]);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_not_regular_file" },
    ]);
  }

  const destination = await open(destinationPath, "wx", 0o600);
  let result;
  try {
    result = await readStableRegularFile(source.path, stats, async (chunk) =>
      writeAll(destination, chunk),
    );
    await destination.sync();
  } finally {
    await destination.close();
  }
  if (result.status !== "stable") {
    throw new WorkingCopyIntegrityRefusal([
      { path: source.manifestPath, reason: "entry_unreadable" },
    ]);
  }
  const issues = [];
  if (result.size !== source.size) {
    issues.push({
      path: source.manifestPath,
      reason: "entry_size_mismatch" as const,
      expected: source.size,
      actual: result.size,
    });
  }
  if (result.sha256 !== source.sha256) {
    issues.push({
      path: source.manifestPath,
      reason: "entry_hash_mismatch" as const,
      expected: source.sha256,
      actual: result.sha256,
    });
  }
  if (issues.length > 0) {
    throw new WorkingCopyIntegrityRefusal(issues);
  }
}

export type SidecarCommitState = Exclude<CommitState, "committed">;

export interface SqlitePasses<Pass> {
  readonly committed: Pass;
  readonly recovered:
    | (Pass & { readonly commitState: SidecarCommitState })
    | null;
  readonly recoveryUnavailableReason: string | null;
}

export interface SqlitePassOptions<Pass> {
  /** Artifact name for messages and the temporary directory, e.g. `History`. */
  readonly artifact: string;
  readonly database: VerifiedSqliteFile;
  readonly sidecars: readonly VerifiedSqliteFile[];
  /** Read one full pass from an open database. */
  readonly readPass: (database: DatabaseSync) => Pass;
  /**
   * Reduce the full sidecar pass to the content that the committed pass does
   * not hold with the same exact image (see `sidecarOnlyRows`).
   */
  readonly sidecarOnly: (committed: Pass, sidecar: Pass) => Pass;
}

/**
 * Windows CI can transiently refuse the read-write open of a freshly copied
 * snapshot that still carries a hot rollback journal or WAL. This budget is
 * finite and under the E2E ceiling (60s), so a genuine deadlock still fails
 * instead of hanging, while a slow-but-transient Windows lock/scanner window
 * is absorbed. Successful opens are unaffected.
 */
const READ_WRITE_OPEN_CONFIG = {
  maxAttempts: 12,
  maxTotalMs: 15_000,
  busyTimeoutMs: 10_000,
} as const;

/**
 * Read a verified SQLite artifact as a committed pass and, when a sidecar is
 * supplied, a separate sidecar pass. Every pass reads its own fresh snapshot in
 * its own directory: on Windows a handle close does not release the OS lock at
 * once, so a read-write open of a file that an earlier handle used can fail
 * with "unable to open database file".
 *
 * Two views of the snapshot exist:
 *
 * - Immutable view: `immutable=1` reads the main file as it is. SQLite skips
 *   all locking and change detection, so it ignores both the WAL and any hot
 *   rollback journal (https://www.sqlite.org/uri.html).
 * - Read-write view: SQLite applies the WAL, or rolls back a hot rollback
 *   journal before the first read (https://www.sqlite.org/lockingv3.html,
 *   section 4.1).
 *
 * The Commit State of each view depends on the sidecar type:
 *
 * - WAL: a writer adds new pages to the WAL and does not change the main file
 *   until a checkpoint. The immutable main file is the committed image. Rows
 *   that only the WAL-applied view holds are `wal_resident`.
 * - Rollback journal: a writer copies the original pages into the journal and
 *   then changes the main file in place. The commit occurs only when the
 *   journal is deleted (https://www.sqlite.org/atomiccommit.html, sections
 *   3.5 to 3.11). A cache spill can write changes into the main file before
 *   the commit (section 6.3). Thus, when a hot journal exists, the main file
 *   can hold changes that were never committed, and the rollback restores the
 *   last committed image (sections 4.2 to 4.6). The rolled-back image is the
 *   committed state. Rows that only the un-rolled-back main file holds are
 *   `journal_resident`.
 *
 * A sidecar pass that cannot be read degrades to a committed-only result with
 * a reason. A hot rollback journal that cannot be rolled back stops the read,
 * because the main file alone is not a committed image.
 */
export async function readSqlitePasses<Pass>(
  options: SqlitePassOptions<Pass>,
): Promise<SqlitePasses<Pass>> {
  const temporaryDirectory = await mkdtemp(
    join(
      tmpdir(),
      `forensix-${options.artifact.toLowerCase().replaceAll(" ", "-")}-snapshot-`,
    ),
  );
  let snapshotCount = 0;
  // Copy the verified database (and the sidecars, when asked) into a new
  // directory. Basenames stay the same so a sidecar still sits next to its
  // database. The immutable view ignores sidecars, so it gets none.
  const snapshot = async (withSidecars: boolean): Promise<string> => {
    snapshotCount += 1;
    const directory = join(temporaryDirectory, String(snapshotCount));
    await mkdir(directory);
    const databasePath = join(directory, basename(options.database.path));
    await snapshotVerifiedFile(options.database, databasePath);
    for (const sidecar of withSidecars ? options.sidecars : []) {
      await snapshotVerifiedFile(
        sidecar,
        join(directory, basename(sidecar.path)),
      );
    }
    return databasePath;
  };
  const readFrom = (database: DatabaseSync): Pass => {
    try {
      return options.readPass(database);
    } finally {
      database.close();
    }
  };
  const readImmutable = async (): Promise<Pass> =>
    readFrom(immutableDatabase(await snapshot(false)));
  // Read-write view. A failure is tagged with its stage so that a degraded
  // result keeps the reason taxonomy: snapshot, open, or read.
  const readReadWrite = async (): Promise<
    | { readonly pass: Pass }
    | { readonly stage: "snapshot" | "open" | "read"; readonly error: unknown }
  > => {
    let databasePath: string;
    try {
      databasePath = await snapshot(true);
    } catch (error) {
      return { stage: "snapshot", error };
    }
    let database: DatabaseSync;
    try {
      database = openDatabaseSync(
        databasePath,
        { readBigInts: true },
        READ_WRITE_OPEN_CONFIG,
      );
    } catch (error) {
      return { stage: "open", error };
    }
    try {
      return { pass: readFrom(database) };
    } catch (error) {
      return { stage: "read", error };
    }
  };
  const hasSidecar = (suffix: string): boolean =>
    options.sidecars.some((sidecar) => sidecar.path.endsWith(suffix));

  try {
    if (!hasSidecar("-wal") && !hasSidecar("-journal")) {
      return {
        committed: await readImmutable(),
        recovered: null,
        recoveryUnavailableReason: "sidecar_not_supplied",
      };
    }

    if (hasSidecar("-wal")) {
      const committed = await readImmutable();
      const applied = await readReadWrite();
      if (!("pass" in applied)) {
        // A drifted working copy is never read, not even partly.
        if (applied.error instanceof WorkingCopyIntegrityRefusal) {
          throw applied.error;
        }
        return {
          committed,
          recovered: null,
          recoveryUnavailableReason: `recovery_${applied.stage}_failed:${String(applied.error)}`,
        };
      }
      return {
        committed,
        recovered: {
          ...options.sidecarOnly(committed, applied.pass),
          commitState: "wal_resident",
        },
        recoveryUnavailableReason: null,
      };
    }

    const rolledBack = await readReadWrite();
    if (!("pass" in rolledBack)) {
      // Schema faults, typed reader outcomes and integrity refusals keep their
      // own type. Only a SQLite or I/O failure means the rollback failed.
      if (
        rolledBack.error instanceof ForensixError ||
        (rolledBack.stage === "read" &&
          typeof (rolledBack.error as { errcode?: unknown } | null)?.errcode !==
            "number")
      ) {
        throw rolledBack.error;
      }
      // The artifact layer records `code:message`, so the cause goes into the
      // message.
      const reason = `rollback_${rolledBack.stage}_failed:${String(rolledBack.error)}`;
      throw new ForensixError(
        "ANALYSIS_FAILED",
        `${options.artifact} rollback journal could not be rolled back (${reason}).`,
        { reason },
      );
    }
    const committed = rolledBack.pass;
    let unrolled: Pass;
    try {
      unrolled = await readImmutable();
    } catch (error) {
      if (error instanceof WorkingCopyIntegrityRefusal) {
        throw error;
      }
      return {
        committed,
        recovered: null,
        recoveryUnavailableReason: `recovery_read_failed:${String(error)}`,
      };
    }
    return {
      committed,
      recovered: {
        ...options.sidecarOnly(committed, unrolled),
        commitState: "journal_resident",
      },
      recoveryUnavailableReason: null,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
