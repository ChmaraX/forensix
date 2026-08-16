# Acquisition Bundle Digest contract

The Acquisition Bundle Digest is the single cross-implementation digest for a
whole Acquisition Bundle. The Collector writes it as `bundle_digest` in
`bundle_manifest.json`. The analyzer recomputes it independently when it
inspects a Bundle, and refuses a Bundle whose recomputed digest differs.

## Construction

1. List every regular file in the Bundle as `{ path, size, sha256 }`, where
   `path` is the slash-separated path relative to the Bundle root.
2. Sort the list by `path`.
3. Serialize the list as JSON with fields in the order `path`, `size`,
   `sha256`.
4. The digest is SHA-256 over those JSON bytes followed by one trailing LF.

Both implementations must serialize identically, so the field order is fixed
and shared. There is no private copy of this construction:

- Collector: `collector/internal/collector/bundle.go` (`bundleFileDigest`).
- Analyzer: `core/src/acquisition-bundle.ts`
  (`acquisitionBundleFilesDigest`).

## Shared golden

`fixtures/canonical-v1/bundle-files.json` is the canonical sorted file list.
`fixtures/canonical-v1/expected-bundle-digest.json` pins its digest.

Both implementations pin this golden to the same value as a required check:

- Collector: `collector/internal/collector/bundle_conformance_test.go`.
- Analyzer: `core/test/acquisition-bundle-conformance.test.ts`.

A divergence in either serialization fails these tests before release.
