import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  realpathSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";

import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { CliError } from "./cli-error.js";

/**
 * The hash-chained audit log (`--audit-log <file>` / `FORENSIX_AUDIT_LOG`).
 *
 * Each command appends one NDJSON line. `hash` is the SHA-256 of the
 * canonical JSON (sorted keys) of the entry without `hash`; `prevHash` is the
 * hash of the line before it (64 zeros for the first). `seq` counts from 1.
 * A lock file (`<log>.lock`, created with O_EXCL) serializes writers, so
 * parallel commands cannot both chain onto the same previous line.
 *
 * Failure modes handled: parallel writers (lock), a writer that died holding
 * the lock (its pid is gone: the lock is stale and is taken over), a lock that
 * is never released (timeout -> AUDIT_LOG_FAILED), a log whose last line is
 * damaged or cut (refuse to chain onto it -> AUDIT_LOG_FAILED). Verification
 * detects edited, deleted, inserted, and reordered lines. It cannot detect
 * removal of the newest lines, or a log rewritten with all hashes recomputed:
 * keep a copy of the last `hash` elsewhere for that.
 */

export const GENESIS_HASH = "0".repeat(64);
const LOCK_TIMEOUT_MS = 15_000;
const LOCK_STALE_MS = 60_000;

export interface AuditEntry {
  readonly version: 1;
  readonly seq: number;
  readonly id: string;
  readonly time: string;
  readonly toolVersion: string;
  readonly command: string | null;
  readonly argv: readonly string[];
  readonly caseDirectory: string | null;
  readonly exitCode: number;
  readonly outputSha256: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditInput {
  readonly toolVersion: string;
  readonly command: string | null;
  readonly argv: readonly string[];
  readonly caseDirectory: string | null;
  readonly exitCode: number;
  /** SHA-256 (hex) of the printed output before the `audit` key is added. */
  readonly outputSha256: string;
}

export interface AuditStamp {
  readonly id: string;
  readonly entryHash: string;
}

/** The length the `audit` key adds to one printed JSON object. */
export const AUDIT_KEY_BYTES = Buffer.byteLength(
  JSON.stringify({ audit: { id: randomUUID(), entryHash: GENESIS_HASH } }),
);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function entryHash(entry: Readonly<Record<string, unknown>>): string {
  const withoutHash = Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "hash"),
  );
  return sha256(canonicalJson(withoutHash));
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function lockOwner(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function lockIsStale(path: string, owner: string): boolean {
  const pid = Number(owner.trim());
  if (Number.isSafeInteger(pid) && pid > 0) {
    return processIsGone(pid);
  }
  // Empty or unreadable owner: a writer may be between create and write.
  try {
    return Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** Moves a stale lock aside. When another writer replaced it meanwhile (the
 *  moved file is not the stale one), puts that live lock back. */
function breakStaleLock(path: string, staleOwner: string): void {
  const aside = `${path}.stale-${randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch {
    return;
  }
  if (lockOwner(aside) !== staleOwner) {
    try {
      linkSync(aside, path);
    } catch {
      // A third writer holds the lock now; its lock stays.
    }
  }
  try {
    unlinkSync(aside);
  } catch {
    // Already gone.
  }
}

function acquireLock(path: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const descriptor = openSync(path, "wx");
      try {
        writeSync(descriptor, `${String(process.pid)}\n`);
      } finally {
        closeSync(descriptor);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CliError(
          "AUDIT_LOG_FAILED",
          "The audit log lock file could not be created.",
          { lockFile: path, cause: (error as Error).message },
        );
      }
    }
    const owner = lockOwner(path);
    if (owner !== undefined && lockIsStale(path, owner)) {
      breakStaleLock(path, owner);
      continue;
    }
    if (Date.now() > deadline) {
      throw new CliError(
        "AUDIT_LOG_FAILED",
        "The audit log is locked by another writer.",
        { lockFile: path },
      );
    }
    sleep(5 + Math.floor(Math.random() * 20));
  }
}

/** Reads the last line of the log (the chain head) without reading it all. */
function lastLine(descriptor: number): string | undefined {
  const size = fstatSync(descriptor).size;
  if (size === 0) {
    return undefined;
  }
  const chunkSize = 64 * 1024;
  let end = size;
  let tail = Buffer.alloc(0);
  while (end > 0) {
    const start = Math.max(0, end - chunkSize);
    const chunk = Buffer.alloc(end - start);
    readSync(descriptor, chunk, 0, chunk.length, start);
    tail = Buffer.concat([chunk, tail]);
    end = start;
    // The file ends with "\n"; look for the newline before the last line.
    const previous = tail.lastIndexOf(0x0a, tail.length - 2);
    if (previous !== -1) {
      return tail.subarray(previous + 1).toString("utf8");
    }
  }
  return tail.toString("utf8");
}

function chainHead(
  logPath: string,
  descriptor: number,
): {
  readonly seq: number;
  readonly hash: string;
} {
  const line = lastLine(descriptor);
  if (line === undefined) {
    return { seq: 0, hash: GENESIS_HASH };
  }
  const damaged = (): CliError =>
    new CliError(
      "AUDIT_LOG_FAILED",
      "The last audit log entry is damaged. Run forensix audit verify on the log.",
      { auditLog: logPath },
    );
  if (!line.endsWith("\n")) {
    throw damaged();
  }
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    throw damaged();
  }
  const record = entry as Partial<AuditEntry> | null;
  // Authenticate the head before chaining onto it: an edited last line that
  // kept its old hash must not get a valid-looking successor.
  if (
    record === null ||
    typeof record !== "object" ||
    record.version !== 1 ||
    typeof record.seq !== "number" ||
    !Number.isSafeInteger(record.seq) ||
    record.seq < 1 ||
    typeof record.prevHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.prevHash) ||
    typeof record.hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.hash) ||
    entryHash(record as Readonly<Record<string, unknown>>) !== record.hash
  ) {
    throw damaged();
  }
  return { seq: record.seq, hash: record.hash };
}

/** The real path of `path`, resolving symlinks in the part that exists. */
function realPathOf(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (true) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return join(current, ...missing.reverse());
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

function isInside(path: string, root: string): boolean {
  const between = relative(root, path);
  return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

/**
 * Refuses an audit log (and its lock file, which sits next to it) inside
 * evidence: the Case Directory, a Source, or an Extract. Writing there would
 * change the evidence that the log is meant to account for. Runs before the
 * lock file is created.
 */
export function assertAuditLogOutsideEvidence(
  logPath: string,
  evidenceRoots: readonly string[],
): void {
  const log = realPathOf(logPath);
  for (const root of evidenceRoots) {
    const realRoot = realPathOf(root);
    if (isInside(log, realRoot)) {
      throw new CliError(
        "AUDIT_LOG_FAILED",
        "The audit log must be outside the Case, the Source, and the Extract.",
        { auditLog: logPath, evidencePath: root },
      );
    }
  }
}

/** Appends one entry under the lock and returns the stamp to print. */
export function appendAuditEntry(
  logPath: string,
  input: AuditInput,
): AuditStamp {
  const lockPath = `${logPath}.lock`;
  acquireLock(lockPath);
  try {
    let descriptor: number;
    try {
      descriptor = openSync(logPath, "a+");
    } catch (error) {
      throw new CliError(
        "AUDIT_LOG_FAILED",
        "The audit log could not be opened.",
        { auditLog: logPath, cause: (error as Error).message },
      );
    }
    try {
      const head = chainHead(logPath, descriptor);
      const body = {
        version: 1 as const,
        seq: head.seq + 1,
        id: randomUUID(),
        time: new Date().toISOString(),
        toolVersion: input.toolVersion,
        command: input.command,
        argv: input.argv,
        caseDirectory: input.caseDirectory,
        exitCode: input.exitCode,
        outputSha256: input.outputSha256,
        prevHash: head.hash,
      };
      const entry: AuditEntry = { ...body, hash: entryHash(body) };
      writeSync(descriptor, `${JSON.stringify(entry)}\n`);
      fsyncSync(descriptor);
      return { id: entry.id, entryHash: entry.hash };
    } finally {
      closeSync(descriptor);
    }
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock already gone.
    }
  }
}

export type AuditBreakReason =
  | "incomplete_entry"
  | "malformed_entry"
  | "unsupported_version"
  | "seq_mismatch"
  | "prev_hash_mismatch"
  | "hash_mismatch";

export interface AuditVerification {
  readonly status: "ok";
  readonly command: "audit-verify";
  readonly log: string;
  readonly entries: number;
  readonly valid: boolean;
  /** The seq position (line number) of the first broken entry. */
  readonly brokenSeq?: number;
  readonly reason?: AuditBreakReason;
  /** The hash of the last entry: keep it elsewhere to detect later cuts. */
  readonly lastHash?: string;
}

/** Checks every line of the log in order. */
export function verifyAuditLog(logPath: string): AuditVerification {
  if (!existsSync(logPath)) {
    throw new CliError("AUDIT_LOG_NOT_FOUND", "The audit log does not exist.", {
      auditLog: logPath,
    });
  }
  const text = readFileSync(logPath, "utf8");
  const lines = text === "" ? [] : text.split("\n");
  const complete = text === "" || text.endsWith("\n");
  if (complete) {
    lines.pop();
  }
  const broken = (
    position: number,
    reason: AuditBreakReason,
  ): AuditVerification => ({
    status: "ok",
    command: "audit-verify",
    log: logPath,
    entries: lines.length,
    valid: false,
    brokenSeq: position,
    reason,
  });
  let previousHash = GENESIS_HASH;
  for (const [index, line] of lines.entries()) {
    const position = index + 1;
    if (!complete && index === lines.length - 1) {
      return broken(position, "incomplete_entry");
    }
    let entry: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return broken(position, "malformed_entry");
      }
      entry = parsed as Record<string, unknown>;
    } catch {
      return broken(position, "malformed_entry");
    }
    if (entry.version !== 1) {
      return broken(position, "unsupported_version");
    }
    if (entry.seq !== position) {
      return broken(position, "seq_mismatch");
    }
    if (entry.prevHash !== previousHash) {
      return broken(position, "prev_hash_mismatch");
    }
    if (entry.hash !== entryHash(entry)) {
      return broken(position, "hash_mismatch");
    }
    previousHash = entry.hash;
  }
  return {
    status: "ok",
    command: "audit-verify",
    log: logPath,
    entries: lines.length,
    valid: true,
    ...(lines.length === 0 ? {} : { lastHash: previousHash }),
  };
}
