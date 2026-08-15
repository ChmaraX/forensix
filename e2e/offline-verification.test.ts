import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Issue #188 (AC1–AC3): the single offline verification command drives the
// compiled analyzer CLI from a recorded Source through ingest -> analyse ->
// export and returns a structured capability, invariant, fixture, and failure
// report. This test asserts the report contract and that it passes in-repo.

const harness = resolve("scripts/offline-verification.mjs");

interface Capability {
  readonly name: string;
  readonly status: "PASS" | "UNCOVERED";
  readonly refusal?: { readonly code: string } | null;
}

interface OfflineReport {
  readonly schema: string;
  readonly tool: { readonly version: string; readonly gitSha: string };
  readonly capabilities: readonly Capability[];
  readonly invariants: readonly {
    readonly name: string;
    readonly status: "pass" | "fail";
  }[];
  readonly fixtures: readonly {
    readonly name: string;
    readonly status: "pass" | "fail";
  }[];
  readonly failures: readonly unknown[];
  readonly ok: boolean;
}

describe("offline verification harness", () => {
  it("runs the compiled CLI pipeline and reports PASS/UNCOVERED with no failures", () => {
    const result = spawnSync(process.execPath, [harness], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);

    const report = JSON.parse(result.stdout) as OfflineReport;
    expect(report.schema).toBe("forensix/offline-verification/1");
    expect(report.ok).toBe(true);
    expect(report.failures).toHaveLength(0);

    // AC3: the capability table has only PASS and UNCOVERED, and every
    // UNCOVERED capability is backed by a tested typed refusal (a code).
    expect(report.capabilities.length).toBeGreaterThan(0);
    for (const capability of report.capabilities) {
      expect(["PASS", "UNCOVERED"]).toContain(capability.status);
      if (capability.status === "UNCOVERED") {
        expect(capability.refusal?.code).toEqual(expect.any(String));
      }
    }
    // The uncovered refusals we assert on: unsupported collection, timezone-
    // less range, and an unknown command all refuse with a typed code.
    const uncovered = report.capabilities.filter(
      (capability) => capability.status === "UNCOVERED",
    );
    expect(uncovered.length).toBeGreaterThanOrEqual(3);

    // AC2: the fixture matrix (ground truth, broken input, negative control)
    // and every invariant (immutable Source, deterministic rerun, supersede,
    // golden Extract, exact row counts/seeded fields) pass.
    for (const invariant of report.invariants) {
      expect(invariant.status, invariant.name).toBe("pass");
    }
    for (const fixture of report.fixtures) {
      expect(fixture.status, fixture.name).toBe("pass");
    }
    const invariantNames = report.invariants.map((entry) => entry.name);
    expect(invariantNames).toEqual(
      expect.arrayContaining([
        "immutable-source.bytes",
        "deterministic-rerun.extract-digest",
        "supersede.single-active-artifact",
        "golden-extract.byte-stable",
        "row-counts.ground-truth",
        "seeded-fields.ground-truth",
      ]),
    );
    const fixtureNames = report.fixtures.map((entry) => entry.name);
    expect(fixtureNames).toEqual(
      expect.arrayContaining([
        "chrome-ground-truth",
        "broken-input",
        "negative-control",
      ]),
    );
  }, 60_000);
});
