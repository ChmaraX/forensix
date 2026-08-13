import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalManifestLine,
  classifySourcePath,
  decodeManifestEntry,
  decodeManifestHeader,
  evidenceSetDigest,
  manifestBytes,
  representationDigest,
  workingCopyDigest,
  type ManifestEntry,
  type NodeType,
} from "../src/index.js";

const fixtureRoot = resolve("contracts/manifest/fixtures");

function independentSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Manifest contract v1", () => {
  it("matches the shared canonical JSONL fixture byte for byte", async () => {
    const directory = resolve(fixtureRoot, "canonical-v1");
    const entries = JSON.parse(
      await readFile(resolve(directory, "entries.json"), "utf8"),
    ) as ManifestEntry[];
    const expectedManifest = await readFile(
      resolve(directory, "manifest.jsonl"),
    );
    const expectedDigests = JSON.parse(
      await readFile(resolve(directory, "expected-digests.json"), "utf8"),
    ) as {
      readonly evidence_set_digest: string;
      readonly working_copy_digest: string;
    };
    const expectedHeader = JSON.parse(
      await readFile(resolve(directory, "manifest_header.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(expectedHeader).toMatchObject({
      manifest_schema: "forensix/manifest/1",
      selection_policy: "chrome-userdata/1",
      evidence_set_digest: expectedDigests.evidence_set_digest,
      working_copy_digest: expectedDigests.working_copy_digest,
      entry_count: entries.length,
    });
    expect(manifestBytes(entries)).toEqual(expectedManifest);
    expect(evidenceSetDigest(entries)).toBe(
      expectedDigests.evidence_set_digest,
    );
    expect(workingCopyDigest(entries)).toBe(
      expectedDigests.working_copy_digest,
    );

    const lines = expectedManifest.toString("utf8").trimEnd().split("\n");
    expect(independentSha256(expectedManifest)).toBe(
      expectedDigests.evidence_set_digest,
    );
    expect(
      independentSha256(
        `${lines.filter((line) => JSON.parse(line).copied === true).join("\n")}\n`,
      ),
    ).toBe(expectedDigests.working_copy_digest);
    expect([...lines].sort()).toEqual(lines);
    expect(entries.map(canonicalManifestLine)).not.toEqual(lines);
    expect(decodeManifestHeader(expectedHeader)).toEqual(expectedHeader);
    expect(entries.map(decodeManifestEntry)).toEqual(entries);
  });

  it("rejects values outside the runtime Manifest contract", () => {
    const valid = {
      path: "Default/History",
      state: "value",
      unavailable_reason: null,
      node_type: "file",
      file_kind: "database",
      selection_tier: "tier_1",
      copied: true,
      unclassified: false,
      size: 1,
      mtime_ns: "1",
      hash_algorithm: "sha-256",
      sha256: independentSha256("x"),
      link_target: null,
    };

    expect(() => decodeManifestEntry({ ...valid, state: "invented" })).toThrow(
      "state has an unsupported value",
    );
    expect(() =>
      decodeManifestEntry({ ...valid, node_type: "invented" }),
    ).toThrow("node_type has an unsupported value");
    expect(() =>
      decodeManifestEntry({ ...valid, file_kind: "invented" }),
    ).toThrow("file_kind has an unsupported value");
    expect(() =>
      decodeManifestEntry({ ...valid, selection_tier: "invented" }),
    ).toThrow("selection_tier has an unsupported value");
    expect(() => decodeManifestEntry({ ...valid, extra: true })).toThrow(
      "missing or unknown fields",
    );
  });

  it("hashes non-file representations without dereferencing them", () => {
    expect(representationDigest("symlink", "host-1234")).toBe(
      independentSha256("host-1234"),
    );
    expect(representationDigest("socket")).toBe(independentSha256("socket"));
    expect(representationDigest("dir")).toBe(independentSha256("dir"));
    expect(representationDigest("absent")).toBe(independentSha256("absent"));
  });

  it("matches the language-neutral Selection Policy fixture", async () => {
    const fixture = JSON.parse(
      await readFile(resolve(fixtureRoot, "selection-policy-v1.json"), "utf8"),
    ) as {
      readonly cases: readonly {
        readonly path: string;
        readonly node_type: NodeType;
        readonly selection_tier: string;
        readonly file_kind: string;
        readonly unclassified: boolean;
        readonly copy_default: boolean;
        readonly copy_with_tier_2: boolean;
      }[];
    };

    for (const testCase of fixture.cases) {
      const selection = classifySourcePath(testCase.path, testCase.node_type);
      const regularFile = testCase.node_type === "file";
      expect(selection, testCase.path).toEqual({
        tier: testCase.selection_tier,
        fileKind: testCase.file_kind,
        unclassified: testCase.unclassified,
      });
      expect(
        regularFile && selection.tier === "tier_1",
        `${testCase.path} default copy state`,
      ).toBe(testCase.copy_default);
      expect(
        regularFile &&
          (selection.tier === "tier_1" || selection.tier === "tier_2"),
        `${testCase.path} Tier 2 copy state`,
      ).toBe(testCase.copy_with_tier_2);
    }
  });
});
