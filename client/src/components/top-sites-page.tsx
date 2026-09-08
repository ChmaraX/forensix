/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking, read as a ranking rather than a generic
 * evidence dump. Chrome records one ordered list per Browser Profile
 * (`urlRank` 1..N, its own placement — nothing this page re-ranks), and the
 * page reads that ordering back four ways before the raw table:
 *
 *  1. A small stat strip — ranked sites, distinct hosts, Profiles covered,
 *     and how many rows were recovered from sidecars rather than committed.
 *  2. A leaderboard card per Profile — Chrome's recorded top placements.
 *  3. A "top of the list" composition read — which registrable domains hold
 *     the highest-ranked slots, and how the ranking splits between committed
 *     and recovered (sidecar) rows.
 *  4. The full ranked table, searchable and profile-filterable.
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * states are worded, never colour alone; ranks are Chrome's recorded `urlRank`
 * values — never scores or bars the evidence does not contain. The one bar in
 * the composition read is a share of *counts this page tallied* (how many of
 * the loaded rows fall in a domain / a commit state), labelled as such — never
 * a fabricated ranking of the sites themselves.
 */
import { Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  Finding,
  PageOf,
} from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  fieldInteger as fieldRank,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";

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
    <MetricBand className="grid-cols-2 xl:grid-cols-4">
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
            ? "all rows committed"
            : "rows from WAL / journal"
        }
        tone={stats.recoveredCount === 0 ? "neutral" : "warning"}
      />
    </MetricBand>
  );
}

/** How many leaderboard rows each Profile card shows before "and N more". */
const BOARD_LIMIT = 5;

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
    <div className={cn("grid gap-4", byProfile.length > 1 && "md:grid-cols-2")}>
      {byProfile.map(([profile, group]) => (
        <section
          key={profile}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Chrome's ranking</h2>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {profile}
            </span>
          </header>
          <ol className="flex flex-col p-2">
            {group.slice(0, BOARD_LIMIT).map((row, index) => {
              const url = fieldText(row.fields.url);
              const host = hostOf(url);
              const title = fieldText(row.fields.title);
              const rank = fieldRank(row.fields.urlRank);
              return (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(row);
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-100 hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "w-6 shrink-0 text-center text-[13px] font-semibold tabular-nums",
                        rank === 1 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {rank ?? "—"}
                    </span>
                    <SiteAvatar host={host} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium">
                        {title ?? host ?? url ?? "(untitled)"}
                      </span>
                      <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                        {host ?? url ?? ""}
                      </span>
                    </span>
                    {row.commitState === "committed" ? null : (
                      <StateWord state={row.commitState} />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {group.length > BOARD_LIMIT ? (
            <p className="border-t border-border/70 px-4 py-2 text-[12px] text-muted-foreground">
              and {group.length - BOARD_LIMIT} more in the table below
            </p>
          ) : null}
        </section>
      ))}
    </div>
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
    .sort((left, right) => right.count - left.count || left.bestRank - right.bestRank);
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
  const shares = useMemo(
    () => domainShares(rows, COMPOSITION_TOP_N),
    [rows],
  );
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
    <div className="grid grid-cols-12 gap-4">
      <section className="col-span-12 overflow-hidden rounded-lg border border-border bg-card lg:col-span-7">
        <header className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Domains at the top</h2>
          <p className="text-[12px] text-muted-foreground">
            Of the {consideredCount} highest-ranked rows, how many slots each
            site's domain holds.
          </p>
        </header>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            No ranked rows with a readable host to group.
          </p>
        ) : (
          <ol className="flex flex-col gap-1 p-3">
            {shown.map((share) => {
              const width = Math.round((share.count / peak) * 100);
              return (
                <li
                  key={share.domain}
                  className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SiteAvatar host={share.domain} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">
                        {share.domain}
                      </span>
                      {share.bestRank !== null ? (
                        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                          best rank #{share.bestRank}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full transition-[width] duration-500",
                        share.count === peak ? "bg-primary" : "bg-primary/45",
                      )}
                      style={{ width: `${String(width)}%` }}
                    />
                  </span>
                  <span className="font-mono text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">
                    {share.count} slot{share.count === 1 ? "" : "s"}
                  </span>
                </li>
              );
            })}
            {remainderCount > 0 ? (
              <li className="px-1.5 pt-1 text-[12px] text-muted-foreground">
                and {remainder.length} more domain
                {remainder.length === 1 ? "" : "s"} sharing {remainderCount}{" "}
                slot{remainderCount === 1 ? "" : "s"}
              </li>
            ) : null}
          </ol>
        )}
      </section>

      <section className="col-span-12 overflow-hidden rounded-lg border border-border bg-card lg:col-span-5">
        <header className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Where the ranking came from</h2>
          <p className="text-[12px] text-muted-foreground">
            How the loaded rows split between the committed database and
            recovered sidecars.
          </p>
        </header>
        <div className="flex flex-col gap-4 p-4">
          {commitSplit.total === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No rows loaded to split.
            </p>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              >
                {commitSplit.committed > 0 ? (
                  <span
                    className="h-full bg-muted-foreground/45"
                    style={{
                      width: `${String((commitSplit.committed / commitSplit.total) * 100)}%`,
                    }}
                  />
                ) : null}
                {commitSplit.wal > 0 ? (
                  <span
                    className="h-full bg-wal"
                    style={{
                      width: `${String((commitSplit.wal / commitSplit.total) * 100)}%`,
                    }}
                  />
                ) : null}
                {commitSplit.journal > 0 ? (
                  <span
                    className="h-full bg-violet"
                    style={{
                      width: `${String((commitSplit.journal / commitSplit.total) * 100)}%`,
                    }}
                  />
                ) : null}
              </div>
              <dl className="flex flex-col gap-2.5">
                <CommitLegendRow
                  dotClass="bg-muted-foreground/50"
                  label="Committed"
                  hint="read from the saved database"
                  count={commitSplit.committed}
                  total={commitSplit.total}
                />
                <CommitLegendRow
                  dotClass="bg-wal"
                  label="WAL-resident"
                  hint="recovered from the write-ahead log"
                  count={commitSplit.wal}
                  total={commitSplit.total}
                  toneClass="text-wal"
                />
                <CommitLegendRow
                  dotClass="bg-violet"
                  label="Journal-resident"
                  hint="recovered from the rollback journal"
                  count={commitSplit.journal}
                  total={commitSplit.total}
                  toneClass="text-violet"
                />
              </dl>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CommitLegendRow({
  dotClass,
  label,
  hint,
  count,
  total,
  toneClass,
}: {
  readonly dotClass: string;
  readonly label: string;
  readonly hint: string;
  readonly count: number;
  readonly total: number;
  readonly toneClass?: string;
}) {
  const percent = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", dotClass)}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-[12.5px] font-medium", toneClass)}>
          {label}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {hint}
        </span>
      </span>
      <span className="text-right font-mono text-[12px] tabular-nums">
        <span className="font-medium">{count.toLocaleString("en-US")}</span>
        <span className="ml-1.5 text-muted-foreground">{percent}%</span>
      </span>
    </div>
  );
}

export function TopSitesPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
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

  return (
    <div className="flex flex-col gap-4">

      {list.error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The rows could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{list.error}</p>
          </div>
          <Button onClick={list.retry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : list.loading && list.rows.length === 0 ? (
        <div className="flex flex-col gap-3" aria-label="Loading rows">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Skeleton className="h-[118px] rounded-lg" />
            <Skeleton className="h-[118px] rounded-lg" />
            <Skeleton className="h-[118px] rounded-lg" />
            <Skeleton className="h-[118px] rounded-lg" />
          </div>
          <Skeleton className="h-[220px] w-full rounded-lg" />
          <Skeleton className="h-[280px] w-full rounded-lg" />
        </div>
      ) : list.rows.length === 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <EmptyRows message="No Top sites rows in this Case." />
        </section>
      ) : (
        <>
          <StatStrip stats={stats} />

          <Leaderboard rows={list.rows} onSelect={select} />

          <CompositionCard rows={list.rows} />

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">All ranked sites</h2>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {profiles.length > 1
                  ? profiles.map((profile) => (
                      <button
                        key={profile}
                        type="button"
                        aria-pressed={profileFilter === profile}
                        onClick={() => {
                          setProfileFilter(
                            profileFilter === profile ? null : profile,
                          );
                        }}
                        className={cn(
                          "inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                          profileFilter === profile
                            ? "border-accent-border bg-accent text-accent-foreground"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {profile}
                      </button>
                    ))
                  : null}
                <label className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                    placeholder="Search site or title"
                    aria-label="Search loaded top sites"
                    className="h-8 w-[200px] rounded-md border border-input bg-background pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </header>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No loaded rows match this filter."
                    : "No Top sites rows in this Case."
                }
              />
            ) : (
              <div className="fx-scroll-x">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      {["Rank", "Site", "Profile", "State"].map((label) => (
                        <th
                          key={label}
                          className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, index) => {
                      const url = fieldText(row.fields.url);
                      const host = hostOf(url);
                      const title = fieldText(row.fields.title);
                      const rank = fieldRank(row.fields.urlRank);
                      return (
                        <tr
                          key={index}
                          tabIndex={0}
                          aria-label="Open top site row detail"
                          onClick={() => {
                            select(row);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              select(row);
                            }
                          }}
                          className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
                        >
                          <td className="w-14 px-3 py-2.5 text-[13px] font-semibold text-muted-foreground tabular-nums">
                            {rank ?? (
                              <span className="font-normal italic">absent</span>
                            )}
                          </td>
                          <td className="max-w-[480px] px-3 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <SiteAvatar host={host} />
                              <span className="flex min-w-0 flex-col">
                                <span
                                  className="truncate text-[13px] text-foreground/90"
                                  title={title ?? undefined}
                                >
                                  {title ?? host ?? "(untitled)"}
                                </span>
                                <span
                                  className="truncate font-mono text-[11.5px] text-muted-foreground"
                                  title={url ?? undefined}
                                >
                                  {url ?? ""}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] text-muted-foreground">
                            {row.profile}
                          </td>
                          <td className="px-3 py-2.5">
                            <StateWord state={row.commitState} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {list.rows.length === 0 && list.cursor === null ? null : (
              <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
                <p
                  className="text-[12.5px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  {filtered
                    ? `${String(visible.length)} of ${String(list.rows.length)} loaded rows shown`
                    : `${String(list.rows.length)} row${list.rows.length === 1 ? "" : "s"} shown`}
                  {list.cursor === null ? "" : " · more available"}
                </p>
                {list.cursor !== null ? (
                  <Button
                    onClick={list.loadMore}
                    disabled={list.loading}
                    size="sm"
                  >
                    {list.loading ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
