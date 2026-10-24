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
 * server reads (`useCommitStateLists`, every page followed so the figures
 * cover the whole set) and separate lists (the Saved / Recovered tabs). The
 * figures count saved logins only.
 */
import { useCallback, useMemo, useState } from "react";

import { useViewTab } from "../view-state.js";

import { Panel } from "@/components/panel";
import {
  Card,
  CardDescription,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
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
import { FilterTextField } from "./filters.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import {
  HiddenValue,
  RowSheet,
  SEALED_REASON,
  secretFieldsOf,
  type SelectedRow,
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

interface CredentialSummary {
  readonly total: number;
  readonly identities: number;
  /** Usernames stored on more than one site, strongest linkage first. */
  readonly reused: readonly {
    readonly username: string;
    readonly hosts: readonly string[];
  }[];
}

/** Figures over the saved logins only. */
function summarize(rows: readonly Finding[]): CredentialSummary {
  const identities = new Set<string>();
  const byUsername = new Map<string, Set<string>>();

  for (const row of rows) {
    const host = credentialHost(row);
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

  return { total: rows.length, identities: identities.size, reused };
}

/* -------------------------------- widgets --------------------------------- */

/**
 * Reused usernames — the same stored username on more than one site, read
 * from the saved logins; the title's count is how many (the page's one
 * place for that fact, so the figure strip leaves it out). Each username
 * is an FF Card; picking one narrows both lists to it (a second pick
 * clears).
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
  if (reused.length === 0) {
    return null;
  }
  return (
    <SectionPanel
      id="credentials-reused"
      title="Reused usernames"
      count={reused.length}
    >
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
                  <CardTitle className={CARD_TITLE_CLEAR}>
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

function SiteCell({
  row,
  avatar,
}: {
  readonly row: Finding;
  readonly avatar: boolean;
}) {
  const host = credentialHost(row);
  if (host === null) {
    return <FieldCell field={row.fields.signonRealm} />;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <SiteAvatar host={host} /> : null}
      <span className="truncate text-foreground" title={host}>
        {host}
      </span>
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
      cell: (row) => <SiteCell row={row} avatar />,
      stackedCell: (row) => <SiteCell row={row} avatar={false} />,
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
      header: "Created",
      className: "whitespace-nowrap",
      labelled: true,
      cell: (row) => <TimeCell field={row.fields.dateCreated} />,
    },
    {
      key: "lastUsed",
      header: "Last used",
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
              : "No logins were recovered from Chrome's temporary database files."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={noun === "saved" ? SAVED_COLUMNS : RECOVERED_COLUMNS}
        rowKey={(row, index) => `${row.commitState}-${String(index)}`}
        rowLabel={(row) =>
          `Open saved login for ${credentialHost(row) ?? "a site not recorded"}`
        }
        onSelect={onSelect}
        tableClassName={noun === "saved" ? "min-w-[860px]" : "min-w-[960px]"}
      />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip and the reused list. */
function CredentialsSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading saved-login figures"
    >
      <Skeleton className="h-[76px] w-full rounded-xl" />
      <Skeleton className="h-[120px] w-full rounded-xl" />
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
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  // Saved / Recovered lives in the URL (`tab`): Back and a refresh keep it.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useState("");

  const saved = lists.saved.rows;
  const recovered = lists.recovered.rows;
  const summary = useMemo(() => summarize(saved), [saved]);

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
  const figuresReady = savedDone || lists.saved.error !== null;
  const showFigures =
    !figuresReady || (lists.saved.error === null && saved.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ARTIFACT_ICONS.credentials}
            title="No saved logins"
            message="No saved logins recorded in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap
              loading={!figuresReady}
              skeleton={<CredentialsSkeleton />}
            >
              <div className="flex flex-col gap-5">
                {/* The reused-username count is the widget's own count, not
                    a third figure: one fact, one place. */}
                <MetricBand className="grid-cols-2">
                  <MetricBandItem
                    label="Saved logins"
                    value={summary.total.toLocaleString("en-US")}
                  />
                  <MetricBandItem
                    label="Distinct usernames"
                    value={summary.identities.toLocaleString("en-US")}
                  />
                </MetricBand>
                <ReusedIdentities
                  reused={summary.reused}
                  activeUsername={search === "" ? null : search}
                  onPick={pickUsername}
                />
              </div>
            </RevealSwap>
          ) : null}

          <SectionPanel id="credentials-list" title="Stored logins">
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
                  icon={SearchIcon}
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
          redactedFields={secretFieldsOf(selected.row)}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
