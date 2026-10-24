/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking, read as a ranking rather than a generic
 * evidence dump. Chrome records one ordered list per Browser Profile
 * (`urlRank` 1..N, its own placement — nothing this page re-ranks), and the
 * page reads that ordering back in a column of FF Panels:
 *
 *  1. Evidence coverage — the Completeness Statement, before any row.
 *  2. A MetricBand of recorded figures — ranked sites, distinct hosts,
 *     Profiles covered, and how many rows were recovered from sidecars rather
 *     than committed.
 *  3. A leaderboard per Profile — Chrome's recorded top placements, as an FF
 *     CardGroup of inline cards (one fluid hover highlight; a card opens its
 *     row detail).
 *  4. A "top of the list" composition read — which registrable domains hold
 *     the highest-ranked slots, and how the ranking splits between committed
 *     and recovered (sidecar) rows.
 *  5. The full ranked table on FF's Table, searchable and Profile-filterable
 *     (TabsSubtle) over the loaded rows.
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * states are worded, never colour alone; ranks are Chrome's recorded `urlRank`
 * values — never scores or bars the evidence does not contain. The bars in
 * the composition read are shares of *counts this page tallied* (how many of
 * the loaded rows fall in a domain / a commit state), labelled as such — never
 * a fabricated ranking of the sites themselves.
 */
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EvidenceDot, type EvidenceState } from "@/components/evidence";
import {
  Panel,
  PanelDescription,
  PanelFooter,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import { COMMIT_META } from "../terms.js";
import type { ArtifactConfig, CommitState, Finding, PageOf } from "../types.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger as fieldRank,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { Coverage } from "./history-coverage.js";
import { ErrorRows, ListFooter } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/** One rank-sorted read across every Commit State, paginated by the route. */
function useTopSites(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    callApi<PageOf<Finding>>(route, [
      ["sort", "rank"],
      ["direction", "asc"],
    ])
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, nonce]);

  const loadMore = useCallback(() => {
    if (cursor === null) {
      return;
    }
    setLoading(true);
    callApi<PageOf<Finding>>(route, [
      ["sort", "rank"],
      ["direction", "asc"],
      ["after", cursor],
    ])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items]);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
  }, [route, cursor]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, cursor, loading, error, loadMore, retry };
}

/**
 * The registrable-ish domain of a host: the last two labels ("mail.google.com"
 * → "google.com"), or the host itself when it has fewer than two dots. This is
 * a display grouping for the composition read, not a PSL-accurate eTLD+1 — it
 * only ever groups rows the page already loaded, never changes a recorded
 * value, and every row keeps its exact host in the table and detail sheet.
 */
function registrableDomain(host: string | null): string | null {
  if (host === null) {
    return null;
  }
  const clean = host.replace(/^www\./, "");
  const labels = clean.split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) {
    return clean;
  }
  return labels.slice(-2).join(".");
}

interface TopSitesStats {
  readonly rankedCount: number;
  readonly hostCount: number;
  readonly profileCount: number;
  readonly recoveredCount: number;
}

/** Distinct-host, per-profile, and commit-state tallies of the loaded rows. */
function summarize(rows: readonly Finding[]): TopSitesStats {
  const hosts = new Set<string>();
  const profiles = new Set<string>();
  let recovered = 0;
  for (const row of rows) {
    const host = hostOf(fieldText(row.fields.url));
    if (host !== null) {
      hosts.add(host.replace(/^www\./, ""));
    }
    profiles.add(row.profile);
    if (row.commitState !== "committed") {
      recovered += 1;
    }
  }
  return {
    rankedCount: rows.length,
    hostCount: hosts.size,
    profileCount: profiles.size,
    recoveredCount: recovered,
  };
}

function StatStrip({ stats }: { readonly stats: TopSitesStats }) {
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Ranked sites"
        value={stats.rankedCount.toLocaleString("en-US")}
        detail="rows loaded so far"
      />
      <MetricBandItem
        label="Distinct hosts"
        value={stats.hostCount.toLocaleString("en-US")}
        detail="unique sites in the list"
      />
      <MetricBandItem
        label="Profiles"
        value={stats.profileCount.toLocaleString("en-US")}
        detail={
          stats.profileCount === 1
            ? "one browser profile"
            : "browser profiles ranked"
        }
      />
      <MetricBandItem
        label="Recovered"
        value={stats.recoveredCount.toLocaleString("en-US")}
        detail={
          stats.recoveredCount === 0
            ? "all rows saved"
            : "rows from WAL / journal"
        }
        tone={stats.recoveredCount === 0 ? "neutral" : "warning"}
      />
    </MetricBand>
  );
}

/** Inline CardTitle trims its line box to cap height and clips; this pads
 *  the clip box (and pulls the layout back) so descenders aren't cut. */
const CARD_TITLE_CLEAR = "whitespace-nowrap [&>span]:-my-1 [&>span]:py-1";

/** How many leaderboard rows each Profile card shows before "and N more". */
const BOARD_LIMIT = 5;

/** The rank slot: Chrome's recorded `urlRank`, or the word "absent". */
function RankSlot({ rank }: { readonly rank: number | null }) {
  const size = useSize();
  return (
    <span
      className={cn(
        size.type.body,
        "min-w-6 shrink-0 text-center text-muted-foreground tabular-nums",
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {rank ?? <AbsentWord />}
    </span>
  );
}

function Leaderboard({
  rows,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
}) {
  const byProfile = useMemo(() => {
    const groups = new Map<string, Finding[]>();
    for (const row of rows) {
      const group = groups.get(row.profile) ?? [];
      group.push(row);
      groups.set(row.profile, group);
    }
    for (const group of groups.values()) {
      group.sort(
        (left, right) =>
          (fieldRank(left.fields.urlRank) ?? Number.MAX_SAFE_INTEGER) -
          (fieldRank(right.fields.urlRank) ?? Number.MAX_SAFE_INTEGER),
      );
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [rows]);

  if (byProfile.length === 0) {
    return null;
  }
  return (
    <div
      className={cn(
        "grid items-start gap-5",
        byProfile.length > 1 && "lg:grid-cols-2",
      )}
    >
      {byProfile.map(([profile, group]) => (
        <Panel
          key={profile}
          role="region"
          aria-label={`Chrome's ranking for ${profile}`}
          className="overflow-clip"
        >
          <PanelHeader className="items-center pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <PanelTitle>Chrome&apos;s ranking</PanelTitle>
              <Badge variant="dot" color="gray" size="compact">
                {profile}
              </Badge>
            </div>
          </PanelHeader>
          <SizeProvider size="compact">
            <CardGroup orientation="inline" className="px-1 pb-1">
              {group.slice(0, BOARD_LIMIT).map((row, index) => {
                const url = fieldText(row.fields.url);
                const host = hostOf(url);
                const title = fieldText(row.fields.title);
                const name = title ?? host ?? url ?? "(untitled)";
                return (
                  <Card
                    key={index}
                    onClick={() => {
                      onSelect(row);
                    }}
                    label={`Open ${name} row detail`}
                    className="min-h-14"
                  >
                    <RankSlot rank={fieldRank(row.fields.urlRank)} />
                    <SiteAvatar host={host} />
                    <CardHeader className="gap-0.5 pr-3">
                      <CardTitle className={CARD_TITLE_CLEAR}>{name}</CardTitle>
                      <CardDescription
                        className={cn(
                          typeClass("caption", "compact"),
                          "truncate font-mono",
                        )}
                      >
                        {host ?? url ?? ""}
                      </CardDescription>
                    </CardHeader>
                    {row.commitState === "committed" ? null : (
                      <CardFooter>
                        <StateWord state={row.commitState} />
                      </CardFooter>
                    )}
                  </Card>
                );
              })}
            </CardGroup>
          </SizeProvider>
          {group.length > BOARD_LIMIT ? (
            <PanelFooter>
              <BoardMore count={group.length - BOARD_LIMIT} />
            </PanelFooter>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}

function BoardMore({ count }: { readonly count: number }) {
  const size = useSize();
  return (
    <p className={cn(size.type.caption, "text-muted-foreground tabular-nums")}>
      and {count.toLocaleString("en-US")} more in the table below
    </p>
  );
}

interface DomainShare {
  readonly domain: string;
  readonly count: number;
  /** The best (lowest) `urlRank` any row in this domain holds, or null when
   *  none of its rows carry a recorded rank. */
  readonly bestRank: number | null;
}

/** How many top-N slots each registrable domain holds and its best placement. */
function domainShares(rows: readonly Finding[], topN: number): DomainShare[] {
  const ranked = rows
    .map((row) => ({
      row,
      rank: fieldRank(row.fields.urlRank),
      domain: registrableDomain(hostOf(fieldText(row.fields.url))),
    }))
    .filter(
      (entry): entry is { row: Finding; rank: number; domain: string } =>
        entry.rank !== null && entry.domain !== null,
    )
    .sort((left, right) => left.rank - right.rank)
    .slice(0, topN);

  const byDomain = new Map<string, { count: number; bestRank: number }>();
  for (const entry of ranked) {
    const existing = byDomain.get(entry.domain);
    if (existing === undefined) {
      byDomain.set(entry.domain, { count: 1, bestRank: entry.rank });
    } else {
      existing.count += 1;
      existing.bestRank = Math.min(existing.bestRank, entry.rank);
    }
  }
  return [...byDomain.entries()]
    .map(([domain, value]) => ({
      domain,
      count: value.count,
      bestRank: value.bestRank,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.bestRank - right.bestRank,
    );
}

/** How many domains the composition read lists before folding the rest into
 *  an "and N more" line, and how many top-ranked rows it considers. */
const DOMAIN_ROWS = 7;
const COMPOSITION_TOP_N = 30;

/**
 * Composition read — two honest tallies of *which* rows sit at the top of
 * Chrome's list, drawn as share bars rather than as re-ranked sites:
 *
 *  - "Domains at the top": of the highest-ranked `COMPOSITION_TOP_N` rows,
 *    how many slots each registrable domain holds. A site that appears under
 *    several subdomains (mail. / drive. / docs.google.com) reads as one
 *    domain here, which is exactly the concentration an examiner is looking
 *    for. Every bar is a count of loaded rows, labelled "N slots".
 *  - "Where the ranking came from": how the loaded rows split between
 *    committed and recovered (WAL / journal) Commit State — a forensically
 *    load-bearing figure, since a ranking rebuilt largely from sidecars is a
 *    different kind of evidence than one read straight from the committed
 *    database.
 *
 * Neither bar invents a score. Both restate counts the page already has, and
 * every state hue keeps its word.
 */
function CompositionCard({ rows }: { readonly rows: readonly Finding[] }) {
  const size = useSize();
  const shares = useMemo(() => domainShares(rows, COMPOSITION_TOP_N), [rows]);
  const shown = shares.slice(0, DOMAIN_ROWS);
  const remainder = shares.slice(DOMAIN_ROWS);
  const remainderCount = remainder.reduce((sum, share) => sum + share.count, 0);
  const peak = Math.max(...shares.map((share) => share.count), 1);
  const consideredCount = Math.min(rows.length, COMPOSITION_TOP_N);

  const commitSplit = useMemo(() => {
    let committed = 0;
    let wal = 0;
    let journal = 0;
    for (const row of rows) {
      if (row.commitState === "committed") {
        committed += 1;
      } else if (row.commitState === "wal_resident") {
        wal += 1;
      } else {
        journal += 1;
      }
    }
    return { committed, wal, journal, total: rows.length };
  }, [rows]);

  return (
    <div className="grid grid-cols-12 items-start gap-5">
      <Panel
        role="region"
        aria-labelledby="top-sites-domains-title"
        className="col-span-12 overflow-clip lg:col-span-7"
      >
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle id="top-sites-domains-title">
              Domains at the top
            </PanelTitle>
            <PanelDescription>
              Of the {consideredCount} highest-ranked rows, how many slots each
              site&apos;s domain holds.
            </PanelDescription>
          </div>
        </PanelHeader>
        {shown.length === 0 ? (
          <EmptyRows message="No ranked rows with a readable host to group." />
        ) : (
          <ol className="flex flex-col px-4 pt-1 pb-3">
            {shown.map((share) => (
              <li
                key={share.domain}
                className="grid min-h-12 grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <SiteAvatar host={share.domain} />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(size.type.body, "truncate text-foreground")}
                    >
                      {share.domain}
                    </span>
                    {share.bestRank !== null ? (
                      <span
                        className={cn(
                          size.type.caption,
                          "truncate text-muted-foreground tabular-nums",
                        )}
                      >
                        best rank #{share.bestRank}
                      </span>
                    ) : null}
                  </span>
                </span>
                <ShareBar fraction={share.count / peak} />
                <span
                  className={cn(
                    size.type.caption,
                    "text-right whitespace-nowrap text-muted-foreground tabular-nums",
                  )}
                >
                  {share.count} slot{share.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
        )}
        {remainderCount > 0 ? (
          <PanelFooter>
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              and {remainder.length} more domain
              {remainder.length === 1 ? "" : "s"} sharing {remainderCount} slot
              {remainderCount === 1 ? "" : "s"}
            </p>
          </PanelFooter>
        ) : null}
      </Panel>

      <Panel
        role="region"
        aria-labelledby="top-sites-split-title"
        className="col-span-12 overflow-clip lg:col-span-5"
      >
        <PanelHeader>
          <div className="min-w-0">
            <PanelTitle id="top-sites-split-title">
              Where the ranking came from
            </PanelTitle>
            <PanelDescription>
              How the loaded rows split between the saved database and recovered
              sidecars.
            </PanelDescription>
          </div>
        </PanelHeader>
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
          {commitSplit.total === 0 ? (
            <p className={cn(size.type.body, "text-muted-foreground")}>
              No rows loaded to split.
            </p>
          ) : (
            <>
              {/* The stacked bar only repeats the legend below, which carries
                  every state's word and count. */}
              <div
                aria-hidden="true"
                className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
              >
                {(
                  [
                    ["committed", commitSplit.committed],
                    ["wal_resident", commitSplit.wal],
                    ["journal_resident", commitSplit.journal],
                  ] as const
                ).map(([state, count]) =>
                  count === 0 ? null : (
                    <span
                      key={state}
                      className={cn("h-full", SPLIT_FILL[state])}
                      style={{ flexGrow: count, flexBasis: 0 }}
                    />
                  ),
                )}
              </div>
              <dl className="flex flex-col">
                <CommitLegendRow
                  state="committed"
                  hint="read from the saved database"
                  count={commitSplit.committed}
                  total={commitSplit.total}
                />
                <CommitLegendRow
                  state="wal_resident"
                  hint="recovered from the write-ahead log"
                  count={commitSplit.wal}
                  total={commitSplit.total}
                />
                <CommitLegendRow
                  state="journal_resident"
                  hint="recovered from the rollback journal"
                  count={commitSplit.journal}
                  total={commitSplit.total}
                />
              </dl>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Commit State fills for the split bar: the evidence hues, never alone. */
const SPLIT_FILL: Readonly<Record<CommitState, string>> = {
  committed: "bg-muted-foreground",
  wal_resident: "bg-wal",
  journal_resident: "bg-violet",
};

/**
 * A share of the busiest entry's count: a full-width pill slid in from the
 * left inside a clipping track (never a scaled or width-animated bar).
 */
function ShareBar({ fraction }: { readonly fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-hover"
    >
      <span
        className="block h-full w-full rounded-full bg-muted-foreground"
        style={{ transform: `translateX(${String((clamped - 1) * 100)}%)` }}
      />
    </span>
  );
}

function CommitLegendRow({
  state,
  hint,
  count,
  total,
}: {
  readonly state: CommitState;
  readonly hint: string;
  readonly count: number;
  readonly total: number;
}) {
  const size = useSize();
  const meta = COMMIT_META[state];
  const dot: EvidenceState = meta.badge;
  const percent = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-border last:border-b-0">
      <EvidenceDot state={dot} />
      <span className="flex min-w-0 flex-1 flex-col">
        <dt className={cn(size.type.body, "text-foreground")}>{meta.label}</dt>
        <span
          className={cn(size.type.caption, "truncate text-muted-foreground")}
        >
          {hint}
        </span>
      </span>
      <dd
        className={cn(
          size.type.body,
          "flex items-baseline gap-2 text-right tabular-nums",
        )}
      >
        <span
          className="text-foreground"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {count.toLocaleString("en-US")}
        </span>
        <span className={cn(size.type.caption, "w-9 text-muted-foreground")}>
          {percent}%
        </span>
      </dd>
    </div>
  );
}

/* --------------------------------- table ---------------------------------- */

const ALL_PROFILES = "All profiles";

function RankedTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
}) {
  const size = useSize();
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            {["Rank", "Site", "Profile", "State"].map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const url = fieldText(row.fields.url);
            const host = hostOf(url);
            const title = fieldText(row.fields.title);
            const rank = fieldRank(row.fields.urlRank);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label="Open top site row detail"
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="w-16 tabular-nums">
                  {rank === null ? (
                    <AbsentWord />
                  ) : (
                    <span
                      className="text-foreground"
                      style={{ fontVariationSettings: fontWeights.semibold }}
                    >
                      {rank}
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[520px]">
                  <span className="flex items-center gap-2.5">
                    <SiteAvatar host={host} />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="truncate text-foreground"
                        title={title ?? undefined}
                      >
                        {title ?? host ?? "(untitled)"}
                      </span>
                      <span
                        className={cn(size.type.caption, "truncate font-mono")}
                        title={url ?? undefined}
                      >
                        {url ?? ""}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.profile}
                </TableCell>
                <TableCell>
                  <StateWord state={row.commitState} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Placeholder at the size of the loaded page's first blocks. */
function TopSitesSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-label="Loading rows"
      role="status"
    >
      <Skeleton className="h-[86px] rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[352px] rounded-xl" />
        <Skeleton className="h-[352px] rounded-xl" />
      </div>
      <Skeleton className="h-[320px] rounded-xl" />
    </div>
  );
}

export function TopSitesPage({ config }: { readonly config: ArtifactConfig }) {
  const list = useTopSites(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<string | null>(null);

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.profile))].sort(),
    [list.rows],
  );

  const stats = useMemo(() => summarize(list.rows), [list.rows]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return list.rows.filter((row) => {
      if (profileFilter !== null && row.profile !== profileFilter) {
        return false;
      }
      if (query === "") {
        return true;
      }
      const haystack = [
        fieldText(row.fields.url) ?? "",
        fieldText(row.fields.title) ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [list.rows, search, profileFilter]);

  const filtered = visible.length !== list.rows.length;

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const profileTabs = [ALL_PROFILES, ...profiles];
  const profileIndex =
    profileFilter === null
      ? 0
      : Math.max(0, profiles.indexOf(profileFilter) + 1);

  return (
    <div className="flex flex-col gap-5">
      <Coverage artifact={config.completenessArtifact} />

      {list.error !== null ? (
        <Panel>
          <ErrorRows message={list.error} onRetry={list.retry} />
        </Panel>
      ) : list.loading && list.rows.length === 0 ? (
        <TopSitesSkeleton />
      ) : list.rows.length === 0 ? (
        <Panel>
          <EmptyRows message="No Top sites rows in this Case." />
        </Panel>
      ) : (
        <>
          <StatStrip stats={stats} />

          <Leaderboard rows={list.rows} onSelect={select} />

          <CompositionCard rows={list.rows} />

          <Panel
            role="region"
            aria-labelledby="top-sites-all-title"
            className="overflow-clip"
          >
            <PanelHeader className="items-center pb-3">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <PanelTitle id="top-sites-all-title">
                  All ranked sites
                </PanelTitle>
                <RowCount count={visible.length} />
              </div>
            </PanelHeader>
            <SizeProvider size="compact">
              <div
                role="group"
                aria-label="Filter loaded top sites"
                className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 pb-3"
              >
                {profiles.length > 1 ? (
                  <TabsSubtle
                    idPrefix="top-sites-profile"
                    selectedIndex={profileIndex}
                    onSelect={(index) => {
                      setProfileFilter(
                        index === 0 ? null : (profiles[index - 1] ?? null),
                      );
                    }}
                    aria-label="Profile"
                  >
                    {profileTabs.map((label, index) => (
                      <TabsSubtleItem key={label} index={index} label={label} />
                    ))}
                  </TabsSubtle>
                ) : (
                  <span />
                )}
                {/* Narrows the rows already loaded, live as you type — no
                    new query, so there is nothing to commit. Keeps the
                    toolbar field's hairline at rest like FilterTextField. */}
                <InputGroup className="w-60 max-sm:w-full [&_label+div]:ring-border">
                  <InputField
                    index={0}
                    label="Search loaded top sites"
                    labelHidden
                    icon={Search}
                    value={search}
                    placeholder="Search site or title…"
                    onChange={setSearch}
                  />
                </InputGroup>
              </div>
            </SizeProvider>

            <div className="border-t border-border">
              {visible.length === 0 ? (
                <EmptyRows
                  message={
                    filtered
                      ? "No loaded rows match this filter."
                      : "No Top sites rows in this Case."
                  }
                />
              ) : (
                <RankedTable rows={visible} onSelect={select} />
              )}
            </div>

            <ListFooter
              count={list.rows.length}
              cursor={list.cursor}
              loading={list.loading}
              onLoadMore={list.loadMore}
              summary={
                filtered
                  ? `${String(visible.length)} of ${String(list.rows.length)} loaded rows shown`
                  : undefined
              }
            />
          </Panel>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            fieldText(selected.row.fields.title) ??
            hostOf(fieldText(selected.row.fields.url)) ??
            "Top site"
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RowCount({ count }: { readonly count: number }) {
  const size = useSize();
  return (
    <span
      className={cn(size.type.caption, "text-muted-foreground tabular-nums")}
    >
      {count.toLocaleString("en-US")}
    </span>
  );
}
