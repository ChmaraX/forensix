import {
  assertCommitState,
  createConditions,
  decodeRecordJson,
  normalizeLimit,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  validateEnum,
  type EngineRow,
  type FindingQuerySpec,
  type SortDefinition,
} from "./finding-query.js";
import {
  createCandidate,
  createFinding,
  type Candidate,
  type Finding,
} from "./forensic-model.js";

export type CacheDirection = "asc" | "desc";
export type CacheRecordType = "finding" | "candidate";
export type CacheSort = "key" | "last-used" | "size" | "entry-hash" | "profile";

export interface CacheQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly recordType?: CacheRecordType;
  readonly backend?: string;
  readonly sort?: CacheSort;
  readonly direction?: CacheDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CachePage {
  readonly status: "ok";
  readonly command: "cache";
  readonly recordType: CacheRecordType;
  readonly items: readonly (Finding | Candidate)[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const CACHE_DIRECTIONS = ["asc", "desc"] as const;
const CACHE_RECORD_TYPES = ["finding", "candidate"] as const;
const FINDING_SORTS = [
  "key",
  "last-used",
  "size",
  "entry-hash",
  "profile",
] as const;
const CANDIDATE_SORTS = ["key", "last-used", "profile"] as const;
const CACHE_FINDING_KIND = "cache_entry";

const FINDING_SORT_SQL: Readonly<Record<string, SortDefinition>> = {
  key: { expression: "COALESCE(f.sort_key, '')", kind: "text" },
  "last-used": { expression: "COALESCE(f.sort_last_used, '')", kind: "text" },
  size: { expression: "COALESCE(f.sort_size, -1)", kind: "integer" },
  "entry-hash": { expression: "f.sort_entry_hash", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const CANDIDATE_SORT_SQL: Readonly<Record<string, SortDefinition>> = {
  key: { expression: "COALESCE(f.sort_key, '')", kind: "text" },
  "last-used": { expression: "COALESCE(f.sort_last_used, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

/**
 * Everything that differs between a Finding query and a Candidate query, keyed
 * by record type and resolved once. Findings and Candidates share the cache
 * tables' shape but diverge in table, id column, kind filter, sortable columns,
 * and how a row is rehydrated — collecting that here keeps the shared engine a
 * single code path instead of a cluster of parallel ternaries.
 */
interface RecordTypeConfig {
  readonly mainTable: string;
  readonly idColumn: string;
  readonly kindFilter: {
    readonly column: string;
    readonly value: string;
  } | null;
  readonly sorts: readonly string[];
  readonly defaultSort: string;
  readonly sortSql: Readonly<Record<string, SortDefinition>>;
  readonly selectColumns: string;
  readonly parse: (row: EngineRow) => Finding | Candidate;
}

const CACHE_INVALID_JSON = "Case contains invalid Cache record JSON.";

const RECORD_TYPE_CONFIG: Readonly<Record<CacheRecordType, RecordTypeConfig>> =
  {
    finding: {
      mainTable: "cache_findings",
      idColumn: "finding_id",
      kindFilter: { column: "finding_kind", value: CACHE_FINDING_KIND },
      sorts: FINDING_SORTS,
      defaultSort: "key",
      sortSql: FINDING_SORT_SQL,
      selectColumns: "f.profile_path, f.finding_kind, f.commit_state",
      parse: (row) => {
        const { provenance, fields } = decodeRecordJson(
          row,
          CACHE_INVALID_JSON,
          "row_id",
        );
        const commitState = assertCommitState(
          row.commit_state,
          "row_id",
          row.entity_id.toString(),
        );
        return createFinding({
          findingKind: row.finding_kind as string,
          profile: row.profile_path as string,
          commitState,
          provenance,
          fields,
        });
      },
    },
    candidate: {
      mainTable: "cache_candidates",
      idColumn: "candidate_id",
      kindFilter: null,
      sorts: CANDIDATE_SORTS,
      defaultSort: "last-used",
      sortSql: CANDIDATE_SORT_SQL,
      selectColumns:
        "f.profile_path, f.candidate_kind, f.rank, f.supporting_count",
      parse: (row) => {
        const { provenance, fields } = decodeRecordJson(
          row,
          CACHE_INVALID_JSON,
          "row_id",
        );
        return createCandidate({
          candidateKind: row.candidate_kind as string,
          rank: Number(row.rank),
          count: Number(row.supporting_count),
          provenance,
          fields,
        });
      },
    },
  };

function createCacheSpec(
  recordType: CacheRecordType,
): FindingQuerySpec<CacheQuery, Finding | Candidate> {
  const config = RECORD_TYPE_CONFIG[recordType];
  return {
    label: "Cache",
    analysisNotFound: "Case has no Cache analysis. Run analyse first.",
    schemaTable: "cache_findings",
    mainTable: config.mainTable,
    resultsTable: "cache_artifact_results",
    idColumn: config.idColumn,
    cursorIdField: "rowId",
    selectColumns: config.selectColumns,
    parse: config.parse,
    plan: (input) => {
      const direction = validateEnum(
        input.direction,
        "asc",
        CACHE_DIRECTIONS,
        "--direction",
        "Cache",
      );
      const sort = validateEnum(
        input.sort,
        config.defaultSort,
        config.sorts,
        "--sort",
        "Cache",
      );
      const limit = normalizeLimit(input.limit, "Cache");
      const profiles = resolveProfiles(input.profiles, "Cache");
      const search = resolveSearch(input.search);
      const backend = input.backend ?? null;

      const where = createConditions();
      where.add("f.record_type = ?", recordType);
      if (config.kindFilter !== null) {
        where.add(`f.${config.kindFilter.column} = ?`, config.kindFilter.value);
      }
      if (backend !== null) {
        where.add("f.backend = ?", backend);
      }
      where.addProfiles(profiles);
      where.addSearch(search);

      return {
        sort,
        direction,
        limit,
        sortDefinition: config.sortSql[sort] as SortDefinition,
        conditions: where.conditions,
        parameters: where.parameters,
        fingerprint: (identity) => ({
          caseId: identity.caseId,
          activeArtifactResultIds: identity.artifactResultIds,
          recordType,
          profiles,
          search,
          backend,
          sort,
          direction,
        }),
      };
    },
  };
}

export function queryCache(input: CacheQuery): CachePage {
  const recordType = validateEnum(
    input.recordType,
    "finding",
    CACHE_RECORD_TYPES,
    "--record-type",
    "Cache",
  );
  const { items, nextCursor, limit } = runFindingQuery(
    createCacheSpec(recordType),
    input,
  );
  return {
    status: "ok",
    command: "cache",
    recordType,
    items,
    nextCursor,
    limit,
  };
}
