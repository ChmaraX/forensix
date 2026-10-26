import { createHash } from "node:crypto";

import { ForensixError } from "./errors.js";
import { canonicalJson, type RedactedField } from "./export.js";
import type { FieldState, SourceRowProvenance } from "./forensic-model.js";
import { SECRET_FIELDS_BY_KIND } from "./secret-fields.js";

/**
 * Pure record transforms for agent-facing output: secret redaction and the
 * supporting-row limit. Neither reads the Case and neither changes the
 * Extract (`exportCase`) redaction rules.
 */

/** The marker hash of a withheld value (the same hash the Extract uses). */
export function secretValueSha256(value: unknown): string {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

interface RecordWithFields {
  readonly findingKind?: string;
  readonly candidateKind?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export type RedactedRecord<T extends RecordWithFields> = Omit<T, "fields"> & {
  readonly fields: Readonly<
    Record<string, FieldState<unknown> | RedactedField>
  >;
};

/**
 * Replaces each plaintext secret Field State (state `value`) of the record's
 * kind with `{ state: "redacted", reason: "plaintext_secret_withheld",
 * sha256 }`. Other Field States, including an `unavailable` secret, stay as
 * they are. The input is not changed.
 */
export function redactSecrets<T extends RecordWithFields>(
  item: T,
): { readonly item: RedactedRecord<T>; readonly redactedCount: number } {
  const kind = item.findingKind ?? item.candidateKind;
  const secretFields = kind === undefined ? [] : SECRET_FIELDS_BY_KIND[kind];
  if (secretFields === undefined || secretFields.length === 0) {
    return { item: item as RedactedRecord<T>, redactedCount: 0 };
  }
  let redactedCount = 0;
  const fields: Record<string, FieldState<unknown> | RedactedField> = {};
  for (const [name, state] of Object.entries(item.fields) as [
    string,
    FieldState<unknown>,
  ][]) {
    if (
      secretFields.includes(name) &&
      typeof state === "object" &&
      state !== null &&
      state.state === "value"
    ) {
      fields[name] = {
        state: "redacted",
        reason: "plaintext_secret_withheld",
        sha256: secretValueSha256(state.value),
      };
      redactedCount += 1;
    } else {
      fields[name] = state;
    }
  }
  if (redactedCount === 0) {
    return { item: item as RedactedRecord<T>, redactedCount: 0 };
  }
  return { item: { ...item, fields }, redactedCount };
}

interface ProvenanceNode extends SourceRowProvenance {
  readonly supportingRows?: readonly ProvenanceNode[];
  readonly supportingRowCount?: number;
  readonly supportingRowsTruncated?: true;
}

function limitNode<T extends ProvenanceNode>(node: T, max: number): T {
  const rows = node.supportingRows;
  if (rows === undefined) {
    return node;
  }
  const kept = rows.slice(0, max).map((row) => limitNode(row, max));
  const cut = rows.length > max;
  const changed = cut || kept.some((row, index) => row !== rows[index]);
  if (!changed) {
    return node;
  }
  return cut
    ? {
        ...node,
        supportingRows: kept,
        supportingRowCount: rows.length,
        supportingRowsTruncated: true,
      }
    : { ...node, supportingRows: kept };
}

/**
 * Keeps the first `max` `provenance.supportingRows`, and applies the same
 * limit to the supporting rows nested in each kept row. Where it cuts rows it
 * adds `supportingRowCount` (the original total) and
 * `supportingRowsTruncated: true` beside that list. A record with no cut is
 * returned unchanged. `max` is a non-negative integer.
 */
export function limitSupportingRows<
  T extends { readonly provenance: SourceRowProvenance },
>(item: T, max: number): T {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Supporting row limit must be a non-negative integer.",
      { max },
    );
  }
  const provenance = limitNode(item.provenance as ProvenanceNode, max);
  return provenance === item.provenance ? item : { ...item, provenance };
}
