import {
  createConditions,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  type FindingQuerySpec,
  type QueryDirection,
  type SortDefinition,
} from "./finding-query.js";
import {
  decodeCandidate,
  decodeFinding,
  type Identified,
} from "./record-store.js";
import type { Candidate, Finding } from "./forensic-model.js";

export const CACHE_RECORD_TYPES = ["finding", "candidate"] as const;
export type CacheRecordType = (typeof CACHE_RECORD_TYPES)[number];
/** Every Cache sort; a Candidate list takes only `key`, `last-used`, `profile`. */
export const CACHE_SORTS = [
  "key",
  "last-used",
  "size",
  "entry-hash",
  "profile",
] as const;
export type CacheSort = (typeof CACHE_SORTS)[number];

export interface CacheQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly recordType?: CacheRecordType;
  readonly backend?: string;
  readonly sort?: CacheSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CachePage {
  readonly status: "ok";
  readonly command: "cache";
  readonly recordType: CacheRecordType;
  readonly items: readonly Identified<Finding | Candidate>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const CANDIDATE_SORTS = [
  "key",
  "last-used",
  "profile",
] as const satisfies readonly CacheSort[];
const CACHE_FINDING_KIND = "cache_entry";

const SORT_SQL: Readonly<Record<CacheSort, SortDefinition>> = {
  key: { expression: "COALESCE(f.sort_key, '')", kind: "text" },
  "last-used": { expression: "COALESCE(f.sort_last_used, '')", kind: "text" },
  size: { expression: "COALESCE(f.sort_size, -1)", kind: "integer" },
  "entry-hash": { expression: "f.sort_entry_hash", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

/**
 * Everything that differs between a Finding query and a Candidate query, keyed
 * by record type: the store, the kind filter, and the sortable columns.
 */
interface RecordTypeConfig {
  readonly store: "cache" | "cache-candidates";
  readonly kindFilter: string | null;
  readonly sorts: readonly CacheSort[];
  readonly defaultSort: CacheSort;
  readonly decode: FindingQuerySpec<CacheQuery, Finding | Candidate>["decode"];
}

const RECORD_TYPE_CONFIG: Readonly<Record<CacheRecordType, RecordTypeConfig>> =
  {
    finding: {
      store: "cache",
      kindFilter: CACHE_FINDING_KIND,
      sorts: CACHE_SORTS,
      defaultSort: "key",
      decode: decodeFinding,
    },
    candidate: {
      store: "cache-candidates",
      kindFilter: null,
      sorts: CANDIDATE_SORTS,
      defaultSort: "last-used",
      decode: decodeCandidate,
    },
  };

function createCacheSpec(
  recordType: CacheRecordType,
): FindingQuerySpec<CacheQuery, Finding | Candidate> {
  const config = RECORD_TYPE_CONFIG[recordType];
  return {
    label: "Cache",
    store: config.store,
    analysisNotFound: "Case has no Cache analysis. Run analyse first.",
    schemaTable: "cache_findings",
    decode: config.decode,
    plan: (input) => {
      const direction =
        parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "asc";
      const sort =
        parseOption(input.sort, "--sort", config.sorts) ?? config.defaultSort;
      const limit = normalizeLimit(input.limit, "Cache");
      const profiles = resolveProfiles(input.profiles, "Cache");
      const search = resolveSearch(input.search);
      const backend = input.backend ?? null;

      const where = createConditions();
      if (config.kindFilter !== null) {
        where.add("f.finding_kind = ?", config.kindFilter);
      }
      if (backend !== null) {
        where.add("f.backend = ?", backend);
      }
      where.addProfiles(profiles);
      where.addSearch(search);

      return {
        direction,
        limit,
        sortDefinition: SORT_SQL[sort],
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
  const recordType =
    parseOption(input.recordType, "--record-type", CACHE_RECORD_TYPES) ??
    "finding";
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
