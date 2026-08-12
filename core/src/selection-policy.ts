import { existsSync, readFileSync } from "node:fs";

import type { FileKind, NodeType, SelectionTier } from "./manifest.js";

interface PolicyArtifact {
  readonly path: string;
  readonly file_kind: Exclude<
    FileKind,
    "sidecar" | "bulk_data" | "ballast" | "directory" | "unclassified"
  >;
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

  const value: unknown = JSON.parse(readFileSync(contractUrl, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("schema" in value) ||
    value.schema !== "forensix/selection-policy/1" ||
    !("name" in value) ||
    value.name !== "chrome-userdata/1"
  ) {
    throw new Error(
      "The chrome-userdata/1 Selection Policy contract is invalid.",
    );
  }

  return value as SelectionPolicyContract;
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
