/**
 * The Saved logins page.
 *
 * Chrome's stored login entries read as an identity picture rather than a
 * generic evidence dump. Passwords are never shown — the product rule holds
 * here as everywhere: `secret` arrives `unavailable` and its contents are not
 * surfaced. The page says so up front (the "Passwords stay sealed" banner),
 * and the table's Password column only ever states the field's *state*:
 * "unavailable" with the recorded reason, or — should a value ever arrive —
 * the words "value withheld", never the value itself.
 *
 * What this page reads instead is the *shape* of an account footprint: how
 * many distinct sites and usernames a subject saved, which identities repeat
 * across sites (account linkage), and which stored logins are actively used
 * versus long dormant. Every widget is a direct reading of recorded fields —
 * distinct counts, grouped usernames, and day-distances derived from the
 * recorded `dateCreated` / `dateLastUsed` instants. Nothing is inferred or
 * predicted; a credential with no recorded value in a field reads "absent".
 *
 * Presentation rules kept: saved logins and logins recovered from WAL /
 * journal sidecars are separate lists (the Saved / Recovered switch), never
 * sorted together; commit states are worded with their dot, never colour
 * alone; every raw wire field stays reachable through the row detail sheet.
 */
import { KeyRound, Link2, Lock, Search, ShieldAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Panel,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { ArtifactConfig, FieldState, Finding, PageOf } from "../types.js";
import {
  CredentialAgeScatter,
  useChartTokens,
  type CredentialAgePoint,
} from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  hostOf,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/* ------------------------------ data loading ------------------------------ */

/** Upper bound on pages read for the whole page. Saved-login sets are small
 *  (one row per stored credential), so the widgets read every row rather than
 *  a first page: 60 pages at 100 rows covers 6,000 credentials, well past any
 *  realistic Chrome profile, while still bounding the request count. */
const CREDENTIAL_PAGE_CAP = 60;

async function fetchAllCredentials(route: string): Promise<readonly Finding[]> {
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
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 86_400_000));
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

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/* -------------------------------- widgets --------------------------------- */

/** A small icon well beside a panel title. */
function TitleIcon({ children }: { readonly children: ReactNode }) {
  const shape = useShape();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center bg-active text-muted-foreground",
        shape.item,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Reused identities — the same stored username across more than one site.
 * This is account linkage read directly off the evidence, not inference: it
 * only ever states "this exact username string was saved on these sites",
 * which is a fact the rows carry, never a claim the accounts are the same
 * person. Picking an identity narrows the table to it (a second pick clears).
 */
function ReusedIdentities({
  reused,
  activeUsername,
  onPick,
}: {
  readonly reused: CredentialSummary["reused"];
  readonly activeUsername: string | null;
  readonly onPick: (username: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  return (
    <Panel className="h-full">
      <PanelHeader className="flex-nowrap items-center">
        <div className="flex min-w-0 items-center gap-3">
          <TitleIcon>
            <Link2 className="size-3.5" />
          </TitleIcon>
          <div className="flex min-w-0 flex-col gap-0.5">
            <PanelTitle>Reused usernames</PanelTitle>
            <PanelDescription>
              The same username saved on several sites.
            </PanelDescription>
          </div>
        </div>
        <Badge size="compact" className="tabular-nums">
          {reused.length.toLocaleString("en-US")}
        </Badge>
      </PanelHeader>
      {reused.length === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-2 pb-4 text-muted-foreground",
          )}
        >
          No saved username appears on more than one site.
        </p>
      ) : (
        <ul
          ref={listRef}
          {...hover.handlers}
          className="relative flex flex-col gap-0.5 px-1 pb-1"
        >
          <FluidHoverHighlight hover={hover} className={shape.item} />
          {reused.map((entry, index) => (
            <ReusedRow
              key={entry.username}
              index={index}
              registerItem={hover.registerItem}
              username={entry.username}
              hosts={entry.hosts}
              active={activeUsername === entry.username}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReusedRow({
  index,
  registerItem,
  username,
  hosts,
  active,
  onPick,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly username: string;
  readonly hosts: readonly string[];
  readonly active: boolean;
  readonly onPick: (username: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        onClick={() => {
          onPick(username);
        }}
        className={cn(
          "relative flex w-full cursor-pointer flex-col gap-2 px-3 py-2.5 text-left transition-colors duration-80",
          shape.item,
          active && "bg-active",
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={cn(
              typeClass("body"),
              "inline-grid min-w-0 font-mono text-foreground",
            )}
          >
            <span
              className="col-start-1 row-start-1 truncate transition-[font-variation-settings] duration-80"
              style={{
                fontVariationSettings: active
                  ? fontWeights.semibold
                  : fontWeights.normal,
              }}
              title={username}
            >
              {username}
            </span>
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 truncate"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {username}
            </span>
          </span>
          <span
            className={cn(
              typeClass("caption"),
              "ml-auto shrink-0 text-muted-foreground tabular-nums",
            )}
          >
            {plural(hosts.length, "site", "sites")}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {hosts.map((host) => (
            <Badge key={host} size="compact" variant="dot" color="gray">
              {host}
            </Badge>
          ))}
        </span>
      </button>
    </li>
  );
}

/** "3 Dec 2024" then its time, or the word "absent" when no instant recorded. */
function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span className="whitespace-nowrap tabular-nums" title={`${utc} (UTC)`}>
      {parts.date}
      <span className="ml-2 text-muted-foreground">{parts.time}</span>
    </span>
  );
}

/**
 * The stored password's *state*, never its contents. Chrome seals each
 * password with the OS key; the analyzer reports it `unavailable` with a
 * reason, and this cell says exactly that. A `value` state is still withheld
 * — the cell names the state and the row sheet carries the raw field.
 */
function PasswordCell({ field }: { readonly field: FieldState | undefined }) {
  if (field === undefined || field.state === "absent") {
    return <AbsentWord />;
  }
  const reason =
    field.state === "unavailable"
      ? field.reason
      : "A password value was recorded. It is withheld from this table.";
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        className="flex cursor-help items-center gap-1.5 whitespace-nowrap"
      >
        {field.state === "unavailable" ? (
          <>
            <EvidenceDot state="unavailable" />
            unavailable
          </>
        ) : (
          <>
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            value withheld
          </>
        )}
      </span>
    </Tooltip>
  );
}

const COLUMNS = [
  "Site",
  "Username",
  "Password",
  "Created",
  "Last used",
  "Uses",
  "State",
] as const;

function CredentialTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 pb-1">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            {COLUMNS.map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const host = credentialHost(row);
            const realm = fieldText(row.fields.signonRealm);
            const username = fieldText(row.fields.usernameValue);
            const uses = fieldInteger(row.fields.timesUsed);
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label={`Open saved login for ${host ?? realm ?? "unknown site"}`}
                onClick={() => {
                  onSelect(row);
                }}
                onKeyDown={(event) => {
                  activateOnKey(event, () => {
                    onSelect(row);
                  });
                }}
                className={ROW_FOCUS_CLASS}
              >
                <TableCell className="max-w-[280px]">
                  <span
                    className="block truncate text-foreground"
                    title={host ?? realm ?? undefined}
                  >
                    {host ?? realm ?? "(unknown site)"}
                  </span>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  {username === null ? (
                    <AbsentWord />
                  ) : (
                    <span className="block truncate font-mono" title={username}>
                      {username}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <PasswordCell field={row.fields.secret} />
                </TableCell>
                <TableCell>
                  <TimeCell utc={fieldUtc(row.fields.dateCreated)} />
                </TableCell>
                <TableCell>
                  <TimeCell utc={fieldUtc(row.fields.dateLastUsed)} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {uses === null ? (
                    <AbsentWord />
                  ) : (
                    uses.toLocaleString("en-US")
                  )}
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

type View = "saved" | "recovered";

/**
 * The raw rows. Columns are the fields an examiner reads first about a
 * stored login — the site it belongs to, the stored username, the sealed
 * password's state, when it was created, last used, how many times — plus
 * its commit state. Every remaining wire field (realm, encryption scheme,
 * password-modified date) stays reachable in the row detail sheet.
 */
function CredentialListPanel({
  rows,
  search,
  onSearch,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (row: Finding) => void;
}) {
  const [view, setView] = useState<View>("saved");
  const size = useSize("compact");

  const saved = useMemo(
    () => rows.filter((row) => row.commitState === "committed"),
    [rows],
  );
  const recovered = useMemo(
    () => rows.filter((row) => row.commitState !== "committed"),
    [rows],
  );
  const base = view === "saved" ? saved : recovered;

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    if (query === "") {
      return base;
    }
    return base.filter((row) => {
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
  }, [base, search]);

  const filtered = visible.length !== base.length;
  const noun = view === "saved" ? "saved" : "recovered";

  return (
    <Panel className="overflow-clip">
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Stored logins</PanelTitle>
          <PanelDescription>
            Saved logins and logins recovered from WAL or journal sidecars are
            kept as separate lists.
          </PanelDescription>
        </div>
      </PanelHeader>
      <SizeProvider size="compact">
        <div
          className={cn(
            "flex flex-wrap items-center gap-y-2 px-4 pt-1 pb-3",
            size.gap,
          )}
        >
          <Tabs
            value={view}
            onValueChange={(next) => {
              setView(next === "recovered" ? "recovered" : "saved");
            }}
          >
            <TabsList aria-label="Saved or recovered logins">
              <TabItem
                value="saved"
                label={`Saved ${saved.length.toLocaleString("en-US")}`}
              />
              <TabItem
                value="recovered"
                label={`Recovered ${recovered.length.toLocaleString("en-US")}`}
              />
            </TabsList>
          </Tabs>
          <FilterTextField
            label="Search saved logins"
            placeholder="Search site or username"
            icon={Search}
            value={search}
            onCommit={onSearch}
            className="ml-auto w-60"
          />
        </div>
      </SizeProvider>

      <div className="border-t border-border">
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No ${noun} logins match this search.`
                : view === "saved"
                  ? "No saved logins in this Case."
                  : "No logins were recovered from WAL or journal sidecars."
            }
          />
        ) : (
          <CredentialTable rows={visible} onSelect={onSelect} />
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
        <p
          className={cn(
            typeClass("caption"),
            "text-muted-foreground tabular-nums",
          )}
          aria-live="polite"
        >
          {filtered
            ? `${visible.length.toLocaleString("en-US")} of ${base.length.toLocaleString("en-US")} ${noun} logins shown`
            : `${plural(base.length, `${noun} login`, `${noun} logins`)} shown`}
        </p>
      </div>
    </Panel>
  );
}

/** Placeholder at the size of the banner, figure strip, and widget row. */
function CredentialsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-[72px] w-full rounded-xl" />
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[360px] rounded-xl lg:col-span-7" />
        <Skeleton className="col-span-12 h-[360px] rounded-xl lg:col-span-5" />
      </div>
    </div>
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

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const pickUsername = useCallback((username: string) => {
    setSearch((current) => (current === username ? "" : username));
  }, []);

  const unplotted = summary.total - summary.points.length;

  return (
    <div className="flex flex-col gap-4">
      {list.error !== null ? (
        <ErrorRows
          message={list.error}
          onRetry={list.retry}
          className="px-0 py-0"
        />
      ) : !list.loading && list.rows.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={KeyRound}
            title="No saved logins"
            message="No saved logins recorded in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <CredentialsSkeleton />
          {list.loading ? null : (
            <div className="flex flex-col gap-4">
              {/* The redaction rule, stated before any row: no password is
                  ever decrypted or displayed on this page. */}
              <Banner icon={Lock}>
                <BannerTitle>Passwords stay sealed</BannerTitle>
                <BannerDescription>
                  Chrome encrypts every saved password with the operating
                  system's key. This page never shows one: each password reads
                  as its recorded state, and the figures below describe only
                  sites, usernames, and dates.
                </BannerDescription>
              </Banner>

              {/* Footprint at a glance — distinct counts read straight off
                  the rows, never inference, and never password contents. */}
              <MetricBand className="grid-cols-2 sm:grid-cols-4">
                <MetricBandItem
                  label="Saved logins"
                  value={summary.total.toLocaleString("en-US")}
                  detail={
                    summary.total === 1 ? "stored entry" : "stored entries"
                  }
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
                {/* Login age scatter — the one widget that reads the set as
                    a shape: recently used logins sit low, long-dormant ones
                    sit high, and older accounts sit further right. Diamonds
                    are recovered rows. Every coordinate is a recorded
                    timestamp turned into a day-distance, nothing modelled. */}
                <Panel className="col-span-12 lg:col-span-7">
                  <PanelHeader className="items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <TitleIcon>
                        <ShieldAlert className="size-3.5" />
                      </TitleIcon>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <PanelTitle>Login age and dormancy</PanelTitle>
                        <PanelDescription>
                          Days since first saved, against days since last used.
                        </PanelDescription>
                      </div>
                    </div>
                  </PanelHeader>
                  <div className="relative min-h-[300px] flex-1">
                    <div className="absolute inset-0 pt-2 pr-4 pb-2 pl-2">
                      <CredentialAgeScatter
                        points={summary.points}
                        tokens={tokens}
                      />
                    </div>
                  </div>
                  {unplotted > 0 ? (
                    <p
                      className={cn(
                        typeClass("caption"),
                        "border-t border-border px-4 py-2.5 text-muted-foreground",
                      )}
                    >
                      {plural(unplotted, "login", "logins")} not plotted — no
                      recorded creation or last-use date.
                    </p>
                  ) : null}
                </Panel>

                <div className="col-span-12 lg:col-span-5">
                  <ReusedIdentities
                    reused={summary.reused}
                    activeUsername={search === "" ? null : search}
                    onPick={pickUsername}
                  />
                </div>
              </div>

              <CredentialListPanel
                rows={list.rows}
                search={search}
                onSearch={setSearch}
                onSelect={select}
              />
            </div>
          )}
        </div>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={`Saved login · ${credentialHost(selected.row) ?? "unknown site"}`}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
