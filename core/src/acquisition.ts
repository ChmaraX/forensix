import { lstat, mkdir, open, readlink, readdir, rm } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ForensixError } from "./errors.js";
import {
  HASH_ALGORITHM,
  representationDigest,
  sortManifestEntries,
  type ManifestEntry,
  type NodeType,
  type UnavailableReason,
} from "./manifest.js";
import {
  classifySourcePath,
  expectedTierOnePaths,
  isProfileDirectoryName,
} from "./selection-policy.js";
import { readStableRegularFile, sameNodeMetadata } from "./stable-file.js";

const ROOT_SCAN_ATTEMPTS = 2;

export interface AcquisitionResult {
  readonly entries: readonly ManifestEntry[];
  readonly profiles: readonly string[];
}

interface ScanContext {
  readonly workingCopyRoot: string;
  readonly includeTier2: boolean;
  readonly entries: ManifestEntry[];
  readonly profilePaths: Set<string>;
}

class SourceRootChanged extends Error {}

export function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function unavailableReason(error: unknown): UnavailableReason {
  const code = filesystemErrorCode(error);
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

function sortNames(names: string[]): string[] {
  return names.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

async function writeAll(destination: FileHandle, chunk: Buffer): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    const result = await destination.write(
      chunk,
      written,
      chunk.length - written,
    );
    written += result.bytesWritten;
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
  const destinationPath = join(
    context.workingCopyRoot,
    ...manifestPath.split("/"),
  );
  let destination: FileHandle | null = null;
  let keepDestination = false;

  try {
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

    let result;
    try {
      result = await readStableRegularFile(
        absolutePath,
        initialStats,
        destination === null
          ? undefined
          : async (chunk) => writeAll(destination as FileHandle, chunk),
      );
    } catch (error) {
      throw new ForensixError(
        "INGEST_FAILED",
        "Working Copy file cannot be written.",
        { path: manifestPath },
        { cause: error },
      );
    }

    if (result.status === "too_large") {
      throw new ForensixError(
        "INGEST_FAILED",
        "Source node is too large to record safely.",
        { path: manifestPath, size: initialStats.size.toString() },
      );
    }
    if (result.status === "open_failed" || result.status === "read_failed") {
      return unavailableEntry(
        manifestPath,
        "file",
        unavailableReason(result.error),
        initialStats.mtimeNs.toString(),
      );
    }
    if (result.status !== "stable") {
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
      size: result.size,
      mtime_ns: initialStats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: result.sha256,
      link_target: null,
    };
  } finally {
    if (destination !== null) {
      await destination.close().catch(() => undefined);
      if (!keepDestination) {
        await rm(destinationPath, { force: true }).catch(() => undefined);
      }
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

  let finalStats: BigIntStats;
  try {
    finalStats = await lstat(absolutePath, { bigint: true });
  } catch {
    return unavailableEntry(
      manifestPath,
      "symlink",
      "changed_during_ingest",
      initialStats.mtimeNs.toString(),
    );
  }
  if (!sameNodeMetadata(initialStats, finalStats)) {
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

async function discardDirectoryObservation(
  context: ScanContext,
  entryStart: number,
  manifestPath: string,
  initialStats: BigIntStats,
  reason: UnavailableReason,
): Promise<void> {
  context.entries.splice(entryStart);
  try {
    await rm(join(context.workingCopyRoot, ...manifestPath.split("/")), {
      force: true,
      recursive: true,
    });
  } catch (error) {
    throw new ForensixError(
      "INGEST_FAILED",
      "Partial Working Copy directory cannot be removed.",
      { path: manifestPath },
      { cause: error },
    );
  }
  context.entries.push(
    unavailableEntry(
      manifestPath,
      "dir",
      reason,
      initialStats.mtimeNs.toString(),
    ),
  );
}

async function inspectDirectory(
  absolutePath: string,
  manifestPath: string,
  initialStats: BigIntStats,
  context: ScanContext,
): Promise<void> {
  const entryStart = context.entries.length;
  const selection = classifySourcePath(manifestPath, "dir");
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
    childNames = sortNames(await readdir(absolutePath));
  } catch (error) {
    await discardDirectoryObservation(
      context,
      entryStart,
      manifestPath,
      initialStats,
      unavailableReason(error),
    );
    return;
  }

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

  let finalStats: BigIntStats;
  let finalNames: string[];
  try {
    [finalStats, finalNames] = await Promise.all([
      lstat(absolutePath, { bigint: true }),
      readdir(absolutePath).then(sortNames),
    ]);
  } catch (error) {
    await discardDirectoryObservation(
      context,
      entryStart,
      manifestPath,
      initialStats,
      unavailableReason(error),
    );
    return;
  }
  if (
    !sameNodeMetadata(initialStats, finalStats) ||
    !sameNames(childNames, finalNames)
  ) {
    await discardDirectoryObservation(
      context,
      entryStart,
      manifestPath,
      initialStats,
      "changed_during_ingest",
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
      { path: manifestPath, mode: stats.mode.toString(8) },
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

async function scanOnce(
  sourceRoot: string,
  workingCopyRoot: string,
  includeTier2: boolean,
): Promise<AcquisitionResult> {
  const initialRootStats = await lstat(sourceRoot, { bigint: true });
  let topLevelNames: string[];
  try {
    topLevelNames = sortNames(await readdir(sourceRoot));
  } catch (error) {
    throw new ForensixError(
      "INGEST_FAILED",
      "User Data Dir cannot be enumerated.",
      { source_path: sourceRoot, reason: unavailableReason(error) },
      { cause: error },
    );
  }

  const context: ScanContext = {
    workingCopyRoot,
    includeTier2,
    entries: [],
    profilePaths: new Set<string>(),
  };
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

  let finalRootStats: BigIntStats;
  let finalTopLevelNames: string[];
  try {
    [finalRootStats, finalTopLevelNames] = await Promise.all([
      lstat(sourceRoot, { bigint: true }),
      readdir(sourceRoot).then(sortNames),
    ]);
  } catch {
    throw new SourceRootChanged();
  }
  if (
    !sameNodeMetadata(initialRootStats, finalRootStats) ||
    !sameNames(topLevelNames, finalTopLevelNames)
  ) {
    throw new SourceRootChanged();
  }

  const profiles = [...context.profilePaths].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  addExpectedEntries(context.entries, profiles);
  return { entries: sortManifestEntries(context.entries), profiles };
}

export async function acquireUserDataDir(
  sourceRoot: string,
  workingCopyRoot: string,
  includeTier2: boolean,
): Promise<AcquisitionResult> {
  for (let attempt = 1; attempt <= ROOT_SCAN_ATTEMPTS; attempt += 1) {
    await rm(workingCopyRoot, { force: true, recursive: true });
    await mkdir(workingCopyRoot, { recursive: true, mode: 0o700 });
    try {
      return await scanOnce(sourceRoot, workingCopyRoot, includeTier2);
    } catch (error) {
      if (!(error instanceof SourceRootChanged)) {
        throw error;
      }
      if (attempt === ROOT_SCAN_ATTEMPTS) {
        throw new ForensixError(
          "INGEST_FAILED",
          "User Data Dir changed during ingest.",
          { source_path: sourceRoot, reason: "changed_during_ingest" },
        );
      }
    }
  }

  throw new Error("Unreachable acquisition retry state.");
}
