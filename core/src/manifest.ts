import { createHash } from "node:crypto";

export const MANIFEST_SCHEMA = "forensix/manifest/1" as const;
export const HASH_ALGORITHM = "sha-256" as const;

export type ManifestState = "value" | "absent" | "unavailable";
export type UnavailableReason =
  | "permission_denied"
  | "io_error"
  | "changed_during_ingest"
  | "parent_unavailable";
export type NodeType = "file" | "symlink" | "socket" | "dir" | "absent";
export type FileKind =
  | "database"
  | "sidecar"
  | "json"
  | "image"
  | "metadata"
  | "liveness_evidence"
  | "bulk_data"
  | "ballast"
  | "directory"
  | "unclassified";
export type SelectionTier = "tier_1" | "tier_2" | "tier_3" | "unclassified";

export interface ManifestEntry {
  readonly path: string;
  readonly state: ManifestState;
  readonly unavailable_reason: UnavailableReason | null;
  readonly node_type: NodeType;
  readonly file_kind: FileKind;
  readonly selection_tier: SelectionTier;
  readonly copied: boolean;
  readonly unclassified: boolean;
  readonly size: number | null;
  readonly mtime_ns: string | null;
  readonly hash_algorithm: typeof HASH_ALGORITHM;
  readonly sha256: string | null;
  readonly link_target: string | null;
}

export interface ManifestHeader {
  readonly manifest_schema: typeof MANIFEST_SCHEMA;
  readonly source_kind: "USER_DATA_DIR";
  readonly selection_policy: "chrome-userdata/1";
  readonly selection_policy_diff: readonly [];
  readonly tier_2_included: boolean;
  readonly hash_algorithm: typeof HASH_ALGORITHM;
  readonly evidence_set_digest: string;
  readonly working_copy_digest: string;
  readonly entry_count: number;
  readonly copied_entry_count: number;
  readonly profile_count: number;
  readonly unavailable_count: number;
  readonly unclassified_count: number;
}

export function sha256(data: NodeJS.ArrayBufferView | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function representationDigest(
  nodeType: Exclude<NodeType, "file">,
  linkTarget: string | null = null,
): string {
  if (nodeType === "symlink") {
    if (linkTarget === null) {
      throw new TypeError("A symlink representation needs target text.");
    }
    return sha256(Buffer.from(linkTarget, "utf8"));
  }

  return sha256(Buffer.from(nodeType, "utf8"));
}

export function canonicalManifestLine(entry: ManifestEntry): string {
  assertManifestEntry(entry);
  return JSON.stringify({
    path: entry.path,
    state: entry.state,
    unavailable_reason: entry.unavailable_reason,
    node_type: entry.node_type,
    file_kind: entry.file_kind,
    selection_tier: entry.selection_tier,
    copied: entry.copied,
    unclassified: entry.unclassified,
    size: entry.size,
    mtime_ns: entry.mtime_ns,
    hash_algorithm: entry.hash_algorithm,
    sha256: entry.sha256,
    link_target: entry.link_target,
  });
}

export function sortManifestEntries(
  entries: readonly ManifestEntry[],
): ManifestEntry[] {
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(
      Buffer.from(canonicalManifestLine(left), "utf8"),
      Buffer.from(canonicalManifestLine(right), "utf8"),
    ),
  );
  const paths = new Set<string>();
  for (const entry of sorted) {
    if (paths.has(entry.path)) {
      throw new TypeError(
        `Manifest path is duplicated: ${JSON.stringify(entry.path)}`,
      );
    }
    paths.add(entry.path);
  }
  return sorted;
}

export function manifestBytes(entries: readonly ManifestEntry[]): Buffer {
  if (entries.length === 0) {
    return Buffer.alloc(0);
  }

  const lines = sortManifestEntries(entries).map(canonicalManifestLine);
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

export function evidenceSetDigest(entries: readonly ManifestEntry[]): string {
  return sha256(manifestBytes(entries));
}

export function workingCopyDigest(entries: readonly ManifestEntry[]): string {
  return sha256(manifestBytes(entries.filter((entry) => entry.copied)));
}

export function assertManifestEntry(entry: ManifestEntry): void {
  if (
    entry.path.length === 0 ||
    entry.path.startsWith("/") ||
    entry.path.includes("\\") ||
    entry.path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(
      `Manifest path is not canonical: ${JSON.stringify(entry.path)}`,
    );
  }
  if (entry.hash_algorithm !== HASH_ALGORITHM) {
    throw new TypeError("Manifest hash algorithm must be sha-256.");
  }
  if (
    entry.size !== null &&
    (!Number.isSafeInteger(entry.size) || entry.size < 0)
  ) {
    throw new TypeError("A Manifest size must be a nonnegative safe integer.");
  }
  if (entry.mtime_ns !== null && !/^-?[0-9]+$/.test(entry.mtime_ns)) {
    throw new TypeError(
      "A Manifest mtime must be a decimal nanosecond string.",
    );
  }
  if (entry.state === "unavailable") {
    if (
      entry.unavailable_reason === null ||
      entry.sha256 !== null ||
      entry.copied
    ) {
      throw new TypeError(
        "An unavailable entry needs a reason and cannot have a hash or copy.",
      );
    }
  } else if (entry.unavailable_reason !== null || entry.sha256 === null) {
    throw new TypeError(
      "An available or absent entry needs a hash and no unavailable reason.",
    );
  }
  if ((entry.state === "absent") !== (entry.node_type === "absent")) {
    throw new TypeError("Only an absent entry can have absent Node Type.");
  }
  if (entry.sha256 !== null && !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new TypeError(
      "A Manifest SHA-256 value must contain 64 lowercase hexadecimal digits.",
    );
  }
  if (entry.state === "absent") {
    if (
      entry.size !== null ||
      entry.mtime_ns !== null ||
      entry.sha256 !== representationDigest("absent")
    ) {
      throw new TypeError("An absent entry has an invalid representation.");
    }
  } else if (entry.state === "value" && entry.mtime_ns === null) {
    throw new TypeError("An available Source node needs an mtime.");
  }
  if (
    entry.node_type === "file" &&
    entry.state === "value" &&
    entry.size === null
  ) {
    throw new TypeError("An available file needs a size.");
  }
  if (
    (entry.node_type === "dir" || entry.node_type === "socket") &&
    entry.state === "value" &&
    (entry.size !== null ||
      entry.sha256 !== representationDigest(entry.node_type))
  ) {
    throw new TypeError("A directory or socket has an invalid representation.");
  }
  if (
    entry.node_type === "symlink" &&
    entry.state === "value" &&
    (entry.link_target === null ||
      entry.size !== Buffer.byteLength(entry.link_target, "utf8") ||
      entry.sha256 !== representationDigest("symlink", entry.link_target))
  ) {
    throw new TypeError("An available symlink has an invalid representation.");
  }
  if (entry.node_type !== "symlink" && entry.link_target !== null) {
    throw new TypeError("Only a symlink can contain target text.");
  }
  if (
    entry.copied &&
    (entry.state !== "value" ||
      entry.node_type !== "file" ||
      (entry.selection_tier !== "tier_1" && entry.selection_tier !== "tier_2"))
  ) {
    throw new TypeError(
      "Only an available Tier 1 or Tier 2 file can be copied.",
    );
  }
  if (
    entry.unclassified !==
    (entry.selection_tier === "unclassified" &&
      (entry.file_kind === "unclassified" || entry.file_kind === "directory"))
  ) {
    throw new TypeError("The unclassified fields disagree.");
  }
}
