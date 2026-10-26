import {
  AUTOFILL_SORTS,
  BOOKMARK_SORTS,
  BOOKMARK_SOURCES,
  CACHE_RECORD_TYPES,
  CACHE_SORTS,
  CANDIDATE_CATEGORIES,
  CANDIDATE_SORTS,
  COMMIT_STATES,
  COOKIE_SORTS,
  CREDENTIAL_SORTS,
  DOWNLOAD_SORTS,
  FAVICON_SORTS,
  HISTORY_SORTS,
  HISTORY_VIEWS,
  METADATA_SORTS,
  METADATA_TYPES,
  QUERY_DIRECTIONS,
  TOP_SITE_SORTS,
  TOPIC_CANDIDATE_SORTS,
  getRecord,
  queryAutofill,
  queryBookmarks,
  queryCache,
  queryCandidates,
  queryCompleteness,
  queryCookies,
  queryCount,
  queryCredentials,
  queryDownloads,
  queryFavicons,
  queryHistory,
  queryMetadata,
  queryProfiles,
  querySchema,
  querySiteFindings,
  querySiteHosts,
  querySummary,
  queryTimeline,
  queryTopicCandidates,
  queryTopSites,
} from "@forensix/core";

import {
  enumOption,
  hasOption,
  integerOption,
  optionValue,
  optionValues,
  requiredOption,
  type ParsedArguments,
} from "./args.js";

/**
 * Declarative table of the query commands. Each entry names its allowed
 * options and maps the parsed options onto one core read query. The CLI entry
 * point checks the options and positionals, runs the query, and the output
 * layer prints it. The allowed values of each enumerated option come from
 * core, so the CLI and the server refuse a bad value with the same error.
 */

/** The options every artifact list query shares. */
function baseListInput(
  parsed: ParsedArguments,
  paging: Paging,
): {
  readonly caseDirectory: string;
  readonly profiles: readonly string[];
  readonly search: string | undefined;
  readonly limit: number | undefined;
  readonly after: string | undefined;
} {
  return {
    caseDirectory: requiredOption(parsed, "--case"),
    profiles: optionValues(parsed, "--profile"),
    search: optionValue(parsed, "--search"),
    ...pagingInput(parsed, paging),
  };
}

/**
 * The page to read: with `--page-all` the output layer sets `after` to the
 * `nextCursor` of the previous page; else the parsed `--after` applies.
 */
export interface Paging {
  readonly after?: string;
}

function pagingInput(
  parsed: ParsedArguments,
  paging: Paging,
): { readonly limit: number | undefined; readonly after: string | undefined } {
  return {
    limit: integerOption(parsed, "--limit"),
    after: paging.after ?? optionValue(parsed, "--after"),
  };
}

/**
 * What a command prints:
 * - `records`: Findings or Candidates in `items` (or one in `item`); the
 *   output layer applies redaction, trust, fields, and supporting
 *   rows to them;
 * - `data`: aggregate rows or counts (no record fields).
 */
export type QueryOutput = "records" | "data";

export interface QueryCommandSpec {
  readonly allowedOptions: ReadonlySet<string>;
  readonly output: QueryOutput;
  /** The result pages with limit / nextCursor. */
  readonly paged: boolean;
  /** For record commands: the default of --supporting-rows. */
  readonly supportingRowsDefault?: number | "all";
  /**
   * For `data` commands that print strings copied from the Source (a count
   * bucket key, a site host): the list and the key that hold them. The output
   * layer marks them untrusted.
   */
  readonly evidence?: { readonly list: string; readonly key: string };
  readonly execute: (parsed: ParsedArguments, paging: Paging) => unknown;
}

export const QUERY_COMMANDS: ReadonlyMap<string, QueryCommandSpec> = new Map([
  [
    "timeline",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--from",
        "--to",
        "--profile",
        "--kind",
        "--search",
        "--commit-state",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryTimeline({
          caseDirectory: requiredOption(parsed, "--case"),
          from: optionValue(parsed, "--from"),
          to: optionValue(parsed, "--to"),
          profiles: optionValues(parsed, "--profile"),
          kinds: optionValues(parsed, "--kind"),
          search: optionValue(parsed, "--search"),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
          ...pagingInput(parsed, paging),
        }),
    },
  ],
  [
    "site-hosts",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--search",
        "--limit",
        "--after",
      ]),
      output: "data",
      evidence: { list: "items", key: "host" },
      paged: true,
      execute: (parsed, paging) =>
        querySiteHosts({
          caseDirectory: requiredOption(parsed, "--case"),
          search: optionValue(parsed, "--search"),
          ...pagingInput(parsed, paging),
        }),
    },
  ],
  [
    "site-findings",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--host",
        "--kind",
        "--profile",
        "--commit-state",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        querySiteFindings({
          caseDirectory: requiredOption(parsed, "--case"),
          host: requiredOption(parsed, "--host"),
          kinds: optionValues(parsed, "--kind"),
          profiles: optionValues(parsed, "--profile"),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          ...pagingInput(parsed, paging),
        }),
    },
  ],
  [
    "get",
    {
      allowedOptions: new Set(["--case", "--json", "--id"]),
      output: "records",
      paged: false,
      // One record on request: its whole Provenance unless asked otherwise.
      supportingRowsDefault: "all",
      execute: (parsed) =>
        getRecord({
          caseDirectory: requiredOption(parsed, "--case"),
          id: requiredOption(parsed, "--id"),
        }),
    },
  ],
  [
    "schema",
    {
      allowedOptions: new Set(["--case", "--json", "--kind"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        querySchema({
          caseDirectory: requiredOption(parsed, "--case"),
          kind: optionValue(parsed, "--kind"),
        }),
    },
  ],
  [
    "count",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--kind",
        "--by",
        "--profile",
        "--commit-state",
        "--search",
        "--limit",
        "--include-secrets",
      ]),
      output: "data",
      evidence: { list: "buckets", key: "key" },
      // --limit is the bucket count, not a page.
      paged: false,
      execute: (parsed) =>
        queryCount({
          caseDirectory: requiredOption(parsed, "--case"),
          kind: requiredOption(parsed, "--kind"),
          by: requiredOption(parsed, "--by"),
          profiles: optionValues(parsed, "--profile"),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          search: optionValue(parsed, "--search"),
          limit: integerOption(parsed, "--limit"),
          redactSecrets: !hasOption(parsed, "--include-secrets"),
        }),
    },
  ],
  [
    "summary",
    {
      allowedOptions: new Set(["--case", "--json"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        querySummary({ caseDirectory: requiredOption(parsed, "--case") }),
    },
  ],
  [
    "completeness",
    {
      allowedOptions: new Set(["--case", "--json"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        queryCompleteness({ caseDirectory: requiredOption(parsed, "--case") }),
    },
  ],
  [
    "profiles",
    {
      allowedOptions: new Set(["--case", "--json"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        queryProfiles({ caseDirectory: requiredOption(parsed, "--case") }),
    },
  ],
  [
    "history",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--view",
        "--profile",
        "--search",
        "--commit-state",
        "--transition",
        "--from",
        "--to",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryHistory({
          ...baseListInput(parsed, paging),
          view: enumOption(parsed, "--view", HISTORY_VIEWS),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          transition: optionValue(parsed, "--transition"),
          from: optionValue(parsed, "--from"),
          to: optionValue(parsed, "--to"),
          sort: enumOption(parsed, "--sort", HISTORY_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "cookies",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--host",
        "--same-site",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryCookies({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          host: optionValue(parsed, "--host"),
          sameSite: optionValue(parsed, "--same-site"),
          sort: enumOption(parsed, "--sort", COOKIE_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "metadata",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--type",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryMetadata({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          type: enumOption(parsed, "--type", METADATA_TYPES),
          sort: enumOption(parsed, "--sort", METADATA_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "bookmarks",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--source",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryBookmarks({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          source: enumOption(parsed, "--source", BOOKMARK_SOURCES),
          sort: enumOption(parsed, "--sort", BOOKMARK_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "credentials",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryCredentials({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          sort: enumOption(parsed, "--sort", CREDENTIAL_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "top-sites",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryTopSites({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          sort: enumOption(parsed, "--sort", TOP_SITE_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "topic-candidates",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--label",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryTopicCandidates({
          ...baseListInput(parsed, paging),
          label: optionValue(parsed, "--label"),
          sort: enumOption(parsed, "--sort", TOPIC_CANDIDATE_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "favicons",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryFavicons({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          sort: enumOption(parsed, "--sort", FAVICON_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "cache",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--record-type",
        "--backend",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryCache({
          ...baseListInput(parsed, paging),
          recordType: enumOption(parsed, "--record-type", CACHE_RECORD_TYPES),
          backend: optionValue(parsed, "--backend"),
          sort: enumOption(parsed, "--sort", CACHE_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "autofill",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryAutofill({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          sort: enumOption(parsed, "--sort", AUTOFILL_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "candidates",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--category",
        "--kind",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryCandidates({
          ...baseListInput(parsed, paging),
          category: enumOption(parsed, "--category", CANDIDATE_CATEGORIES),
          kind: optionValue(parsed, "--kind"),
          sort: enumOption(parsed, "--sort", CANDIDATE_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
  [
    "downloads",
    {
      allowedOptions: new Set([
        "--case",
        "--json",
        "--profile",
        "--search",
        "--commit-state",
        "--state",
        "--danger",
        "--sort",
        "--direction",
        "--limit",
        "--after",
      ]),
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryDownloads({
          ...baseListInput(parsed, paging),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          state: optionValue(parsed, "--state"),
          dangerType: optionValue(parsed, "--danger"),
          sort: enumOption(parsed, "--sort", DOWNLOAD_SORTS),
          direction: enumOption(parsed, "--direction", QUERY_DIRECTIONS),
        }),
    },
  ],
]);
