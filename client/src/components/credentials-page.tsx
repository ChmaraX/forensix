/**
 * The Saved logins page.
 *
 * Chrome's stored login entries read as an identity picture. Passwords are
 * hidden by default: `secret` normally arrives `unavailable` (no key
 * material) and the Password column reads "sealed" (the column header says
 * why); any other unavailable reason shows as itself. A password decrypted
 * with `--decrypt` reads "value hidden" in the table and opens hidden in the
 * row sheet, revealable there one field at a time (`secretFieldsOf`).
 *
 * What the page reads instead is the shape of an account footprint: how many
 * logins and distinct usernames were saved, and which usernames repeat
 * across sites (account linkage, read straight off the evidence — "this
 * exact username was saved on these sites", never a claim about a person).
 *
 * Saved logins and logins recovered from WAL / journal sidecars are separate
 * server reads (`useCommitStateLists`, keyset-paged) and separate lists
 * (the Saved / Recovered tabs). The figures, the tab counts and Reused
 * usernames are the server's counts (`count-reads.ts`) over every saved
 * login in the profiles the Case-wide lens picks - the lens is a server
 * filter too - never a reading of the rows loaded so far. A site - read
 * from the origin URL, else the sign-on realm - opens Sites on it (in the
 * table, when Sites lists it).
 */
import { useCallback, useMemo, useState } from "react";

import { rowRefOf } from "../router.js";
import { useRowSelection, useViewSearch, useViewTab } from "../view-state.js";

import {
  Card,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { SizeProvider } from "@/lib/size-context";

import type { QueryParameters } from "../api.js";
import type { CountResult, FieldState, Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import {
  distinctValues,
  formatTally,
  useCommitStateTotals,
  useCount,
} from "../count-reads.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
  type PaginatedList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  AbsentWord,
  FieldCell,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  matchesSearch,
  ProfilePicker,
  sortKeyOf,
  SortSelect,
  type SortOption,
} from "./filters.js";
import {
  ArtifactEmpty,
  clearSearchAndProfiles,
  emptyCoverageOf,
  EmptyPivot,
  useProfileLens,
} from "./identity-kit.js";
import { SiteHostLink } from "./host-link.js";
import { useArtifactCoverage } from "../case-context.js";
import { ListBlock } from "./list-states.js";
import { figure, MetricBand, MetricBandItem } from "./metric-band.js";
import {
  HiddenValue,
  RowSheet,
  SEALED_REASON,
  secretFieldsOf,
} from "./row-sheet.js";
import { Term } from "./term.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type RowColumn,
} from "./page-kit.js";

/* ------------------------------ data loading ------------------------------ */

/** The list's orders (`SortSelect`), the route's default first. */
const NEWEST_USED: SortOption = {
  label: "Last used, newest",
  sort: "last-used-time",
  direction: "desc",
};
const CREDENTIAL_SORTS: readonly SortOption[] = [
  NEWEST_USED,
  { label: "Last used, oldest", sort: "last-used-time", direction: "asc" },
  { label: "Created, newest", sort: "created-time", direction: "desc" },
  { label: "Site, A to Z", sort: "origin", direction: "asc" },
  { label: "Username, A to Z", sort: "username", direction: "asc" },
];

/** The Finding kind of a saved login (the `count` route's `kind`). */
const CREDENTIAL_KIND = "login_credential";

/* --------------------------- derived readings ----------------------------- */

/** The host a credential belongs to, from its origin URL then its realm. */
function credentialHost(row: Finding): string | null {
  return (
    hostOf(fieldText(row.fields.originUrl)) ??
    hostOf(fieldText(row.fields.signonRealm)) ??
    fieldText(row.fields.signonRealm)
  );
}

/** Usernames recorded on more than one saved login, most logins first. */
interface ReusedUsernames {
  readonly entries: readonly {
    readonly username: string;
    readonly logins: number;
  }[];
  /** The server listed only its largest buckets and the last of them
   *  still repeats: more reused usernames may exist. */
  readonly more: boolean;
}

/** The reused usernames in a `by=usernameValue` count of saved logins. */
export function reusedUsernamesOf(result: CountResult): ReusedUsernames {
  const entries = result.buckets
    .filter(
      (bucket) =>
        bucket.state === "value" && bucket.key !== "" && bucket.count > 1,
    )
    .map((bucket) => ({ username: bucket.key, logins: bucket.count }));
  const last = result.buckets.at(-1);
  return {
    entries,
    more: result.otherCount > 0 && last !== undefined && last.count > 1,
  };
}

/* -------------------------------- widgets --------------------------------- */

/**
 * Reused usernames — the same stored username on more than one saved
 * login, counted by the server over every saved login in the lens; the
 * title's count is how many (the page's one place for that fact, so the
 * figure strip leaves it out). Each username is an FF Card; picking one
 * narrows the loaded lists to it (a second pick clears).
 */
function ReusedIdentities({
  reused,
  activeUsername,
  onPick,
}: {
  readonly reused: ReusedUsernames;
  readonly activeUsername: string | null;
  readonly onPick: (username: string) => void;
}) {
  if (reused.entries.length === 0) {
    return null;
  }
  return (
    <SectionPanel
      id="credentials-reused"
      title="Reused usernames"
      count={formatTally({ count: reused.entries.length, more: reused.more })}
    >
      <div className="p-1">
        <SizeProvider size="compact">
          <CardGroup orientation="inline">
            {reused.entries.map((entry) => (
              <Card
                key={entry.username}
                label={`Narrow the lists to ${entry.username}`}
                selected={activeUsername === entry.username}
                onClick={() => {
                  onPick(entry.username);
                }}
              >
                <CardHeader className="min-w-0">
                  <CardTitle className={CARD_TITLE_CLEAR}>
                    {entry.username}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="pointer-events-none">
                  <Count>
                    {plural(entry.logins, "saved login", "saved logins")}
                  </Count>
                </CardFooter>
              </Card>
            ))}
          </CardGroup>
        </SizeProvider>
      </div>
    </SectionPanel>
  );
}

const SEALED_NOTE =
  "Chrome encrypts every saved password with the operating system's key, so it reads sealed unless the Case was analysed with that key. A decrypted password stays hidden until you reveal it in the row's detail.";

/** The Password column header: its tooltip says why every value is sealed. */
const PASSWORD_HEADER = <Term label="Password">{SEALED_NOTE}</Term>;

/**
 * The stored password's *state*, never its contents. Chrome seals each
 * password with the OS key; without key material the analyzer reports it
 * `unavailable` with `encrypted_secret_without_key_material`, and the cell
 * reads a neutral "sealed" (the expected state of every row, not an error;
 * the column header explains it). Any other unavailable reason (a failed
 * decryption, an unsupported value) shows as itself, with its reason. A
 * decrypted value reads "value hidden"; the row sheet reveals it. No own tab
 * stop: the row is the focus target.
 */
function PasswordCell({ field }: { readonly field: FieldState | undefined }) {
  if (field === undefined || field.state === "absent") {
    return <AbsentWord />;
  }
  if (field.state === "unavailable" && field.reason === SEALED_REASON) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <EvidenceDot state="neutral" />
        sealed
      </span>
    );
  }
  if (field.state === "value" && field.value !== "") {
    return <HiddenValue hint="Open the row to reveal it." />;
  }
  return <FieldCell field={field} />;
}

/** The field a login's site is read from: its origin URL, else its sign-on
 *  realm (the realm alone on an entry Chrome saved without an origin). */
function siteSourceOf(row: Finding): string | null {
  return fieldText(row.fields.originUrl) ?? fieldText(row.fields.signonRealm);
}

/**
 * The login's site. In the table it opens Sites on that host - read from
 * the origin URL, else the sign-on realm, keyed as Sites keys it - when
 * Sites lists it; the stacked card is itself a button, so there it stays
 * text.
 */
function SiteCell({
  row,
  linked,
}: {
  readonly row: Finding;
  readonly linked: boolean;
}) {
  const host = credentialHost(row);
  if (host === null) {
    return <FieldCell field={row.fields.signonRealm} />;
  }
  if (!linked) {
    return (
      <span className="block truncate text-foreground" title={host}>
        {host}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={host} />
      <SiteHostLink
        host={siteSourceOf(row)}
        className="truncate text-foreground"
      >
        {host}
      </SiteHostLink>
    </span>
  );
}

/**
 * The table's columns. State only shows in the Recovered tab. Below `sm` a
 * row stacks: last use and state, the site, then username, creation and
 * uses (the password state, the same on every row, stays in the table and
 * the sheet).
 */
function credentialColumns(recovered: boolean): readonly RowColumn<Finding>[] {
  const columns: RowColumn<Finding>[] = [
    {
      key: "site",
      header: "Site",
      className: "max-w-[320px]",
      stack: "title",
      cell: (row) => <SiteCell row={row} linked />,
      stackedCell: (row) => <SiteCell row={row} linked={false} />,
    },
    {
      key: "username",
      header: "Username",
      className: "max-w-[240px]",
      cell: (row) => (
        <FieldCell field={row.fields.usernameValue} mono={false} />
      ),
    },
    {
      key: "password",
      header: PASSWORD_HEADER,
      label: "Password",
      stack: "hidden",
      cell: (row) => <PasswordCell field={row.fields.secret} />,
    },
    {
      key: "created",
      header: "Created (UTC)",
      label: "Created",
      className: "whitespace-nowrap",
      labelled: true,
      cell: (row) => <TimeCell field={row.fields.dateCreated} />,
    },
    {
      key: "lastUsed",
      header: "Last used (UTC)",
      label: "Last used",
      className: "whitespace-nowrap",
      stack: "lead",
      cell: (row) => <TimeCell field={row.fields.dateLastUsed} />,
    },
    {
      key: "uses",
      header: "Uses",
      className: "text-right tabular-nums",
      labelled: true,
      cell: (row) => (
        <FieldCell
          field={row.fields.timesUsed}
          format={(value) => Number(value).toLocaleString("en-US")}
        />
      ),
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      stack: "aside",
      cell: (row) => <StateWord state={row.commitState} />,
    });
  }
  return columns;
}

const SAVED_COLUMNS = credentialColumns(false);
const RECOVERED_COLUMNS = credentialColumns(true);

/** A row's key: its reference, so a search never hands one row's memoised
 *  cells to another. */
function credentialKey(row: Finding, index: number): string {
  return rowRefOf(row) ?? `${row.commitState}-${String(index)}`;
}

function credentialLabel(row: Finding): string {
  return `Open saved login for ${credentialHost(row) ?? "a site not recorded"}`;
}

/**
 * One list (saved or recovered): loading rows, its read error, its empty
 * state, the table, a failed follow-up page, and the footer.
 */
function CredentialList({
  list,
  visible,
  lensFiltered,
  noun,
  onSelect,
  onClearFilters,
  filteredMessage,
}: {
  readonly list: PaginatedList<Finding>;
  readonly visible: readonly Finding[];
  /** The profile pick (a server filter) narrows the list. */
  readonly lensFiltered: boolean;
  readonly noun: "saved" | "recovered";
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
  readonly filteredMessage: string;
}) {
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} login`, many: `${noun} logins` }}
      shown={visible.length}
      filtered={lensFiltered || visible.length !== list.rows.length}
      filteredMessage={filteredMessage}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved logins in this Case."
              : "No logins were recovered from Chrome's temporary database files."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={noun === "saved" ? SAVED_COLUMNS : RECOVERED_COLUMNS}
        rowKey={credentialKey}
        rowLabel={credentialLabel}
        onSelect={onSelect}
        tableClassName={noun === "saved" ? "min-w-[860px]" : "min-w-[960px]"}
      />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip and the reused list. */
function CredentialsSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status">
      <span className="sr-only">Loading saved-login figures</span>
      <Skeleton className="h-[76px] w-full rounded-xl" />
      <Skeleton className="h-[120px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

const config = ARTIFACTS.credentials;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function CredentialsPage() {
  const [order, setOrder] = useState<SortOption>(NEWEST_USED);
  // The profile pick is the Case-wide lens, applied by the server.
  const lens = useProfileLens();
  const parameters = useMemo<QueryParameters>(
    () => [
      ["sort", order.sort],
      ["direction", order.direction],
      ["limit", "100"],
      ...lens.parameters,
    ],
    [order, lens.parameters],
  );
  const lists = useCommitStateLists<Finding>(config.route, parameters);
  const totals = useCommitStateTotals(CREDENTIAL_KIND, lens.selected);
  const usernames = useCount({
    kind: CREDENTIAL_KIND,
    by: "usernameValue",
    commitState: "committed",
    profiles: lens.selected,
  });
  // Saved / Recovered, the search (a picked username too) and the open row
  // live in the URL: Back and a refresh keep them.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  const coverage = useArtifactCoverage(config.completenessArtifact);

  const saved = lists.saved.rows;
  const recovered = lists.recovered.rows;
  const loaded = useMemo(() => [...saved, ...recovered], [saved, recovered]);
  const sheet = useRowSelection(loaded, ROW_LOOKUP);
  const reused = useMemo(
    () =>
      usernames.state === "ready" ? reusedUsernamesOf(usernames.value) : null,
    [usernames],
  );

  const narrow = useCallback(
    (rows: readonly Finding[]) =>
      rows.filter((row) =>
        matchesSearch(search, [
          credentialHost(row),
          fieldText(row.fields.usernameValue),
          fieldText(row.fields.signonRealm),
          fieldText(row.fields.originUrl),
        ]),
      ),
    [search],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const pickUsername = useCallback(
    (username: string) => {
      setSearch(search === username ? "" : username);
    },
    [search, setSearch],
  );

  const status = commitStateStatus(
    lists,
    { saved: saved.length, recovered: recovered.length },
    totals.state === "ready" ? totals.value : null,
    { filtered: lens.selected.length > 0 },
  );
  const filteredMessage = (noun: string) =>
    search.trim() === "" && lens.words !== null
      ? `No ${noun} logins in ${lens.words}.`
      : `No ${noun} logins match this search.`;

  return (
    <CommitStatePage
      status={status}
      empty={
        <ArtifactEmpty
          icon={ARTIFACT_ICONS.credentials}
          coverage={emptyCoverageOf(coverage)}
          artifact="Login Data"
          title="No saved logins"
          what="stored logins"
          pivot={<EmptyPivot page="cookies">Open Cookies</EmptyPivot>}
        />
      }
      figuresSkeleton={<CredentialsSkeleton />}
      figures={
        <div className="flex flex-col gap-5">
          {/* The reused-username count is the widget's own count, not a
              third figure: one fact, one place. */}
          <MetricBand className="grid-cols-2">
            <MetricBandItem
              label="Saved logins"
              value={figure(totals, (value) =>
                value.saved.toLocaleString("en-US"),
              )}
            />
            <MetricBandItem
              label="Distinct usernames"
              value={figure(usernames, (value) =>
                formatTally(distinctValues(value)),
              )}
            />
          </MetricBand>
          {reused === null ? null : (
            <ReusedIdentities
              reused={reused}
              activeUsername={search === "" ? null : search}
              onPick={pickUsername}
            />
          )}
        </div>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            // The site names the login; the header already says "Saved
            // login".
            title={credentialHost(sheet.selected.row) ?? "Saved login"}
            redactedFields={secretFieldsOf(sheet.selected.row)}
            onClose={sheet.close}
          />
        )
      }
    >
      <SectionPanel id="credentials-list" title="Stored logins">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered logins"
          {...status.split}
          toolbar={
            <>
              <CompactFilters active={lens.selected.length > 0 ? 1 : 0}>
                <SortSelect
                  id="credentials-sort"
                  options={CREDENTIAL_SORTS}
                  value={sortKeyOf(order)}
                  onChange={setOrder}
                />
                {lens.showPicker ? (
                  <FilterField label="Profiles" htmlFor="credentials-profiles">
                    <ProfilePicker
                      id="credentials-profiles"
                      profiles={lens.options}
                      selected={lens.selected}
                      onChange={lens.setSelected}
                    />
                  </FilterField>
                ) : null}
              </CompactFilters>
              <FilterTextField
                commit="change"
                label="Search loaded logins"
                placeholder="Search site or username"
                icon={SearchIcon}
                value={search}
                onCommit={setSearch}
              />
            </>
          }
          saved={
            <CredentialList
              list={lists.saved}
              visible={savedVisible}
              lensFiltered={lens.selected.length > 0}
              noun="saved"
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("saved")}
            />
          }
          recovered={
            <CredentialList
              list={lists.recovered}
              visible={recoveredVisible}
              lensFiltered={lens.selected.length > 0}
              noun="recovered"
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("recovered")}
            />
          }
        />
      </SectionPanel>
    </CommitStatePage>
  );
}
