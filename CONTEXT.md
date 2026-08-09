# Context

The ubiquitous language for ForensiX. Glossary only — no implementation detail, no decisions. Decisions live in their tickets on the [ForensiX v2 Renewal Spec](https://github.com/ChmaraX/forensix/issues/116) map.

Seeded from [Forensic integrity model](https://github.com/ChmaraX/forensix/issues/125). Terms are added as tickets settle them.

## Acquisition

**Source** — what an investigator hands to ForensiX. One of five kinds: `USER_DATA_DIR` (canonical), `PROFILE_DIR`, `FILESYSTEM_ROOT`, `ACQUISITION_BUNDLE`, `IMAGE_CONTAINER`.

**User Data Dir** — Chrome's top-level directory. Holds `Local State` and N profile directories. `Local State` is a *sibling* of the profile directories, not inside one.

**Profile** — one Chrome profile directory (`Default`, `Profile 1`, …) inside a User Data Dir.

**Acquisition Bundle** — a source that arrives with a manifest made at acquisition time. The only source kind about which ForensiX can make a claim predating its own ingest. Produced by the Collector.

**Collector** — the ForensiX program that acquires from a live machine and emits an Acquisition Bundle. A separate program from the analysis tool, bound by different rules: it is the only part of ForensiX permitted to read a live key store.

**Selection Policy** — the named, versioned rule that decides which files a Collector or an Ingest takes as content. Recorded in every Manifest header. A per-case change is recorded as a diff against the named version, never applied silently.

**Scan Record** — what a Collector looked for on a machine, what it found, and what it could not open. Keeps an unreadable user account distinct from an absent one.

**Ingest** — the moment ForensiX first reads a source and records its hashes. ForensiX's chain of custody begins here.

**Working Copy** — the hashed copy of a source that all analysis runs against. Originals are never written.

## Integrity

**Manifest** — the per-file record of a source: path, size, hash, mtime, node type, file kind, and whether the file was copied. **Exhaustive over the source** — a file that is not copied still has a line, including its hash. The primary integrity artifact.

**Node Type** — what a Manifest entry is: `file`, `symlink`, `socket`, `dir`, or `absent`. For anything but `file`, the hash covers the recorded representation — a symlink's target text — and never dereferenced content.

**Unclassified** — a file the Selection Policy does not name in any tier. Manifested and hashed, content not taken, and reported as a count. Makes an unknown artifact visible as a path.

**Evidence Set Digest** — a single hash derived from the whole Manifest, so it covers the source as found. Reproducible outside ForensiX with standard tools. Never the primary record.

**Working Copy Digest** — the same construction over the copied subset only. Distinct from the Evidence Set Digest, and never a substitute for it.

**Liveness Evidence** — files whose value is that they show the browser was running: `SingletonLock` (a symlink encoding host and pid), `RunningChromeVersion`. Destroyed by a naive copy.

**Provenance** — the path from an emitted row back to the bytes it came from: manifest file id, database, table, rowid.

**Field State** — every emitted field is exactly one of `value`, `absent` (looked, not there), or `unavailable` (could not look, with a reason). A `value` is never synthesised from the other two. A `value` may carry a `synthetic` flag: it was written by a migration, not by the event it appears to record, and is not evidence of that event.

**Candidate** — a ranked possibility produced by a heuristic, carrying a count and provenance. Never presented as a finding.

**Finding** — an assertion ForensiX makes as fact. Only a `value` with provenance, resolved without reliance on a heuristic, can be one. A `value` resolved by magnitude test or any other heuristic discriminator is a `Candidate`, never a `Finding`, regardless of how decisive the heuristic appears.

**Declared Origin OS** — the operating system that wrote a Working Copy's Chrome data, stated by the investigator. Required only for columns whose `Epoch Family` is platform-conditional at the recorded version (History `meta.version <= 16`, Cookies `meta.version <= 3`). A `SingletonLock` symlink, when present, may corroborate a non-Windows declaration or flag a conflict with one, but its absence proves nothing and it is never sufficient alone. Always labelled as declared, never derived.

## Data semantics

**Commit State** — whether a row was committed in the main database file (`committed`) or found only in a sidecar (`wal_resident`, `journal_resident`).

**Sidecar** — a SQLite `-wal`, `-shm` or `-journal` file. Travels with its database or its rows are lost.

**Epoch Family** — which time base a stored timestamp uses. One of: 1601-µs, 1601-ms, 1601-seconds, Unix seconds, Unix µs, Unix-ms (JSON double), Omaha days. A property of a **column**, at a given database version, from a given originating OS (see **Declared Origin OS**), and only after the recorded version has been verified against the schema. Never a property of a file, and never of the tool.

**Declared Timezone** — the suspect's timezone, stated by the investigator. No Chrome artifact records the timezone as a setting. One History column persists a locally-derived value from which an offset can be recovered (see #143). ForensiX does not use it to derive a timezone. Defaults to UTC and is always labelled as declared, never derived. The host's timezone is never used.

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
