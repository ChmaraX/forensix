import { describe, expect, it } from "vitest";

import type { CompletenessStatement } from "../types.js";
import type { CoverageScope } from "./completeness.js";
import { emptyCoverageOf, joinWords } from "./identity-coverage.js";

function entry(
  profile: string,
  outcome: "produced" | "absent" | "unavailable",
) {
  return {
    sourceId: "src-01",
    profile,
    artifact: "Login Data",
    databasePath: `${profile}/Login Data`,
    outcome,
    reason: outcome === "produced" ? null : "reason",
    runId: "run-1",
  } as const;
}

function scopeOf(
  entries: readonly ReturnType<typeof entry>[],
  statements = true,
): CoverageScope {
  const count = (outcome: string) =>
    entries.filter((item) => item.outcome === outcome).length;
  const statement: CompletenessStatement = {
    artifact: "Login Data",
    attempted: entries.length,
    produced: count("produced"),
    absent: count("absent"),
    unavailable: count("unavailable"),
    artifacts: entries,
  };
  return {
    statements: statements ? [statement] : [],
    missing: statements ? [] : ["Login Data"],
    attempted: statement.attempted,
    produced: statement.produced,
    absent: statement.absent,
    unavailable: statement.unavailable,
    degraded: statement.produced < statement.attempted || !statements,
    state: "produced",
    merged: false,
  };
}

describe("joinWords", () => {
  it("joins one, two and more names for a sentence", () => {
    expect(joinWords([])).toBe("");
    expect(joinWords(["A"])).toBe("A");
    expect(joinWords(["A", "B"])).toBe("A and B");
    expect(joinWords(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("emptyCoverageOf", () => {
  it("is unknown until the statement is read", () => {
    expect(emptyCoverageOf(null)).toEqual({ kind: "unknown" });
  });

  it("names the profiles whose file was read", () => {
    expect(
      emptyCoverageOf(
        scopeOf([entry("Default", "produced"), entry("Profile 2", "produced")]),
      ),
    ).toEqual({ kind: "read", read: "Default profile and Profile 2" });
  });

  it("names only the read profiles when others were not read", () => {
    expect(
      emptyCoverageOf(
        scopeOf([entry("Default", "produced"), entry("Profile 3", "absent")]),
      ),
    ).toEqual({ kind: "read", read: "Default profile" });
  });

  it("keeps a missing file apart from an empty one", () => {
    expect(
      emptyCoverageOf(
        scopeOf([entry("Default", "absent"), entry("Profile 2", "absent")]),
      ),
    ).toEqual({ kind: "no-file" });
  });

  it("never calls an unreadable file missing", () => {
    expect(
      emptyCoverageOf(
        scopeOf([
          entry("Default", "unavailable"),
          entry("Profile 2", "absent"),
        ]),
      ),
    ).toEqual({ kind: "unknown" });
  });

  it("says when the artifact was not analysed", () => {
    expect(emptyCoverageOf(scopeOf([], false))).toEqual({
      kind: "not-analysed",
    });
  });
});
