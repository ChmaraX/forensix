import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function createHistory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');

      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url LONGVARCHAR,
        title LONGVARCHAR,
        visit_count INTEGER DEFAULT 0 NOT NULL,
        typed_count INTEGER DEFAULT 0 NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER DEFAULT 0 NOT NULL
      );

      CREATE TABLE visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url INTEGER NOT NULL,
        visit_time INTEGER NOT NULL,
        from_visit INTEGER,
        external_referrer_url TEXT,
        transition INTEGER DEFAULT 0 NOT NULL,
        segment_id INTEGER,
        visit_duration INTEGER DEFAULT 0 NOT NULL,
        incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
        opener_visit INTEGER,
        originator_cache_guid TEXT,
        originator_visit_id INTEGER,
        originator_from_visit INTEGER,
        originator_opener_visit INTEGER,
        is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
        consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
        visited_link_id INTEGER,
        app_id TEXT
      );

      CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
      INSERT INTO urls
        (id, url, title, visit_count, typed_count, last_visit_time, hidden)
      VALUES (1, 'https://alpha.example/', 'Alpha', 1, 0, 13348638245123456, 0);
      INSERT INTO visits
        (id, url, visit_time, from_visit, external_referrer_url, transition,
         segment_id, visit_duration, incremented_omnibox_typed_score,
         opener_visit, originator_cache_guid, originator_visit_id,
         originator_from_visit, originator_opener_visit, is_known_to_sync,
         consider_for_ntp_most_visited, visited_link_id, app_id)
      VALUES (1, 1, 13348638245123456, 0, '', 1, 0, 100, 1, 0, '', 0, 0, 0, 0, 1, 0, NULL);
    `);
  } finally {
    database.close();
  }
}

async function ingestAndAnalyse(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeLocalState(source);
  await createHistory(join(source, "Default", "History"));
  const caseDirectory = join(root, "CASE-EXPORT");
  expect(
    runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
  ).toBe(0);
  expect(
    runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      "America/New_York",
      "--json",
    ]).status,
  ).toBe(0);
  return caseDirectory;
}

interface ExportSummary {
  readonly status: "ok";
  readonly command: "export";
  readonly extractKind: "history";
  readonly outDirectory: string;
  readonly findingCount: number;
  readonly candidateCount: number;
  readonly csv: boolean;
  readonly redaction: {
    readonly policy: string;
    readonly state: "redacted" | "disclosed";
    readonly plaintextSecretsIncluded: boolean;
    readonly redactedFieldCount: number;
    readonly binaryPayloadCount: number;
  };
  readonly completeness: {
    readonly attempted: number;
    readonly produced: number;
    readonly absent: number;
    readonly unavailable: number;
  };
  readonly derivedDigest: string;
  readonly generatedAt: string;
  readonly files: readonly string[];
}

async function readOut(outDirectory: string): Promise<Record<string, Buffer>> {
  const names = await readdir(outDirectory);
  const files: Record<string, Buffer> = {};
  for (const name of names) {
    files[name] = await readFile(join(outDirectory, name));
  }
  return files;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI canonical Extract export", () => {
  it("emits a versioned header, separate collections, and a reproducible Manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    const outDirectory = join(root, "extract");
    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      outDirectory,
      "--examiner",
      "Jane Doe",
      "--csv",
      "--json",
    ]);
    expect(command.status).toBe(0);
    const summary = parseJson<ExportSummary>(command.stdout);

    // Findings and Candidates are separate collections.
    expect(summary.findingCount).toBeGreaterThan(0);
    expect(summary.candidateCount).toBe(0);
    expect(summary.files).toEqual(
      [
        "candidates.jsonl",
        "candidates.lossy.csv",
        "export_generation.json",
        "export_header.json",
        "export_manifest.json",
        "findings.jsonl",
        "findings.lossy.csv",
      ].sort(),
    );

    const files = await readOut(outDirectory);

    // Versioned JSON header with mandatory Case, Source, tool, examiner,
    // timezone, scope, and Redaction State data.
    const header = JSON.parse(String(files["export_header.json"])) as Record<
      string,
      unknown
    >;
    expect(header).toMatchObject({
      extract_schema: "forensix/extract/1",
      extractKind: "history",
      case: { schemaVersion: 2, toolVersion: expect.any(String) },
      tool: { name: "forensix", version: expect.any(String) },
      examiner: { state: "value", value: "Jane Doe" },
      declaredTimezone: { state: "value", value: "America/New_York" },
      scope: {
        collections: ["candidates", "findings"],
        profiles: "all",
        commitState: "all",
        activeResultsOnly: true,
        csv: { enabled: true, lossy: true },
      },
      redaction: {
        policy: "forensix/redaction/1",
        state: "redacted",
        plaintextSecretsIncluded: false,
        binaryPayloadCount: 0,
      },
    });
    expect(String((header.case as Record<string, unknown>).caseId)).toMatch(
      /[0-9a-f-]{36}/,
    );
    expect(Array.isArray(header.sources)).toBe(true);
    expect((header.sources as unknown[]).length).toBe(1);
    expect(Array.isArray(header.analysisRuns)).toBe(true);
    expect((header.analysisRuns as unknown[]).length).toBe(1);

    // The Completeness Statement records attempted, produced, absent, and
    // unavailable artifacts and lives in the header, before any result row.
    expect(header.completeness).toMatchObject({
      attempted: 1,
      produced: 1,
      absent: 0,
      unavailable: 0,
    });
    const completenessArtifact = (
      (header.completeness as Record<string, unknown>).artifacts as Record<
        string,
        unknown
      >[]
    )[0];
    expect(completenessArtifact).toMatchObject({
      artifact: "History",
      profile: "Default",
      outcome: "produced",
    });

    // Each JSONL Finding row preserves Provenance, Field State, Commit
    // State, and timestamp semantics.
    const findingLines = String(files["findings.jsonl"])
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(findingLines.length).toBe(summary.findingCount);
    const visit = findingLines.find(
      (row) => row.kind === "history_visit",
    ) as Record<string, unknown>;
    expect(visit).toMatchObject({
      record_type: "finding",
      collection: "findings",
      commit_state: "committed",
      provenance: { table: "visits", rowId: "1" },
    });
    const visitFields = visit.fields as Record<string, Record<string, unknown>>;
    expect(visitFields.url).toMatchObject({
      state: "value",
      value: "https://alpha.example/",
    });
    expect(visitFields.visitTime).toMatchObject({
      state: "value",
      value: { epochFamily: "1601-us", declaredTimezone: "America/New_York" },
    });
    expect(visitFields.appId).toMatchObject({ state: "absent" });

    // No result cell carries a base64 binary payload; binaries would be
    // separate hashed files instead.
    expect(String(files["findings.jsonl"])).not.toContain('"base64"');
    expect(summary.redaction.binaryPayloadCount).toBe(0);

    // The CSV profile is explicitly lossy and uses record_type first.
    const csvHeaderLine = String(files["findings.lossy.csv"])
      .split("\n")[0]
      ?.split(",");
    expect(csvHeaderLine?.[0]).toBe("record_type");
    expect(header.scope).toMatchObject({ csv: { lossy: true } });

    // The Export Manifest digest is independently reproducible from the
    // emitted file bytes.
    const manifest = JSON.parse(String(files["export_manifest.json"])) as {
      readonly files: readonly {
        readonly path: string;
        readonly sha256: string;
        readonly size: number;
      }[];
      readonly derivedDigest: string;
      readonly quarantinedGenerationFile: string;
    };
    expect(manifest.quarantinedGenerationFile).toBe("export_generation.json");
    for (const entry of manifest.files) {
      const bytes = files[entry.path];
      expect(bytes).toBeDefined();
      expect(sha256(bytes as Buffer)).toBe(entry.sha256);
      expect((bytes as Buffer).byteLength).toBe(entry.size);
    }
    expect(manifest.files.map((entry) => entry.path)).not.toContain(
      "export_manifest.json",
    );
    expect(manifest.files.map((entry) => entry.path)).not.toContain(
      "export_generation.json",
    );
    const independentDigest = sha256(
      Buffer.from(JSON.stringify(manifest.files), "utf8"),
    );
    expect(independentDigest).toBe(manifest.derivedDigest);
    expect(summary.derivedDigest).toBe(manifest.derivedDigest);

    // The quarantined generation instant is isolated in one file.
    const generation = JSON.parse(
      String(files["export_generation.json"]),
    ) as Record<string, unknown>;
    expect(generation.generatedAt).toBe(summary.generatedAt);
    expect(generation.derivedDigest).toBe(manifest.derivedDigest);
  });

  it("produces byte-identical exports except for the quarantined generation instant", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-repro-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    const outOne = join(root, "extract-1");
    const outTwo = join(root, "extract-2");
    expect(
      runCli(["export", "--case", caseDirectory, "--out", outOne, "--json"])
        .status,
    ).toBe(0);
    expect(
      runCli(["export", "--case", caseDirectory, "--out", outTwo, "--json"])
        .status,
    ).toBe(0);

    const first = await readOut(outOne);
    const second = await readOut(outTwo);
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
    for (const name of Object.keys(first)) {
      if (name === "export_generation.json") {
        expect((first[name] as Buffer).equals(second[name] as Buffer)).toBe(
          false,
        );
      } else {
        expect((first[name] as Buffer).equals(second[name] as Buffer)).toBe(
          true,
        );
      }
    }
  });

  it("redacts plaintext secrets by default and discloses them only on opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-secret-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    // Inject a synthetic Finding that carries a plaintext-secret field so the
    // redaction policy has something to act on. This exercises the export
    // redaction path end to end without a second record of truth of its own.
    const database = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readBigInts: true,
    });
    try {
      const template = database
        .prepare(
          `SELECT f.artifact_result_id, f.run_id, f.source_id,
                  f.manifest_entry_ordinal, f.profile_path, f.commit_state,
                  f.provenance_json
             FROM forensic_findings f
             JOIN history_artifact_results r
               ON r.artifact_result_id = f.artifact_result_id
            WHERE r.active = 1 AND f.finding_kind = 'history_visit'
            LIMIT 1`,
        )
        .get() as Record<string, unknown>;
      database
        .prepare(
          `INSERT INTO forensic_findings
             (artifact_result_id, run_id, source_id, manifest_entry_ordinal,
              record_type, finding_kind, profile_path, commit_state,
              provenance_json, fields_json, search_text, sort_time, sort_url,
              sort_duration, sort_count, transition_core)
           VALUES (?, ?, ?, ?, 'finding', 'history_secret', ?, ?, ?, ?, '', NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(
          template.artifact_result_id as bigint,
          template.run_id as string,
          template.source_id as string,
          template.manifest_entry_ordinal as bigint,
          template.profile_path as string,
          template.commit_state as string,
          template.provenance_json as string,
          JSON.stringify({
            password_value: { state: "value", value: "hunter2" },
            note: { state: "value", value: "not a secret" },
          }),
        );
    } finally {
      database.close();
    }

    const redactedOut = join(root, "redacted");
    const redacted = parseJson<ExportSummary>(
      runCli([
        "export",
        "--case",
        caseDirectory,
        "--out",
        redactedOut,
        "--json",
      ]).stdout,
    );
    expect(redacted.redaction.plaintextSecretsIncluded).toBe(false);
    expect(redacted.redaction.redactedFieldCount).toBe(1);
    const redactedBytes = String(
      await readFile(join(redactedOut, "findings.jsonl")),
    );
    expect(redactedBytes).not.toContain("hunter2");
    expect(redactedBytes).toContain("plaintext_secret_withheld");
    // The withheld value stays citable through its hash.
    expect(redactedBytes).toContain(
      sha256(Buffer.from(JSON.stringify("hunter2"), "utf8")),
    );

    const disclosedOut = join(root, "disclosed");
    const disclosed = parseJson<ExportSummary>(
      runCli([
        "export",
        "--case",
        caseDirectory,
        "--out",
        disclosedOut,
        "--include-secrets",
        "--json",
      ]).stdout,
    );
    expect(disclosed.redaction.plaintextSecretsIncluded).toBe(true);
    expect(disclosed.redaction.state).toBe("disclosed");
    expect(disclosed.redaction.redactedFieldCount).toBe(0);
    expect(
      String(await readFile(join(disclosedOut, "findings.jsonl"))),
    ).toContain("hunter2");
  });

  it("keeps the Extract out of the Case and refuses a non-empty target", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-guard-"));
    temporaryRoots.push(root);
    const caseDirectory = await ingestAndAnalyse(root);

    const insideCase = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      join(caseDirectory, "extract"),
      "--json",
    ]);
    expect(insideCase.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(insideCase.stderr)).toMatchObject(
      { code: "INVALID_ARGUMENT" },
    );

    const outDirectory = join(root, "used");
    await mkdir(outDirectory, { recursive: true });
    await writeFile(join(outDirectory, "keep.txt"), "existing\n");
    const nonEmpty = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      outDirectory,
      "--json",
    ]);
    expect(nonEmpty.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(nonEmpty.stderr)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("refuses to export a Case without analysis", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-export-noanalysis-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    await createHistory(join(source, "Default", "History"));
    const caseDirectory = join(root, "CASE-NO-ANALYSIS");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const command = runCli([
      "export",
      "--case",
      caseDirectory,
      "--out",
      join(root, "extract"),
      "--json",
    ]);
    expect(command.status).toBe(1);
    expect(parseJson<Record<string, unknown>>(command.stderr)).toMatchObject({
      code: "ANALYSIS_NOT_FOUND",
    });
  });
});
