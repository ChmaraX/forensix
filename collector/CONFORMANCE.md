# Collector conformance boundary

Issue #167 owns the canonical Analyzer–Collector Manifest and Selection Policy contract.
The Collector implements that contract in `internal/conformance`.

## Canonical contract

The canonical files are:

- `../contracts/manifest/manifest-entry.schema.json`
- `../contracts/manifest/manifest-header.schema.json`
- `../contracts/selection-policy.chrome-userdata-1.json`
- `../contracts/manifest/fixtures/canonical-v1/`
- `../contracts/manifest/fixtures/selection-policy-v1.json`

Collector tests read these files directly.
There is no private Collector copy of the fixtures.
The tests do these checks:

- compare Manifest bytes and both digests exactly
- run every language-neutral Selection Policy case
- compare the compiled policy with the machine-readable policy
- reject unknown policy fields

## Boundary decisions

1. Manifest entries and headers contain only canonical fields in canonical order.
2. Acquisition-only values, such as the absolute Source path and Go `time.Time`, do not enter Manifest JSON.
3. Chrome-running and Liveness Evidence remain Acquisition Bundle metadata. They are not added to the canonical Manifest header.
4. Tier 2 opt-in is recorded by `tier_2_included`. `selection_policy_diff` remains empty.
5. Paths outside a User Data Dir, including a platform scanner's external cache path, are not folded into that User Data Dir Manifest. The shared contract must define a second Source boundary before the Collector can represent those paths without a policy diff.
6. Unsupported filesystem Node Types fail collection explicitly instead of being mislabeled as sockets.

## Digest reproduction

The Evidence Set Digest is SHA-256 over canonical Manifest bytes.
The Working Copy Digest uses the same construction over entries where `copied` is `true`.
Both include the final LF for each line.

## Key-material boundary

Issue #187 adds a separate Collector-owned contract under `contracts/key-material/`.
It does not add key files to the User Data Dir Manifest or the Selection Policy.

Each key-material subtree has its own canonical Manifest and digest.
The Acquisition Bundle Manifest covers that Manifest, its header, all sealed records, and all opaque wrapper evidence.
The `strip-keys` operation removes the complete subtree and writes a new Acquisition Bundle Manifest and digest.
