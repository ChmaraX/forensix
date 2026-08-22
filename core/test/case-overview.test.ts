import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { analyseCase } from "../src/analyse-case.js";
import { CASE_FILENAME } from "../src/case.js";
import { queryCompleteness, queryProfiles } from "../src/case-overview.js";
import { ingestUserDataDir } from "../src/ingest.js";

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

async function createHistory(path: string): Promise<void> {
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
    database
      .prepare(
        `INSERT INTO urls (id, url, title, visit_count, typed_count, last_visit_time, hidden)
         VALUES (1, 'https://example.com', 'Example', 1, 1, 13350000000000000, 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO visits
           (id, url, visit_time, from_visit, external_referrer_url, transition,
            segment_id, visit_duration, incremented_omnibox_typed_score,
            opener_visit, originator_cache_guid, originator_visit_id,
            originator_from_visit, originator_opener_visit, is_known_to_sync,
            consider_for_ntp_most_visited, visited_link_id, app_id)
         VALUES (1, 1, 13350000000000000, 0, '', 0, 0, 0, 1, 0, '', 0, 0, 0, 1, 1, 0, '')`,
      )
      .run();
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

/**
 * Build a real Case (ingest + analyse) with a single Default Profile whose
 * History database has no `downloads`, `Bookmarks`, `Preferences`, or Cache
 * backend of its own. `analyseCase` attempts Downloads, Bookmarks,
 * Preferences, and Cache on every Profile in the same run as History — not
 * only when a dedicated fixture is supplied — so this fixture already
 * produces real `absent` attempt rows for all four newly-mapped artifacts,
 * with no fabricated rows required to exercise the "attempted but absent"
 * path.
 */
async function buildCase(): Promise<{
  readonly caseDirectory: string;
  readonly sourceId: string;
  readonly runId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "forensix-overview-"));
  temporaryRoots.push(root);
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "{}\n");
  await createHistory(join(source, "Default", "History"));
  const caseDirectory = join(root, "CASE");
  await ingest(source, caseDirectory);
  await analyseCase({ caseDirectory, topicClassification: { enabled: false } });

  const database = new DatabaseSync(join(caseDirectory, CASE_FILENAME), {
    readOnly: true,
  });
  try {
    const sourceRow = database
      .prepare("SELECT source_id FROM sources LIMIT 1")
      .get() as { source_id: string } | undefined;
    const runRow = database
      .prepare("SELECT run_id FROM analysis_runs LIMIT 1")
      .get() as { run_id: string } | undefined;
    if (sourceRow === undefined || runRow === undefined) {
      throw new Error("Fixture Case did not record a Source or Run.");
    }
    return {
      caseDirectory,
      sourceId: sourceRow.source_id,
      runId: runRow.run_id,
    };
  } finally {
    database.close();
  }
}

/**
 * Insert one synthetic `produced` artifact-result attempt row directly,
 * scoped to a Profile the real analysis pass never touched, so it adds a
 * `produced` outcome for that artifact without colliding with the real
 * `absent` row the fixture already recorded for `Default`.
 * `manifest_entry_ordinal` is left NULL: SQLite does not enforce a composite
 * foreign key when any column of it is NULL, so this stays a valid row
 * against the real schema without needing a Manifest entry.
 */
function insertProducedAttempt(
  caseDirectory: string,
  table: string,
  artifactLiteral: string,
  row: {
    readonly runId: string;
    readonly sourceId: string;
    readonly profilePath: string;
    readonly databasePath: string;
  },
): void {
  // `downloads_artifact_results` carries the same recovery-status pair
  // History does; the other three new tables do not, so the column list is
  // built per table rather than assumed uniform across all four.
  const hasRecoveryStatus = table === "downloads_artifact_results";
  const columns = [
    "run_id",
    "source_id",
    "profile_path",
    "artifact",
    "manifest_entry_ordinal",
    "database_path",
    ...(hasRecoveryStatus ? ["recovery_status"] : []),
    "status",
    "reason",
    "active",
  ];
  const placeholders = columns.map((column) =>
    column === "manifest_entry_ordinal" ? "NULL" : "?",
  );
  const values = [
    row.runId,
    row.sourceId,
    row.profilePath,
    artifactLiteral,
    row.databasePath,
    ...(hasRecoveryStatus ? ["complete"] : []),
    "complete",
    null,
    1,
  ];
  const database = new DatabaseSync(join(caseDirectory, CASE_FILENAME));
  try {
    database
      .prepare(
        `INSERT INTO ${table} (${columns.join(", ")})
         VALUES (${placeholders.join(", ")})`,
      )
      .run(...values);
  } finally {
    database.close();
  }
}

describe("queryCompleteness", () => {
  it("covers History, Cookies, Login Data, Top Sites, Web Data, Favicons, Candidates, Downloads, Bookmarks, Preferences, and Cache", async () => {
    const { caseDirectory } = await buildCase();
    const completeness = queryCompleteness({ caseDirectory });
    const artifacts = completeness.statements.map((s) => s.artifact);
    expect(artifacts).toEqual([
      "History",
      "Cookies",
      "Login Data",
      "Top Sites",
      "Web Data",
      "Favicons",
      "Candidates",
      "Downloads",
      "Bookmarks",
      "Preferences",
      "Cache",
    ]);
  });

  it("reports the real absent attempts analyseCase records for Downloads, Bookmarks, Preferences, and Cache when no dedicated evidence is present", async () => {
    const { caseDirectory } = await buildCase();
    const completeness = queryCompleteness({ caseDirectory });
    const byArtifact = new Map(
      completeness.statements.map((s) => [s.artifact, s]),
    );

    const downloads = byArtifact.get("Downloads");
    expect(downloads?.attempted).toBe(1);
    expect(downloads?.absent).toBe(1);
    expect(downloads?.artifacts[0]?.reason).toMatch(/downloads_table_absent/);

    // Bookmarks pools the primary ('Bookmarks') and backup ('Bookmarks.bak')
    // sub-kind attempts under one statement, because both share the results
    // table and the "Bookmarks" OverviewArtifact. The current-row reduction
    // is scoped to (Source, Profile), not (Source, Profile, artifact), so the
    // two Default sub-kind rows collapse to the one current outcome for that
    // Profile — the same rule History's own single sub-kind relies on.
    const bookmarks = byArtifact.get("Bookmarks");
    expect(bookmarks?.attempted).toBe(1);
    expect(bookmarks?.absent).toBe(1);
    const bookmarkReasons = bookmarks?.artifacts.map((a) => a.reason) ?? [];
    expect(bookmarkReasons[0]).toMatch(/^bookmarks_(backup_)?absent$/);

    // Preferences pools Local State (browser-level, profile ".") and
    // Preferences (Profile-level, profile "Default") sub-kind attempts under
    // one statement, but they never collapse against each other: each is a
    // distinct Profile key ("." vs "Default"), unlike Bookmarks' two rows,
    // which share one Profile ("Default"). Local State is produced here
    // because the fixture wrote a minimal `{}` file; Preferences is absent
    // because none was written.
    const preferences = byArtifact.get("Preferences");
    expect(preferences?.attempted).toBe(2);
    expect(preferences?.produced).toBe(1);
    expect(preferences?.absent).toBe(1);
    const preferenceReasons = preferences?.artifacts.map((a) => a.reason) ?? [];
    expect(preferenceReasons).toContain("preferences_absent");

    const cache = byArtifact.get("Cache");
    expect(cache?.attempted).toBe(1);
    expect(cache?.absent).toBe(1);
    expect(cache?.artifacts[0]?.reason).toBe("cache_absent");
  });

  it("reports a produced outcome for Downloads, Bookmarks, Preferences, and Cache once their tables carry a complete attempt row", async () => {
    const { caseDirectory, sourceId, runId } = await buildCase();

    insertProducedAttempt(
      caseDirectory,
      "downloads_artifact_results",
      "Downloads",
      {
        runId,
        sourceId,
        profilePath: "SecondProfile",
        databasePath: "SecondProfile/History",
      },
    );
    insertProducedAttempt(
      caseDirectory,
      "bookmarks_artifact_results",
      "Bookmarks",
      {
        runId,
        sourceId,
        profilePath: "SecondProfile",
        databasePath: "SecondProfile/Bookmarks",
      },
    );
    insertProducedAttempt(
      caseDirectory,
      "preferences_artifact_results",
      "Preferences",
      {
        runId,
        sourceId,
        profilePath: "SecondProfile",
        databasePath: "SecondProfile/Preferences",
      },
    );
    insertProducedAttempt(caseDirectory, "cache_artifact_results", "Cache", {
      runId,
      sourceId,
      profilePath: "SecondProfile",
      databasePath: "SecondProfile/Cache/Cache_Data",
    });

    const completeness = queryCompleteness({ caseDirectory });
    const byArtifact = new Map(
      completeness.statements.map((s) => [s.artifact, s]),
    );

    for (const artifact of [
      "Downloads",
      "Bookmarks",
      "Preferences",
      "Cache",
    ] as const) {
      const statement = byArtifact.get(artifact);
      expect(statement).toBeDefined();
      const secondProfileRow = statement?.artifacts.find(
        (row) => row.profile === "SecondProfile",
      );
      expect(
        secondProfileRow,
        `${artifact} should carry a SecondProfile row`,
      ).toBeDefined();
      expect(secondProfileRow?.outcome).toBe("produced");
      expect(secondProfileRow?.reason).toBeNull();
    }
    // The produced attempts increase the artifact's total attempted count
    // beyond what the real analysis pass alone recorded for Default.
    expect(byArtifact.get("Downloads")?.attempted).toBe(2);
    expect(byArtifact.get("Cache")?.attempted).toBe(2);
  });
});

describe("queryProfiles", () => {
  it("includes a Profile that only carries an active Downloads, Bookmarks, Preferences, or Cache attempt", async () => {
    const { caseDirectory, sourceId, runId } = await buildCase();
    insertProducedAttempt(
      caseDirectory,
      "downloads_artifact_results",
      "Downloads",
      {
        runId,
        sourceId,
        profilePath: "OnlyInDownloads",
        databasePath: "OnlyInDownloads/History",
      },
    );

    const profiles = queryProfiles({ caseDirectory });
    expect(profiles.profiles).toContain("OnlyInDownloads");
  });
});
