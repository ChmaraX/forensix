/**
 * Agent-ready core queries over a real analysed Case, through the built core
 * package and the built read-only server (no CLI wiring needed):
 *
 *  - the shared Case opener and its typed errors;
 *  - record ids on every list surface and `getRecord`, including a row a
 *    second Analysis Run superseded;
 *  - `querySchema`, `queryCount`, `querySummary` over active rows only;
 *  - Timeline and site-findings filters with cursor paging;
 *  - `redactSecrets` and `limitSupportingRows`;
 *  - the server routes for the new queries and its error bodies.
 *
 * The Case comes from `buildDashboardCase`: 180 committed visits over three
 * days plus 120 WAL-resident visits, two saved logins decrypted at analyse
 * time, one plaintext cookie, one download.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as core from "../core/dist/index.js";
import { startDashboardServer } from "../server/dist/index.js";
import {
  COOKIE,
  DOWNLOAD_ONLY_HOST,
  HISTORY_DAYS,
  LOGINS,
  PROFILE,
  VISITS_PER_DAY,
  WAL_VISIT_COUNT,
  buildDashboardCase,
} from "./lib/dashboard-case.js";
import { parseJson, runCli } from "./lib/harness.js";

type Item = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly fields: Readonly<Record<string, { readonly state: string }>>;
};

const roots: string[] = [];
let caseDirectory = "";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-agent-core-"));
  roots.push(root);
  return root;
}

beforeAll(async () => {
  caseDirectory = await buildDashboardCase(await temporaryRoot());
}, 120_000);

afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function caught(read: () => unknown): {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
} {
  try {
    read();
  } catch (error) {
    const typed = error as {
      readonly code: string;
      readonly details: Readonly<Record<string, unknown>>;
    };
    return { code: typed.code, details: typed.details };
  }
  throw new Error("Expected the query to throw.");
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Every history visit, read page by page through the list query. */
function allVisits(): Item[] {
  const items: Item[] = [];
  let after: string | undefined;
  do {
    const page = core.queryHistory({ caseDirectory, limit: 100, after });
    items.push(...(page.items as unknown as Item[]));
    after = page.nextCursor ?? undefined;
  } while (after !== undefined);
  return items;
}

function utcOf(item: Item, field: string): string {
  const state = item.fields[field] as {
    readonly value?: { readonly utc?: string };
  };
  return state.value?.utc ?? "";
}

describe("shared Case opener", () => {
  it("reports a missing Case directory and a missing case.fxdb as CASE_NOT_FOUND", async () => {
    const root = await temporaryRoot();
    const missing = join(root, "no-such-case");
    const empty = join(root, "empty-case");
    await mkdir(empty);
    const queries = [
      (directory: string) => core.queryHistory({ caseDirectory: directory }),
      (directory: string) => core.queryCookies({ caseDirectory: directory }),
      (directory: string) => core.queryTimeline({ caseDirectory: directory }),
      (directory: string) => core.querySiteHosts({ caseDirectory: directory }),
      (directory: string) =>
        core.queryCompleteness({ caseDirectory: directory }),
      (directory: string) => core.querySummary({ caseDirectory: directory }),
      (directory: string) => core.querySchema({ caseDirectory: directory }),
      (directory: string) =>
        core.getRecord({ caseDirectory: directory, id: "cookies:1" }),
    ];
    for (const query of queries) {
      expect(caught(() => query(missing))).toEqual({
        code: "CASE_NOT_FOUND",
        details: { caseDirectory: missing },
      });
      expect(caught(() => query(empty))).toEqual({
        code: "CASE_NOT_FOUND",
        details: { caseDirectory: empty },
      });
    }
  });

  it("reports a non-Case file and a file path as CASE_INVALID", async () => {
    const root = await temporaryRoot();
    const garbage = join(root, "garbage-case");
    await mkdir(garbage);
    await writeFile(join(garbage, "case.fxdb"), "this is not SQLite\n");
    const emptyDatabase = join(root, "empty-database");
    await mkdir(emptyDatabase);
    await writeFile(join(emptyDatabase, "case.fxdb"), "");
    const plainFile = join(root, "plain-file");
    await writeFile(plainFile, "{}\n");
    for (const directory of [garbage, emptyDatabase, plainFile]) {
      expect(
        caught(() => core.querySummary({ caseDirectory: directory })),
      ).toEqual({
        code: "CASE_INVALID",
        details: { caseDirectory: directory },
      });
      expect(
        caught(() => core.queryCookies({ caseDirectory: directory })).code,
      ).toBe("CASE_INVALID");
    }
  });
});

describe("record ids and getRecord", () => {
  it("gives every list item a first-key id that getRecord returns unchanged", () => {
    const pages: { readonly items: readonly unknown[] }[] = [
      core.queryHistory({ caseDirectory, limit: 3 }),
      core.queryHistory({ caseDirectory, view: "activity", limit: 2 }),
      core.queryCookies({ caseDirectory }),
      core.queryCredentials({ caseDirectory }),
      core.queryDownloads({ caseDirectory }),
      core.queryMetadata({ caseDirectory }),
      core.queryCandidates({ caseDirectory }),
      core.queryTimeline({ caseDirectory, limit: 3 }),
    ];
    const seen = new Set<string>();
    for (const page of pages) {
      expect(page.items.length).toBeGreaterThan(0);
      for (const raw of page.items) {
        const item = raw as Item;
        expect(Object.keys(item)[0]).toBe("id");
        expect(item.id).toMatch(/^[a-z-]+:[1-9][0-9]*$/);
        seen.add(item.id.split(":")[0] ?? "");
        const fetched = core.getRecord({ caseDirectory, id: item.id });
        expect(fetched).toMatchObject({
          status: "ok",
          command: "get",
          active: true,
        });
        // The same record read by id equals the list item, key order too.
        expect(JSON.stringify(fetched.item)).toBe(JSON.stringify(item));
      }
    }
    expect([...seen].sort()).toEqual([
      "cookies",
      "downloads",
      "history",
      "identity-candidates",
      "logins",
      "preferences",
    ]);
  });

  it("gives site-findings items the id of the stored row behind them", () => {
    const page = core.querySiteFindings({
      caseDirectory,
      host: DOWNLOAD_ONLY_HOST,
    });
    expect(page.items.map((item) => item.id)).toEqual([
      expect.stringMatching(/^downloads:[0-9]+$/),
    ]);
    const item = page.items[0] as unknown as Item;
    const { artifactKind, hostFields, ...record } = item;
    expect(artifactKind).toBe("downloads");
    expect(hostFields).toEqual(["urlChain", "referrer", "tabUrl"]);
    expect(core.getRecord({ caseDirectory, id: item.id }).item).toEqual(record);
  });

  it("refuses malformed ids with the allowed store keys and reports unknown rows", () => {
    for (const id of [
      "cookies",
      "cookies:",
      "cookies:0",
      "cookies:abc",
      "cookies:-1",
      "Cookies:1",
      "unknown-store:1",
      "cookies:99999999999999999999",
      "",
    ]) {
      const error = caught(() => core.getRecord({ caseDirectory, id }));
      expect(error.code).toBe("INVALID_ARGUMENT");
      expect(error.details).toEqual({ id, allowed: core.RECORD_STORE_KEYS });
    }
    expect(core.RECORD_STORE_KEYS).toContain("identity-candidates");
    expect(
      caught(() =>
        core.getRecord({ caseDirectory, id: "cookies:9223372036854775807" }),
      ),
    ).toEqual({
      code: "RECORD_NOT_FOUND",
      details: { id: "cookies:9223372036854775807" },
    });
    expect(
      caught(() => core.getRecord({ caseDirectory, id: "bookmarks:1" })).code,
    ).toBe("RECORD_NOT_FOUND");
  });
});

describe("schema, count and summary", () => {
  it("describes each kind's fields from the active rows", () => {
    const schema = core.querySchema({ caseDirectory });
    expect(schema).toMatchObject({ status: "ok", command: "schema" });
    const summary = core.querySummary({ caseDirectory });
    // The two SQL paths agree on how many active records each kind holds.
    expect(
      schema.kinds.map(({ kind, store, recordType, count }) => ({
        kind,
        store,
        recordType,
        count,
      })),
    ).toEqual(
      summary.records.map(({ kind, store, recordType, total }) => ({
        kind,
        store,
        recordType,
        count: total,
      })),
    );
    const field = (kind: string, name: string) =>
      schema.kinds
        .find((entry) => entry.kind === kind)
        ?.fields.find((entry) => entry.name === name);
    expect(field("login_credential", "secret")).toEqual({
      name: "secret",
      states: { value: LOGINS.length, absent: 0, unavailable: 0 },
      empty: 0,
      valueTypes: ["string"],
    });
    expect(field("login_credential", "actionUrl")).toMatchObject({
      states: { value: 0, absent: LOGINS.length, unavailable: 0 },
      valueTypes: [],
    });
    expect(field("cookie", "topFrameSiteKey")).toMatchObject({
      states: { value: 1, absent: 0, unavailable: 0 },
      empty: 1,
    });
    expect(field("history_visit", "visitTime")).toMatchObject({
      states: {
        value: HISTORY_DAYS.length * VISITS_PER_DAY + WAL_VISIT_COUNT,
      },
      valueTypes: ["timestamp"],
    });
    expect(field("cookie", "isSecure")?.valueTypes).toEqual(["boolean"]);
    // Field order follows the record, not the alphabet.
    expect(
      schema.kinds
        .find((entry) => entry.kind === "cookie")
        ?.fields.slice(0, 3)
        .map((entry) => entry.name),
    ).toEqual(["cookieId", "hostKey", "name"]);
  });

  it("filters schema by kind and refuses an unknown kind", () => {
    expect(core.querySchema({ caseDirectory, kind: "cookie" }).kinds).toEqual([
      expect.objectContaining({ kind: "cookie", store: "cookies", count: 1 }),
    ]);
    // A known kind the Case holds no rows of is reported, empty.
    expect(core.querySchema({ caseDirectory, kind: "bookmark" }).kinds).toEqual(
      [
        {
          recordType: "finding",
          kind: "bookmark",
          store: "bookmarks",
          count: 0,
          fields: [],
        },
      ],
    );
    const error = caught(() =>
      core.querySchema({ caseDirectory, kind: "cookies" }),
    );
    expect(error.code).toBe("INVALID_ARGUMENT");
    expect(error.details.allowed).toContain("cookie");
  });

  it("counts a timestamp field by UTC day, matching the visits the list returns", () => {
    const visits = allVisits();
    const expected = new Map<string, number>();
    for (const visit of visits) {
      const day = utcOf(visit, "visitTime").slice(0, 10);
      expected.set(day, (expected.get(day) ?? 0) + 1);
    }
    const counted = core.queryCount({
      caseDirectory,
      kind: "history_visit",
      by: "visitTime",
    });
    expect(counted).toMatchObject({
      status: "ok",
      command: "count",
      kind: "history_visit",
      by: "visitTime",
      total: visits.length,
      otherCount: 0,
      limit: 20,
    });
    expect(
      Object.fromEntries(counted.buckets.map((b) => [b.key, b.count])),
    ).toEqual(Object.fromEntries(expected));
    // Count desc, then key asc.
    const order = [...counted.buckets].sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    );
    expect(counted.buckets).toEqual(order);

    // Committed only: one bucket per Case day, VISITS_PER_DAY each.
    expect(
      core.queryCount({
        caseDirectory,
        kind: "history_visit",
        by: "visitTime",
        commitState: "committed",
      }).buckets,
    ).toEqual(HISTORY_DAYS.map((day) => ({ key: day, count: VISITS_PER_DAY })));

    // limit cuts buckets, and otherCount holds the rest.
    const top = core.queryCount({
      caseDirectory,
      kind: "history_visit",
      by: "visitTime",
      limit: 1,
    });
    expect(top.buckets).toHaveLength(1);
    expect(top.otherCount).toBe(visits.length - (top.buckets[0]?.count ?? 0));
  });

  it("counts by the built-ins and by non-value states", () => {
    expect(
      core.queryCount({
        caseDirectory,
        kind: "history_visit",
        by: "commitState",
      }).buckets,
    ).toEqual([
      { key: "committed", count: HISTORY_DAYS.length * VISITS_PER_DAY },
      { key: "wal_resident", count: WAL_VISIT_COUNT },
    ]);
    expect(
      core.queryCount({ caseDirectory, kind: "cookie", by: "profile" }).buckets,
    ).toEqual([{ key: PROFILE, count: 1 }]);
    expect(
      core.queryCount({
        caseDirectory,
        kind: "login_credential",
        by: "actionUrl",
      }).buckets,
    ).toEqual([{ key: "(absent)", count: LOGINS.length }]);
    const searched = core.queryCount({
      caseDirectory,
      kind: "login_credential",
      by: "usernameValue",
      search: LOGINS[0].username.toUpperCase(),
    });
    expect(searched).toMatchObject({
      total: 1,
      buckets: [{ key: LOGINS[0].username, count: 1 }],
    });
  });

  it("refuses an unknown kind, field, limit and a Commit State the kind lacks", () => {
    const unknownField = caught(() =>
      core.queryCount({ caseDirectory, kind: "history_visit", by: "visitDay" }),
    );
    expect(unknownField.code).toBe("INVALID_ARGUMENT");
    expect(unknownField.details.allowed).toEqual(
      expect.arrayContaining(["profile", "commitState", "visitTime", "url"]),
    );
    const unknownKind = caught(() =>
      core.queryCount({ caseDirectory, kind: "visit", by: "url" }),
    );
    expect(unknownKind.code).toBe("INVALID_ARGUMENT");
    expect(unknownKind.details.allowed).toContain("history_visit");
    for (const limit of [0, 101, 1.5]) {
      expect(
        caught(() =>
          core.queryCount({
            caseDirectory,
            kind: "cookie",
            by: "name",
            limit,
          }),
        ).code,
      ).toBe("INVALID_ARGUMENT");
    }
    expect(
      caught(() =>
        core.queryCount({
          caseDirectory,
          kind: "behavior_frequent_host",
          by: "commitState",
        }),
      ).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("summarises the Case with counts only", () => {
    const summary = core.querySummary({ caseDirectory });
    expect(summary).toMatchObject({
      status: "ok",
      command: "summary",
      sources: [{ sourceKind: "USER_DATA_DIR", profileCount: 1 }],
      analysis: {
        exitState: "complete",
        declaredTimezone: "UTC",
        endedAt: expect.any(String),
      },
    });
    expect(summary.profiles).toContain(PROFILE);
    expect(
      summary.records.find((record) => record.kind === "history_visit"),
    ).toEqual({
      recordType: "finding",
      kind: "history_visit",
      store: "history",
      committed: HISTORY_DAYS.length * VISITS_PER_DAY,
      recovered: WAL_VISIT_COUNT,
      total: HISTORY_DAYS.length * VISITS_PER_DAY + WAL_VISIT_COUNT,
    });
    expect(
      summary.records.find((record) => record.store === "identity-candidates"),
    ).toMatchObject({ committed: null, recovered: null });
    // The span is the Timeline's first and last instant.
    const oldest = core.queryTimeline({
      caseDirectory,
      direction: "asc",
      limit: 1,
    }).items[0] as unknown as Item;
    const newest = core.queryTimeline({ caseDirectory, limit: 1 })
      .items[0] as unknown as Item;
    expect(summary.timeSpan).toEqual({
      earliest: utcOf(oldest, "visitTime"),
      latest: utcOf(newest, "visitTime"),
    });
    expect(
      summary.completeness.find((entry) => entry.artifact === "History"),
    ).toEqual({
      artifact: "History",
      attempted: 1,
      produced: 1,
      absent: 0,
      unavailable: 0,
    });
    expect(JSON.stringify(summary)).not.toContain("provenance");
  });
});

describe("Timeline and site-findings filters", () => {
  it("pages a filtered Timeline exactly once and agrees with count", () => {
    const filters = {
      caseDirectory,
      kinds: ["history_visit"],
      profiles: [PROFILE],
      commitState: "wal_resident",
      search: "RECOVERED.EXAMPLE",
      limit: 7,
    } as const;
    const ids: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = core.queryTimeline({ ...filters, after });
      for (const raw of page.items) {
        const item = raw as unknown as Item;
        expect(item).toMatchObject({
          findingKind: "history_visit",
          profile: PROFILE,
          commitState: "wal_resident",
        });
        ids.push(item.id);
      }
      after = page.nextCursor ?? undefined;
      pages += 1;
    } while (after !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pages).toBeGreaterThan(1);
    expect(ids.length).toBe(
      core.queryCount({
        caseDirectory,
        kind: "history_visit",
        by: "commitState",
        commitState: "wal_resident",
        search: "recovered.example",
      }).total,
    );

    const first = core.queryTimeline(filters);
    expect(
      caught(() =>
        core.queryTimeline({
          ...filters,
          commitState: "committed",
          after: first.nextCursor ?? undefined,
        }),
      ).code,
    ).toBe("INVALID_CURSOR");

    expect(
      core
        .queryTimeline({ caseDirectory, kinds: ["cookie", "download"] })
        .items.map((item) => item.findingKind)
        .sort(),
    ).toEqual(["cookie", "download"]);
  });

  it("filters site-findings by artifact kind and Commit State", () => {
    const logins = core.querySiteFindings({
      caseDirectory,
      host: "alpha.example",
      kinds: ["saved_logins"],
    });
    expect(logins.items.map((item) => item.artifactKind)).toEqual([
      "saved_logins",
    ]);
    expect(logins.items[0]?.id).toMatch(/^logins:/);

    const recovered = core.querySiteFindings({
      caseDirectory,
      host: "recovered.example",
      kinds: ["visits"],
      commitState: "wal_resident",
      profiles: [PROFILE],
      limit: 50,
    });
    expect(recovered.items.length).toBeGreaterThan(0);
    for (const item of recovered.items) {
      expect(item.commitState).toBe("wal_resident");
    }
    expect(
      core.querySiteFindings({
        caseDirectory,
        host: "recovered.example",
        commitState: "committed",
      }).items,
    ).toEqual([]);
    const error = caught(() =>
      core.querySiteFindings({
        caseDirectory,
        host: "alpha.example",
        kinds: ["history_visit"],
      }),
    );
    expect(error).toEqual({
      code: "INVALID_ARGUMENT",
      details: { value: "history_visit", allowed: core.SITE_ARTIFACT_KINDS },
    });
  });
});

describe("redactSecrets and limitSupportingRows", () => {
  it("withholds the decrypted cookie value and saved password, nothing else", () => {
    const cookie = core.queryCookies({ caseDirectory }).items[0];
    if (cookie === undefined) throw new Error("No cookie.");
    const before = JSON.stringify(cookie);
    const redacted = core.redactSecrets(cookie);
    expect(redacted.redactedCount).toBe(1);
    expect(redacted.item.fields.value).toEqual({
      state: "redacted",
      reason: "plaintext_secret_withheld",
      sha256: sha256Json(COOKIE.value),
    });
    expect(redacted.item.fields.name).toEqual(cookie.fields.name);
    expect(redacted.item.id).toBe(cookie.id);
    expect(JSON.stringify(redacted.item)).not.toContain(COOKIE.value);
    expect(JSON.stringify(cookie)).toBe(before);

    const credentials = core.queryCredentials({ caseDirectory }).items;
    const redactedCredentials = credentials.map((item) =>
      core.redactSecrets(item),
    );
    expect(redactedCredentials.map((entry) => entry.redactedCount)).toEqual(
      LOGINS.map(() => 1),
    );
    const text = JSON.stringify(redactedCredentials);
    for (const login of LOGINS) {
      expect(text).not.toContain(login.password);
      expect(text).toContain(login.username);
    }

    const visit = core.queryHistory({ caseDirectory, limit: 1 }).items[0];
    if (visit === undefined) throw new Error("No visit.");
    expect(core.redactSecrets(visit)).toEqual({
      item: visit,
      redactedCount: 0,
    });

    // A count by a secret field can hide the value the same way.
    const counted = core.queryCount({
      caseDirectory,
      kind: "cookie",
      by: "value",
      redactSecrets: true,
    });
    expect(counted.buckets).toEqual([
      { key: `(redacted:sha256:${sha256Json(COOKIE.value)})`, count: 1 },
    ]);
  });

  it("keeps the first supporting rows and records the original total", () => {
    const summary = core.queryHistory({
      caseDirectory,
      view: "activity",
      sort: "visit-count",
      limit: 1,
    }).items[0];
    if (summary === undefined) throw new Error("No activity summary.");
    const rows = summary.provenance.supportingRows ?? [];
    expect(rows.length).toBeGreaterThan(3);
    const limited = core.limitSupportingRows(summary, 3);
    expect(limited.provenance).toEqual({
      ...summary.provenance,
      supportingRows: rows.slice(0, 3),
      supportingRowCount: rows.length,
      supportingRowsTruncated: true,
    });
    expect(summary.provenance.supportingRows).toHaveLength(rows.length);
    // Nothing to cut: the record is returned as it is, with no markers.
    expect(core.limitSupportingRows(summary, rows.length)).toBe(summary);
    expect(caught(() => core.limitSupportingRows(summary, -1)).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("applies the limit to nested supporting rows of the kept rows", () => {
    const row = (rowId: string) => ({
      manifestEntryId: "S:1",
      sourceId: "S",
      manifestEntryOrdinal: 1,
      manifestPath: "Default/History",
      database: "Default/History",
      table: "visits",
      rowId,
    });
    const nested = {
      ...row("10"),
      supportingRows: [row("11"), row("12"), row("13")],
    };
    const record = {
      provenance: {
        ...row("1"),
        supportingRows: [nested, row("2")],
      },
    };
    expect(core.limitSupportingRows(record, 2).provenance).toEqual({
      ...row("1"),
      supportingRows: [
        {
          ...row("10"),
          supportingRows: [row("11"), row("12")],
          supportingRowCount: 3,
          supportingRowsTruncated: true,
        },
        row("2"),
      ],
    });
  });
});

describe("superseded rows", () => {
  it("returns a superseded row by id with active false while queries read only the active run", async () => {
    const directory = await buildDashboardCase(await temporaryRoot());
    const firstRun = core.queryCredentials({ caseDirectory: directory }).items;
    expect(firstRun.map((item) => item.fields.secret?.state)).toEqual([
      "value",
      "value",
    ]);

    // A second Analysis Run without --decrypt supersedes every row.
    const rerun = runCli([
      "analyse",
      "--case",
      directory,
      "--timezone",
      "UTC",
      "--no-topic-classification",
      "--json",
    ]);
    expect(rerun.status).toBe(0);
    const analysed = parseJson<Record<string, unknown>>(rerun.stdout);
    expect(analysed).toMatchObject({
      status: "ok",
      command: "analyse",
      workingCopyVerification: "verified",
      exitState: "complete",
    });

    const secondRun = core.queryCredentials({ caseDirectory: directory }).items;
    expect(secondRun).toHaveLength(LOGINS.length);
    const firstIds = firstRun.map((item) => item.id);
    for (const item of secondRun) {
      expect(firstIds).not.toContain(item.id);
      expect(item.fields.secret).toEqual({
        state: "unavailable",
        reason: "encrypted_secret_without_key_material",
      });
    }
    for (const old of firstRun) {
      const fetched = core.getRecord({ caseDirectory: directory, id: old.id });
      expect(fetched.active).toBe(false);
      expect(JSON.stringify(fetched.item)).toBe(JSON.stringify(old));
    }
    expect(
      core.getRecord({ caseDirectory: directory, id: secondRun[0]?.id ?? "" })
        .active,
    ).toBe(true);

    // Schema, count and summary see only the active run.
    const secret = core
      .querySchema({ caseDirectory: directory, kind: "login_credential" })
      .kinds[0]?.fields.find((field) => field.name === "secret");
    expect(secret?.states).toEqual({
      value: 0,
      absent: 0,
      unavailable: LOGINS.length,
    });
    expect(
      core.queryCount({
        caseDirectory: directory,
        kind: "login_credential",
        by: "secret",
      }),
    ).toMatchObject({
      total: LOGINS.length,
      buckets: [
        {
          key: "(unavailable:encrypted_secret_without_key_material)",
          count: LOGINS.length,
        },
      ],
    });
    const summary = core.querySummary({ caseDirectory: directory });
    expect(summary.analysis?.runId).toBe(analysed.runId);
    expect(
      summary.records.find((record) => record.kind === "login_credential")
        ?.total,
    ).toBe(LOGINS.length);
    // An unavailable secret is not a plaintext secret: nothing to redact.
    expect(core.redactSecrets(secondRun[0] as never).redactedCount).toBe(0);
  }, 120_000);
});

describe("server routes", () => {
  it("answers schema, count, summary and get like core, with typed error bodies", async () => {
    const server = await startDashboardServer({ caseDirectory });
    const base = server.url.replace(/\/$/, "");
    const get = async (
      route: string,
      parameters: readonly [string, string][] = [],
      token = server.token,
    ) => {
      const query = new URLSearchParams([...parameters]).toString();
      const response = await fetch(
        `${base}/api/${route}${query === "" ? "" : `?${query}`}`,
        { headers: { "x-forensix-token": token, origin: base } },
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    };
    try {
      expect(await get("summary")).toEqual({
        status: 200,
        body: JSON.parse(JSON.stringify(core.querySummary({ caseDirectory }))),
      });
      expect((await get("schema", [["kind", "cookie"]])).body).toEqual(
        JSON.parse(
          JSON.stringify(core.querySchema({ caseDirectory, kind: "cookie" })),
        ),
      );
      expect(
        (
          await get("count", [
            ["kind", "history_visit"],
            ["by", "commitState"],
            ["profile", PROFILE],
          ])
        ).body,
      ).toMatchObject({
        status: "ok",
        command: "count",
        total: HISTORY_DAYS.length * VISITS_PER_DAY + WAL_VISIT_COUNT,
      });
      // The server stays plaintext: the dashboard has its own reveal control.
      const login = core.queryCredentials({ caseDirectory }).items[0];
      const fetched = await get("get", [["id", login?.id ?? ""]]);
      expect(fetched.status).toBe(200);
      const text = JSON.stringify(fetched.body);
      const saved = LOGINS.find((entry) => text.includes(entry.username));
      expect(text).toContain(saved?.password ?? "no saved login");

      const timeline = await get("timeline", [
        ["kind", "cookie"],
        ["kind", "download"],
      ]);
      expect(
        (timeline.body.items as Item[]).map((item) => item.id.split(":")[0]),
      ).toEqual(expect.arrayContaining(["cookies", "downloads"]));

      expect(await get("get", [["id", "cookies:x"]])).toMatchObject({
        status: 400,
        body: { status: "error", code: "INVALID_ARGUMENT" },
      });
      expect(await get("get", [["id", "cookies:999999"]])).toMatchObject({
        status: 404,
        body: { status: "error", code: "RECORD_NOT_FOUND" },
      });
      expect(await get("count", [["kind", "cookie"]])).toMatchObject({
        status: 400,
        body: { status: "error", code: "INVALID_ARGUMENT" },
      });
      expect(await get("summary", [], "wrong-token")).toMatchObject({
        status: 401,
        body: { status: "error", code: "UNAUTHORIZED" },
      });
      expect(await get("no-such-route")).toMatchObject({
        status: 400,
        body: { status: "error", code: "INVALID_ARGUMENT" },
      });
    } finally {
      await server.close();
    }
  });

  it("answers a missing Case with a CASE_NOT_FOUND error body", async () => {
    const missing = join(await temporaryRoot(), "gone");
    const server = await startDashboardServer({ caseDirectory: missing });
    try {
      const base = server.url.replace(/\/$/, "");
      const response = await fetch(`${base}/api/summary`, {
        headers: { "x-forensix-token": server.token, origin: base },
      });
      expect(await response.json()).toEqual({
        status: "error",
        code: "CASE_NOT_FOUND",
        message: `Case directory does not exist: ${missing}`,
        details: { caseDirectory: missing },
      });
    } finally {
      await server.close();
    }
  });
});
