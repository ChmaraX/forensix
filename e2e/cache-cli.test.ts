import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCli, writeLocalState } from "./lib/harness.js";
const temporaryRoots: string[] = [];

const SIMPLE_INITIAL_MAGIC = 0xfcfb6d1ba7725c30n;
const SIMPLE_FINAL_MAGIC = 0xf4fa6f45970d41d8n;
const SIMPLE_INDEX_MAGIC = 0x656e74657220796fn;
const BLOCKFILE_INDEX_MAGIC = 0xc103cac3;
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

type Field<T> =
  | { readonly state: "value"; readonly value: T; readonly synthetic?: boolean }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface CacheRecord {
  readonly recordType: "finding" | "candidate";
  readonly findingKind?: string;
  readonly candidateKind?: string;
  readonly rank?: number;
  readonly count?: number;
  readonly profile: string;
  readonly provenance: {
    readonly database: string;
    readonly table: string;
    readonly rowId: string;
    readonly supportingRows?: readonly {
      readonly table: string;
      readonly rowId: string;
    }[];
  };
  readonly fields: Record<string, Field<unknown>>;
}

interface CachePage {
  readonly status: "ok";
  readonly command: "cache";
  readonly recordType: "finding" | "candidate";
  readonly items: readonly CacheRecord[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt.asUintN(64, value));
  return buffer;
}

function i64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}

/** Paul Hsieh SuperFastHash — Chromium's persisted SimpleFileHeader key_hash. */
function superFastHash(data: Uint8Array): number {
  let length = data.length;
  if (length <= 0) {
    return 0;
  }
  let hash = length >>> 0;
  const remainder = length & 3;
  length >>= 2;
  let offset = 0;
  const get16 = (at: number): number =>
    (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
  const signedByte = (at: number): number => ((data[at] ?? 0) << 24) >> 24;
  for (; length > 0; length -= 1) {
    hash = (hash + get16(offset)) >>> 0;
    const tmp = (((get16(offset + 2) << 11) >>> 0) ^ hash) >>> 0;
    hash = (((hash << 16) >>> 0) ^ tmp) >>> 0;
    offset += 4;
    hash = (hash + (hash >>> 11)) >>> 0;
  }
  switch (remainder) {
    case 3:
      hash = (hash + get16(offset)) >>> 0;
      hash = (hash ^ ((hash << 16) >>> 0)) >>> 0;
      hash = (hash ^ ((signedByte(offset + 2) << 18) >>> 0)) >>> 0;
      hash = (hash + (hash >>> 11)) >>> 0;
      break;
    case 2:
      hash = (hash + get16(offset)) >>> 0;
      hash = (hash ^ ((hash << 11) >>> 0)) >>> 0;
      hash = (hash + (hash >>> 17)) >>> 0;
      break;
    case 1:
      hash = (hash + signedByte(offset)) >>> 0;
      hash = (hash ^ ((hash << 10) >>> 0)) >>> 0;
      hash = (hash + (hash >>> 1)) >>> 0;
      break;
    default:
      break;
  }
  hash = (hash ^ ((hash << 3) >>> 0)) >>> 0;
  hash = (hash + (hash >>> 5)) >>> 0;
  hash = (hash ^ ((hash << 4) >>> 0)) >>> 0;
  hash = (hash + (hash >>> 17)) >>> 0;
  hash = (hash ^ ((hash << 10) >>> 0)) >>> 0;
  hash = (hash + (hash >>> 6)) >>> 0;
  return hash >>> 0;
}

/** The 16-hex entry hash: first 8 bytes of SHA-1(key) read little-endian. */
function entryHash(key: string): string {
  const digest = createHash("sha1").update(Buffer.from(key, "utf8")).digest();
  return digest
    .subarray(0, 8)
    .readBigUInt64LE(0)
    .toString(16)
    .padStart(16, "0");
}

function buildSimpleEntry(key: string, body: Uint8Array): Buffer {
  const keyBuffer = Buffer.from(key, "utf8");
  const header = Buffer.concat([
    u64(SIMPLE_INITIAL_MAGIC),
    u32(5),
    u32(keyBuffer.length),
    u32(superFastHash(keyBuffer)),
    u32(0),
  ]);
  const stream1 = Buffer.from(body);
  const eof1 = Buffer.concat([
    u64(SIMPLE_FINAL_MAGIC),
    u32(1),
    u32(crc32(stream1) >>> 0),
    u32(0),
    u32(0),
  ]);
  const stream0 = Buffer.from("HTTP/1.1 200 OK");
  const eof0 = Buffer.concat([
    u64(SIMPLE_FINAL_MAGIC),
    u32(1),
    u32(crc32(stream0) >>> 0),
    u32(stream0.length),
    u32(0),
  ]);
  return Buffer.concat([header, keyBuffer, stream1, eof1, stream0, eof0]);
}

function buildRealIndex(
  records: readonly {
    readonly key: string;
    readonly lastUsedUtcMillis: number;
    readonly entrySizeBytes: number;
  }[],
): Buffer {
  const body: Buffer[] = [
    u64(SIMPLE_INDEX_MAGIC),
    u32(9),
    u64(BigInt(records.length)),
    u64(1_048_576n),
    u32(0),
  ];
  for (const record of records) {
    const internal =
      BigInt(record.lastUsedUtcMillis) * 1000n + WINDOWS_EPOCH_OFFSET_MICROS;
    body.push(u64(BigInt(`0x${entryHash(record.key)}`)));
    body.push(i64(internal));
    body.push(u64((BigInt(record.entrySizeBytes >> 8) << 8n) | 0n));
  }
  body.push(i64(0n));
  const payload = Buffer.concat(body);
  return Buffer.concat([
    u32(payload.length),
    u32(crc32(payload) >>> 0),
    payload,
  ]);
}

async function writeCacheFile(
  cacheDataDir: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const full = join(cacheDataDir, ...relativePath.split("/"));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, bytes);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("compiled analyzer CLI Cache backends", () => {
  it("extracts Simple Cache entries, payloads, and doomed/evicted Candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cache-e2e-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    const cacheData = join(source, "Default", "Cache", "Cache_Data");
    await mkdir(cacheData, { recursive: true });

    const alphaKey = "1/0/https://alpha.example/app.js";
    const live = [
      { key: alphaKey, body: "alpha-body-1" },
      { key: "1/0/https://bravo.example/style.css", body: "bravo-body-22" },
      { key: "1/0/https://delta.example/logo.png", body: "delta-body-333" },
    ];
    for (const entry of live) {
      await writeCacheFile(
        cacheData,
        `${entryHash(entry.key)}_0`,
        buildSimpleEntry(entry.key, Buffer.from(entry.body)),
      );
    }
    // A doomed entry: on disk with a parseable `_0` file but absent from the
    // real index. Its key and payload are preserved but it stays a Candidate.
    const doomedKey = "1/0/https://doomed.example/orphan.js";
    await writeCacheFile(
      cacheData,
      `${entryHash(doomedKey)}_0`,
      buildSimpleEntry(doomedKey, Buffer.from("doomed-body")),
    );
    // An evicted reference: in the index but with no recoverable entry file.
    const evictedKey = "1/0/https://evicted.example/gone.css";

    await writeCacheFile(
      cacheData,
      "index-dir/the-real-index",
      buildRealIndex([
        ...live.map((entry) => ({
          key: entry.key,
          lastUsedUtcMillis: Date.UTC(2024, 0, 1),
          entrySizeBytes: 4096,
        })),
        {
          key: evictedKey,
          lastUsedUtcMillis: Date.UTC(2024, 0, 2),
          entrySizeBytes: 512,
        },
      ]),
    );
    // The Simple Cache fake index (not a blockfile index): zeroed head.
    await writeCacheFile(cacheData, "index", Buffer.alloc(16));

    const alphaSha = createHash("sha256")
      .update(Buffer.from("alpha-body-1"))
      .digest("hex");
    const aEntry = await readFile(join(cacheData, `${entryHash(alphaKey)}_0`));

    const caseDirectory = join(root, "CASE-CACHE");
    expect(
      runCli([
        "ingest",
        source,
        "--case",
        caseDirectory,
        "--include-tier-2",
        "--json",
      ]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    // Simple Cache produces three entry Findings and two
    // Candidates (one doomed, one evicted), with payloads as hashed files.
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      cache: {
        status: "complete",
        analysedProfileCount: 1,
        unavailableProfileCount: 0,
        findingCount: 3,
        candidateCount: 2,
        payloadFileCount: 4,
      },
    });

    // The response body is a separately hashed file named by its SHA-256,
    // referenced by digest and path — never base64-inlined into a row.
    const payloadOnDisk = await readFile(
      join(caseDirectory, "cache-payloads", alphaSha),
    );
    expect(payloadOnDisk.toString("utf8")).toBe("alpha-body-1");

    // Bounded keyset pagination over Findings, ordered by cache key.
    const firstPage = parseJson<CachePage>(
      runCli([
        "cache",
        "--case",
        caseDirectory,
        "--sort",
        "key",
        "--limit",
        "2",
        "--json",
      ]).stdout,
    );
    expect(firstPage.recordType).toBe("finding");
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const alpha = firstPage.items[0];
    expect(alpha).toBeDefined();
    // Entry metadata, key, timestamp, size, and payload reference exact.
    expect(alpha).toMatchObject({
      recordType: "finding",
      findingKind: "cache_entry",
      profile: "Default",
      provenance: {
        database: "Default/Cache/Cache_Data",
        table: "simple_entry",
        rowId: entryHash(alphaKey),
      },
      fields: {
        backend: { state: "value", value: "simple" },
        key: { state: "value", value: alphaKey },
        keyHashValid: { state: "value", value: "true" },
        entryHashMatchesFilename: { state: "value", value: "true" },
        entrySizeBytes: { state: "value", value: "4096" },
        payloadSha256: { state: "value", value: alphaSha },
        payloadPath: { state: "value", value: `cache-payloads/${alphaSha}` },
        stream1Crc32Valid: { state: "value", value: "true" },
      },
    });
    expect(alpha?.fields.lastUsed).toMatchObject({
      state: "value",
      value: { utc: "2024-01-01T00:00:00.000000Z" },
    });
    // The index record is cited as supporting Provenance for the entry.
    expect(
      (alpha?.provenance.supportingRows ?? []).map((row) => row.table),
    ).toContain("the_real_index");

    const secondPage = parseJson<CachePage>(
      runCli([
        "cache",
        "--case",
        caseDirectory,
        "--sort",
        "key",
        "--limit",
        "2",
        "--after",
        firstPage.nextCursor as string,
        "--json",
      ]).stdout,
    );
    const keys = [...firstPage.items, ...secondPage.items].map(
      (item) =>
        item.fields.key.state === "value" && (item.fields.key.value as string),
    );
    expect(new Set(keys).size).toBe(3);

    // Doomed and evicted evidence are Candidates — ranked, with supporting
    // count and resolvable Provenance — and are NEVER Findings.
    const candidates = parseJson<CachePage>(
      runCli([
        "cache",
        "--case",
        caseDirectory,
        "--record-type",
        "candidate",
        "--json",
      ]).stdout,
    );
    expect(candidates.recordType).toBe("candidate");
    expect(candidates.items).toHaveLength(2);
    const kinds = candidates.items.map((item) => item.candidateKind).sort();
    expect(kinds).toEqual(["doomed_entry", "evicted_reference"]);
    for (const candidate of candidates.items) {
      expect(candidate.recordType).toBe("candidate");
      expect(candidate.findingKind).toBeUndefined();
      expect(typeof candidate.rank).toBe("number");
      expect(candidate.count).toBeGreaterThan(0);
      expect(candidate.fields.state?.state).toBe("value");
    }
    const doomed = candidates.items.find(
      (item) => item.candidateKind === "doomed_entry",
    );
    // The doomed entry still yields its key and a hashed payload as evidence.
    expect(doomed?.fields.key).toMatchObject({
      state: "value",
      value: doomedKey,
    });
    expect(doomed?.fields.state).toMatchObject({
      state: "value",
      value: "allocated_deleted_or_doomed",
    });

    // Search matches the cache key.
    const searched = parseJson<CachePage>(
      runCli(["cache", "--case", caseDirectory, "--search", "bravo", "--json"])
        .stdout,
    );
    expect(searched.items).toHaveLength(1);

    // The Analyzer never mutates the evidence it reads.
    expect(await readFile(join(cacheData, `${entryHash(alphaKey)}_0`))).toEqual(
      aEntry,
    );
  });

  it("detects blockfile and SQL backends with explicit unavailable reasons", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cache-backend-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);

    // Default: a blockfile cache (index magic + data files).
    const blockData = join(source, "Default", "Cache", "Cache_Data");
    await mkdir(blockData, { recursive: true });
    await writeFile(
      join(blockData, "index"),
      Buffer.concat([u32(BLOCKFILE_INDEX_MAGIC), u32(0x30000), u32(7)]),
    );
    await writeFile(
      join(blockData, "data_0"),
      Buffer.concat([u32(0xc104cac3), Buffer.alloc(60)]),
    );
    // Profile 1: a SQL Cache backend (SQLite database).
    const sqlData = join(source, "Profile 1", "Cache", "Cache_Data");
    await mkdir(sqlData, { recursive: true });
    await writeFile(
      join(sqlData, "index"),
      Buffer.concat([Buffer.from("SQLite format 3\u0000"), Buffer.alloc(80)]),
    );
    // Profile 2: a supported Simple Cache, so the run mixes complete with
    // unavailable and the backends are routed per Profile from contents alone.
    const simpleData = join(source, "Profile 2", "Cache", "Cache_Data");
    await mkdir(simpleData, { recursive: true });
    const simpleKey = "1/0/https://ok.example/main.js";
    await writeCacheFile(
      simpleData,
      `${entryHash(simpleKey)}_0`,
      buildSimpleEntry(simpleKey, Buffer.from("ok-body")),
    );
    await writeCacheFile(
      simpleData,
      "index-dir/the-real-index",
      buildRealIndex([
        {
          key: simpleKey,
          lastUsedUtcMillis: Date.UTC(2024, 2, 3),
          entrySizeBytes: 256,
        },
      ]),
    );

    const caseDirectory = join(root, "CASE-CACHE-BACKENDS");
    expect(
      runCli([
        "ingest",
        source,
        "--case",
        caseDirectory,
        "--include-tier-2",
        "--json",
      ]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // Unsupported backends report explicit unavailable reasons in the
    // cache summary rather than an empty result. Cache is a tier-2 artifact
    // excluded from the Analysis Run exit state, so unsupported backends leave
    // the run exit-neutral (History/Cookies/Login here are absent, not
    // unavailable) and the run still exits 0/complete.
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      exitState: "complete",
      cache: {
        status: "partial",
        analysedProfileCount: 1,
        unavailableProfileCount: 2,
        findingCount: 1,
      },
    });

    // No Findings are produced for the unsupported backends; only the Simple
    // Cache Profile contributes one entry.
    const findings = parseJson<CachePage>(
      runCli(["cache", "--case", caseDirectory, "--json"]).stdout,
    );
    expect(findings.items).toHaveLength(1);
    expect(findings.items[0]?.profile).toBe("Profile 2");
  });

  it("keeps cache availability out of the run exit state on a default ingest", async () => {
    // Regression: every real Chrome profile has a Cache dir, but cache is a
    // tier-2 artifact not ingested by default. A default (no --include-tier-2)
    // ingest lists the cache dir in the Manifest without copying its bytes, so
    // the cache artifact reports `unavailable` (cache_not_in_working_copy).
    // That availability signal must NOT flip an otherwise-clean run to
    // partial/failed: the run stays exit 0 / complete.
    const root = await mkdtemp(join(tmpdir(), "forensix-cache-exit-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    // A cache dir present in the Source (as on any real profile) but whose
    // bytes are tier-2 and therefore not copied on a default ingest.
    const cacheData = join(source, "Default", "Cache", "Cache_Data");
    await mkdir(cacheData, { recursive: true });
    await writeFile(join(cacheData, "index"), Buffer.alloc(16));
    const cacheKey = "1/0/https://exit.example/app.js";
    await writeCacheFile(
      cacheData,
      `${entryHash(cacheKey)}_0`,
      buildSimpleEntry(cacheKey, Buffer.from("exit-body")),
    );

    const caseDirectory = join(root, "CASE-CACHE-EXIT");
    // Default ingest: no --include-tier-2, so cache bytes are not collected.
    expect(
      runCli(["ingest", source, "--case", caseDirectory, "--json"]).status,
    ).toBe(0);

    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    // Clean History/Cookies/Login (absent here) leave the run exit-neutral, and
    // the un-ingested cache must not turn that into a nonzero exit.
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      command: "analyse",
      exitState: "complete",
      // Cache health is still recorded and reported in the summary — it just
      // does not participate in the exit-state aggregation.
      cache: {
        status: "partial",
        analysedProfileCount: 0,
        unavailableProfileCount: 1,
        findingCount: 0,
      },
    });
  });

  it("scales to a large Simple Cache with bounded, streamed extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "forensix-cache-scale-"));
    temporaryRoots.push(root);
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    await writeLocalState(source);
    const cacheData = join(source, "Default", "Cache", "Cache_Data");
    await mkdir(cacheData, { recursive: true });

    const count = 250;
    const indexRecords: {
      key: string;
      lastUsedUtcMillis: number;
      entrySizeBytes: number;
    }[] = [];
    for (let index = 0; index < count; index += 1) {
      const key = `1/0/https://scale.example/asset-${index}.bin`;
      await writeCacheFile(
        cacheData,
        `${entryHash(key)}_0`,
        buildSimpleEntry(key, Buffer.from(`payload-${index}`)),
      );
      indexRecords.push({
        key,
        lastUsedUtcMillis: Date.UTC(2024, 0, 1) + index * 1000,
        entrySizeBytes: 256,
      });
    }
    await writeCacheFile(
      cacheData,
      "index-dir/the-real-index",
      buildRealIndex(indexRecords),
    );

    const caseDirectory = join(root, "CASE-CACHE-SCALE");
    expect(
      runCli([
        "ingest",
        source,
        "--case",
        caseDirectory,
        "--include-tier-2",
        "--json",
      ]).status,
    ).toBe(0);
    const analysis = runCli(["analyse", "--case", caseDirectory, "--json"]);
    expect(analysis.status).toBe(0);
    expect(parseJson<Record<string, unknown>>(analysis.stdout)).toMatchObject({
      cache: { findingCount: count, payloadFileCount: count },
    });

    // The query is bounded; the whole result set is walked in fixed-size
    // keyset pages rather than a single unbounded read.
    let cursor: string | null = null;
    let seen = 0;
    let pages = 0;
    do {
      const page: CachePage = parseJson<CachePage>(
        runCli([
          "cache",
          "--case",
          caseDirectory,
          "--sort",
          "entry-hash",
          "--limit",
          "50",
          ...(cursor === null ? [] : ["--after", cursor]),
          "--json",
        ]).stdout,
      );
      expect(page.items.length).toBeLessThanOrEqual(50);
      seen += page.items.length;
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(10);
    } while (cursor !== null);
    expect(seen).toBe(count);
  });
});
