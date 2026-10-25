import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, type CliResult } from "./lib/harness.js";
const temporaryRoots: string[] = [];

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
        schema_version: "forensix-acquisition-bundle-draft/2",
        hash_algorithm: "sha-256",
        key_material_capture_requested: false,
        key_material_captured: false,
        key_material_stripped: false,
        user_data_dirs: userDataDirs,
        key_material: [],
        files,
        bundle_digest: bundleDigest,
      },
      null,
      2,
    )}\n`,
  );
  return bundle;
}

/** The Go toolchain builds the real Collector. CI installs Go; a developer
 * machine without Go skips only the cross-language test. */
const goAvailable =
  spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;

/** The Collector's per-account User Data Dir location under a scan root. */
function collectorUserDataDir(sourceRoot: string, account: string): string {
  if (process.platform === "win32") {
    return join(
      sourceRoot,
      "Users",
      account,
      "AppData",
      "Local",
      "Google",
      "Chrome",
      "User Data",
    );
  }
  if (process.platform === "darwin") {
    return join(
      sourceRoot,
      "Users",
      account,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
    );
  }
  return join(sourceRoot, "home", account, ".config", "google-chrome");
}

/** A Chrome History database with committed visits. */
async function createHistoryDatabase(
  path: string,
  visits: readonly { readonly url: string; readonly title: string }[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL, visit_time INTEGER NOT NULL,
        from_visit INTEGER, external_referrer_url TEXT, transition INTEGER DEFAULT 0 NOT NULL,
        segment_id INTEGER, visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL, opener_visit INTEGER,
        originator_cache_guid TEXT, originator_visit_id INTEGER, originator_from_visit INTEGER,
        originator_opener_visit INTEGER, is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER, app_id TEXT
      );
      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      CREATE TABLE segments (id INTEGER PRIMARY KEY, name VARCHAR, url_id INTEGER NON NULL);
      CREATE TABLE segment_usage (
        id INTEGER PRIMARY KEY, segment_id INTEGER NOT NULL,
        time_slot INTEGER NOT NULL, visit_count INTEGER DEFAULT 0 NOT NULL
      );
    `);
    const insertUrl = database.prepare(
      "INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 1, 0, ?, 0)",
    );
    const insertVisit = database.prepare(
      `INSERT INTO visits
         (id, url, visit_time, from_visit, external_referrer_url, transition,
          segment_id, visit_duration, incremented_omnibox_typed_score,
          opener_visit, originator_cache_guid, originator_visit_id,
          originator_from_visit, originator_opener_visit, is_known_to_sync,
          consider_for_ntp_most_visited, visited_link_id, app_id)
       VALUES (?, ?, ?, 0, '', 1, 0, 1000000, 0, 0, '', 0, 0, 0, 0, 1, 0, '')`,
    );
    for (const [index, visit] of visits.entries()) {
      const id = BigInt(index + 1);
      const time = 13_348_638_245_000_000n + id * 60_000_000n;
      insertUrl.run(id, visit.url, visit.title, time);
      insertVisit.run(id, id, time);
    }
  } finally {
    database.close();
  }
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
  it.skipIf(!goAvailable)(
    "ingests and analyses an Acquisition Bundle that the compiled Go Collector wrote",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "forensix-collector-bundle-"));
      temporaryRoots.push(root);
      const collector = join(
        root,
        process.platform === "win32"
          ? "forensix-collect.exe"
          : "forensix-collect",
      );
      const build = spawnSync(
        "go",
        ["build", "-o", collector, "./cmd/forensix-collect"],
        { cwd: resolve("collector"), encoding: "utf8" },
      );
      // `go build` writes module download progress to stderr on a fresh
      // module cache (CI), so only its exit status says whether it built.
      expect(build.status, build.stderr).toBe(0);

      // The account's Chrome directory is a symlink to the real User Data
      // Dir, as on a machine that moved its browser data to another volume.
      const sourceRoot = join(root, "mounted-root");
      const realUserDataDir = join(root, "other-volume", "chrome-data");
      await writeFixtureFile(join(realUserDataDir, "Local State"), "{}\n");
      await writeFixtureFile(
        join(realUserDataDir, "Default", "Preferences"),
        '{"profile":{"name":"Collected"}}\n',
      );
      const historyPath = join(realUserDataDir, "Default", "History");
      await createHistoryDatabase(historyPath, [
        { url: "https://collected.example/start", title: "Collected start" },
        { url: "https://collected.example/next", title: "Collected next" },
      ]);
      const chromeDirectory = collectorUserDataDir(sourceRoot, "alice");
      await mkdir(dirname(chromeDirectory), { recursive: true });
      await symlink(realUserDataDir, chromeDirectory, "junction");
      // A file the Collector cannot read becomes an unavailable entry; it
      // does not stop the collection.
      const lockedPath = join(realUserDataDir, "Default", "Bookmarks");
      await writeFixtureFile(lockedPath, '{"roots":{}}\n');
      const canLock = process.platform !== "win32" && process.getuid?.() !== 0;
      if (canLock) {
        await chmod(lockedPath, 0o000);
      }
      const historyBefore = await readFile(historyPath);

      const bundle = join(root, "BUNDLE-E2E");
      const collect = spawnSync(
        collector,
        [
          "--source-root",
          sourceRoot,
          "--out",
          bundle,
          "--operator",
          "examiner-7",
          "--authorization-reference",
          "CASE-E2E, authorized by lab lead",
        ],
        { encoding: "utf8" },
      );
      if (canLock) {
        await chmod(lockedPath, 0o600);
      }
      expect(collect.stderr).toBe("");
      expect(collect.status).toBe(0);
      const bundleManifest = JSON.parse(
        await readFile(join(bundle, "bundle_manifest.json"), "utf8"),
      ) as {
        readonly schema_version: string;
        readonly user_data_dirs: readonly { readonly outcome: string }[];
      };
      expect(bundleManifest.schema_version).toBe(
        "forensix-acquisition-bundle-draft/2",
      );
      expect(bundleManifest.user_data_dirs.map((udd) => udd.outcome)).toEqual([
        "collected",
      ]);

      const caseDirectory = join(root, "CASE-COLLECTED");
      const { command, output } = ingest(
        bundle,
        "ACQUISITION_BUNDLE",
        caseDirectory,
      );
      expect(output).toMatchObject({
        sourceKind: "ACQUISITION_BUNDLE",
        sourceCount: 1,
        profileCount: 1,
        acquisitionBundleVerification: { status: "verified" },
      });
      const ingested = parseJson<{ readonly unavailableCount: number }>(
        command.stdout,
      );
      expect(ingested.unavailableCount).toBe(canLock ? 1 : 0);
      if (canLock) {
        const manifest = await readFile(
          output.sources[0]?.manifestPath ?? "",
          "utf8",
        );
        expect(manifest).toContain(
          '"path":"Default/Bookmarks","state":"unavailable","unavailable_reason":"permission_denied"',
        );
      }

      const analysis = runCli([
        "analyse",
        "--case",
        caseDirectory,
        "--no-topic-classification",
        "--json",
      ]);
      expect(analysis.stderr).toBe("");
      expect(analysis.status).toBe(0);
      expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject(
        {
          status: "ok",
          exitState: "complete",
          workingCopyVerification: "verified",
          history: { status: "complete", committedVisitCount: 2 },
        },
      );
      const visits = parseJson<{
        readonly items: readonly {
          readonly commitState: string;
          readonly fields: { readonly url: { readonly value?: string } };
        }[];
      }>(
        runCli([
          "history",
          "--case",
          caseDirectory,
          "--view",
          "visits",
          "--json",
        ]).stdout,
      ).items;
      expect(visits.map((visit) => visit.fields.url.value).sort()).toEqual([
        "https://collected.example/next",
        "https://collected.example/start",
      ]);
      expect(visits.every((visit) => visit.commitState === "committed")).toBe(
        true,
      );
      expect(await readFile(historyPath)).toEqual(historyBefore);

      // An Acquisition Bundle with another schema version is refused with a
      // typed reason instead of a guessed interpretation.
      const otherVersion = join(root, "BUNDLE-OTHER-VERSION");
      await cp(bundle, otherVersion, { recursive: true });
      await writeFile(
        join(otherVersion, "bundle_manifest.json"),
        (await readFile(join(bundle, "bundle_manifest.json"), "utf8")).replace(
          "forensix-acquisition-bundle-draft/2",
          "forensix-acquisition-bundle-draft/1",
        ),
      );
      const refused = runCli([
        "ingest",
        otherVersion,
        "--source-kind",
        "ACQUISITION_BUNDLE",
        "--case",
        join(root, "CASE-REFUSED"),
        "--json",
      ]);
      expect(refused.status).not.toBe(0);
      expect(parseJson<Record<string, unknown>>(refused.stderr)).toMatchObject({
        code: "INGEST_FAILED",
        details: {
          reason: "unsupported_bundle_schema_version",
          schemaVersion: "forensix-acquisition-bundle-draft/1",
          supportedSchemaVersion: "forensix-acquisition-bundle-draft/2",
        },
      });
    },
    180_000,
  );
});
