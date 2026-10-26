import type { DatabaseSync } from "node:sqlite";

import { ForensixError } from "./errors.js";
import {
  createCandidate,
  createFinding,
  type Candidate,
  type CommitState,
  type Finding,
  type ForensicFields,
  type Provenance,
} from "./forensic-model.js";
import { tableExists } from "./sqlite-artifact.js";

/**
 * The fixed storage map behind every record id.
 *
 * Every Finding and Candidate a list query returns carries an `id` of the
 * form `<store>:<rowid>`. `<store>` is a short fixed key for one Case storage
 * table and `<rowid>` is that table's integer primary key, so an id is stable
 * inside one Case: a rerun of analyse adds new rows and keeps the old ones,
 * it never renumbers them.
 */

export type RecordStoreKey =
  | "history"
  | "topic-candidates"
  | "identity-candidates"
  | "cookies"
  | "logins"
  | "web-data"
  | "downloads"
  | "top-sites"
  | "favicons"
  | "preferences"
  | "bookmarks"
  | "cache"
  | "cache-candidates";

/** How a stored row turns back into the record a list query returns. */
export type RecordShape = "finding" | "candidate" | "identity-candidate";

export interface RecordStore {
  readonly key: RecordStoreKey;
  readonly recordType: "finding" | "candidate";
  readonly shape: RecordShape;
  readonly table: string;
  readonly resultsTable: string;
  readonly idColumn: "finding_id" | "candidate_id";
  readonly kindColumn: "finding_kind" | "candidate_kind";
  /** Every kind the analyzer writes to this table. */
  readonly kinds: readonly string[];
}

export const RECORD_STORES: readonly RecordStore[] = [
  {
    key: "history",
    recordType: "finding",
    shape: "finding",
    table: "forensic_findings",
    resultsTable: "history_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: [
      "history_visit",
      "history_activity_summary",
      "history_most_visited_summary",
      "history_duration_summary",
    ],
  },
  {
    key: "topic-candidates",
    recordType: "candidate",
    shape: "candidate",
    table: "forensic_candidates",
    resultsTable: "history_artifact_results",
    idColumn: "candidate_id",
    kindColumn: "candidate_kind",
    kinds: ["topic"],
  },
  {
    key: "identity-candidates",
    recordType: "candidate",
    shape: "identity-candidate",
    table: "identity_candidates",
    resultsTable: "candidate_artifact_results",
    idColumn: "candidate_id",
    kindColumn: "candidate_kind",
    kinds: [
      "identity_name",
      "identity_email",
      "identity_phone",
      "identity_postal_address",
      "identity_country",
      "behavior_frequent_host",
      "behavior_search_query",
    ],
  },
  {
    key: "cookies",
    recordType: "finding",
    shape: "finding",
    table: "cookie_findings",
    resultsTable: "cookie_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["cookie"],
  },
  {
    key: "logins",
    recordType: "finding",
    shape: "finding",
    table: "login_data_findings",
    resultsTable: "login_data_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["login_credential"],
  },
  {
    key: "web-data",
    recordType: "finding",
    shape: "finding",
    table: "web_data_findings",
    resultsTable: "web_data_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["autofill_entry"],
  },
  {
    key: "downloads",
    recordType: "finding",
    shape: "finding",
    table: "downloads_findings",
    resultsTable: "downloads_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["download"],
  },
  {
    key: "top-sites",
    recordType: "finding",
    shape: "finding",
    table: "top_sites_findings",
    resultsTable: "top_sites_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["top_site"],
  },
  {
    key: "favicons",
    recordType: "finding",
    shape: "finding",
    table: "favicon_findings",
    resultsTable: "favicon_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["favicon"],
  },
  {
    key: "preferences",
    recordType: "finding",
    shape: "finding",
    table: "preferences_findings",
    resultsTable: "preferences_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["browser_metadata", "profile_metadata"],
  },
  {
    key: "bookmarks",
    recordType: "finding",
    shape: "finding",
    table: "bookmarks_findings",
    resultsTable: "bookmarks_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["bookmark"],
  },
  {
    key: "cache",
    recordType: "finding",
    shape: "finding",
    table: "cache_findings",
    resultsTable: "cache_artifact_results",
    idColumn: "finding_id",
    kindColumn: "finding_kind",
    kinds: ["cache_entry"],
  },
  {
    key: "cache-candidates",
    recordType: "candidate",
    shape: "candidate",
    table: "cache_candidates",
    resultsTable: "cache_artifact_results",
    idColumn: "candidate_id",
    kindColumn: "candidate_kind",
    kinds: ["doomed_entry", "evicted_reference", "unreadable_entry"],
  },
];

export const RECORD_STORE_KEYS: readonly RecordStoreKey[] = RECORD_STORES.map(
  (store) => store.key,
);

const STORE_BY_KEY = new Map(RECORD_STORES.map((store) => [store.key, store]));
/** The store behind a store key. */
export function recordStore(key: RecordStoreKey): RecordStore {
  const store = STORE_BY_KEY.get(key);
  if (store === undefined) {
    throw new Error(`Store ${key} is not a record store.`);
  }
  return store;
}

/** A Finding or Candidate with its stable record id as the first key. */
export type Identified<T> = { readonly id: string } & T;

export function recordId(store: RecordStoreKey, rowId: bigint): string {
  return `${store}:${rowId.toString()}`;
}

const INT64_MAX = 9_223_372_036_854_775_807n;

/** Parses `<store>:<rowid>` or throws INVALID_ARGUMENT. */
export function parseRecordId(id: string): {
  readonly store: RecordStore;
  readonly rowId: bigint;
} {
  const match = /^([a-z-]+):([0-9]{1,19})$/.exec(id);
  const store =
    match?.[1] === undefined
      ? undefined
      : STORE_BY_KEY.get(match[1] as RecordStoreKey);
  const rowId = match?.[2] === undefined ? null : BigInt(match[2]);
  if (
    store === undefined ||
    rowId === null ||
    rowId < 1n ||
    rowId > INT64_MAX
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      "Record id must have the form <store>:<rowid>, for example cookies:1.",
      { id, allowed: RECORD_STORE_KEYS },
    );
  }
  return { store, rowId };
}

/** The stores whose table exists in this Case. */
export function presentStores(database: DatabaseSync): readonly RecordStore[] {
  return RECORD_STORES.filter(
    (store) =>
      tableExists(database, store.table) &&
      tableExists(database, store.resultsTable),
  );
}

/** One stored row, read with every column a record is rebuilt from. */
export interface StoredRecordRow {
  readonly row_id: bigint;
  readonly kind: string;
  readonly profile_path: string;
  readonly commit_state: string | null;
  readonly category: string | null;
  readonly rank: bigint | null;
  readonly supporting_count: bigint | null;
  readonly provenance_json: string;
  readonly fields_json: string;
}

/** An identity Candidate as its list query returns it (no Commit State). */
export interface IdentityCandidateRecord {
  readonly recordType: "candidate";
  readonly candidateKind: string;
  readonly category: "identity" | "behavior";
  readonly profile: string;
  readonly rank: number;
  readonly supportingCount: number;
  readonly provenance: Provenance;
  readonly fields: ForensicFields;
}

/** Any stored record, rebuilt with its id. */
export type StoredRecord =
  | Identified<Finding>
  | Identified<Candidate>
  | Identified<IdentityCandidateRecord>;

/** SELECT list (over alias `f`) that reads a {@link StoredRecordRow}. */
export function storedRecordColumns(store: RecordStore): string {
  return [
    `f.${store.idColumn} AS row_id`,
    `f.${store.kindColumn} AS kind`,
    "f.profile_path",
    store.recordType === "finding" ? "f.commit_state" : "NULL AS commit_state",
    store.shape === "identity-candidate" ? "f.category" : "NULL AS category",
    store.recordType === "candidate" ? "f.rank" : "NULL AS rank",
    store.recordType === "candidate"
      ? "f.supporting_count"
      : "NULL AS supporting_count",
    "f.provenance_json",
    "f.fields_json",
  ].join(", ");
}

function invalidRecord(
  message: string,
  id: string,
  cause?: unknown,
): ForensixError {
  return new ForensixError(
    "CASE_INVALID",
    message,
    { id },
    cause === undefined ? undefined : { cause },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SOURCE_ROW_KEYS = [
  "manifestEntryId",
  "sourceId",
  "manifestPath",
  "database",
  "table",
  "rowId",
] as const;

function isSourceRow(value: unknown): value is Record<string, unknown> {
  return (
    isObject(value) &&
    typeof value.manifestEntryOrdinal === "number" &&
    SOURCE_ROW_KEYS.every((key) => typeof value[key] === "string")
  );
}

function isFieldState(value: unknown): boolean {
  if (!isObject(value)) return false;
  switch (value.state) {
    case "value":
      return "value" in value;
    case "absent":
      return true;
    case "unavailable":
      return typeof value.reason === "string";
    default:
      return false;
  }
}

/**
 * The one decoder of a stored row's Provenance and fields JSON. It checks
 * that the Provenance names its source rows and that every field has a known
 * Field State (`value`, `absent`, or `unavailable` with a reason). A bad row
 * is CASE_INVALID, never a cast.
 */
export function decodeRecordJson(
  row: Pick<StoredRecordRow, "provenance_json" | "fields_json">,
  id: string,
): { readonly provenance: Provenance; readonly fields: ForensicFields } {
  let provenance: unknown;
  let fields: unknown;
  try {
    provenance = JSON.parse(row.provenance_json);
    fields = JSON.parse(row.fields_json);
  } catch (error) {
    throw invalidRecord("Case contains invalid record JSON.", id, error);
  }
  if (
    !isSourceRow(provenance) ||
    (provenance.supportingRows !== undefined &&
      !(
        Array.isArray(provenance.supportingRows) &&
        provenance.supportingRows.every(isSourceRow)
      )) ||
    (provenance.recoveredVia !== undefined &&
      !isObject(provenance.recoveredVia))
  ) {
    throw invalidRecord("Case contains invalid record Provenance.", id);
  }
  if (!isObject(fields) || !Object.values(fields).every(isFieldState)) {
    throw invalidRecord(
      "Case contains a field with an invalid Field State.",
      id,
    );
  }
  return {
    provenance: provenance as unknown as Provenance,
    fields: fields as ForensicFields,
  };
}

/** A stored Commit State, or CASE_INVALID. */
export function assertCommitState(
  value: string | null,
  id: string,
): CommitState {
  if (
    value !== "committed" &&
    value !== "wal_resident" &&
    value !== "journal_resident"
  ) {
    throw invalidRecord("Case contains an invalid Commit State.", id);
  }
  return value;
}

/** Runs a model constructor; its TypeError on a bad row is CASE_INVALID. */
function rebuild<T>(id: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw invalidRecord("Case contains an invalid record.", id, error);
  }
}

export function decodeFinding(
  store: RecordStore,
  row: StoredRecordRow,
): Identified<Finding> {
  const id = recordId(store.key, row.row_id);
  const { provenance, fields } = decodeRecordJson(row, id);
  const commitState = assertCommitState(row.commit_state, id);
  return {
    id,
    ...rebuild(id, () =>
      createFinding({
        findingKind: row.kind,
        profile: row.profile_path,
        commitState,
        provenance,
        fields,
      }),
    ),
  };
}

export function decodeCandidate(
  store: RecordStore,
  row: StoredRecordRow,
): Identified<Candidate> {
  const id = recordId(store.key, row.row_id);
  const { provenance, fields } = decodeRecordJson(row, id);
  return {
    id,
    ...rebuild(id, () =>
      createCandidate({
        candidateKind: row.kind,
        rank: Number(row.rank),
        count: Number(row.supporting_count),
        provenance,
        fields,
      }),
    ),
  };
}

export function decodeIdentityCandidate(
  store: RecordStore,
  row: StoredRecordRow,
): Identified<IdentityCandidateRecord> {
  // The Candidate decoder checks rank, count, Provenance and fields.
  const { id, candidateKind, rank, count, provenance, fields } =
    decodeCandidate(store, row);
  if (row.category !== "identity" && row.category !== "behavior") {
    throw invalidRecord("Case contains an invalid Candidate category.", id);
  }
  return {
    id,
    recordType: "candidate",
    candidateKind,
    category: row.category,
    profile: row.profile_path,
    rank,
    supportingCount: count,
    provenance,
    fields,
  };
}

/**
 * Rebuilds the record exactly as that store's list query returns it: a
 * Finding, a Candidate, or an identity Candidate record (no Commit State,
 * with `category`, `profile` and `supportingCount`).
 */
export function decodeStoredRecord(
  store: RecordStore,
  row: StoredRecordRow,
): StoredRecord {
  switch (store.shape) {
    case "finding":
      return decodeFinding(store, row);
    case "candidate":
      return decodeCandidate(store, row);
    case "identity-candidate":
      return decodeIdentityCandidate(store, row);
  }
}
