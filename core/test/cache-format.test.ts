import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  BLOCKFILE_INDEX_MAGIC,
  detectCacheBackend,
  entryHashHexFromKey,
  parseBlockfileIndexHeader,
  parseSimpleEntryFile,
  parseSimpleIndex,
  superFastHash,
  type CacheDirEntry,
} from "../src/cache-format.js";

const SIMPLE_INITIAL_MAGIC = 0xfcfb6d1ba7725c30n;
const SIMPLE_FINAL_MAGIC = 0xf4fa6f45970d41d8n;
const SIMPLE_INDEX_MAGIC = 0x656e74657220796fn;
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

const FLAG_HAS_CRC32 = 1;
const FLAG_HAS_KEY_SHA256 = 2;

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

/**
 * Build a Simple Cache stream-0/stream-1 entry file per simple_entry_format.h:
 * header, key, stream 1 (body), stream-1 EOF, stream 0 (metadata), optional key
 * SHA-256, stream-0 EOF.
 */
function buildSimpleEntry(options: {
  readonly key: string;
  readonly body: Uint8Array;
  readonly stream0?: Uint8Array;
  readonly version?: number;
  readonly withKeySha256?: boolean;
  readonly corruptKeyHash?: boolean;
}): Buffer {
  const key = Buffer.from(options.key, "utf8");
  const headerHash = options.corruptKeyHash ? 0 : superFastHash(key);
  const header = Buffer.concat([
    u64(SIMPLE_INITIAL_MAGIC),
    u32(options.version ?? 5),
    u32(key.length),
    u32(headerHash),
    u32(0),
  ]);
  const stream1 = Buffer.from(options.body);
  const eof1 = Buffer.concat([
    u64(SIMPLE_FINAL_MAGIC),
    u32(FLAG_HAS_CRC32),
    u32(crc32(stream1) >>> 0),
    u32(0),
    u32(0),
  ]);
  const stream0 = Buffer.from(options.stream0 ?? Buffer.from("headers"));
  const keySha = options.withKeySha256
    ? createHash("sha256").update(key).digest()
    : Buffer.alloc(0);
  const eof0 = Buffer.concat([
    u64(SIMPLE_FINAL_MAGIC),
    u32(options.withKeySha256 ? FLAG_HAS_KEY_SHA256 : 0),
    u32(0),
    u32(stream0.length),
    u32(0),
  ]);
  return Buffer.concat([header, key, stream1, eof1, stream0, keySha, eof0]);
}

function buildRealIndex(
  records: readonly {
    readonly hashHex: string;
    readonly lastUsedInternalMicros: bigint;
    readonly entrySizeBytes: number;
  }[],
): Buffer {
  const body: Buffer[] = [
    u64(SIMPLE_INDEX_MAGIC),
    u32(9),
    u64(BigInt(records.length)),
    u64(65536n),
    u32(0),
  ];
  for (const record of records) {
    body.push(u64(BigInt(`0x${record.hashHex}`)));
    body.push(i64(record.lastUsedInternalMicros));
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

describe("Cache backend detection", () => {
  it("distinguishes blockfile, Simple Cache, SQL, and unknown from contents", () => {
    // Detection reads directory contents, never a Source platform.
    expect(
      detectCacheBackend([
        { relativePath: "index", head: u32(BLOCKFILE_INDEX_MAGIC) },
        { relativePath: "data_0", head: u32(0xc104cac3) },
      ]).backend,
    ).toBe("blockfile");
    expect(
      detectCacheBackend([
        { relativePath: "index", head: Buffer.alloc(16) },
        { relativePath: "index-dir/the-real-index", head: Buffer.alloc(16) },
      ]).backend,
    ).toBe("simple");
    expect(
      detectCacheBackend([
        {
          relativePath: "0011223344556677_0",
          head: u64(SIMPLE_INITIAL_MAGIC),
        },
      ]).backend,
    ).toBe("simple");
    expect(
      detectCacheBackend([
        {
          relativePath: "index",
          head: Buffer.from("SQLite format 3\u0000"),
        },
      ]).backend,
    ).toBe("sql");
    expect(
      detectCacheBackend([
        { relativePath: "index", head: Buffer.from("garbage-bytes-xx") },
      ]).backend,
    ).toBe("unknown");
    expect(detectCacheBackend([] as CacheDirEntry[]).backend).toBe("unknown");
  });

  it("reads a blockfile index header for entry count evidence", () => {
    const header = Buffer.concat([
      u32(BLOCKFILE_INDEX_MAGIC),
      u32(0x30000),
      u32(42),
    ]);
    const parsed = parseBlockfileIndexHeader(header);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.numEntries).toBe(42);
    }
    expect(parseBlockfileIndexHeader(Buffer.from("no")).ok).toBe(false);
  });
});

describe("Simple Cache entry parsing (exact against recorded format)", () => {
  it("recovers key, key hash, streams, and body payload", () => {
    const key = "1/0/https://example.com/style.css";
    const body = Buffer.from("body-bytes-payload");
    const parsed = parseSimpleEntryFile(
      buildSimpleEntry({ key, body, withKeySha256: true }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.keyText).toBe(key);
    expect(parsed.keyLength).toBe(Buffer.from(key).length);
    // The header key hash validates against SuperFastHash of the key.
    expect(parsed.keyHashValid).toBe(true);
    // The 16-hex entry hash derives from the key exactly as Chromium names it.
    expect(parsed.entryHashFromKey).toBe(entryHashHexFromKey(Buffer.from(key)));
    expect(parsed.stream1.size).toBe(body.length);
    expect(Buffer.from(parsed.stream1.data).equals(body)).toBe(true);
    // The stream-1 CRC32 recorded in the EOF validates the body.
    expect(parsed.stream1.crc32Valid).toBe(true);
    expect(parsed.keySha256).toBe(
      createHash("sha256").update(key).digest("hex"),
    );
  });

  it("flags a corrupt key hash without discarding the entry", () => {
    const parsed = parseSimpleEntryFile(
      buildSimpleEntry({
        key: "1/0/https://example.com/a",
        body: Buffer.from("x"),
        corruptKeyHash: true,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.keyHashValid).toBe(false);
    }
  });

  it("rejects a non-Simple entry and a truncated file with typed reasons", () => {
    const bad = parseSimpleEntryFile(Buffer.from("not-a-simple-entry-file!!"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe("not_simple_magic");
    }
    expect(parseSimpleEntryFile(Buffer.alloc(4)).ok).toBe(false);
  });
});

describe("Simple Cache index parsing", () => {
  it("decodes entry hashes, last-used time, and size with CRC validation", () => {
    const hashHex = entryHashHexFromKey(Buffer.from("1/0/https://a.test/x"));
    const lastUsed =
      BigInt(Date.UTC(2024, 0, 2)) * 1000n + WINDOWS_EPOCH_OFFSET_MICROS;
    const parsed = parseSimpleIndex(
      buildRealIndex([
        { hashHex, lastUsedInternalMicros: lastUsed, entrySizeBytes: 4096 },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.declaredEntryCount).toBe(1n);
    const record = parsed.records.get(hashHex);
    expect(record?.lastUsedUtc).toBe("2024-01-02T00:00:00.000000Z");
    expect(record?.entrySizeBytes).toBe(4096n);
  });

  it("rejects a corrupt index CRC rather than mining bogus timestamps", () => {
    const hashHex = "0011223344556677";
    const valid = buildRealIndex([
      { hashHex, lastUsedInternalMicros: 0n, entrySizeBytes: 256 },
    ]);
    valid[valid.length - 1] = ((valid.at(-1) ?? 0) ^ 0xff) & 0xff;
    const parsed = parseSimpleIndex(valid);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("crc_mismatch");
    }
  });
});
