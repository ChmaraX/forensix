import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

const compiledCli = resolve("cli/dist/cli.js");
const temporaryRoots: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type Field<T> =
  | { readonly state: "value"; readonly value: T; readonly synthetic?: boolean }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface AutofillFinding {
  readonly recordType: "finding";
  readonly findingKind: "autofill_entry";
  readonly profile: string;
  readonly commitState: "committed" | "wal_resident" | "journal_resident";
  readonly provenance: {
    readonly sourceId: string;
    readonly manifestPath: string;
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
  };
  readonly fields: {
    readonly autofillId: Field<string>;
    readonly fieldName: Field<string>;
    readonly fieldValue: Field<string>;
    readonly fieldValueLower: Field<string>;
    readonly timesUsed: Field<string>;
    readonly dateCreated: Field<{
      readonly raw: string;
      readonly epochFamily: string;
      readonly utc: string;
      readonly declaredTimezone: string;
      readonly resolution: string;
    }>;
    readonly dateLastUsed: Field<unknown>;
  };
}

interface AutofillPage {
  readonly status: "ok";
  readonly command: "autofill";
  readonly items: readonly AutofillFinding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

function runCli(arguments_: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [compiledCli, ...arguments_], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value.trim()) as T;
}

interface AutofillRow {
  readonly name: string;
  readonly value: string;
  readonly dateCreated: bigint;
  readonly dateLastUsed: bigint;
  readonly count: bigint;
}

function createWebDataSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    INSERT INTO meta (key, value) VALUES ('version', '133'), ('last_compatible_version', '83');

    CREATE TABLE autofill (
      name VARCHAR,
      value VARCHAR,
      value_lower VARCHAR,
      date_created INTEGER DEFAULT 0,
      date_last_used INTEGER DEFAULT 0,
      count INTEGER DEFAULT 1,
      PRIMARY KEY (name, value)
    );
  `);
}

function insertAutofill(database: DatabaseSync, row: AutofillRow): void {
  database
    .prepare(
      `INSERT INTO autofill
         (name, value, value_lower, date_created, date_last_used, count)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.name,
      row.value,
      row.value.toLocaleLowerCase("en-US"),
      row.dateCreated,
      row.dateLastUsed,
      row.count,
    );
}

async function createWebData(
  path: string,
  rows: readonly AutofillRow[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    createWebDataSchema(database);
    for (const row of rows) {
      insertAutofill(database, row);
    }
  } finally {
    database.close();
  }
}

async function createSource(root: string): Promise<string> {
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "{}\n");
  await createWebData(join(source, "Default", "Web Data"), [
    // Unix seconds: 1704164645 -> 2024-01-02T03:04:05Z
    {
      name: "email",
      value: "alice@alpha.example",
      dateCreated: 1_704_164_645n,
      dateLastUsed: 1_704_251_045n,
      count: 4n,
    },
    {
      name: "phone",
      value: "+1-555-0100",
      dateCreated: 1_704_200_000n,
      dateLastUsed: 0n,
      count: 2n,
    },
    {
      name: "city",
      value: "Springfield",
      dateCreated: 1_704_300_000n,
      dateLastUsed: 1_704_400_000n,
      count: 7n,
    },
  ]);
  await createWebData(join(source, "Profile 1", "Web Data"), [
    {
      name: "address",
      value: "742 Evergreen Terrace",
      dateCreated: 1_705_000_000n,
      dateLastUsed: 1_705_100_000n,
      count: 1n,
    },
  ]);
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Web Data autofill metadata", () => {
  it("parses form/phone/address/city fields across Profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-web-e2e-"));
    temporaryRoots.push(root);
    const source = await createSource(root);
    const defaultBytes = await readFile(join(source, "Default", "Web Data"));
    const caseDirectory = join(root, "CASE-WEB");

    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli([
      "analyse",
      "--case",
      caseDirectory,
      "--timezone",
      "America/New_York",
      "--json",
    ]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      webData: {
        status: "complete",
        profileCount: 2,
        analysedProfileCount: 2,
        unavailableProfileCount: 0,
        committedFieldCount: 4,
        recoveredFieldCount: 0,
      },
    });

    // Bounded, multi-Profile keyset pagination ordered by creation time.
    const firstPage = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--sort",
        "created-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage).toMatchObject({ command: "autofill", limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const [email] = firstPage.items;
    expect(email).toBeDefined();
    // Field name/value exact vs ground truth, one Field State each,
    // with resolvable Provenance to the exact autofill rowid.
    expect(email).toMatchObject({
      recordType: "finding",
      findingKind: "autofill_entry",
      profile: "Default",
      commitState: "committed",
      provenance: {
        manifestPath: "Default/Web Data",
        database: "Default/Web Data",
        table: "autofill",
      },
      fields: {
        fieldName: { state: "value", value: "email" },
        fieldValue: { state: "value", value: "alice@alpha.example" },
        fieldValueLower: { state: "value", value: "alice@alpha.example" },
        timesUsed: { state: "value", value: "4" },
      },
    });
    expect(email?.provenance.rowId).toMatch(/^[0-9]+$/);
    // Timestamp keeps raw value, Epoch Family (unix-seconds), and UTC.
    expect(email?.fields.dateCreated).toEqual({
      state: "value",
      synthetic: false,
      value: {
        raw: "1704164645",
        epochFamily: "unix-seconds",
        utc: "2024-01-02T03:04:05.000Z",
        declaredTimezone: "America/New_York",
        resolution: "verified_web_data_schema_version_133",
      },
    });

    // A never-reused entry has date_last_used = 0: absent, not blank/unavailable.
    const phone = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--search",
        "555-0100",
        "--json",
      ]).stdout,
    ).items;
    expect(phone).toHaveLength(1);
    expect(phone[0]?.fields.fieldName).toEqual({
      state: "value",
      value: "phone",
    });
    expect(phone[0]?.fields.dateLastUsed).toEqual({ state: "absent" });

    // The Default Profile's `city` form field is matched by a value search.
    const city = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--search",
        "springfield",
        "--json",
      ]).stdout,
    ).items;
    expect(city).toHaveLength(1);
    expect(city[0]?.fields.fieldName).toEqual({
      state: "value",
      value: "city",
    });
    expect(city[0]?.fields.fieldValue).toEqual({
      state: "value",
      value: "Springfield",
    });

    const secondPage = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--sort",
        "created-time",
        "--direction",
        "asc",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const allIds = [...firstPage.items, ...secondPage.items].map(
      (item) => `${item.profile}:${item.provenance.rowId}`,
    );
    expect(new Set(allIds).size).toBe(4);
    expect(
      [...firstPage.items, ...secondPage.items].map((item) => item.profile),
    ).toContain("Profile 1");

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(source, "Default", "Web Data"))).toEqual(
      defaultBytes,
    );
  });

  it("keeps committed and WAL-resident autofill entries separate", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-web-wal-"));
    temporaryRoots.push(root);
    const source = join(root, "wal-source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    const webPath = join(source, "Default", "Web Data");
    await createWebData(webPath, [
      {
        name: "email",
        value: "committed@example",
        dateCreated: 1_704_164_645n,
        dateLastUsed: 1_704_164_645n,
        count: 1n,
      },
    ]);

    const writer = new DatabaseSync(webPath);
    writer.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    insertAutofill(writer, {
      name: "city",
      value: "Portland",
      dateCreated: 1_704_300_000n,
      dateLastUsed: 1_704_300_000n,
      count: 3n,
    });

    const caseDirectory = join(root, "CASE-WEB-WAL");
    try {
      expect(
        runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
      ).toBe(0);
    } finally {
      writer.close();
    }
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      webData: { committedFieldCount: 1, recoveredFieldCount: 1 },
    });

    const committed = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--commit-state",
        "committed",
        "--json",
      ]).stdout,
    );
    expect(committed.items).toHaveLength(1);
    expect(committed.items[0]).toMatchObject({
      commitState: "committed",
      provenance: { manifestPath: "Default/Web Data" },
      fields: { fieldValue: { state: "value", value: "committed@example" } },
    });

    const recovered = parseJson<AutofillPage>(
      runCli([
        "autofill",
        "--case",
        caseDirectory,
        "--commit-state",
        "wal_resident",
        "--json",
      ]).stdout,
    );
    expect(recovered.items).toHaveLength(1);
    expect(recovered.items[0]).toMatchObject({
      commitState: "wal_resident",
      provenance: {
        manifestPath: "Default/Web Data-wal",
        database: "Default/Web Data",
        table: "autofill",
      },
      fields: {
        fieldName: { state: "value", value: "city" },
        fieldValue: { state: "value", value: "Portland" },
      },
    });
  });

  it("distinguishes a missing autofill table from a malformed database", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-web-bad-"));
    temporaryRoots.push(root);
    const source = join(root, "bad-source");
    await mkdir(join(source, "Default"), { recursive: true });
    await writeFile(join(source, "Local State"), "{}\n");
    // A Web Data database with meta but no autofill table.
    const noTablePath = join(source, "Default", "Web Data");
    const database = new DatabaseSync(noTablePath);
    try {
      database.exec(`
        CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
        INSERT INTO meta (key, value) VALUES ('version', '133');
      `);
    } finally {
      database.close();
    }
    // Profile 1 has a malformed (non-SQLite) Web Data blob.
    await mkdir(join(source, "Profile 1"), { recursive: true });
    await writeFile(
      join(source, "Profile 1", "Web Data"),
      "this is not a sqlite database\n",
    );

    const caseDirectory = join(root, "CASE-WEB-BAD");
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // Both Profiles are unavailable, so the run is failed (exit code 3) for
    // Web Data, but distinguished by typed reasons in Completeness.
    const parsed = parseJson<{
      readonly webData: {
        readonly analysedProfileCount: number;
        readonly unavailableProfileCount: number;
      };
    }>(analysis.stdout);
    expect(parsed.webData.analysedProfileCount).toBe(0);
    expect(parsed.webData.unavailableProfileCount).toBe(2);

    // The two failures carry DISTINCT typed reasons in the Case: a missing
    // autofill table is not conflated with a malformed/unreadable database.
    const caseDatabase = new DatabaseSync(join(caseDirectory, "case.fxdb"), {
      readOnly: true,
    });
    let reasons: Record<string, string>;
    try {
      const rows = caseDatabase
        .prepare(
          `SELECT profile_path, status, reason
             FROM web_data_artifact_results
            ORDER BY profile_path`,
        )
        .all() as unknown as readonly {
        readonly profile_path: string;
        readonly status: string;
        readonly reason: string;
      }[];
      reasons = Object.fromEntries(
        rows.map((row) => {
          expect(row.status).toBe("unavailable");
          return [row.profile_path, row.reason];
        }),
      );
    } finally {
      caseDatabase.close();
    }
    // Missing table: a structured ANALYSIS_FAILED reason naming the table.
    expect(reasons.Default).toContain("missing the autofill table");
    // Malformed database: a distinct read-failure reason, not "missing".
    expect(reasons["Profile 1"]).not.toContain("missing the autofill table");
    expect(reasons["Profile 1"]).toMatch(
      /ANALYSIS_FAILED|web_data_read_failed/,
    );
    expect(reasons.Default).not.toBe(reasons["Profile 1"]);
  });
});
