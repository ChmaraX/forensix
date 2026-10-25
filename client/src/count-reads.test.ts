import { describe, expect, it } from "vitest";

import {
  commitStateTotals,
  countParameters,
  distinctValues,
  formatTally,
  recordsWhere,
} from "./count-reads.js";
import type { CountBucket, CountResult } from "./types.js";

function result(buckets: readonly CountBucket[], otherCount = 0): CountResult {
  return {
    status: "ok",
    command: "count",
    kind: "login_credential",
    by: "usernameValue",
    total: buckets.reduce((sum, bucket) => sum + bucket.count, otherCount),
    buckets,
    otherCount,
    limit: 100,
  };
}

describe("distinctValues", () => {
  it("counts recorded, non-empty values only, never a Field State word", () => {
    // "(absent)" as a recorded string is a value; an absent field is not.
    const read = result([
      { state: "value", key: "ada", count: 3 },
      { state: "value", key: "(absent)", count: 1 },
      { state: "value", key: "", count: 2 },
      { state: "absent", key: "(absent)", count: 4 },
      { state: "unavailable", key: "(unavailable:decrypt_failed)", count: 1 },
      { state: "missing", key: "(missing)", count: 1 },
    ]);
    expect(distinctValues(read)).toEqual({ count: 2, more: false });
  });

  it("is a floor when the server listed only its largest buckets", () => {
    const tally = distinctValues(
      result([{ state: "value", key: "ada", count: 3 }], 7),
    );
    expect(tally).toEqual({ count: 1, more: true });
    expect(formatTally(tally)).toBe("1+");
  });
});

describe("recordsWhere", () => {
  it("sums the records of the buckets that pass", () => {
    const read = result([
      { state: "value", key: "Bookmarks.bak", count: 2 },
      { state: "value", key: "Bookmarks", count: 9 },
      { state: "absent", key: "(absent)", count: 1 },
    ]);
    expect(
      recordsWhere(
        read,
        (bucket) => bucket.state === "value" && bucket.key.endsWith(".bak"),
      ),
    ).toEqual({ count: 2, more: false });
  });
});

describe("commitStateTotals", () => {
  it("keeps saved rows apart from WAL and journal rows", () => {
    expect(
      commitStateTotals(
        result([
          { state: "value", key: "committed", count: 180 },
          { state: "value", key: "wal_resident", count: 120 },
          { state: "value", key: "journal_resident", count: 3 },
        ]),
      ),
    ).toEqual({ saved: 180, recovered: 123 });
  });
});

describe("countParameters", () => {
  it("sends the profile pick as repeated parameters", () => {
    expect(
      countParameters({
        kind: "cookie",
        by: "commitState",
        profiles: ["Default", "Profile 2"],
      }),
    ).toEqual([
      ["kind", "cookie"],
      ["by", "commitState"],
      ["profile", "Default"],
      ["profile", "Profile 2"],
      ["limit", "100"],
    ]);
  });
});
