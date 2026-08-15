import { createHash } from "node:crypto";
import { crc32 as zlibCrc32 } from "node:zlib";

/**
 * Pure, filesystem-free readers for the three Chromium HTTP-cache backends.
 *
 * A Chrome cache directory (`<Profile>/Cache/Cache_Data`, `Code Cache/...`,
 * `GPUCache`) is a directory of files, not a SQLite database. Which backend
 * wrote it is decided by the bytes on disk, never by the Source platform, so
 * detection here reads magic numbers and file names rather than assuming an OS.
 *
 * The formats mirrored below are the recorded Chromium on-disk contracts:
 *   - blockfile: `net/disk_cache/blockfile/disk_format.h` (`index` + `data_*`).
 *   - Simple Cache: `net/disk_cache/simple/simple_entry_format.h` (entry files)
 *     and `simple_index_file.cc` (`index-dir/the-real-index`).
 *   - SQL Cache: a SQLite database (`SQLite format 3\0` header).
 *
 * Only the Simple Cache backend is extracted to exact entry Findings; blockfile
 * and SQL Cache are detected and reported with an explicit unavailable reason.
 */

export type CacheBackend = "blockfile" | "simple" | "sql" | "unknown";

// Blockfile `index` file magic. disk_format.h: kIndexMagic. LE uint32.
export const BLOCKFILE_INDEX_MAGIC = 0xc103cac3;

// simple_entry_format.h magic numbers, read as little-endian uint64.
export const SIMPLE_INITIAL_MAGIC = 0xfcfb6d1ba7725c30n;
export const SIMPLE_FINAL_MAGIC = 0xf4fa6f45970d41d8n;

// simple_index_file.h kSimpleIndexMagicNumber, read as little-endian uint64.
export const SIMPLE_INDEX_MAGIC = 0x656e74657220796fn;

// SimpleFileEOF::Flags.
const FLAG_HAS_CRC32 = 1 << 0;
const FLAG_HAS_KEY_SHA256 = 1 << 1;

const SIMPLE_HEADER_BYTES = 24;
const SIMPLE_EOF_BYTES = 24;
const SIMPLE_KEY_SHA256_BYTES = 32;

// Microseconds between the 1601-01-01 Windows epoch (base::Time internal value
// origin) and the 1970 Unix epoch. base::Time::ToInternalValue() emits this.
const WINDOWS_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n;

const SQLITE_MAGIC = Buffer.from("SQLite format 3\u0000", "latin1");

// A Simple Cache entry file is `<16 hex hash>_<stream index>`, where stream
// index 0/1 are dense streams and `s` is the sparse stream.
const SIMPLE_ENTRY_FILE = /^[0-9a-f]{16}_[01s]$/;

/**
 * One shallow directory entry handed to detection: a path relative to the cache
 * data directory (posix separators) plus the leading bytes of the file. Only
 * the head is needed to read a magic number, so a caller never buffers a whole
 * cache into memory just to classify it.
 */
export interface CacheDirEntry {
  readonly relativePath: string;
  readonly head: Uint8Array;
}

export interface BackendDetection {
  readonly backend: CacheBackend;
  /** A short, stable label naming the on-disk evidence that decided `backend`. */
  readonly evidence: string;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) {
    return null;
  }
  return viewOf(bytes).getUint32(offset, true);
}

function readUint64LE(bytes: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 8 > bytes.length) {
    return null;
  }
  return viewOf(bytes).getBigUint64(offset, true);
}

function readInt64LE(bytes: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 8 > bytes.length) {
    return null;
  }
  return viewOf(bytes).getBigInt64(offset, true);
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Decide the cache backend from directory contents alone. Detection is
 * deterministic and platform-independent: a blockfile `index` magic wins first
 * because it is the most specific signal, then Simple Cache (its real index or
 * any entry-file magic), then a SQLite header. When nothing matches, the
 * backend is `unknown` and the caller reports an explicit unavailable reason
 * rather than an empty result.
 */
export function detectCacheBackend(
  entries: readonly CacheDirEntry[],
): BackendDetection {
  const byPath = new Map<string, CacheDirEntry>();
  for (const entry of entries) {
    byPath.set(entry.relativePath, entry);
  }

  const indexFile = byPath.get("index");
  if (indexFile !== undefined) {
    const magic = readUint32LE(indexFile.head, 0);
    if (magic === BLOCKFILE_INDEX_MAGIC) {
      return { backend: "blockfile", evidence: "index_magic" };
    }
  }
  for (const entry of entries) {
    if (readUint32LE(entry.head, 0) === BLOCKFILE_INDEX_MAGIC) {
      return { backend: "blockfile", evidence: "index_magic" };
    }
  }

  if (byPath.has("index-dir/the-real-index")) {
    return { backend: "simple", evidence: "the_real_index" };
  }
  for (const entry of entries) {
    const name = entry.relativePath.split("/").at(-1) ?? "";
    if (
      SIMPLE_ENTRY_FILE.test(name) &&
      readUint64LE(entry.head, 0) === SIMPLE_INITIAL_MAGIC
    ) {
      return { backend: "simple", evidence: "simple_entry_magic" };
    }
  }

  for (const entry of entries) {
    if (startsWith(entry.head, SQLITE_MAGIC)) {
      return { backend: "sql", evidence: "sqlite_header" };
    }
  }

  return { backend: "unknown", evidence: "no_backend_signature" };
}

/**
 * Paul Hsieh's SuperFastHash, byte-for-byte the function Chromium persists as
 * `SimpleFileHeader.key_hash` via `base::PersistentHash`. It must not change,
 * so it is reproduced exactly here to validate a recorded key against its
 * header without trusting the header blindly.
 */
export function superFastHash(data: Uint8Array): number {
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
  for (; length > 0; length -= 1) {
    hash = (hash + get16(offset)) >>> 0;
    const tmp = (((get16(offset + 2) << 11) >>> 0) ^ hash) >>> 0;
    hash = (((hash << 16) >>> 0) ^ tmp) >>> 0;
    offset += 4;
    hash = (hash + (hash >>> 11)) >>> 0;
  }
  const signedByte = (at: number): number => ((data[at] ?? 0) << 24) >> 24;
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

/**
 * The 16-hex Simple Cache entry hash of a key: the first eight bytes of
 * SHA-1(key) read as a little-endian uint64, exactly `simple_util`'s
 * `GetEntryHashKey`. Used to link an entry file name to the key it stores and
 * to the record for that hash in the real index.
 */
export function entryHashHexFromKey(key: Uint8Array): string {
  const digest = createHash("sha1").update(key).digest();
  const value = readUint64LE(digest, 0) as bigint;
  return value.toString(16).padStart(16, "0");
}

function internalMicrosToUtc(internalMicros: bigint): string | null {
  const unixMicros = internalMicros - WINDOWS_EPOCH_OFFSET_MICROS;
  const seconds =
    unixMicros >= 0n
      ? unixMicros / 1_000_000n
      : (unixMicros - 999_999n) / 1_000_000n;
  const micros = unixMicros - seconds * 1_000_000n;
  const milliseconds = Number(seconds * 1000n + micros / 1000n);
  if (!Number.isSafeInteger(milliseconds)) {
    return null;
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.toISOString().slice(0, -5)}.${micros
    .toString()
    .padStart(6, "0")}Z`;
}

export interface SimpleStream {
  readonly size: number;
  readonly data: Uint8Array;
  readonly declaredCrc32: number | null;
  readonly crc32Valid: boolean | null;
}

export type SimpleEntryParse =
  | {
      readonly ok: true;
      readonly version: number;
      readonly key: Uint8Array;
      readonly keyText: string | null;
      readonly keyLength: number;
      readonly headerKeyHash: number;
      readonly keyHashValid: boolean;
      readonly keySha256: string | null;
      readonly stream0: SimpleStream;
      readonly stream1: SimpleStream;
      readonly entryHashFromKey: string;
    }
  | { readonly ok: false; readonly reason: SimpleEntryFailure };

export type SimpleEntryFailure =
  | "not_simple_magic"
  | "truncated"
  | "bad_stream0_eof"
  | "bad_stream1_eof"
  | "inconsistent_layout";

interface ParsedEof {
  readonly flags: number;
  readonly crc32: number;
  readonly streamSize: number;
}

function parseEof(bytes: Uint8Array, offset: number): ParsedEof | null {
  if (offset < 0 || offset + SIMPLE_EOF_BYTES > bytes.length) {
    return null;
  }
  const magic = readUint64LE(bytes, offset);
  if (magic !== SIMPLE_FINAL_MAGIC) {
    return null;
  }
  return {
    flags: readUint32LE(bytes, offset + 8) as number,
    crc32: readUint32LE(bytes, offset + 12) as number,
    streamSize: readUint32LE(bytes, offset + 16) as number,
  };
}

function stream(
  data: Uint8Array,
  eof: ParsedEof,
  slice: Uint8Array,
): SimpleStream {
  const hasCrc = (eof.flags & FLAG_HAS_CRC32) !== 0;
  const declaredCrc32 = hasCrc ? eof.crc32 : null;
  return {
    size: slice.length,
    data: slice,
    declaredCrc32,
    crc32Valid: hasCrc ? zlibCrc32(slice) >>> 0 === eof.crc32 : null,
  };
}

/**
 * Parse a Simple Cache stream-0/stream-1 entry file (`<hash>_0`). The layout is
 * read from both ends per the recorded contract: the header carries the key and
 * its hash, while the two trailing SimpleFileEOF records fix each stream's
 * bounds. Stream 1 is the cached response body (the extractable payload);
 * stream 0 is the serialized response metadata.
 */
export function parseSimpleEntryFile(bytes: Uint8Array): SimpleEntryParse {
  if (bytes.length < SIMPLE_HEADER_BYTES) {
    return { ok: false, reason: "truncated" };
  }
  if (readUint64LE(bytes, 0) !== SIMPLE_INITIAL_MAGIC) {
    return { ok: false, reason: "not_simple_magic" };
  }
  const version = readUint32LE(bytes, 8) as number;
  const keyLength = readUint32LE(bytes, 12) as number;
  const headerKeyHash = readUint32LE(bytes, 16) as number;
  const keyStart = SIMPLE_HEADER_BYTES;
  const keyEnd = keyStart + keyLength;
  if (keyEnd > bytes.length) {
    return { ok: false, reason: "truncated" };
  }
  const key = bytes.subarray(keyStart, keyEnd);

  const eof0Offset = bytes.length - SIMPLE_EOF_BYTES;
  const eof0 = parseEof(bytes, eof0Offset);
  if (eof0 === null) {
    return { ok: false, reason: "bad_stream0_eof" };
  }
  const sha256Length =
    (eof0.flags & FLAG_HAS_KEY_SHA256) !== 0 ? SIMPLE_KEY_SHA256_BYTES : 0;
  const stream0End = eof0Offset - sha256Length;
  const stream0Start = stream0End - eof0.streamSize;
  const eof1Offset = stream0Start - SIMPLE_EOF_BYTES;
  if (stream0Start < keyEnd || eof1Offset < keyEnd) {
    return { ok: false, reason: "inconsistent_layout" };
  }
  const eof1 = parseEof(bytes, eof1Offset);
  if (eof1 === null) {
    return { ok: false, reason: "bad_stream1_eof" };
  }
  const stream1Start = keyEnd;
  const stream1End = eof1Offset;
  if (stream1End < stream1Start) {
    return { ok: false, reason: "inconsistent_layout" };
  }

  const keySha256 =
    sha256Length === 0
      ? null
      : Buffer.from(bytes.subarray(stream0End, eof0Offset)).toString("hex");

  return {
    ok: true,
    version,
    key,
    keyText: decodeKeyText(key),
    keyLength,
    headerKeyHash,
    keyHashValid: superFastHash(key) === headerKeyHash,
    keySha256,
    stream0: stream(bytes, eof0, bytes.subarray(stream0Start, stream0End)),
    stream1: stream(bytes, eof1, bytes.subarray(stream1Start, stream1End)),
    entryHashFromKey: entryHashHexFromKey(key),
  };
}

function decodeKeyText(key: Uint8Array): string | null {
  const text = Buffer.from(key).toString("utf8");
  // A cache key is printable ASCII/UTF-8 in practice; a replacement character
  // signals a non-text key, which stays available as raw bytes rather than
  // being coerced into a lossy string.
  return text.includes("\uFFFD") ? null : text;
}

export interface SimpleIndexRecord {
  readonly lastUsedInternalMicros: bigint;
  readonly lastUsedUtc: string | null;
  readonly entrySizeBytes: bigint;
  readonly inMemoryData: number;
}

export type SimpleIndexParse =
  | {
      readonly ok: true;
      readonly version: number;
      readonly declaredEntryCount: bigint;
      readonly cacheSizeBytes: bigint;
      readonly writeReason: number;
      readonly cacheLastModifiedUtc: string | null;
      readonly crc32Valid: boolean;
      readonly records: ReadonlyMap<string, SimpleIndexRecord>;
    }
  | { readonly ok: false; readonly reason: SimpleIndexFailure };

export type SimpleIndexFailure =
  | "truncated"
  | "bad_header"
  | "bad_magic"
  | "crc_mismatch"
  | "entry_count_overflow"
  | "malformed_entries";

// simple_index_file.cc caps the index at a million entries; a larger declared
// count is treated as corruption rather than trusted into a huge allocation.
const MAX_INDEX_ENTRIES = 1_000_000;

/**
 * Parse `index-dir/the-real-index`, the serialized `base::Pickle` that records
 * each live entry hash with its `EntryMetadata` (last-used time and 256-byte
 * granular size). The pickle CRC is validated so a corrupt index is reported
 * rather than mined for bogus timestamps. Presence in this map is the ground
 * truth for whether an on-disk entry file is live or doomed/orphaned.
 */
export function parseSimpleIndex(bytes: Uint8Array): SimpleIndexParse {
  if (bytes.length < 8) {
    return { ok: false, reason: "truncated" };
  }
  const payloadSize = readUint32LE(bytes, 0) as number;
  const declaredCrc = readUint32LE(bytes, 4) as number;
  const payloadStart = 8;
  if (payloadStart + payloadSize > bytes.length) {
    return { ok: false, reason: "bad_header" };
  }
  const payload = bytes.subarray(payloadStart, payloadStart + payloadSize);
  if (zlibCrc32(payload) >>> 0 !== declaredCrc) {
    return { ok: false, reason: "crc_mismatch" };
  }

  let cursor = 0;
  const readU32 = (): number | null => {
    const value = readUint32LE(payload, cursor);
    cursor += 4;
    return value;
  };
  const readU64 = (): bigint | null => {
    const value = readUint64LE(payload, cursor);
    cursor += 8;
    return value;
  };
  const readI64 = (): bigint | null => {
    const value = readInt64LE(payload, cursor);
    cursor += 8;
    return value;
  };

  const magic = readU64();
  const version = readU32();
  const entryCount = readU64();
  const cacheSize = readU64();
  const writeReason = readU32();
  if (
    magic === null ||
    version === null ||
    entryCount === null ||
    cacheSize === null ||
    writeReason === null
  ) {
    return { ok: false, reason: "bad_header" };
  }
  if (magic !== SIMPLE_INDEX_MAGIC) {
    return { ok: false, reason: "bad_magic" };
  }
  if (entryCount > BigInt(MAX_INDEX_ENTRIES)) {
    return { ok: false, reason: "entry_count_overflow" };
  }

  const records = new Map<string, SimpleIndexRecord>();
  for (let index = 0n; index < entryCount; index += 1n) {
    const hashKey = readU64();
    const internalLastUsed = readI64();
    const packed = readU64();
    if (hashKey === null || internalLastUsed === null || packed === null) {
      return { ok: false, reason: "malformed_entries" };
    }
    const entrySizeBytes = (packed >> 8n) << 8n;
    const hashHex = BigInt.asUintN(64, hashKey).toString(16).padStart(16, "0");
    records.set(hashHex, {
      lastUsedInternalMicros: internalLastUsed,
      lastUsedUtc:
        internalLastUsed === 0n ? null : internalMicrosToUtc(internalLastUsed),
      entrySizeBytes,
      inMemoryData: Number(packed & 0x3n),
    });
  }
  const cacheModified = readI64();
  if (cacheModified === null) {
    return { ok: false, reason: "malformed_entries" };
  }

  return {
    ok: true,
    version,
    declaredEntryCount: entryCount,
    cacheSizeBytes: cacheSize,
    writeReason,
    cacheLastModifiedUtc:
      cacheModified === 0n ? null : internalMicrosToUtc(cacheModified),
    crc32Valid: true,
    records,
  };
}

export interface BlockfileIndexHeader {
  readonly ok: true;
  readonly version: number;
  readonly numEntries: number;
}

export function parseBlockfileIndexHeader(
  bytes: Uint8Array,
): BlockfileIndexHeader | { readonly ok: false } {
  if (bytes.length < 12 || readUint32LE(bytes, 0) !== BLOCKFILE_INDEX_MAGIC) {
    return { ok: false };
  }
  return {
    ok: true,
    version: readUint32LE(bytes, 4) as number,
    numEntries: readUint32LE(bytes, 8) as number,
  };
}
