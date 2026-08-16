import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { WorkingCopyIntegrityRefusal } from "./errors.js";
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
