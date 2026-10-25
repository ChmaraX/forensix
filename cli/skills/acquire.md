---
name: acquire
description: Make a ForensiX Case from a Source with ingest, then parse it with analyse.
---

# Acquire: ingest and analyse

Two commands make a Case ready for queries. `ingest` hashes and copies the Source into the Case. `analyse` parses the copy into records. Neither command writes to the Source.

## 1. Get the facts from the user

Ask the user for each item that you do not know. Do not guess.

- **Source path and Source kind.** The default kind is `USER_DATA_DIR` (the `.../Google/Chrome` or `User Data` directory, which contains `Local State`). Other kinds:
  - `PROFILE_DIR`: one Profile directory (`Default`, `Profile 1`). Browser-level files are then `unavailable(outside_source)`.
  - `FILESYSTEM_ROOT`: a mounted file system. ForensiX searches it for Chrome installations.
  - `IMAGE_CONTAINER`: a disk image that is already mounted or extracted read-only. ForensiX does not open E01 files.
  - `ACQUISITION_BUNDLE`: the output of the `forensix-collect` Collector.
- **Declared Timezone** of the machine (IANA name, for example `Europe/Prague`). The default is `UTC`. A wrong zone gives wrong local times in every answer.
- **Origin OS** (`windows`, `macos`, `linux`), only if the History database is version 16 or earlier.
- **Decryption authorization.** Run `--decrypt` only when the user says they are authorized and gives the key material file. Never search the machine for keys.

## 2. Ingest

```bash
forensix ingest "<source>" --case "<new-case-dir>" [--source-kind <kind>] [--include-tier-2] --json
```

- The Case directory must not exist and must not be inside the Source.
- `--include-tier-2` also copies Tier 2 paths (for example the cache). It makes the Case larger. Use it when the user wants cache evidence.
- `CASE_ALREADY_EXISTS`: do not delete the directory. Ask the user for a new path.

Done when ingest exits 0 and prints the Evidence Set Digest and Working Copy Digest. Give both digests to the user.

## 3. Analyse

```bash
forensix analyse --case "<case>" --timezone "<zone>" [--origin-os <os>] \
  [--decrypt --key-material "<file>" [--recipient-key "<pem>"]] --json
```

`analyse` can run for minutes on a large Profile. It prints nothing until it ends. Do not stop it.

| Exit code | exitState | What to do                                                                                     |
| --------- | --------- | ---------------------------------------------------------------------------------------------- |
| 0         | complete  | Continue.                                                                                      |
| 2         | partial   | Continue. Some artifacts are unavailable; report them from `completeness`.                     |
| 3         | failed    | Stop. Report to the user.                                                                      |
| 1         | error     | Read the error code. On `WORKING_COPY_INTEGRITY_REFUSAL`, stop and report the listed `issues`. |

A second `analyse` on the same Case is allowed. It records a new Analysis Run, and the newest successful result per artifact becomes the active result.

Done when analyse exits 0 or 2. Then load `forensix skill get investigate`.
