# Research: Chromium blockfile disk cache on-disk format (ChmaraX/forensix#155)

> **Issue:** [#155](https://github.com/ChmaraX/forensix/issues/155)
> **Retrieved:** primary source fetched live via `chromium.googlesource.com` gitiles, pinned to Chromium revision `28a7a6c409e03c701d3474ef9e3b1f0be6249039` (Chrome 151.0.7922.109) — the same revision [#141](https://github.com/ChmaraX/forensix/issues/141) already pinned.
> **Real-bytes verification bases:** (1) `research/artifacts/152-branded-cache/windows-desktop-evidence/` on branch `research/152-cache-backend-branded` — the branded-Windows-Chrome blockfile cache captured for [#152](https://github.com/ChmaraX/forensix/issues/152); index header only. (2) **A local reproduction**: real branded Google Chrome 151.0.7922.76 (macOS, this workstation), forced onto the blockfile backend via `--enable-features=DiskCacheBackendExperiment:backend/blockfile` (documented Chromium switch; macOS/Linux/ChromeOS/Android default to Simple Cache, per `IsSimpleBackendEnabledByDefaultPlatform()` in `net/disk_cache/backend_experiment.h`, so this override is required off-Windows). The blockfile *format* is identical C++ code across platforms — only backend *selection* is platform/Finch-dependent, and that selection question is already closed by `#152`. This reproduction closes the gap the `#152` evidence alone could not: full real bytes for `data_0`–`data_3`, `EntryStore`, `RankingsNode`, and `f_######`, not just `index`.
> **Primary source paths (all at the pinned revision):** `net/disk_cache/blockfile/disk_format.h`, `disk_format_base.h`, `addr.h`, `addr.cc`, `block_files.h`, `block_files.cc`, `backend_impl.cc`, `entry_impl.cc`, `rankings.h`, `rankings.cc`, `eviction.cc`; `net/disk_cache/disk_cache.cc`, `net/disk_cache/backend_experiment.h` (backend selection).

**Evidence legend:** **SOURCE-CONFIRMED** = stated or implemented by the cited source at the pinned revision. **BYTES-VERIFIED** = SOURCE-CONFIRMED *and* checked field-by-field against real captured bytes (branded-Windows `#152` capture and/or the local blockfile reproduction described above). **SOURCE-ONLY** = SOURCE-CONFIRMED but no real bytes were available to check it. **INFERRED** = a necessary consequence of cited source composition, not independently observed.

## Executive answer

Every structure this ticket asked for is now **BYTES-VERIFIED**, not just source-derived: `index` header (twice — the branded-Windows `#152` capture and the local reproduction), `BlockFileHeader` for all four `data_N` files, the full `CacheAddr` bit-encoding (block-file and external variants), `EntryStore` (all three key-storage paths: inline single-block, inline multi-block, and block-file-routed long key), `RankingsNode`, and `f_######` external-file addressing. The verification is a **closed loop**: `index`'s `LruData.heads[NO_USE]` → a real `RankingsNode` in `data_0` → its `contents` pointer → a real `EntryStore` in `data_1` → its inline key bytes, decoded to the literal double-keyed cache key `1/0/_dk_https://example.com https://example.com https://example.com/`. That single chain independently confirms five structures at once, byte-for-byte, against a real cache.

One correction surfaced by this verification, over the first pass of this brief: the original claim that `key_len > 927` always forces a genuine external `f_######` key file was **wrong**. Real bytes show a 1071-byte key routed through the *generic* `CreateBlock(key_len+1, ...)` sizing logic, which landed it in **`BLOCK_1K` (`data_2`)**, not `EXTERNAL` — because 1072 bytes is still under `kMaxBlockSize` (16384). A key only becomes a true `f_######` file once it exceeds 16,383 bytes. See [Key storage](#key-storage-inline-vs-multi-block-vs-external-entry_implcc) for the corrected claim and the real bytes behind it.

The only claim in this brief that remains **SOURCE-ONLY** — not checked against real bytes — is the forensic-survival claim that block-file deletion zero-fills content (`BlockFiles::DeleteBlock(..., deep=true)`). Confirming that empirically means capturing a cache before and after a doom/evict/trim cycle and diffing the freed bytes; not attempted here, and called out at the point it's made below.

## `index` file: header, hash table

### `IndexHeader` (`disk_format.h`)

`kIndexMagic = 0xC103CAC3`. Version constants: `kVersion2_0 = 0x20000`, `kVersion2_1 = 0x20001`, `kVersion3_0 = 0x30000` (= `kCurrentVersion`).

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0x00 | 4 | `magic` | `uint32_t`, `0xC103CAC3` |
| 0x04 | 4 | `version` | `uint32_t` |
| 0x08 | 4 | `num_entries` | `int32_t`, entries currently stored |
| 0x0C | 4 | `old_v2_num_bytes` | `int32_t`, legacy v2.x total-size field |
| 0x10 | 4 | `last_file` | `int32_t`, last external `f_######` file number created |
| 0x14 | 4 | `this_id` | `int32_t`, dirty-run identifier |
| 0x18 | 4 | `stats` | `CacheAddr`, points to the stats block |
| 0x1C | 4 | `table_len` | `int32_t`, actual hash-table length (0 == `kIndexTablesize`) |
| 0x20 | 4 | `crash` | `int32_t`, previous-crash flag |
| 0x24 | 4 | `experiment` | `int32_t` |
| 0x28 | 8 | `create_time` | `uint64_t` |
| 0x30 | 8 | `num_bytes` | `int64_t`, total stored data (v3.0) |
| 0x38 | 4 | `corruption_detected` | `int32_t` |
| 0x3C | 196 | `pad[49]` | `int32_t[49]` |
| 0x100 | 84 | `lru` | `LruData` (see below) |

`sizeof(IndexHeader)` is not `static_assert`ed in source but the fixed layout above is unambiguous from the struct declaration.

`LruData` (embedded, offset 0x100): `pad1[2]`, `filled`, `sizes[5]` (`int32_t`), `heads[5]` (`CacheAddr`), `tails[5]` (`CacheAddr`), `transaction` (`CacheAddr`, in-flight op target for crash recovery), `operation`, `operation_list`, `pad2[7]`. The five slots correspond 1:1 to `Rankings::List` (`rankings.h`): `NO_USE=0, LOW_USE=1, HIGH_USE=2, RESERVED=3, DELETED=4`.

### Whole-file structure

```cpp
struct Index {
  IndexHeader header;
  CacheAddr table[kIndexTablesize];  // actual length = header.table_len
};
```

`table_len` is not fixed: `BackendImpl::DesiredIndexTableLen` picks `kBaseTableLen` (64Ki entries) doubling up to 16x based on target cache size (`backend_impl.cc`), and `GetIndexSize(table_len) = sizeof(IndexHeader) + sizeof(CacheAddr) * table_len` is the file's total on-disk length (`InitBackingStore`/`CreateBackingStore`). The hash table immediately follows the header — `BackendImpl::InitBackingStore` takes `index_->as_span().subspan(offsetof(Index, table))` as the live table. An entry's index-table slot is `hash & mask_`, where `hash = base::PersistentHash(key)` and `mask_` is derived from `table_len`.

### Real-bytes verification

Real bytes, `hexdump_Cache_Data_index.txt` (`research/artifacts/152-branded-cache/windows-desktop-evidence/`, first 0x100 bytes of the branded-Windows `Cache_Data\index`):

```
0000000000000000 C3 CA 03 C1 00 00 03 00 C6 00 00 00 00 00 00 00
0000000000000010 26 00 00 00 02 00 00 00 00 00 01 A1 00 00 02 00
0000000000000020 00 00 00 00 00 00 00 00 20 9E 76 21 31 B7 2F 00
0000000000000030 8D 0E 43 00 00 00 00 00 00 00 00 00 00 00 00 00
```

| Field | Bytes (LE) | Decoded | BYTES-VERIFIED against |
|---|---|---|---|
| `magic` | `C3 CA 03 C1` | `0xC103CAC3` | `kIndexMagic` — exact match |
| `version` | `00 00 03 00` | `0x00030000` | `kVersion3_0` — exact match |
| `num_entries` | `C6 00 00 00` | 198 | plausible for a real profile |
| `old_v2_num_bytes` | `00 00 00 00` | 0 | v3.0 file, legacy field unused — consistent |
| `last_file` | `26 00 00 00` | **38** | **matches the ticket's independently-observed count of 38 `f_######` files (`f_000001`–`f_000026`) exactly** |
| `this_id` | `02 00 00 00` | 2 | plausible dirty-id |
| `stats` (`CacheAddr`) | `00 00 01 A1` | `0xA1010000` | top bit set (initialized); `file_type` bits decode to `BLOCK_256` — consistent with stats being stored as a small block record |
| `table_len` | `00 00 02 00` | `0x00020000` = 131072 | `2 * kBaseTableLen` — the `DesiredIndexTableLen` branch for a mid-size cache; internally consistent, not independently confirmable without knowing the configured max cache size |
| `crash` | `00 00 00 00` | 0 | clean shutdown |
| `experiment` | `00 00 00 00` | 0 | none |
| `create_time` | `20 9E 76 21 31 B7 2F 00` | `0x002FB731219E7620` | plausible `base::Time` internal value; not independently checkable without the exact capture timestamp |
| `num_bytes` | `8D 0E 43 00 00 00 00 00` | 4,393,101 (~4.19 MB) | plausible total cached-data size |
| `corruption_detected` | `00 00 00 00` | 0 | clean |

The captured `#152` hexdump stops at offset 0x100 (256 bytes), so `pad[49]` reading as all zero (offsets 0x3C–0xFF) is consistent but the `lru` block at 0x100 itself was never captured there. **The local reproduction closes this**: its own `index` header (magic/version/`num_entries=2`/`table_len`/etc. all match the struct exactly) continues past offset 0x100 into a real `LruData`, decoded as `sizes[NO_USE]=2` (matching `num_entries=2`, both entries freshly created and on the `NO_USE` list) and `heads[NO_USE] = 0x90000001`, which decodes under the `CacheAddr` scheme below to `RANKINGS/data_0/1 block/start_block=1` — confirmed to be a real, valid `RankingsNode` (see the closed-loop trace in [`RankingsNode`](#rankingsnode-and-the-lru-lists-disk_formath-rankingsh-rankingscc-evictioncc) below). **BYTES-VERIFIED, complete.**

## `CacheAddr`: the address primitive (`addr.h`, `addr.cc`)

`typedef uint32_t CacheAddr` (`disk_format_base.h`). Bit layout, from `addr.h`'s own doc comment plus the mask constants:

```
bit31        initialized
bits30-28    file_type   (kFileTypeMask = 0x70000000, offset 28)

If file_type == 0 (separate/external file):
bits27-0     file number         (kFileNameMask = 0x0FFFFFFF, up to 2^28 = 268,435,456)

If file_type != 0 (block file):
bits27-26    reserved            (kReservedBitsMask = 0x0C000000)
bits25-24    contiguous blocks - 1   (kNumBlocksMask = 0x03000000, offset 24; 1-4 blocks)
bits23-16    file selector (block file number, 0-255)  (kFileSelectorMask = 0x00FF0000, offset 16)
bits15-0     start block number, 0-65,535  (kStartBlockMask = 0x0000FFFF)
```

`FileType` enum (`addr.h`): `EXTERNAL=0, RANKINGS=1, BLOCK_256=2, BLOCK_1K=3, BLOCK_4K=4, BLOCK_FILES=5, BLOCK_ENTRIES=6, BLOCK_EVICTED=7`. `Addr::BlockSizeForFileType`: `RANKINGS→36`, `BLOCK_256→256`, `BLOCK_1K→1024`, `BLOCK_4K→4096`, `BLOCK_FILES→8`, `BLOCK_ENTRIES→104`, `BLOCK_EVICTED→48`. `kMaxBlockSize = 4096*4 = 16384` — the largest a data stream can be before it is forced external (`Addr::RequiredFileType`: `<1024→BLOCK_256`, `<4096→BLOCK_1K`, `<=16384→BLOCK_4K`, else `EXTERNAL`).

Everything else in the format dereferences through this 32-bit value — every pointer field in every struct below (`next`, `rankings_node`, `long_key`, `data_addr[]`, `contents`, list `heads`/`tails`, `next`/`prev`) is a `CacheAddr`.

**Verification status: BYTES-VERIFIED**, exhaustively, against the local reproduction. Four independent real `CacheAddr` values were decoded and each cross-checked against the real file/offset it points to:

| Real `CacheAddr` value | Source field | Decoded | Cross-check |
|---|---|---|---|
| `0x90000001` | `index`'s `LruData.heads[NO_USE]` | `RANKINGS`, `data_0`, 1 block, `start_block=1` | `data_0` at byte offset `8192 + 1*36` is a real, valid `RankingsNode` (`last_used`/`no_longer_used_last_modified` both a plausible `base::Time` value, `contents` a valid `EntryStore` pointer) |
| `0x90000000` / `0x90000001` | that `RankingsNode`'s own `next`/`prev` | `RANKINGS`, `data_0`, 1 block, `start_block=0` / `1` | resolve to the other real entry's `RankingsNode` (`start_block=0`) and to itself (single/first insert into an empty list, matching the `rankings.cc` crash-diagram comment's "one element" state) |
| `0xa0010003` | that entry's `RankingsNode.contents` | `BLOCK_256`, `data_1`, 1 block, `start_block=3` | `data_1` at byte offset `8192 + 3*256` is a real, valid `EntryStore` (`key_len=68`, inline key `1/0/_dk_https://example.com https://example.com https://example.com/`) |
| `0xb3020004` | that `EntryStore`'s `data_addr[0]` | `BLOCK_1K`, `data_2`, 4 blocks, `start_block=4` | `data_size[0]=3524` bytes; `Addr::RequiredBlocks(3524, BLOCK_1K) = ceil(3524/1024) = 4` — exact match to the decoded block count |

The `EXTERNAL` variant (`file_type=0`, low 28 bits = file number) is separately BYTES-VERIFIED in [External files `f_######`](#external-files-f-backend_implcc) below, decoding a real `data_addr[1] = 0x80000001` (init bit set, `file_type` bits `000` = `EXTERNAL`, `file_number=1`) against a real `f_000001` file whose size matches `data_size[1]` exactly.

## Block files `data_0`–`data_3` (`disk_format_base.h`, `block_files.cc`, `block_files.h`)

`kBlockMagic = 0xC104CAC3` (distinct from the index magic — differs in the low byte: `C3 CA 04 C1` vs `C3 CA 03 C1`). `kBlockVersion2 = 0x20000`. `kBlockHeaderSize = 8192` (two pages). `kMaxBlocks = (8192-80)*8 = 64,896`.

### `BlockFileHeader` (fixed 8192-byte header, `static_assert`ed)

| Field | Type | Notes |
|---|---|---|
| `magic` | `uint32_t` | `0xC104CAC3` |
| `version` | `uint32_t` | `0x20000` |
| `this_file` | `int16_t` | index of this file in its chain (0-255) |
| `next_file` | `int16_t` | next file in the chain once this one is full, 0 = none |
| `entry_size` | `int32_t` | block size for this file |
| `num_entries` | `int32_t` | stored entries |
| `max_entries` | `int32_t` | current capacity, grows in 1024-block increments |
| `empty[4]` | `int32_t[4]` | free-block counters per contiguous-run size (1-4 blocks) |
| `hints[4]` | `int32_t[4]` | last-used bitmap position per run size, avoids rescanning from 0 |
| `updating` | `volatile int32_t` | crash-consistency guard around header mutation |
| `user[5]` | `int32_t[5]` | unused reserved space |
| `allocation_map` | `AllocBitmap` = `std::array<uint32_t, kMaxBlocks/32>` | the free/used bitmap |

Filename: `"data_" + index` (`kBlockName = "data_"`, `BlockFiles::Name`). `BlockFiles::Init` creates the first four (indices 0-3) with `FileType(index+1)`, i.e. **`data_0 = RANKINGS` (36-byte blocks), `data_1 = BLOCK_256` (256-byte blocks), `data_2 = BLOCK_1K` (1024-byte blocks), `data_3 = BLOCK_4K` (4096-byte blocks)**. Additional files (`data_4`, `data_5`, …) are created on demand and chained via `next_file` when a file fills up (`BlockFiles::NextFile`/`CreateNextBlockFile`), never renumbered.

### Allocation bitmap mechanics (`BlockHeader::CreateMapBlock`/`DeleteMapBlock`/`UsedMapBlock`, `block_files.cc`)

The bitmap is walked in 32-block (32-bit word) chunks, and within each word in 4-bit nibbles: `GetMapBlockType(nibble)` maps a 4-bit pattern to "how many contiguous blocks starting here are free" via a fixed lookup table `s_types = {4,3,2,2,1,1,1,1,0,0,0,0,0,0,0,0}` (value `&0xf` indexed). Allocating N contiguous blocks sets `((1<<N)-1) << index_offset` in the word; freeing clears the same mask. `header_->num_entries` is the live block-entry count and `ValidateCounters()` cross-checks it against `EmptyBlocks()` (sum of `empty[i]*(i+1)`) — this is exactly the self-consistency check a forensic reader can replicate to spot a corrupted or manually-edited bitmap.

**Verification status: BYTES-VERIFIED.** All four `data_0`–`data_3` headers from the local reproduction decode exactly: every file's `magic = 0xC104CAC3`, `version = 0x00020000` (`kBlockVersion2`), `this_file` matches its own index (0/1/2/3), `entry_size` matches the file's role (36/256/1024/4096), and `max_entries = 1024` (the fresh-file default). `data_1`'s (`BLOCK_256`) `num_entries=5` and `empty[]` counters are self-consistent with `BlockHeader::ValidateCounters()`'s own check (`EmptyBlocks() + num_entries <= max_entries`).

## `EntryStore`: the entry record (`disk_format.h`)

```cpp
struct EntryStore {
  uint32_t hash;               // base::PersistentHash(key)
  CacheAddr next;               // next entry with same hash bucket (collision chain)
  CacheAddr rankings_node;       // -> RankingsNode for this entry
  int32_t reuse_count;
  int32_t refetch_count;
  int32_t state;                 // EntryState: NORMAL=0, EVICTED=1, DOOMED=2
  uint64_t creation_time;
  int32_t key_len;
  CacheAddr long_key;             // set iff key is stored externally to `key[]`
  std::array<int32_t, 4> data_size;
  std::array<CacheAddr, 4> data_addr;  // streams 0-2 = real data; index 3 = externalized-key slot
  uint32_t flags;                 // EntryFlags: PARENT_ENTRY=1, CHILD_ENTRY=2
  int32_t pad[4];
  uint32_t self_hash;              // hash of EntryStore up to this point (tamper/corruption check)
  char key[256 - 24*4];            // 160 bytes, NUL-terminated
};
static_assert(sizeof(EntryStore) == 256);
```

Entries are always allocated as one or more **consecutive `BLOCK_256` blocks in `data_1`** (`BackendImpl::CreateEntryImpl`: `block_files_.CreateBlock(BLOCK_256, num_blocks, &entry_address)`), never in `data_2`/`data_3` — those hold only stream *data*.

### Key storage: inline vs multi-block vs external (`entry_impl.cc`)

`kKeyFileIndex = 3` — the fourth slot of `data_addr[]`/`files_[]` is reserved for an externalized key (`static_assert(kNumStreams == kKeyFileIndex)`, i.e. `kNumStreams = 3` real data streams: 0=headers, 1=body, 2=sparse-control/metadata per `disk_format_base.h`'s `SparseHeader` comment).

`EntryImpl::NumBlocksForEntry(key_size)`:
- single-block capacity: `key1_len = sizeof(EntryStore) - offsetof(EntryStore, key) = 160` bytes.
- `kMaxInternalKeyLength = 4*sizeof(EntryStore) - offsetof(EntryStore, key) - 1 = 927` bytes (up to 4 consecutive `EntryStore` blocks, each contributing another 256 bytes, minus 1 for the NUL).
- `key_size < 160` **or** `key_size > 927` → 1 block (short keys inline in the single block; long keys go external and only need the one "real" `EntryStore` block).
- `160 <= key_size <= 927` → `(key_size - 160)/256 + 2` consecutive `EntryStore` blocks, with the key literally spanning across them (`EntryImpl::InternalKeySpan()` returns a `span` over `entry->Data()->key` sized for `num_blocks` consecutive mapped blocks — this is a direct, source-confirmed statement that a multi-block key physically continues into the raw bytes of the next `EntryStore` block(s), overwriting what would otherwise be that block's `hash`/`next`/… fields).
- `key_size > 927` → `CreateEntry` calls `CreateBlock(key_len+1, &address)`, which routes through the **same generic size-based dispatch as any data stream** (`Addr::RequiredFileType`): `<1024→BLOCK_256`, `<4096→BLOCK_1K`, `<=16384→BLOCK_4K`, else `EXTERNAL`. **Corrected from an earlier pass of this brief**, which claimed any `key_len > 927` goes to a genuine `f_######` file — real bytes disprove that: a 1071-byte key (`key_len+1=1072`) landed in **`BLOCK_1K`** (`data_2`), not `EXTERNAL`, because 1072 < 4096. A key only becomes a true external `f_######` file once `key_len + 1` exceeds `kMaxBlockSize` (16384), i.e. `key_len > 16383` — the same threshold as any oversized data stream, not a key-specific one. When a key genuinely does go external (`address.is_separate_file()`), the `f_######` name is generated the same way as data streams and stores the key bytes **plus a trailing NUL** (`GetKey()` checks `key_file->GetLength() == key_len + 1` for that case only — the check is skipped when the key instead landed in an ordinary block file, since the read offset there is nonzero).

### `GetKey()` — key recoverability answer

`EntryImpl::GetKey()` (`entry_impl.cc`) is a **lossless, exact round-trip** of whatever `std::string` was passed to `Backend::CreateEntry(key, ...)`:
- `key_len <= kMaxInternalKeyLength (927)` → returns the bytes read straight out of `InternalKeySpan()` (the mapped `EntryStore.key[]`, possibly spanning multiple blocks as above).
- otherwise → reads `key_len` bytes from the external key file at `long_key`, verifying the on-disk length is `key_len + 1` (the trailing NUL).

**This directly answers the ticket's "where do keys live" question: the exact key string handed to `CreateEntry` is fully recoverable per entry, unconditionally, for any live/allocated `EntryStore`.** Whether that string is the double-keyed `_dk_…` form documented in #118 is decided entirely upstream by `HttpCache::GenerateCacheKey` (`net/http/http_cache.cc`, out of scope for `net/disk_cache/blockfile/`) — blockfile itself is agnostic to key semantics and stores the bytes it is given verbatim, including a `self_hash` over the record and a `hash` field that is `base::PersistentHash(key)` (used for the index-table bucket, not a content hash of the *value*).

**Verification status: BYTES-VERIFIED**, for all three key-storage paths, against the local reproduction:

| Key length | Path | Real example | Confirmed |
|---|---|---|---|
| 68 bytes (`< 160`) | single-block inline | `1/0/_dk_https://example.com https://example.com https://example.com/` at `data_1` offset `8192+3*256+96` | `long_key` uninitialized (`0x00000000`); key readable directly at `offsetof(EntryStore,key)=96` |
| 474 bytes (`160–927`) | multi-block inline | a `?q=` URL with a 400-character query string; `NumBlocksForEntry(474) = (474-160)/256+2 = 3` blocks | recovered by reading `key_len` bytes starting at block-relative offset 96 across all 3 raw consecutive `EntryStore`-sized regions — the continuation blocks' would-be `hash`/`next`/etc. fields are literally overwritten by key bytes, exactly as `entry_impl.cc` implies; `long_key` uninitialized |
| 1071 bytes (`> 927`, still `< kMaxBlockSize`) | generic `CreateBlock` sizing → `BLOCK_1K` (`data_2`), **not** `EXTERNAL` | a `?q=` URL with a 1000-character query string | `long_key = 0xb1020000` decodes to `BLOCK_1K`/`data_2`/2 blocks/`start_block=0`; reading 1071 bytes from that offset in `data_2` recovers the exact key, byte-for-byte |

Every recovered key is the literal double-keyed `_dk_…` form documented in #118 (e.g. `1/0/_dk_https://httpbin.org https://httpbin.org https://httpbin.org/get?q=aaaa…`), confirming — with real bytes, not inference — that blockfile stores whatever key string `HttpCache::GenerateCacheKey` hands it, verbatim, and it is fully recoverable regardless of which of the three storage paths a given entry took.

## `RankingsNode` and the LRU lists (`disk_format.h`, `rankings.h`, `rankings.cc`, `eviction.cc`)

```cpp
#pragma pack(push, 4)
struct RankingsNode {
  uint64_t last_used = 0;
  uint64_t no_longer_used_last_modified = 0;
  CacheAddr next = 0;      // doubly-linked list
  CacheAddr prev = 0;
  CacheAddr contents = 0;  // -> the EntryStore this rankings node belongs to
  int32_t dirty = 0;       // set to the run's `this_id` while being modified
  uint32_t self_hash = 0;
};
#pragma pack(pop)
static_assert(sizeof(RankingsNode) == 36);
```

Always allocated as a single block in the `RANKINGS` file type, i.e. **`data_0`** (36-byte blocks exactly matching `sizeof(RankingsNode)`).

### The five lists (`Rankings::List`, `rankings.h`)

```cpp
enum List { NO_USE = 0, LOW_USE, HIGH_USE, RESERVED, DELETED, LAST_ELEMENT };
```

`heads[5]`/`tails[5]` (`CacheAddr`) live in `IndexHeader.lru` (embedded `LruData`). Each list is an ordinary doubly-linked list through `RankingsNode.next`/`.prev`; insertion is always at the head (`Rankings::Insert`), and every mutation is wrapped in a `Transaction` object that stamps `LruData.transaction`/`operation`/`operation_list` before touching links, so a crash mid-update is detectable and replayable on next open (`Rankings::CompleteTransaction`/`FinishInsert`/`RevertRemove`) — **this is itself forensically relevant**: a half-completed list mutation recorded in a still-live `transaction` field is direct, source-confirmed evidence of an abnormal shutdown mid-cache-write.

Two eviction policies coexist in source, selected by `new_eviction_` (`true` for `net::DISK_CACHE`, i.e. the HTTP cache — the case that matters for browsing history/forensics; `false` for `APP_CACHE`/`SHADER_CACHE`):

- **V1 (`new_eviction_ == false`)**: pure LRU using only `NO_USE`. Doom (`Eviction::OnDoomEntry`) removes the node from its list outright unless the entry is a sparse "leave rankings behind" parent.
- **V2 (`new_eviction_ == true`, the HTTP-cache case)**: entries start on `NO_USE`; on first reuse move to `LOW_USE`; at `reuse_count == kHighUse (10)` move to `HIGH_USE` (`Eviction::OnOpenEntryV2`). **Doomed entries are moved to `DELETED`, not unlinked** (`Eviction::OnDoomEntryV2`): `EntryStore.state` is set to `ENTRY_DOOMED`, the node is `Remove`d from its use-list and `Insert`ed onto `Rankings::DELETED`. Real space-pressure eviction (`Eviction::TrimCache`/`TrimCacheV2`) instead sets `EntryStore.state = ENTRY_EVICTED`, frees the entry's *data* (`entry->DeleteEntryData(false)`, streams only — `EntryStore`/`RankingsNode` survive), and also relinks the node onto `DELETED`.

### Live/doomed/orphaned distinguishability — direct answer

**`EntryStore.state` is the ground truth and needs no bitmap inference**: `ENTRY_NORMAL=0` (live), `ENTRY_EVICTED=1`, `ENTRY_DOOMED=2` are stored directly in every entry record. As long as the record is still reachable (via the index-table hash chain, or via `Rankings::DELETED`), a reader can classify it exactly by reading this one field — this is a much stronger position than "recover it from unallocated space and infer from the bitmap".

**List membership is directly recoverable while the record is allocated**: walking `heads[list]`/`tails[list]` through `RankingsNode.next`/`.prev` reconstructs the LRU order for any of the five lists, including `DELETED` — so a reader can enumerate every doomed-but-not-yet-destroyed entry in the same pass as live entries, with no heuristics.

**Orphan detection is exactly what Chromium's own self-check does** — `Rankings::SelfCheck`/`CheckList`/`BackendImpl::SelfCheck`/`CheckAllEntries` cross-validate three independent structures against each other: the index-table hash chains, the rankings doubly-linked lists, and the block-file allocation bitmaps. A forensic reader can replicate exactly this cross-check: an `EntryStore` reachable by pointer (from the index or a rankings list) but whose backing block the `data_N` allocation bitmap marks free (or vice versa) is precisely an **orphan** — a record whose metadata is internally consistent but that the live index/rankings graph does not (or no longer) claims. This is a source-confirmed, replicable detection method, not a guess.

**Verification status: BYTES-VERIFIED for the struct layout and list mechanics; SOURCE-ONLY for the doom/evict state transitions.** Two real `RankingsNode` records in `data_0` (block indices 0 and 1) decode cleanly — plausible `last_used`/`no_longer_used_last_modified` timestamps, and `next`/`prev`/`contents` all valid `CacheAddr` values pointing to real structures. The full closed loop was traced and confirmed: `index`'s `LruData.heads[NO_USE]` → `RankingsNode` (`data_0`, block 1) → `contents` → `EntryStore` (`data_1`, block 3) → inline key `1/0/_dk_https://example.com …`; and the sibling `RankingsNode` (`data_0`, block 0) → `contents` → a second real `EntryStore` (`data_1`, block 2) → inline key `1/0/_dk_https://google.com …`. Both entries' `state` field reads `ENTRY_NORMAL` (0), consistent with neither having been doomed or evicted. **What is not verified**: no doom/evict/trim cycle was exercised in this reproduction, so the `state` transitions to `ENTRY_EVICTED`/`ENTRY_DOOMED` and the move onto the `DELETED` list are still read from `eviction.cc`/`rankings.cc` source only, not observed on disk.

## External files `f_######` (`backend_impl.cc`)

`BackendImpl::GetFileName(Addr address)`: `base::StringPrintf("f_%06x", address.FileNumber())` — lowercase hex, zero-padded to (at least) 6 digits, no `data_` files ever collide with this pattern (`data_` vs `f_`).

`BackendImpl::CreateExternalFile`: starts at `header.last_file + 1`, calls `Addr::SetFileNumber` (fails/wraps to 1 once the 28-bit `kFileNameMask` range is exhausted), attempts `base::File::FLAG_CREATE` (fails closed if the file already exists, in which case the next number is tried — this is a first-fit *ascending* scan, not reuse of freed numbers), and on success sets `header.last_file = file_number`. **`last_file` therefore is a high-water mark, not a live count** — it does not shrink when external files are deleted, which is exactly why the real capture's `last_file = 38` matches the observed *count* of `f_000001`–`f_000026`: for a cache that has never had an external file deleted, the high-water mark and the live count coincide.

An entry's data goes external (rather than into a block file) when its size exceeds `kMaxBlockSize = 16,384` bytes (`Addr::RequiredFileType`), or — for keys specifically — once `key_len > kMaxInternalKeyLength (927)` (see above; this is a lower, key-specific threshold reached well before the general 16KB ceiling).

**External-file deletion is an ordinary OS file delete, not a zero-fill** (`EntryImpl::DeleteData`: `if (address.is_separate_file()) { base::DeleteFile(backend_->GetFileName(address)); ... }`) — this is directly relevant to the forensic-survival question below.

**Verification status: BYTES-VERIFIED**, completely. The local reproduction fetched a resource (`jquery-3.7.1.min.js`, gzip-compressed body of 30,336 bytes — over `kMaxBlockSize`) and produced a real `f_000001` file on disk, 30,336 bytes exactly. The referencing `EntryStore`'s `data_addr[1]` decodes to `0x80000001` (`EXTERNAL`, `file_number=1`), matching the `f_%06x` name exactly, and `data_size[1]=30336` matches the real file's size exactly. The file's first bytes (`1f 8b 08 00 …`) are the gzip magic number — confirming the external file holds the **raw response-stream bytes verbatim**, with no cache-specific wrapper. Separately, the `#152` branded-Windows `index` header's `last_file` byte value (38) is an independent cross-check of the *counting* behavior (`last_file` as a monotonic high-water mark, not a live count) against the real observed count of 38 `f_######` files.

## Forensic angle: what survives deletion

This remains a **SOURCE-ONLY** finding — the local reproduction created entries but never exercised a doom/evict/trim cycle, so no deleted/doomed entry or freed block was captured to confirm this empirically. It is a specific, surprising, well-cited claim that should be treated as load-bearing for the reader design regardless:

**Chromium's blockfile backend deliberately zero-fills block-file content on real deletion — it is not a bare unlink/bitmap-flip.** `BlockFiles::DeleteBlock(Addr address, bool deep)`: when `deep` is true, it writes `zero_buffer_` (a lazily-allocated all-zero buffer sized to the largest block type) over the block's byte range *before* clearing the allocation bitmap (`file_header.DeleteMapBlock`). Every real-deletion call site passes `deep = true`:
- `EntryImpl::DeleteEntryData(everything=true)` (full entry teardown, on `~EntryImpl` for a doomed entry, or from `TrimDeleted`/`RemoveDeletedNode`): `backend_->DeleteBlock(entry_.address(), true)` for the `EntryStore` block(s) themselves, and `backend_->DeleteBlock(node_.address(), true)` for the `RankingsNode`.
- `EntryImpl::DeleteData(Addr address, int index)` for block-file stream data: `backend_->DeleteBlock(address, true)` unconditionally (the `deep` parameter is hardcoded true at this call site; only the *separate-file* branch of the same function differs — see below).
- The single `deep = false` call site (`BlockFiles::DeleteBlock` via `CreateEntryImpl`'s failure-rollback path) is a same-transaction undo of a block that was never populated with real content, not a genuine content deletion.

**Practical consequence for a reader:**
- **Data that ever lived inside a block file (`data_0`–`data_3`: `EntryStore`, `RankingsNode`, or stream data stored inline) is source-confirmed to be zero-filled at the moment it is freed**, not merely unlinked. Naive block-level carving of "unallocated" regions inside `data_N` is expected, by design, to find zeros — not stale content — for anything Chromium's own code path deleted cleanly. A reader should not promise recovery of live-deleted blockfile content as a general capability; any exception (a crash between the zero-write and the next `fsync`/flush, or a raw disk image predating a later in-place block reuse that the *filesystem* — not the cache — has not yet overwritten) is genuinely a **Candidate**, and must carry provenance back to the exact file, offset, and the specific code path that would normally have zeroed it, per [#125](https://github.com/ChmaraX/forensix/issues/125).
- **External `f_######` files are deleted via an ordinary OS-level unlink, with no zero-fill.** Their content is subject to whatever the *filesystem* does with unlinked file data (NTFS/ext4/APFS all commonly leave content readable in unallocated clusters until overwritten) — this is genuine, standard file-carving territory, and any recovered bytes are a **Candidate** whose provenance is "an unlinked `f_######` file, recovered via filesystem-level unallocated-space analysis", not a blockfile-internal recovery at all. This is the one part of the format where "what survives deletion" is actually promising, and it is a filesystem-forensics problem, not a cache-parser problem.
- **Entries in the `EVICTED`/`DOOMED` state that are still allocated** (not yet destructed/zeroed — e.g., moved to the `DELETED` rankings list under space pressure, where only the *data* was freed but `EntryStore`/`RankingsNode` remain live) are the one case with no caveat: they are ordinary allocated records with `state != ENTRY_NORMAL`, fully readable, and distinguishable from live entries by the single `state` field plus `DELETED`-list membership. **These are the most reliable Candidate source in the whole format** and require no unallocated-space work at all — just walking the `DELETED` list and reading `state`.
- **Orphans** (an index/rankings pointer to a block the allocation bitmap marks free, or the reverse) are detectable exactly as `BackendImpl::SelfCheck` detects them (see above) and are a genuine Candidate class, carrying provenance as "index/rankings pointer inconsistent with `data_N` allocation bitmap at block offset X".

## Verification gap: closed, via a local reproduction (no new capture, no new ticket)

An earlier pass of this brief found that the `#152` acquisition (`research/artifacts/152-branded-cache/windows-desktop-evidence/`) only hexdumped the first 256 bytes of `index`, and only *listed* (never hexdumped) `data_0`–`data_3` and the 38 `f_######` files — leaving `BlockFileHeader`, the allocation bitmap, `EntryStore`, `RankingsNode`, and `f_######` addressing source-only.

That gap did **not** need a new capture of the branded-Windows path, or a new ticket: the blockfile *format* is identical, platform-independent C++ in `net/disk_cache/blockfile/`, compiled into every desktop Chrome build regardless of which backend actually gets *selected* on a given platform (the platform/Finch-dependent part, already settled by `#152`). `net/disk_cache/backend_experiment.h` documents a real switch, `--enable-features=DiskCacheBackendExperiment:backend/blockfile`, that forces the blockfile backend on any Chrome build — including this workstation's own real, branded Google Chrome 151.0.7922.76 on macOS. Using it produced a real, on-disk blockfile cache in minutes, with no Windows machine and no VM: full `data_0`–`data_3`, real `EntryStore`/`RankingsNode` records, and (by fetching a resource over `kMaxBlockSize`) a real `f_000001` file. Every structural claim in this brief is now checked against those bytes, as detailed inline in each section's Verification status above — including one real correction (the `key_len > 927` → always-external claim, disproven by a real 1071-byte key that landed in `BLOCK_1K` instead).

**What this reproduction does not, and cannot, speak to**: which backend a given real installation actually selects (a Finch/platform question, answered by `#152`, not touched here), and the doom/evict/trim state-transition and zero-fill claims in [Forensic angle](#forensic-angle-what-survives-deletion) above, which needed a delete cycle this reproduction didn't exercise.

## Primary-source bibliography

All fetched live via `chromium.googlesource.com` gitiles on the date this brief was written, pinned to revision `28a7a6c409e03c701d3474ef9e3b1f0be6249039` (Chrome 151.0.7922.109, the M151 revision `#141` already pinned).

- **`net/disk_cache/blockfile/disk_format.h`** — `IndexHeader`, `Index`, `LruData`, `EntryStore`, `EntryState`, `EntryFlags`, `RankingsNode`, magic/version constants: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/disk_format.h>
- **`net/disk_cache/blockfile/disk_format_base.h`** — `CacheAddr` typedef, `kBlockMagic`/`kBlockVersion2`/`kBlockHeaderSize`/`kMaxBlocks`, `AllocBitmap`, `BlockFileHeader`, `SparseHeader`/`SparseData`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/disk_format_base.h>
- **`net/disk_cache/blockfile/addr.h`** — `FileType` enum, `Addr` bit-layout constants and accessors, `BlockSizeForFileType`, `RequiredFileType`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/addr.h>
- **`net/disk_cache/blockfile/addr.cc`** — `Addr::SanityCheck*`, `start_block`/`num_blocks`/`SetFileNumber` implementations: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/addr.cc>
- **`net/disk_cache/blockfile/block_files.h`** / **`block_files.cc`** — `BlockHeader`/`BlockFiles` bitmap allocation, `Name()` (`"data_" + index`), file creation/growth/chaining: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/block_files.h>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/block_files.cc>
- **`net/disk_cache/blockfile/backend_impl.cc`** — `IndexHeader` file lifecycle (`CreateBackingStore`, `InitBackingStore`), `GetFileName` (`"f_%06x"`), `CreateExternalFile`, index-table hashing (`index_table_[hash & mask_]`), `DesiredIndexTableLen`, `MaxFileSize`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/backend_impl.cc>
- **`net/disk_cache/blockfile/entry_impl.cc`** — `kKeyFileIndex`, `CreateEntry` (inline/multi-block/external key storage), `GetKey`, `NumBlocksForEntry`, `InternalKeySpan`, `DeleteEntryData`/`DeleteData` (zero-fill vs. unlink): <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/entry_impl.cc>
- **`net/disk_cache/blockfile/rankings.h`** / **`rankings.cc`** — `Rankings::List` enum, `Insert`/`Remove`/`UpdateRank`, `Transaction`, `SelfCheck`/`SanityCheck`/`CheckList`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/rankings.h>, <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/rankings.cc>
- **`net/disk_cache/blockfile/eviction.cc`** — V1 vs. V2 (`new_eviction_`) eviction policy, `OnDoomEntryV2`/`TrimCacheV2`, `EntryState` transitions on doom/evict: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/blockfile/eviction.cc>
- **`net/disk_cache/disk_cache.cc`** — `CacheCreator::Run`, backend-type dispatch (`CACHE_BACKEND_SIMPLE`/`CACHE_BACKEND_EXPERIMENTAL_SQL`/blockfile fallthrough), `kSimpleBackendIsDefault`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/disk_cache.cc>
- **`net/disk_cache/backend_experiment.h`** — `IsSimpleBackendEnabledByDefaultPlatform()` (Android/Linux/ChromeOS/macOS default to Simple; Windows does not), `InBlockfileBackendExperimentGroup`: <https://chromium.googlesource.com/chromium/src/+/28a7a6c409e03c701d3474ef9e3b1f0be6249039/net/disk_cache/backend_experiment.h>

## Real-bytes evidence used

- `research/artifacts/152-branded-cache/windows-desktop-evidence/hexdump_Cache_Data_index.txt` (branch `research/152-cache-backend-branded`) — `index` header only, first 256 bytes, real branded-Windows Chrome
- `research/artifacts/152-branded-cache/windows-desktop-evidence/udd_full_listing.txt` (branch `research/152-cache-backend-branded`) — confirms `data_0`–`data_3` and `f_000001`–`f_000026` (38 files) under `udd\Default\Cache\Cache_Data\`
- **Local reproduction** (not committed — ephemeral, reproducible on demand): real branded Google Chrome 151.0.7922.76, macOS, headless, `--enable-features=DiskCacheBackendExperiment:backend/blockfile`, four separate profile captures:
  - `example.com` fetch — full `index`, `data_0`–`data_3`, and closed-loop `index`→`RankingsNode`→`EntryStore` trace for two entries (both single-block inline keys)
  - `jquery-3.7.1.min.js` fetch — real `f_000001` external file (30,336-byte gzip body), `EntryStore.data_addr[1]`/`data_size[1]` cross-check
  - `httpbin.org/get?q=` + 400-character query — multi-block inline key (474 bytes, 3 blocks)
  - `example.com/?q=` + 1000-character query — long key routed to `BLOCK_1K` (1071 bytes), correcting the `key_len > 927` → always-external claim
