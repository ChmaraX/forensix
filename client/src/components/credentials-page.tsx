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
 * predicted; a field with no recorded value reads its own state word.
 *
 * Saved logins and logins recovered from WAL / journal sidecars are separate
 * server reads (`useCommitStateLists`, every page followed so the figures
 * cover the whole set) and separate lists (the Saved / Recovered switch),
 * never sorted together. The figures count saved logins; recovered logins
 * get their own figure and their own marks on the scatter.
 */
import { KeyRound, Lock, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import {
  Card,
  CardDescription,
  CardFooter,
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
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { ChartSection } from "./chart-section.js";
import {
  ChartEmpty,
  CredentialAgeScatter,
  useChartTokens,
  type CredentialAgePoint,
} from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  AbsentWord,
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ListBlock } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  plural,
  SectionPanel,
  TimeCell,
  type CommitView,
} from "./page-kit.js";

/* ------------------------------ data loading ------------------------------ */

const CREDENTIAL_PARAMETERS: QueryParameters = [
  ["sort", "last-used-time"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Upper bound on rows read per list. Saved-login sets are small (one row per
 *  stored credential), so the figures read every row rather than a first
 *  page: 6,000 credentials is well past any realistic Chrome profile, while
 *  still bounding the request count. */
const CREDENTIAL_ROW_CAP = 6000;

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
  /** Usernames stored on more than one site, strongest linkage first. */
  readonly reused: readonly {
    readonly username: string;
    readonly hosts: readonly string[];
  }[];
}

/** Figures over the saved logins only. */
function summarize(rows: readonly Finding[]): CredentialSummary {
  const hosts = new Set<string>();
  const identities = new Set<string>();
  const byUsername = new Map<string, Set<string>>();

  for (const row of rows) {
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
    reused,
  };
}

/** Scatter points: saved logins, then recovered ones marked by sidecar. */
function agePoints(
  saved: readonly Finding[],
  recovered: readonly Finding[],
): readonly CredentialAgePoint[] {
  const points: CredentialAgePoint[] = [];
  for (const row of [...saved, ...recovered]) {
    const ageDays = daysSince(fieldUtc(row.fields.dateCreated));
    const idleDays = daysSince(fieldUtc(row.fields.dateLastUsed));
    if (ageDays === null || idleDays === null) {
      continue;
    }
    const isRecovered = row.commitState !== "committed";
    points.push({
      site: credentialHost(row) ?? "site absent",
      username: fieldText(row.fields.usernameValue) ?? "username absent",
      ageDays,
      idleDays,
      timesUsed: fieldInteger(row.fields.timesUsed),
      recovered: isRecovered,
      sidecar: row.commitState === "journal_resident" ? "journal" : "wal",
    });
  }
  return points;
}

/* -------------------------------- widgets --------------------------------- */

/**
 * Reused identities — the same stored username across more than one site,
 * read from the saved logins. This is account linkage read directly off the
 * evidence, not inference: it only ever states "this exact username string
 * was saved on these sites", never a claim the accounts are the same person.
 * Each identity is an FF Card; picking one narrows both lists to it (a second
 * pick clears).
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
  return (
    <SectionPanel
      id="credentials-reused"
      className="h-full"
      title="Reused usernames"
      description="The same username in saved logins on several sites."
      aside={
        <Badge size="compact" className="tabular-nums">
          {reused.length.toLocaleString("en-US")}
        </Badge>
      }
    >
      {reused.length === 0 ? (
        <ChartEmpty>
          No saved username appears on more than one site.
        </ChartEmpty>
      ) : (
        <div className="p-1">
          <SizeProvider size="compact">
            <CardGroup orientation="inline">
              {reused.map((entry) => (
                <Card
                  key={entry.username}
                  label={`Narrow the lists to ${entry.username}`}
                  selected={activeUsername === entry.username}
                  onClick={() => {
                    onPick(entry.username);
                  }}
                >
                  <CardHeader className="min-w-0">
                    <CardTitle className={cn(CARD_TITLE_CLEAR, "font-mono")}>
                      {entry.username}
                    </CardTitle>
                    <CardDescription
                      className={cn(typeClass("caption"), "truncate")}
                      title={entry.hosts.join(", ")}
                    >
                      {entry.hosts.join(", ")}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="pointer-events-none">
                    <Count>{plural(entry.hosts.length, "site", "sites")}</Count>
                  </CardFooter>
                </Card>
              ))}
            </CardGroup>
          </SizeProvider>
        </div>
      )}
    </SectionPanel>
  );
}

/**
 * The stored password's *state*, never its contents. Chrome seals each
 * password with the OS key; the analyzer reports it `unavailable` with a
 * reason, and this cell says exactly that. A `value` state is still withheld
 * — the cell names the state and the row sheet carries the raw field. No own
 * tab stop: the row is the focus target, and its sheet the explanation.
 */
function PasswordCell({ field }: { readonly field: FieldState | undefined }) {
  const size = useSize();
  if (field === undefined || field.state === "absent") {
    return <AbsentWord />;
  }
  if (field.state === "value" && field.value === "") {
    return <FieldCell field={field} />;
  }
  const reason =
    field.state === "unavailable"
      ? field.reason
      : "A password value was recorded. It is withheld from this table.";
  return (
    <Tooltip content={reason}>
      <span className="flex cursor-help items-center gap-1.5 whitespace-nowrap">
        {field.state === "unavailable" ? (
          <>
            <EvidenceDot state="unavailable" />
            unavailable
          </>
        ) : (
          <>
            <Lock
              aria-hidden="true"
              size={size.icon}
              strokeWidth={1.5}
              className="shrink-0"
            />
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
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
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
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const host = credentialHost(row);
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label={`Open saved login for ${host ?? "a site not recorded"}`}
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
                  {host === null ? (
                    <FieldCell field={row.fields.signonRealm} />
                  ) : (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <SiteAvatar host={host} />
                      <span className="truncate text-foreground" title={host}>
                        {host}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <FieldCell field={row.fields.usernameValue} />
                </TableCell>
                <TableCell>
                  <PasswordCell field={row.fields.secret} />
                </TableCell>
                <TableCell>
                  <TimeCell field={row.fields.dateCreated} />
                </TableCell>
                <TableCell>
                  <TimeCell field={row.fields.dateLastUsed} />
                </TableCell>
                <TableCell className="tabular-nums">
                  <FieldCell
                    field={row.fields.timesUsed}
                    format={(value) => Number(value).toLocaleString("en-US")}
                  />
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

/**
 * One list (saved or recovered): loading rows, its read error, its empty
 * state, the table, a failed follow-up page, and the footer.
 */
function CredentialList({
  list,
  visible,
  noun,
  onSelect,
  onClearSearch,
}: {
  readonly list: PaginatedList<Finding>;
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly onSelect: (row: Finding) => void;
  readonly onClearSearch: () => void;
}) {
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} login`, many: `${noun} logins` }}
      shown={visible.length}
      filteredMessage={`No ${noun} logins match this search.`}
      onClearFilters={onClearSearch}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved logins in this Case."
              : "No logins were recovered from WAL or journal sidecars."
          }
        />
      }
    >
      <CredentialTable rows={visible} onSelect={onSelect} />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip and the widget row. */
function CredentialsSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading saved-login figures"
    >
      <Skeleton className="h-[160px] w-full rounded-xl lg:h-[86px]" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[360px] rounded-xl lg:col-span-7" />
        <Skeleton className="col-span-12 h-[150px] rounded-xl lg:col-span-5 lg:h-[360px]" />
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
  const lists = useCommitStateLists<Finding>(
    config.route,
    CREDENTIAL_PARAMETERS,
    {
      drain: CREDENTIAL_ROW_CAP,
    },
  );
  const savedDone = lists.drained.saved;
  const recoveredDone = lists.drained.recovered;
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");

  const saved = lists.saved.rows;
  const recovered = lists.recovered.rows;
  const summary = useMemo(() => summarize(saved), [saved]);
  const points = useMemo(() => agePoints(saved, recovered), [saved, recovered]);

  const narrow = useCallback(
    (rows: readonly Finding[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      if (query === "") {
        return rows;
      }
      return rows.filter((row) => {
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
    },
    [search],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const pickUsername = useCallback((username: string) => {
    setSearch((current) => (current === username ? "" : username));
  }, []);

  const clearSearch = useCallback(() => {
    setSearch("");
  }, []);

  const savedFirst = lists.saved.loading && saved.length === 0;
  const recoveredFirst = lists.recovered.loading && recovered.length === 0;
  const pageEmpty =
    savedDone &&
    recoveredDone &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    saved.length === 0 &&
    recovered.length === 0;
  // The figures wait for every saved page; with a failed saved read they
  // step aside and the Saved tab carries the reason.
  const figuresReady =
    (savedDone || lists.saved.error !== null) &&
    (recoveredDone || lists.recovered.error !== null);
  const showFigures =
    !figuresReady || (lists.saved.error === null && saved.length > 0);
  const plotted = points.length;
  const unplotted = saved.length + recovered.length - plotted;

  return (
    <div className="flex flex-col gap-5">
      {/* The redaction rule, stated before any row: no password is ever
          decrypted or displayed on this page. */}
      <Banner icon={Lock}>
        <BannerTitle>Passwords stay sealed</BannerTitle>
        <BannerDescription>
          Chrome encrypts every saved password with the operating system's key.
          This page never shows one: each password reads as its recorded state,
          and the figures below describe only sites, usernames, and dates.
        </BannerDescription>
      </Banner>
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={KeyRound}
            title="No saved logins"
            message="No saved logins recorded in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <CredentialsSkeleton />
              {figuresReady ? (
                <div className="flex flex-col gap-5">
                  {/* Footprint at a glance — distinct counts read straight
                      off the saved rows, never inference, and never password
                      contents. Recovered logins are their own figure. */}
                  <MetricBand className="grid-cols-2 lg:grid-cols-4">
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
                      label="Recovered logins"
                      value={
                        lists.recovered.error === null
                          ? recovered.length.toLocaleString("en-US")
                          : "unavailable"
                      }
                      detail={
                        lists.recovered.error === null
                          ? "from WAL or journal sidecars"
                          : "the recovered read failed; see its tab"
                      }
                    />
                  </MetricBand>

                  <div className="grid grid-cols-12 gap-4">
                    {/* Login age scatter — the one widget that reads the set
                        as a shape: recently used logins sit low, long-dormant
                        ones sit high, and older accounts sit further right.
                        Diamonds are recovered rows. Every coordinate is a
                        recorded timestamp turned into a day-distance. */}
                    <ChartSection
                      className="col-span-12 lg:col-span-7"
                      title="Login age and dormancy"
                      description="Days since first saved, against days since last used. Diamonds are recovered logins."
                      footer={
                        unplotted > 0 ? (
                          <span
                            className={cn(
                              typeClass("caption"),
                              "text-muted-foreground",
                            )}
                          >
                            {plural(unplotted, "login", "logins")} not plotted —
                            no recorded creation or last-use date.
                          </span>
                        ) : undefined
                      }
                    >
                      <div className="h-[320px] px-2 pt-2 pb-3">
                        <CredentialAgeScatter points={points} tokens={tokens} />
                      </div>
                    </ChartSection>

                    <div className="col-span-12 lg:col-span-5">
                      <ReusedIdentities
                        reused={summary.reused}
                        activeUsername={search === "" ? null : search}
                        onPick={pickUsername}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <SectionPanel
            id="credentials-list"
            title="Stored logins"
            description="Saved logins and logins recovered from WAL or journal sidecars are separate lists."
          >
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered logins"
              savedCount={
                savedFirst || (lists.saved.error !== null && saved.length === 0)
                  ? null
                  : saved.length
              }
              recoveredCount={
                recoveredFirst ||
                (lists.recovered.error !== null && recovered.length === 0)
                  ? null
                  : recovered.length
              }
              savedMore={lists.saved.cursor !== null}
              recoveredMore={lists.recovered.cursor !== null}
              toolbar={
                <FilterTextField
                  commit="change"
                  label="Search loaded logins"
                  placeholder="Search site or username"
                  icon={Search}
                  value={search}
                  onCommit={setSearch}
                />
              }
              saved={
                <CredentialList
                  list={lists.saved}
                  visible={savedVisible}
                  noun="saved"
                  onSelect={select}
                  onClearSearch={clearSearch}
                />
              }
              recovered={
                <CredentialList
                  list={lists.recovered}
                  visible={recoveredVisible}
                  noun="recovered"
                  onSelect={select}
                  onClearSearch={clearSearch}
                />
              }
            />
          </SectionPanel>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            credentialHost(selected.row) === null
              ? "Saved login"
              : `Saved login · ${credentialHost(selected.row) ?? ""}`
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
