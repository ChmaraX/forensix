# Acquisition Bundle contract

## Schema version

The current Acquisition Bundle schema version is `forensix-acquisition-bundle-draft/2`.
There is only one current version.
The Collector writes this version in `schema_version` in `bundle_manifest.json`.
The analyzer accepts only this version.
The analyzer refuses a Bundle with another version.
The error code is `INGEST_FAILED`, and the error details contain `reason: "unsupported_bundle_schema_version"`, the `schemaVersion` of the Bundle, and the `supportedSchemaVersion`.

`bundle-manifest.schema.json` defines `bundle_manifest.json`.
Version `draft/2` adds these fields to `draft/1`:

- `key_material_capture_requested`
- `key_material_stripped`
- `original_bundle_digest`, only when `key_material_stripped` is `true`
- `key_material`, one summary for each key-material subtree

Both implementations check the version:

- Collector: `BundleSchemaVersion` in `collector/internal/collector/collector.go`. The test `TestBundleManifestMatchesSharedSchema` compares it with the schema.
- Analyzer: `ACQUISITION_BUNDLE_SCHEMA_VERSION` in `core/src/acquisition-bundle.ts`.
- `e2e/source-kinds-cli.test.ts` builds the Go Collector, collects a synthetic User Data Dir, and ingests and analyses the Bundle.

Change the version only when the meaning of a field changes.
Change both implementations, this schema, and the tests in the same change.

## User Data Dir Manifests

Each collected User Data Dir has a `manifest.jsonl` and a `manifest_header.json` that obey `../manifest/`.
If the Collector cannot read a Source file, or the file changes between the inventory and the copy, the Manifest entry is `unavailable`.
The reason is `permission_denied`, `io_error`, or `changed_during_ingest`.
The Collector does not copy that file, and it continues with the other files.
If the Collector cannot list a directory, the directory entry is `unavailable`.
An expected path under that directory is `unavailable` with the reason `parent_unavailable`, not `absent`.
The User Data Dir `outcome` is `failed` only when the Collector cannot read the root or cannot write the Bundle.
A `collected` User Data Dir has `evidence_set_digest` and `working_copy_digest`. A `failed` or `skipped_chrome_running` User Data Dir has `error`.

## Acquisition Bundle Digest

The Acquisition Bundle Digest is the single cross-implementation digest for a
whole Acquisition Bundle. The Collector writes it as `bundle_digest` in
`bundle_manifest.json`. The analyzer recomputes it independently when it
inspects a Bundle, and refuses a Bundle whose recomputed digest differs.

### Construction

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

### Shared golden

`fixtures/canonical-v1/bundle-files.json` is the canonical sorted file list.
`fixtures/canonical-v1/expected-bundle-digest.json` pins its digest.

Both implementations pin this golden to the same value as a required check:

- Collector: `collector/internal/collector/bundle_conformance_test.go`.
- Analyzer: `core/test/acquisition-bundle-conformance.test.ts`.

A divergence in either serialization fails these tests before release.
