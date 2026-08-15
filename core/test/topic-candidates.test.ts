import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CASE_FILENAME } from "../src/case.js";
import type { PersistedCandidate } from "../src/case-findings.js";
import { createFinding, valueField } from "../src/forensic-model.js";
import { analyseCase } from "../src/history.js";
import { ingestUserDataDir } from "../src/ingest.js";
import { loadTopicEngine } from "../src/topic-candidates-onnx.js";
import {
  classifyTopicCandidates,
  topicInputText,
  TOPIC_CANDIDATE_KIND,
  TOPIC_TAXONOMY,
  UNCLASSIFIED_LABEL_ID,
  type EmbeddingEngine,
  type TopicCandidateInput,
  type TopicClassifierUnavailable,
} from "../src/topic-candidates.js";
import { queryTopicCandidates } from "../src/topic-candidates-query.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) =>
        rm(root, { force: true, recursive: true }).catch(() => undefined),
      ),
  );
});

/**
 * A deterministic keyword-bag embedding engine. Each keyword is a basis
 * dimension; embed(text) sets a dimension when its keyword is a substring of the
 * lowercased text. Because the frozen anchor strings each contain a distinctive
 * keyword, an input carrying that one keyword aligns with exactly that label.
 * No model, no network, no randomness — the classifier's decision surface is
 * exercised in full without the ONNX binary.
 */
// Every keyword below is a substring of exactly ONE frozen anchor string, so an
// input carrying it aligns unambiguously with that single label. (Generic words
// like "banking" are deliberately avoided: it also appears in the crypto anchor,
// which the classifier correctly tie-breaks — not what these known-answer cases
// are asserting.)
const KEYWORDS = [
  "brokerage",
  "streaming",
  "symptoms",
  "developer",
  "casino",
  "exploit",
] as const;

function fakeEngine(): EmbeddingEngine {
  return {
    modelId: "fake/keyword-bag",
    modelRevision: "test",
    embed: (text: string): Float32Array => {
      const lower = text.toLocaleLowerCase("en-US");
      const vector = new Float32Array(KEYWORDS.length);
      KEYWORDS.forEach((keyword, index) => {
        vector[index] = lower.includes(keyword) ? 1 : 0;
      });
      return vector;
    },
  };
}

function input(
  url: string | null,
  title: string | null,
  overrides: Partial<TopicCandidateInput> = {},
): TopicCandidateInput {
  return {
    url,
    title,
    profile: "Default",
    commitState: "committed",
    provenance: {
      manifestEntryId: "source-1:0",
      sourceId: "source-1",
      manifestEntryOrdinal: 0,
      manifestPath: "Default/History",
      database: "Default/History",
      table: "urls",
      rowId: url || title || "row",
    },
    supportingCount: 1,
    ...overrides,
  };
}

function labelOf(candidate: PersistedCandidate): string {
  const field = candidate.candidate.fields.topicLabel;
  return field !== undefined && field.state === "value"
    ? String(field.value)
    : "";
}

describe("classifyTopicCandidates", () => {
  it("classifies known URL+title inputs to the expected topic label", async () => {
    const cases: {
      readonly input: TopicCandidateInput;
      readonly label: string;
    }[] = [
      {
        input: input("https://chase.com/x", "brokerage account"),
        label: "finance_banking",
      },
      {
        input: input("https://netflix.com/browse", "streaming now"),
        label: "entertainment_streaming_gaming",
      },
      {
        input: input("https://webmd.com", "flu symptoms"),
        label: "health_medical",
      },
      {
        input: input("https://example.dev", "developer guide"),
        label: "technology_software_dev",
      },
      {
        input: input("https://bet365.com", "casino night"),
        label: "gambling",
      },
      {
        input: input("https://ex.example", "exploit writeup"),
        label: "hacking_security_tooling",
      },
    ];
    const result = await classifyTopicCandidates(
      fakeEngine(),
      cases.map((entry) => entry.input),
    );
    expect(Array.isArray(result)).toBe(true);
    const candidates = result as PersistedCandidate[];
    for (const entry of cases) {
      const top = candidates.find(
        (candidate) =>
          candidate.candidate.provenance.rowId ===
            entry.input.provenance.rowId && candidate.candidate.rank === 1,
      );
      expect(top, `rank-1 candidate for ${entry.label}`).toBeDefined();
      expect(labelOf(top as PersistedCandidate)).toBe(entry.label);
    }
  });

  it("emits every output as a ranked, counted, provenance-bearing Candidate", async () => {
    const result = await classifyTopicCandidates(fakeEngine(), [
      input("https://chase.com/x", "brokerage", { supportingCount: 7 }),
    ]);
    const candidates = result as PersistedCandidate[];
    expect(candidates.length).toBeGreaterThan(0);
    for (const row of candidates) {
      expect(row.candidate.recordType).toBe("candidate");
      expect(row.candidate.candidateKind).toBe(TOPIC_CANDIDATE_KIND);
      expect(row.candidate.rank).toBeGreaterThanOrEqual(1);
      expect(row.candidate.count).toBe(7);
      // Provenance resolves back to a source row.
      expect(row.candidate.provenance.manifestEntryId).toBe("source-1:0");
      expect(row.candidate.provenance.rowId.length).toBeGreaterThan(0);
    }
  });

  it("treats negative (blank) inputs as unclassified, never a confident topic", async () => {
    const result = await classifyTopicCandidates(fakeEngine(), [
      input(null, null),
      input("   ", "\t"),
      input("", ""),
    ]);
    const candidates = result as PersistedCandidate[];
    expect(candidates).toHaveLength(3);
    for (const row of candidates) {
      expect(labelOf(row)).toBe(UNCLASSIFIED_LABEL_ID);
      expect(row.candidate.rank).toBe(1);
    }
  });

  it("is deterministic: identical inputs produce byte-identical candidates", async () => {
    const inputs = [
      input("https://chase.com/x", "brokerage"),
      input("https://bet365.com", "casino"),
    ];
    const first = (await classifyTopicCandidates(
      fakeEngine(),
      inputs,
    )) as PersistedCandidate[];
    const second = (await classifyTopicCandidates(
      fakeEngine(),
      inputs,
    )) as PersistedCandidate[];
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("ranks multi-label emission by score with a stable label-id tie-break", async () => {
    // "brokerage" and "casino" both present: finance and gambling both score.
    const result = (await classifyTopicCandidates(
      fakeEngine(),
      [input("https://x.example", "brokerage casino")],
      { maxLabels: 5, multiLabelDelta: 1 },
    )) as PersistedCandidate[];
    const labels = result.map(labelOf);
    expect(labels).toContain("finance_banking");
    expect(labels).toContain("gambling");
    // Equal scores tie-break deterministically by label id (ascending).
    const ranks = result.map((row) => row.candidate.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("reports typed unavailability when inference throws, without fabricating rows", async () => {
    const throwing: EmbeddingEngine = {
      modelId: "fake/throwing",
      modelRevision: "test",
      embed: () => {
        throw new Error("simulated inference failure");
      },
    };
    const result = await classifyTopicCandidates(throwing, [
      input("https://chase.com/x", "brokerage"),
    ]);
    expect(Array.isArray(result)).toBe(false);
    const unavailable = result as TopicClassifierUnavailable;
    expect(unavailable.available).toBe(false);
    expect(unavailable.reason).toBe("inference_failed");
  });

  it("holds a complete 20-label frozen taxonomy including unclassified", () => {
    expect(TOPIC_TAXONOMY).toHaveLength(20);
    expect(TOPIC_TAXONOMY.map((label) => label.id)).toContain(
      UNCLASSIFIED_LABEL_ID,
    );
    expect(
      TOPIC_TAXONOMY.filter((label) => label.specialCategory),
    ).toHaveLength(2);
  });

  it("builds encoder input as title then URL", () => {
    expect(topicInputText("https://x.example", "Title")).toBe(
      "Title https://x.example",
    );
    expect(topicInputText(null, "Title")).toBe("Title");
    expect(topicInputText("https://x.example", null)).toBe("https://x.example");
    expect(topicInputText("  ", "  ")).toBe("");
  });
});

describe("contamination controls", () => {
  it("keeps Candidates structurally distinct from Findings", async () => {
    const candidates = (await classifyTopicCandidates(fakeEngine(), [
      input("https://chase.com/x", "brokerage"),
    ])) as PersistedCandidate[];
    const first = candidates[0];
    expect(first).toBeDefined();

    // A Finding built from the same source row is a different record type: it
    // carries `findingKind`, not `candidateKind`. No classifier output ever
    // acquires the Finding shape, so nothing here can enter a Finding
    // collection or a factual summary tile.
    const finding = createFinding({
      findingKind: "history_most_visited_summary",
      profile: "Default",
      commitState: "committed",
      provenance: (first as PersistedCandidate).candidate.provenance,
      fields: { url: valueField("https://chase.com/x") },
    });
    expect(finding.recordType).toBe("finding");
    expect("findingKind" in finding).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.candidate.recordType).toBe("candidate");
      expect("candidateKind" in candidate.candidate).toBe(true);
      expect("findingKind" in candidate.candidate).toBe(false);
    }
  });
});

describe("loadTopicEngine", () => {
  it("reports model_artifact_missing when no model directory is present", async () => {
    const result = await loadTopicEngine({ modelDir: undefined });
    expect("available" in result && result.available === false).toBe(true);
    expect((result as TopicClassifierUnavailable).reason).toBe(
      "model_artifact_missing",
    );
  });

  it("reports model_artifact_missing for a directory without the ONNX file", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-topic-model-"));
    temporaryRoots.push(root);
    const result = await loadTopicEngine({ modelDir: root });
    expect((result as TopicClassifierUnavailable).reason).toBe(
      "model_artifact_missing",
    );
  });
});

async function createHistory(
  path: string,
  rows: readonly {
    readonly id: bigint;
    readonly urlId: bigint;
    readonly url: string;
    readonly title: string;
    readonly visitTime: bigint;
  }[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta (key, value) VALUES ('version', '70'), ('last_compatible_version', '16');
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url LONGVARCHAR, title LONGVARCHAR,
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
      CREATE TABLE segments (id INTEGER PRIMARY KEY, name VARCHAR, url_id INTEGER NON NULL);
      CREATE TABLE segment_usage (
        id INTEGER PRIMARY KEY, segment_id INTEGER NOT NULL,
        time_slot INTEGER NOT NULL, visit_count INTEGER DEFAULT 0 NOT NULL
      );
    `);
    const insertUrl = database.prepare(
      `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    );
    const insertVisit = database.prepare(
      `INSERT INTO visits
         (id, url, visit_time, from_visit, external_referrer_url, transition,
          segment_id, visit_duration, incremented_omnibox_typed_score,
          opener_visit, originator_cache_guid, originator_visit_id,
          originator_from_visit, originator_opener_visit, is_known_to_sync,
          consider_for_ntp_most_visited, visited_link_id, app_id)
       VALUES (?, ?, ?, 0, '', 0, 0, 0, 1, 0, '', 0, 0, 0, 1, 1, 0, '')`,
    );
    for (const row of rows) {
      insertUrl.run(row.urlId, row.url, row.title, 1, 1, row.visitTime);
      insertVisit.run(row.id, row.urlId, row.visitTime);
    }
  } finally {
    database.close();
  }
}

async function ingest(
  sourcePath: string,
  caseDirectory: string,
): Promise<void> {
  const generator = ingestUserDataDir({ sourcePath, caseDirectory });
  let next = await generator.next();
  while (next.done !== true) {
    next = await generator.next();
  }
}

interface StoredRow {
  readonly kind: string;
  readonly profile: string;
  readonly commit: string;
  readonly provenance: string;
  readonly fields: string;
}

function readFindings(caseDirectory: string): StoredRow[] {
  const database = new DatabaseSync(join(caseDirectory, CASE_FILENAME), {
    readOnly: true,
  });
  try {
    const rows = database
      .prepare(
        `SELECT f.finding_kind, f.profile_path, f.commit_state,
              f.provenance_json, f.fields_json
           FROM forensic_findings f
           JOIN history_artifact_results r ON r.artifact_result_id = f.artifact_result_id
          WHERE r.active = 1
          ORDER BY f.finding_kind, f.provenance_json, f.fields_json`,
      )
      .all() as unknown as {
      finding_kind: string;
      profile_path: string;
      commit_state: string;
      provenance_json: string;
      fields_json: string;
    }[];
    return rows.map((row) => ({
      kind: row.finding_kind,
      profile: row.profile_path,
      commit: row.commit_state,
      provenance: row.provenance_json,
      fields: row.fields_json,
    }));
  } finally {
    database.close();
  }
}

function countCandidates(caseDirectory: string): number {
  const database = new DatabaseSync(join(caseDirectory, CASE_FILENAME), {
    readOnly: true,
  });
  try {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS n
           FROM forensic_candidates c
           JOIN history_artifact_results r ON r.artifact_result_id = c.artifact_result_id
          WHERE r.active = 1`,
      )
      .get() as { n: number | bigint };
    return Number(row.n);
  } finally {
    database.close();
  }
}

async function buildCase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-topic-int-"));
  temporaryRoots.push(root);
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "{}\n");
  await createHistory(join(source, "Default", "History"), [
    {
      id: 1n,
      urlId: 10n,
      url: "https://chase.com/x",
      title: "brokerage account",
      visitTime: 13350000000000000n,
    },
    {
      id: 2n,
      urlId: 20n,
      url: "https://bet365.com/casino",
      title: "casino night",
      visitTime: 13350000000000001n,
    },
  ]);
  const caseDirectory = join(root, "CASE");
  await ingest(source, caseDirectory);
  return caseDirectory;
}

describe("topic classification integration", () => {
  it("stores Candidates when an engine is available and exposes them via the query surface", async () => {
    const caseDirectory = await buildCase();
    const result = await analyseCase({
      caseDirectory,
      topicClassification: { engine: fakeEngine() },
    });
    expect(result.topicCandidates.status).toBe("complete");
    expect(result.topicCandidates.candidateCount).toBeGreaterThan(0);
    expect(result.history.candidateCount).toBe(
      result.topicCandidates.candidateCount,
    );
    expect(countCandidates(caseDirectory)).toBe(
      result.topicCandidates.candidateCount,
    );

    const page = queryTopicCandidates({ caseDirectory, sort: "rank" });
    expect(page.command).toBe("topic-candidates");
    for (const item of page.items) {
      expect(item.recordType).toBe("candidate");
    }

    const finance = queryTopicCandidates({
      caseDirectory,
      label: "finance_banking",
    });
    expect(finance.items.length).toBeGreaterThan(0);
    for (const item of finance.items) {
      const field = item.fields.topicLabel;
      expect(field?.state === "value" ? field.value : null).toBe(
        "finance_banking",
      );
    }
  });

  it("leaves every Finding row byte-for-byte unchanged when classification is disabled", async () => {
    const caseDirectory = await buildCase();

    await analyseCase({
      caseDirectory,
      topicClassification: { enabled: false },
    });
    const disabledFindings = readFindings(caseDirectory);
    expect(countCandidates(caseDirectory)).toBe(0);

    await analyseCase({
      caseDirectory,
      topicClassification: { engine: fakeEngine() },
    });
    const classifiedFindings = readFindings(caseDirectory);
    expect(countCandidates(caseDirectory)).toBeGreaterThan(0);

    // The classifier is additive: the Finding rows are identical whether or not
    // it ran.
    expect(classifiedFindings).toEqual(disabledFindings);
  });

  it("records typed unavailability yet keeps History findings usable when no model is present", async () => {
    const caseDirectory = await buildCase();
    const result = await analyseCase({ caseDirectory });
    expect(result.topicCandidates.status).toBe("unavailable");
    expect(result.topicCandidates.reason).toBe("model_artifact_missing");
    expect(result.history.candidateCount).toBe(0);
    // History analysis is complete and its Findings are present regardless.
    expect(result.history.findingCount).toBeGreaterThan(0);
    expect(countCandidates(caseDirectory)).toBe(0);
    expect(readFindings(caseDirectory).length).toBeGreaterThan(0);
  });
});
