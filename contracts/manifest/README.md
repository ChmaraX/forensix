# Manifest contract v1

This directory contains the shared contract for the Analyzer and the Go Collector.
Both programs must emit the same bytes for the same Source records.

## Manifest file

A Manifest is a UTF-8 JSONL file with LF line endings.
Each line contains one object that obeys `manifest-entry.schema.json`.
The final line also ends with LF.

The Manifest contains each descendant of the Source root.
The Manifest does not contain the Source root itself.
It also contains expected Tier 1 paths that are absent or unavailable.
Each `path` is relative to the Source root and uses `/` separators.

`manifest_header.json` obeys `manifest-header.schema.json`.
The header records whether the operator included Tier 2 content.
The header does not contribute bytes to either digest.

The object keys have this fixed order:

1. `path`, `state`, `unavailable_reason`, `node_type`, `file_kind`
2. `selection_tier`, `copied`, `unclassified`
3. `size`, `mtime_ns`, `hash_algorithm`, `sha256`, `link_target`

Sort complete JSON lines in unsigned UTF-8 byte order.
A Source cannot contain two entries with the same `path`.
Do not add insignificant whitespace to a line.
Write non-ASCII characters as UTF-8 and do not escape `<`, `>`, or `&`.
Escape quotation marks, backslash characters, and JSON control characters.
The `canonical-v1` fixture fixes these serialization rules with exact bytes.

## Node representations

Use SHA-256 for each representation:

| Node Type | Representation                     |
| --------- | ---------------------------------- |
| `file`    | The file bytes                     |
| `symlink` | The UTF-8 bytes of the target text |
| `socket`  | The UTF-8 bytes of `socket`        |
| `dir`     | The UTF-8 bytes of `dir`           |
| `absent`  | The UTF-8 bytes of `absent`        |

Do not dereference a symlink.
Do not open a socket.
Do not recreate a symlink or socket in the Working Copy.

Set `sha256` to `null` only when `state` is `unavailable`.
Use a stable reason from the schema for each unavailable entry.
A failed read is not an absent entry.

## Selection Policy

`../selection-policy.chrome-userdata-1.json` is the machine-readable Selection Policy.
A profile directory has one of the exact names in the contract.
A numbered profile starts with `Profile ` and ends with a positive decimal integer.

Copy regular Tier 1 files.
Copy SQLite sidecars with their Tier 1 database.
Copy regular Tier 2 files only when the operator selects Tier 2.
Do not copy Tier 3 or unclassified content.

Manifest all node types in every tier.
Set `copied` to `false` for directories, symlinks, sockets, absent entries, and unavailable entries.
The `unclassified_count` counts available unclassified nodes other than directories.

## Digest contract

The Evidence Set Digest is SHA-256 over all canonical Manifest lines.
Include the LF byte after each line.
Thus, hashing `manifest.jsonl` reproduces this digest.

The Working Copy Digest uses the same construction over lines where `copied` is `true`.
Keep the line order and the final LF bytes.
This command reproduces the digest on a POSIX system:

```sh
LC_ALL=C grep '"copied":true' manifest.jsonl | sort | sha256sum
```

Use `shasum -a 256` instead of `sha256sum` on macOS.
The digest covers the selected Source metadata and content hashes.
Working Copy verification reads each selected file and independently rebuilds these lines.

## Conformance fixtures

Each fixture directory contains inputs and exact expected bytes.
An implementation must compare its output with `manifest.jsonl` byte for byte.
It must also compare both digests with `expected-digests.json`.
