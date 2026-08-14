import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkingCopyIntegrityRefusal } from "../src/errors.js";
import { readVerifiedJsonFile } from "../src/working-copy-json.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function writeFixture(contents: string): Promise<{
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "forensix-prefs-json-"));
  roots.push(root);
  const path = join(root, "Preferences");
  await writeFile(path, contents);
  const bytes = Buffer.from(contents);
  return {
    path,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

describe("readVerifiedJsonFile", () => {
  it("parses a JSON document that matches its recorded representation", async () => {
    const fixture = await writeFixture('{"profile":{"name":"Ada"}}');
    const result = await readVerifiedJsonFile({
      path: fixture.path,
      manifestPath: "Default/Preferences",
      size: fixture.size,
      sha256: fixture.sha256,
    });
    expect(result).toEqual({
      status: "parsed",
      value: { profile: { name: "Ada" } },
    });
  });

  it("reports a byte-intact but unparseable document as unreadable", async () => {
    const fixture = await writeFixture("{ not json ,,");
    const result = await readVerifiedJsonFile({
      path: fixture.path,
      manifestPath: "Local State",
      size: fixture.size,
      sha256: fixture.sha256,
    });
    expect(result).toEqual({ status: "unreadable", reason: "malformed_json" });
  });

  it("refuses content whose hash drifted from the Manifest", async () => {
    const fixture = await writeFixture('{"a":1}');
    await expect(
      readVerifiedJsonFile({
        path: fixture.path,
        manifestPath: "Local State",
        size: fixture.size,
        sha256: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(WorkingCopyIntegrityRefusal);
  });

  it("refuses content whose size drifted from the Manifest", async () => {
    const fixture = await writeFixture('{"a":1}');
    await expect(
      readVerifiedJsonFile({
        path: fixture.path,
        manifestPath: "Local State",
        size: fixture.size + 1,
        sha256: fixture.sha256,
      }),
    ).rejects.toBeInstanceOf(WorkingCopyIntegrityRefusal);
  });

  it("refuses a missing Working Copy file", async () => {
    await expect(
      readVerifiedJsonFile({
        path: join(tmpdir(), "forensix-does-not-exist", "Preferences"),
        manifestPath: "Default/Preferences",
        size: 2,
        sha256: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(WorkingCopyIntegrityRefusal);
  });
});
