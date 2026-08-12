import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { createCaseDatabase, TOOL_VERSION } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  HASH_ALGORITHM,
  MANIFEST_SCHEMA,
  evidenceSetDigest,
  manifestBytes,
  representationDigest,
  sortManifestEntries,
  workingCopyDigest,
  type ManifestEntry,
  type ManifestHeader,
  type NodeType,
  type UnavailableReason,
} from "./manifest.js";
import {
  CHROME_USERDATA_POLICY,
  classifySourcePath,
  expectedTierOnePaths,
  isProfileDirectoryName,
} from "./selection-policy.js";

const MANIFEST_FILENAME = "manifest.jsonl";
const MANIFEST_HEADER_FILENAME = "manifest_header.json";
const WORKING_COPY_DIRECTORY = "working-copy";
const READ_BUFFER_SIZE = 1024 * 1024;

export interface IngestOptions {
  readonly sourcePath: string;
  readonly caseDirectory: string;
  readonly includeTier2?: boolean;
}

export interface IngestProgress {
  readonly phase: "source_validated" | "manifest_complete" | "case_written";
  readonly message: string;
  readonly completedEntries?: number;
}

export interface IngestResult {
  readonly status: "ok";
  readonly command: "ingest";
  readonly caseId: string;
  readonly sourceId: string;
  readonly caseDirectory: string;
  readonly caseFile: string;
  readonly manifestPath: string;
  readonly workingCopyPath: string;
  readonly sourceKind: "USER_DATA_DIR";
  readonly selectionPolicy: "chrome-userdata/1";
  readonly tier2Included: boolean;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly profileCount: number;
  readonly entryCount: number;
  readonly copiedEntryCount: number;
  readonly unavailableCount: number;
  readonly unclassifiedCount: number;
  readonly toolVersion: string;
}

interface ScanContext {
  readonly sourceRoot: string;
  readonly workingCopyRoot: string;
  readonly includeTier2: boolean;
  readonly entries: ManifestEntry[];
  readonly profilePaths: Set<string>;
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== "..")
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function unavailableReason(error: unknown): UnavailableReason {
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM") {
    return "permission_denied";
  }
  if (code === "ENOENT" || code === "ESTALE" || code === "ELOOP") {
    return "changed_during_ingest";
  }
  return "io_error";
}

function statNodeType(stats: BigIntStats): NodeType | null {
  if (stats.isFile()) {
    return "file";
  }
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isSocket()) {
    return "socket";
  }
  if (stats.isDirectory()) {
    return "dir";
  }
  return null;
}

function safeSize(size: bigint, path: string): number {
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ForensixError(
      "INGEST_FAILED",
      "Source node is too large to record safely.",
      {
        path,
        size: size.toString(),
      },
    );
  }
  return Number(size);
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function unavailableEntry(
  path: string,
  nodeType: Exclude<NodeType, "absent">,
  reason: UnavailableReason,
  mtimeNs: string | null,
): ManifestEntry {
  const selection = classifySourcePath(path, nodeType);
  return {
    path,
    state: "unavailable",
    unavailable_reason: reason,
    node_type: nodeType,
    file_kind: selection.fileKind,
    selection_tier: selection.tier,
    copied: false,
    unclassified: selection.unclassified,
    size: null,
    mtime_ns: mtimeNs,
    hash_algorithm: HASH_ALGORITHM,
    sha256: null,
    link_target: null,
  };
}

async function postReadStat(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch {
    return null;
  }
}

async function inspectFile(
  absolutePath: string,
  manifestPath: string,
  initialStats: BigIntStats,
  context: ScanContext,
): Promise<ManifestEntry> {
  const selection = classifySourcePath(manifestPath, "file");
  const shouldCopy =
    selection.tier === "tier_1" ||
    (selection.tier === "tier_2" && context.includeTier2);
  const noFollowFlag = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;

  let source: FileHandle;
  try {
    source = await open(absolutePath, constants.O_RDONLY | noFollowFlag);
  } catch (error) {
    return unavailableEntry(
      manifestPath,
      "file",
      unavailableReason(error),
      initialStats.mtimeNs.toString(),
    );
  }

  const destinationPath = join(
    context.workingCopyRoot,
    ...manifestPath.split("/"),
  );
  let destination: FileHandle | null = null;
  let keepDestination = false;
  let sourceReadError: unknown;
  const digest = createHash("sha256");
  const expectedSize = safeSize(initialStats.size, manifestPath);
  let bytesReadTotal = 0;

  try {
    const openedStats = await source.stat({ bigint: true });
    if (!sameNode(initialStats, openedStats)) {
      return unavailableEntry(
        manifestPath,
        "file",
        "changed_during_ingest",
        initialStats.mtimeNs.toString(),
      );
    }

    if (shouldCopy) {
      try {
        await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
        destination = await open(destinationPath, "wx", 0o600);
      } catch (error) {
        throw new ForensixError(
          "INGEST_FAILED",
          "Working Copy file cannot be created.",
          { path: manifestPath },
          { cause: error },
        );
      }
    }

    const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
    while (true) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await source.read(buffer, 0, buffer.length, null));
      } catch (error) {
        sourceReadError = error;
        break;
      }
      if (bytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      bytesReadTotal += bytesRead;
      if (destination !== null) {
        let written = 0;
        while (written < bytesRead) {
          try {
            const writeResult = await destination.write(
              chunk,
              written,
              bytesRead - written,
            );
            written += writeResult.bytesWritten;
          } catch (error) {
            throw new ForensixError(
              "INGEST_FAILED",
              "Working Copy file cannot be written.",
              { path: manifestPath },
              { cause: error },
            );
          }
        }
      }
    }

    if (sourceReadError !== undefined) {
      return unavailableEntry(
        manifestPath,
        "file",
        unavailableReason(sourceReadError),
        initialStats.mtimeNs.toString(),
      );
    }

    const finalHandleStats = await source.stat({ bigint: true });
    const finalPathStats = await postReadStat(absolutePath);
    if (
      !sameNode(initialStats, finalHandleStats) ||
      finalPathStats === null ||
      !sameNode(initialStats, finalPathStats)
    ) {
      return unavailableEntry(
        manifestPath,
        "file",
        "changed_during_ingest",
        initialStats.mtimeNs.toString(),
      );
    }
    if (bytesReadTotal !== expectedSize) {
      return unavailableEntry(
        manifestPath,
        "file",
        "changed_during_ingest",
        initialStats.mtimeNs.toString(),
      );
    }
    if (destination !== null) {
      await destination.sync();
      keepDestination = true;
    }

    return {
      path: manifestPath,
      state: "value",
      unavailable_reason: null,
      node_type: "file",
      file_kind: selection.fileKind,
      selection_tier: selection.tier,
      copied: shouldCopy,
      unclassified: selection.unclassified,
      size: bytesReadTotal,
      mtime_ns: initialStats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: digest.digest("hex"),
      link_target: null,
    };
  } finally {
    await source.close().catch(() => undefined);
    if (destination !== null) {
      await destination.close().catch(() => undefined);
    }
    if (destination !== null && !keepDestination) {
      await rm(destinationPath, { force: true }).catch(() => undefined);
    }
  }
}

async function inspectSymlink(
  absolutePath: string,
  manifestPath: string,
  initialStats: BigIntStats,
): Promise<ManifestEntry> {
  let target: string;
  try {
    target = await readlink(absolutePath, { encoding: "utf8" });
  } catch (error) {
    return unavailableEntry(
      manifestPath,
      "symlink",
      unavailableReason(error),
      initialStats.mtimeNs.toString(),
    );
  }
  const finalStats = await postReadStat(absolutePath);
  if (finalStats === null || !sameNode(initialStats, finalStats)) {
    return unavailableEntry(
      manifestPath,
      "symlink",
      "changed_during_ingest",
      initialStats.mtimeNs.toString(),
    );
  }

  const selection = classifySourcePath(manifestPath, "symlink");
  return {
    path: manifestPath,
    state: "value",
    unavailable_reason: null,
    node_type: "symlink",
    file_kind: selection.fileKind,
    selection_tier: selection.tier,
    copied: false,
    unclassified: selection.unclassified,
    size: Buffer.byteLength(target, "utf8"),
    mtime_ns: initialStats.mtimeNs.toString(),
    hash_algorithm: HASH_ALGORITHM,
    sha256: representationDigest("symlink", target),
    link_target: target,
  };
}

async function inspectDirectory(
  absolutePath: string,
  manifestPath: string,
  initialStats: BigIntStats,
  context: ScanContext,
): Promise<void> {
  const selection = classifySourcePath(manifestPath, "dir");
  const entryIndex = context.entries.length;
  context.entries.push({
    path: manifestPath,
    state: "value",
    unavailable_reason: null,
    node_type: "dir",
    file_kind: selection.fileKind,
    selection_tier: selection.tier,
    copied: false,
    unclassified: selection.unclassified,
    size: null,
    mtime_ns: initialStats.mtimeNs.toString(),
    hash_algorithm: HASH_ALGORITHM,
    sha256: representationDigest("dir"),
    link_target: null,
  });

  if (!manifestPath.includes("/") && isProfileDirectoryName(manifestPath)) {
    context.profilePaths.add(manifestPath);
  }

  let childNames: string[];
  try {
    childNames = await readdir(absolutePath);
  } catch (error) {
    context.entries[entryIndex] = unavailableEntry(
      manifestPath,
      "dir",
      unavailableReason(error),
      initialStats.mtimeNs.toString(),
    );
    return;
  }

  childNames.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  for (const childName of childNames) {
    if (childName.includes("\\")) {
      throw new ForensixError(
        "INGEST_FAILED",
        "Source path cannot be represented by the Manifest contract.",
        { path: `${manifestPath}/${childName}` },
      );
    }
    await inspectNode(
      join(absolutePath, childName),
      `${manifestPath}/${childName}`,
      context,
    );
  }
}

async function inspectNode(
  absolutePath: string,
  manifestPath: string,
  context: ScanContext,
): Promise<void> {
  let stats: BigIntStats;
  try {
    stats = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    context.entries.push(
      unavailableEntry(manifestPath, "file", unavailableReason(error), null),
    );
    return;
  }

  const nodeType = statNodeType(stats);
  if (nodeType === null || nodeType === "absent") {
    throw new ForensixError(
      "INGEST_FAILED",
      "Source contains an unsupported Node Type.",
      {
        path: manifestPath,
        mode: stats.mode.toString(8),
      },
    );
  }

  if (nodeType === "file") {
    context.entries.push(
      await inspectFile(absolutePath, manifestPath, stats, context),
    );
    return;
  }
  if (nodeType === "symlink") {
    context.entries.push(
      await inspectSymlink(absolutePath, manifestPath, stats),
    );
    return;
  }
  if (nodeType === "socket") {
    const selection = classifySourcePath(manifestPath, "socket");
    context.entries.push({
      path: manifestPath,
      state: "value",
      unavailable_reason: null,
      node_type: "socket",
      file_kind: selection.fileKind,
      selection_tier: selection.tier,
      copied: false,
      unclassified: selection.unclassified,
      size: null,
      mtime_ns: stats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: representationDigest("socket"),
      link_target: null,
    });
    return;
  }

  await inspectDirectory(absolutePath, manifestPath, stats, context);
}

function hasUnavailableParent(
  path: string,
  entries: readonly ManifestEntry[],
): boolean {
  const parts = path.split("/");
  for (let length = 1; length < parts.length; length += 1) {
    const parent = parts.slice(0, length).join("/");
    const parentEntry = entries.find((entry) => entry.path === parent);
    if (
      parentEntry?.state === "unavailable" &&
      parentEntry.node_type === "dir"
    ) {
      return true;
    }
  }
  return false;
}

function addExpectedEntries(
  entries: ManifestEntry[],
  profilePaths: readonly string[],
): void {
  const actualPaths = new Set(entries.map((entry) => entry.path));
  for (const path of expectedTierOnePaths(profilePaths)) {
    if (actualPaths.has(path)) {
      continue;
    }

    const parentUnavailable = hasUnavailableParent(path, entries);
    const nodeType = parentUnavailable ? "file" : "absent";
    const selection = classifySourcePath(path, nodeType);
    entries.push({
      path,
      state: parentUnavailable ? "unavailable" : "absent",
      unavailable_reason: parentUnavailable ? "parent_unavailable" : null,
      node_type: nodeType,
      file_kind: selection.fileKind,
      selection_tier: selection.tier,
      copied: false,
      unclassified: selection.unclassified,
      size: null,
      mtime_ns: null,
      hash_algorithm: HASH_ALGORITHM,
      sha256: parentUnavailable ? null : representationDigest("absent"),
      link_target: null,
    });
  }
}

async function scanSource(
  sourceRoot: string,
  workingCopyRoot: string,
  includeTier2: boolean,
): Promise<{ readonly entries: ManifestEntry[]; readonly profiles: string[] }> {
  const context: ScanContext = {
    sourceRoot,
    workingCopyRoot,
    includeTier2,
    entries: [],
    profilePaths: new Set<string>(),
  };

  let topLevelNames: string[];
  try {
    topLevelNames = await readdir(sourceRoot);
  } catch (error) {
    throw new ForensixError(
      "INGEST_FAILED",
      "User Data Dir cannot be enumerated.",
      { source_path: sourceRoot, reason: unavailableReason(error) },
      { cause: error },
    );
  }
  topLevelNames.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  for (const childName of topLevelNames) {
    if (childName.includes("\\")) {
      throw new ForensixError(
        "INGEST_FAILED",
        "Source path cannot be represented by the Manifest contract.",
        { path: childName },
      );
    }
    await inspectNode(join(sourceRoot, childName), childName, context);
  }

  const profiles = [...context.profilePaths].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  addExpectedEntries(context.entries, profiles);
  return { entries: sortManifestEntries(context.entries), profiles };
}

function makeManifestHeader(
  entries: readonly ManifestEntry[],
  profileCount: number,
  tier2Included: boolean,
): ManifestHeader {
  return {
    manifest_schema: MANIFEST_SCHEMA,
    source_kind: "USER_DATA_DIR",
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

export async function* ingestUserDataDir(
  options: IngestOptions,
): AsyncGenerator<IngestProgress, IngestResult> {
  const requestedSource = resolve(options.sourcePath);
  let sourceStats: BigIntStats;
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
    throw new ForensixError(
      "SOURCE_NOT_DIRECTORY",
      `Source is not a User Data Dir: ${requestedSource}`,
      { source_path: requestedSource },
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
    if (errorCode(error) !== "ENOENT") {
      throw new ForensixError(
        "INGEST_FAILED",
        `Case Directory cannot be inspected: ${caseDirectory}`,
        { case_directory: caseDirectory },
        { cause: error },
      );
    }
  }
  if (isWithin(sourcePath, caseDirectory)) {
    throw new ForensixError(
      "CASE_INSIDE_SOURCE",
      "Case Directory cannot be inside the Source.",
      { source_path: sourcePath, case_directory: caseDirectory },
    );
  }

  yield {
    phase: "source_validated",
    message: "User Data Dir is readable and the output path is separate.",
  };

  await mkdir(dirname(caseDirectory), { recursive: true, mode: 0o700 });
  const stagingDirectory = `${caseDirectory}.tmp-${randomUUID()}`;
  const stagingWorkingCopy = join(stagingDirectory, WORKING_COPY_DIRECTORY);
  await mkdir(stagingWorkingCopy, { recursive: true, mode: 0o700 });

  try {
    const { entries, profiles } = await scanSource(
      sourcePath,
      stagingWorkingCopy,
      options.includeTier2 ?? false,
    );
    const tier2Included = options.includeTier2 ?? false;
    const header = makeManifestHeader(entries, profiles.length, tier2Included);
    await writeFile(
      join(stagingDirectory, MANIFEST_FILENAME),
      manifestBytes(entries),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await writeFile(
      join(stagingDirectory, MANIFEST_HEADER_FILENAME),
      `${JSON.stringify(header, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );

    yield {
      phase: "manifest_complete",
      message: "Manifest and both digests are complete.",
      completedEntries: entries.length,
    };

    const identifiers = createCaseDatabase({
      caseDirectory: stagingDirectory,
      sourcePath,
      workingCopyPath: WORKING_COPY_DIRECTORY,
      manifestPath: MANIFEST_FILENAME,
      header,
      entries,
      profiles,
    });
    await rename(stagingDirectory, caseDirectory);

    yield {
      phase: "case_written",
      message: "Case Directory is complete.",
      completedEntries: entries.length,
    };

    return {
      status: "ok",
      command: "ingest",
      caseId: identifiers.caseId,
      sourceId: identifiers.sourceId,
      caseDirectory,
      caseFile: join(caseDirectory, "case.fxdb"),
      manifestPath: join(caseDirectory, MANIFEST_FILENAME),
      workingCopyPath: join(caseDirectory, WORKING_COPY_DIRECTORY),
      sourceKind: "USER_DATA_DIR",
      selectionPolicy: CHROME_USERDATA_POLICY.name,
      tier2Included,
      evidenceSetDigest: header.evidence_set_digest,
      workingCopyDigest: header.working_copy_digest,
      profileCount: header.profile_count,
      entryCount: header.entry_count,
      copiedEntryCount: header.copied_entry_count,
      unavailableCount: header.unavailable_count,
      unclassifiedCount: header.unclassified_count,
      toolVersion: TOOL_VERSION,
    };
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
    throw error;
  }
}
