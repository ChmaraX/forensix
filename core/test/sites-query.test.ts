import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { CASE_FILENAME } from "../src/case.js";
import {
  queryFaviconBitmaps,
  querySiteFavicons,
} from "../src/site-favicons-query.js";
import { cacheResourceUrl, siteHostKey } from "../src/site-host-key.js";
import { querySiteFindings, querySiteHosts } from "../src/sites-query.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function caseDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "forensix-sites-"));
  roots.push(root);
  const database = new DatabaseSync(join(root, CASE_FILENAME));
  database.exec(`
    PRAGMA application_id = 1180191282;
    PRAGMA user_version = 2;
    CREATE TABLE case_info (case_id TEXT);
    INSERT INTO case_info VALUES ('CASE-TEST');
    CREATE TABLE history_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE cookie_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE login_data_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE bookmarks_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE top_sites_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE forensic_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
    CREATE TABLE cookie_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, host_key TEXT);
    CREATE TABLE login_data_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_origin TEXT);
    CREATE TABLE bookmarks_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
    CREATE TABLE top_sites_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_url TEXT);
    CREATE TABLE downloads_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE cache_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE favicon_artifact_results (artifact_result_id INTEGER, active INTEGER);
    CREATE TABLE downloads_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT);
    CREATE TABLE cache_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_key TEXT);
    CREATE TABLE favicon_findings (finding_id INTEGER, artifact_result_id INTEGER, record_type TEXT, finding_kind TEXT, profile_path TEXT, commit_state TEXT, provenance_json TEXT, fields_json TEXT, sort_icon_url TEXT, sort_width INTEGER);
  `);
  database.close();
  return root;
}

function insert(
  directory: string,
  table: string,
  results: string,
  kind: string,
  hostColumn: string,
  hostValue: string,
  id: number,
  commitState = "committed",
): void {
  const database = new DatabaseSync(join(directory, CASE_FILENAME));
  const provenance = JSON.stringify({
    sourceId: "SRC",
    manifestEntryOrdinal: 0,
    manifestEntryId: "SRC:0",
    manifestPath: "Default/History",
    database: "History",
    table,
    rowId: String(id),
  });
  const fields = JSON.stringify({
    recorded: { state: "value", value: hostValue },
    missing: { state: "absent" },
  });
  database.prepare(`INSERT INTO ${results} VALUES (?, 1)`).run(id);
  database
    .prepare(
      `INSERT INTO ${table} VALUES (?, ?, 'finding', ?, 'Default', ?, ?, ?, ?)`,
    )
    .run(id, id, kind, commitState, provenance, fields, hostValue);
  database.close();
}

const value = (recorded: unknown) => ({ state: "value", value: recorded });

/** A row in a table whose host fields live in the fields JSON (and, for
 *  cache and favicons, a write-time column copy). */
function insertRow(
  directory: string,
  row: {
    readonly table:
      | "downloads_findings"
      | "cache_findings"
      | "favicon_findings";
    readonly kind: string;
    readonly id: number;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly commitState?: string;
    readonly column?: string | null;
    readonly width?: number;
    readonly fieldsJson?: string;
  },
): void {
  const results = {
    downloads_findings: "downloads_artifact_results",
    cache_findings: "cache_artifact_results",
    favicon_findings: "favicon_artifact_results",
  }[row.table];
  const database = new DatabaseSync(join(directory, CASE_FILENAME));
  const provenance = JSON.stringify({
    sourceId: "SRC",
    manifestEntryOrdinal: 0,
    manifestEntryId: "SRC:0",
    manifestPath: "Default/X",
    database: "X",
    table: row.table,
    rowId: String(row.id),
    // A journal_resident row cites the hot journal that shows it uncommitted.
    ...(row.commitState === "journal_resident"
      ? {
          recoveredVia: {
            manifestEntryId: "SRC:1",
            sourceId: "SRC",
            manifestEntryOrdinal: 1,
            manifestPath: "Default/X-journal",
          },
        }
      : {}),
  });
  database.prepare(`INSERT INTO ${results} VALUES (?, 1)`).run(row.id);
  const base = [
    row.id,
    row.id,
    row.kind,
    row.commitState ?? "committed",
    provenance,
    row.fieldsJson ?? JSON.stringify(row.fields),
  ] as const;
  if (row.table === "downloads_findings")
    database
      .prepare(
        `INSERT INTO downloads_findings VALUES (?, ?, 'finding', ?, 'Default', ?, ?, ?)`,
      )
      .run(...base);
  else if (row.table === "cache_findings")
    database
      .prepare(
        `INSERT INTO cache_findings VALUES (?, ?, 'finding', ?, 'Default', ?, ?, ?, ?)`,
      )
      .run(...base, row.column ?? null);
  else
    database
      .prepare(
        `INSERT INTO favicon_findings VALUES (?, ?, 'finding', ?, 'Default', ?, ?, ?, ?, ?)`,
      )
      .run(...base, row.column ?? null, row.width ?? null);
  database.close();
}

describe("Sites host keys", () => {
  it("keys URLs by hostname and cookie host keys by themselves", () => {
    expect(siteHostKey("https://User@WWW.Example.com:8080/a?b#c")).toBe(
      "www.example.com",
    );
    expect(siteHostKey(".Example.com")).toBe("example.com");
    expect(siteHostKey("example.com")).toBe("example.com");
    expect(siteHostKey("[::1]")).toBe("[::1]");
    expect(siteHostKey("about:blank")).toBeNull();
    expect(siteHostKey("")).toBeNull();
    expect(siteHostKey(null)).toBeNull();
  });

  it("reads a cache key's resource URL, never its isolation scope", () => {
    expect(cacheResourceUrl("https://www.example.com/a.js")).toBe(
      "https://www.example.com/a.js",
    );
    expect(
      cacheResourceUrl(
        "1/0/_dk_https://top.example https://frame.example https://cdn.example/x.js",
      ),
    ).toBe("https://cdn.example/x.js");
    expect(cacheResourceUrl("1/0/https://example.com/")).toBe(
      "https://example.com/",
    );
    expect(cacheResourceUrl("_dk_https://example.com/")).toBe(
      "https://example.com/",
    );
    expect(cacheResourceUrl("not a url")).toBeNull();
    expect(cacheResourceUrl("file:///etc/passwd")).toBeNull();
    expect(cacheResourceUrl(null)).toBeNull();
  });
});

describe("Sites queries", () => {
  it("lists recorded hosts with per-artifact counts and returns host findings", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/a",
      1,
    );
    insert(
      directory,
      "cookie_findings",
      "cookie_artifact_results",
      "cookie",
      "host_key",
      ".example.com",
      2,
    );
    insert(
      directory,
      "login_data_findings",
      "login_data_artifact_results",
      "login_credential",
      "sort_origin",
      "https://example.com/login",
      3,
    );
    insert(
      directory,
      "bookmarks_findings",
      "bookmarks_artifact_results",
      "bookmark",
      "sort_url",
      "https://other.test/",
      4,
    );

    expect(querySiteHosts({ caseDirectory: directory }).items).toEqual([
      {
        host: "example.com",
        counts: {
          visits: 1,
          cookies: 1,
          saved_logins: 1,
          bookmarks: 0,
          top_sites: 0,
          downloads: 0,
          cache: 0,
          favicons: 0,
        },
        savedCounts: {
          visits: 1,
          cookies: 1,
          saved_logins: 1,
          bookmarks: 0,
          top_sites: 0,
          downloads: 0,
          cache: 0,
          favicons: 0,
        },
      },
      {
        host: "other.test",
        counts: {
          visits: 0,
          cookies: 0,
          saved_logins: 0,
          bookmarks: 1,
          top_sites: 0,
          downloads: 0,
          cache: 0,
          favicons: 0,
        },
        savedCounts: {
          visits: 0,
          cookies: 0,
          saved_logins: 0,
          bookmarks: 1,
          top_sites: 0,
          downloads: 0,
          cache: 0,
          favicons: 0,
        },
      },
    ]);
    const findings = querySiteFindings({
      caseDirectory: directory,
      host: "example.com",
    });
    expect(findings.items).toHaveLength(3);
    expect(findings.items.map((item) => item.artifactKind)).toEqual([
      "cookies",
      "saved_logins",
      "visits",
    ]);
    expect(findings.items[0]?.provenance.rowId).toBe("2");
  });

  it("keys host-only and domain cookie host keys and URL hostnames without domain expansion", async () => {
    const directory = await caseDirectory();
    const cookie = (hostValue: string, id: number) => {
      insert(
        directory,
        "cookie_findings",
        "cookie_artifact_results",
        "cookie",
        "host_key",
        hostValue,
        id,
      );
    };
    const visit = (url: string, id: number) => {
      insert(
        directory,
        "forensic_findings",
        "history_artifact_results",
        "history_visit",
        "sort_url",
        url,
        id,
      );
    };
    // Host-only cookie: Chrome records the host key with no leading dot.
    cookie("example.com", 1);
    // Domain cookie: a leading dot.
    cookie(".Example.com", 2);
    // A host-only cookie on www stays its own host.
    cookie("www.example.com", 3);
    visit("https://www.example.com/a", 4);
    // A port is not part of the key.
    visit("http://example.com:8080/b", 5);
    // Not hosts: no host key and no URL hostname.
    visit("about:blank", 6);
    cookie("not a host", 7);

    const hosts = querySiteHosts({ caseDirectory: directory }).items;
    expect(
      hosts.map((item) => [item.host, item.counts.cookies, item.counts.visits]),
    ).toEqual([
      ["example.com", 2, 1],
      ["www.example.com", 1, 1],
    ]);
    expect(
      querySiteFindings({ caseDirectory: directory, host: "example.com" })
        .items.map((item) => item.provenance.rowId)
        .sort(),
    ).toEqual(["1", "2", "5"]);
    expect(
      querySiteFindings({ caseDirectory: directory, host: "www.example.com" })
        .items.map((item) => item.provenance.rowId)
        .sort(),
    ).toEqual(["3", "4"]);
  });

  it("filters host names by search and returns an empty page when nothing matches", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/a",
      1,
    );
    expect(
      querySiteHosts({ caseDirectory: directory, search: "AMPLE" }).items.map(
        (item) => item.host,
      ),
    ).toEqual(["example.com"]);
    expect(
      querySiteHosts({ caseDirectory: directory, search: "missing" }),
    ).toMatchObject({ items: [], nextCursor: null });
    expect(
      querySiteFindings({ caseDirectory: directory, host: "missing.test" }),
    ).toMatchObject({ items: [], nextCursor: null });
  });

  it("counts saved rows apart from recovered rows", async () => {
    const directory = await caseDirectory();
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/a",
      1,
    );
    insert(
      directory,
      "forensic_findings",
      "history_artifact_results",
      "history_visit",
      "sort_url",
      "https://example.com/b",
      2,
      "wal_resident",
    );
    const [host] = querySiteHosts({ caseDirectory: directory }).items;
    expect(host?.counts.visits).toBe(2);
    expect(host?.savedCounts.visits).toBe(1);
  });

  it("pages hosts in cursor order, punctuation included", async () => {
    const directory = await caseDirectory();
    const hosts = ["ab.test", "a-b.test", "a.test", "b.test", "a-c.test"];
    hosts.forEach((host, index) => {
      insert(
        directory,
        "forensic_findings",
        "history_artifact_results",
        "history_visit",
        "sort_url",
        `https://${host}/`,
        index + 1,
      );
    });
    const seen: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = querySiteHosts({
        caseDirectory: directory,
        limit: 2,
        after,
      });
      seen.push(...result.items.map((item) => item.host));
      if (result.nextCursor === null) break;
      after = result.nextCursor;
    }
    expect(seen).toEqual([...hosts].sort());
  });

  it("pages a host's findings by numeric id across digit lengths", async () => {
    const directory = await caseDirectory();
    for (let id = 1; id <= 23; id += 1) {
      insert(
        directory,
        "forensic_findings",
        "history_artifact_results",
        "history_visit",
        "sort_url",
        `https://example.com/${String(id)}`,
        id,
      );
    }
    const seen: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = querySiteFindings({
        caseDirectory: directory,
        host: "example.com",
        limit: 4,
        after,
      });
      seen.push(...result.items.map((item) => item.provenance.rowId));
      if (result.nextCursor === null) break;
      after = result.nextCursor;
    }
    expect(seen).toEqual(
      Array.from({ length: 23 }, (_, index) => String(index + 1)),
    );
  });

  it("rejects a findings cursor whose key is not a position", async () => {
    const directory = await caseDirectory();
    for (const id of [1, 2]) {
      insert(
        directory,
        "forensic_findings",
        "history_artifact_results",
        "history_visit",
        "sort_url",
        `https://example.com/${String(id)}`,
        id,
      );
    }
    const { nextCursor } = querySiteFindings({
      caseDirectory: directory,
      host: "example.com",
      limit: 1,
    });
    expect(nextCursor).not.toBeNull();
    const payload = JSON.parse(
      Buffer.from(nextCursor ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const forged = Buffer.from(
      JSON.stringify({ ...payload, key: "visits:abc" }),
    ).toString("base64url");
    expect(() =>
      querySiteFindings({
        caseDirectory: directory,
        host: "example.com",
        after: forged,
      }),
    ).toThrow(/cursor does not belong/);
  });

  it("puts downloads on the hosts they came from, each host once", async () => {
    const directory = await caseDirectory();
    insertRow(directory, {
      table: "downloads_findings",
      kind: "download",
      id: 1,
      fields: {
        urlChain: value([
          "https://files.test/start",
          "https://cdn.files.test/blob",
          "https://files.test/again",
        ]),
        originalUrl: value("https://files.test/start"),
        finalUrl: value("https://files.test/again"),
        referrer: value("https://links.test/page"),
        tabUrl: value("https://files.test/page"),
        // Not where it came from: the storage partition and the tab's own
        // referrer.
        siteUrl: value("https://partition.test/"),
        tabReferrerUrl: value("https://before.test/"),
      },
    });
    insertRow(directory, {
      table: "downloads_findings",
      kind: "download",
      id: 2,
      commitState: "wal_resident",
      fields: {
        urlChain: { state: "absent" },
        referrer: { state: "unavailable", reason: "unsupported_value" },
        tabUrl: value("https://files.test/other"),
      },
    });
    const hosts = querySiteHosts({ caseDirectory: directory }).items;
    expect(
      hosts.map((item) => [
        item.host,
        item.counts.downloads,
        item.savedCounts.downloads,
      ]),
    ).toEqual([
      ["cdn.files.test", 1, 1],
      ["files.test", 2, 1],
      ["links.test", 1, 1],
    ]);
    const findings = querySiteFindings({
      caseDirectory: directory,
      host: "files.test",
    }).items;
    expect(
      findings.map((item) => [
        item.artifactKind,
        item.provenance.rowId,
        item.hostFields,
      ]),
    ).toEqual([
      ["downloads", "1", ["urlChain", "tabUrl"]],
      ["downloads", "2", ["tabUrl"]],
    ]);
    expect(findings[0]?.fields.siteUrl).toEqual(
      value("https://partition.test/"),
    );
  });

  it("puts a cache entry on its resource host and a favicon on its icon and page hosts", async () => {
    const directory = await caseDirectory();
    const key =
      "1/0/_dk_https://top.test https://frame.test https://cdn.test/app.js";
    insertRow(directory, {
      table: "cache_findings",
      kind: "cache_entry",
      id: 1,
      column: key,
      fields: { key: value(key) },
    });
    insertRow(directory, {
      table: "cache_findings",
      kind: "cache_entry",
      id: 2,
      column: null,
      fields: { key: { state: "unavailable", reason: "unsupported_value" } },
    });
    insertRow(directory, {
      table: "favicon_findings",
      kind: "favicon",
      id: 3,
      column: "https://icons.test/favicon.ico",
      fields: {
        iconUrl: value("https://icons.test/favicon.ico"),
        pageUrls: value(["https://www.site.test/", "https://site.test/a"]),
      },
    });
    insertRow(directory, {
      table: "favicon_findings",
      kind: "favicon",
      id: 4,
      commitState: "journal_resident",
      column: null,
      fields: {
        iconUrl: { state: "absent" },
        pageUrls: value(["https://site.test/b"]),
      },
    });
    const hosts = querySiteHosts({ caseDirectory: directory }).items;
    expect(
      hosts.map((item) => [
        item.host,
        item.counts.cache,
        item.counts.favicons,
        item.savedCounts.favicons,
      ]),
    ).toEqual([
      ["cdn.test", 1, 0, 0],
      ["icons.test", 0, 1, 1],
      ["site.test", 0, 2, 1],
      ["www.site.test", 0, 1, 1],
    ]);
    expect(
      querySiteFindings({
        caseDirectory: directory,
        host: "cdn.test",
      }).items.map((item) => [item.artifactKind, item.hostFields]),
    ).toEqual([["cache", ["key"]]]);
    expect(
      querySiteFindings({ caseDirectory: directory, host: "top.test" }).items,
    ).toEqual([]);
    expect(
      querySiteFindings({
        caseDirectory: directory,
        host: "site.test",
      }).items.map((item) => [item.provenance.rowId, item.hostFields]),
    ).toEqual([
      ["3", ["pageUrls"]],
      ["4", ["pageUrls"]],
    ]);
  });

  it("pages a host's rows across artifact kinds with no repeat or gap", async () => {
    const directory = await caseDirectory();
    for (let id = 1; id <= 7; id += 1) {
      insert(
        directory,
        "forensic_findings",
        "history_artifact_results",
        "history_visit",
        "sort_url",
        `https://mixed.test/${String(id)}`,
        id,
      );
      insertRow(directory, {
        table: "downloads_findings",
        kind: "download",
        id,
        fields: { tabUrl: value(`https://mixed.test/d${String(id)}`) },
      });
    }
    const seen: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = querySiteFindings({
        caseDirectory: directory,
        host: "mixed.test",
        limit: 3,
        after,
      });
      seen.push(
        ...result.items.map(
          (item) => `${item.artifactKind}:${item.provenance.rowId}`,
        ),
      );
      if (result.nextCursor === null) break;
      after = result.nextCursor;
    }
    expect(seen).toEqual([
      ...Array.from(
        { length: 7 },
        (_, index) => `downloads:${String(index + 1)}`,
      ),
      ...Array.from({ length: 7 }, (_, index) => `visits:${String(index + 1)}`),
    ]);
  });

  it("reports malformed fields JSON as an invalid Case", async () => {
    const directory = await caseDirectory();
    insertRow(directory, {
      table: "downloads_findings",
      kind: "download",
      id: 1,
      fields: {},
      fieldsJson: "{not json",
    });
    expect(() => querySiteHosts({ caseDirectory: directory })).toThrow(
      expect.objectContaining({ code: "CASE_INVALID" }),
    );
  });
});

describe("Sites favicons", () => {
  async function payload(directory: string, name: string, bytes: Buffer) {
    await mkdir(join(directory, "favicon-payloads"), { recursive: true });
    await writeFile(join(directory, "favicon-payloads", name), bytes);
    return `favicon-payloads/${name}`;
  }
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  const GIF = Buffer.from("GIF89a-small");
  const favicon = (
    directory: string,
    id: number,
    width: number,
    payloadPath: string,
    pageUrls: readonly string[],
    commitState = "committed",
  ) => {
    insertRow(directory, {
      table: "favicon_findings",
      kind: "favicon",
      id,
      width,
      commitState,
      column: `https://${String(id)}.icons.test/favicon.ico`,
      fields: {
        iconUrl: value(`https://${String(id)}.icons.test/favicon.ico`),
        pageUrls: value(pageUrls),
        payloadPath: value(payloadPath),
      },
    });
  };

  it("returns the widest saved bitmap per host, past any page size", async () => {
    const directory = await caseDirectory();
    const small = await payload(directory, "small", GIF);
    const large = await payload(directory, "large", PNG);
    // 150 narrow icons on other hosts first: a single 100-row page would
    // never reach the wide one.
    for (let id = 1; id <= 150; id += 1)
      favicon(directory, id, 16, small, [`https://other${String(id)}.test/`]);
    favicon(directory, 200, 16, small, ["https://site.test/"]);
    favicon(directory, 201, 64, large, ["https://site.test/a"]);
    // A wider recovered (WAL) bitmap never decorates the host.
    favicon(directory, 202, 128, small, ["https://site.test/"], "wal_resident");
    const result = querySiteFavicons({
      caseDirectory: directory,
      hosts: ["site.test", "other150.test", "none.test"],
    });
    expect(result).toEqual({
      status: "ok",
      command: "site-favicons",
      icons: {
        "site.test": `data:image/png;base64,${PNG.toString("base64")}`,
        "other150.test": `data:image/gif;base64,${GIF.toString("base64")}`,
        "none.test": null,
      },
    });
  });

  it("never reads a payload outside the Case directory", async () => {
    const directory = await caseDirectory();
    const outside = await mkdtemp(join(tmpdir(), "forensix-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret"), PNG);
    await mkdir(join(directory, "favicon-payloads"), { recursive: true });
    await symlink(
      join(outside, "secret"),
      join(directory, "favicon-payloads", "link"),
    );
    const inside = await payload(directory, "inside", GIF);
    favicon(directory, 1, 256, "../" + "x/secret", ["https://escape.test/"]);
    favicon(directory, 2, 128, join(outside, "secret"), [
      "https://escape.test/",
    ]);
    favicon(directory, 3, 64, "favicon-payloads/link", [
      "https://escape.test/",
    ]);
    favicon(directory, 4, 32, "favicon-payloads/missing", [
      "https://escape.test/",
    ]);
    favicon(directory, 5, 16, inside, ["https://escape.test/"]);
    favicon(directory, 6, 16, "../secret", ["https://outside.test/"]);
    expect(
      querySiteFavicons({
        caseDirectory: directory,
        hosts: ["escape.test", "outside.test"],
      }).icons,
    ).toEqual({
      "escape.test": `data:image/gif;base64,${GIF.toString("base64")}`,
      "outside.test": null,
    });
  });

  it("reads each row's own bitmap by its recorded hash, recovered rows too", async () => {
    const directory = await caseDirectory();
    const sha = (bytes: Buffer) =>
      createHash("sha256").update(bytes).digest("hex");
    const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 7]);
    const saved = await payload(directory, sha(PNG), PNG);
    const recovered = await payload(directory, sha(ICO), ICO);
    // A path whose bytes do not hash to what the row records.
    const forged = await payload(directory, "forged", GIF);
    const bitmapRow = (
      id: number,
      payloadPath: string,
      hash: string,
      commitState = "committed",
    ) => {
      insertRow(directory, {
        table: "favicon_findings",
        kind: "favicon",
        id,
        width: 16,
        commitState,
        column: "https://icons.test/favicon.ico",
        fields: {
          iconUrl: value("https://icons.test/favicon.ico"),
          payloadPath: value(payloadPath),
          payloadSha256: value(hash),
        },
      });
    };
    bitmapRow(1, saved, sha(PNG));
    // The widest saved icon of the host is another row: this one is still
    // drawn from its own payload.
    bitmapRow(2, recovered, sha(ICO), "wal_resident");
    bitmapRow(3, forged, sha(Buffer.from("not the payload")));
    bitmapRow(4, "../outside", "f".repeat(64));
    const unrecorded = "0".repeat(64);
    const result = queryFaviconBitmaps({
      caseDirectory: directory,
      sha256s: [
        sha(PNG),
        sha(ICO),
        sha(Buffer.from("not the payload")),
        "f".repeat(64),
        unrecorded,
      ],
    });
    expect(result).toEqual({
      status: "ok",
      command: "favicon-bitmaps",
      bitmaps: {
        [sha(PNG)]: `data:image/png;base64,${PNG.toString("base64")}`,
        [sha(ICO)]: `data:image/x-icon;base64,${ICO.toString("base64")}`,
        [sha(Buffer.from("not the payload"))]: null,
        ["f".repeat(64)]: null,
        [unrecorded]: null,
      },
    });
    // A file named by an unrecorded hash is never read.
    await payload(directory, unrecorded, PNG);
    expect(
      queryFaviconBitmaps({ caseDirectory: directory, sha256s: [unrecorded] })
        .bitmaps,
    ).toEqual({ [unrecorded]: null });
  });

  it("rejects hashes that are not SHA-256 hex and bounds their number", async () => {
    const directory = await caseDirectory();
    for (const sha256s of [
      ["../favicon-payloads/x"],
      ["A".repeat(64)],
      Array.from({ length: 101 }, (_, index) =>
        index.toString(16).padStart(64, "0"),
      ),
    ])
      expect(() =>
        queryFaviconBitmaps({ caseDirectory: directory, sha256s }),
      ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("bounds the hosts one request may name", async () => {
    const directory = await caseDirectory();
    expect(
      querySiteFavicons({ caseDirectory: directory, hosts: [] }).icons,
    ).toEqual({});
    expect(() =>
      querySiteFavicons({
        caseDirectory: directory,
        hosts: Array.from(
          { length: 101 },
          (_, index) => `h${String(index)}.test`,
        ),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
});
