# Context

The ubiquitous language for ForensiX. Glossary only — no implementation detail, no decisions. Decisions live in their tickets on the [ForensiX v2 Renewal Spec](https://github.com/ChmaraX/forensix/issues/116) map.

Seeded from [Forensic integrity model](https://github.com/ChmaraX/forensix/issues/125). Terms are added as tickets settle them.

## Acquisition

**Source** — what an investigator hands to ForensiX. One of five kinds: `USER_DATA_DIR` (canonical), `PROFILE_DIR`, `FILESYSTEM_ROOT`, `ACQUISITION_BUNDLE`, `IMAGE_CONTAINER`.

**User Data Dir** — Chrome's top-level directory. Holds `Local State` and N profile directories. `Local State` is a *sibling* of the profile directories, not inside one.

**Profile** — one Chrome profile directory (`Default`, `Profile 1`, …) inside a User Data Dir.

**Acquisition Bundle** — a source that arrives with a manifest made at acquisition time. The only source kind about which ForensiX can make a claim predating its own ingest.

**Ingest** — the moment ForensiX first reads a source and records its hashes. ForensiX's chain of custody begins here.

**Working Copy** — the hashed copy of a source that all analysis runs against. Originals are never written.

## Integrity

**Manifest** — the per-file record of a source: path, size, hash, mtime, and file kind. The primary integrity artifact.

**Evidence Set Digest** — a single hash derived from the manifest. Reproducible outside ForensiX with standard tools. Never the primary record.

**Liveness Evidence** — files whose value is that they show the browser was running: `SingletonLock` (a symlink encoding host and pid), `RunningChromeVersion`. Destroyed by a naive copy.

**Provenance** — the path from an emitted row back to the bytes it came from: manifest file id, database, table, rowid.

**Field State** — every emitted field is exactly one of `value`, `absent` (looked, not there), or `unavailable` (could not look, with a reason). A `value` is never synthesised from the other two.

**Candidate** — a ranked possibility produced by a heuristic, carrying a count and provenance. Never presented as a finding.

**Finding** — an assertion ForensiX makes as fact. Only a `value` with provenance can be one.

## Data semantics

**Commit State** — whether a row was committed in the main database file (`committed`) or found only in a sidecar (`wal_resident`, `journal_resident`).

**Sidecar** — a SQLite `-wal`, `-shm` or `-journal` file. Travels with its database or its rows are lost.

**Epoch Family** — which time base a stored timestamp uses: microseconds since 1601-01-01 UTC, or seconds since 1970-01-01 UTC. A property of a column at a given database version, not of the tool.

**Declared Timezone** — the suspect's timezone, stated by the investigator. Nothing in a Chrome profile records it. Defaults to UTC and is always labelled as declared, never derived. The host's timezone is never used.

## Export

**Export** — a bundle of artifacts leaving ForensiX for use outside it. Derived from a Case, never a system of record.

**Extract** — the machine-readable half of an Export: canonical rows plus a header. The citable record.

**Report** — the human-readable half, generated *from* the Extract and never from the Case. A rendering, never a second source of truth.

**Export Manifest** — the per-file record of an Export bundle, with a derived digest. The outbound mirror of the Manifest and Evidence Set Digest.

**Completeness Statement** — what an Export attempted, produced, and could not produce, per source and per artifact. Keeps absence distinct from failure at artifact scale, as Field State does at field scale.

**Redaction State** — whether an Export carries plaintext secrets. Declared in the header and inherited by the Report.

## Scope

**Capability** — one forensic question ForensiX can answer, stated as a question. The unit the v1 intent inventory counts.

**Intent** — what v1 set out to do. The scope boundary for v2 is v1's *purpose*, never v1's code or behaviour.
