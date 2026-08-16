import {
  assertCommitState,
  createConditions,
  decodeRecordJson,
  normalizeLimit,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  validateEnum,
  type EngineRow,
  type FindingQuerySpec,
  type SortDefinition,
} from "./finding-query.js";
import {
  createFinding,
  type CommitState,
  type Finding,
} from "./forensic-model.js";

export type MetadataDirection = "asc" | "desc";
export type MetadataSort = "type" | "profile";
export type MetadataType = "browser_metadata" | "profile_metadata";

export interface MetadataQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly type?: MetadataType;
  readonly sort?: MetadataSort;
  readonly direction?: MetadataDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface MetadataPage {
  readonly status: "ok";
  readonly command: "metadata";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const METADATA_DIRECTIONS = ["asc", "desc"] as const;
const METADATA_SORTS = ["type", "profile"] as const;
const METADATA_TYPES = ["browser_metadata", "profile_metadata"] as const;

const SORTS: Readonly<Record<MetadataSort, SortDefinition>> = {
  type: { expression: "f.sort_type", kind: "text" },
  profile: { expression: "f.sort_profile", kind: "text" },
};

const METADATA_SPEC: FindingQuerySpec<MetadataQuery, Finding> = {
  label: "Metadata",
  analysisNotFound: "Case has no Metadata analysis. Run analyse first.",
  schemaTable: "preferences_findings",
  mainTable: "preferences_findings",
  resultsTable: "preferences_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Metadata Finding JSON.",
      "finding_id",
    );
    const commitState = assertCommitState(
      row.commit_state,
      "finding_id",
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
  plan: (input) => {
    const direction = validateEnum(
      input.direction,
      "asc",
      METADATA_DIRECTIONS,
      "--direction",
      "Metadata",
    );
    const sort = validateEnum(
      input.sort,
      "profile",
      METADATA_SORTS,
      "--sort",
      "Metadata",
    );
    const commitState = resolveCommitState(input.commitState, "Metadata");
    const type =
      input.type === undefined
        ? null
        : validateEnum(
            input.type,
            "browser_metadata",
            METADATA_TYPES,
            "--type",
            "Metadata",
          );
    const limit = normalizeLimit(input.limit, "Metadata");
    const profiles = resolveProfiles(input.profiles, "Metadata");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.record_type = 'finding'");
    if (type !== null) {
      where.add("f.finding_kind = ?", type);
    }
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
      sort,
      direction,
      limit,
      sortDefinition: SORTS[sort],
      conditions: where.conditions,
      parameters: where.parameters,
      fingerprint: (identity) => ({
        caseId: identity.caseId,
        activeArtifactResultIds: identity.artifactResultIds,
        profiles,
        search,
        commitState,
        type,
        sort,
        direction,
      }),
    };
  },
};

export function queryMetadata(input: MetadataQuery): MetadataPage {
  const { items, nextCursor, limit } = runFindingQuery(METADATA_SPEC, input);
  return { status: "ok", command: "metadata", items, nextCursor, limit };
}
