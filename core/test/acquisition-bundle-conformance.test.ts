import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquisitionBundleFilesDigest,
  type BundleFile,
} from "../src/acquisition-bundle.js";

// Issue #188 (AC6): the Acquisition Bundle Digest is a single cross-
// implementation contract. The analyzer recomputes it with
// `acquisitionBundleFilesDigest`; the Collector computes it in
// `collector/internal/collector/bundle.go`. Both pin the same shared golden
// file set to the same expected digest, so a divergence in either
// implementation's serialization fails a required check.
const fixtureRoot = resolve(
  "contracts/acquisition-bundle/fixtures/canonical-v1",
);

describe("Acquisition Bundle Digest cross-implementation conformance", () => {
  it("matches the shared golden digest the Collector also pins", () => {
    const files = JSON.parse(
      readFileSync(`${fixtureRoot}/bundle-files.json`, "utf8"),
    ) as BundleFile[];
    const expected = JSON.parse(
      readFileSync(`${fixtureRoot}/expected-bundle-digest.json`, "utf8"),
    ) as { readonly bundle_digest: string };

    expect(acquisitionBundleFilesDigest(files)).toBe(expected.bundle_digest);
  });

  it("depends on file order and content, exposing any serialization drift", () => {
    const files = JSON.parse(
      readFileSync(`${fixtureRoot}/bundle-files.json`, "utf8"),
    ) as BundleFile[];
    const reordered = [...files].reverse();
    expect(acquisitionBundleFilesDigest(reordered)).not.toBe(
      acquisitionBundleFilesDigest(files),
    );
  });
});
