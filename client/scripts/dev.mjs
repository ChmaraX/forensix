/**
 * Dashboard dev loop: watch `client/src`, rebuild, restart the read-only
 * server, and let the open page reload itself.
 *
 * This is a local development aid only. It starts the same compiled analyzer
 * CLI the examiner would start by hand, with the same loopback bind, the same
 * per-run token, and the same read-only routes — it only automates the rebuild
 * and restart. It never writes to the Case.
 *
 *   node scripts/dev.mjs --case <case-directory> [--port 7788]
 */
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildClient } from "./bundle.mjs";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(clientRoot, "..");
const compiledCli = join(repositoryRoot, "cli", "dist", "cli.js");
const sourceDirectory = join(clientRoot, "src");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function fail(message) {
  console.error(`[forensix dev] ${message}`);
  process.exit(1);
}

const caseDirectory = option("case", undefined);
const port = option("port", "7788");

if (caseDirectory === undefined) {
  fail(
    "pass --case <case-directory>. Create one first with:\n" +
      "  node cli/dist/cli.js ingest <source> --case <case-directory>\n" +
      "  node cli/dist/cli.js analyse --case <case-directory>",
  );
}
if (!existsSync(resolve(caseDirectory))) {
  fail(`no such Case directory: ${resolve(caseDirectory)}`);
}
if (!existsSync(compiledCli)) {
  fail("the CLI is not built. Run `pnpm build` first.");
}

let server = null;

function stopServer() {
  if (server === null) {
    return;
  }
  const running = server;
  server = null;
  running.kill("SIGTERM");
}

function startServer() {
  server = spawn(
    process.execPath,
    [
      compiledCli,
      "serve",
      "--case",
      resolve(caseDirectory),
      "--port",
      String(port),
      "--json",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  server.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const announcement = JSON.parse(line);
        if (announcement.command === "serve") {
          console.log(`[forensix dev] ready → ${announcement.url}`);
          continue;
        }
      } catch {
        /* Not an announcement; pass it through. */
      }
      console.log(line);
    }
  });
}

let rebuilding = false;
let queued = false;

async function rebuild(reason) {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  const started = Date.now();
  try {
    await buildClient({ dev: true });
    stopServer();
    startServer();
    console.log(
      `[forensix dev] rebuilt in ${String(Date.now() - started)}ms (${reason})`,
    );
  } catch (error) {
    console.error(
      `[forensix dev] build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rebuilding = false;
    if (queued) {
      queued = false;
      void rebuild("queued change");
    }
  }
}

let debounce = null;
watch(sourceDirectory, { recursive: true }, (_event, filename) => {
  if (filename === null || filename === undefined) {
    return;
  }
  if (!/\.(tsx?|css)$/.test(filename)) {
    return;
  }
  if (debounce !== null) {
    clearTimeout(debounce);
  }
  debounce = setTimeout(() => {
    void rebuild(filename);
  }, 80);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopServer();
    process.exit(0);
  });
}

console.log(`[forensix dev] watching ${sourceDirectory}`);
await rebuild("first build");
