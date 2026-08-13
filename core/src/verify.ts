import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadCaseSource, workingCopyAbsolutePath } from "./case.js";
import {
  WorkingCopyIntegrityRefusal,
  type WorkingCopyIssue,
} from "./errors.js";
import {
  evidenceSetDigest,
  workingCopyDigest,
  type ManifestEntry,
} from "./manifest.js";
import { readStableRegularFile } from "./stable-file.js";

export interface WorkingCopyVerification {
  readonly status: "verified";
  readonly caseDirectory: string;
  readonly sourceId: string;
  readonly workingCopyPath: string;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly verifiedFileCount: number;
}

export interface AnalysisPreflightResult extends WorkingCopyVerification {
  readonly command: "analyse";
  readonly analysisStatus: "ready";
  readonly artifactCount: 0;
}

function allowedWorkingDirectories(
  entries: readonly ManifestEntry[],
): Set<string> {
  const allowed = new Set<string>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      allowed.add(parts.slice(0, length).join("/"));
    }
  }
  return allowed;
}

async function findUnexpectedEntries(
  workingCopyRoot: string,
  expectedFiles: ReadonlySet<string>,
  allowedDirectories: ReadonlySet<string>,
): Promise<WorkingCopyIssue[]> {
  const issues: WorkingCopyIssue[] = [];

  async function walk(
    absoluteDirectory: string,
    relativeDirectory: string,
  ): Promise<void> {
    let names: string[];
    try {
      names = await readdir(absoluteDirectory);
    } catch {
      issues.push({
        path: relativeDirectory || ".",
        reason: "entry_unreadable",
      });
      return;
    }

    for (const name of names) {
      const manifestPath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      const absolutePath = join(absoluteDirectory, name);
      let stats;
      try {
        stats = await lstat(absolutePath, { bigint: true });
      } catch {
        issues.push({ path: manifestPath, reason: "entry_unreadable" });
        continue;
      }

      if (stats.isDirectory()) {
        if (!allowedDirectories.has(manifestPath)) {
          issues.push({ path: manifestPath, reason: "unexpected_entry" });
          continue;
        }
        await walk(absolutePath, manifestPath);
      } else if (!expectedFiles.has(manifestPath)) {
        issues.push({ path: manifestPath, reason: "unexpected_entry" });
      }
    }
  }

  await walk(workingCopyRoot, "");
  return issues;
}

export async function verifyWorkingCopy(
  caseDirectory: string,
): Promise<WorkingCopyVerification> {
  const resolvedCaseDirectory = resolve(caseDirectory);
  const source = loadCaseSource(resolvedCaseDirectory);
  const workingCopyPath = workingCopyAbsolutePath(
    resolvedCaseDirectory,
    source,
  );
  const issues: WorkingCopyIssue[] = [];

  const manifestDigest = evidenceSetDigest(source.entries);
  if (manifestDigest !== source.evidenceSetDigest) {
    issues.push({
      path: source.manifestPath,
      reason: "manifest_digest_mismatch",
      expected: source.evidenceSetDigest,
      actual: manifestDigest,
    });
  }
  const recordedWorkingDigest = workingCopyDigest(source.entries);
  if (recordedWorkingDigest !== source.workingCopyDigest) {
    issues.push({
      path: ".",
      reason: "working_copy_digest_mismatch",
      expected: source.workingCopyDigest,
      actual: recordedWorkingDigest,
    });
  }

  let workingRootStats;
  try {
    workingRootStats = await lstat(workingCopyPath, { bigint: true });
  } catch {
    issues.push({ path: ".", reason: "working_copy_missing" });
    throw new WorkingCopyIntegrityRefusal(issues);
  }
  if (!workingRootStats.isDirectory() || workingRootStats.isSymbolicLink()) {
    issues.push({
      path: ".",
      reason: "working_copy_missing",
      actual: workingRootStats.isSymbolicLink() ? "symlink" : "not_directory",
    });
    throw new WorkingCopyIntegrityRefusal(issues);
  }

  const copiedEntries = source.entries.filter((entry) => entry.copied);
  const actualEntries: ManifestEntry[] = [];
  for (const entry of copiedEntries) {
    const absolutePath = join(workingCopyPath, ...entry.path.split("/"));
    let stats;
    try {
      stats = await lstat(absolutePath, { bigint: true });
    } catch {
      issues.push({ path: entry.path, reason: "entry_missing" });
      continue;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      issues.push({
        path: entry.path,
        reason: "entry_not_regular_file",
        actual: stats.isDirectory()
          ? "dir"
          : stats.isSymbolicLink()
            ? "symlink"
            : "other",
      });
      continue;
    }

    const actual = await readStableRegularFile(absolutePath, stats);
    if (actual.status !== "stable") {
      issues.push({ path: entry.path, reason: "entry_unreadable" });
      continue;
    }
    if (actual.size !== entry.size) {
      issues.push({
        path: entry.path,
        reason: "entry_size_mismatch",
        expected: entry.size ?? -1,
        actual: actual.size,
      });
    }
    if (actual.sha256 !== entry.sha256) {
      issues.push({
        path: entry.path,
        reason: "entry_hash_mismatch",
        expected: entry.sha256 ?? "",
        actual: actual.sha256,
      });
    }
    actualEntries.push({ ...entry, size: actual.size, sha256: actual.sha256 });
  }

  const expectedFiles = new Set(copiedEntries.map((entry) => entry.path));
  issues.push(
    ...(await findUnexpectedEntries(
      workingCopyPath,
      expectedFiles,
      allowedWorkingDirectories(copiedEntries),
    )),
  );

  if (actualEntries.length === copiedEntries.length) {
    const actualWorkingDigest = workingCopyDigest(actualEntries);
    if (actualWorkingDigest !== source.workingCopyDigest) {
      issues.push({
        path: ".",
        reason: "working_copy_digest_mismatch",
        expected: source.workingCopyDigest,
        actual: actualWorkingDigest,
      });
    }
  }

  if (issues.length > 0) {
    issues.sort((left, right) => {
      const pathOrder = Buffer.compare(
        Buffer.from(left.path),
        Buffer.from(right.path),
      );
      return pathOrder === 0
        ? left.reason.localeCompare(right.reason)
        : pathOrder;
    });
    throw new WorkingCopyIntegrityRefusal(issues);
  }

  return {
    status: "verified",
    caseDirectory: resolvedCaseDirectory,
    sourceId: source.sourceId,
    workingCopyPath,
    evidenceSetDigest: source.evidenceSetDigest,
    workingCopyDigest: source.workingCopyDigest,
    verifiedFileCount: copiedEntries.length,
  };
}

export async function preflightAnalysis(
  caseDirectory: string,
): Promise<AnalysisPreflightResult> {
  const verification = await verifyWorkingCopy(caseDirectory);
  return {
    ...verification,
    command: "analyse",
    analysisStatus: "ready",
    artifactCount: 0,
  };
}
