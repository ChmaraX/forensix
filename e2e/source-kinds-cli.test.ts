import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface SourceOutput {
  readonly sourceId: string;
  readonly manifestId: string;
  readonly sourceKind: string;
  readonly sourcePath: string;
  readonly sourceOriginPath: string | null;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly manifestPath: string;
  readonly workingCopyPath: string;
  readonly copiedEntryCount: number;
  readonly profiles: readonly {
    readonly profileId: string;
    readonly path: string;
  }[];
  readonly browserLevelEvidence: readonly {
    readonly path: string;
    readonly state: string;
    readonly reason: string;
  }[];
}

interface IngestOutput {
  readonly status: "ok";
  readonly sourceKind: string;
  readonly sourceCount: number;
  readonly profileCount: number;
  readonly sources: readonly SourceOutput[];
  readonly acquisitionBundleVerification?: {
    readonly status: string;
    readonly expectedBundleDigest: string;
    readonly actualBundleDigest: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly files: readonly {
      readonly scope: string;
      readonly sourceId: string | null;
      readonly path: string;
      readonly outcome: string;
    }[];
  };
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

async function createUserDataDir(path: string, marker: string): Promise<void> {
  await writeFixtureFile(join(path, "Local State"), `{"marker":"${marker}"}\n`);
  await writeFixtureFile(
    join(path, "Default", "History"),
    `history-${marker}\n`,
  );
  await writeFixtureFile(
    join(path, "Default", "Preferences"),
    `{"profile":"${marker}"}\n`,
  );
}

async function treeSnapshot(root: string): Promise<readonly string[]> {
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
      if (stats.isDirectory()) {
        records.push(`${relativePath}\0dir`);
        await walk(absolutePath, relativePath);
      } else if (stats.isFile()) {
        records.push(
          `${relativePath}\0file\0${sha256(await readFile(absolutePath))}`,
        );
      } else if (stats.isSymbolicLink()) {
        records.push(`${relativePath}\0symlink`);
      } else {
        records.push(`${relativePath}\0other`);
      }
    }
  }
  await walk(root, "");
  return records;
}

function ingest(
  source: string,
  sourceKind: string,
  caseDirectory: string,
): { readonly command: CliResult; readonly output: IngestOutput } {
  const command = runCli([
    "ingest",
    source,
    "--source-kind",
    sourceKind,
    "--case",
    caseDirectory,
    "--json",
  ]);
  expect(command.stderr).toBe("");
  expect(command.status).toBe(0);
  return { command, output: parseJson<IngestOutput>(command.stdout) };
}

async function regularFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function walk(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const names = await readdir(directory);
    names.sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    for (const name of names) {
      const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const absolutePath = join(directory, name);
      const stats = await lstat(absolutePath);
      if (stats.isDirectory()) {
        await walk(absolutePath, path);
      } else if (stats.isFile()) {
        files.push(path);
      }
    }
  }
  await walk(root, "");
  return files;
}

async function createBundle(
  root: string,
  inputs: readonly {
    readonly source: string;
    readonly caseDirectory: string;
    readonly account: string;
    readonly index: number;
  }[],
): Promise<string> {
  const bundle = join(root, "bundle");
  await mkdir(bundle);
  const userDataDirs = [];
  for (const input of inputs) {
    const bundlePath = `accounts/${input.account}/udd-${input.index}`;
    const destination = join(bundle, ...bundlePath.split("/"));
    await mkdir(destination, { recursive: true });
    await cp(
      join(input.caseDirectory, "manifest.jsonl"),
      join(destination, "manifest.jsonl"),
    );
    await cp(
      join(input.caseDirectory, "manifest_header.json"),
      join(destination, "manifest_header.json"),
    );
    await cp(
      join(input.caseDirectory, "working-copy"),
      join(destination, "working_copy"),
      { recursive: true },
    );
    userDataDirs.push({
      account_id: input.account,
      bundle_path: bundlePath,
      source_path: input.source,
      outcome: "collected",
      chrome_running: false,
      liveness_evidence: [],
      liveness_explanation: "No supported Chrome Liveness Evidence was found.",
    });
  }
  await writeFixtureFile(
    join(bundle, "collector_record.json"),
    '{"collector":"fixture"}\n',
  );
  await writeFixtureFile(join(bundle, "scan_record.json"), '{"attempts":[]}\n');

  const files = [];
  for (const path of await regularFiles(bundle)) {
    const bytes = await readFile(join(bundle, ...path.split("/")));
    files.push({ path, size: bytes.length, sha256: sha256(bytes) });
  }
  files.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  const bundleDigest = sha256(`${JSON.stringify(files)}\n`);
  await writeFile(
    join(bundle, "bundle_manifest.json"),
    `${JSON.stringify(
      {
        schema_version: "forensix-acquisition-bundle-draft/1",
        hash_algorithm: "sha-256",
        key_material_captured: false,
        user_data_dirs: userDataDirs,
        files,
        bundle_digest: bundleDigest,
      },
      null,
      2,
    )}\n`,
  );
  return bundle;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Source kinds", () => {
  it("ingests a Profile Dir as a partial Source with explicit browser-level unavailability", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-profile-source-"));
    temporaryRoots.push(root);
    const profile = join(root, "partial-profile");
    await writeFixtureFile(join(profile, "History"), "profile-history\n");
    await writeFixtureFile(
      join(profile, "Preferences"),
      '{"profile":"partial"}\n',
    );
    const before = await treeSnapshot(profile);
    const caseDirectory = join(root, "CASE-PROFILE");

    const { output } = ingest(profile, "PROFILE_DIR", caseDirectory);
    expect(output).toMatchObject({
      sourceKind: "PROFILE_DIR",
      sourceCount: 1,
      profileCount: 1,
    });
    expect(output.sources[0]?.profiles).toEqual([
      expect.objectContaining({ path: "." }),
    ]);
    expect(output.sources[0]?.browserLevelEvidence).toEqual(
      expect.arrayContaining([
        {
          path: "Local State",
          state: "unavailable",
          reason: "outside_source",
        },
        {
          path: "RunningChromeVersion",
          state: "unavailable",
          reason: "outside_source",
        },
      ]),
    );
    const manifestText = await readFile(
      output.sources[0]?.manifestPath ?? "",
      "utf8",
    );
    expect(manifestText).toContain('"path":"History"');
    expect(manifestText).not.toContain('"path":"Default/History"');
    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readOnly: true,
    });
    try {
      expect(
        database
          .prepare(
            "SELECT state, reason FROM source_evidence_gaps WHERE path = 'Local State'",
          )
          .get(),
      ).toEqual({ state: "unavailable", reason: "outside_source" });
    } finally {
      database.close();
    }
    expect(await treeSnapshot(profile)).toEqual(before);
    // The placeholder History is not a real Chrome database, so the single
    // artifact is unavailable and the analysis exits failed (3).
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      3,
    );

    await writeFile(
      join(output.sources[0]?.workingCopyPath ?? "", "History"),
      "damaged-profile-working-copy\n",
    );
    const damaged = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(damaged.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(damaged.stderr)).toMatchObject({
      code: "WORKING_COPY_INTEGRITY_REFUSAL",
    });
  });

  it("discovers every Chrome Source in a Filesystem Root without account or installation-path assumptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-filesystem-source-"));
    temporaryRoots.push(root);
    const filesystemRoot = join(root, "filesystem");
    const first = join(filesystemRoot, "tenant-a", "odd", "browser-data");
    const second = join(
      filesystemRoot,
      "another-place",
      "nested",
      "installation",
    );
    await createUserDataDir(first, "one");
    await createUserDataDir(second, "two");
    const orphanProfile = join(filesystemRoot, "recovered", "Default");
    await writeFixtureFile(join(orphanProfile, "History"), "orphan-history\n");
    const before = await treeSnapshot(filesystemRoot);
    const caseDirectory = join(root, "CASE-FILESYSTEM");

    const { output } = ingest(filesystemRoot, "FILESYSTEM_ROOT", caseDirectory);
    expect(output).toMatchObject({
      sourceKind: "FILESYSTEM_ROOT",
      sourceCount: 3,
      profileCount: 3,
    });
    expect(new Set(output.sources.map((source) => source.sourcePath))).toEqual(
      new Set(
        await Promise.all([
          realpath(first),
          realpath(second),
          realpath(orphanProfile),
        ]),
      ),
    );
    expect(
      new Set(output.sources.map((source) => source.manifestId)).size,
    ).toBe(3);
    expect(
      new Set(output.sources.map((source) => source.evidenceSetDigest)).size,
    ).toBe(3);
    expect(
      new Set(
        output.sources.flatMap((source) =>
          source.profiles.map((profile) => profile.profileId),
        ),
      ).size,
    ).toBe(3);
    expect(await treeSnapshot(filesystemRoot)).toEqual(before);
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // Every discovered Profile has a placeholder History, so all three
    // artifacts are unavailable and the analysis exits failed (3).
    expect(analysis.status).toBe(3);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      sourceCount: 3,
      exitState: "failed",
      history: {
        profileCount: 3,
        unavailableProfileCount: 3,
      },
    });
    const caseDatabase = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readOnly: true,
    });
    try {
      expect(
        caseDatabase
          .prepare("SELECT count(*) AS count FROM analysis_run_sources")
          .get(),
      ).toEqual({ count: 3 });
      expect(
        caseDatabase
          .prepare("SELECT count(*) AS count FROM history_artifact_results")
          .get(),
      ).toEqual({ count: 3 });
    } finally {
      caseDatabase.close();
    }

    const physicalFirst = await realpath(first);
    const firstCopied = output.sources.find(
      (source) => source.sourcePath === physicalFirst,
    )?.workingCopyPath;
    expect(firstCopied).toBeDefined();
    await unlink(join(firstCopied ?? "", "Default", "History"));
    const damaged = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(damaged.status).toBe(1);
    expect(damaged.stderr).toContain("entry_missing");
    expect(await readFile(join(second, "Default", "History"), "utf8")).toBe(
      "history-two\n",
    );
  });

  it("reads a mounted Image Container offline and never writes to it", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-image-source-"));
    temporaryRoots.push(root);
    const imageRoot = join(root, "mounted-image");
    const source = join(
      imageRoot,
      "Users",
      "alice",
      "unknown-layout",
      "chrome",
    );
    await createUserDataDir(source, "image");
    const before = await treeSnapshot(imageRoot);
    const caseDirectory = join(root, "CASE-IMAGE");

    const { output } = ingest(imageRoot, "IMAGE_CONTAINER", caseDirectory);
    expect(output).toMatchObject({
      sourceKind: "IMAGE_CONTAINER",
      sourceCount: 1,
      profileCount: 1,
    });
    expect(output.sources[0]).toMatchObject({
      sourceKind: "IMAGE_CONTAINER",
      sourcePath: await realpath(source),
    });
    expect(await treeSnapshot(imageRoot)).toEqual(before);
    // The placeholder History is not a real Chrome database, so the analysis
    // exits failed (3).
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      3,
    );

    const opaqueContainer = join(root, "disk.E01");
    await writeFile(opaqueContainer, "not-mounted\n");
    const damaged = runCli([
      "ingest",
      opaqueContainer,
      "--source-kind",
      "IMAGE_CONTAINER",
      "--case",
      join(root, "CASE-OPAQUE"),
      "--json",
    ]);
    expect(damaged.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(damaged.stderr)).toMatchObject({
      code: "SOURCE_NOT_DIRECTORY",
    });
  });

  it("verifies valid and damaged Acquisition Bundles per file while preserving unaffected evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-bundle-source-"));
    temporaryRoots.push(root);
    const sourceOne = join(root, "source-one");
    const sourceTwo = join(root, "source-two");
    await createUserDataDir(sourceOne, "bundle-one");
    await createUserDataDir(sourceTwo, "bundle-two");
    const seedCaseOne = join(root, "seed-case-one");
    const seedCaseTwo = join(root, "seed-case-two");
    ingest(sourceOne, "USER_DATA_DIR", seedCaseOne);
    ingest(sourceTwo, "USER_DATA_DIR", seedCaseTwo);
    const bundle = await createBundle(root, [
      {
        source: sourceOne,
        caseDirectory: seedCaseOne,
        account: "alpha",
        index: 1,
      },
      {
        source: sourceTwo,
        caseDirectory: seedCaseTwo,
        account: "beta",
        index: 1,
      },
    ]);

    const validCase = join(root, "CASE-BUNDLE-VALID");
    const valid = ingest(bundle, "ACQUISITION_BUNDLE", validCase).output;
    expect(valid).toMatchObject({
      sourceKind: "ACQUISITION_BUNDLE",
      sourceCount: 2,
      profileCount: 2,
      acquisitionBundleVerification: {
        status: "verified",
        counts: {
          mismatch: 0,
          missing_on_disk: 0,
          missing_in_manifest: 0,
        },
      },
    });
    expect(valid.acquisitionBundleVerification?.expectedBundleDigest).toBe(
      valid.acquisitionBundleVerification?.actualBundleDigest,
    );
    expect(new Set(valid.sources.map((source) => source.manifestId)).size).toBe(
      2,
    );
    // Bundle Histories are placeholders, so analysis exits failed (3).
    expect(runCli(["analyse", "--case", validCase, "--json"]).status).toBe(3);

    const damagedBundle = join(root, "damaged-bundle");
    await cp(bundle, damagedBundle, { recursive: true });
    await writeFile(
      join(
        damagedBundle,
        "accounts",
        "alpha",
        "udd-1",
        "working_copy",
        "Default",
        "History",
      ),
      "changed-after-acquisition\n",
    );
    await unlink(
      join(
        damagedBundle,
        "accounts",
        "alpha",
        "udd-1",
        "working_copy",
        "Default",
        "Preferences",
      ),
    );
    await writeFixtureFile(
      join(
        damagedBundle,
        "accounts",
        "alpha",
        "udd-1",
        "working_copy",
        "unlisted.bin",
      ),
      "not-in-acquisition-manifest\n",
    );
    const damagedBefore = await treeSnapshot(damagedBundle);
    const damagedCase = join(root, "CASE-BUNDLE-DAMAGED");
    const damaged = ingest(
      damagedBundle,
      "ACQUISITION_BUNDLE",
      damagedCase,
    ).output;
    expect(damaged.acquisitionBundleVerification).toMatchObject({
      status: "verified_with_divergence",
      counts: {
        match: expect.any(Number),
        mismatch: 2,
        missing_on_disk: 2,
        missing_in_manifest: 2,
      },
    });
    expect(
      damaged.acquisitionBundleVerification?.counts.match ?? 0,
    ).toBeGreaterThan(0);
    expect(damaged.acquisitionBundleVerification?.actualBundleDigest).not.toBe(
      damaged.acquisitionBundleVerification?.expectedBundleDigest,
    );
    expect(
      new Set(
        damaged.acquisitionBundleVerification?.files.map(
          (file) => file.outcome,
        ),
      ),
    ).toEqual(
      new Set(["match", "mismatch", "missing_on_disk", "missing_in_manifest"]),
    );
    const unaffected = damaged.sources.find(
      (source) => source.sourceOriginPath === sourceTwo,
    );
    expect(unaffected?.copiedEntryCount).toBeGreaterThan(0);
    expect(
      await readFile(
        join(unaffected?.workingCopyPath ?? "", "Default", "History"),
        "utf8",
      ),
    ).toBe("history-bundle-two\n");
    expect(await treeSnapshot(damagedBundle)).toEqual(damagedBefore);
    // Unaffected evidence is a placeholder History, so analysis exits failed (3).
    expect(runCli(["analyse", "--case", damagedCase, "--json"]).status).toBe(3);

    const database = new DatabaseSync(join(damagedCase, "case.fxdb"), {
      readOnly: true,
    });
    try {
      const outcomes = database
        .prepare(
          "SELECT outcome, COUNT(*) AS count FROM acquisition_bundle_files GROUP BY outcome ORDER BY outcome",
        )
        .all() as unknown as {
        readonly outcome: string;
        readonly count: number;
      }[];
      expect(new Set(outcomes.map((row) => row.outcome))).toEqual(
        new Set([
          "match",
          "mismatch",
          "missing_on_disk",
          "missing_in_manifest",
        ]),
      );
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM acquisition_manifests")
          .get(),
      ).toEqual({ count: 2 });
      const alphaSource = damaged.sources.find(
        (source) => source.sourceOriginPath === sourceOne,
      );
      const hashes = database
        .prepare(
          `SELECT
             (SELECT sha256 FROM acquisition_manifest_entries
               WHERE source_id = ? AND path = 'Default/History') AS acquisition_hash,
             (SELECT sha256 FROM manifest_entries
               WHERE source_id = ? AND path = 'Default/History') AS ingest_hash`,
        )
        .get(alphaSource?.sourceId, alphaSource?.sourceId) as {
        readonly acquisition_hash: string;
        readonly ingest_hash: string;
      };
      expect(hashes.ingest_hash).not.toBe(hashes.acquisition_hash);
    } finally {
      database.close();
    }
  });
});
