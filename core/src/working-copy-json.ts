import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { CaseSourceRecord } from "./case.js";
import { WorkingCopyIntegrityRefusal } from "./errors.js";
import { readStableRegularFile } from "./stable-file.js";

/**
 * A Working Copy JSON file (any Chrome JSON artifact, e.g. `Preferences`,
 * `Local State`, or `Bookmarks`/`Bookmarks.bak`) pinned to the exact Manifest
 * representation recorded at ingest. The reader re-verifies the bytes against
 * this identity before it parses anything, so analysis never trusts content
 * that drifted from the recorded evidence.
 */
export interface VerifiedJsonFile {
  readonly path: string;
  readonly manifestPath: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * The outcome of reading a verified JSON file. A byte-stable, hash-matching file
 * that still fails to parse is `unreadable` with a typed reason rather than an
 * integrity refusal: the evidence is intact, the content is simply malformed.
 */
export type JsonReadResult =
  | { readonly status: "parsed"; readonly value: unknown }
  | { readonly status: "unreadable"; readonly reason: string };

/**
 * Read a verified JSON Working Copy file into memory and parse it. Any drift
 * from the recorded Manifest representation (missing file, non-regular file,
 * unstable read, size or hash mismatch) is a Working Copy integrity refusal and
 * aborts the analysis. A malformed document or an oversized file is reported as
 * `unreadable` so the caller can record a typed `unavailable` reason.
 */
export async function readVerifiedJsonFile(
  file: VerifiedJsonFile,
): Promise<JsonReadResult> {
  let stats;
  try {
    stats = await lstat(file.path, { bigint: true });
  } catch {
    throw new WorkingCopyIntegrityRefusal([
      { path: file.manifestPath, reason: "entry_missing" },
    ]);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new WorkingCopyIntegrityRefusal([
      { path: file.manifestPath, reason: "entry_not_regular_file" },
    ]);
  }

  const chunks: Buffer[] = [];
  const result = await readStableRegularFile(
    file.path,
    stats,
    async (chunk) => {
      chunks.push(Buffer.from(chunk));
    },
  );
  if (result.status === "too_large") {
    return { status: "unreadable", reason: "file_too_large" };
  }
  if (result.status !== "stable") {
    throw new WorkingCopyIntegrityRefusal([
      { path: file.manifestPath, reason: "entry_unreadable" },
    ]);
  }
  const issues = [];
  if (result.size !== file.size) {
    issues.push({
      path: file.manifestPath,
      reason: "entry_size_mismatch" as const,
      expected: file.size,
      actual: result.size,
    });
  }
  if (result.sha256 !== file.sha256) {
    issues.push({
      path: file.manifestPath,
      reason: "entry_hash_mismatch" as const,
      expected: file.sha256,
      actual: result.sha256,
    });
  }
  if (issues.length > 0) {
    throw new WorkingCopyIntegrityRefusal(issues);
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { status: "unreadable", reason: "malformed_json" };
  }
  return { status: "parsed", value };
}

/**
 * Where a named Working Copy JSON file stands relative to the Manifest, before
 * any bytes are read. `ready` carries the verified-file identity; `absent` and
 * `unavailable` carry a typed reason (prefixed with the caller's `label`) so a
 * removed-or-missing file stays distinct from a present-but-unusable one.
 */
export type FileResolution =
  | {
      readonly kind: "ready";
      readonly file: VerifiedJsonFile;
      readonly ordinal: number;
    }
  | {
      readonly kind: "absent" | "unavailable";
      readonly reason: string;
      readonly ordinal: number | null;
    };

/**
 * Resolve a Manifest-declared JSON file within a Source's Working Copy. A file
 * absent from the Manifest or recorded as absent is `absent`; a file that is
 * unavailable, uncopied, or missing its size/hash representation is a typed
 * `unavailable`. Only a `ready` result is safe to pass to `readVerifiedJsonFile`.
 */
export function resolveJsonFile(
  source: CaseSourceRecord,
  workingCopyPath: string,
  path: string,
  label: string,
): FileResolution {
  const ordinal = source.entries.findIndex((entry) => entry.path === path);
  if (ordinal < 0) {
    return {
      kind: "absent",
      reason: `${label}_manifest_entry_missing`,
      ordinal: null,
    };
  }
  const entry = source.entries[ordinal];
  if (entry === undefined) {
    return {
      kind: "absent",
      reason: `${label}_manifest_entry_missing`,
      ordinal: null,
    };
  }
  if (entry.state === "absent") {
    return { kind: "absent", reason: `${label}_absent`, ordinal };
  }
  if (entry.state === "unavailable") {
    return {
      kind: "unavailable",
      reason: `${label}_unavailable:${entry.unavailable_reason ?? "unknown"}`,
      ordinal,
    };
  }
  if (!entry.copied) {
    return {
      kind: "unavailable",
      reason: `${label}_not_in_working_copy`,
      ordinal,
    };
  }
  if (entry.size === null || entry.sha256 === null) {
    return {
      kind: "unavailable",
      reason: `${label}_manifest_representation_incomplete`,
      ordinal,
    };
  }
  return {
    kind: "ready",
    ordinal,
    file: {
      path: join(workingCopyPath, ...path.split("/")),
      manifestPath: path,
      size: entry.size,
      sha256: entry.sha256,
    },
  };
}
