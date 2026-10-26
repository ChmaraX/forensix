/**
 * "Read paths never mutate a Case", watched on the real files: every read
 * command of the compiled CLI, `export`, `report`, and a `serve` session that
 * answers every dashboard API route leave the Case directory byte-for-byte
 * and timestamp-for-timestamp unchanged, with no SQLite `-wal` or `-shm`
 * file next to `case.fxdb`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { API_ROUTES } from "../server/dist/index.js";
import {
  buildDashboardCase,
  readApi,
  startDashboard,
} from "./lib/dashboard-case.js";
import { parseJson, runCli } from "./lib/harness.js";

interface Page {
  readonly items: readonly {
    readonly id: string;
    readonly host?: string;
  }[];
}

let root = "";
let caseDirectory = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forensix-case-read-only-"));
  caseDirectory = await buildDashboardCase(root);
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Every entry under the Case directory: path, type, size, mtime, and the
 *  SHA-256 of each file's bytes. */
function snapshotCase(): readonly string[] {
  const lines: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stats = statSync(path);
      const key = relative(caseDirectory, path);
      if (stats.isDirectory()) {
        lines.push(`dir ${key} ${String(stats.mtimeMs)}`);
        walk(path);
      } else {
        const digest = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
        lines.push(
          `file ${key} ${String(stats.size)} ${String(stats.mtimeMs)} ${digest}`,
        );
      }
    }
  };
  walk(caseDirectory);
  return lines;
}

function mustRead(arguments_: readonly string[]): string {
  const result = runCli([...arguments_, "--case", caseDirectory, "--json"]);
  expect(result.stderr, arguments_.join(" ")).toBe("");
  expect(result.status, arguments_.join(" ")).toBe(0);
  return result.stdout;
}

it("leaves the Case unchanged across every read command, export, report, and serve", async () => {
  const before = snapshotCase();
  expect(before.some((line) => line.startsWith("file case.fxdb "))).toBe(true);

  const history = parseJson<Page>(mustRead(["history", "--limit", "5"]));
  const visit = history.items[0];
  expect(visit).toBeDefined();
  const hosts = parseJson<Page>(mustRead(["site-hosts", "--limit", "5"]));
  const host = hosts.items[0]?.host;
  expect(host).toBeDefined();

  const reads: readonly (readonly string[])[] = [
    ["summary"],
    ["schema"],
    ["completeness"],
    ["profiles"],
    ["count", "--kind", "history_visit", "--by", "commitState"],
    ["count", "--kind", "login_credential", "--by", "secret"],
    ["get", "--id", visit?.id ?? ""],
    ["timeline", "--limit", "100", "--page-all"],
    ["site-findings", "--host", host ?? ""],
    ["history", "--view", "visits", "--commit-state", "wal_resident"],
    ["history", "--view", "activity"],
    ["history", "--view", "most-visited"],
    ["history", "--view", "durations"],
    ["cookies", "--include-secrets"],
    ["credentials", "--include-secrets"],
    ["top-sites"],
    ["topic-candidates"],
    ["autofill"],
    ["candidates"],
    ["favicons"],
    ["cache"],
    ["downloads"],
    ["metadata"],
    ["bookmarks"],
  ];
  for (const read of reads) {
    mustRead(read);
  }

  const extract = join(root, "extract");
  mustRead(["export", "--out", extract]);
  const report = runCli([
    "report",
    "--extract",
    extract,
    "--out",
    join(root, "report.html"),
    "--json",
  ]);
  expect(report.stderr).toBe("");
  expect(report.status).toBe(0);

  const dashboard = await startDashboard(caseDirectory);
  try {
    const parameters: Readonly<Record<string, Record<string, string>>> = {
      count: { kind: "history_visit", by: "profile" },
      get: { id: visit?.id ?? "" },
      "site-findings": { host: host ?? "" },
      "site-favicons": { host: host ?? "" },
      "favicon-bitmaps": { host: host ?? "" },
    };
    for (const route of API_ROUTES.keys()) {
      await readApi(dashboard, route, parameters[route] ?? {});
    }
  } finally {
    dashboard.stop();
  }

  expect(snapshotCase()).toEqual(before);
}, 180_000);
