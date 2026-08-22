import {
  ForensixError,
  queryAutofill,
  queryBookmarks,
  queryCache,
  queryCandidates,
  queryCompleteness,
  queryCookies,
  queryCredentials,
  queryDownloads,
  queryFavicons,
  queryHistory,
  queryMetadata,
  queryProfiles,
  querySiteFindings,
  querySiteHosts,
  queryTimeline,
  queryTopicCandidates,
  queryTopSites,
} from "@forensix/core";

import {
  enumOption,
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

/**
 * Fields every artifact list query shares. The command table below spreads this
 * and adds only the per-surface filters, sort union, and query function, so the
 * option parsing, positional check, and JSON emission live in one runner. The
 * sort/direction unions flow straight from each query function's input type, so
 * the previous `as XSort | undefined` coercions are gone.
 */
function baseListInput(parsed: ParsedArguments): {
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
    limit: integerOption(parsed, "--limit"),
    after: optionValue(parsed, "--after"),
  };
}

export interface QueryCommandSpec {
  readonly allowedOptions: ReadonlySet<string>;
  readonly execute: (parsed: ParsedArguments) => unknown;
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
        "--direction",
        "--limit",
        "--after",
      ]),
      execute: (parsed) =>
        queryTimeline({
          caseDirectory: requiredCasePath(parsed),
          from: optionValue(parsed, "--from"),
          to: optionValue(parsed, "--to"),
          direction: enumOption(parsed, "--direction", DIRECTIONS),
          limit: integerOption(parsed, "--limit"),
          after: optionValue(parsed, "--after"),
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
      execute: (parsed) =>
        querySiteHosts({
          caseDirectory: requiredCasePath(parsed),
          search: optionValue(parsed, "--search"),
          limit: integerOption(parsed, "--limit"),
          after: optionValue(parsed, "--after"),
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
        "--limit",
        "--after",
      ]),
      execute: (parsed) => {
        const host = optionValue(parsed, "--host");
        if (host === undefined) {
          throw new ForensixError(
            "INVALID_ARGUMENT",
            "Option --host is required.",
          );
        }
        return querySiteFindings({
          caseDirectory: requiredCasePath(parsed),
          host,
          limit: integerOption(parsed, "--limit"),
          after: optionValue(parsed, "--after"),
        });
      },
    },
  ],
  [
    "completeness",
    {
      allowedOptions: new Set(["--case", "--json"]),
      execute: (parsed) =>
        queryCompleteness({ caseDirectory: requiredCasePath(parsed) }),
    },
  ],
  [
    "profiles",
    {
      allowedOptions: new Set(["--case", "--json"]),
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
      execute: (parsed) =>
        queryHistory({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryCookies({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryMetadata({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryBookmarks({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryCredentials({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryTopSites({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryTopicCandidates({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryFavicons({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryCache({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryAutofill({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryCandidates({
          ...baseListInput(parsed),
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
      execute: (parsed) =>
        queryDownloads({
          ...baseListInput(parsed),
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
