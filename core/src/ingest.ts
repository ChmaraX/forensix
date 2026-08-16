import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  acquisitionBundleStatus,
  inspectAcquisitionBundle,
  materializeAcquisitionBundleSource,
  type AcquisitionBundleStatus,
  type AcquisitionVerificationRecord,
} from "./acquisition-bundle.js";
import {
  acquireProfileDir,
  acquireUserDataDir,
  filesystemErrorCode,
} from "./acquisition.js";
import {
  createCaseDatabase,
  TOOL_VERSION,
  type CaseBundleVerificationFileInput,
  type CreateCaseSourceOptions,
  type SourceEvidenceGap,
} from "./case.js";
import { ForensixError } from "./errors.js";
import {
  HASH_ALGORITHM,
  MANIFEST_SCHEMA,
  SOURCE_KINDS,
  evidenceSetDigest,
  manifestBytes,
  workingCopyDigest,
  type ManifestEntry,
  type ManifestHeader,
  type SourceKind,
} from "./manifest.js";
import {
  CHROME_USERDATA_POLICY,
  browserLevelEvidence,
} from "./selection-policy.js";
import {
  discoverChromeSources,
  type DiscoveredChromeSource,
} from "./source-discovery.js";

const MANIFEST_FILENAME = "manifest.jsonl";
const MANIFEST_HEADER_FILENAME = "manifest_header.json";
const WORKING_COPY_DIRECTORY = "working-copy";

export interface IngestOptions {
  readonly sourcePath: string;
  readonly caseDirectory: string;
  readonly sourceKind?: SourceKind;
  readonly includeTier2?: boolean;
}

export interface IngestProgress {
  readonly phase: "source_validated" | "manifest_complete" | "case_written";
  readonly message: string;
  readonly completedEntries?: number;
}

export interface IngestProfileResult {
  readonly profileId: string;
  readonly path: string;
}

export interface IngestSourceResult {
  readonly sourceId: string;
  readonly manifestId: string;
  readonly sourceKind: SourceKind;
  readonly sourcePath: string;
  readonly sourceOriginPath: string | null;
  readonly manifestPath: string;
  readonly workingCopyPath: string;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly profileCount: number;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly unavailableCount: number;
  readonly unclassifiedCount: number;
  readonly profiles: readonly IngestProfileResult[];
  readonly browserLevelEvidence: readonly SourceEvidenceGap[];
}

export interface IngestBundleVerificationResult {
  readonly status: AcquisitionBundleStatus;
  readonly expectedBundleDigest: string;
  readonly actualBundleDigest: string;
  readonly counts: Readonly<
    Record<
      "match" | "mismatch" | "missing_on_disk" | "missing_in_manifest",
      number
    >
  >;
  readonly files: readonly CaseBundleVerificationFileInput[];
  readonly sourceErrors: readonly string[];
}

export interface IngestResult {
  readonly status: "ok";
  readonly command: "ingest";
  readonly caseId: string;
  readonly sourceId: string;
  readonly sourceCount: number;
  readonly caseDirectory: string;
  readonly caseFile: string;
  readonly manifestPath: string;
  readonly workingCopyPath: string;
  readonly sourceKind: SourceKind;
  readonly selectionPolicy: "chrome-userdata/1";
  readonly tier2Included: boolean;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly profileCount: number;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly unavailableCount: number;
  readonly unclassifiedCount: number;
  readonly discoveryUnavailablePaths: readonly string[];
  readonly sources: readonly IngestSourceResult[];
  readonly acquisitionBundleVerification?: IngestBundleVerificationResult;
  readonly toolVersion: string;
}

interface PreparedIngest {
  readonly sources: readonly CreateCaseSourceOptions[];
  readonly discoveryUnavailablePaths: readonly string[];
  readonly bundleVerification?: {
    readonly bundleId: string;
    readonly status: AcquisitionBundleStatus;
    readonly expectedBundleDigest: string;
    readonly actualBundleDigest: string;
    readonly sourceErrors: readonly string[];
    readonly files: readonly CaseBundleVerificationFileInput[];
  };
}

interface SourceArtifactPaths {
  readonly directory: string;
  readonly manifestRelative: string;
  readonly headerRelative: string;
  readonly workingCopyRelative: string;
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

async function plannedPhysicalPath(path: string): Promise<string> {
  let ancestor = path;
  while (true) {
    try {
      const physicalAncestor = await realpath(ancestor);
      return resolve(physicalAncestor, relative(ancestor, path));
    } catch (error) {
      const code = filesystemErrorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw error;
      }
      ancestor = parent;
    }
  }
}

async function assertCaseOutsideSource(
  sourcePath: string,
  caseDirectory: string,
): Promise<void> {
  let physicalCaseDirectory: string;
  try {
    physicalCaseDirectory = await plannedPhysicalPath(caseDirectory);
  } catch (error) {
    throw new ForensixError(
      "INGEST_FAILED",
      `Case Directory cannot be resolved: ${caseDirectory}`,
      { case_directory: caseDirectory },
      { cause: error },
    );
  }
  if (isWithin(sourcePath, physicalCaseDirectory)) {
    throw new ForensixError(
      "CASE_INSIDE_SOURCE",
      "Case Directory cannot be inside the Source.",
      {
        source_path: sourcePath,
        case_directory: caseDirectory,
        resolved_case_directory: physicalCaseDirectory,
      },
    );
  }
}

function makeManifestHeader(
  entries: readonly ManifestEntry[],
  profileCount: number,
  tier2Included: boolean,
  sourceKind: SourceKind,
): ManifestHeader {
  return {
    manifest_schema: MANIFEST_SCHEMA,
    source_kind: sourceKind,
    selection_policy: CHROME_USERDATA_POLICY.name,
    selection_policy_diff: [],
    tier_2_included: tier2Included,
    hash_algorithm: HASH_ALGORITHM,
    evidence_set_digest: evidenceSetDigest(entries),
    working_copy_digest: workingCopyDigest(entries),
    entry_count: entries.length,
    copied_entry_count: entries.filter((entry) => entry.copied).length,
    profile_count: profileCount,
    unavailable_count: entries.filter((entry) => entry.state === "unavailable")
      .length,
    unclassified_count: entries.filter(
      (entry) =>
        entry.state === "value" &&
        entry.unclassified &&
        entry.node_type !== "dir",
    ).length,
  };
}

function sourceArtifactPaths(
  stagingDirectory: string,
  sourceId: string,
  nested: boolean,
): SourceArtifactPaths {
  const relativeDirectory = nested ? `sources/${sourceId}` : ".";
  const directory =
    relativeDirectory === "."
      ? stagingDirectory
      : join(stagingDirectory, ...relativeDirectory.split("/"));
  const relativeFile = (name: string): string =>
    relativeDirectory === "." ? name : `${relativeDirectory}/${name}`;
  return {
    directory,
    manifestRelative: relativeFile(MANIFEST_FILENAME),
    headerRelative: relativeFile(MANIFEST_HEADER_FILENAME),
    workingCopyRelative: relativeFile(WORKING_COPY_DIRECTORY),
  };
}

function profileInputs(paths: readonly string[]): IngestProfileResult[] {
  return paths.map((path) => ({ profileId: randomUUID(), path }));
}

function profileEvidenceGaps(
  shape: DiscoveredChromeSource["shape"],
): SourceEvidenceGap[] {
  if (shape !== "PROFILE_DIR") {
    return [];
  }
  return browserLevelEvidence().map((evidence) => ({
    path: evidence.path,
    state: "unavailable",
    reason: "outside_source",
  }));
}

async function writePrimaryManifest(
  stagingDirectory: string,
  paths: SourceArtifactPaths,
  entries: readonly ManifestEntry[],
  header: ManifestHeader,
): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(stagingDirectory, ...paths.manifestRelative.split("/")),
    manifestBytes(entries),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    join(stagingDirectory, ...paths.headerRelative.split("/")),
    `${JSON.stringify(header, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

async function prepareDirectorySource(
  stagingDirectory: string,
  discovered: DiscoveredChromeSource,
  recordedKind: SourceKind,
  includeTier2: boolean,
  nested: boolean,
): Promise<CreateCaseSourceOptions> {
  const sourceId = randomUUID();
  const manifestId = randomUUID();
  const paths = sourceArtifactPaths(stagingDirectory, sourceId, nested);
  const workingCopyAbsolute = join(
    stagingDirectory,
    ...paths.workingCopyRelative.split("/"),
  );
  const acquisition =
    discovered.shape === "PROFILE_DIR" ? acquireProfileDir : acquireUserDataDir;
  const { entries, profiles } = await acquisition(
    discovered.path,
    workingCopyAbsolute,
    includeTier2,
  );
  const preparedProfiles = profileInputs(profiles);
  const header = makeManifestHeader(
    entries,
    preparedProfiles.length,
    includeTier2,
    recordedKind,
  );
  await writePrimaryManifest(stagingDirectory, paths, entries, header);
  return {
    sourceId,
    manifestId,
    sourceKind: recordedKind,
    sourcePath: discovered.path,
    sourceOriginPath: null,
    workingCopyPath: paths.workingCopyRelative,
    manifestPath: paths.manifestRelative,
    header,
    entries,
    profiles: preparedProfiles,
    evidenceGaps: profileEvidenceGaps(discovered.shape),
  };
}

async function prepareDirectoryInput(
  stagingDirectory: string,
  sourcePath: string,
  sourceKind: Exclude<SourceKind, "ACQUISITION_BUNDLE">,
  includeTier2: boolean,
): Promise<PreparedIngest> {
  if (sourceKind === "USER_DATA_DIR" || sourceKind === "PROFILE_DIR") {
    const source = await prepareDirectorySource(
      stagingDirectory,
      { path: sourcePath, shape: sourceKind },
      sourceKind,
      includeTier2,
      false,
    );
    return { sources: [source], discoveryUnavailablePaths: [] };
  }

  const discovery = await discoverChromeSources(sourcePath);
  if (discovery.sources.length === 0) {
    throw new ForensixError(
      "INGEST_FAILED",
      `${sourceKind === "IMAGE_CONTAINER" ? "Image Container" : "Filesystem Root"} contains no supported Chrome Source.`,
      {
        source_path: sourcePath,
        discovery_unavailable_paths: discovery.unavailablePaths,
      },
    );
  }
  const sources: CreateCaseSourceOptions[] = [];
  for (const discovered of discovery.sources) {
    sources.push(
      await prepareDirectorySource(
        stagingDirectory,
        discovered,
        sourceKind,
        includeTier2,
        true,
      ),
    );
  }
  return {
    sources,
    discoveryUnavailablePaths: discovery.unavailablePaths,
  };
}

function verificationFile(
  record: AcquisitionVerificationRecord,
  sourceIds: ReadonlyMap<number, string>,
): CaseBundleVerificationFileInput {
  return {
    scope: record.scope,
    sourceId:
      record.sourceIndex === null
        ? null
        : (sourceIds.get(record.sourceIndex) ?? null),
    path: record.path,
    outcome: record.outcome,
    expectedSize: record.expectedSize,
    actualSize: record.actualSize,
    expectedSha256: record.expectedSha256,
    actualSha256: record.actualSha256,
  };
}

async function prepareAcquisitionBundle(
  stagingDirectory: string,
  bundleRoot: string,
): Promise<PreparedIngest> {
  const inspection = await inspectAcquisitionBundle(bundleRoot);
  const sources: CreateCaseSourceOptions[] = [];
  const sourceIds = new Map<number, string>();
  const sourceRecords: AcquisitionVerificationRecord[] = [];

  for (const bundleSource of inspection.sources) {
    const sourceId = randomUUID();
    const manifestId = randomUUID();
    sourceIds.set(bundleSource.sourceIndex, sourceId);
    const paths = sourceArtifactPaths(stagingDirectory, sourceId, true);
    const workingCopyAbsolute = join(
      stagingDirectory,
      ...paths.workingCopyRelative.split("/"),
    );
    const materialized = await materializeAcquisitionBundleSource(
      bundleSource,
      workingCopyAbsolute,
    );
    sourceRecords.push(...materialized.records);
    const preparedProfiles = profileInputs(bundleSource.profiles);
    const header = makeManifestHeader(
      materialized.entries,
      preparedProfiles.length,
      bundleSource.acquisitionHeader.tier_2_included,
      "ACQUISITION_BUNDLE",
    );
    await writePrimaryManifest(
      stagingDirectory,
      paths,
      materialized.entries,
      header,
    );

    const acquisitionManifestRelative = `sources/${sourceId}/acquisition_manifest.jsonl`;
    const acquisitionHeaderRelative = `sources/${sourceId}/acquisition_manifest_header.json`;
    await writeFile(
      join(stagingDirectory, ...acquisitionManifestRelative.split("/")),
      bundleSource.acquisitionManifestBytes,
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(
      join(stagingDirectory, ...acquisitionHeaderRelative.split("/")),
      `${JSON.stringify(bundleSource.acquisitionHeader, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    sources.push({
      sourceId,
      manifestId,
      sourceKind: "ACQUISITION_BUNDLE",
      sourcePath: bundleSource.bundleSourcePath,
      sourceOriginPath: bundleSource.originSourcePath,
      workingCopyPath: paths.workingCopyRelative,
      manifestPath: paths.manifestRelative,
      header,
      entries: materialized.entries,
      profiles: preparedProfiles,
      evidenceGaps: [],
      acquisitionManifest: {
        manifestPath: acquisitionManifestRelative,
        headerPath: acquisitionHeaderRelative,
        header: bundleSource.acquisitionHeader,
        entries: bundleSource.acquisitionEntries,
      },
    });
  }

  if (sources.length === 0) {
    throw new ForensixError(
      "INGEST_FAILED",
      "Acquisition Bundle contains no readable collected Source.",
      {
        source_path: bundleRoot,
        bundle_status: "verified_with_divergence",
        source_errors: inspection.sourceErrors,
      },
    );
  }

  const status = acquisitionBundleStatus(inspection, sourceRecords);
  const files = [...inspection.records, ...sourceRecords].map((record) =>
    verificationFile(record, sourceIds),
  );
  return {
    sources,
    discoveryUnavailablePaths: [],
    bundleVerification: {
      bundleId: randomUUID(),
      status,
      expectedBundleDigest: inspection.expectedBundleDigest,
      actualBundleDigest: inspection.actualBundleDigest,
      sourceErrors: inspection.sourceErrors,
      files,
    },
  };
}

function sourceResult(
  caseDirectory: string,
  source: CreateCaseSourceOptions,
): IngestSourceResult {
  return {
    sourceId: source.sourceId,
    manifestId: source.manifestId,
    sourceKind: source.sourceKind,
    sourcePath: source.sourcePath,
    sourceOriginPath: source.sourceOriginPath,
    manifestPath: join(caseDirectory, ...source.manifestPath.split("/")),
    workingCopyPath: isAbsolute(source.workingCopyPath)
      ? source.workingCopyPath
      : join(caseDirectory, ...source.workingCopyPath.split("/")),
    evidenceSetDigest: source.header.evidence_set_digest,
    workingCopyDigest: source.header.working_copy_digest,
    profileCount: source.header.profile_count,
    entryCount: source.header.entry_count,
    copiedEntryCount: source.header.copied_entry_count,
    unavailableCount: source.header.unavailable_count,
    unclassifiedCount: source.header.unclassified_count,
    profiles: source.profiles,
    browserLevelEvidence: source.evidenceGaps,
  };
}

function bundleVerificationResult(
  verification: NonNullable<PreparedIngest["bundleVerification"]>,
): IngestBundleVerificationResult {
  const counts = {
    match: 0,
    mismatch: 0,
    missing_on_disk: 0,
    missing_in_manifest: 0,
  };
  for (const file of verification.files) {
    counts[file.outcome] += 1;
  }
  return {
    status: verification.status,
    expectedBundleDigest: verification.expectedBundleDigest,
    actualBundleDigest: verification.actualBundleDigest,
    counts,
    files: verification.files,
    sourceErrors: verification.sourceErrors,
  };
}

export async function* ingestSource(
  options: IngestOptions,
): AsyncGenerator<IngestProgress, IngestResult> {
  const sourceKind = options.sourceKind ?? "USER_DATA_DIR";
  if (!SOURCE_KINDS.includes(sourceKind)) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Unsupported Source kind: ${String(sourceKind)}`,
    );
  }
  const requestedSource = resolve(options.sourcePath);
  let sourceStats;
  try {
    sourceStats = await lstat(requestedSource, { bigint: true });
  } catch (error) {
    throw new ForensixError(
      "SOURCE_NOT_FOUND",
      `Source does not exist: ${requestedSource}`,
      { source_path: requestedSource },
      { cause: error },
    );
  }
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    const description =
      sourceKind === "IMAGE_CONTAINER"
        ? "a read-only mounted or extracted Image Container directory"
        : "a directory";
    throw new ForensixError(
      "SOURCE_NOT_DIRECTORY",
      `Source is not ${description}: ${requestedSource}`,
      { source_path: requestedSource, source_kind: sourceKind },
    );
  }

  const sourcePath = await realpath(requestedSource);
  const caseDirectory = resolve(options.caseDirectory);
  try {
    await lstat(caseDirectory);
    throw new ForensixError(
      "CASE_ALREADY_EXISTS",
      `Case Directory already exists: ${caseDirectory}`,
      { case_directory: caseDirectory },
    );
  } catch (error) {
    if (error instanceof ForensixError) {
      throw error;
    }
    if (filesystemErrorCode(error) !== "ENOENT") {
      throw new ForensixError(
        "INGEST_FAILED",
        `Case Directory cannot be inspected: ${caseDirectory}`,
        { case_directory: caseDirectory },
        { cause: error },
      );
    }
  }

  await assertCaseOutsideSource(sourcePath, caseDirectory);
  yield {
    phase: "source_validated",
    message: "Source is readable and the Case Directory path is separate.",
  };

  await mkdir(dirname(caseDirectory), { recursive: true, mode: 0o700 });
  await assertCaseOutsideSource(sourcePath, caseDirectory);
  const stagingDirectory = join(
    dirname(caseDirectory),
    `${basename(caseDirectory)}.tmp-${randomUUID()}`,
  );
  await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });

  try {
    const includeTier2 = options.includeTier2 ?? false;
    const prepared =
      sourceKind === "ACQUISITION_BUNDLE"
        ? await prepareAcquisitionBundle(stagingDirectory, sourcePath)
        : await prepareDirectoryInput(
            stagingDirectory,
            sourcePath,
            sourceKind,
            includeTier2,
          );
    const completedEntries = prepared.sources.reduce(
      (total, source) => total + source.entries.length,
      0,
    );
    yield {
      phase: "manifest_complete",
      message: `${prepared.sources.length} independent Manifest${prepared.sources.length === 1 ? " is" : "s are"} complete.`,
      completedEntries,
    };

    const caseId = randomUUID();
    createCaseDatabase({
      caseDirectory: stagingDirectory,
      caseId,
      inputSourceKind: sourceKind,
      inputSourcePath: sourcePath,
      discoveryUnavailablePaths: prepared.discoveryUnavailablePaths,
      sources: prepared.sources,
      bundleVerification: prepared.bundleVerification,
    });
    await rename(stagingDirectory, caseDirectory);

    yield {
      phase: "case_written",
      message: "Case Directory is complete.",
      completedEntries,
    };

    const resultSources = prepared.sources.map((source) =>
      sourceResult(caseDirectory, source),
    );
    const first = resultSources[0];
    if (first === undefined) {
      throw new Error("Ingest prepared no Source.");
    }
    return {
      status: "ok",
      command: "ingest",
      caseId,
      sourceId: first.sourceId,
      sourceCount: resultSources.length,
      caseDirectory,
      caseFile: join(caseDirectory, "case.fxdb"),
      manifestPath: first.manifestPath,
      workingCopyPath: first.workingCopyPath,
      sourceKind,
      selectionPolicy: CHROME_USERDATA_POLICY.name,
      tier2Included: prepared.sources.some(
        (source) => source.header.tier_2_included,
      ),
      evidenceSetDigest: first.evidenceSetDigest,
      workingCopyDigest: first.workingCopyDigest,
      profileCount: resultSources.reduce(
        (total, source) => total + source.profileCount,
        0,
      ),
      entryCount: resultSources.reduce(
        (total, source) => total + source.entryCount,
        0,
      ),
      copiedEntryCount: resultSources.reduce(
        (total, source) => total + source.copiedEntryCount,
        0,
      ),
      unavailableCount: resultSources.reduce(
        (total, source) => total + source.unavailableCount,
        0,
      ),
      unclassifiedCount: resultSources.reduce(
        (total, source) => total + source.unclassifiedCount,
        0,
      ),
      discoveryUnavailablePaths: prepared.discoveryUnavailablePaths,
      sources: resultSources,
      acquisitionBundleVerification:
        prepared.bundleVerification === undefined
          ? undefined
          : bundleVerificationResult(prepared.bundleVerification),
      toolVersion: TOOL_VERSION,
    };
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

/**
 * Ingest a Chrome User Data Dir into a Case.
 *
 * The generator discovers the Sources under the directory by the selection
 * policy, copies the Tier 1 files (and Tier 2 when `includeTier2` is set) into a
 * verified Working Copy, and writes the Case. It never mutates a Source byte.
 *
 * It yields `IngestProgress` at each phase — source validated, manifest
 * complete, Case written — and returns an `IngestResult` with the Source and
 * Working Copy digests, the per-Source counts, and the Profiles found.
 */
export function ingestUserDataDir(
  options: Omit<IngestOptions, "sourceKind">,
): AsyncGenerator<IngestProgress, IngestResult> {
  return ingestSource({ ...options, sourceKind: "USER_DATA_DIR" });
}
