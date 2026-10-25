/**
 * The hash-chained audit log of the compiled CLI (`--audit-log` and
 * `FORENSIX_AUDIT_LOG`) and `forensix audit verify`.
 *
 * Failure modes covered: parallel writers racing for the chain head, a writer
 * that died holding the lock, an edited / deleted / reordered / cut line, an
 * entry rehashed after an edit (breaks the next link), appending onto a
 * damaged log, and the printed stamp versus the logged output hash.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDashboardCase } from "./lib/dashboard-case.js";
import {
  compiledCli,
  parseJson,
  runCli,
  type CliResult,
} from "./lib/harness.js";

interface AuditEntry {
  readonly version: number;
  readonly seq: number;
  readonly id: string;
  readonly time: string;
  readonly toolVersion: string;
  readonly command: string | null;
  readonly argv: readonly string[];
  readonly caseDirectory: string | null;
  readonly exitCode: number;
  readonly outputSha256: string;
  readonly prevHash: string;
  readonly hash: string;
}

interface Stamp {
  readonly id: string;
  readonly entryHash: string;
}

interface Verification {
  readonly status: string;
  readonly command: string;
  readonly entries: number;
  readonly valid: boolean;
  readonly brokenSeq?: number;
  readonly reason?: string;
  readonly lastHash?: string;
}

let root: string;
let caseDirectory: string;
let logCounter = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forensix-audit-"));
  caseDirectory = await buildDashboardCase(root);
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function freshLog(): string {
  logCounter += 1;
  return join(root, `audit-${String(logCounter)}.ndjson`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The printed output with the `audit` key taken off each line. */
function withoutStamps(output: string): string {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const entries = Object.entries(
        JSON.parse(line) as Record<string, unknown>,
      ).filter(([key]) => key !== "audit");
      return `${JSON.stringify(Object.fromEntries(entries))}\n`;
    })
    .join("");
}

function stampsOf(output: string): Stamp[] {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { readonly audit: Stamp }).audit);
}

async function entries(log: string): Promise<AuditEntry[]> {
  return (await readFile(log, "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as AuditEntry);
}

function verify(log: string): { result: CliResult; body: Verification } {
  const result = runCli(["audit", "verify", "--log", log]);
  return { result, body: parseJson<Verification>(result.stdout) };
}

function runWithEnvironment(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runAsync(arguments_: readonly string[]): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [compiledCli, ...arguments_]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

/** Writes a session of four commands to a fresh log and returns it. */
function writeSession(log: string): CliResult[] {
  return [
    runCli(["profiles", "--case", caseDirectory, "--audit-log", log]),
    runCli([
      "history",
      "--case",
      caseDirectory,
      "--limit",
      "100",
      "--page-all",
      "--fields",
      "url",
      "--audit-log",
      log,
    ]),
    runCli([
      "cookies",
      "--case",
      join(root, "no-such-case"),
      "--audit-log",
      log,
    ]),
    runWithEnvironment(["completeness", "--case", caseDirectory], {
      FORENSIX_AUDIT_LOG: log,
    }),
  ];
}

describe("audit log entries", () => {
  it("chains one entry per command and stamps each output with it", async () => {
    const log = freshLog();
    const results = writeSession(log);
    const [profiles, pages, missing, completeness] = results;
    expect(results.map((result) => result.status)).toEqual([0, 0, 1, 0]);
    const logged = await entries(log);
    expect(logged.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(logged.map((entry) => entry.command)).toEqual([
      "profiles",
      "history",
      "cookies",
      "completeness",
    ]);
    expect(logged.map((entry) => entry.exitCode)).toEqual([0, 0, 1, 0]);
    expect(logged[0]?.prevHash).toBe("0".repeat(64));
    for (const [index, entry] of logged.entries()) {
      expect(entry.version).toBe(1);
      expect(entry.caseDirectory).toBe(
        index === 2 ? join(root, "no-such-case") : caseDirectory,
      );
      if (index > 0) {
        expect(entry.prevHash).toBe(logged[index - 1]?.hash);
      }
    }
    expect(logged[1]?.argv).toEqual([
      "history",
      "--case",
      caseDirectory,
      "--limit",
      "100",
      "--page-all",
      "--fields",
      "url",
      "--audit-log",
      log,
    ]);

    // Every printed line carries the stamp of its entry; the entry's output
    // hash covers the printed text without the stamps.
    const printed: readonly (readonly [string, AuditEntry | undefined])[] = [
      [profiles?.stdout ?? "", logged[0]],
      [pages?.stdout ?? "", logged[1]],
      [missing?.stderr ?? "", logged[2]],
      [completeness?.stdout ?? "", logged[3]],
    ];
    for (const [output, entry] of printed) {
      const stamps = stampsOf(output);
      expect(stamps.length).toBeGreaterThan(0);
      for (const stamp of stamps) {
        expect(stamp).toEqual({ id: entry?.id, entryHash: entry?.hash });
      }
      expect(sha256(withoutStamps(output))).toBe(entry?.outputSha256);
    }
    // The page-all output is three pages (300 visits at --limit 100), all
    // under one entry.
    expect(stampsOf(pages?.stdout ?? "")).toHaveLength(3);
    expect(missing?.stdout).toBe("");
    expect(parseJson<{ code: string }>(missing?.stderr ?? "").code).toBe(
      "CASE_NOT_FOUND",
    );

    const { result, body } = verify(log);
    expect(result.status).toBe(0);
    expect(body).toMatchObject({
      status: "ok",
      command: "audit-verify",
      entries: 4,
      valid: true,
      lastHash: logged[3]?.hash,
    });
  });

  it("serializes parallel writers into one unbroken chain", async () => {
    const log = freshLog();
    const writers = 12;
    const results = await Promise.all(
      Array.from({ length: writers }, (_, index) =>
        runAsync([
          index % 2 === 0 ? "profiles" : "completeness",
          "--case",
          caseDirectory,
          "--audit-log",
          log,
        ]),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(
      Array(writers).fill(0),
    );
    const logged = await entries(log);
    expect(logged.map((entry) => entry.seq)).toEqual(
      Array.from({ length: writers }, (_, index) => index + 1),
    );
    expect(
      new Set(results.map((result) => stampsOf(result.stdout)[0]?.id)),
    ).toEqual(new Set(logged.map((entry) => entry.id)));
    expect(verify(log).body).toMatchObject({ entries: writers, valid: true });
    expect(existsSync(`${log}.lock`)).toBe(false);
  });

  it("takes over the lock of a writer that died", async () => {
    const log = freshLog();
    const dead = spawnSync(process.execPath, ["-e", "process.pid"]);
    await writeFile(`${log}.lock`, `${String(dead.pid)}\n`);
    const result = runCli([
      "profiles",
      "--case",
      caseDirectory,
      "--audit-log",
      log,
    ]);
    expect(result.status).toBe(0);
    expect(existsSync(`${log}.lock`)).toBe(false);
    expect(verify(log).body).toMatchObject({ entries: 1, valid: true });
  });
});

describe("audit verify", () => {
  async function tampered(
    change: (lines: string[]) => string[],
  ): Promise<{ result: CliResult; body: Verification }> {
    const log = freshLog();
    writeSession(log);
    const lines = (await readFile(log, "utf8")).split("\n").slice(0, -1);
    expect(lines).toHaveLength(4);
    const changed = change(lines);
    await writeFile(log, changed.map((line) => `${line}\n`).join(""));
    return verify(log);
  }

  function edit(line: string, patch: Partial<AuditEntry>): string {
    return JSON.stringify({ ...(JSON.parse(line) as AuditEntry), ...patch });
  }

  it("finds an edited line", async () => {
    const { result, body } = await tampered((lines) =>
      lines.map((line, index) =>
        index === 2 ? edit(line, { exitCode: 0 }) : line,
      ),
    );
    expect(result.status).toBe(1);
    expect(body).toMatchObject({
      status: "ok",
      valid: false,
      entries: 4,
      brokenSeq: 3,
      reason: "hash_mismatch",
    });
  });

  it("finds a deleted line", async () => {
    const { result, body } = await tampered((lines) =>
      lines.filter((_, index) => index !== 1),
    );
    expect(result.status).toBe(1);
    expect(body).toMatchObject({
      valid: false,
      entries: 3,
      brokenSeq: 2,
      reason: "seq_mismatch",
    });
  });

  it("finds reordered lines", async () => {
    const { body } = await tampered(([first, second, third, fourth]) => [
      first ?? "",
      third ?? "",
      second ?? "",
      fourth ?? "",
    ]);
    expect(body).toMatchObject({
      valid: false,
      brokenSeq: 2,
      reason: "seq_mismatch",
    });
  });

  it("finds an edit whose own hash was recomputed by the next link", async () => {
    const { body } = await tampered((lines) =>
      lines.map((line, index) => {
        if (index !== 1) {
          return line;
        }
        const entry = JSON.parse(line) as AuditEntry;
        const rest = Object.entries({ ...entry, command: "profiles" }).filter(
          ([key]) => key !== "hash",
        );
        const canonical = JSON.stringify(
          Object.fromEntries(
            rest.sort(([left], [right]) => (left < right ? -1 : 1)),
          ),
        );
        return JSON.stringify({
          ...Object.fromEntries(rest),
          hash: sha256(canonical),
        });
      }),
    );
    expect(body).toMatchObject({
      valid: false,
      brokenSeq: 3,
      reason: "prev_hash_mismatch",
    });
  });

  it("finds a cut last line and refuses to chain onto it", async () => {
    const log = freshLog();
    writeSession(log);
    const text = await readFile(log, "utf8");
    await writeFile(log, text.slice(0, text.length - 40));
    const { result, body } = verify(log);
    expect(result.status).toBe(1);
    expect(body).toMatchObject({
      valid: false,
      brokenSeq: 4,
      reason: "incomplete_entry",
    });

    const refused = runCli([
      "profiles",
      "--case",
      caseDirectory,
      "--audit-log",
      log,
    ]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(parseJson<{ code: string }>(refused.stderr).code).toBe(
      "AUDIT_LOG_FAILED",
    );
    expect(await readFile(log, "utf8")).toBe(text.slice(0, text.length - 40));
  });

  it("refuses to chain onto a last line edited under its old hash", async () => {
    const log = freshLog();
    writeSession(log);
    const lines = (await readFile(log, "utf8")).split("\n").filter(Boolean);
    const last = JSON.parse(lines.at(-1) ?? "{}") as AuditEntry;
    // Rewrite what the last command was, keep its hash: a forged head.
    lines[lines.length - 1] = JSON.stringify({ ...last, command: "forged" });
    const forged = `${lines.join("\n")}\n`;
    await writeFile(log, forged);

    const refused = runCli([
      "profiles",
      "--case",
      caseDirectory,
      "--audit-log",
      log,
    ]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(parseJson<{ code: string }>(refused.stderr).code).toBe(
      "AUDIT_LOG_FAILED",
    );
    expect(await readFile(log, "utf8")).toBe(forged);
  });

  it("reports a missing log as an error", () => {
    const result = runCli([
      "audit",
      "verify",
      "--log",
      join(root, "none.ndjson"),
    ]);
    expect(result.status).toBe(1);
    expect(parseJson<{ code: string }>(result.stderr).code).toBe(
      "AUDIT_LOG_NOT_FOUND",
    );
  });
});

describe("audit log location", () => {
  async function expectRefused(result: CliResult, log: string): Promise<void> {
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(parseJson<{ code: string }>(result.stderr).code).toBe(
      "AUDIT_LOG_FAILED",
    );
    expect(existsSync(log)).toBe(false);
    expect(existsSync(`${log}.lock`)).toBe(false);
  }

  it("refuses a log inside the Case Directory, even through a symlink", async () => {
    const inside = join(caseDirectory, "working-copy", "audit.ndjson");
    await expectRefused(
      runCli(["summary", "--case", caseDirectory, "--audit-log", inside]),
      inside,
    );

    const link = join(root, "case-link");
    await symlink(caseDirectory, link);
    const throughLink = join(link, "audit.ndjson");
    await expectRefused(
      runCli(["summary", "--case", caseDirectory, "--audit-log", throughLink]),
      join(caseDirectory, "audit.ndjson"),
    );
  });

  it("refuses a log inside the recorded Source, also from the environment", async () => {
    const inside = join(root, "source", "Default", "audit.ndjson");
    const result = spawnSync(
      process.execPath,
      [compiledCli, "profiles", "--case", caseDirectory],
      {
        encoding: "utf8",
        env: { ...process.env, FORENSIX_AUDIT_LOG: inside },
      },
    );
    await expectRefused(
      { status: result.status, stdout: result.stdout, stderr: result.stderr },
      inside,
    );
  });

  it("refuses a log inside an Extract it writes", async () => {
    const extract = join(root, "extract-audited");
    const inside = join(extract, "audit.ndjson");
    const result = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      extract,
      "--audit-log",
      inside,
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(existsSync(inside)).toBe(false);
  });
});
