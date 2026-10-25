#!/usr/bin/env node
// Install the packed `forensix` tarball into an empty directory and smoke it.
//
//   node scripts/smoke-analyzer-package.mjs <tarball> --version <semver> [--git-sha <sha>]
//
// The install runs with `npm i --offline`, so it fails when the package needs
// anything that is not in the tarball. Then the INSTALLED `forensix` binary
// (never the workspace build) runs --version, skill get, ingest, analyse,
// history, and serve on a tiny seeded Chrome History, all offline. The Source
// must be byte-identical afterwards. Exit code 0 only when every check passes.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

import {
  createHistoryDatabase,
  writeLocalState,
} from "./lib/chrome-history-schema.mjs";

const isWindows = process.platform === "win32";

class SmokeFailure extends Error {}

function log(message) {
  process.stderr.write(`[smoke-analyzer-package] ${message}\n`);
}

/** GET a loopback URL; resolves with the status and the body length. */
function httpGet(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, (response) => {
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
      });
      response.on("end", () => {
        resolvePromise({ status: response.statusCode, length });
      });
    }).on("error", rejectPromise);
  });
}

function fail(message) {
  log(`FAIL: ${message}`);
  throw new SmokeFailure(message);
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
  log(`ok: ${message}`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const tarballArgument = process.argv[2];
const expectedVersion = option("--version");
const expectedSha = option("--git-sha");
if (tarballArgument === undefined || tarballArgument.startsWith("--")) {
  log("usage: <tarball> --version <semver> [--git-sha <sha>]");
  process.exit(1);
}
if (expectedVersion === undefined) {
  log("--version is required.");
  process.exit(1);
}
const tarball = resolve(tarballArgument);
const root = mkdtempSync(join(tmpdir(), "forensix-smoke-"));
const installDirectory = join(root, "install");
const bin = join(
  installDirectory,
  "node_modules",
  ".bin",
  isWindows ? "forensix.cmd" : "forensix",
);

function forensix(argv) {
  const result = spawnSync(bin, argv, {
    cwd: installDirectory,
    encoding: "utf8",
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function forensixJson(argv) {
  const result = forensix(argv);
  if (result.status !== 0) {
    fail(
      `forensix ${argv.join(" ")} exited ${String(result.status)}: ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

/** Start `forensix serve`, read its announcement, fetch the shell and client. */
async function smokeServe(caseDirectory) {
  const child = spawn(
    bin,
    ["serve", "--case", caseDirectory, "--port", "0", "--json"],
    {
      cwd: installDirectory,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const announcement = await new Promise((resolvePromise, rejectPromise) => {
      let buffer = "";
      const timer = setTimeout(() => {
        rejectPromise(new Error("serve did not announce in 15 s"));
      }, 15_000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline !== -1) {
          clearTimeout(timer);
          resolvePromise(JSON.parse(buffer.slice(0, newline)));
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        rejectPromise(new Error(`serve exited early with ${String(code)}`));
      });
    });
    const shell = await httpGet(announcement.url);
    check(shell.status === 200, "serve answers the dashboard shell");
    const client = await httpGet(new URL("index.js", announcement.url));
    check(
      client.status === 200 && client.length > 1000,
      "serve answers the bundled client from the installed package",
    );
  } finally {
    child.kill();
  }
}

try {
  // 1. Install into an empty directory, offline: the tarball must carry
  //    everything the analyzer needs at runtime.
  mkdirSync(installDirectory, { recursive: true });
  writeFileSync(
    join(installDirectory, "package.json"),
    '{ "name": "forensix-smoke", "private": true }\n',
  );
  const install = spawnSync(
    "npm",
    [
      "install",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      tarball,
    ],
    { cwd: installDirectory, encoding: "utf8", shell: isWindows },
  );
  check(
    install.status === 0,
    `npm install --offline of ${tarball} succeeds${install.status === 0 ? "" : `\n${install.stderr}`}`,
  );
  const installed = readdirSync(join(installDirectory, "node_modules")).filter(
    (entry) => !entry.startsWith("."),
  );
  check(
    installed.length === 1 && installed[0] === "forensix",
    `the install adds no third-party package (node_modules: ${installed.join(", ")})`,
  );

  // 2. Version stamp from the tag.
  const version = forensix(["--version"]);
  const expected =
    expectedSha === undefined
      ? `${expectedVersion}+`
      : `${expectedVersion}+${expectedSha}`;
  check(
    version.status === 0 && version.stdout.trim().startsWith(expected),
    `forensix --version prints ${expected}… (got ${version.stdout.trim()}${version.stderr})`,
  );

  // 3. The bundled agent skill.
  const skill = forensix(["skill", "get"]);
  check(
    skill.status === 0 && /^---\r?\nname: forensix\r?\n/.test(skill.stdout),
    `forensix skill get prints the bundled SKILL.md${skill.stderr}`,
  );

  // 4. ingest -> analyse -> history on a tiny seeded Chrome History.
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  writeLocalState(source);
  const historyFile = join(source, "Default", "History");
  createHistoryDatabase(historyFile, (database) => {
    database.exec(`
      INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES
        (1, 'https://alpha.example/', 'Alpha', 1, 1, 13348638245123456, 0),
        (2, 'https://beta.example/', 'Beta', 1, 0, 13348638305456000, 0);
      INSERT INTO visits (id, url, visit_time, from_visit, transition, visit_duration)
      VALUES
        (1, 1, 13348638245123456, 0, 268435457, 0),
        (2, 2, 13348638305456000, 1, 805306368, 0);
    `);
  });
  const sourceDigest = sha256(historyFile);
  const caseDirectory = join(root, "CASE");

  const ingest = forensixJson([
    "ingest",
    source,
    "--case",
    caseDirectory,
    "--json",
  ]);
  check(ingest.status === "ok", "forensix ingest creates a Case");

  const analyse = forensixJson([
    "analyse",
    "--case",
    caseDirectory,
    "--timezone",
    "UTC",
    "--json",
  ]);
  check(
    analyse.history?.committedVisitCount === 2 &&
      analyse.history?.recoveredVisitCount === 0,
    `forensix analyse reads 2 committed visits (got ${JSON.stringify(analyse.history)})`,
  );

  const history = forensixJson([
    "history",
    "--case",
    caseDirectory,
    "--view",
    "visits",
    "--sort",
    "visit-time",
    "--direction",
    "asc",
    "--json",
  ]);
  const urls = (history.items ?? []).map((item) => item.fields?.url?.value);
  check(
    JSON.stringify(urls) ===
      JSON.stringify(["https://alpha.example/", "https://beta.example/"]),
    `forensix history lists the seeded visits (got ${JSON.stringify(urls)})`,
  );

  // 5. The dashboard loads its client bundle from the installed package.
  await smokeServe(caseDirectory);

  check(sha256(historyFile) === sourceDigest, "the Source is not changed");
  log("PASS");
} catch (error) {
  process.exitCode = 1;
  if (!(error instanceof SmokeFailure)) {
    log(
      `FAIL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
} finally {
  rmSync(root, { force: true, recursive: true });
}
