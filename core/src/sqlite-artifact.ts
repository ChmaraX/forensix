import { lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import type { CaseSourceRecord } from "./case.js";
import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import {
  absentField,
  unavailableField,
  valueField,
  type CommitState,
  type FieldState,
  type ManifestEntryReference,
  type SourceRowProvenance,
} from "./forensic-model.js";
import {
  utcFromUnixMicros,
  WINDOWS_EPOCH_OFFSET_MICROS,
} from "./forensic-time.js";
import type { ForensicTimestamp } from "./history.js";
import { ownerIsDead, writeOwnerMarker } from "./owner-marker.js";
import { openDatabaseSync } from "./sqlite-open.js";
import { readStableRegularFile } from "./stable-file.js";

/**
 * A single raw SQLite cell, preserved exactly as stored. Every artifact
 * pipeline keeps values in this shape so the Finding layer can classify each
 * Field State (value, absent, or unavailable) without lossy coercion.
 */
export type RawSqliteValue = null | string | bigint | Uint8Array;

/** A text cell. A missing column or NULL is absent; another type is unavailable. */
export function preservedString(
  value: RawSqliteValue,
  columnPresent = true,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "string"
    ? valueField(value)
    : unavailableField("unsupported_value");
}

/** An integer cell as exact decimal text. */
export function preservedInteger(
  value: RawSqliteValue,
  columnPresent = true,
): FieldState<string> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  return typeof value === "bigint"
    ? valueField(value.toString())
    : unavailableField("unsupported_value");
}

/** A 0/1 integer cell. Any other value is unavailable, never guessed. */
export function preservedBoolean(
  value: RawSqliteValue,
  columnPresent = true,
): FieldState<boolean> {
  if (!columnPresent || value === null) {
    return absentField();
  }
  if (value === 0n) {
    return valueField(false);
  }
  if (value === 1n) {
    return valueField(true);
  }
  return unavailableField("unsupported_value");
}

/**
 * An enumerated integer cell: the raw value and its decoded label. An
 * unmapped code keeps the raw value and makes the label unavailable.
 */
export function enumFields(
  value: RawSqliteValue,
  labels: ReadonlyMap<bigint, string>,
  columnPresent = true,
): { readonly raw: FieldState<string>; readonly label: FieldState<string> } {
  if (!columnPresent || value === null) {
    return { raw: absentField(), label: absentField() };
  }
  if (typeof value !== "bigint") {
    return {
      raw: unavailableField("unsupported_value"),
      label: unavailableField("unsupported_value"),
    };
  }
  const label = labels.get(value);
  return {
    raw: valueField(value.toString()),
    label:
      label === undefined
        ? unavailableField("unsupported_value")
        : valueField(label),
  };
}

/** The Epoch Family of a time column and why the analyzer knows it. */
export interface TimestampEpoch {
  readonly epochFamily: "1601-us" | "unix-us" | "unix-seconds";
  readonly resolution: string;
}

const UNIX_MICROS: Readonly<
  Record<TimestampEpoch["epochFamily"], (raw: bigint) => bigint>
> = {
  "1601-us": (raw) => raw - WINDOWS_EPOCH_OFFSET_MICROS,
  "unix-us": (raw) => raw,
  "unix-seconds": (raw) => raw * 1_000_000n,
};

/**
 * A time cell. A missing column, NULL, or 0 is absent. A `null` epoch means
 * the Epoch Family cannot be known without a Declared Origin OS.
 */
export function timestampField(
  raw: RawSqliteValue,
  columnPresent: boolean,
  epoch: TimestampEpoch | null,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (!columnPresent || raw === null || raw === 0n) {
    return absentField();
  }
  if (typeof raw !== "bigint") {
    return unavailableField("unsupported_value");
  }
  if (epoch === null) {
    return unavailableField("epoch_requires_declared_origin_os");
  }
  const utc = utcFromUnixMicros(UNIX_MICROS[epoch.epochFamily](raw));
  if (utc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: raw.toString(),
      epochFamily: epoch.epochFamily,
      utc,
      declaredTimezone,
      resolution: epoch.resolution,
    },
    { synthetic: false },
  );
}

/**
 * A working-copy source file whose bytes were verified against the acquisition
 * manifest. The snapshot step re-verifies size and SHA-256 before any read, so
 * the analyzer never touches a file that drifted from its recorded evidence.
 */
export interface VerifiedSqliteFile {
  readonly path: string;
  readonly manifestPath: string;
  /** The Manifest entry ordinal of `manifestPath`. */
  readonly ordinal: number;
  readonly size: number;
  readonly sha256: string;
}

/** The Manifest entry that a row cites, and the database that holds the row. */
export interface ManifestIdentity {
  readonly sourceId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly databasePath: string;
}

export function sourceRowProvenance(
  manifest: ManifestIdentity,
  table: string,
  rowId: string,
): SourceRowProvenance {
  return {
    manifestEntryId: `${manifest.sourceId}:${manifest.ordinal}`,
    sourceId: manifest.sourceId,
    manifestEntryOrdinal: manifest.ordinal,
    manifestPath: manifest.path,
    database: manifest.databasePath,
    table,
    rowId,
  };
}

/** A Profile database and its sidecars that the Working Copy holds. */
export interface ProfileDatabase {
  readonly sourceId: string;
  readonly profile: string;
  readonly database: VerifiedSqliteFile;
  readonly sidecars: readonly VerifiedSqliteFile[];
}

/** The fields that every per-Profile SQLite artifact result has. */
export interface SqliteArtifactHeader {
  readonly sourceId: string;
  readonly profile: string;
  readonly status: "complete" | "absent" | "unavailable";
  readonly manifestEntryOrdinal: number | null;
  readonly databasePath: string;
  readonly schemaVersion: number | null;
  readonly integrity: string | null;
  readonly recoveryStatus: "complete" | "unavailable";
  readonly reason: string | null;
}

function unreadHeader(
  target: Pick<SqliteArtifactHeader, "sourceId" | "profile" | "databasePath">,
  manifestEntryOrdinal: number | null,
  status: "absent" | "unavailable",
  reason: string,
): SqliteArtifactHeader {
  return {
    sourceId: target.sourceId,
    profile: target.profile,
    status,
    manifestEntryOrdinal,
    databasePath: target.databasePath,
    schemaVersion: null,
    integrity: null,
    recoveryStatus: "unavailable",
    reason,
  };
}

/** The result header of a Profile database that was not read. */
export function unreadArtifactHeader(
  target: ProfileDatabase,
  status: "absent" | "unavailable",
  reason: string,
): SqliteArtifactHeader {
  return unreadHeader(
    { ...target, databasePath: target.database.manifestPath },
    target.database.ordinal,
    status,
    reason,
  );
}

/**
 * The result header of a failed read. A Working Copy integrity refusal stops
 * the analysis, so it is thrown again. Any other error makes the artifact
 * unavailable with its reason.
 */
export function readFailureHeader(
  target: ProfileDatabase,
  label: string,
  error: unknown,
): SqliteArtifactHeader {
  if (error instanceof WorkingCopyIntegrityRefusal) {
    throw error;
  }
  return unreadArtifactHeader(
    target,
    "unavailable",
    error instanceof ForensixError
      ? `${error.code}:${error.message}`
      : `${label}_read_failed:${String(error)}`,
  );
}

/** The result header of a read that completed. */
export function completeArtifactHeader(
  target: ProfileDatabase,
  passes: SqlitePasses<{
    readonly schema: { readonly version: number };
    readonly integrity: string;
  }>,
): SqliteArtifactHeader {
  return {
    sourceId: target.sourceId,
    profile: target.profile,
    status: "complete",
    manifestEntryOrdinal: target.database.ordinal,
    databasePath: target.database.manifestPath,
    schemaVersion: passes.committed.schema.version,
    integrity: passes.committed.integrity,
    recoveryStatus: passes.recovery.status,
    reason: sqlitePassesReason(passes),
  };
}

const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

/**
 * Find the Profile database in the Manifest and check that the Working Copy
 * holds it. `relativePaths` are Profile-relative, preferred first: a later
 * path is used only when the earlier entries are missing or `absent`.
 *
 * - No Manifest entry: unavailable, `<label>_manifest_entry_missing`.
 * - An `absent` entry: absent, `<label>_absent`.
 * - An `unavailable`, uncopied, or incomplete entry: unavailable.
 *
 * A readable database comes with each copied `-wal`, `-shm`, and `-journal`
 * sidecar that the Manifest hashed.
 */
export function resolveProfileDatabase(options: {
  readonly source: Pick<CaseSourceRecord, "sourceId" | "entries">;
  readonly profile: string;
  readonly workingCopyPath: string;
  /** The reason prefix, for example `history`. */
  readonly label: string;
  readonly relativePaths: readonly [string, ...string[]];
}):
  | { readonly readable: true; readonly target: ProfileDatabase }
  | { readonly readable: false; readonly header: SqliteArtifactHeader } {
  const { source, label } = options;
  const prefix = options.profile === "." ? "" : `${options.profile}/`;
  const found = options.relativePaths.flatMap((relative) => {
    const path = `${prefix}${relative}`;
    const ordinal = source.entries.findIndex((entry) => entry.path === path);
    const entry = source.entries[ordinal];
    return entry === undefined ? [] : [{ path, ordinal, entry }];
  });
  const chosen =
    found.find((candidate) => candidate.entry.state !== "absent") ?? found[0];
  const unread = (
    databasePath: string,
    ordinal: number | null,
    status: "absent" | "unavailable",
    reason: string,
  ) =>
    ({
      readable: false,
      header: unreadHeader(
        { sourceId: source.sourceId, profile: options.profile, databasePath },
        ordinal,
        status,
        reason,
      ),
    }) as const;
  if (chosen === undefined) {
    return unread(
      `${prefix}${options.relativePaths[0]}`,
      null,
      "unavailable",
      `${label}_manifest_entry_missing`,
    );
  }
  const { path, ordinal, entry } = chosen;
  if (entry.state === "absent") {
    return unread(path, ordinal, "absent", `${label}_absent`);
  }
  if (entry.state === "unavailable") {
    return unread(
      path,
      ordinal,
      "unavailable",
      `${label}_unavailable:${entry.unavailable_reason ?? "unknown"}`,
    );
  }
  if (!entry.copied) {
    return unread(path, ordinal, "unavailable", `${label}_not_in_working_copy`);
  }
  if (entry.size === null || entry.sha256 === null) {
    return unread(
      path,
      ordinal,
      "unavailable",
      `${label}_manifest_representation_incomplete`,
    );
  }
  const verified = (
    manifestPath: string,
    index: number,
    size: number,
    sha256: string,
  ): VerifiedSqliteFile => ({
    path: join(options.workingCopyPath, ...manifestPath.split("/")),
    manifestPath,
    ordinal: index,
    size,
    sha256,
  });
  return {
    readable: true,
    target: {
      sourceId: source.sourceId,
      profile: options.profile,
      database: verified(path, ordinal, entry.size, entry.sha256),
      sidecars: source.entries.flatMap((candidate, index) =>
        candidate.copied &&
        candidate.state === "value" &&
        candidate.size !== null &&
        candidate.sha256 !== null &&
        SIDECAR_SUFFIXES.some((suffix) => candidate.path === `${path}${suffix}`)
          ? [verified(candidate.path, index, candidate.size, candidate.sha256)]
          : [],
      ),
    },
  };
}

/** One pass with the Commit State and the Manifest entries its rows cite. */
export interface CitedPass<Pass> {
  readonly pass: Pass;
  readonly commitState: CommitState;
  readonly manifest: ManifestIdentity;
  readonly recoveredVia?: ManifestEntryReference;
}

/**
 * The committed pass and the recovered pass, each with the Manifest entry
 * that its rows cite.
 *
 * - `wal_resident`: the WAL frames hold the row image, so the row cites the
 *   `-wal` entry.
 * - `journal_resident`: the row image is in the un-rolled-back main database,
 *   so the row cites the main database entry. The `-journal` entry is kept as
 *   `recoveredVia`, because the hot journal is why the row is not committed.
 */
export function citedPasses<Pass>(
  target: ProfileDatabase,
  passes: SqlitePasses<Pass>,
): {
  readonly committed: CitedPass<Pass>;
  readonly recovered: CitedPass<Pass> | null;
} {
  const cite = (file: VerifiedSqliteFile): ManifestIdentity => ({
    sourceId: target.sourceId,
    ordinal: file.ordinal,
    path: file.manifestPath,
    databasePath: target.database.manifestPath,
  });
  const committed = {
    pass: passes.committed,
    commitState: "committed",
    manifest: cite(target.database),
  } as const;
  const recovery = passes.recovery;
  if (recovery.status === "unavailable") {
    return { committed, recovered: null };
  }
  if (recovery.commitState === "wal_resident") {
    return {
      committed,
      recovered: {
        pass: recovery.pass,
        commitState: recovery.commitState,
        manifest: cite(recovery.sidecar),
      },
    };
  }
  return {
    committed,
    recovered: {
      pass: recovery.pass,
      commitState: recovery.commitState,
      manifest: committed.manifest,
      recoveredVia: {
        manifestEntryId: `${target.sourceId}:${recovery.sidecar.ordinal}`,
        sourceId: target.sourceId,
        manifestEntryOrdinal: recovery.sidecar.ordinal,
        manifestPath: recovery.sidecar.manifestPath,
      },
    },
  };
}

/**
 * Open a lock-free, read-only immutable view of a snapshot database. The
 * `immutable=1` URI parameter tells SQLite the file cannot change underneath
 * it, so it reads the committed image without acquiring any lock.
 */
function immutableDatabase(path: string): DatabaseSync {
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

async function snapshotVerifiedFile(
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
  /**
   * The sidecar pass, reduced to the content that the committed pass does not
   * hold, with the sidecar that makes it uncommitted. Or the reason why no
   * sidecar pass exists.
   */
  readonly recovery:
    | {
        readonly status: "complete";
        readonly commitState: SidecarCommitState;
        readonly pass: Pass;
        readonly sidecar: VerifiedSqliteFile;
      }
    | { readonly status: "unavailable"; readonly reason: string };
  /**
   * Null when the temporary snapshots were removed. Otherwise the reason why
   * the removal failed after its retries. The read result stays valid: the
   * snapshots are copies outside the Case and the Source.
   */
  readonly cleanupFailureReason: string | null;
}

/**
 * The non-fatal reasons of a read, joined with `; `, or null when there are
 * none. An artifact records this as its result reason.
 */
function sqlitePassesReason(passes: SqlitePasses<unknown>): string | null {
  const reasons = [
    passes.recovery.status === "unavailable" ? passes.recovery.reason : null,
    passes.cleanupFailureReason,
  ].filter((reason): reason is string => reason !== null);
  return reasons.length === 0 ? null : reasons.join("; ");
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
 * On Windows a just-closed SQLite handle can hold a lock on a snapshot file
 * for a short time, so the removal can fail with EBUSY or EPERM. `rm` retries
 * these errors with a linear back-off (100 ms, 200 ms, ...), about 1.5 s in
 * total.
 */
const SNAPSHOT_CLEANUP_CONFIG = { maxRetries: 5, retryDelay: 100 } as const;

/**
 * Remove the temporary snapshot directory. A failure never replaces the read
 * result or the read error: it is returned as a reason.
 */
async function removeSnapshots(directory: string): Promise<string | null> {
  try {
    await rm(directory, {
      force: true,
      recursive: true,
      ...SNAPSHOT_CLEANUP_CONFIG,
    });
    return null;
  } catch (error) {
    return `snapshot_cleanup_failed:${String(error)}`;
  }
}

/** Snapshot directories are `forensix-<artifact>-snapshot-<random>`. */
const SNAPSHOT_DIRECTORY = /^forensix-[a-z0-9-]+-snapshot-[A-Za-z0-9]+$/;
async function snapshotIsStale(directory: string): Promise<boolean> {
  const stats = await lstat(directory);
  return (
    stats.isDirectory() &&
    (process.getuid === undefined || stats.uid === process.getuid()) &&
    (await ownerIsDead(directory))
  );
}

/**
 * Remove the snapshot directories that a killed process left in the
 * temporary directory. They can hold copies of secrets (Cookies, Login Data).
 * A directory is removed only when it holds a ForensiX owner record whose
 * process is dead; any other directory stays. The sweep is best effort and
 * never fails a read.
 */
async function sweepStaleSnapshots(directory: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  for (const name of names.filter((item) => SNAPSHOT_DIRECTORY.test(item))) {
    const path = join(directory, name);
    try {
      if (await snapshotIsStale(path)) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // Another process can remove or own the directory. Keep going.
    }
  }
}

/** One sweep per temporary directory and process, before its first snapshot. */
const sweptDirectories = new Map<string, Promise<void>>();

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
 *
 * The temporary snapshots are removed with bounded retries. A removal that
 * still fails does not fail the read and does not replace a read error: the
 * result keeps it as `cleanupFailureReason`. Before the first snapshot, the
 * process removes the stale snapshot directories of dead processes.
 */
export async function readSqlitePasses<Pass>(
  options: SqlitePassOptions<Pass>,
): Promise<SqlitePasses<Pass>> {
  const snapshotRoot = tmpdir();
  let sweep = sweptDirectories.get(snapshotRoot);
  if (sweep === undefined) {
    sweep = sweepStaleSnapshots(snapshotRoot);
    sweptDirectories.set(snapshotRoot, sweep);
  }
  await sweep;
  const temporaryDirectory = await mkdtemp(
    join(
      snapshotRoot,
      `forensix-${options.artifact.toLowerCase().replaceAll(" ", "-")}-snapshot-`,
    ),
  );
  let passes: Omit<SqlitePasses<Pass>, "cleanupFailureReason">;
  try {
    await writeOwnerMarker(temporaryDirectory);
    passes = await readSnapshotPasses(options, temporaryDirectory);
  } catch (error) {
    // The read error is the result. A cleanup failure cannot replace it.
    await removeSnapshots(temporaryDirectory);
    throw error;
  }
  return {
    ...passes,
    cleanupFailureReason: await removeSnapshots(temporaryDirectory),
  };
}

async function readSnapshotPasses<Pass>(
  options: SqlitePassOptions<Pass>,
  temporaryDirectory: string,
): Promise<Omit<SqlitePasses<Pass>, "cleanupFailureReason">> {
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
  const sidecarOf = (suffix: string): VerifiedSqliteFile | undefined =>
    options.sidecars.find((sidecar) => sidecar.path.endsWith(suffix));
  const wal = sidecarOf("-wal");
  const journal = sidecarOf("-journal");

  if (wal !== undefined) {
    const committed = await readImmutable();
    const applied = await readReadWrite();
    if (!("pass" in applied)) {
      // A drifted working copy is never read, not even partly.
      if (applied.error instanceof WorkingCopyIntegrityRefusal) {
        throw applied.error;
      }
      return {
        committed,
        recovery: {
          status: "unavailable",
          reason: `recovery_${applied.stage}_failed:${String(applied.error)}`,
        },
      };
    }
    return {
      committed,
      recovery: {
        status: "complete",
        commitState: "wal_resident",
        pass: options.sidecarOnly(committed, applied.pass),
        sidecar: wal,
      },
    };
  }

  if (journal === undefined) {
    return {
      committed: await readImmutable(),
      recovery: { status: "unavailable", reason: "sidecar_not_supplied" },
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
      recovery: {
        status: "unavailable",
        reason: `recovery_read_failed:${String(error)}`,
      },
    };
  }
  return {
    committed,
    recovery: {
      status: "complete",
      commitState: "journal_resident",
      pass: options.sidecarOnly(committed, unrolled),
      sidecar: journal,
    },
  };
}
