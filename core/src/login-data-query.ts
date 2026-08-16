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

export type CredentialSort =
  | "created-time"
  | "last-used-time"
  | "origin"
  | "username"
  | "profile";
export type CredentialDirection = "asc" | "desc";

export interface CredentialQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: CredentialSort;
  readonly direction?: CredentialDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CredentialPage {
  readonly status: "ok";
  readonly command: "credentials";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const CREDENTIAL_SORTS = [
  "created-time",
  "last-used-time",
  "origin",
  "username",
  "profile",
] as const;
const CREDENTIAL_DIRECTIONS = ["asc", "desc"] as const;
const CREDENTIAL_KIND = "login_credential";

const SORTS: Readonly<Record<CredentialSort, SortDefinition>> = {
  "created-time": { expression: "COALESCE(f.sort_created, '')", kind: "text" },
  "last-used-time": {
    expression: "COALESCE(f.sort_last_used, '')",
    kind: "text",
  },
  origin: { expression: "COALESCE(f.sort_origin, '')", kind: "text" },
  username: { expression: "COALESCE(f.sort_username, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const CREDENTIAL_SPEC: FindingQuerySpec<CredentialQuery, Finding> = {
  label: "Credential",
  analysisNotFound: "Case has no Login Data analysis. Run analyse first.",
  schemaTable: "login_data_findings",
  mainTable: "login_data_findings",
  resultsTable: "login_data_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Finding JSON.",
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
      "desc",
      CREDENTIAL_DIRECTIONS,
      "--direction",
      "Credential",
    );
    const sort = validateEnum(
      input.sort,
      "created-time",
      CREDENTIAL_SORTS,
      "--sort",
      "Credential",
    );
    const commitState = resolveCommitState(input.commitState, "Credential");
    const limit = normalizeLimit(input.limit, "Credential");
    const profiles = resolveProfiles(input.profiles, "Credential");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", CREDENTIAL_KIND);
    where.add("f.record_type = 'finding'");
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
        sort,
        direction,
      }),
    };
  },
};

export function queryCredentials(input: CredentialQuery): CredentialPage {
  const { items, nextCursor, limit } = runFindingQuery(CREDENTIAL_SPEC, input);
  return { status: "ok", command: "credentials", items, nextCursor, limit };
}
