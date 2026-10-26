import {
  createConditions,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  type FindingQuerySpec,
  type QueryDirection,
  type SortDefinition,
} from "./finding-query.js";
import { decodeFinding, type Identified } from "./record-store.js";
import type { CommitState, Finding } from "./forensic-model.js";

export interface AutofillQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: AutofillSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface AutofillPage {
  readonly status: "ok";
  readonly command: "autofill";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const AUTOFILL_SORTS = [
  "created-time",
  "last-used-time",
  "field-name",
  "value",
  "profile",
] as const;
export type AutofillSort = (typeof AUTOFILL_SORTS)[number];
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
  store: "web-data",
  analysisNotFound: "Case has no Web Data analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "desc";
    const sort =
      parseOption(input.sort, "--sort", AUTOFILL_SORTS) ?? "created-time";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Autofill");
    const profiles = resolveProfiles(input.profiles, "Autofill");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", AUTOFILL_KIND);
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
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
