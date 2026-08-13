import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

import { filesystemErrorCode } from "./acquisition.js";
import { isProfileDirectoryName } from "./selection-policy.js";

export interface DiscoveredChromeSource {
  readonly path: string;
  readonly shape: "USER_DATA_DIR" | "PROFILE_DIR";
}

export interface SourceDiscoveryResult {
  readonly sources: readonly DiscoveredChromeSource[];
  readonly unavailablePaths: readonly string[];
}

const PROFILE_MARKERS = new Set([
  "History",
  "Favicons",
  "Top Sites",
  "Preferences",
  "Secure Preferences",
  "Bookmarks",
  "Login Data",
  "Web Data",
  "Network",
]);

function byteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function isPhysicalDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path, { bigint: true });
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function discoverChromeSources(
  root: string,
): Promise<SourceDiscoveryResult> {
  const sources: DiscoveredChromeSource[] = [];
  const unavailablePaths: string[] = [];

  async function walk(directory: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      unavailablePaths.push(
        `${directory}:${filesystemErrorCode(error) ?? "io_error"}`,
      );
      return;
    }
    names.sort(byteOrder);

    const hasLocalState = names.includes("Local State");
    const profileDirectories: string[] = [];
    for (const name of names) {
      if (
        isProfileDirectoryName(name) &&
        (await isPhysicalDirectory(join(directory, name)))
      ) {
        profileDirectories.push(name);
      }
    }

    if (hasLocalState && profileDirectories.length > 0) {
      sources.push({ path: await realpath(directory), shape: "USER_DATA_DIR" });
      return;
    }

    if (
      isProfileDirectoryName(basename(directory)) &&
      names.some((name) => PROFILE_MARKERS.has(name))
    ) {
      sources.push({ path: await realpath(directory), shape: "PROFILE_DIR" });
      return;
    }

    for (const name of names) {
      const child = join(directory, name);
      if (await isPhysicalDirectory(child)) {
        await walk(child);
      }
    }
  }

  await walk(root);
  sources.sort((left, right) => byteOrder(left.path, right.path));
  unavailablePaths.sort(byteOrder);
  return { sources, unavailablePaths };
}
