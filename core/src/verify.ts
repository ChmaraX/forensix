import { lstat, readFile, readdir } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

import {
  caseArtifactAbsolutePath,
  loadCaseSources,
  workingCopyAbsolutePath,
  type CaseSourceRecord,
} from "./case.js";
import {
  WorkingCopyIntegrityRefusal,
  type WorkingCopyIssue,
} from "./errors.js";
import {
  HASH_ALGORITHM,
  decodeManifestHeader,
  evidenceSetDigest,
  manifestBytes,
  sha256,
  workingCopyDigest,
  type ManifestEntry,
  type ManifestHeader,
} from "./manifest.js";
import { readStableRegularFile } from "./stable-file.js";

export interface WorkingCopySourceVerification {
  readonly sourceId: string;
  readonly manifestId: string;
  readonly workingCopyPath: string;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly verifiedFileCount: number;
}

export interface WorkingCopyVerification {
  readonly status: "verified";
  readonly caseDirectory: string;
  readonly sourceId: string;
  readonly sourceCount: number;
  readonly workingCopyPath: string;
  readonly evidenceSetDigest: string;
  readonly workingCopyDigest: string;
  readonly verifiedFileCount: number;
  readonly sources: readonly WorkingCopySourceVerification[];
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

function expectedManifestHeader(source: CaseSourceRecord): ManifestHeader {
  return {
    manifest_schema: source.manifestSchema,
    source_kind: source.sourceKind,
    selection_policy: source.selectionPolicy,
    selection_policy_diff: [],
    tier_2_included: source.tier2Included,
    hash_algorithm: HASH_ALGORITHM,
    evidence_set_digest: source.evidenceSetDigest,
    working_copy_digest: source.workingCopyDigest,
    entry_count: source.entryCount,
    copied_entry_count: source.copiedEntryCount,
    profile_count: source.profileCount,
    unavailable_count: source.unavailableCount,
    unclassified_count: source.unclassifiedCount,
  };
}

async function verifyManifestArtifacts(
  caseDirectory: string,
  source: CaseSourceRecord,
): Promise<WorkingCopyIssue[]> {
  const issues: WorkingCopyIssue[] = [];
  const manifestPath = caseArtifactAbsolutePath(
    caseDirectory,
    source.manifestPath,
  );
  let manifestStats;
  try {
    manifestStats = await lstat(manifestPath, { bigint: true });
  } catch {
    issues.push({
      path: source.manifestPath,
      reason: "manifest_artifact_missing",
    });
  }
  if (manifestStats !== undefined) {
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      issues.push({
        path: source.manifestPath,
        reason: "manifest_digest_mismatch",
        expected: source.evidenceSetDigest,
        actual: manifestStats.isSymbolicLink() ? "symlink" : "not_file",
      });
    } else {
      try {
        const actualBytes = await readFile(manifestPath);
        const expectedBytes = manifestBytes(source.entries);
        if (!actualBytes.equals(expectedBytes)) {
          issues.push({
            path: source.manifestPath,
            reason: "manifest_digest_mismatch",
            expected: source.evidenceSetDigest,
            actual: sha256(actualBytes),
          });
        }
      } catch {
        issues.push({
          path: source.manifestPath,
          reason: "manifest_digest_mismatch",
          expected: source.evidenceSetDigest,
          actual: "unreadable",
        });
      }
    }
  }

  const headerPath = posix.join(
    posix.dirname(source.manifestPath),
    "manifest_header.json",
  );
  const absoluteHeaderPath = caseArtifactAbsolutePath(
    caseDirectory,
    headerPath,
  );
  let headerStats;
  try {
    headerStats = await lstat(absoluteHeaderPath, { bigint: true });
  } catch {
    issues.push({ path: headerPath, reason: "manifest_artifact_missing" });
  }
  if (headerStats !== undefined) {
    if (!headerStats.isFile() || headerStats.isSymbolicLink()) {
      issues.push({
        path: headerPath,
        reason: "manifest_header_mismatch",
        expected: "valid_manifest_header",
        actual: headerStats.isSymbolicLink() ? "symlink" : "not_file",
      });
    } else {
      try {
        const actualHeader = decodeManifestHeader(
          JSON.parse(await readFile(absoluteHeaderPath, "utf8")),
        );
        if (
          JSON.stringify(actualHeader) !==
          JSON.stringify(expectedManifestHeader(source))
        ) {
          issues.push({
            path: headerPath,
            reason: "manifest_header_mismatch",
            expected: "case_source_metadata",
            actual: "different_header_values",
          });
        }
      } catch {
        issues.push({
          path: headerPath,
          reason: "manifest_header_mismatch",
          expected: "valid_manifest_header",
          actual: "invalid_or_unreadable",
        });
      }
    }
  }
  return issues;
}

async function verifySource(
  caseDirectory: string,
  source: CaseSourceRecord,
): Promise<{
  readonly verification: WorkingCopySourceVerification;
  readonly issues: readonly WorkingCopyIssue[];
}> {
  const workingCopyPath = workingCopyAbsolutePath(caseDirectory, source);
  const issues = await verifyManifestArtifacts(caseDirectory, source);

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
    return {
      verification: {
        sourceId: source.sourceId,
        manifestId: source.manifestId,
        workingCopyPath,
        evidenceSetDigest: source.evidenceSetDigest,
        workingCopyDigest: source.workingCopyDigest,
        verifiedFileCount: 0,
      },
      issues,
    };
  }
  if (!workingRootStats.isDirectory() || workingRootStats.isSymbolicLink()) {
    issues.push({
      path: ".",
      reason: "working_copy_missing",
      actual: workingRootStats.isSymbolicLink() ? "symlink" : "not_directory",
    });
    return {
      verification: {
        sourceId: source.sourceId,
        manifestId: source.manifestId,
        workingCopyPath,
        evidenceSetDigest: source.evidenceSetDigest,
        workingCopyDigest: source.workingCopyDigest,
        verifiedFileCount: 0,
      },
      issues,
    };
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

  return {
    verification: {
      sourceId: source.sourceId,
      manifestId: source.manifestId,
      workingCopyPath,
      evidenceSetDigest: source.evidenceSetDigest,
      workingCopyDigest: source.workingCopyDigest,
      verifiedFileCount: copiedEntries.length,
    },
    issues,
  };
}

export async function verifyWorkingCopy(
  caseDirectory: string,
): Promise<WorkingCopyVerification> {
  const resolvedCaseDirectory = resolve(caseDirectory);
  const caseSources = loadCaseSources(resolvedCaseDirectory);
  const results = [];
  const issues: WorkingCopyIssue[] = [];

  for (const source of caseSources) {
    const result = await verifySource(resolvedCaseDirectory, source);
    results.push(result.verification);
    issues.push(
      ...result.issues.map((issue) => ({
        ...issue,
        path:
          caseSources.length === 1
            ? issue.path
            : `${source.sourceId}:${issue.path}`,
      })),
    );
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

  const first = results[0];
  if (first === undefined) {
    throw new Error("Case contains no Source verification.");
  }
  return {
    status: "verified",
    caseDirectory: resolvedCaseDirectory,
    sourceId: first.sourceId,
    sourceCount: results.length,
    workingCopyPath: first.workingCopyPath,
    evidenceSetDigest: first.evidenceSetDigest,
    workingCopyDigest: first.workingCopyDigest,
    verifiedFileCount: results.reduce(
      (total, result) => total + result.verifiedFileCount,
      0,
    ),
    sources: results,
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
