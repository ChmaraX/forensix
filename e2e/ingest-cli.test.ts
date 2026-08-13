import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ManifestEntry {
  readonly path: string;
  readonly state: "value" | "absent" | "unavailable";
  readonly unavailable_reason: string | null;
  readonly node_type: "file" | "symlink" | "socket" | "dir" | "absent";
  readonly file_kind: string;
  readonly selection_tier: "tier_1" | "tier_2" | "tier_3" | "unclassified";
  readonly copied: boolean;
  readonly unclassified: boolean;
  readonly size: number | null;
  readonly mtime_ns: string | null;
  readonly hash_algorithm: "sha-256";
  readonly sha256: string | null;
  readonly link_target: string | null;
}

interface IngestOutput {
  readonly status: "ok";
  readonly caseDirectory: string;
  readonly workingCopyPath: string;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly profileCount: number;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly unavailableCount: number;
  readonly unclassifiedCount: number;
  readonly tier2Included: boolean;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runCli(arguments_: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function createRecordedSource(root: string): Promise<{
  readonly source: string;
  readonly hasSymlink: boolean;
}> {
  const source = join(root, "source");
  await writeFixtureFile(
    join(source, "Local State"),
    '{"browser":"fixture"}\n',
  );
  await writeFixtureFile(join(source, "Default", "History"), "history-main\n");
  await writeFixtureFile(
    join(source, "Default", "History-wal"),
    "history-sidecar\n",
  );
  await writeFixtureFile(
    join(source, "Default", "Network", "Cookies"),
    "cookies\n",
  );
  await writeFixtureFile(
    join(source, "Default", "Preferences"),
    '{"profile":"Default"}\n',
  );
  await writeFixtureFile(
    join(source, "Default", "Cache", "cache-entry"),
    "bulk-cache\n",
  );
  await writeFixtureFile(join(source, "Default", "DIPS"), "tier-three\n");
  await writeFixtureFile(
    join(source, "Default", "mystery.bin"),
    "unclassified\n",
  );
  await writeFixtureFile(join(source, "Profile 1", "Web Data"), "web-data\n");
  await writeFixtureFile(
    join(source, "Profile 1", "Bookmarks"),
    '{"roots":{}}\n',
  );

  let hasSymlink = false;
  if (process.platform !== "win32") {
    await symlink("host-4242", join(source, "SingletonLock"));
    hasSymlink = true;
  }
  return { source, hasSymlink };
}

async function sourceSnapshot(root: string): Promise<readonly string[]> {
  const records: string[] = [];

  async function walk(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const names = await readdir(directory);
    names.sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    for (const name of names) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      const absolutePath = join(directory, name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        records.push(
          `${relativePath}\0symlink\0${await readlink(absolutePath)}`,
        );
      } else if (stats.isDirectory()) {
        records.push(`${relativePath}\0dir`);
        await walk(absolutePath, relativePath);
      } else if (stats.isFile()) {
        records.push(
          `${relativePath}\0file\0${sha256(await readFile(absolutePath))}`,
        );
      } else if (stats.isSocket()) {
        records.push(`${relativePath}\0socket`);
      } else {
        records.push(`${relativePath}\0other`);
      }
    }
  }

  await walk(root, "");
  return records;
}

async function readManifest(caseDirectory: string): Promise<{
  readonly bytes: Buffer;
  readonly lines: readonly string[];
  readonly entries: readonly ManifestEntry[];
}> {
  const bytes = await readFile(join(caseDirectory, "manifest.jsonl"));
  const text = bytes.toString("utf8");
  expect(text.endsWith("\n")).toBe(true);
  const lines = text.slice(0, -1).split("\n");
  return {
    bytes,
    lines,
    entries: lines.map((line) => JSON.parse(line) as ManifestEntry),
  };
}

function independentWorkingDigest(lines: readonly string[]): string {
  const copiedBytes = Buffer.from(
    lines
      .filter(
        (line) => (JSON.parse(line) as { readonly copied: boolean }).copied,
      )
      .map((line) => `${line}\n`)
      .join(""),
    "utf8",
  );
  return sha256(copiedBytes);
}

async function verifyRepresentationsIndependently(
  source: string,
  entries: readonly ManifestEntry[],
): Promise<void> {
  for (const entry of entries) {
    const path = join(source, ...entry.path.split("/"));
    if (entry.state === "unavailable") {
      expect(entry.sha256, entry.path).toBeNull();
      expect(entry.unavailable_reason, entry.path).toBeTruthy();
      continue;
    }
    if (entry.node_type === "absent") {
      await expect(lstat(path), entry.path).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(entry.sha256, entry.path).toBe(sha256("absent"));
      continue;
    }
    if (entry.node_type === "file") {
      const bytes = await readFile(path);
      expect(entry.size, entry.path).toBe(bytes.length);
      expect(entry.sha256, entry.path).toBe(sha256(bytes));
      continue;
    }
    if (entry.node_type === "symlink") {
      const target = await readlink(path);
      expect(entry.link_target, entry.path).toBe(target);
      expect(entry.sha256, entry.path).toBe(sha256(target));
      continue;
    }
    expect(entry.sha256, entry.path).toBe(sha256(entry.node_type));
  }
}

function findEntry(
  entries: readonly ManifestEntry[],
  path: string,
): ManifestEntry {
  const entry = entries.find((candidate) => candidate.path === path);
  expect(entry, path).toBeDefined();
  return entry as ManifestEntry;
}

function openCaseReadOnly(caseDirectory: string): DatabaseSync {
  const url = pathToFileURL(join(caseDirectory, "case.fxdb"));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url.href);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI ingest", () => {
  it("creates one multi-Profile Case and independently reproducible digests", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-ingest-e2e-"));
    temporaryRoots.push(root);
    const { source, hasSymlink } = await createRecordedSource(root);
    const before = await sourceSnapshot(source);
    const caseDirectory = join(root, "CASE-001");

    const command = runCli([
      "ingest",
      source,
      "--case",
      caseDirectory,
      "--json",
    ]);
    expect(command.stderr).toBe("");
    expect(command.status).toBe(0);
    const output = parseJson<IngestOutput>(command.stdout);
    expect(output).toMatchObject({
      status: "ok",
      caseDirectory,
      profileCount: 2,
      entryCount: hasSymlink ? 95 : 94,
      copiedEntryCount: 7,
      unavailableCount: 0,
      unclassifiedCount: 1,
      tier2Included: false,
    });

    const manifest = await readManifest(caseDirectory);
    const sortedLines = [...manifest.lines].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    expect(manifest.lines).toEqual(sortedLines);
    expect(sha256(manifest.bytes)).toBe(output.evidenceSetDigest);
    expect(independentWorkingDigest(manifest.lines)).toBe(
      output.workingCopyDigest,
    );
    await verifyRepresentationsIndependently(source, manifest.entries);
    expect(await sourceSnapshot(source)).toEqual(before);

    expect(findEntry(manifest.entries, "Default/History")).toMatchObject({
      file_kind: "database",
      selection_tier: "tier_1",
      copied: true,
    });
    expect(findEntry(manifest.entries, "Default/History-wal")).toMatchObject({
      file_kind: "sidecar",
      copied: true,
    });
    expect(findEntry(manifest.entries, "Profile 1/History")).toMatchObject({
      state: "absent",
      node_type: "absent",
      copied: false,
    });
    expect(
      findEntry(manifest.entries, "Default/Cache/cache-entry"),
    ).toMatchObject({
      selection_tier: "tier_2",
      copied: false,
    });
    expect(findEntry(manifest.entries, "Default/DIPS")).toMatchObject({
      selection_tier: "tier_3",
      copied: false,
    });
    expect(findEntry(manifest.entries, "Default/mystery.bin")).toMatchObject({
      selection_tier: "unclassified",
      unclassified: true,
      copied: false,
    });
    if (hasSymlink) {
      expect(findEntry(manifest.entries, "SingletonLock")).toMatchObject({
        node_type: "symlink",
        link_target: "host-4242",
        copied: false,
      });
      await expect(
        lstat(join(output.workingCopyPath, "SingletonLock")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    }

    for (const entry of manifest.entries.filter(
      (candidate) => candidate.copied,
    )) {
      const copiedBytes = await readFile(
        join(output.workingCopyPath, ...entry.path.split("/")),
      );
      expect(sha256(copiedBytes), entry.path).toBe(entry.sha256);
    }

    const database = openCaseReadOnly(caseDirectory);
    try {
      const sourceRow = database
        .prepare(
          `SELECT selection_policy, tier_2_included, evidence_set_digest,
                  working_copy_path, working_copy_digest, profile_count, entry_count
             FROM sources`,
        )
        .get() as Record<string, unknown>;
      expect(sourceRow).toEqual({
        selection_policy: "chrome-userdata/1",
        tier_2_included: 0,
        evidence_set_digest: output.evidenceSetDigest,
        working_copy_path: "working-copy",
        working_copy_digest: output.workingCopyDigest,
        profile_count: 2,
        entry_count: hasSymlink ? 95 : 94,
      });
      expect(
        database.prepare("SELECT path FROM profiles ORDER BY path").all(),
      ).toEqual([{ path: "Default" }, { path: "Profile 1" }]);
      const caseEntries = database
        .prepare(
          `SELECT path, state, unavailable_reason, node_type, file_kind,
                  selection_tier, copied, unclassified, size, mtime_ns,
                  hash_algorithm, sha256, link_target
             FROM manifest_entries
            ORDER BY ordinal`,
        )
        .all()
        .map((row) => {
          const entry = row as Record<string, unknown>;
          return {
            ...entry,
            copied: entry.copied === 1,
            unclassified: entry.unclassified === 1,
          };
        });
      expect(caseEntries).toEqual(manifest.entries);
    } finally {
      database.close();
    }

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      status: "verified",
      command: "analyse",
      analysisStatus: "ready",
      evidenceSetDigest: output.evidenceSetDigest,
      workingCopyDigest: output.workingCopyDigest,
      verifiedFileCount: 7,
    });
    await expect(
      lstat(join(caseDirectory, "case.fxdb-wal")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      lstat(join(caseDirectory, "case.fxdb-shm")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const tierTwoCase = join(root, "CASE-002");
    const tierTwoCommand = runCli([
      "ingest",
      source,
      "--case",
      tierTwoCase,
      "--include-tier-2",
      "--json",
    ]);
    expect(tierTwoCommand.status).toBe(0);
    const tierTwoOutput = parseJson<IngestOutput>(tierTwoCommand.stdout);
    expect(tierTwoOutput).toMatchObject({
      tier2Included: true,
      copiedEntryCount: 8,
    });
    const tierTwoManifest = await readManifest(tierTwoCase);
    expect(
      findEntry(tierTwoManifest.entries, "Default/Cache/cache-entry").copied,
    ).toBe(true);
    expect(
      await readFile(
        join(tierTwoOutput.workingCopyPath, "Default", "Cache", "cache-entry"),
        "utf8",
      ),
    ).toBe("bulk-cache\n");
    expect(await sourceSnapshot(source)).toEqual(before);
  });

  it("refuses a Case path whose existing parent symlink enters the Source", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "forensix-case-path-e2e-"));
    temporaryRoots.push(root);
    const { source } = await createRecordedSource(root);
    const sourceBefore = await sourceSnapshot(source);
    const linkedParent = join(root, "linked-parent");
    await symlink(source, linkedParent);

    const command = runCli([
      "ingest",
      source,
      "--case",
      join(linkedParent, "CASE-ESCAPE"),
      "--json",
    ]);
    expect(command.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(command.stderr)).toMatchObject({
      code: "CASE_INSIDE_SOURCE",
    });
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
  });

  it("refuses missing, moved, and changed Working Copy content before analysis", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-refusal-e2e-"));
    temporaryRoots.push(root);
    const { source } = await createRecordedSource(root);
    const sourceBefore = await sourceSnapshot(source);
    const caseDirectory = join(root, "CASE-REFUSAL");
    const ingest = runCli([
      "ingest",
      source,
      "--case",
      caseDirectory,
      "--json",
    ]);
    expect(ingest.status).toBe(0);
    const output = parseJson<IngestOutput>(ingest.stdout);

    const movedPath = `${output.workingCopyPath}-moved`;
    await rename(output.workingCopyPath, movedPath);
    const moved = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(moved.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(moved.stderr)).toMatchObject({
      code: "WORKING_COPY_INTEGRITY_REFUSAL",
      details: { issues: [{ path: ".", reason: "working_copy_missing" }] },
    });
    await rename(movedPath, output.workingCopyPath);

    const historyPath = join(output.workingCopyPath, "Default", "History");
    const heldHistoryPath = join(caseDirectory, "held-History");
    await rename(historyPath, heldHistoryPath);
    const missing = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(missing.status).toBe(1);
    expect(
      parseJson<{
        readonly details: { readonly issues: readonly ManifestEntry[] };
      }>(missing.stderr).details.issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Default/History",
          reason: "entry_missing",
        }),
      ]),
    );
    await rename(heldHistoryPath, historyPath);

    await writeFile(historyPath, "changed-working-copy\n");
    const changed = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(changed.status).toBe(1);
    const changedDiagnostic = parseJson<{
      readonly code: string;
      readonly details: {
        readonly issues: readonly { readonly reason: string }[];
      };
    }>(changed.stderr);
    expect(changedDiagnostic.code).toBe("WORKING_COPY_INTEGRITY_REFUSAL");
    expect(changedDiagnostic.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "entry_hash_mismatch" }),
        expect.objectContaining({ reason: "working_copy_digest_mismatch" }),
      ]),
    );

    await writeFile(historyPath, "history-main\n");
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );

    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"));
    try {
      database
        .prepare(
          "UPDATE sources SET working_copy_path = '../working-copy-escape' WHERE working_copy_path_kind = 'relative'",
        )
        .run();
    } finally {
      database.close();
    }
    const escaped = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(escaped.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(escaped.stderr)).toMatchObject({
      code: "CASE_INVALID",
      message: "Relative Working Copy path escapes the Case Directory.",
    });

    if (process.platform !== "win32") {
      const externalWorkingCopy = join(root, "external-working-copy");
      await rename(output.workingCopyPath, externalWorkingCopy);
      await symlink(root, output.workingCopyPath);
      const symlinkDatabase = new DatabaseSync(
        join(caseDirectory, "case.fxdb"),
      );
      try {
        symlinkDatabase
          .prepare(
            "UPDATE sources SET working_copy_path = 'working-copy/external-working-copy' WHERE working_copy_path_kind = 'relative'",
          )
          .run();
      } finally {
        symlinkDatabase.close();
      }
      const symlinkEscape = runCli([
        "analyse",
        "--case",
        caseDirectory,
        "--json",
      ]);
      expect(symlinkEscape.status).toBe(1);
      expect(
        parseJson<Record<string, unknown>>(symlinkEscape.stderr),
      ).toMatchObject({
        code: "CASE_INVALID",
        message: "Relative Working Copy path escapes the Case Directory.",
      });
      await rm(output.workingCopyPath);

      const absoluteDatabase = new DatabaseSync(
        join(caseDirectory, "case.fxdb"),
      );
      try {
        absoluteDatabase
          .prepare(
            "UPDATE sources SET working_copy_path = ?, working_copy_path_kind = 'absolute'",
          )
          .run(externalWorkingCopy);
      } finally {
        absoluteDatabase.close();
      }
      const absolute = runCli(["analyse", "--case", caseDirectory, "--json"]);
      expect(absolute.status).toBe(0);
      expect(parseJson<Record<string, unknown>>(absolute.stdout)).toMatchObject(
        {
          workingCopyPath: externalWorkingCopy,
        },
      );
    }
    expect(await sourceSnapshot(source)).toEqual(sourceBefore);
  });

  const permissionFailuresAreObservable =
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0;

  it.runIf(permissionFailuresAreObservable)(
    "records a read failure as unavailable(reason), not absent",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "forensix-unavailable-e2e-"));
      temporaryRoots.push(root);
      const { source } = await createRecordedSource(root);
      const unreadablePath = join(source, "Profile 1", "Web Data");
      const originalBytes = await readFile(unreadablePath);
      await chmod(unreadablePath, 0o000);
      const caseDirectory = join(root, "CASE-UNAVAILABLE");

      let command: CliResult;
      try {
        command = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
      } finally {
        await chmod(unreadablePath, 0o600);
      }
      expect(command.status).toBe(0);
      const manifest = await readManifest(caseDirectory);
      expect(findEntry(manifest.entries, "Profile 1/Web Data")).toMatchObject({
        state: "unavailable",
        unavailable_reason: "permission_denied",
        node_type: "file",
        copied: false,
        sha256: null,
      });
      expect(findEntry(manifest.entries, "Profile 1/Web Data").state).not.toBe(
        "absent",
      );
      expect(await readFile(unreadablePath)).toEqual(originalBytes);
    },
  );
});
