import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { ForensixError } from "./errors.js";
import {
  HASH_ALGORITHM,
  decodeManifestEntry,
  decodeManifestHeader,
  evidenceSetDigest,
  manifestBytes,
  representationDigest,
  sha256,
  sortManifestEntries,
  workingCopyDigest,
  type ManifestEntry,
  type ManifestHeader,
} from "./manifest.js";
import { classifySourcePath } from "./selection-policy.js";
import { readStableRegularFile } from "./stable-file.js";

export type AcquisitionVerificationOutcome =
  | "match"
  | "mismatch"
  | "missing_on_disk"
  | "missing_in_manifest";

export type AcquisitionBundleStatus =
  | "verified"
  | "verified_with_divergence"
  | "failed_to_open";

export interface AcquisitionVerificationRecord {
  readonly scope: "bundle" | "source_manifest";
  readonly sourceIndex: number | null;
  readonly path: string;
  readonly outcome: AcquisitionVerificationOutcome;
  readonly expectedSize: number | null;
  readonly actualSize: number | null;
  readonly expectedSha256: string | null;
  readonly actualSha256: string | null;
}

export interface AcquisitionBundleSource {
  readonly sourceIndex: number;
  readonly bundlePath: string;
  readonly bundleSourcePath: string;
  readonly originSourcePath: string;
  readonly acquisitionHeader: ManifestHeader;
  readonly acquisitionEntries: readonly ManifestEntry[];
  readonly acquisitionManifestBytes: Buffer;
  readonly profiles: readonly string[];
  readonly workingCopyNodes: ReadonlyMap<string, ActualNode>;
}

export interface AcquisitionBundleInspection {
  readonly bundleRoot: string;
  readonly expectedBundleDigest: string;
  readonly actualBundleDigest: string;
  readonly sources: readonly AcquisitionBundleSource[];
  readonly sourceErrors: readonly string[];
  readonly records: readonly AcquisitionVerificationRecord[];
}

export interface MaterializedAcquisitionSource {
  readonly entries: readonly ManifestEntry[];
  readonly records: readonly AcquisitionVerificationRecord[];
}

interface ActualNode {
  readonly path: string;
  readonly absolutePath: string;
  readonly nodeType: "file" | "dir" | "symlink" | "socket" | "other";
  readonly stats: BigIntStats;
}

interface BundleFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface BundleUserDataDir {
  readonly bundlePath: string;
  readonly sourcePath: string;
  readonly outcome: string;
}

interface DecodedBundleManifest {
  readonly files: readonly BundleFile[];
  readonly userDataDirs: readonly BundleUserDataDir[];
  readonly bundleDigest: string;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer.`);
  }
  return value as number;
}

function canonicalRelativePath(value: unknown, name: string): string {
  const path = stringValue(value, name);
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`${name} is not a canonical relative path.`);
  }
  return path;
}

function decodeBundleManifest(value: unknown): DecodedBundleManifest {
  const object = record(value, "Acquisition Bundle manifest");
  if (
    object.schema_version !== "forensix-acquisition-bundle-draft/1" ||
    object.hash_algorithm !== HASH_ALGORITHM ||
    !Array.isArray(object.files) ||
    !Array.isArray(object.user_data_dirs)
  ) {
    throw new TypeError("Acquisition Bundle manifest is unsupported.");
  }

  const paths = new Set<string>();
  const files = object.files.map((item, index) => {
    const file = record(item, `files[${index}]`);
    const path = canonicalRelativePath(file.path, `files[${index}].path`);
    if (path === "bundle_manifest.json" || paths.has(path)) {
      throw new TypeError(
        "Acquisition Bundle file paths must be unique and cannot self-reference.",
      );
    }
    paths.add(path);
    const digest = stringValue(file.sha256, `files[${index}].sha256`);
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new TypeError(`files[${index}].sha256 is invalid.`);
    }
    return {
      path,
      size: nonnegativeInteger(file.size, `files[${index}].size`),
      sha256: digest,
    };
  });

  const userDataDirs = object.user_data_dirs.map((item, index) => {
    const source = record(item, `user_data_dirs[${index}]`);
    return {
      bundlePath: canonicalRelativePath(
        source.bundle_path,
        `user_data_dirs[${index}].bundle_path`,
      ),
      sourcePath: stringValue(
        source.source_path,
        `user_data_dirs[${index}].source_path`,
      ),
      outcome: stringValue(source.outcome, `user_data_dirs[${index}].outcome`),
    };
  });
  const bundleDigest = stringValue(object.bundle_digest, "bundle_digest");
  if (!/^[0-9a-f]{64}$/.test(bundleDigest)) {
    throw new TypeError("bundle_digest is invalid.");
  }
  return { files, userDataDirs, bundleDigest };
}

function nodeType(stats: BigIntStats): ActualNode["nodeType"] {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "dir";
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isSocket()) return "socket";
  return "other";
}

function byteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function enumerateTree(root: string): Promise<Map<string, ActualNode>> {
  const nodes = new Map<string, ActualNode>();

  async function walk(
    absoluteDirectory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const names = await readdir(absoluteDirectory);
    names.sort(byteOrder);
    for (const name of names) {
      if (name.includes("\\")) {
        throw new TypeError(
          "Acquisition Bundle path cannot be represented canonically.",
        );
      }
      const path = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const absolutePath = join(absoluteDirectory, name);
      const stats = await lstat(absolutePath, { bigint: true });
      const type = nodeType(stats);
      nodes.set(path, { path, absolutePath, nodeType: type, stats });
      if (type === "dir") {
        await walk(absolutePath, path);
      }
    }
  }

  await walk(root, "");
  return nodes;
}

async function digestActualFile(
  node: ActualNode,
): Promise<{ size: number; sha256: string } | null> {
  if (node.nodeType !== "file") {
    return null;
  }
  const result = await readStableRegularFile(node.absolutePath, node.stats);
  return result.status === "stable"
    ? { size: result.size, sha256: result.sha256 }
    : null;
}

function parseManifestBytes(bytes: Buffer): readonly ManifestEntry[] {
  const text = bytes.toString("utf8");
  if (text.length === 0) {
    return [];
  }
  if (!text.endsWith("\n") || text.includes("\r")) {
    throw new TypeError(
      "Acquisition Manifest must use canonical LF-terminated JSONL.",
    );
  }
  const entries = text
    .slice(0, -1)
    .split("\n")
    .map((line) => decodeManifestEntry(JSON.parse(line)));
  if (!manifestBytes(entries).equals(bytes)) {
    throw new TypeError("Acquisition Manifest bytes are not canonical.");
  }
  return entries;
}

function assertHeaderMatchesEntries(
  header: ManifestHeader,
  entries: readonly ManifestEntry[],
): void {
  if (
    header.source_kind !== "USER_DATA_DIR" ||
    header.entry_count !== entries.length ||
    header.copied_entry_count !==
      entries.filter((entry) => entry.copied).length ||
    header.unavailable_count !==
      entries.filter((entry) => entry.state === "unavailable").length ||
    header.unclassified_count !==
      entries.filter(
        (entry) =>
          entry.state === "value" &&
          entry.unclassified &&
          entry.node_type !== "dir",
      ).length ||
    header.evidence_set_digest !== evidenceSetDigest(entries) ||
    header.working_copy_digest !== workingCopyDigest(entries)
  ) {
    throw new TypeError(
      "Acquisition Manifest header does not match its entries.",
    );
  }
}

function profilesFromEntries(entries: readonly ManifestEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        !entry.path.includes("/") &&
        entry.state === "value" &&
        entry.node_type === "dir" &&
        entry.file_kind === "directory" &&
        entry.selection_tier === "tier_1",
    )
    .map((entry) => entry.path)
    .sort(byteOrder);
}

function childNodes(
  nodes: ReadonlyMap<string, ActualNode>,
  root: string,
): Map<string, ActualNode> {
  const prefix = `${root}/`;
  const result = new Map<string, ActualNode>();
  for (const [path, node] of nodes) {
    if (path.startsWith(prefix)) {
      result.set(path.slice(prefix.length), node);
    }
  }
  return result;
}

export async function inspectAcquisitionBundle(
  bundleRoot: string,
): Promise<AcquisitionBundleInspection> {
  let nodes: Map<string, ActualNode>;
  let manifest: DecodedBundleManifest;
  try {
    nodes = await enumerateTree(bundleRoot);
    const manifestNode = nodes.get("bundle_manifest.json");
    if (manifestNode?.nodeType !== "file") {
      throw new TypeError(
        "bundle_manifest.json is missing or is not a regular file.",
      );
    }
    manifest = decodeBundleManifest(
      JSON.parse(await readFile(manifestNode.absolutePath, "utf8")),
    );
  } catch (error) {
    throw new ForensixError(
      "INGEST_FAILED",
      "Acquisition Bundle could not be opened.",
      { source_path: bundleRoot, bundle_status: "failed_to_open" },
      { cause: error },
    );
  }

  const expectedByPath = new Map(
    manifest.files.map((file) => [file.path, file]),
  );
  const actualByPath = new Map<string, BundleFile>();
  for (const [path, node] of nodes) {
    if (path === "bundle_manifest.json" || node.nodeType !== "file") {
      continue;
    }
    const digest = await digestActualFile(node);
    if (digest !== null) {
      actualByPath.set(path, {
        path,
        size: digest.size,
        sha256: digest.sha256,
      });
    }
  }
  const actualBundleFiles = [...actualByPath.values()].sort((left, right) =>
    byteOrder(left.path, right.path),
  );

  const records: AcquisitionVerificationRecord[] = [];
  for (const expected of manifest.files) {
    const actualNode = nodes.get(expected.path);
    const actual = actualByPath.get(expected.path);
    if (actualNode === undefined) {
      records.push({
        scope: "bundle",
        sourceIndex: null,
        path: expected.path,
        outcome: "missing_on_disk",
        expectedSize: expected.size,
        actualSize: null,
        expectedSha256: expected.sha256,
        actualSha256: null,
      });
      continue;
    }
    records.push({
      scope: "bundle",
      sourceIndex: null,
      path: expected.path,
      outcome:
        actual !== undefined &&
        actual.size === expected.size &&
        actual.sha256 === expected.sha256
          ? "match"
          : "mismatch",
      expectedSize: expected.size,
      actualSize: actual?.size ?? Number(actualNode.stats.size),
      expectedSha256: expected.sha256,
      actualSha256: actual?.sha256 ?? null,
    });
  }
  for (const [path, actualNode] of nodes) {
    if (
      path === "bundle_manifest.json" ||
      expectedByPath.has(path) ||
      actualNode.nodeType === "dir"
    ) {
      continue;
    }
    const actual = actualByPath.get(path);
    records.push({
      scope: "bundle",
      sourceIndex: null,
      path,
      outcome: "missing_in_manifest",
      expectedSize: null,
      actualSize: actual?.size ?? Number(actualNode.stats.size),
      expectedSha256: null,
      actualSha256: actual?.sha256 ?? null,
    });
  }
  records.sort((left, right) => byteOrder(left.path, right.path));

  const sourceErrors: string[] = [];
  const sources: AcquisitionBundleSource[] = [];
  for (const [sourceIndex, listedSource] of manifest.userDataDirs.entries()) {
    if (listedSource.outcome !== "collected") {
      continue;
    }
    const manifestPath = `${listedSource.bundlePath}/manifest.jsonl`;
    const headerPath = `${listedSource.bundlePath}/manifest_header.json`;
    const manifestNode = nodes.get(manifestPath);
    const headerNode = nodes.get(headerPath);
    if (manifestNode?.nodeType !== "file" || headerNode?.nodeType !== "file") {
      sourceErrors.push(
        `${listedSource.bundlePath}: acquisition Manifest is missing`,
      );
      continue;
    }
    try {
      const acquisitionManifestBytes = await readFile(
        manifestNode.absolutePath,
      );
      const acquisitionEntries = parseManifestBytes(acquisitionManifestBytes);
      const acquisitionHeader = decodeManifestHeader(
        JSON.parse(await readFile(headerNode.absolutePath, "utf8")),
      );
      assertHeaderMatchesEntries(acquisitionHeader, acquisitionEntries);
      const profiles = profilesFromEntries(acquisitionEntries);
      if (acquisitionHeader.profile_count !== profiles.length) {
        throw new TypeError(
          "Acquisition Manifest Profile count does not match its entries.",
        );
      }
      sources.push({
        sourceIndex,
        bundlePath: listedSource.bundlePath,
        bundleSourcePath: join(
          bundleRoot,
          ...listedSource.bundlePath.split("/"),
        ),
        originSourcePath: listedSource.sourcePath,
        acquisitionHeader,
        acquisitionEntries,
        acquisitionManifestBytes,
        profiles,
        workingCopyNodes: childNodes(
          nodes,
          `${listedSource.bundlePath}/working_copy`,
        ),
      });
    } catch (error) {
      sourceErrors.push(
        `${listedSource.bundlePath}: ${error instanceof Error ? error.message : "invalid acquisition Manifest"}`,
      );
    }
  }

  const actualBundleDigest = sha256(`${JSON.stringify(actualBundleFiles)}\n`);
  return {
    bundleRoot,
    expectedBundleDigest: manifest.bundleDigest,
    actualBundleDigest,
    sources,
    sourceErrors,
    records,
  };
}

function absentFrom(entry: ManifestEntry): ManifestEntry {
  return {
    ...entry,
    state: "absent",
    unavailable_reason: null,
    node_type: "absent",
    copied: false,
    size: null,
    mtime_ns: null,
    sha256: representationDigest("absent"),
    link_target: null,
  };
}

async function observeNode(
  path: string,
  node: ActualNode,
  original?: ManifestEntry,
): Promise<ManifestEntry> {
  const selection =
    original === undefined
      ? classifySourcePath(
          path,
          node.nodeType === "other" ? "file" : node.nodeType,
        )
      : {
          tier: original.selection_tier,
          fileKind: original.file_kind,
          unclassified: original.unclassified,
        };
  if (node.nodeType === "file") {
    const result = await readStableRegularFile(node.absolutePath, node.stats);
    if (result.status !== "stable") {
      return {
        path,
        state: "unavailable",
        unavailable_reason:
          result.status === "open_failed" || result.status === "read_failed"
            ? "io_error"
            : "changed_during_ingest",
        node_type: "file",
        file_kind: selection.fileKind,
        selection_tier: selection.tier,
        copied: false,
        unclassified: selection.unclassified,
        size: null,
        mtime_ns: node.stats.mtimeNs.toString(),
        hash_algorithm: HASH_ALGORITHM,
        sha256: null,
        link_target: null,
      };
    }
    return {
      path,
      state: "value",
      unavailable_reason: null,
      node_type: "file",
      file_kind: selection.fileKind,
      selection_tier: selection.tier,
      copied: false,
      unclassified: selection.unclassified,
      size: result.size,
      mtime_ns: node.stats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: result.sha256,
      link_target: null,
    };
  }
  if (node.nodeType === "symlink") {
    const target = await readlink(node.absolutePath, { encoding: "utf8" });
    return {
      path,
      state: "value",
      unavailable_reason: null,
      node_type: "symlink",
      file_kind: selection.fileKind,
      selection_tier: selection.tier,
      copied: false,
      unclassified: selection.unclassified,
      size: Buffer.byteLength(target, "utf8"),
      mtime_ns: node.stats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: representationDigest("symlink", target),
      link_target: target,
    };
  }
  if (node.nodeType === "dir" || node.nodeType === "socket") {
    return {
      path,
      state: "value",
      unavailable_reason: null,
      node_type: node.nodeType,
      file_kind: node.nodeType === "dir" ? "directory" : selection.fileKind,
      selection_tier: selection.tier,
      copied: false,
      unclassified: selection.unclassified,
      size: null,
      mtime_ns: node.stats.mtimeNs.toString(),
      hash_algorithm: HASH_ALGORITHM,
      sha256: representationDigest(node.nodeType),
      link_target: null,
    };
  }
  return {
    path,
    state: "unavailable",
    unavailable_reason: "io_error",
    node_type: "file",
    file_kind: selection.fileKind,
    selection_tier: selection.tier,
    copied: false,
    unclassified: selection.unclassified,
    size: null,
    mtime_ns: node.stats.mtimeNs.toString(),
    hash_algorithm: HASH_ALGORITHM,
    sha256: null,
    link_target: null,
  };
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

async function copyVerifiedFile(
  node: ActualNode,
  destinationPath: string,
  expected: ManifestEntry,
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  const destination = await open(destinationPath, "wx", 0o600);
  let keep = false;
  try {
    const result = await readStableRegularFile(
      node.absolutePath,
      node.stats,
      async (chunk) => writeAll(destination, chunk),
    );
    if (
      result.status !== "stable" ||
      result.size !== expected.size ||
      result.sha256 !== expected.sha256
    ) {
      throw new ForensixError(
        "INGEST_FAILED",
        "Acquisition Bundle file changed while it was copied.",
        { path: expected.path },
      );
    }
    await destination.sync();
    keep = true;
  } finally {
    await destination.close().catch(() => undefined);
    if (!keep) {
      await rm(destinationPath, { force: true }).catch(() => undefined);
    }
  }
}

export async function materializeAcquisitionBundleSource(
  source: AcquisitionBundleSource,
  workingCopyRoot: string,
): Promise<MaterializedAcquisitionSource> {
  await mkdir(workingCopyRoot, { recursive: true, mode: 0o700 });
  const entries: ManifestEntry[] = [];
  const records: AcquisitionVerificationRecord[] = [];
  const expectedPaths = new Set(
    source.acquisitionEntries.map((entry) => entry.path),
  );

  for (const original of source.acquisitionEntries) {
    const actual = source.workingCopyNodes.get(original.path);
    if (!original.copied) {
      if (actual === undefined || actual.nodeType === "dir") {
        entries.push(original);
        continue;
      }
      const observed = await observeNode(original.path, actual, original);
      entries.push(observed);
      records.push({
        scope: "source_manifest",
        sourceIndex: source.sourceIndex,
        path: original.path,
        outcome: "mismatch",
        expectedSize: original.size,
        actualSize: observed.size,
        expectedSha256: original.sha256,
        actualSha256: observed.sha256,
      });
      continue;
    }

    if (actual === undefined) {
      entries.push(absentFrom(original));
      records.push({
        scope: "source_manifest",
        sourceIndex: source.sourceIndex,
        path: original.path,
        outcome: "missing_on_disk",
        expectedSize: original.size,
        actualSize: null,
        expectedSha256: original.sha256,
        actualSha256: null,
      });
      continue;
    }

    const observed = await observeNode(original.path, actual, original);
    const matches =
      observed.state === "value" &&
      observed.node_type === "file" &&
      observed.size === original.size &&
      observed.sha256 === original.sha256;
    if (matches) {
      await copyVerifiedFile(
        actual,
        join(workingCopyRoot, ...original.path.split("/")),
        original,
      );
      entries.push(original);
    } else {
      entries.push(observed);
    }
    records.push({
      scope: "source_manifest",
      sourceIndex: source.sourceIndex,
      path: original.path,
      outcome: matches ? "match" : "mismatch",
      expectedSize: original.size,
      actualSize: observed.size,
      expectedSha256: original.sha256,
      actualSha256: observed.sha256,
    });
  }

  for (const [path, actual] of source.workingCopyNodes) {
    if (expectedPaths.has(path)) {
      continue;
    }
    const observed = await observeNode(path, actual);
    entries.push(observed);
    if (actual.nodeType !== "dir") {
      records.push({
        scope: "source_manifest",
        sourceIndex: source.sourceIndex,
        path,
        outcome: "missing_in_manifest",
        expectedSize: null,
        actualSize: observed.size,
        expectedSha256: null,
        actualSha256: observed.sha256,
      });
    }
  }

  records.sort((left, right) => byteOrder(left.path, right.path));
  return { entries: sortManifestEntries(entries), records };
}

export function acquisitionBundleStatus(
  inspection: AcquisitionBundleInspection,
  sourceRecords: readonly AcquisitionVerificationRecord[],
): AcquisitionBundleStatus {
  const diverged =
    inspection.expectedBundleDigest !== inspection.actualBundleDigest ||
    inspection.sourceErrors.length > 0 ||
    [...inspection.records, ...sourceRecords].some(
      (record) => record.outcome !== "match",
    );
  return diverged ? "verified_with_divergence" : "verified";
}
