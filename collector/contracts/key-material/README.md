# Key-material subtree contract

This Collector-owned contract defines the separable `key_material/` subtree in an Acquisition Bundle.
It does not change the canonical User Data Dir Manifest or Selection Policy.

Each collected User Data Dir has this shape when the operator explicitly enables authorized key capture:

```text
key_material/<account-id>/udd-N/
  key_material_manifest_header.json
  key_material_manifest.jsonl
  key_material_bundle.json
  records/<record-id>.json
  evidence/<opaque-wrapper>.bin      # when a provider has wrapper evidence
```

## Sealed material

A `captured` record contains a derived OSCrypt row key sealed to an operator-supplied X25519 public key.
The Collector creates one ephemeral X25519 key for each record.
It derives a 32-byte seal key with HKDF-SHA-256.
The HKDF salt is the decoded `salt` field.
The HKDF info string is `forensix/key-material-seal/1`.

The Collector seals the row key with AES-256-GCM.
The `nonce` and `ciphertext` fields use padded standard base64.
The ciphertext includes the 16-byte GCM tag.

The associated data is one compact JSON line with `sealed_material` set to `null`.
The line uses the record schema field order and ends with LF.
This data authenticates the provider, context, policy, and evidence references.
No plaintext provider secret or derived row key is serialized.

`unsupported` and `unavailable` records have `usable_row_key: false` and `sealed_material: null`.
A Windows App-Bound `v20` record preserves the exact decoded `Local State` wrapper as opaque evidence and records version `v20` plus policy reason `unsupported-google-app-bound-key-variant`.
It never claims a usable row key.

## Analyzer input

`key_material_bundle.json` is the analyzer input for the subtree.
It is one JSON object with these fields:

- `schema`: `forensix/key-material-bundle/1`
- `records`: every record of `records/`, sorted by `record_id`, with the same fields and values

The analyzer reads it with `forensix analyse --decrypt --key-material <subtree> --recipient-key <private-key>`.
When `<subtree>` is the subtree directory, the analyzer first does these checks:

- The SHA-256 of `key_material_manifest.jsonl` is equal to `manifest_digest`.
- Each Manifest entry matches the size and SHA-256 of its file.
- Each regular file in the subtree, other than the Manifest and its header, has a Manifest entry.
- The records in `key_material_bundle.json` are equal to the files in `records/`.

If a check fails, the analyzer stops with `INVALID_ARGUMENT`.

`fixtures/captured-v1/` contains the exact Collector output for one captured GNOME libsecret row key and one unavailable KWallet record.
`recipient-private.pem` is a test-only X25519 key. It protects no real key material.
The Collector test `TestKeyMaterialSubtreeMatchesSharedGolden` writes the subtree again and compares the bytes.
The analyzer test `e2e/decrypt-cli.test.ts` decrypts with the fixture.
After an intentional contract change, run `FORENSIX_UPDATE_GOLDEN=1 go test ./internal/collector -run Golden` to write the fixture again.

## Canonical Manifest

`key_material_manifest.jsonl` contains every regular payload file under that User Data Dir's key-material subtree, excluding the Manifest and its header.
Each line uses the field order in `key-material-manifest-entry.schema.json`, UTF-8, and LF.
Lines are sorted by path in unsigned byte order.
`manifest_digest` is SHA-256 over those exact Manifest bytes.

Reproduce the digest with standard tools:

```sh
LC_ALL=C sort key_material_manifest.jsonl | sha256sum
```

The Acquisition Bundle's `bundle_manifest.json` also covers the key-material Manifest, header, sealed records, and opaque wrapper evidence.

## Strip operation

`forensix-collect strip-keys --out <new-bundle> <input-bundle>` verifies the input bundle, copies only manifested non-key files, removes the complete `key_material/` subtree, and writes a new bundle Manifest and digest.
The new bundle records the original bundle digest and remains self-consistent without key material.
The input Acquisition Bundle is never modified.
