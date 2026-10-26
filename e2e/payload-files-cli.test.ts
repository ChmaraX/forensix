import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, writeLocalState } from "./lib/harness.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** A current-schema Favicons store with one bitmap per icon. */
function createFavicons(
  path: string,
  icons: readonly { readonly url: string; readonly png: Uint8Array }[],
): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '8'), ('last_compatible_version', '1');
      CREATE TABLE favicons (id INTEGER PRIMARY KEY, url LONGVARCHAR NOT NULL, icon_type INTEGER DEFAULT 0);
      CREATE TABLE favicon_bitmaps (
        id INTEGER PRIMARY KEY, icon_id INTEGER NOT NULL, last_updated INTEGER DEFAULT 0,
        image_data BLOB, width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, last_requested INTEGER DEFAULT 0
      );
      CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url LONGVARCHAR NOT NULL, icon_id INTEGER NOT NULL);
    `);
    for (const icon of icons) {
      const iconId = database
        .prepare("INSERT INTO favicons (url, icon_type) VALUES (?, 1)")
        .run(icon.url).lastInsertRowid;
      database
        .prepare(
          "INSERT INTO favicon_bitmaps (icon_id, image_data, width, height) VALUES (?, ?, 16, 16)",
        )
        .run(iconId, icon.png);
      database
        .prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)")
        .run(`${icon.url}/`, iconId);
    }
  } finally {
    database.close();
  }
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("compiled analyzer CLI payload files on re-analysis", () => {
  it("keeps a cited payload and replaces a damaged one as a new file", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-payload-files-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(join(source, "Default"), { recursive: true });
    await writeLocalState(source);
    const alpha = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x01]);
    const bravo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x02, 3]);
    createFavicons(join(source, "Default", "Favicons"), [
      { url: "https://alpha.example", png: alpha },
      { url: "https://bravo.example", png: bravo },
    ]);
    const caseDirectory = join(root, "CASE-PAYLOADS");
    const payloads = join(caseDirectory, "favicon-payloads");
    const alphaPath = join(payloads, sha256(alpha));
    const bravoPath = join(payloads, sha256(bravo));

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );
    expect(new Uint8Array(await readFile(alphaPath))).toEqual(alpha);

    // The committed run cites the alpha payload. A stopped earlier write left
    // the bravo payload truncated.
    const cited = new Date("2024-01-02T03:04:05Z");
    await utimes(alphaPath, cited, cited);
    await writeFile(bravoPath, bravo.subarray(0, 3));
    const alphaBefore = await stat(alphaPath);
    const damaged = await stat(bravoPath);

    expect(runCli(["analyse", "--case", caseDirectory, "--json"]).status).toBe(
      0,
    );

    // A re-analysis does not write the cited payload again, so a stop during
    // the re-analysis cannot truncate it.
    const alphaAfter = await stat(alphaPath);
    expect(alphaAfter.ino).toBe(alphaBefore.ino);
    expect(alphaAfter.mtimeMs).toBe(cited.getTime());
    expect(new Uint8Array(await readFile(alphaPath))).toEqual(alpha);
    // The damaged payload is replaced by a new complete file, not rewritten
    // in place, and no temporary file stays behind.
    expect((await stat(bravoPath)).ino).not.toBe(damaged.ino);
    expect(new Uint8Array(await readFile(bravoPath))).toEqual(bravo);
    expect((await readdir(payloads)).sort()).toEqual(
      [sha256(alpha), sha256(bravo)].sort(),
    );
  });
});
