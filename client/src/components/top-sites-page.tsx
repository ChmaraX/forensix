/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking, shown as a ranking rather than as a
 * generic evidence dump: a leaderboard card per Browser Profile on top
 * (rank, site, host — Chrome's recorded order, nothing re-ranked), and a
 * curated table below with the fields an examiner reads first. Every wire
 * field a row carries stays reachable through the row detail sheet.
 *
 * Presentation rules kept: the Completeness Statement renders before any
 * row; states are worded, never color alone; ranks are Chrome's recorded
 * `urlRank` values — never bars or scores the evidence does not contain.
 */
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  Finding,
  PageOf,
} from "../types.js";
import { CompletenessPanel } from "./completeness.js";
import { EmptyRows } from "./data-table.js";
import {
  fieldInteger as fieldRank,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
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
    <div
      className={cn(
        "grid gap-4",
        byProfile.length > 1 && "md:grid-cols-2",
      )}
    >
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

export function TopSitesPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
  const list = useTopSites(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<string | null>(null);

  const statement = completeness.statements.find(
    (entry) => entry.artifact === config.completenessArtifact,
  );

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.profile))].sort(),
    [list.rows],
  );

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
      <CompletenessPanel statement={statement} />

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
        <div className="flex flex-col gap-2" aria-label="Loading rows">
          <Skeleton className="h-[220px] w-full" />
          <Skeleton className="h-[280px] w-full" />
        </div>
      ) : (
        <>
          <Leaderboard rows={list.rows} onSelect={select} />

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
