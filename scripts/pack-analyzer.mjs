#!/usr/bin/env node
// Pack the analyzer as ONE self-contained npm package, `forensix`.
//
//   node scripts/pack-analyzer.mjs --version <semver> [--git-sha <sha>] [--out <dir>]
//
// Run `pnpm build` first. The workspace packages (@forensix/core, server,
// client, cli) stay private and are never published on their own. This script
// stages a package whose `dist/` is the compiled CLI (with the bundled agent
// skill at dist/skill/forensix) and whose core, server, and client builds ship
// inside the tarball as bundled dependencies (node_modules/@forensix/*). The
// compiled code then resolves `@forensix/*` exactly as in the workspace, with
// no source change. The analyzer has no third-party runtime dependency: core
// uses node:sqlite and the client is one prebuilt index.js, so the installed
// package needs no network.
//
// The version comes from the caller (the release tag) and goes into the
// package.json of every staged package and into dist/build-info.json, which
// `forensix --version` reports as `<version>+<gitSha>`.
//
// Output: one JSON line on stdout with the tarball path, name, version, size,
// and file count.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "forensix";
const REPOSITORY_URL = "git+https://github.com/ChmaraX/forensix.git";
const BUNDLED = ["core", "server", "client"];
// Semantic Versioning 2.0.0, without build metadata (npm drops it).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  process.stderr.write(`[pack-analyzer] ${message}\n`);
  process.exit(1);
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    fail(`${name} needs a value.`);
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function headSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

/** Copy compiled output only: no type declarations, source maps, or tsc state. */
function copyDist(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (path) =>
      !/\.(d\.ts|d\.ts\.map|js\.map|tsbuildinfo)$/.test(path) &&
      basename(path) !== "build-info.json",
  });
}

const version = option("--version");
if (version === undefined || !SEMVER.test(version)) {
  fail(`--version must be a SemVer version, got ${String(version)}.`);
}
const gitSha = option("--git-sha") ?? headSha();
const outDir = resolve(option("--out") ?? join(REPO_ROOT, "dist", "analyzer"));

const required = [
  "cli/dist/cli.js",
  "cli/dist/skill/forensix/SKILL.md",
  "core/dist/index.js",
  "core/dist/contracts/selection-policy.chrome-userdata-1.json",
  "server/dist/index.js",
  "client/dist/index.js",
];
for (const path of required) {
  if (!existsSync(join(REPO_ROOT, path))) {
    fail(`${path} is missing. Run \`pnpm build\` first.`);
  }
}

const cliManifest = readJson(join(REPO_ROOT, "cli", "package.json"));
const rootManifest = readJson(join(REPO_ROOT, "package.json"));
const stageRoot = mkdtempSync(join(tmpdir(), "forensix-pack-"));
const stage = join(stageRoot, "package");

try {
  mkdirSync(stage, { recursive: true });
  copyDist(join(REPO_ROOT, "cli", "dist"), join(stage, "dist"));
  writeJson(join(stage, "dist", "build-info.json"), { version, gitSha });
  cpSync(join(REPO_ROOT, "README.md"), join(stage, "README.md"));
  cpSync(join(REPO_ROOT, "LICENSE"), join(stage, "LICENSE"));

  const bundledNames = [];
  for (const workspace of BUNDLED) {
    const manifest = readJson(join(REPO_ROOT, workspace, "package.json"));
    const target = join(stage, "node_modules", ...manifest.name.split("/"));
    mkdirSync(target, { recursive: true });
    copyDist(join(REPO_ROOT, workspace, "dist"), join(target, "dist"));
    // Only the fields that module resolution needs. No dependencies: the
    // bundled packages resolve each other as siblings, and the client is a
    // prebuilt bundle with its React dependencies inlined.
    writeJson(join(target, "package.json"), {
      name: manifest.name,
      version,
      license: "MIT",
      type: manifest.type,
      ...(manifest.main === undefined ? {} : { main: manifest.main }),
      exports: manifest.exports,
      engines: manifest.engines,
    });
    bundledNames.push(manifest.name);
  }

  writeJson(join(stage, "package.json"), {
    name: PACKAGE_NAME,
    version,
    description: rootManifest.description,
    keywords: ["forensics", "chrome", "dfir", "browser-history", "offline"],
    license: "MIT",
    homepage: "https://github.com/ChmaraX/forensix#readme",
    repository: { type: "git", url: REPOSITORY_URL },
    bugs: { url: "https://github.com/ChmaraX/forensix/issues" },
    type: "module",
    bin: { forensix: "dist/cli.js" },
    engines: cliManifest.engines,
    files: ["dist"],
    dependencies: Object.fromEntries(
      bundledNames.map((name) => [name, version]),
    ),
    bundleDependencies: bundledNames,
  });

  mkdirSync(outDir, { recursive: true });
  const pack = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", outDir],
    {
      cwd: stage,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (pack.status !== 0) {
    fail(`npm pack failed:\n${pack.stderr}`);
  }
  const [packed] = JSON.parse(pack.stdout);
  const tarball = join(outDir, packed.filename);
  process.stdout.write(
    `${JSON.stringify({
      tarball,
      name: packed.name,
      version: packed.version,
      gitSha,
      size: statSync(tarball).size,
      unpackedSize: packed.unpackedSize,
      entryCount: packed.entryCount,
    })}\n`,
  );
} finally {
  rmSync(stageRoot, { force: true, recursive: true });
}
