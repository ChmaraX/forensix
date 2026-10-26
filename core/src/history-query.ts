import {
  createConditions,
  normalizeInstant,
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
import { ForensixError } from "./errors.js";
import type { CommitState, Finding } from "./forensic-model.js";
import { decodeFinding, type Identified } from "./record-store.js";

/**
 * Read-only query surface for History Findings: visits and the three summary
 * views. It is one {@link FindingQuerySpec} over the shared keyset engine
 * (`runFindingQuery`); only the view, its kind, its sorts, and the visit-only
 * time and transition filters are specific to History.
 */

export const HISTORY_VIEWS = [
  "visits",
  "activity",
  "most-visited",
  "durations",
] as const;
export type HistoryView = (typeof HISTORY_VIEWS)[number];
export const HISTORY_SORTS = [
  "visit-time",
  "local-time",
  "url",
  "duration",
  "visit-count",
  "profile",
] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

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
  readonly direction?: QueryDirection;
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

const HISTORY_SPEC: FindingQuerySpec<HistoryQuery, Finding> = {
  label: LABEL,
  store: "history",
  analysisNotFound: "Case has no History analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const view = parseOption(input.view, "--view", HISTORY_VIEWS) ?? "visits";
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "desc";
    const sort =
      parseOption(input.sort, "--sort", HISTORY_SORTS) ?? DEFAULT_SORT[view];
    if (!VIEW_SORTS[view].includes(sort)) {
      throw new ForensixError(
        "INVALID_ARGUMENT",
        `History sort ${sort} is not available for ${view}.`,
        { view, sort, allowed: VIEW_SORTS[view] },
      );
    }
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, LABEL);
    const profiles = resolveProfiles(input.profiles, LABEL);
    const search = resolveSearch(input.search);
    const transition = input.transition?.toLocaleLowerCase("en-US") ?? null;
    const from = normalizeInstant(input.from, "--from", LABEL);
    const to = normalizeInstant(input.to, "--to", LABEL);
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
