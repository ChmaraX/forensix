/**
 * The Saved logins page.
 *
 * Chrome's stored login entries read as an identity picture rather than a
 * generic evidence dump. Passwords are never shown — the product rule holds
 * here as everywhere: `secret` arrives `unavailable` and is not surfaced.
 * What this page reads instead is the *shape* of an account footprint: how
 * many distinct sites and usernames a subject saved, which identities repeat
 * across sites (account linkage), and which stored logins are actively used
 * versus long dormant.
 *
 * Every widget is a direct reading of recorded fields — distinct counts,
 * grouped usernames, and day-distances derived from the recorded
 * `dateCreated` / `dateLastUsed` instants. Nothing is inferred or predicted;
 * a credential with no recorded value in a field reads as the word "absent".
 *
 * Presentation rules kept: the Completeness Statement renders before any row;
 * commit states are worded with their dot, never color alone; every raw wire
 * field stays reachable through the row detail sheet.
 */
import { KeyRound, Link2, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  Finding,
  PageOf,
} from "../types.js";
import {
  CredentialAgeScatter,
  useChartTokens,
  type CredentialAgePoint,
} from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Button } from "./compat/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./compat/card.js";
import { Skeleton } from "./ui/misc.js";

/* ------------------------------ data loading ------------------------------ */

/** Upper bound on pages read for the whole page. Saved-login sets are small
 *  (one row per stored credential), so the widgets read every row rather than
 *  a first page: 60 pages at 100 rows covers 6,000 credentials, well past any
 *  realistic Chrome profile, while still bounding the request count. */
const CREDENTIAL_PAGE_CAP = 60;

async function fetchAllCredentials(
  route: string,
): Promise<readonly Finding[]> {
  const rows: Finding[] = [];
  let after: string | null = null;
  for (let page = 0; page < CREDENTIAL_PAGE_CAP; page += 1) {
    const parameters: (readonly [string, string])[] = [
      ["sort", "last-used-time"],
      ["direction", "desc"],
      ["limit", "100"],
    ];
    if (after !== null) {
      parameters.push(["after", after]);
    }
    const result = await callApi<PageOf<Finding>>(route, parameters);
    rows.push(...result.items);
    after = result.nextCursor;
    if (after === null) {
      break;
    }
  }
  return rows;
}

function useCredentials(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    fetchAllCredentials(route)
      .then((result) => {
        if (!cancelled) {
          setRows(result);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Request failed.",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [route, nonce]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, loading, error, retry };
}

/* --------------------------- derived readings ----------------------------- */

/** The host a credential belongs to, from its origin URL then its realm. */
function credentialHost(row: Finding): string | null {
  return (
    hostOf(fieldText(row.fields.originUrl)) ??
    hostOf(fieldText(row.fields.signonRealm)) ??
    fieldText(row.fields.signonRealm)
  );
}

/** Whole days between an ISO instant and now, or null when unparseable. */
function daysSince(utc: string | null): number | null {
  if (utc === null) {
    return null;
  }
  const parsed = new Date(utc);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.max(
    0,
    Math.round((Date.now() - parsed.getTime()) / 86_400_000),
  );
}

interface CredentialSummary {
  readonly total: number;
  readonly sites: number;
  readonly identities: number;
  readonly recovered: number;
  readonly points: readonly CredentialAgePoint[];
  /** Usernames stored on more than one site, strongest linkage first. */
  readonly reused: readonly {
    readonly username: string;
    readonly hosts: readonly string[];
  }[];
}

function summarize(rows: readonly Finding[]): CredentialSummary {
  const hosts = new Set<string>();
  const identities = new Set<string>();
  const byUsername = new Map<string, Set<string>>();
  const points: CredentialAgePoint[] = [];
  let recovered = 0;

  for (const row of rows) {
    if (row.commitState !== "committed") {
      recovered += 1;
    }
    const host = credentialHost(row);
    if (host !== null) {
      hosts.add(host);
    }
    const username = fieldText(row.fields.usernameValue);
    if (username !== null) {
      identities.add(username);
      if (host !== null) {
        const group = byUsername.get(username) ?? new Set<string>();
        group.add(host);
        byUsername.set(username, group);
      }
    }
    const ageDays = daysSince(fieldUtc(row.fields.dateCreated));
    const idleDays = daysSince(fieldUtc(row.fields.dateLastUsed));
    if (ageDays !== null && idleDays !== null) {
      points.push({
        site: host ?? "(unknown site)",
        username: username ?? "(no username)",
        ageDays,
        idleDays,
        timesUsed: fieldInteger(row.fields.timesUsed),
        recovered: row.commitState !== "committed",
      });
    }
  }

  const reused = [...byUsername.entries()]
    .filter(([, group]) => group.size > 1)
    .map(([username, group]) => ({
      username,
      hosts: [...group].sort(),
    }))
    .sort((left, right) => right.hosts.length - left.hosts.length);

  return {
    total: rows.length,
    sites: hosts.size,
    identities: identities.size,
    recovered,
    points,
    reused,
  };
}

/* -------------------------------- widgets --------------------------------- */


/**
 * Reused identities — the same stored username across more than one site.
 * This is account linkage read directly off the evidence, not inference: it
 * only ever states "this exact username string was saved on these sites",
 * which is a fact the rows carry, never a claim the accounts are the same
 * person.
 */
function ReusedIdentities({
  reused,
}: {
  readonly reused: CredentialSummary["reused"];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-muted">
            <Link2 aria-hidden="true" className="size-3.5 text-foreground/60" />
          </span>
          <CardTitle>Reused usernames</CardTitle>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {reused.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {reused.length === 0 ? (
          <p className="py-2 text-[13px] text-muted-foreground">
            No saved username appears on more than one site.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reused.map((entry) => (
              <li
                key={entry.username}
                className="flex flex-col gap-1.5 border-b border-border/70 pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="truncate font-mono text-[13px] font-medium"
                    title={entry.username}
                  >
                    {entry.username}
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                    {entry.hosts.length} sites
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.hosts.map((host) => (
                    <span
                      key={host}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11.5px] text-muted-foreground"
                    >
                      <SiteAvatar host={host} />
                      {host}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** "3 Dec 2024" over its time, or the word "absent" when no instant recorded. */
function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className="text-[12.5px] whitespace-nowrap tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span className="font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </span>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CredentialsPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useCredentials(config.route);
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");

  const summary = useMemo(() => summarize(list.rows), [list.rows]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    if (query === "") {
      return list.rows;
    }
    return list.rows.filter((row) => {
      const haystack = [
        credentialHost(row) ?? "",
        fieldText(row.fields.usernameValue) ?? "",
        fieldText(row.fields.signonRealm) ?? "",
        fieldText(row.fields.originUrl) ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [list.rows, search]);

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
            <Skeleton className="h-[104px] rounded-xl" />
          </div>
          <Skeleton className="h-[320px] w-full rounded-lg" />
          <Skeleton className="h-[320px] w-full rounded-lg" />
        </div>
      ) : list.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <KeyRound
            aria-hidden="true"
            className="size-6 text-muted-foreground/40"
          />
          <p className="text-[13px] text-muted-foreground">
            No saved logins recorded in this Case.
          </p>
        </div>
      ) : (
        <>
          {/* Footprint at a glance — distinct counts read straight off the
              rows, never inference. Passwords stay out of it: the tile speaks
              to how many logins exist and their identity spread, never their
              contents. */}
          <MetricBand className="grid-cols-2 sm:grid-cols-4">
            <MetricBandItem
              label="Saved logins"
              value={summary.total.toLocaleString("en-US")}
              detail={summary.total === 1 ? "stored entry" : "stored entries"}
            />
            <MetricBandItem
              label="Distinct sites"
              value={summary.sites.toLocaleString("en-US")}
              detail="hosts with a saved login"
            />
            <MetricBandItem
              label="Distinct usernames"
              value={summary.identities.toLocaleString("en-US")}
              detail="unique stored identities"
            />
            <MetricBandItem
              label="Recovered"
              value={summary.recovered.toLocaleString("en-US")}
              detail="from WAL / journal sidecars"
              tone="warning"
            />
          </MetricBand>

          <div className="grid grid-cols-12 gap-4">
            {/* Login age scatter — the one widget that reads the set as a
                shape: recently used logins sit low, long-dormant ones sit
                high, and older accounts sit further right. Diamonds are
                recovered rows. Every coordinate is a recorded timestamp
                turned into a day-distance, nothing modelled. */}
            <Card className="col-span-12 overflow-hidden lg:col-span-7">
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-md bg-muted">
                    <ShieldAlert
                      aria-hidden="true"
                      className="size-3.5 text-foreground/60"
                    />
                  </span>
                  <CardTitle>Login age and dormancy</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="relative min-h-[300px] flex-1 p-0">
                <div className="absolute inset-0 pt-2 pr-4 pb-2 pl-2">
                  <CredentialAgeScatter
                    points={summary.points}
                    tokens={tokens}
                  />
                </div>
              </CardContent>
              {summary.points.length !== summary.total ? (
                <p className="border-t border-border/70 px-5 py-2 text-[12px] text-muted-foreground">
                  {summary.total - summary.points.length} login
                  {summary.total - summary.points.length === 1 ? "" : "s"} not
                  plotted — no recorded creation or last-use date.
                </p>
              ) : null}
            </Card>

            <div className="col-span-12 lg:col-span-5">
              <ReusedIdentities reused={summary.reused} />
            </div>
          </div>

          {/* The raw rows. Columns are the four fields an examiner reads
              first about a stored login — the site it belongs to, the stored
              username, when it was created, when it was last used, and how
              many times — plus its commit state. Every remaining wire field
              (realm, encryption scheme, password-modified date) stays
              reachable in the row detail sheet. */}
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Stored logins</h2>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {list.rows.length}
              </span>
              <label className="relative ml-auto">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder="Search site or username"
                  aria-label="Search saved logins"
                  className="h-8 w-[220px] rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </header>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No saved logins match this search."
                    : "No saved logins in this Case."
                }
              />
            ) : (
              <div className="fx-scroll-x">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      {[
                        "Site",
                        "Username",
                        "Created",
                        "Last used",
                        "Uses",
                        "State",
                      ].map((label) => (
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
                      const host = credentialHost(row);
                      const realm = fieldText(row.fields.signonRealm);
                      const username = fieldText(row.fields.usernameValue);
                      const uses = fieldInteger(row.fields.timesUsed);
                      return (
                        <tr
                          key={index}
                          tabIndex={0}
                          aria-label="Open saved login row detail"
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
                          <td className="max-w-[280px] px-3 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <SiteAvatar host={host} />
                              <span className="flex min-w-0 flex-col">
                                <span
                                  className="truncate text-[13px] text-foreground/90"
                                  title={host ?? realm ?? undefined}
                                >
                                  {host ?? realm ?? "(unknown site)"}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="max-w-[240px] px-3 py-2.5">
                            {username === null ? (
                              <AbsentWord />
                            ) : (
                              <span
                                className="block truncate font-mono text-[12.5px] text-foreground/90"
                                title={username}
                              >
                                {username}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <TimeCell utc={fieldUtc(row.fields.dateCreated)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <TimeCell
                              utc={fieldUtc(row.fields.dateLastUsed)}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-[13px] tabular-nums">
                            {uses === null ? (
                              <AbsentWord />
                            ) : (
                              <span className="text-foreground/80">{uses}</span>
                            )}
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

            <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
              <p
                className="text-[12.5px] text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {filtered
                  ? `${String(visible.length)} of ${String(list.rows.length)} rows shown`
                  : `${String(list.rows.length)} row${list.rows.length === 1 ? "" : "s"} shown`}
              </p>
            </div>
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
