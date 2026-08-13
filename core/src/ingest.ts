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

import { acquireUserDataDir, filesystemErrorCode } from "./acquisition.js";
import { createCaseDatabase, TOOL_VERSION } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  HASH_ALGORITHM,
  MANIFEST_SCHEMA,
  evidenceSetDigest,
  manifestBytes,
  workingCopyDigest,
  type ManifestEntry,
  type ManifestHeader,
} from "./manifest.js";
import { CHROME_USERDATA_POLICY } from "./selection-policy.js";

const MANIFEST_FILENAME = "manifest.jsonl";
const MANIFEST_HEADER_FILENAME = "manifest_header.json";
const WORKING_COPY_DIRECTORY = "working-copy";

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
    message: "User Data Dir is readable and the output path is separate.",
  };

  await mkdir(dirname(caseDirectory), { recursive: true, mode: 0o700 });
  await assertCaseOutsideSource(sourcePath, caseDirectory);
  const stagingDirectory = join(
    dirname(caseDirectory),
    `${basename(caseDirectory)}.tmp-${randomUUID()}`,
  );
  const stagingWorkingCopy = join(stagingDirectory, WORKING_COPY_DIRECTORY);
  await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });

  try {
    const tier2Included = options.includeTier2 ?? false;
    const { entries, profiles } = await acquireUserDataDir(
      sourcePath,
      stagingWorkingCopy,
      tier2Included,
    );
    const header = makeManifestHeader(entries, profiles.length, tier2Included);
    await writeFile(
      join(stagingDirectory, MANIFEST_FILENAME),
      manifestBytes(entries),
      { flag: "wx", mode: 0o600 },
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
