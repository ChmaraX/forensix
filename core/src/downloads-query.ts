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

export type DownloadSort =
  | "start-time"
  | "end-time"
  | "target-path"
  | "state"
  | "total-bytes"
  | "profile";
export type DownloadDirection = "asc" | "desc";

export interface DownloadQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly state?: string;
  readonly dangerType?: string;
  readonly sort?: DownloadSort;
  readonly direction?: DownloadDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface DownloadPage {
  readonly status: "ok";
  readonly command: "downloads";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const DOWNLOAD_SORTS = [
  "start-time",
  "end-time",
  "target-path",
  "state",
  "total-bytes",
  "profile",
] as const;
const DOWNLOAD_DIRECTIONS = ["asc", "desc"] as const;
const DOWNLOAD_KIND = "download";

const SORTS: Readonly<Record<DownloadSort, SortDefinition>> = {
  "start-time": { expression: "COALESCE(f.sort_start, '')", kind: "text" },
  "end-time": { expression: "COALESCE(f.sort_end, '')", kind: "text" },
  "target-path": { expression: "COALESCE(f.sort_target, '')", kind: "text" },
  state: { expression: "COALESCE(f.sort_state, '')", kind: "text" },
  "total-bytes": { expression: "COALESCE(f.sort_bytes, -1)", kind: "integer" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const DOWNLOAD_SPEC: FindingQuerySpec<DownloadQuery, Finding> = {
  label: "Downloads",
  analysisNotFound: "Case has no Downloads analysis. Run analyse first.",
  schemaTable: "downloads_findings",
  mainTable: "downloads_findings",
  resultsTable: "downloads_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Downloads Finding JSON.",
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
      DOWNLOAD_DIRECTIONS,
      "--direction",
      "Downloads",
    );
    const sort = validateEnum(
      input.sort,
      "start-time",
      DOWNLOAD_SORTS,
      "--sort",
      "Downloads",
    );
    const commitState = resolveCommitState(input.commitState, "Downloads");
    const limit = normalizeLimit(input.limit, "Downloads");
    const profiles = resolveProfiles(input.profiles, "Downloads");
    const search = resolveSearch(input.search);
    const state = input.state?.toLocaleLowerCase("en-US") ?? null;
    const dangerType = input.dangerType?.toLocaleLowerCase("en-US") ?? null;

    const where = createConditions();
    where.add("f.finding_kind = ?", DOWNLOAD_KIND);
    where.add("f.record_type = 'finding'");
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    if (state !== null) {
      where.add("f.sort_state = ?", state);
    }
    if (dangerType !== null) {
      where.add("f.danger_type = ?", dangerType);
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
        state,
        dangerType,
        sort,
        direction,
      }),
    };
  },
};

export function queryDownloads(input: DownloadQuery): DownloadPage {
  const { items, nextCursor, limit } = runFindingQuery(DOWNLOAD_SPEC, input);
  return { status: "ok", command: "downloads", items, nextCursor, limit };
}
