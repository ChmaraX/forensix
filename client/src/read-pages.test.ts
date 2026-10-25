import { afterEach, describe, expect, it, vi } from "vitest";

import { once, readPages } from "./read-pages.js";

/** A route of `total` rows served `limit` at a time, its cursor the next
 *  offset; records each request's `after` and signal. */
function stubRoute(total: number, limit: number) {
  const seen: { after: string | null; signal: AbortSignal | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const after = new URL(url, "http://x").searchParams.get("after");
      seen.push({ after, signal: init.signal ?? undefined });
      const start = Number(after ?? "0");
      const items = Array.from(
        { length: Math.max(0, Math.min(limit, total - start)) },
        (_, index) => start + index,
      );
      const next = start + limit < total ? String(start + limit) : null;
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: "ok", items, nextCursor: next, limit }),
          { status: 200 },
        ),
      );
    }),
  );
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPages", () => {
  it("follows the cursor to the end with no row repeated or skipped", async () => {
    const seen = stubRoute(25, 10);
    const read = await readPages<number>("r", [], { cap: 10 });
    expect(read.rows).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(read.complete).toBe(true);
    expect(seen.map((request) => request.after)).toEqual([null, "10", "20"]);
  });

  it("is not complete when the cap stops it with rows unread", async () => {
    stubRoute(25, 10);
    const read = await readPages<number>("r", [], { cap: 2 });
    expect(read).toMatchObject({ complete: false, pages: 2 });
    expect(read.rows).toHaveLength(20);
  });

  it("stops after the page its reader says stop on, the rest unread", async () => {
    const seen = stubRoute(25, 10);
    const read = await readPages<number>("r", [], {
      cap: 10,
      onPage: (rows) => (rows.includes(12) ? "stop" : undefined),
    });
    expect(read.complete).toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("carries the caller's signal on every request", async () => {
    const seen = stubRoute(25, 10);
    const abort = new AbortController();
    await readPages<number>("r", [], { cap: 10, signal: abort.signal });
    expect(seen.every((request) => request.signal === abort.signal)).toBe(true);
  });
});

describe("once", () => {
  it("reads once, forgets a failure, and reads again on refresh", async () => {
    let calls = 0;
    let fail = true;
    const read = once(() => {
      calls += 1;
      return fail ? Promise.reject(new Error("down")) : Promise.resolve(calls);
    });
    await expect(read()).rejects.toThrow("down");
    fail = false;
    await expect(read()).resolves.toBe(2);
    await expect(read()).resolves.toBe(2);
    await expect(read(true)).resolves.toBe(3);
  });
});
