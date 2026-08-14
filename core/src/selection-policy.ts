import { existsSync, readFileSync } from "node:fs";

import type { FileKind, NodeType, SelectionTier } from "./manifest.js";

type ArtifactKind = Exclude<
  FileKind,
  "sidecar" | "bulk_data" | "ballast" | "directory" | "unclassified"
>;

interface PolicyArtifact {
  readonly path: string;
  readonly file_kind: ArtifactKind;
  readonly expected: boolean;
}

interface SelectionPolicyContract {
  readonly schema: "forensix/selection-policy/1";
  readonly name: "chrome-userdata/1";
  readonly profile_directories: {
    readonly exact: readonly string[];
    readonly numbered_prefix: string;
    readonly numbered_minimum: number;
  };
  readonly sqlite_sidecar_suffixes: readonly string[];
  readonly browser_tier_1: readonly PolicyArtifact[];
  readonly profile_tier_1: readonly PolicyArtifact[];
  readonly profile_tier_2_roots: readonly string[];
  readonly browser_tier_3_roots: readonly string[];
  readonly browser_tier_3_globs: readonly string[];
  readonly profile_tier_3_roots: readonly string[];
}

export interface Selection {
  readonly tier: SelectionTier;
  readonly fileKind: FileKind;
  readonly unclassified: boolean;
}

export interface BrowserLevelEvidence {
  readonly path: string;
  readonly fileKind: FileKind;
}

const POLICY_KEYS = [
  "schema",
  "name",
  "profile_directories",
  "sqlite_sidecar_suffixes",
  "browser_tier_1",
  "profile_tier_1",
  "profile_tier_2_roots",
  "browser_tier_3_roots",
  "browser_tier_3_globs",
  "profile_tier_3_roots",
] as const;
const PROFILE_DIRECTORY_KEYS = [
  "exact",
  "numbered_prefix",
  "numbered_minimum",
] as const;
const ARTIFACT_KEYS = ["path", "file_kind", "expected"] as const;
const ARTIFACT_KINDS = [
  "database",
  "json",
  "image",
  "metadata",
  "liveness_evidence",
] as const satisfies readonly ArtifactKind[];

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${name} has missing or unknown fields.`);
  }
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty string.`);
  }
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array.`);
  }
  return value.map((item, index) => stringValue(item, `${name}[${index}]`));
}

function artifactArray(value: unknown, name: string): PolicyArtifact[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array.`);
  }
  return value.map((item, index) => {
    const object = objectValue(item, `${name}[${index}]`);
    exactKeys(object, ARTIFACT_KEYS, `${name}[${index}]`);
    const fileKind = object.file_kind;
    if (
      typeof fileKind !== "string" ||
      !ARTIFACT_KINDS.includes(fileKind as ArtifactKind)
    ) {
      throw new TypeError(`${name}[${index}].file_kind is unsupported.`);
    }
    if (typeof object.expected !== "boolean") {
      throw new TypeError(`${name}[${index}].expected must be a boolean.`);
    }
    return {
      path: stringValue(object.path, `${name}[${index}].path`),
      file_kind: fileKind as ArtifactKind,
      expected: object.expected,
    };
  });
}

function decodeSelectionPolicy(value: unknown): SelectionPolicyContract {
  const policy = objectValue(value, "Selection Policy");
  exactKeys(policy, POLICY_KEYS, "Selection Policy");
  if (policy.schema !== "forensix/selection-policy/1") {
    throw new TypeError("Selection Policy schema is unsupported.");
  }
  if (policy.name !== "chrome-userdata/1") {
    throw new TypeError("Selection Policy name is unsupported.");
  }

  const profileDirectories = objectValue(
    policy.profile_directories,
    "profile_directories",
  );
  exactKeys(profileDirectories, PROFILE_DIRECTORY_KEYS, "profile_directories");
  const numberedMinimum = profileDirectories.numbered_minimum;
  if (
    !Number.isSafeInteger(numberedMinimum) ||
    (numberedMinimum as number) < 1
  ) {
    throw new TypeError("numbered_minimum must be a positive integer.");
  }

  return {
    schema: "forensix/selection-policy/1",
    name: "chrome-userdata/1",
    profile_directories: {
      exact: stringArray(profileDirectories.exact, "profile_directories.exact"),
      numbered_prefix: stringValue(
        profileDirectories.numbered_prefix,
        "profile_directories.numbered_prefix",
      ),
      numbered_minimum: numberedMinimum as number,
    },
    sqlite_sidecar_suffixes: stringArray(
      policy.sqlite_sidecar_suffixes,
      "sqlite_sidecar_suffixes",
    ),
    browser_tier_1: artifactArray(policy.browser_tier_1, "browser_tier_1"),
    profile_tier_1: artifactArray(policy.profile_tier_1, "profile_tier_1"),
    profile_tier_2_roots: stringArray(
      policy.profile_tier_2_roots,
      "profile_tier_2_roots",
    ),
    browser_tier_3_roots: stringArray(
      policy.browser_tier_3_roots,
      "browser_tier_3_roots",
    ),
    browser_tier_3_globs: stringArray(
      policy.browser_tier_3_globs,
      "browser_tier_3_globs",
    ),
    profile_tier_3_roots: stringArray(
      policy.profile_tier_3_roots,
      "profile_tier_3_roots",
    ),
  };
}

function loadSelectionPolicy(): SelectionPolicyContract {
  const candidates = [
    new URL(
      "./contracts/selection-policy.chrome-userdata-1.json",
      import.meta.url,
    ),
    new URL(
      "../../contracts/selection-policy.chrome-userdata-1.json",
      import.meta.url,
    ),
  ];
  const contractUrl = candidates.find((candidate) => existsSync(candidate));
  if (contractUrl === undefined) {
    throw new Error(
      "The chrome-userdata/1 Selection Policy contract is missing.",
    );
  }

  return decodeSelectionPolicy(JSON.parse(readFileSync(contractUrl, "utf8")));
}

export const CHROME_USERDATA_POLICY = loadSelectionPolicy();

export function isProfileDirectoryName(name: string): boolean {
  const profileRule = CHROME_USERDATA_POLICY.profile_directories;
  if (profileRule.exact.includes(name)) {
    return true;
  }
  if (!name.startsWith(profileRule.numbered_prefix)) {
    return false;
  }

  const suffix = name.slice(profileRule.numbered_prefix.length);
  return (
    /^(?:0|[1-9][0-9]*)$/.test(suffix) &&
    Number(suffix) >= profileRule.numbered_minimum
  );
}

function pathIsWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isAncestorOf(path: string, candidate: string): boolean {
  return candidate.startsWith(`${path}/`);
}

function globMatches(value: string, glob: string): boolean {
  const wildcard = glob.indexOf("*");
  if (wildcard === -1) {
    return value === glob;
  }
  const prefix = glob.slice(0, wildcard);
  const suffix = glob.slice(wildcard + 1);
  return value.startsWith(prefix) && value.endsWith(suffix);
}

function kindForNode(nodeType: NodeType, selectedKind: FileKind): FileKind {
  return nodeType === "dir" ? "directory" : selectedKind;
}

function selected(
  tier: SelectionTier,
  fileKind: FileKind,
  nodeType: NodeType,
): Selection {
  return {
    tier,
    fileKind: kindForNode(nodeType, fileKind),
    unclassified: false,
  };
}

function unclassified(nodeType: NodeType): Selection {
  return {
    tier: "unclassified",
    fileKind: nodeType === "dir" ? "directory" : "unclassified",
    unclassified: true,
  };
}

function tierOneArtifact(
  relativePath: string,
  artifacts: readonly PolicyArtifact[],
): PolicyArtifact | undefined {
  return artifacts.find((artifact) => artifact.path === relativePath);
}

function sidecarBase(
  relativePath: string,
  artifacts: readonly PolicyArtifact[],
): PolicyArtifact | undefined {
  for (const suffix of CHROME_USERDATA_POLICY.sqlite_sidecar_suffixes) {
    if (!relativePath.endsWith(suffix)) {
      continue;
    }
    const base = relativePath.slice(0, -suffix.length);
    const artifact = tierOneArtifact(base, artifacts);
    if (artifact?.file_kind === "database") {
      return artifact;
    }
  }
  return undefined;
}

export function classifySourcePath(
  path: string,
  nodeType: NodeType,
): Selection {
  const parts = path.split("/");
  const first = parts[0];
  if (first === undefined) {
    return unclassified(nodeType);
  }

  const browserArtifact = tierOneArtifact(
    path,
    CHROME_USERDATA_POLICY.browser_tier_1,
  );
  if (browserArtifact !== undefined) {
    return selected("tier_1", browserArtifact.file_kind, nodeType);
  }

  const browserTierThree = CHROME_USERDATA_POLICY.browser_tier_3_roots.some(
    (root) => pathIsWithin(path, root),
  );
  if (
    browserTierThree ||
    CHROME_USERDATA_POLICY.browser_tier_3_globs.some((glob) =>
      globMatches(path, glob),
    )
  ) {
    return selected("tier_3", "ballast", nodeType);
  }

  if (!isProfileDirectoryName(first)) {
    return unclassified(nodeType);
  }
  if (parts.length === 1) {
    return selected("tier_1", "directory", nodeType);
  }

  const profilePath = parts.slice(1).join("/");
  const profileArtifact = tierOneArtifact(
    profilePath,
    CHROME_USERDATA_POLICY.profile_tier_1,
  );
  if (profileArtifact !== undefined) {
    return selected("tier_1", profileArtifact.file_kind, nodeType);
  }
  if (
    sidecarBase(profilePath, CHROME_USERDATA_POLICY.profile_tier_1) !==
    undefined
  ) {
    return selected("tier_1", "sidecar", nodeType);
  }
  if (
    CHROME_USERDATA_POLICY.profile_tier_1.some((artifact) =>
      isAncestorOf(profilePath, artifact.path),
    )
  ) {
    return selected("tier_1", "directory", nodeType);
  }
  if (
    CHROME_USERDATA_POLICY.profile_tier_2_roots.some((root) =>
      pathIsWithin(profilePath, root),
    )
  ) {
    return selected("tier_2", "bulk_data", nodeType);
  }
  if (
    CHROME_USERDATA_POLICY.profile_tier_3_roots.some((root) =>
      pathIsWithin(profilePath, root),
    )
  ) {
    return selected("tier_3", "ballast", nodeType);
  }

  return unclassified(nodeType);
}

export function classifyProfileSourcePath(
  path: string,
  nodeType: NodeType,
): Selection {
  return classifySourcePath(`Default/${path}`, nodeType);
}

export function browserLevelEvidence(): readonly BrowserLevelEvidence[] {
  return CHROME_USERDATA_POLICY.browser_tier_1.map((artifact) => ({
    path: artifact.path,
    fileKind: artifact.file_kind,
  }));
}

export function expectedProfileTierOnePaths(): string[] {
  const expected: string[] = [];
  for (const artifact of CHROME_USERDATA_POLICY.profile_tier_1) {
    if (!artifact.expected) {
      continue;
    }
    expected.push(artifact.path);
    if (artifact.file_kind === "database") {
      for (const suffix of CHROME_USERDATA_POLICY.sqlite_sidecar_suffixes) {
        expected.push(`${artifact.path}${suffix}`);
      }
    }
  }
  return expected;
}

export function expectedTierOnePaths(
  profilePaths: readonly string[],
): string[] {
  const expected = CHROME_USERDATA_POLICY.browser_tier_1
    .filter((artifact) => artifact.expected)
    .map((artifact) => artifact.path);

  for (const profilePath of profilePaths) {
    for (const artifact of CHROME_USERDATA_POLICY.profile_tier_1) {
      if (!artifact.expected) {
        continue;
      }
      const artifactPath = `${profilePath}/${artifact.path}`;
      expected.push(artifactPath);
      if (artifact.file_kind === "database") {
        for (const suffix of CHROME_USERDATA_POLICY.sqlite_sidecar_suffixes) {
          expected.push(`${artifactPath}${suffix}`);
        }
      }
    }
  }

  return expected;
}
