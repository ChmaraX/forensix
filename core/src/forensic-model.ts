const findingBrand: unique symbol = Symbol("forensix.finding");
const candidateBrand: unique symbol = Symbol("forensix.candidate");

export type FieldUnavailableReason =
  | "missing_column"
  | "null_value"
  | "related_row_missing"
  | "epoch_requires_declared_origin_os"
  | "timestamp_out_of_range"
  | "unsupported_value"
  | "encrypted_secret_without_key_material"
  // Typed reasons for an opted-in offline OSCrypt decryption attempt. They keep
  // unsupported schemes, absent key material, wrong credentials, malformed
  // stores, missing context, and authentication failures distinguishable.
  | "unsupported_app_bound_v20"
  | "unsupported_encryption_route"
  | "no_authorized_key_material"
  | "decryption_wrong_key"
  | "decryption_malformed_ciphertext"
  | "decryption_missing_context"
  | "decryption_authentication_failed"
  // A Cookies store at schema version 24 or later binds each decrypted value
  // to SHA-256(host_key). A missing or wrong binding is never stripped by guess.
  | "cookie_host_key_hash_mismatch"
  | "cookie_host_key_hash_unverifiable"
  // The Simple Cache real index could not be used, so index-only fields of a
  // cache entry (last used time, entry size) cannot be read.
  | SimpleIndexFailureReason;

export type SimpleIndexFailureReason =
  | "simple_index_absent"
  | "simple_index_not_in_working_copy"
  | "simple_index_truncated"
  | "simple_index_bad_header"
  | "simple_index_bad_magic"
  | "simple_index_crc_mismatch"
  | "simple_index_entry_count_overflow"
  | "simple_index_malformed_entries";

export interface ValueField<T> {
  readonly state: "value";
  readonly value: T;
  readonly synthetic?: boolean;
}

export interface AbsentField {
  readonly state: "absent";
}

export interface UnavailableField {
  readonly state: "unavailable";
  readonly reason: FieldUnavailableReason;
}

export type FieldState<T> = ValueField<T> | AbsentField | UnavailableField;
export type ForensicFields = Readonly<Record<string, FieldState<unknown>>>;

export interface SourceRowProvenance {
  readonly manifestEntryId: string;
  readonly sourceId: string;
  readonly manifestEntryOrdinal: number;
  readonly manifestPath: string;
  readonly database: string;
  readonly table: string;
  readonly rowId: string;
}

/**
 * One Manifest entry, without a row. It names a file, not a row image in it.
 */
export interface ManifestEntryReference {
  readonly manifestEntryId: string;
  readonly sourceId: string;
  readonly manifestEntryOrdinal: number;
  readonly manifestPath: string;
}

export interface Provenance extends SourceRowProvenance {
  readonly supportingRows?: readonly SourceRowProvenance[];
  /**
   * Only on a `journal_resident` row. The row image is in the un-rolled-back
   * main database, so the row cites the main database. This entry is the hot
   * rollback journal that shows that the row was not committed. The journal
   * holds the original pages, not this row image, so it is not a source row.
   */
  readonly recoveredVia?: ManifestEntryReference;
}

export type CommitState = "committed" | "wal_resident" | "journal_resident";

export interface Finding<
  Kind extends string = string,
  Fields extends ForensicFields = ForensicFields,
> {
  readonly recordType: "finding";
  readonly findingKind: Kind;
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: Provenance;
  readonly fields: Fields;
  readonly [findingBrand]: true;
}

export type CandidateCategory = "identity" | "behavior";

export interface Candidate<
  Kind extends string = string,
  Fields extends ForensicFields = ForensicFields,
> {
  readonly recordType: "candidate";
  readonly candidateKind: Kind;
  readonly rank: number;
  readonly count: number;
  readonly provenance: Provenance;
  readonly fields: Fields;
  readonly [candidateBrand]: true;
}

export function valueField<T>(
  value: T,
  options: { readonly synthetic?: boolean } = {},
): ValueField<T> {
  return options.synthetic === undefined
    ? { state: "value", value }
    : { state: "value", value, synthetic: options.synthetic };
}

export function absentField(): AbsentField {
  return { state: "absent" };
}

export function unavailableField(
  reason: FieldUnavailableReason,
): UnavailableField {
  return { state: "unavailable", reason };
}

function assertFields(fields: ForensicFields): void {
  for (const [name, field] of Object.entries(fields)) {
    if (field.state === "value") {
      if (!("value" in field)) {
        throw new TypeError(`Finding field ${name} has no value.`);
      }
      continue;
    }
    if (field.state === "absent") {
      if (Object.keys(field).length !== 1) {
        throw new TypeError(`Absent Finding field ${name} has extra data.`);
      }
      continue;
    }
    if (field.state === "unavailable" && field.reason.length > 0) {
      continue;
    }
    throw new TypeError(`Finding field ${name} has no Field State.`);
  }
}

function assertSourceRowProvenance(provenance: SourceRowProvenance): void {
  if (
    provenance.sourceId.length === 0 ||
    provenance.manifestEntryOrdinal < 0 ||
    provenance.manifestPath.length === 0 ||
    provenance.database.length === 0 ||
    provenance.table.length === 0 ||
    provenance.rowId.length === 0 ||
    provenance.manifestEntryId !==
      `${provenance.sourceId}:${provenance.manifestEntryOrdinal}`
  ) {
    throw new TypeError("Finding Provenance is not resolvable.");
  }
}

function assertProvenance(provenance: Provenance): void {
  assertSourceRowProvenance(provenance);
  for (const supportingRow of provenance.supportingRows ?? []) {
    assertSourceRowProvenance(supportingRow);
  }
  const recoveredVia = provenance.recoveredVia;
  if (
    recoveredVia !== undefined &&
    (recoveredVia.sourceId !== provenance.sourceId ||
      recoveredVia.manifestEntryOrdinal < 0 ||
      recoveredVia.manifestEntryOrdinal === provenance.manifestEntryOrdinal ||
      recoveredVia.manifestPath.length === 0 ||
      recoveredVia.manifestEntryId !==
        `${recoveredVia.sourceId}:${recoveredVia.manifestEntryOrdinal}`)
  ) {
    throw new TypeError("Finding recovery Provenance is not resolvable.");
  }
}

export function createFinding<
  Kind extends string,
  Fields extends ForensicFields,
>(input: {
  readonly findingKind: Kind;
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: Provenance;
  readonly fields: Fields;
}): Finding<Kind, Fields> {
  assertProvenance(input.provenance);
  if (
    input.provenance.recoveredVia !== undefined &&
    input.commitState !== "journal_resident"
  ) {
    throw new TypeError(
      "Only a journal_resident Finding cites a recovery Manifest entry.",
    );
  }
  assertFields(input.fields);
  return {
    recordType: "finding",
    ...input,
    [findingBrand]: true,
  };
}

export function createCandidate<
  Kind extends string,
  Fields extends ForensicFields,
>(input: {
  readonly candidateKind: Kind;
  readonly rank: number;
  readonly count: number;
  readonly provenance: Provenance;
  readonly fields: Fields;
}): Candidate<Kind, Fields> {
  if (!Number.isSafeInteger(input.rank) || input.rank < 1) {
    throw new TypeError("Candidate rank must be a positive integer.");
  }
  if (!Number.isSafeInteger(input.count) || input.count < 1) {
    throw new TypeError("Candidate count must be a positive integer.");
  }
  assertProvenance(input.provenance);
  assertFields(input.fields);
  return {
    recordType: "candidate",
    ...input,
    [candidateBrand]: true,
  };
}

export class FindingCollection<
  Row extends Finding = Finding,
> implements Iterable<Row> {
  readonly #rows: Row[] = [];

  public add(row: Row): void {
    this.#rows.push(row);
  }

  public get size(): number {
    return this.#rows.length;
  }

  public [Symbol.iterator](): Iterator<Row> {
    return this.#rows[Symbol.iterator]();
  }
}
