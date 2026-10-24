/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking, read as a ranking rather than a generic
 * evidence dump. Chrome records one ordered list per Browser Profile
 * (`urlRank` 1..N, its own placement — nothing this page re-ranks), and the
 * page reads that ordering back in a column of FF Panels:
 *
 *  1. Evidence coverage — the Completeness Statement, before any row.
 *  2. A MetricBand of recorded figures over the saved ranking — ranked
 *     sites, distinct hosts, Profiles covered — and, as its own figure, how
 *     many rows were recovered from sidecars.
 *  3. A leaderboard per Profile — Chrome's saved top placements, as an FF
 *     CardGroup of inline cards (one fluid hover highlight; a card opens its
 *     row detail).
 *  4. A "top of the list" composition read — which registrable domains hold
 *     the highest-ranked saved slots (page-kit MeterList), and how the
 *     loaded rows split between saved and recovered (sidecar) reads.
 *  5. The full ranked table on FF's Table, as two server reads kept apart
 *     (forensic rule 4): Saved (committed) and Recovered (WAL then journal),
 *     switched with `CommitStateSplit`; Profiles (`ProfilePicker`) and a
 *     live search narrow the loaded rows of either list.
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * states are worded, never colour alone; ranks are Chrome's recorded `urlRank`
 * values — never scores or bars the evidence does not contain. The bars in
 * the composition read are shares of *counts this page tallied* (how many of
 * the loaded saved rows fall in a domain), labelled as such — never a
 * fabricated ranking of the sites themselves.
 */
import { Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { EvidenceDot, type EvidenceState } from "@/components/evidence";
import { Panel, PanelFooter } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { COMMIT_META } from "../terms.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  CommitState,
  Finding,
} from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { useChartTokens } from "./charts.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import {
  AbsentWord,
  FieldCell,
  fieldInteger as fieldRank,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows, ListBlock, RevealSwap } from "./list-states.js";
import {
  MetricBand,
  MetricBandItem,
  PendingFigure,
  UnavailableFigure,
} from "./metric-band.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  MeterList,
  plural,
  SectionPanel,
  type CommitView,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/** Chrome's own order: rank ascending (Commit State is added per list). */
const RANK_ORDER: readonly (readonly [string, string])[] = [
  ["sort", "rank"],
  ["direction", "asc"],
];

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
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
}

/** Distinct-host and per-profile tallies of the loaded saved rows. */
function summarize(rows: readonly Finding[]): TopSitesStats {
  const hosts = new Set<string>();
  const profiles = new Set<string>();
  for (const row of rows) {
    const host = hostOf(fieldText(row.fields.url));
    if (host !== null) {
      hosts.add(host.replace(/^www\./, ""));
    }
    profiles.add(row.profile);
  }
  return {
    rankedCount: rows.length,
    hostCount: hosts.size,
    profileCount: profiles.size,
  };
}

/** The figure strip. The first three count the saved ranking; the fourth
 *  counts recovered rows on their own, never added to the others. */
function StatStrip({
  stats,
  savedMore,
  recovered,
}: {
  readonly stats: TopSitesStats;
  readonly savedMore: boolean;
  readonly recovered: PaginatedList<Finding>;
}) {
  const loaded = savedMore ? "loaded saved rows" : "saved rows";
  const recoveredReady = !(recovered.loading && recovered.rows.length === 0);
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Ranked sites"
        value={stats.rankedCount.toLocaleString("en-US")}
        detail={loaded}
      />
      <MetricBandItem
        label="Distinct hosts"
        value={stats.hostCount.toLocaleString("en-US")}
        detail={`unique sites in ${loaded}`}
      />
      <MetricBandItem
        label="Profiles"
        value={stats.profileCount.toLocaleString("en-US")}
        detail={
          stats.profileCount === 1
            ? "one browser profile ranked"
            : "browser profiles ranked"
        }
      />
      <MetricBandItem
        label="Recovered"
        value={
          recovered.error !== null && recovered.rows.length === 0 ? (
            <UnavailableFigure />
          ) : recoveredReady ? (
            `${recovered.rows.length.toLocaleString("en-US")}${recovered.cursor === null ? "" : "+"}`
          ) : (
            <PendingFigure />
          )
        }
        detail={
          recovered.error !== null && recovered.rows.length === 0
            ? "the recovered read failed"
            : recoveredReady && recovered.rows.length === 0
              ? "no rows in the WAL or journal"
              : "sidecar rows, counted apart"
        }
      />
    </MetricBand>
  );
}

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

/** A site's name, as recorded: the page title, else its own state word —
 *  never the host standing in for a name. */
function SiteName({ row }: { readonly row: Finding }) {
  const title = fieldText(row.fields.title);
  return title === null ? <FieldCell field={row.fields.title} /> : title;
}

/** Where the site lives: its host when the URL parses, the raw URL when it
 *  does not, and the URL field's state word when none was recorded. */
function SiteAddress({ row }: { readonly row: Finding }) {
  const url = fieldText(row.fields.url);
  return url === null ? (
    <FieldCell field={row.fields.url} />
  ) : (
    (hostOf(url) ?? url)
  );
}

/** Chrome's saved ranking, one panel per Profile. */
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
        "grid items-start gap-4",
        byProfile.length > 1 && "lg:grid-cols-2",
      )}
    >
      {byProfile.map(([profile, group]) => (
        <SectionPanel
          key={profile}
          id={`top-sites-board-${profile.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
          title="Chrome's ranking"
          description="Saved placements, as Chrome ordered them."
          aside={
            <Badge size="compact" className="ml-auto">
              {profile}
            </Badge>
          }
        >
          <SizeProvider size="compact">
            <CardGroup orientation="inline" className="px-1 pb-1">
              {group.slice(0, BOARD_LIMIT).map((row, index) => {
                const title = fieldText(row.fields.title);
                const url = fieldText(row.fields.url);
                return (
                  <Card
                    key={index}
                    onClick={() => {
                      onSelect(row);
                    }}
                    label={`Open ${title ?? url ?? "top site"} row detail`}
                  >
                    <RankSlot rank={fieldRank(row.fields.urlRank)} />
                    <SiteAvatar host={hostOf(url)} />
                    <CardHeader className="gap-0.5 pr-3">
                      <CardTitle className={CARD_TITLE_CLEAR}>
                        <SiteName row={row} />
                      </CardTitle>
                      <CardDescription
                        className={cn(
                          typeClass("caption", "compact"),
                          "truncate font-mono",
                        )}
                      >
                        <SiteAddress row={row} />
                      </CardDescription>
                    </CardHeader>
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
        </SectionPanel>
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

interface CommitSplit {
  readonly committed: number;
  readonly wal: number;
  readonly journal: number;
  /** Any of the three reads still has rows to load. */
  readonly more: boolean;
}

/**
 * Composition read — two honest tallies of *which* rows sit at the top of
 * Chrome's list:
 *
 *  - "Domains at the top": of the highest-ranked `COMPOSITION_TOP_N` saved
 *    rows, how many slots each registrable domain holds (page-kit
 *    MeterList). A site that appears under several subdomains (mail. /
 *    drive. / docs.google.com) reads as one domain here, which is exactly
 *    the concentration an examiner is looking for. Every bar is a count of
 *    loaded saved rows, labelled "N slots".
 *  - "Where the ranking came from": how many rows each of the three reads
 *    (saved, WAL, journal) returned — a forensically load-bearing figure,
 *    since a ranking rebuilt largely from sidecars is a different kind of
 *    evidence than one read straight from the committed database.
 *
 * Neither invents a score. Both restate counts the page already has, and
 * every state hue keeps its word.
 */
function CompositionCard({
  saved,
  split,
}: {
  readonly saved: readonly Finding[];
  readonly split: CommitSplit;
}) {
  const size = useSize();
  const tokens = useChartTokens();
  const shares = useMemo(() => domainShares(saved, COMPOSITION_TOP_N), [saved]);
  const shown = shares.slice(0, DOMAIN_ROWS);
  const remainder = shares.slice(DOMAIN_ROWS);
  const remainderCount = remainder.reduce((sum, share) => sum + share.count, 0);
  const consideredCount = Math.min(saved.length, COMPOSITION_TOP_N);
  const total = split.committed + split.wal + split.journal;

  return (
    <div className="grid grid-cols-12 items-start gap-4">
      <SectionPanel
        id="top-sites-domains-title"
        title="Domains at the top"
        description={`Of the ${String(consideredCount)} highest-ranked saved rows, how many slots each site's domain holds.`}
        className="col-span-12 lg:col-span-7"
      >
        {shown.length === 0 ? (
          <EmptyRows message="No saved ranked rows with a readable host to group." />
        ) : (
          <MeterList
            className="px-4 pt-1 pb-3"
            labelWidth="clamp(6rem, 32%, 12rem)"
            tokens={tokens}
            rows={shown.map((share) => ({
              key: share.domain,
              label: (
                <>
                  <SiteAvatar host={share.domain} />
                  <span className="truncate" title={share.domain}>
                    {share.domain}
                  </span>
                </>
              ),
              value: share.count,
              display:
                share.bestRank === null
                  ? plural(share.count, "slot", "slots")
                  : `${plural(share.count, "slot", "slots")} · best #${String(share.bestRank)}`,
            }))}
          />
        )}
        {remainderCount > 0 ? (
          <PanelFooter>
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              and {plural(remainder.length, "more domain", "more domains")}{" "}
              sharing {plural(remainderCount, "slot", "slots")}
            </p>
          </PanelFooter>
        ) : null}
      </SectionPanel>

      <SectionPanel
        id="top-sites-split-title"
        title="Where the ranking came from"
        description={`How many rows each read returned${split.more ? " so far" : ""}: the saved database and the two recovered sidecars, counted apart.`}
        className="col-span-12 lg:col-span-5"
      >
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
          {total === 0 ? (
            <EmptyRows message="No rows loaded to split." />
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
                    ["committed", split.committed],
                    ["wal_resident", split.wal],
                    ["journal_resident", split.journal],
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
                  count={split.committed}
                  total={total}
                />
                <CommitLegendRow
                  state="wal_resident"
                  hint="recovered from the write-ahead log"
                  count={split.wal}
                  total={total}
                />
                <CommitLegendRow
                  state="journal_resident"
                  hint="recovered from the rollback journal"
                  count={split.journal}
                  total={total}
                />
              </dl>
            </>
          )}
        </div>
      </SectionPanel>
    </div>
  );
}

/** Commit State fills for the split bar: the evidence hues, never alone. */
const SPLIT_FILL: Readonly<Record<CommitState, string>> = {
  committed: "bg-muted-foreground",
  wal_resident: "bg-wal",
  journal_resident: "bg-violet",
};

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
    <div className="flex h-12 items-center gap-3 border-b border-border last:border-b-0">
      <EvidenceDot state={dot} />
      <dt className="flex min-w-0 flex-1 flex-col">
        <span className={cn(size.type.body, "text-foreground")}>
          {meta.label}
        </span>
        <span
          className={cn(size.type.caption, "truncate text-muted-foreground")}
        >
          {hint}
        </span>
      </dt>
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
            const title = fieldText(row.fields.title);
            const rank = fieldRank(row.fields.urlRank);
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={`${row.commitState}-${String(index)}`}
                index={index}
                tabIndex={0}
                aria-label={`Open top site row detail: ${title ?? url ?? "top site"}`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="w-16 tabular-nums">
                  {rank === null ? (
                    <FieldCell field={row.fields.urlRank} />
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
                    <SiteAvatar host={hostOf(url)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="min-w-0" title={title ?? undefined}>
                        <FieldCell
                          field={row.fields.title}
                          format={asText}
                          className="text-foreground"
                        />
                      </span>
                      <span className="min-w-0" title={url ?? undefined}>
                        <FieldCell
                          field={row.fields.url}
                          format={asText}
                          className={cn(size.type.caption, "font-mono")}
                        />
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

/** One of the two ranked lists, narrowed by the page's Profiles and search
 *  over its loaded rows. */
function RankedList({
  list,
  recovered,
  matches,
  filtered,
  onClearFilters,
  onSelect,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  readonly matches: (row: Finding) => boolean;
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
  readonly onSelect: (row: Finding) => void;
}) {
  const visible = useMemo(
    () => list.rows.filter(matches),
    [list.rows, matches],
  );
  return (
    <ListBlock
      list={list}
      noun={
        recovered
          ? { one: "recovered row", many: "recovered rows" }
          : { one: "saved row", many: "saved rows" }
      }
      shown={visible.length}
      filtered={filtered}
      onClearFilters={onClearFilters}
      skeletonRows={recovered ? 3 : 8}
      empty={
        <EmptyRows
          title={recovered ? "No recovered rows" : "No saved rows"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a Top sites row."
              : "The Top Sites database holds no committed rows."
          }
        />
      }
    >
      <RankedTable rows={visible} onSelect={onSelect} />
    </ListBlock>
  );
}

/** Placeholder at the size of the summary blocks above the table. */
function TopSitesSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-label="Loading the saved ranking"
      role="status"
    >
      <Skeleton className="h-[86px] rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[352px] rounded-xl" />
        <Skeleton className="h-[352px] rounded-xl" />
      </div>
      <Skeleton className="h-[320px] rounded-xl" />
    </div>
  );
}

function countOf(list: PaginatedList<unknown>): number | null {
  return list.loading && list.rows.length === 0 ? null : list.rows.length;
}

export function TopSitesPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
  const lists = useCommitStateLists<Finding>(config.route, RANK_ORDER);
  const [view, setView] = useState<CommitView>("saved");
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);

  const saved = lists.saved;
  const recovered = lists.recovered;

  const profiles = useMemo(
    () =>
      [
        ...new Set(
          [...saved.rows, ...recovered.rows].map((row) => row.profile),
        ),
      ].sort(),
    [saved.rows, recovered.rows],
  );

  const stats = useMemo(() => summarize(saved.rows), [saved.rows]);
  const split = useMemo<CommitSplit>(
    () => ({
      committed: saved.rows.length,
      wal: recovered.wal.rows.length,
      journal: recovered.journal.rows.length,
      more: saved.cursor !== null || recovered.cursor !== null,
    }),
    [
      saved.rows.length,
      saved.cursor,
      recovered.wal.rows.length,
      recovered.journal.rows.length,
      recovered.cursor,
    ],
  );

  const query = search.trim().toLocaleLowerCase("en-US");
  const filtered = query !== "" || profileFilter.length > 0;
  const matches = useCallback(
    (row: Finding) => {
      if (profileFilter.length > 0 && !profileFilter.includes(row.profile)) {
        return false;
      }
      if (query === "") {
        return true;
      }
      return [
        fieldText(row.fields.url) ?? "",
        fieldText(row.fields.title) ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US")
        .includes(query);
    },
    [profileFilter, query],
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const savedFirstRead = saved.loading && saved.rows.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />

      {/* The summary reads the saved ranking only. */}
      {saved.error !== null && saved.rows.length === 0 ? (
        <Panel>
          <ErrorRows
            title="The saved ranking could not be loaded."
            message={saved.error}
            onRetry={saved.retry}
          />
        </Panel>
      ) : (
        <RevealSwap loading={savedFirstRead} skeleton={<TopSitesSkeleton />}>
          <div className="flex flex-col gap-5">
            <StatStrip
              stats={stats}
              savedMore={saved.cursor !== null}
              recovered={recovered}
            />
            <Leaderboard rows={saved.rows} onSelect={select} />
            <CompositionCard saved={saved.rows} split={split} />
          </div>
        </RevealSwap>
      )}

      <SectionPanel
        id="top-sites-all-title"
        title="All ranked sites"
        description="Every Top sites row, in Chrome's rank order."
      >
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered top sites"
          savedCount={countOf(saved)}
          recoveredCount={countOf(recovered)}
          savedMore={saved.cursor !== null}
          recoveredMore={recovered.cursor !== null}
          toolbar={
            <>
              {profiles.length > 1 ? (
                <ProfilePicker
                  id="top-sites-profiles"
                  profiles={profiles}
                  selected={profileFilter}
                  onChange={setProfileFilter}
                />
              ) : null}
              <FilterTextField
                id="top-sites-search"
                commit="change"
                label="Search loaded top sites"
                icon={Search}
                value={search}
                placeholder="Search site or title…"
                onCommit={setSearch}
              />
            </>
          }
          saved={
            <RankedList
              list={saved}
              recovered={false}
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={select}
            />
          }
          recovered={
            <RankedList
              list={recovered}
              recovered
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={select}
            />
          }
        />
      </SectionPanel>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={fieldText(selected.row.fields.title) ?? "Top site"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
