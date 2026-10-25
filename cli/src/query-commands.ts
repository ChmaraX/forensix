import {
  ForensixError,
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
  requiredCasePath,
  type ParsedArguments,
} from "./args.js";

/**
 * Declarative command table for the cloned artifact list commands. Each of the
 * history, cookies, metadata, bookmarks, credentials, top-sites,
 * topic-candidates, favicons, cache, autofill, candidates, and downloads
 * commands is the same shape: validate the allowed options, reject positionals,
 * map parsed options onto a core read query, then emit its JSON. The runner in
 * the CLI entry point owns that shared shape; the specs below own only the
 * per-surface allowed options, filters, and sort union. Because each spec feeds
 * the query function's own input type, the sort/direction unions are inferred
 * and the previous `as XSort | undefined` coercions are gone.
 */

const COMMIT_STATES = [
  "committed",
  "wal_resident",
  "journal_resident",
] as const;
const DIRECTIONS = ["asc", "desc"] as const;
/** Commands whose core query takes a list of kinds. */
const LIST_FILTER_REPEATS: ReadonlySet<string> = new Set([
  "--profile",
  "--kind",
]);

function requiredOption(parsed: ParsedArguments, option: string): string {
  const value = optionValue(parsed, option);
  if (value === undefined) {
    throw new ForensixError(
      "INVALID_ARGUMENT",
      `Option ${option} is required.`,
      {
        option,
      },
    );
  }
  return value;
}

/**
 * Fields every artifact list query shares. The command table below spreads this
 * and adds only the per-surface filters, sort union, and query function, so the
 * option parsing, positional check, and JSON emission live in one runner. The
 * sort/direction unions flow straight from each query function's input type, so
 * the previous `as XSort | undefined` coercions are gone.
 */
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
    caseDirectory: requiredCasePath(parsed),
    profiles: optionValues(parsed, "--profile"),
    search: optionValue(parsed, "--search"),
    ...pagingInput(parsed, paging),
  };
}

/**
 * A page request the output layer can override: `--max-output` reruns a query
 * with a smaller limit, and `--page-all` follows `nextCursor`. An unset key
 * falls back to the parsed `--limit` / `--after`.
 */
export interface Paging {
  readonly limit?: number;
  readonly after?: string;
}

function pagingInput(
  parsed: ParsedArguments,
  paging: Paging,
): { readonly limit: number | undefined; readonly after: string | undefined } {
  return {
    limit: paging.limit ?? integerOption(parsed, "--limit"),
    after: paging.after ?? optionValue(parsed, "--after"),
  };
}

/**
 * What a command prints:
 * - `records`: Findings or Candidates in `items` (or one in `item`); the
 *   output layer applies redaction, trust, boundaries, fields, and supporting
 *   rows to them;
 * - `data`: aggregate rows or counts (no record fields).
 */
export type QueryOutput = "records" | "data";

export interface QueryCommandSpec {
  readonly allowedOptions: ReadonlySet<string>;
  /** Options this command lets repeat (default: --profile). */
  readonly repeatableOptions?: ReadonlySet<string>;
  readonly output: QueryOutput;
  /** The result pages with limit / nextCursor. */
  readonly paged: boolean;
  /** For record commands: the default of --supporting-rows. */
  readonly supportingRowsDefault?: number | "all";
  /**
   * For `data` commands that print strings copied from the Source (a count
   * bucket key, a site host): the list and the key that hold them. The output
   * layer marks them untrusted and wraps them for --content-boundaries.
   */
  readonly evidence?: { readonly list: string; readonly key: string };
  readonly execute: (parsed: ParsedArguments, paging: Paging) => unknown;
}

/**
 * Declarative table of the artifact list commands. Each spec owns its exact
 * allowed-option set (so INVALID_ARGUMENT wording stays identical) and builds
 * its query input; {@link run} shares the positional check, execution, and JSON
 * emission for every entry.
 */
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
      repeatableOptions: LIST_FILTER_REPEATS,
      output: "records",
      paged: true,
      execute: (parsed, paging) =>
        queryTimeline({
          caseDirectory: requiredCasePath(parsed),
          from: optionValue(parsed, "--from"),
          to: optionValue(parsed, "--to"),
          profiles: optionValues(parsed, "--profile"),
          kinds: optionValues(parsed, "--kind"),
          search: optionValue(parsed, "--search"),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          caseDirectory: requiredCasePath(parsed),
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
      repeatableOptions: LIST_FILTER_REPEATS,
      output: "records",
      paged: true,
      execute: (parsed, paging) => {
        const host = requiredOption(parsed, "--host");
        return querySiteFindings({
          caseDirectory: requiredCasePath(parsed),
          host,
          kinds: optionValues(parsed, "--kind"),
          profiles: optionValues(parsed, "--profile"),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          ...pagingInput(parsed, paging),
        });
      },
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
          caseDirectory: requiredCasePath(parsed),
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
          caseDirectory: requiredCasePath(parsed),
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
      // --limit is the bucket count, not a page: --max-output never lowers it.
      paged: false,
      execute: (parsed) =>
        queryCount({
          caseDirectory: requiredCasePath(parsed),
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
        querySummary({ caseDirectory: requiredCasePath(parsed) }),
    },
  ],
  [
    "completeness",
    {
      allowedOptions: new Set(["--case", "--json"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        queryCompleteness({ caseDirectory: requiredCasePath(parsed) }),
    },
  ],
  [
    "profiles",
    {
      allowedOptions: new Set(["--case", "--json"]),
      output: "data",
      paged: false,
      execute: (parsed) =>
        queryProfiles({ caseDirectory: requiredCasePath(parsed) }),
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
          view: enumOption(parsed, "--view", [
            "visits",
            "activity",
            "most-visited",
            "durations",
          ] as const),
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          transition: optionValue(parsed, "--transition"),
          from: optionValue(parsed, "--from"),
          to: optionValue(parsed, "--to"),
          sort: enumOption(parsed, "--sort", [
            "visit-time",
            "local-time",
            "url",
            "duration",
            "visit-count",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "host",
            "name",
            "creation-time",
            "expires-time",
            "last-access-time",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          type: enumOption(parsed, "--type", [
            "browser_metadata",
            "profile_metadata",
          ] as const),
          sort: enumOption(parsed, "--sort", ["type", "profile"] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          source: enumOption(parsed, "--source", [
            "primary",
            "backup",
          ] as const),
          sort: enumOption(parsed, "--sort", [
            "name",
            "url",
            "date-added",
            "folder",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "created-time",
            "last-used-time",
            "origin",
            "username",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "rank",
            "url",
            "title",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
        "--commit-state",
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
          commitState: enumOption(parsed, "--commit-state", COMMIT_STATES),
          label: optionValue(parsed, "--label"),
          sort: enumOption(parsed, "--sort", [
            "rank",
            "supporting",
            "label",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "icon-url",
            "page-url",
            "last-updated",
            "width",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          recordType: enumOption(parsed, "--record-type", [
            "finding",
            "candidate",
          ] as const),
          backend: optionValue(parsed, "--backend"),
          sort: enumOption(parsed, "--sort", [
            "key",
            "last-used",
            "size",
            "entry-hash",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "created-time",
            "last-used-time",
            "field-name",
            "value",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          category: enumOption(parsed, "--category", [
            "identity",
            "behavior",
          ] as const),
          kind: optionValue(parsed, "--kind"),
          sort: enumOption(parsed, "--sort", [
            "rank",
            "kind",
            "supporting-count",
            "value",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
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
          sort: enumOption(parsed, "--sort", [
            "start-time",
            "end-time",
            "target-path",
            "state",
            "total-bytes",
            "profile",
          ] as const),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
        }),
    },
  ],
]);
