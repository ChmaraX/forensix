/**
 * Write-side safety of the Case commands, through the compiled CLI:
 *
 *  - `analyse` refuses a Case that a live `serve` holds (serve lock outside
 *    the Case Directory) and removes a stale lock whose owner is dead;
 *  - a failed `export` leaves no partial Extract, so a rerun succeeds;
 *  - a killed `ingest` leaves a staging directory (a full Working Copy) that
 *    the next ingest removes, while a live ingest's staging stays.
 *
 * Faults are injected with a `--import` preload in the CLI process
 * (`fs/promises` patched), so the CLI code under test is unchanged.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { acquireServeLock } from "../core/dist/serve-lock.js";
import {
  compiledCli,
  parseJson,
  runCli,
  writeLocalState,
  type CliResult,
} from "./lib/harness.js";

const temporaryRoots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "forensix-write-safety-")),
  );
  temporaryRoots.push(root);
  return root;
}

/** A Chrome User Data Dir with one Profile and three History visits. */
async function writeSource(root: string): Promise<string> {
  const source = join(root, "source");
  const historyPath = join(source, "Default", "History");
  await mkdir(dirname(historyPath), { recursive: true });
  await writeLocalState(source);
  const database = new DatabaseSync(historyPath);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
        visit_time INTEGER NOT NULL, from_visit INTEGER, external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL, segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER, originator_cache_guid TEXT, originator_visit_id INTEGER,
        originator_from_visit INTEGER, originator_opener_visit INTEGER,
        is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER, app_id TEXT
      );
      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES (1, 'https://alpha.example/', 'Alpha', 2, 0, 13348638245123456, 0),
             (2, 'https://beta.example/', 'Beta', 1, 0, 13348638345123456, 0);
      INSERT INTO visits (id, url, visit_time, transition, visit_duration)
      VALUES (1, 1, 13348638145123456, 1, 100),
             (2, 1, 13348638245123456, 1, 200),
             (3, 2, 13348638345123456, 0, 300);
    `);
  } finally {
    database.close();
  }
  return source;
}

async function ingest(root: string): Promise<string> {
  const source = await writeSource(root);
  const caseDirectory = join(root, "CASE");
  expect(
    runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
  ).toBe(0);
  return caseDirectory;
}

function analyse(caseDirectory: string): CliResult {
  return runCli([
    "analyse",
    "--case",
    caseDirectory,
    "--no-topic-classification",
    "--json",
  ]);
}

/** The serve lock path of a Case, as `serve` and `analyse` compute it. */
async function serveLockPath(caseDirectory: string): Promise<string> {
  const digest = createHash("sha256")
    .update(await realpath(caseDirectory))
    .digest("hex");
  return join(tmpdir(), `forensix-serve-${digest.slice(0, 16)}.lock`);
}

/** The PID of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  expect(child.status).toBe(0);
  return child.pid;
}

/**
 * Write an ESM preload that patches `fs/promises.writeFile`: when the CLI
 * writes a file whose name ends with `suffix`, the preload runs `action`.
 */
async function writePreload(
  root: string,
  name: string,
  suffix: string,
  action: string,
): Promise<string> {
  const path = join(root, `${name}.mjs`);
  await writeFile(
    path,
    `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const original = fs.writeFile;
fs.writeFile = async (path, ...rest) => {
  if (String(path).endsWith(${JSON.stringify(suffix)})) {
    ${action}
  }
  return original(path, ...rest);
};
syncBuiltinESMExports();
`,
  );
  return pathToFileURL(path).href;
}

function runCliWithPreload(
  preload: string,
  arguments_: readonly string[],
): CliResult & { readonly signal: NodeJS.Signals | null } {
  const result = spawnSync(
    process.execPath,
    ["--import", preload, compiledCli, ...arguments_],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function stagingDirectories(
  parent: string,
  name: string,
): Promise<string[]> {
  return (await readdir(parent))
    .filter((entry) => entry.startsWith(`${name}.tmp-`))
    .sort();
}

describe("analyse and the serve lock", () => {
  it("refuses a Case a live serve holds and ignores a stale lock", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    const lockPath = await serveLockPath(caseDirectory);

    // This test process takes the lock, as `serve` does on start.
    const lock = await acquireServeLock(caseDirectory);
    try {
      expect((await readFile(lockPath, "utf8")).trim()).toBe(
        String(process.pid),
      );
      // The lock never lives inside the Case Directory.
      expect(relative(caseDirectory, lockPath).startsWith("..")).toBe(true);
      expect(await readdir(caseDirectory)).not.toContain(
        lockPath.split(/[\\/]/).pop(),
      );

      const refused = analyse(caseDirectory);
      expect(refused.status).toBe(1);
      expect(parseJson<{ code: string }>(refused.stderr).code).toBe(
        "CASE_IN_USE",
      );
      // The refusal comes before any write: the Case has no Analysis Run.
      const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
        readOnly: true,
      });
      try {
        expect(
          database
            .prepare(
              "SELECT name FROM sqlite_master WHERE name = 'analysis_runs'",
            )
            .get(),
        ).toBeUndefined();
      } finally {
        database.close();
      }

      // A second serve on the same Case is refused too.
      await expect(acquireServeLock(caseDirectory)).rejects.toMatchObject({
        code: "CASE_IN_USE",
      });
    } finally {
      await lock.release();
    }
    expect(existsSync(lockPath)).toBe(false);

    // A serve that died without release leaves a stale lock.
    await writeFile(lockPath, `${deadPid()}\n`);
    const analysed = analyse(caseDirectory);
    expect(analysed.status).toBe(0);
    expect(parseJson<{ status: string }>(analysed.stdout).status).toBe("ok");
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("export after a failed write", () => {
  it("leaves no partial Extract and a rerun succeeds", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    expect(analyse(caseDirectory).status).toBe(0);
    const out = join(root, "extract");
    const failWrite = await writePreload(
      root,
      "fail-findings-write",
      "findings.jsonl",
      `throw Object.assign(new Error("injected write failure"), { code: "EIO" });`,
    );

    const failed = runCliWithPreload(failWrite, [
      "export",
      "--case",
      caseDirectory,
      "--out",
      out,
      "--json",
    ]);
    expect(failed.status).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(await stagingDirectories(root, "extract")).toEqual([]);

    const rerun = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      out,
      "--json",
    ]);
    expect(rerun.status).toBe(0);
    const files = (await readdir(out)).sort();
    expect(files).toContain("findings.jsonl");
    expect(files).toContain("export_manifest.json");
    const findings = (await readFile(join(out, "findings.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(findings.length).toBeGreaterThan(0);
    expect(await stagingDirectories(root, "extract")).toEqual([]);
  });

  it("writes into an existing empty --out", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    expect(analyse(caseDirectory).status).toBe(0);
    const out = join(root, "extract");
    await mkdir(out);

    expect(
      runCli(["export", "--case", caseDirectory, "--out", out, "--json"])
        .status,
    ).toBe(0);
    expect(await readdir(out)).toContain("export_header.json");
    expect(await stagingDirectories(root, "extract")).toEqual([]);
  });
});

describe("ingest staging left by a killed ingest", () => {
  it("removes a dead ingest's staging and keeps a live one", async () => {
    const root = await temporaryRoot();
    const source = await writeSource(root);
    const cases = join(root, "cases");
    const caseDirectory = join(cases, "CASE");
    const ready = join(root, "live-ingest-ready");
    // The Manifest header is written after the Working Copy is copied.
    const kill = await writePreload(
      root,
      "kill-ingest",
      "manifest_header.json",
      `process.kill(process.pid, "SIGKILL");`,
    );
    const hang = await writePreload(
      root,
      "hang-ingest",
      "manifest_header.json",
      `await original(${JSON.stringify(ready)}, "ready");
    setInterval(() => undefined, 1000);
    await new Promise(() => undefined);`,
    );

    // 1. An ingest killed mid-way leaves its staging: a full Working Copy.
    const killed = runCliWithPreload(kill, [
      "ingest",
      source,
      "--case",
      caseDirectory,
      "--json",
    ]);
    expect(killed.status === 0).toBe(false);
    const [dead] = await stagingDirectories(cases, "CASE");
    expect(dead).toBeDefined();
    expect(
      (await readdir(join(cases, dead as string), { recursive: true })).some(
        (entry) => entry.endsWith("History"),
      ),
    ).toBe(true);

    // 2. A second ingest of the same Case path is still running.
    const live = spawn(
      process.execPath,
      [
        "--import",
        hang,
        compiledCli,
        "ingest",
        source,
        "--case",
        caseDirectory,
      ],
      { stdio: "ignore" },
    );
    children.push(live);
    await expect.poll(() => existsSync(ready), { timeout: 15_000 }).toBe(true);
    const liveStaging = (await stagingDirectories(cases, "CASE")).filter(
      (entry) => entry !== dead,
    );
    expect(liveStaging).toHaveLength(1);

    // 3. A third ingest removes the dead staging, keeps the live one.
    const third = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
    expect(third.status).toBe(0);
    expect(await stagingDirectories(cases, "CASE")).toEqual(liveStaging);
    expect(existsSync(join(caseDirectory, "case.fxdb"))).toBe(true);
    // The Case holds what a clean ingest writes, and nothing more.
    const clean = join(root, "CLEAN");
    expect(runCli(["ingest", source, "--case", clean, "--json"]).status).toBe(
      0,
    );
    expect((await readdir(caseDirectory)).sort()).toEqual(
      (await readdir(clean)).sort(),
    );
  });
});
