/**
 * Mock dashboard development loop.
 *
 * Rebuilds the client bundle when source files change, while the design-only
 * mock API keeps serving the fixture data. The dev bundle polls /index.js and
 * reloads the open page after each rebuild.
 *
 * Usage:
 *   npm run mock:dev -- --port 7799 [--outdir <dir>]
 *
 * `--outdir` (or FORENSIX_CLIENT_OUTDIR) builds into, and serves from, a
 * directory other than dist/, so watchers on different ports don't collide.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  watch,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildClient, resolveOutDir } from "./bundle.mjs";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(clientRoot, "src");
const mockServer = join(clientRoot, "mock", "server.mjs");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = option("port", "7799");
const outDir = resolveOutDir(option("outdir", undefined));
// One watcher per output directory: the lock lives with the bundle it guards.
mkdirSync(outDir, { recursive: true });
const lockPath = join(outDir, ".mock-dev.lock");
let lockFd = null;

function acquireLock() {
  try {
    lockFd = openSync(lockPath, "wx");
    writeSync(lockFd, `${String(process.pid)}\n`);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    const owner = Number.parseInt(readFileSync(lockPath, "utf8"), 10);
    try {
      if (Number.isInteger(owner)) {
        process.kill(owner, 0);
      }
      throw new Error(
        `another mock-dev watcher is already running (pid ${String(owner)})`,
      );
    } catch (ownerError) {
      if (
        ownerError instanceof Error &&
        ownerError.message.includes("already running")
      ) {
        throw ownerError;
      }
      unlinkSync(lockPath);
      acquireLock();
    }
  }
}

function releaseLock() {
  if (lockFd === null) {
    return;
  }
  closeSync(lockFd);
  lockFd = null;
  try {
    unlinkSync(lockPath);
  } catch {
    /* The lock was already removed during stale-lock recovery. */
  }
}

acquireLock();
process.on("exit", releaseLock);

let server = null;
let rebuilding = false;
let queued = false;
let debounce = null;

function stopServer() {
  if (server === null) {
    return;
  }
  server.kill("SIGTERM");
  server = null;
}

function startServer() {
  const child = spawn(
    process.execPath,
    [mockServer, "--port", String(port), "--bundle", join(outDir, "index.js")],
    { cwd: clientRoot, stdio: "inherit" },
  );
  server = child;
  child.on("error", (error) => {
    console.error(`[forensix mock-dev] mock server failed: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (server !== child) {
      return;
    }
    server = null;
    console.error(
      `[forensix mock-dev] mock server stopped (code ${String(code)}, signal ${String(signal)})`,
    );
    process.exit(1);
  });
}

async function rebuild(reason) {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  const started = Date.now();
  try {
    await buildClient({ dev: true, outDir });
    console.log(
      `[forensix mock-dev] rebuilt in ${String(Date.now() - started)}ms (${reason})`,
    );
  } catch (error) {
    console.error(
      `[forensix mock-dev] build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rebuilding = false;
    if (queued) {
      queued = false;
      void rebuild("queued change");
    }
  }
}

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
    releaseLock();
    process.exit(0);
  });
}

await rebuild("first build");
startServer();
console.log(`[forensix mock-dev] watching ${sourceDirectory}`);
console.log(`[forensix mock-dev] open http://127.0.0.1:${port}`);
