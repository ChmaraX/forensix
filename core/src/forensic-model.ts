const findingBrand: unique symbol = Symbol("forensix.finding");
const candidateBrand: unique symbol = Symbol("forensix.candidate");

export type FieldUnavailableReason =
  | "missing_column"
  | "null_value"
  | "related_row_missing"
  | "epoch_requires_declared_origin_os"
  | "timestamp_out_of_range"
  | "unsupported_value";

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

export interface Provenance extends SourceRowProvenance {
  readonly supportingRows?: readonly SourceRowProvenance[];
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
