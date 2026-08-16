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

export type AutofillSort =
  | "created-time"
  | "last-used-time"
  | "field-name"
  | "value"
  | "profile";
export type AutofillDirection = "asc" | "desc";

export interface AutofillQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: AutofillSort;
  readonly direction?: AutofillDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface AutofillPage {
  readonly status: "ok";
  readonly command: "autofill";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const AUTOFILL_SORTS = [
  "created-time",
  "last-used-time",
  "field-name",
  "value",
  "profile",
] as const;
const AUTOFILL_DIRECTIONS = ["asc", "desc"] as const;
const AUTOFILL_KIND = "autofill_entry";

const SORTS: Readonly<Record<AutofillSort, SortDefinition>> = {
  "created-time": { expression: "COALESCE(f.sort_created, '')", kind: "text" },
  "last-used-time": {
    expression: "COALESCE(f.sort_last_used, '')",
    kind: "text",
  },
  "field-name": { expression: "COALESCE(f.sort_name, '')", kind: "text" },
  value: { expression: "COALESCE(f.sort_value, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const AUTOFILL_SPEC: FindingQuerySpec<AutofillQuery, Finding> = {
  label: "Autofill",
  analysisNotFound: "Case has no Web Data analysis. Run analyse first.",
  schemaTable: "web_data_findings",
  mainTable: "web_data_findings",
  resultsTable: "web_data_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Web Data Finding JSON.",
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
      AUTOFILL_DIRECTIONS,
      "--direction",
      "Autofill",
    );
    const sort = validateEnum(
      input.sort,
      "created-time",
      AUTOFILL_SORTS,
      "--sort",
      "Autofill",
    );
    const commitState = resolveCommitState(input.commitState, "Autofill");
    const limit = normalizeLimit(input.limit, "Autofill");
    const profiles = resolveProfiles(input.profiles, "Autofill");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", AUTOFILL_KIND);
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

export function queryAutofill(input: AutofillQuery): AutofillPage {
  const { items, nextCursor, limit } = runFindingQuery(AUTOFILL_SPEC, input);
  return { status: "ok", command: "autofill", items, nextCursor, limit };
}
