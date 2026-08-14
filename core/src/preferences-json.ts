import { lstat } from "node:fs/promises";

import { WorkingCopyIntegrityRefusal } from "./errors.js";
import { readStableRegularFile } from "./stable-file.js";

/**
 * A Working Copy JSON file (Chrome `Preferences` or `Local State`) pinned to the
 * exact Manifest representation recorded at ingest. The reader re-verifies the
 * bytes against this identity before it parses anything, so analysis never
 * trusts content that drifted from the recorded evidence.
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
