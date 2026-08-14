import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { analyseSourceBookmarks } from "../src/bookmarks.js";
import type { BookmarksArtifactWrite } from "../src/case-findings.js";
import type { CaseSourceRecord } from "../src/case.js";
import type { FieldState, Finding } from "../src/forensic-model.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

interface EntrySpec {
  readonly path: string;
  readonly state?: "value" | "absent" | "unavailable";
  readonly unavailableReason?: string;
  readonly bytes?: string;
}

/**
 * Materialize a Working Copy on disk and build the matching manifest entries so
 * `readVerifiedJsonFile` re-verifies against the exact recorded representation.
 */
async function buildSource(options: {
  readonly workingCopyPath: string;
  readonly profiles: readonly string[];
  readonly entries: readonly EntrySpec[];
}): Promise<CaseSourceRecord> {
  const entries = [];
  for (const spec of options.entries) {
    const state = spec.state ?? "value";
    if (state === "value" && spec.bytes !== undefined) {
      const absolute = join(options.workingCopyPath, ...spec.path.split("/"));
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, spec.bytes);
      const buffer = Buffer.from(spec.bytes);
      entries.push({
        path: spec.path,
        state: "value",
        unavailable_reason: null,
        node_type: "file",
        copied: true,
        size: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
      continue;
    }
    entries.push({
      path: spec.path,
      state,
      unavailable_reason: spec.unavailableReason ?? null,
      node_type: state === "absent" ? "absent" : "file",
      copied: false,
      size: null,
      sha256: null,
    });
  }
  return {
    sourceId: "SRC-TEST",
    entries,
    profiles: options.profiles.map((path, index) => ({
      profileId: `P-${index}`,
      path,
    })),
  } as unknown as CaseSourceRecord;
}

function field(finding: Finding, name: string): FieldState<unknown> {
  const value = finding.fields[name];
  if (value === undefined) {
    throw new Error(`Finding has no field ${name}`);
  }
  return value;
}

function complete(
  artifacts: readonly BookmarksArtifactWrite[],
  artifact: "Bookmarks" | "Bookmarks.bak",
  profile: string,
): BookmarksArtifactWrite {
  const match = artifacts.find(
    (candidate) =>
      candidate.artifact === artifact && candidate.profile === profile,
  );
  if (match === undefined) {
    throw new Error(`No ${artifact} artifact for ${profile}`);
  }
  return match;
}

describe("analyseSourceBookmarks", () => {
  it("carries deep folder ancestry and falls back to guid for a missing id", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bm-unit-"));
    temporaryRoots.push(root);
    const workingCopyPath = join(root, "working-copy");
    const document = JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          id: "1",
          name: "Bookmarks bar",
          children: [
            {
              type: "folder",
              id: "2",
              name: "Reading",
              children: [
                {
                  type: "folder",
                  id: "3",
                  name: "Papers",
                  children: [
                    {
                      // No id: the rowId and bookmarkId fall back to the guid.
                      type: "url",
                      guid: "guid-deep",
                      name: "Deep",
                      url: "https://deep.example.com/",
                      date_added: "13350000000000000",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const source = await buildSource({
      workingCopyPath,
      profiles: ["Default"],
      entries: [{ path: "Default/Bookmarks", bytes: document }],
    });

    const artifacts = await analyseSourceBookmarks({
      source,
      workingCopyPath,
      declaredTimezone: "UTC",
    });
    const primary = complete(artifacts, "Bookmarks", "Default");
    expect(primary.status).toBe("complete");
    expect(primary.findings).toHaveLength(1);
    const deep = primary.findings[0]?.finding as Finding;
    expect(field(deep, "folderPath")).toEqual({
      state: "value",
      value: "Bookmarks bar / Reading / Papers",
      synthetic: true,
    });
    expect(field(deep, "parentFolder")).toEqual({
      state: "value",
      value: "Papers",
    });
    expect(field(deep, "bookmarkId")).toEqual({ state: "absent" });
    expect(field(deep, "guid")).toEqual({
      state: "value",
      value: "guid-deep",
    });
    // The rowId falls back to the guid so Provenance stays resolvable.
    expect(deep.provenance.rowId).toBe("guid-deep");
  });

  it("keeps a url node with a missing url/name as typed field states", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bm-partial-"));
    temporaryRoots.push(root);
    const workingCopyPath = join(root, "working-copy");
    const document = JSON.stringify({
      roots: {
        other: {
          type: "folder",
          id: "2",
          name: "Other bookmarks",
          children: [
            { type: "url", id: "7", name: "No URL", date_added: "0" },
            { type: "url", id: "8", url: "https://no-name.example.com/" },
            // A non-object child and an unknown-type node are both skipped.
            42,
            { type: "separator", id: "9" },
          ],
        },
      },
    });
    const source = await buildSource({
      workingCopyPath,
      profiles: ["Default"],
      entries: [{ path: "Default/Bookmarks", bytes: document }],
    });

    const artifacts = await analyseSourceBookmarks({
      source,
      workingCopyPath,
      declaredTimezone: "UTC",
    });
    const primary = complete(artifacts, "Bookmarks", "Default");
    expect(primary.findings).toHaveLength(2);
    const [first, second] = primary.findings;
    expect(field(first?.finding as Finding, "url")).toEqual({
      state: "absent",
    });
    // date_added "0" is the Chrome "never" sentinel, so it is absent.
    expect(field(first?.finding as Finding, "dateAdded")).toEqual({
      state: "absent",
    });
    expect(field(second?.finding as Finding, "name")).toEqual({
      state: "absent",
    });
    expect(field(second?.finding as Finding, "url")).toEqual({
      state: "value",
      value: "https://no-name.example.com/",
    });
  });

  it("distinguishes absent, malformed, and unsupported-shape files", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bm-status-"));
    temporaryRoots.push(root);
    const workingCopyPath = join(root, "working-copy");
    const source = await buildSource({
      workingCopyPath,
      profiles: ["Default"],
      entries: [
        // Primary parses as JSON but has no roots: unsupported shape.
        { path: "Default/Bookmarks", bytes: JSON.stringify({ version: 1 }) },
        // Backup is byte-intact but not JSON: malformed.
        { path: "Default/Bookmarks.bak", bytes: "{ broken," },
      ],
    });

    const artifacts = await analyseSourceBookmarks({
      source,
      workingCopyPath,
      declaredTimezone: "UTC",
    });
    const primary = artifacts.find(
      (candidate) => candidate.artifact === "Bookmarks",
    );
    const backup = artifacts.find(
      (candidate) => candidate.artifact === "Bookmarks.bak",
    );
    expect(primary).toMatchObject({
      status: "unavailable",
      reason: "bookmarks_unsupported_shape",
      findings: [],
    });
    expect(backup).toMatchObject({
      status: "unavailable",
      reason: "bookmarks_backup_malformed_json",
    });
  });

  it("marks an expected-but-missing file absent, not unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bm-absent-"));
    temporaryRoots.push(root);
    const workingCopyPath = join(root, "working-copy");
    const source = await buildSource({
      workingCopyPath,
      profiles: ["Default"],
      entries: [
        { path: "Default/Bookmarks", bytes: JSON.stringify({ roots: {} }) },
        { path: "Default/Bookmarks.bak", state: "absent" },
      ],
    });

    const artifacts = await analyseSourceBookmarks({
      source,
      workingCopyPath,
      declaredTimezone: "UTC",
    });
    const backup = complete(artifacts, "Bookmarks.bak", "Default");
    expect(backup.status).toBe("absent");
    expect(backup.reason).toBe("bookmarks_backup_absent");
    expect(backup.findings).toHaveLength(0);
  });
});
