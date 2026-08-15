import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CacheArtifactWrite,
  PersistedCacheCandidate,
  PersistedCacheFinding,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError, WorkingCopyIntegrityRefusal } from "./errors.js";
import {
  detectCacheBackend,
  parseBlockfileIndexHeader,
  parseSimpleEntryFile,
  parseSimpleIndex,
  type CacheDirEntry,
  type SimpleIndexRecord,
} from "./cache-format.js";
import {
  absentField,
  createCandidate,
  createFinding,
  unavailableField,
  valueField,
  type FieldState,
  type Provenance,
  type SourceRowProvenance,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import type { ManifestEntry } from "./manifest.js";

/**
 * The Case-relative directory that holds cached response bodies as separately
 * hashed files. Payloads are content-addressed by SHA-256, so identical bytes
 * are stored once and every record references the file by digest instead of
 * inlining base64 into a Case or Extract row.
 */
export const CACHE_PAYLOAD_DIRECTORY = "cache-payloads";

// The Simple Cache stream-0/stream-1 entry file name for a hash.
const ENTRY_FILE_SUFFIX = "_0";
const SIMPLE_ENTRY_NAME = /^([0-9a-f]{16})_([01s])$/;
const REAL_INDEX_NAME = "index-dir/the-real-index";

interface CacheEntryFile {
  readonly manifestPath: string;
  readonly ordinal: number;
  readonly relativePath: string;
  readonly copied: boolean;
  readonly size: number | null;
}

interface PayloadFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly data: Uint8Array;
}

interface ProfileCache {
  readonly cacheDataPath: string;
  readonly files: readonly CacheEntryFile[];
  readonly presentInManifest: boolean;
  readonly anyCopied: boolean;
}

type ProvenanceBase = Omit<SourceRowProvenance, "table" | "rowId">;

function collectProfileCache(
  source: CaseSourceRecord,
  profile: string,
): ProfileCache {
  const cacheDataPath =
    profile === "." ? "Cache/Cache_Data" : `${profile}/Cache/Cache_Data`;
  const prefix = `${cacheDataPath}/`;
  const files: CacheEntryFile[] = [];
  let presentInManifest = false;
  let anyCopied = false;
  source.entries.forEach((entry: ManifestEntry, ordinal: number) => {
    if (!entry.path.startsWith(prefix) || entry.node_type === "dir") {
      return;
    }
    presentInManifest = true;
    if (entry.copied) {
      anyCopied = true;
    }
    files.push({
      manifestPath: entry.path,
      ordinal,
      relativePath: entry.path.slice(prefix.length),
      copied: entry.copied,
      size: entry.size,
    });
  });
  return { cacheDataPath, files, presentInManifest, anyCopied };
}

async function readHead(
  workingCopyPath: string,
  file: CacheEntryFile,
  length: number,
): Promise<Uint8Array> {
  const bytes = await readFile(
    join(workingCopyPath, ...file.manifestPath.split("/")),
  );
  return bytes.subarray(0, length);
}

async function readWhole(
  workingCopyPath: string,
  file: CacheEntryFile,
): Promise<Uint8Array> {
  return readFile(join(workingCopyPath, ...file.manifestPath.split("/")));
}

function timestampField(
  record: SimpleIndexRecord | undefined,
  declaredTimezone: string,
): FieldState<ForensicTimestamp> {
  if (record === undefined || record.lastUsedInternalMicros === 0n) {
    return absentField();
  }
  if (record.lastUsedUtc === null) {
    return unavailableField("timestamp_out_of_range");
  }
  return valueField(
    {
      raw: record.lastUsedInternalMicros.toString(),
      epochFamily: "1601-us",
      utc: record.lastUsedUtc,
      declaredTimezone,
      resolution: "simple_index_last_used_time",
    },
    { synthetic: false },
  );
}

function payloadFrom(data: Uint8Array): PayloadFile {
  return {
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.byteLength,
    data,
  };
}

function payloadFields(
  payload: PayloadFile | null,
): Record<string, FieldState<string>> {
  if (payload === null) {
    return {
      payloadSha256: absentField(),
      payloadBytes: absentField(),
      payloadPath: absentField(),
    };
  }
  return {
    payloadSha256: valueField(payload.sha256),
    payloadBytes: valueField(payload.bytes.toString()),
    payloadPath: valueField(`${CACHE_PAYLOAD_DIRECTORY}/${payload.sha256}`),
  };
}

function booleanField(value: boolean): FieldState<string> {
  return valueField(value ? "true" : "false");
}

async function writePayloads(
  caseDirectory: string,
  payloads: ReadonlyMap<string, PayloadFile>,
): Promise<void> {
  if (payloads.size === 0) {
    return;
  }
  const directory = join(caseDirectory, CACHE_PAYLOAD_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const payload of payloads.values()) {
    // Content-addressed by SHA-256, so a re-analysis rewrites byte-for-byte
    // identical content and stays idempotent.
    await writeFile(join(directory, payload.sha256), payload.data, {
      mode: 0o600,
    });
  }
}

function unavailableArtifact(
  source: CaseSourceRecord,
  profile: string,
  cacheDataPath: string,
  status: "absent" | "unavailable",
  reason: string,
): CacheArtifactWrite {
  return {
    sourceId: source.sourceId,
    profile,
    status,
    manifestEntryOrdinal: null,
    databasePath: cacheDataPath,
    backend: null,
    reason,
    findings: [],
    candidates: [],
    candidateCount: 0,
    payloadFileCount: 0,
  };
}

interface BuiltRecords {
  readonly findings: PersistedCacheFinding[];
  readonly candidates: PersistedCacheCandidate[];
  readonly payloads: Map<string, PayloadFile>;
}

async function buildSimpleRecords(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
  readonly cache: ProfileCache;
}): Promise<BuiltRecords> {
  const { cache, profile, declaredTimezone } = options;
  const base = (file: CacheEntryFile): ProvenanceBase => ({
    manifestEntryId: `${options.source.sourceId}:${file.ordinal}`,
    sourceId: options.source.sourceId,
    manifestEntryOrdinal: file.ordinal,
    manifestPath: file.manifestPath,
    database: cache.cacheDataPath,
  });

  // Parse the real index first: presence of an entry hash here is the ground
  // truth that separates a live entry (Finding) from a doomed/orphaned entry
  // file or an evicted index reference (Candidates).
  const indexFile = cache.files.find(
    (file) => file.relativePath === REAL_INDEX_NAME,
  );
  let indexRecords: ReadonlyMap<string, SimpleIndexRecord> = new Map();
  let indexBase: ProvenanceBase | null = null;
  if (indexFile !== undefined && indexFile.copied) {
    const parsed = parseSimpleIndex(
      await readWhole(options.workingCopyPath, indexFile),
    );
    if (parsed.ok) {
      indexRecords = parsed.records;
      indexBase = base(indexFile);
    }
  }

  // Group dense entry files by their 16-hex hash so one Finding covers an
  // entry's `_0`/`_1`/`_s` files and the supporting count is exact.
  const byHash = new Map<
    string,
    {
      readonly stream0: CacheEntryFile | null;
      readonly files: CacheEntryFile[];
    }
  >();
  for (const file of cache.files) {
    const name = file.relativePath.split("/").at(-1) ?? "";
    const match = SIMPLE_ENTRY_NAME.exec(name);
    if (match === null || !file.copied) {
      continue;
    }
    const hash = match[1] as string;
    const existing = byHash.get(hash) ?? { stream0: null, files: [] };
    const files = [...existing.files, file];
    byHash.set(hash, {
      stream0: match[2] === "0" ? file : existing.stream0,
      files,
    });
  }

  const findings: PersistedCacheFinding[] = [];
  const candidates: PersistedCacheCandidate[] = [];
  const payloads = new Map<string, PayloadFile>();
  const seenHashes = new Set<string>();

  const sortedHashes = [...byHash.keys()].sort();
  let candidateRank = 0;
  for (const hash of sortedHashes) {
    seenHashes.add(hash);
    const group = byHash.get(hash);
    if (group === undefined || group.stream0 === null) {
      // Stream files exist for the hash but no `_0` record: nothing citable to
      // parse, so it is a doomed/partial Candidate, never a Finding.
      candidateRank += 1;
      const primary = (group?.files[0] ?? null) as CacheEntryFile | null;
      if (primary !== null) {
        candidates.push(
          buildUnreadableCandidate(base(primary), hash, "missing_stream0", {
            profile,
            count: group?.files.length ?? 1,
            rank: candidateRank,
          }),
        );
      }
      continue;
    }
    const parsed = parseSimpleEntryFile(
      await readWhole(options.workingCopyPath, group.stream0),
    );
    const primaryBase = base(group.stream0);
    if (!parsed.ok) {
      candidateRank += 1;
      candidates.push(
        buildUnreadableCandidate(primaryBase, hash, parsed.reason, {
          profile,
          count: group.files.length,
          rank: candidateRank,
        }),
      );
      continue;
    }

    const payload =
      parsed.stream1.size > 0 ? payloadFrom(parsed.stream1.data) : null;
    if (payload !== null) {
      payloads.set(payload.sha256, payload);
    }
    const record = indexRecords.get(hash);
    const fields = {
      backend: valueField("simple"),
      entryHash: valueField(hash),
      key:
        parsed.keyText === null
          ? unavailableField("unsupported_value")
          : valueField(parsed.keyText),
      keyLength: valueField(parsed.keyLength.toString()),
      keyHashValid: booleanField(parsed.keyHashValid),
      entryHashMatchesFilename: booleanField(parsed.entryHashFromKey === hash),
      keySha256:
        parsed.keySha256 === null
          ? absentField()
          : valueField(parsed.keySha256),
      version: valueField(parsed.version.toString()),
      lastUsed: timestampField(record, declaredTimezone),
      entrySizeBytes:
        record === undefined
          ? absentField()
          : valueField(record.entrySizeBytes.toString()),
      stream0Size: valueField(parsed.stream0.size.toString()),
      stream1Size: valueField(parsed.stream1.size.toString()),
      stream1Crc32Valid:
        parsed.stream1.crc32Valid === null
          ? absentField()
          : booleanField(parsed.stream1.crc32Valid),
      ...payloadFields(payload),
    };

    if (record === undefined) {
      // On disk, parseable, but absent from the index: allocated-deleted or
      // doomed. Its key and payload are preserved as evidence, but the record
      // stays a Candidate and is never promoted to a Finding by heuristic.
      candidateRank += 1;
      candidates.push({
        candidate: createCandidate({
          candidateKind: "doomed_entry",
          rank: candidateRank,
          count: group.files.length,
          provenance: withSupporting(
            { ...primaryBase, table: "simple_entry", rowId: hash },
            group.files
              .filter((file) => file !== group.stream0)
              .map((file) => ({
                ...base(file),
                table: "simple_entry_stream",
                rowId: hash,
              })),
          ),
          fields: {
            ...fields,
            state: valueField("allocated_deleted_or_doomed"),
          },
        }),
        profile,
        commitState: "committed",
        backend: "simple",
        candidateKind: "doomed_entry",
        searchText: searchTextOf(profile, hash, parsed.keyText),
        sortKey: parsed.keyText,
        // A doomed entry is by definition absent from the index, so it has no
        // index-recorded last-used time to sort on.
        sortLastUsed: null,
      });
      continue;
    }

    const supporting: SourceRowProvenance[] = [];
    if (indexBase !== null) {
      supporting.push({
        ...indexBase,
        table: "the_real_index",
        rowId: hash,
      });
    }
    for (const file of group.files) {
      if (file !== group.stream0) {
        supporting.push({
          ...base(file),
          table: "simple_entry_stream",
          rowId: hash,
        });
      }
    }
    const finding = createFinding({
      findingKind: "cache_entry",
      profile,
      commitState: "committed",
      provenance: withSupporting(
        { ...primaryBase, table: "simple_entry", rowId: hash },
        supporting,
      ),
      fields,
    });
    findings.push({
      finding,
      searchText: searchTextOf(profile, hash, parsed.keyText),
      backend: "simple",
      sortKey: parsed.keyText,
      sortLastUsed: record?.lastUsedUtc ?? null,
      sortSizeBytes: record?.entrySizeBytes ?? null,
      sortEntryHash: hash,
    });
  }

  // An index record whose entry files are not recoverable on disk is an
  // evicted/absent-payload reference: preserved as a ranked Candidate, never a
  // Finding, because the payload it names cannot be produced.
  if (indexBase !== null) {
    for (const hash of [...indexRecords.keys()].sort()) {
      if (seenHashes.has(hash)) {
        continue;
      }
      const record = indexRecords.get(hash) as SimpleIndexRecord;
      candidateRank += 1;
      candidates.push({
        candidate: createCandidate({
          candidateKind: "evicted_reference",
          rank: candidateRank,
          count: 1,
          provenance: { ...indexBase, table: "the_real_index", rowId: hash },
          fields: {
            backend: valueField("simple"),
            entryHash: valueField(hash),
            state: valueField("evicted_or_absent_payload"),
            lastUsed: timestampField(record, declaredTimezone),
            entrySizeBytes: valueField(record.entrySizeBytes.toString()),
            payloadSha256: absentField(),
            payloadPath: absentField(),
          },
        }),
        profile,
        commitState: "committed",
        backend: "simple",
        candidateKind: "evicted_reference",
        searchText: searchTextOf(profile, hash, null),
        sortKey: null,
        sortLastUsed: record.lastUsedUtc,
      });
    }
  }

  return { findings, candidates, payloads };
}

function buildUnreadableCandidate(
  primaryBase: ProvenanceBase,
  hash: string,
  reason: string,
  options: {
    readonly profile: string;
    readonly count: number;
    readonly rank: number;
  },
): PersistedCacheCandidate {
  return {
    candidate: createCandidate({
      candidateKind: "unreadable_entry",
      rank: options.rank,
      count: options.count,
      provenance: { ...primaryBase, table: "simple_entry", rowId: hash },
      fields: {
        backend: valueField("simple"),
        entryHash: valueField(hash),
        state: valueField("unreadable_entry_file"),
        reason: valueField(reason),
        payloadSha256: absentField(),
        payloadPath: absentField(),
      },
    }),
    profile: options.profile,
    commitState: "committed",
    backend: "simple",
    candidateKind: "unreadable_entry",
    searchText: searchTextOf(options.profile, hash, null),
    sortKey: null,
    sortLastUsed: null,
  };
}

function withSupporting(
  primary: SourceRowProvenance,
  supporting: readonly SourceRowProvenance[],
): Provenance {
  return supporting.length === 0
    ? primary
    : { ...primary, supportingRows: supporting };
}

function searchTextOf(
  profile: string,
  hash: string,
  key: string | null,
): string {
  return [profile, hash, key ?? ""].join("\n").toLocaleLowerCase("en-US");
}

async function analyseProfileCache(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly caseDirectory: string;
  readonly declaredTimezone: string;
}): Promise<CacheArtifactWrite> {
  const cache = collectProfileCache(options.source, options.profile);
  if (!cache.presentInManifest) {
    return unavailableArtifact(
      options.source,
      options.profile,
      cache.cacheDataPath,
      "absent",
      "cache_absent",
    );
  }
  if (!cache.anyCopied) {
    // The cache exists in the Source but tier-2 bulk data was not collected, so
    // there is nothing to extract. This is an explicit unavailable reason, not
    // an empty result masquerading as "no cache".
    return unavailableArtifact(
      options.source,
      options.profile,
      cache.cacheDataPath,
      "unavailable",
      "cache_not_in_working_copy",
    );
  }

  let detectionEntries: CacheDirEntry[];
  try {
    detectionEntries = await Promise.all(
      cache.files
        .filter((file) => file.copied)
        .map(async (file) => ({
          relativePath: file.relativePath,
          head: await readHead(options.workingCopyPath, file, 16),
        })),
    );
  } catch (error) {
    return unavailableArtifact(
      options.source,
      options.profile,
      cache.cacheDataPath,
      "unavailable",
      `cache_read_failed:${String(error)}`,
    );
  }

  const detection = detectCacheBackend(detectionEntries);
  if (detection.backend === "blockfile") {
    const indexFile = cache.files.find((file) => file.relativePath === "index");
    let numEntries: number | null = null;
    if (indexFile !== undefined) {
      const header = parseBlockfileIndexHeader(
        await readHead(options.workingCopyPath, indexFile, 12),
      );
      numEntries = header.ok ? header.numEntries : null;
    }
    return {
      ...unavailableArtifact(
        options.source,
        options.profile,
        cache.cacheDataPath,
        "unavailable",
        numEntries === null
          ? "cache_backend_unsupported:blockfile"
          : `cache_backend_unsupported:blockfile:entries=${numEntries}`,
      ),
      backend: "blockfile",
    };
  }
  if (detection.backend === "sql") {
    return {
      ...unavailableArtifact(
        options.source,
        options.profile,
        cache.cacheDataPath,
        "unavailable",
        "cache_backend_unsupported:sql",
      ),
      backend: "sql",
    };
  }
  if (detection.backend === "unknown") {
    return {
      ...unavailableArtifact(
        options.source,
        options.profile,
        cache.cacheDataPath,
        "unavailable",
        "cache_backend_unrecognized",
      ),
      backend: "unknown",
    };
  }

  let built: BuiltRecords;
  try {
    built = await buildSimpleRecords({
      source: options.source,
      profile: options.profile,
      workingCopyPath: options.workingCopyPath,
      declaredTimezone: options.declaredTimezone,
      cache,
    });
  } catch (error) {
    if (error instanceof WorkingCopyIntegrityRefusal) {
      throw error;
    }
    const reason =
      error instanceof ForensixError
        ? `${error.code}:${error.message}`
        : `cache_read_failed:${String(error)}`;
    return {
      ...unavailableArtifact(
        options.source,
        options.profile,
        cache.cacheDataPath,
        "unavailable",
        reason,
      ),
      backend: "simple",
    };
  }

  await writePayloads(options.caseDirectory, built.payloads);

  const stream0Ordinal =
    cache.files.find((file) => file.relativePath.endsWith(ENTRY_FILE_SUFFIX))
      ?.ordinal ?? null;

  return {
    sourceId: options.source.sourceId,
    profile: options.profile,
    status: "complete",
    manifestEntryOrdinal: stream0Ordinal,
    databasePath: cache.cacheDataPath,
    backend: "simple",
    reason: null,
    findings: built.findings,
    candidates: built.candidates,
    candidateCount: built.candidates.length,
    payloadFileCount: built.payloads.size,
  };
}

export interface CacheAnalysisInput {
  readonly source: CaseSourceRecord;
  readonly workingCopyPath: string;
  readonly caseDirectory: string;
  readonly declaredTimezone: string;
}

export async function analyseSourceCache(
  input: CacheAnalysisInput,
): Promise<CacheArtifactWrite[]> {
  const artifacts: CacheArtifactWrite[] = [];
  for (const profile of input.source.profiles) {
    artifacts.push(
      await analyseProfileCache({
        source: input.source,
        profile: profile.path,
        workingCopyPath: input.workingCopyPath,
        caseDirectory: input.caseDirectory,
        declaredTimezone: input.declaredTimezone,
      }),
    );
  }
  return artifacts;
}
