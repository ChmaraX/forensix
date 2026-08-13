import { createHash } from "node:crypto";

export const MANIFEST_SCHEMA = "forensix/manifest/1" as const;
export const HASH_ALGORITHM = "sha-256" as const;

const MANIFEST_ENTRY_KEYS = [
  "path",
  "state",
  "unavailable_reason",
  "node_type",
  "file_kind",
  "selection_tier",
  "copied",
  "unclassified",
  "size",
  "mtime_ns",
  "hash_algorithm",
  "sha256",
  "link_target",
] as const;
const MANIFEST_HEADER_KEYS = [
  "manifest_schema",
  "source_kind",
  "selection_policy",
  "selection_policy_diff",
  "tier_2_included",
  "hash_algorithm",
  "evidence_set_digest",
  "working_copy_digest",
  "entry_count",
  "copied_entry_count",
  "profile_count",
  "unavailable_count",
  "unclassified_count",
] as const;

const MANIFEST_STATES = ["value", "absent", "unavailable"] as const;
const UNAVAILABLE_REASONS = [
  "permission_denied",
  "io_error",
  "changed_during_ingest",
  "parent_unavailable",
] as const;
const NODE_TYPES = ["file", "symlink", "socket", "dir", "absent"] as const;
const FILE_KINDS = [
  "database",
  "sidecar",
  "json",
  "image",
  "metadata",
  "liveness_evidence",
  "bulk_data",
  "ballast",
  "directory",
  "unclassified",
] as const;
const SELECTION_TIERS = ["tier_1", "tier_2", "tier_3", "unclassified"] as const;

export type ManifestState = (typeof MANIFEST_STATES)[number];
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];
export type NodeType = (typeof NODE_TYPES)[number];
export type FileKind = (typeof FILE_KINDS)[number];
export type SelectionTier = (typeof SELECTION_TIERS)[number];

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

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${name} has missing or unknown fields.`);
  }
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  return value === null ? null : stringValue(value, name);
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer.`);
  }
  return value as number;
}

function nullableNonnegativeInteger(
  value: unknown,
  name: string,
): number | null {
  return value === null ? null : nonnegativeInteger(value, name);
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  name: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${name} has an unsupported value.`);
  }
  return value as Values[number];
}

function exactValue<const Value extends string>(
  value: unknown,
  expected: Value,
  name: string,
): Value {
  if (value !== expected) {
    throw new TypeError(`${name} must be ${expected}.`);
  }
  return expected;
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

function assertManifestInvariants(entry: ManifestEntry): void {
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

export function decodeManifestEntry(value: unknown): ManifestEntry {
  const object = record(value, "Manifest entry");
  assertExactKeys(object, MANIFEST_ENTRY_KEYS, "Manifest entry");
  const reason =
    object.unavailable_reason === null
      ? null
      : enumValue(
          object.unavailable_reason,
          UNAVAILABLE_REASONS,
          "unavailable_reason",
        );
  const entry: ManifestEntry = {
    path: stringValue(object.path, "path"),
    state: enumValue(object.state, MANIFEST_STATES, "state"),
    unavailable_reason: reason,
    node_type: enumValue(object.node_type, NODE_TYPES, "node_type"),
    file_kind: enumValue(object.file_kind, FILE_KINDS, "file_kind"),
    selection_tier: enumValue(
      object.selection_tier,
      SELECTION_TIERS,
      "selection_tier",
    ),
    copied: booleanValue(object.copied, "copied"),
    unclassified: booleanValue(object.unclassified, "unclassified"),
    size: nullableNonnegativeInteger(object.size, "size"),
    mtime_ns: nullableString(object.mtime_ns, "mtime_ns"),
    hash_algorithm: exactValue(
      object.hash_algorithm,
      HASH_ALGORITHM,
      "hash_algorithm",
    ),
    sha256: nullableString(object.sha256, "sha256"),
    link_target: nullableString(object.link_target, "link_target"),
  };
  assertManifestInvariants(entry);
  return entry;
}

export function assertManifestEntry(entry: ManifestEntry): void {
  decodeManifestEntry(entry);
}

export function decodeManifestHeader(value: unknown): ManifestHeader {
  const object = record(value, "Manifest header");
  assertExactKeys(object, MANIFEST_HEADER_KEYS, "Manifest header");
  if (
    !Array.isArray(object.selection_policy_diff) ||
    object.selection_policy_diff.length !== 0
  ) {
    throw new TypeError("selection_policy_diff must be an empty array.");
  }
  const header: ManifestHeader = {
    manifest_schema: exactValue(
      object.manifest_schema,
      MANIFEST_SCHEMA,
      "manifest_schema",
    ),
    source_kind: exactValue(object.source_kind, "USER_DATA_DIR", "source_kind"),
    selection_policy: exactValue(
      object.selection_policy,
      "chrome-userdata/1",
      "selection_policy",
    ),
    selection_policy_diff: [],
    tier_2_included: booleanValue(object.tier_2_included, "tier_2_included"),
    hash_algorithm: exactValue(
      object.hash_algorithm,
      HASH_ALGORITHM,
      "hash_algorithm",
    ),
    evidence_set_digest: stringValue(
      object.evidence_set_digest,
      "evidence_set_digest",
    ),
    working_copy_digest: stringValue(
      object.working_copy_digest,
      "working_copy_digest",
    ),
    entry_count: nonnegativeInteger(object.entry_count, "entry_count"),
    copied_entry_count: nonnegativeInteger(
      object.copied_entry_count,
      "copied_entry_count",
    ),
    profile_count: nonnegativeInteger(object.profile_count, "profile_count"),
    unavailable_count: nonnegativeInteger(
      object.unavailable_count,
      "unavailable_count",
    ),
    unclassified_count: nonnegativeInteger(
      object.unclassified_count,
      "unclassified_count",
    ),
  };
  if (
    !/^[0-9a-f]{64}$/.test(header.evidence_set_digest) ||
    !/^[0-9a-f]{64}$/.test(header.working_copy_digest)
  ) {
    throw new TypeError("Manifest digests must be SHA-256 values.");
  }
  if (header.copied_entry_count > header.entry_count) {
    throw new TypeError("copied_entry_count cannot exceed entry_count.");
  }
  return header;
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
