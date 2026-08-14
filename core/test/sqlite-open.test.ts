import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabaseSync } from "../src/index.js";
import { isTransientOpenError } from "../src/sqlite-open.js";

const temporaryRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-sqlite-open-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("isTransientOpenError", () => {
  it("treats SQLITE_BUSY, SQLITE_LOCKED, and SQLITE_CANTOPEN as transient", () => {
    expect(isTransientOpenError({ errcode: 5 })).toBe(true);
    expect(isTransientOpenError({ errcode: 6 })).toBe(true);
    expect(isTransientOpenError({ errcode: 14 })).toBe(true);
  });

  it("masks extended result codes to their primary code", () => {
    // SQLITE_CANTOPEN with an extended high byte still classifies as transient.
    expect(isTransientOpenError({ errcode: 14 + (1 << 8) })).toBe(true);
    // SQLITE_BUSY_SNAPSHOT (0x205) masks to SQLITE_BUSY.
    expect(isTransientOpenError({ errcode: 0x205 })).toBe(true);
  });

  it("does not retry genuine, non-transient errors", () => {
    expect(isTransientOpenError({ errcode: 1 })).toBe(false); // SQLITE_ERROR
    expect(isTransientOpenError({ errcode: 26 })).toBe(false); // SQLITE_NOTADB
    expect(isTransientOpenError({ errcode: 11 })).toBe(false); // SQLITE_CORRUPT
  });

  it("falls back to message matching only when no errcode is present", () => {
    expect(
      isTransientOpenError({ message: "unable to open database file" }),
    ).toBe(true);
    expect(isTransientOpenError({ message: "database is locked" })).toBe(true);
    expect(isTransientOpenError({ message: 'near "x": syntax error' })).toBe(
      false,
    );
  });

  it("rejects non-object inputs", () => {
    expect(isTransientOpenError(null)).toBe(false);
    expect(isTransientOpenError(undefined)).toBe(false);
    expect(isTransientOpenError("unable to open database file")).toBe(false);
  });
});

describe("openDatabaseSync", () => {
  it("opens successfully and applies the configured busy_timeout", async () => {
    const root = await makeRoot();
    const database = openDatabaseSync(join(root, "case.db"), undefined, {
      busyTimeoutMs: 3000,
    });
    try {
      database.exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);");
      expect(database.prepare("SELECT a FROM t").get()).toEqual({ a: 1 });
      expect(database.prepare("PRAGMA busy_timeout").get()).toEqual({
        timeout: 3000,
      });
    } finally {
      database.close();
    }
  });

  it("passes constructor options through unchanged on the success path", async () => {
    const root = await makeRoot();
    const seed = openDatabaseSync(join(root, "case.db"));
    seed.exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (9);");
    seed.close();

    const database = openDatabaseSync(join(root, "case.db"), {
      readBigInts: true,
    });
    try {
      // readBigInts option honored → integer comes back as bigint.
      expect(database.prepare("SELECT a FROM t").get()).toEqual({ a: 9n });
    } finally {
      database.close();
    }
  });

  it("retries a transient open error but stays bounded, then throws", () => {
    // A path under a missing directory yields SQLITE_CANTOPEN (transient), so
    // every attempt fails. The call must give up within the configured budget.
    const doomedPath = join(tmpdir(), "forensix-missing-dir", "nope.db");
    const start = Date.now();
    let thrown: unknown;
    try {
      openDatabaseSync(doomedPath, undefined, {
        maxAttempts: 3,
        maxTotalMs: 1000,
        busyTimeoutMs: 1000,
      });
    } catch (error) {
      thrown = error;
    }
    const elapsed = Date.now() - start;

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { errcode?: number }).errcode).toBe(14);
    // Retried at least once (backoff of ~100ms after the first failure)...
    expect(elapsed).toBeGreaterThanOrEqual(100);
    // ...but never ran away: 3 attempts with 100ms + 200ms backoff ≈ 300ms.
    expect(elapsed).toBeLessThan(1500);
  });
});
