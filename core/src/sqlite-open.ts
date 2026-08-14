import { DatabaseSync } from "node:sqlite";

/**
 * Bounded, honest hardening for SQLite `open` on contended files.
 *
 * On Windows CI the compiled CLI can transiently fail to open a Chrome
 * SQLite file (or a just-copied working snapshot that still carries a hot
 * rollback journal) while another process holds a share/lock on it. SQLite
 * surfaces this as `SQLITE_BUSY`, `SQLITE_LOCKED`, or
 * `SQLITE_CANTOPEN` ("unable to open database file").
 *
 * These helpers add two guardrails and nothing else:
 *
 *   1. A finite `busy_timeout` so a lock contended DURING an open/rollback is
 *      waited on for a few seconds instead of failing instantly.
 *   2. A small, fixed-budget retry that ONLY re-attempts the transient open
 *      errors above. It is never infinite and never retries a genuine error
 *      (corruption, missing file with no writer, schema faults).
 *
 * A successful open behaves exactly as before: same options, same handle,
 * same reads. Only the failure path changes.
 */

type DatabaseSyncOptions = NonNullable<
  ConstructorParameters<typeof DatabaseSync>[1]
>;

export interface OpenDatabaseConfig {
  /** Connection `busy_timeout` in milliseconds. Default 5000. */
  readonly busyTimeoutMs?: number;
  /** Maximum open attempts, including the first. Default 6. */
  readonly maxAttempts?: number;
  /** Total wall-clock budget for retries in milliseconds. Default 2500. */
  readonly maxTotalMs?: number;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_MAX_TOTAL_MS = 2500;

/** SQLite primary result codes we treat as transient (retryable). */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CANTOPEN = 14;
const TRANSIENT_PRIMARY_CODES = new Set([
  SQLITE_BUSY,
  SQLITE_LOCKED,
  SQLITE_CANTOPEN,
]);

/**
 * Classify an error thrown while opening a SQLite database as transient
 * (worth a bounded retry) or not. Exported for unit testing; not re-exported
 * from the package index.
 */
export function isTransientOpenError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const errcode = (error as { errcode?: unknown }).errcode;
  if (typeof errcode === "number") {
    // Mask to the primary result code; the high bits are extended codes
    // (e.g. SQLITE_CANTOPEN_ISDIR) that share the same transient class.
    return TRANSIENT_PRIMARY_CODES.has(errcode & 0xff);
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    (message.includes("unable to open database file") ||
      message.includes("database is locked"))
  );
}

/** Sleep synchronously without spinning the CPU. */
function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) {
    return;
  }
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

/**
 * Open a SQLite database with a finite `busy_timeout` and a bounded retry on
 * transient open/lock errors. Drop-in for `new DatabaseSync(location, options)`.
 */
export function openDatabaseSync(
  location: string | URL,
  options?: DatabaseSyncOptions,
  config?: OpenDatabaseConfig,
): DatabaseSync {
  const busyTimeoutMs = config?.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxTotalMs = config?.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;

  const start = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const database =
        options === undefined
          ? new DatabaseSync(location)
          : new DatabaseSync(location, options);
      // Finite lock wait for any contention hit while opening/rolling back.
      // Never changes query results; only affects contended-lock timing.
      database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      return database;
    } catch (error) {
      const elapsed = Date.now() - start;
      if (
        !isTransientOpenError(error) ||
        attempt >= maxAttempts ||
        elapsed >= maxTotalMs
      ) {
        throw error;
      }
      // Linear backoff, capped by the remaining budget. Bounded by construction.
      const backoff = Math.min(attempt * 100, maxTotalMs - elapsed);
      sleepSync(backoff);
    }
  }
}
