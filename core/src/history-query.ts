import {
  assertCommitState,
  decodeRecordJson,
  createConditions,
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
import { ForensixError } from "./errors.js";
import {
  createFinding,
  type CommitState,
  type Finding,
} from "./forensic-model.js";
import type { Identified } from "./record-store.js";

/**
 * Read-only query surface for History Findings: visits and the three summary
 * views. It is one {@link FindingQuerySpec} over the shared keyset engine
 * (`runFindingQuery`); only the view, its kind, its sorts, and the visit-only
 * time and transition filters are specific to History.
 */

export type HistoryView = "visits" | "activity" | "most-visited" | "durations";
export type HistoryDirection = "asc" | "desc";
export type HistorySort =
  | "visit-time"
  | "local-time"
  | "url"
  | "duration"
  | "visit-count"
  | "profile";

export interface HistoryQuery {
  readonly caseDirectory: string;
  readonly view?: HistoryView;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly transition?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: HistorySort;
  readonly direction?: HistoryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface HistoryPage {
  readonly status: "ok";
  readonly command: "history";
  readonly view: HistoryView;
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

const LABEL = "History";
const HISTORY_VIEWS = [
  "visits",
  "activity",
  "most-visited",
  "durations",
] as const;
const HISTORY_DIRECTIONS = ["asc", "desc"] as const;
const VIEW_KINDS: Readonly<Record<HistoryView, string>> = {
  visits: "history_visit",
  activity: "history_activity_summary",
  "most-visited": "history_most_visited_summary",
  durations: "history_duration_summary",
};

const SORTS: Readonly<Record<HistorySort, SortDefinition>> = {
  "visit-time": { expression: "COALESCE(f.sort_time, '')", kind: "text" },
  "local-time": { expression: "COALESCE(f.sort_time, '')", kind: "text" },
  url: { expression: "COALESCE(f.sort_url, '')", kind: "text" },
  duration: { expression: "COALESCE(f.sort_duration, -1)", kind: "integer" },
  "visit-count": {
    expression: "COALESCE(f.sort_count, -1)",
    kind: "integer",
  },
  profile: { expression: "f.profile_path", kind: "text" },
};

const VIEW_SORTS: Readonly<Record<HistoryView, readonly HistorySort[]>> = {
  visits: ["visit-time", "url", "duration", "profile"],
  activity: ["local-time", "visit-count", "duration", "profile"],
  "most-visited": ["visit-count", "url", "profile"],
  durations: ["duration", "visit-count", "url", "profile"],
};

const DEFAULT_SORT: Readonly<Record<HistoryView, HistorySort>> = {
  visits: "visit-time",
  activity: "local-time",
  "most-visited": "visit-count",
  durations: "duration",
};

function normalizeInstant(
  value: string | undefined,
  option: string,
): string | null {
  if (value === undefined) {
    return null;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  const date = new Date(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const hour = Number(match?.[4]);
  const minute = Number(match?.[5]);
  const second = Number(match?.[6]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    match === null ||
    Number.isNaN(date.getTime()) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `History ${option} must be an ISO 8601 instant with an offset.`,
      { value },
    );
  }
  const fraction = (match[7] ?? "").padEnd(6, "0");
  const milliseconds = date.toISOString();
  return `${milliseconds.slice(0, -5)}.${milliseconds.slice(-4, -1)}${fraction.slice(3)}Z`;
}

const HISTORY_SPEC: FindingQuerySpec<HistoryQuery, Finding> = {
  label: LABEL,
  store: "history",
  analysisNotFound: "Case has no History analysis. Run analyse first.",
  schemaTable: "forensic_findings",
  mainTable: "forensic_findings",
  resultsTable: "history_artifact_results",
  idColumn: "finding_id",
  cursorIdField: "findingId",
  selectColumns: "f.finding_kind, f.profile_path, f.commit_state",
  parse: (row: EngineRow): Finding => {
    const { provenance, fields } = decodeRecordJson(
      row,
      "Case contains invalid Finding JSON.",
      "findingId",
    );
    return createFinding({
      findingKind: row.finding_kind as string,
      profile: row.profile_path as string,
      commitState: assertCommitState(
        row.commit_state,
        "findingId",
        row.entity_id.toString(),
      ),
      provenance,
      fields,
    });
  },
  plan: (input) => {
    const view = validateEnum(
      input.view,
      "visits",
      HISTORY_VIEWS,
      "--view",
      LABEL,
    );
    const direction = validateEnum(
      input.direction,
      "desc",
      HISTORY_DIRECTIONS,
      "--direction",
      LABEL,
    );
    const sort = input.sort ?? DEFAULT_SORT[view];
    if (!(sort in SORTS) || !VIEW_SORTS[view].includes(sort)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `History sort ${sort} is not available for ${view}.`,
        { view, sort, allowed: VIEW_SORTS[view] },
      );
    }
    const commitState = resolveCommitState(input.commitState, LABEL);
    const limit = normalizeLimit(input.limit, LABEL);
    const profiles = resolveProfiles(input.profiles, LABEL);
    const search = resolveSearch(input.search);
    const transition = input.transition?.toLocaleLowerCase("en-US") ?? null;
    const from = normalizeInstant(input.from, "--from");
    const to = normalizeInstant(input.to, "--to");
    if (view !== "visits" && (from !== null || to !== null)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "History time bounds apply only to the visits view.",
        { view },
      );
    }
    if (view !== "visits" && transition !== null) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "History transition filters apply only to the visits view.",
        { view },
      );
    }
    if (from !== null && to !== null && from > to) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        "History --from must not be later than --to.",
      );
    }

    const where = createConditions();
    where.add("f.finding_kind = ?", VIEW_KINDS[view]);
    where.add("f.record_type = 'finding'");
    where.addProfiles(profiles);
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    where.addSearch(search);
    if (transition !== null) {
      where.add("f.transition_core = ?", transition);
    }
    if (from !== null) {
      where.add("f.sort_time >= ?", from);
    }
    if (to !== null) {
      where.add("f.sort_time <= ?", to);
    }

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
        view,
        profiles,
        search,
        commitState,
        transition,
        from,
        to,
        sort,
        direction,
      }),
    };
  },
};

export function queryHistory(input: HistoryQuery): HistoryPage {
  const { items, nextCursor, limit } = runFindingQuery(HISTORY_SPEC, input);
  const view = input.view ?? "visits";
  return {
    status: "ok",
    command: "history",
    view,
    items,
    nextCursor,
    limit,
  };
}
