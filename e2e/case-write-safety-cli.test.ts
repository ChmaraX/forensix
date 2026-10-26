/**
 * Write-side safety of the Case commands, through the compiled CLI:
 *
 *  - `analyse` and `serve` exclude each other through one Case lock outside
 *    the Case Directory; a killed holder does not block the Case, and only
 *    one of many parallel contenders wins the lock;
 *  - a failed `export` leaves no partial Extract, so a rerun succeeds;
 *  - a killed `ingest` leaves a staging directory (a full Working Copy) that
 *    the next ingest removes, while a live ingest's staging stays.
 *
 * Faults are injected with a `--import` preload in the CLI process
 * (`fs/promises` patched), so the CLI code under test is unchanged.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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

import { acquireCaseLock } from "../core/dist/case-lock.js";
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

/** The Case lock files of a Case, as `serve` and `analyse` name them. */
async function caseLockFiles(caseDirectory: string): Promise<string[]> {
  const digest = createHash("sha256")
    .update(await realpath(caseDirectory))
    .digest("hex");
  const prefix = `forensix-case-${digest.slice(0, 16)}.lock`;
  return (await readdir(tmpdir()))
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(tmpdir(), name))
    .sort();
}

/**
 * Write a script that takes the Case lock as `serve` and prints `won` or the
 * error code. The winner holds the lock until its stdin ends. With `die`, it
 * is killed while it holds the lock.
 */
async function writeContender(
  root: string,
  caseDirectory: string,
): Promise<string> {
  const path = join(root, "contender.mjs");
  const caseLock = pathToFileURL(
    join(import.meta.dirname, "..", "core", "dist", "case-lock.js"),
  ).href;
  await writeFile(
    path,
    `import { acquireCaseLock } from ${JSON.stringify(caseLock)};
const [mode, start] = process.argv.slice(2);
while (Date.now() < Number(start ?? 0)) {}
try {
  await acquireCaseLock(${JSON.stringify(caseDirectory)}, "serve");
  if (mode === "die") process.kill(process.pid, "SIGKILL");
  process.stdout.write("won\\n");
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} catch (error) {
  process.stdout.write(String(error.code ?? error.message) + "\\n");
}
`,
  );
  return path;
}

/** Kill a holder while it holds the Case lock. */
function leaveStaleLock(contender: string): void {
  const killed = spawnSync(process.execPath, [contender, "die"], {
    encoding: "utf8",
  });
  // It took the lock, then died before it printed "won". On Windows a
  // killed process has an exit status, not a signal.
  expect(killed.stdout).toBe("");
  expect(killed.signal === "SIGKILL" || killed.status !== 0).toBe(true);
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

interface CaseInUse {
  readonly code: string;
  readonly details: { readonly holder: string; readonly pid: number };
}

/** Run `serve` of a Case; a serve that is not refused is stopped after 15 s. */
function serve(caseDirectory: string): CliResult {
  const result = spawnSync(
    process.execPath,
    [compiledCli, "serve", "--case", caseDirectory, "--port", "0", "--json"],
    { encoding: "utf8", timeout: 15_000 },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("the Case lock of analyse and serve", () => {
  it("refuses analyse and a second serve while serve holds the Case, and a killed holder does not block it", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);

    // This test process takes the lock, as `serve` does on start.
    const lock = await acquireCaseLock(caseDirectory, "serve");
    try {
      const [lockFile, holderFile, ...others] =
        await caseLockFiles(caseDirectory);
      expect(others).toEqual([]);
      expect(holderFile).toBe(`${lockFile as string}.holder.json`);
      expect(JSON.parse(await readFile(holderFile as string, "utf8"))).toEqual({
        holder: "serve",
        pid: process.pid,
      });
      // The lock never lives inside the Case Directory.
      expect(relative(caseDirectory, lockFile as string).startsWith("..")).toBe(
        true,
      );

      const refused = analyse(caseDirectory);
      expect(refused.status).toBe(1);
      expect(parseJson<CaseInUse>(refused.stderr)).toMatchObject({
        code: "CASE_IN_USE",
        details: { holder: "serve", pid: process.pid, lockPath: lockFile },
      });
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
      await expect(
        acquireCaseLock(caseDirectory, "serve"),
      ).rejects.toMatchObject({ code: "CASE_IN_USE" });
    } finally {
      await lock.release();
    }
    expect(analyse(caseDirectory).status).toBe(0);

    // A serve killed while it holds the lock does not block the Case: the
    // operating system releases its lock when the process ends.
    leaveStaleLock(await writeContender(root, caseDirectory));
    const analysed = analyse(caseDirectory);
    expect(analysed.status).toBe(0);
    expect(parseJson<{ status: string }>(analysed.stdout).status).toBe("ok");
  });

  it("refuses serve while analyse holds the Case", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    const lock = await acquireCaseLock(caseDirectory, "analyse");
    try {
      const refused = serve(caseDirectory);
      expect(refused.status).toBe(1);
      expect(parseJson<CaseInUse>(refused.stderr)).toMatchObject({
        code: "CASE_IN_USE",
        details: { holder: "analyse", pid: process.pid },
      });
      // A second analyse is refused the same way.
      expect(parseJson<CaseInUse>(analyse(caseDirectory).stderr)).toMatchObject(
        { code: "CASE_IN_USE", details: { holder: "analyse" } },
      );
    } finally {
      await lock.release();
    }
  });

  it("holds the lock for the whole analyse run", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    const ready = join(root, "analyse-storing");
    // Stop analyse where it starts to store the run: after every parser ran.
    const preload = join(root, "hang-analyse.mjs");
    await writeFile(
      preload,
      `import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const original = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (String(sql).startsWith("BEGIN IMMEDIATE")) {
    writeFileSync(${JSON.stringify(ready)}, "ready");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
  }
  return original.call(this, sql);
};
`,
    );
    const running = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(preload).href,
        compiledCli,
        "analyse",
        "--case",
        caseDirectory,
        "--no-topic-classification",
        "--json",
      ],
      { stdio: "ignore" },
    );
    children.push(running);
    await expect.poll(() => existsSync(ready), { timeout: 15_000 }).toBe(true);

    const refused = serve(caseDirectory);
    expect(refused.status).toBe(1);
    expect(parseJson<CaseInUse>(refused.stderr)).toMatchObject({
      code: "CASE_IN_USE",
      details: { holder: "analyse", pid: running.pid },
    });

    // A killed analyse does not block the Case: its lock ends with it.
    running.kill("SIGKILL");
    await once(running, "exit");
    const lock = await acquireCaseLock(caseDirectory, "serve");
    await lock.release();
  });

  it("lets exactly one of many parallel contenders take the lock after a killed holder", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    const contender = await writeContender(root, caseDirectory);
    for (let round = 0; round < 10; round += 1) {
      leaveStaleLock(contender);
      // All contenders start at the same time, after their start-up.
      const start = String(Date.now() + 500);
      const contenders = Array.from({ length: 8 }, () => {
        const child = spawn(process.execPath, [contender, "race", start], {
          stdio: ["pipe", "pipe", "inherit"],
        });
        children.push(child);
        return child;
      });
      const outcomes = await Promise.all(
        contenders.map(
          (child) =>
            new Promise<string>((resolvePromise) => {
              let output = "";
              child.stdout?.on("data", (chunk: Buffer) => {
                output += chunk.toString("utf8");
                if (output.includes("\n")) resolvePromise(output.trim());
              });
              child.on("exit", () => {
                resolvePromise(output.trim());
              });
            }),
        ),
      );
      for (const child of contenders) child.stdin?.end();
      await Promise.all(
        contenders.map((child) =>
          child.exitCode === null ? once(child, "exit") : undefined,
        ),
      );
      expect(outcomes.filter((outcome) => outcome === "won")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome !== "won")).toEqual(
        Array.from({ length: 7 }, () => "CASE_IN_USE"),
      );
      // One lock database and its holder note; no other lock files.
      expect(await caseLockFiles(caseDirectory)).toHaveLength(2);
    }
  }, 60_000);
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

  it("keeps an existing empty --out when the publish rename fails", async () => {
    const root = await temporaryRoot();
    const caseDirectory = await ingest(root);
    expect(analyse(caseDirectory).status).toBe(0);
    const out = join(root, "extract");
    await mkdir(out);
    // Fail the rename that publishes the staging directory as --out.
    const preload = join(root, "fail-publish.mjs");
    await writeFile(
      preload,
      `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const original = fs.rename;
fs.rename = async (from, to, ...rest) => {
  if (String(to) === ${JSON.stringify(out)}) {
    throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
  }
  return original(from, to, ...rest);
};
syncBuiltinESMExports();
`,
    );

    const failed = runCliWithPreload(pathToFileURL(preload).href, [
      "export",
      "--case",
      caseDirectory,
      "--out",
      out,
      "--json",
    ]);
    expect(failed.status).toBe(1);
    expect(await readdir(out)).toEqual([]);
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

    // Staging without a ForensiX owner record, or with a foreign one, is
    // never removed: it may not be ForensiX's.
    const unmarked = join(cases, "CASE.tmp-unmarked");
    const foreign = join(cases, "CASE.tmp-foreign");
    await mkdir(unmarked);
    await mkdir(foreign);
    await writeFile(join(foreign, ".forensix-owner"), `${deadPid()}\n`);

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
      (entry) =>
        entry !== dead &&
        entry !== "CASE.tmp-unmarked" &&
        entry !== "CASE.tmp-foreign",
    );
    expect(liveStaging).toHaveLength(1);

    // 3. A third ingest removes the dead staging, keeps the live one.
    const third = runCli(["ingest", source, "--case", caseDirectory, "--json"]);
    expect(third.status).toBe(0);
    expect(await stagingDirectories(cases, "CASE")).toEqual(
      ["CASE.tmp-foreign", "CASE.tmp-unmarked", ...liveStaging].sort(),
    );
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
