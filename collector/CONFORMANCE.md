# Draft Collector conformance boundary

Issue #167 owns the canonical Analyzer–Collector contract. This walking skeleton does not silently claim that its draft wire schema is final. Its golden fixture verifies Collector determinism only; the required cross-implementation test remains pending until #167 supplies the Analyzer implementation.

## Settled decisions implemented

1. Selection Policy is named `chrome-userdata/1`.
2. A Manifest is exhaustive and canonical path-sorted JSONL. `path` is the first key. Encoding is UTF-8 with LF endings and no insignificant whitespace.
3. Each entry records path, size, SHA-256, mtime, Node Type, file kind, copied state, and policy tier.
4. Evidence Set Digest is SHA-256 over all canonical Manifest lines. Working Copy Digest uses the identical construction over entries with `copied: true`.
5. A symlink hash covers its target text. Other non-file nodes hash their recorded Node Type representation and are never dereferenced.
6. Expected missing Tier 1 artifacts use Node Type `absent`. Unclassified entries are hashed but not copied.

## Draft assumptions requiring #167 reconciliation

- Schema identifiers and exact JSON field names.
- RFC 3339 encoding and precision for mtime.
- Whether `hash_algorithm` is repeated per entry or only stated in the header.
- The exact recorded representation for `dir`, `socket`, and `absent` hashes.
- Whether Working Copy Digest hashes copied Manifest lines, as here, or a separate canonical projection.
- File-kind vocabulary and classification of browser state files.
- Exact expected paths for artifacts that moved between profile root and subdirectories. The Collector matches Tier 1 by basename and emits canonical absent placeholders at the profile root.
- Bundle-level digest projection. This draft hashes canonical JSON for the path-sorted list of all bundle files except `bundle_manifest.json`, avoiding a circular self-hash.

All assumptions above are confined to `internal/conformance` or bundle assembly. Reconciliation must change that boundary and its fixtures, not scanner or Source-read behavior.
