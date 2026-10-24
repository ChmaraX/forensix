/**
 * The Cookies page.
 *
 * Cookies read as a security-and-scope posture: the four figures restate the
 * recorded flags of the saved rows (`isSecure`, `isHttpOnly`, and whether the
 * value is still sealed behind OS encryption), and the one widget,
 * Persistence, is the single honest interpolation — each cookie's lifespan,
 * from its own `creationTime` to its own `expiresTime`.
 *
 * Cookie values are session secrets, so the table keeps them **hidden by
 * default**: a recorded value reads "value hidden" until the examiner turns
 * on "Show values"; the row sheet keeps it hidden too, behind its own Reveal
 * (`redactedFields`). A value that could not be decrypted offline reads
 * "unavailable" with its reason, an empty one "(empty)", a missing one
 * "absent" — distinct words, never a colour alone.
 *
 * Saved rows and rows recovered from WAL / journal sidecars are separate
 * server reads (`useCommitStateLists`) and separate lists (the Saved /
 * Recovered tabs). Every figure counts the loaded saved cookies only. The
 * page only reads rows back.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { ChartEmpty, useChartTokens } from "./charts.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  FieldCell,
  fieldBool,
  fieldText,
  fieldUtc,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import {
  COOKIE_SECRET_FIELDS,
  RowSheet,
  SecretValueCell,
  type SelectedRow,
} from "./row-sheet.js";
import {
  CommitStateSplit,
  MeterList,
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";
import { Term } from "./term.js";

/* ------------------------------ data reading ------------------------------ */

/** Newest first; each Commit State is its own read (useCommitStateLists). */
const COOKIE_PARAMETERS: QueryParameters = [
  ["sort", "creation-time"],
  ["direction", "desc"],
];

/**
 * One cookie row reduced to the fields the figures and the table read,
 * computed once. Every property mirrors a recorded flag; `lifespanDays` is
 * the one derived figure — the whole-day distance from `creationTime` to
 * `expiresTime`, only when both are present.
 */
interface CookieRow {
  readonly finding: Finding;
  readonly host: string | null;
  readonly name: string | null;
  readonly path: string | null;
  readonly secure: boolean | null;
  readonly httpOnly: boolean | null;
  readonly sameSite: string | null;
  /** True when `value` came back `unavailable` — the encrypted-offline case. */
  readonly valueSealed: boolean;
  /** Whole days from creation to expiry, or null when a bound is missing. */
  readonly lifespanDays: number | null;
}

/** A cookie host key normalized for display: no leading dot, no `www.`. */
function displayHost(hostKey: string | null): string | null {
  if (hostKey === null) {
    return null;
  }
  return hostKey.replace(/^\./, "").replace(/^www\./, "") || null;
}

function toCookieRow(finding: Finding): CookieRow {
  const created = fieldUtc(finding.fields.creationTime);
  const expires = fieldUtc(finding.fields.expiresTime);
  let lifespanDays: number | null = null;
  if (created !== null && expires !== null) {
    const start = new Date(created).getTime();
    const end = new Date(expires).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      lifespanDays = Math.round((end - start) / 86_400_000);
    }
  }
  return {
    finding,
    host: displayHost(fieldText(finding.fields.hostKey)),
    name: fieldText(finding.fields.name),
    path: fieldText(finding.fields.path),
    secure: fieldBool(finding.fields.isSecure),
    httpOnly: fieldBool(finding.fields.isHttpOnly),
    sameSite: fieldText(finding.fields.sameSite),
    valueSealed: finding.fields.value?.state === "unavailable",
    lifespanDays,
  };
}

/* --------------------------- derived summaries ---------------------------- */

interface PostureSummary {
  readonly total: number;
  readonly secure: number;
  readonly httpOnly: number;
  readonly sealed: number;
}

/**
 * The four headline figures. Each numerator counts only rows that carry the
 * recorded flag as `true` (or, for `sealed`, whose value came back
 * unavailable): a cookie whose `isSecure` field is absent is never counted
 * as insecure, it simply is not in the numerator.
 */
function summarize(rows: readonly CookieRow[]): PostureSummary {
  let secure = 0;
  let httpOnly = 0;
  let sealed = 0;
  for (const row of rows) {
    if (row.secure === true) {
      secure += 1;
    }
    if (row.httpOnly === true) {
      httpOnly += 1;
    }
    if (row.valueSealed) {
      sealed += 1;
    }
  }
  return { total: rows.length, secure, httpOnly, sealed };
}

const SAME_SITE_LABEL: Readonly<Record<string, string>> = {
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
  unspecified: "Unspecified",
};

/** What each recorded SameSite policy means, for the column's tooltips. */
const SAME_SITE_HINT: Readonly<Record<string, string>> = {
  no_restriction: "Sent on every cross-site request.",
  lax: "Sent on top-level navigations only.",
  strict: "Never sent cross-site.",
  unspecified: "No policy set; the browser default applies.",
};

/**
 * Lifespan buckets, derived from each cookie's own creation-to-expiry span.
 * A negative span means the recorded expiry is already in its past — expired
 * at capture — which is itself evidence, so it gets its own bucket.
 */
const LIFESPAN_BUCKETS = [
  { key: "expired", label: "Expired", test: (days: number) => days < 0 },
  { key: "session", label: "≤ 1 day", test: (days: number) => days <= 1 },
  { key: "week", label: "≤ 1 week", test: (days: number) => days <= 7 },
  { key: "month", label: "≤ 1 month", test: (days: number) => days <= 31 },
  { key: "year", label: "≤ 1 year", test: (days: number) => days <= 365 },
  { key: "multiyear", label: "> 1 year", test: () => true },
] as const;

function lifespanBuckets(rows: readonly CookieRow[]): {
  readonly buckets: readonly {
    readonly key: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly dated: number;
} {
  const counts = new Map<string, number>(
    LIFESPAN_BUCKETS.map((bucket) => [bucket.key, 0]),
  );
  let dated = 0;
  for (const row of rows) {
    const days = row.lifespanDays;
    if (days === null) {
      continue;
    }
    dated += 1;
    const bucket = LIFESPAN_BUCKETS.find((entry) => entry.test(days));
    if (bucket !== undefined) {
      counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
    }
  }
  return {
    buckets: LIFESPAN_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      count: counts.get(bucket.key) ?? 0,
    })),
    dated,
  };
}

/** "3 years" / "12 days" / "session" style label for a lifespan in days. */
function formatLifespan(days: number): string {
  if (days <= 1) {
    return "session";
  }
  if (days < 31) {
    return `${String(days)} days`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${String(months)} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${String(years)} year${years === 1 ? "" : "s"}`;
}

/** A share as a whole percent; the figures only render with rows loaded. */
function percent(part: number, whole: number): string {
  return whole === 0 ? "none" : `${String(Math.round((part / whole) * 100))}%`;
}

/* ------------------------------ page sections ----------------------------- */

/** A tile's figure, with its exact "N of M" in a tooltip. */
function ShareFigure({
  value,
  detail,
}: {
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <Tooltip content={detail}>
      <span className="cursor-default">{value}</span>
    </Tooltip>
  );
}

/** The four posture figures across the top of the page (saved rows only). */
function PostureStrip({
  summary,
  more,
}: {
  readonly summary: PostureSummary;
  readonly more: boolean;
}) {
  const of = (part: number, what: string) =>
    `${part.toLocaleString("en-US")} of ${plural(summary.total, "saved cookie", "saved cookies")} ${what}`;
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Saved cookies"
        value={`${summary.total.toLocaleString("en-US")}${more ? "+" : ""}`}
      />
      <MetricBandItem
        label={<Term label="Secure">Sent only over HTTPS.</Term>}
        value={
          <ShareFigure
            value={percent(summary.secure, summary.total)}
            detail={of(summary.secure, "marked Secure")}
          />
        }
      />
      <MetricBandItem
        label={<Term label="HttpOnly">Hidden from page scripts.</Term>}
        value={
          <ShareFigure
            value={percent(summary.httpOnly, summary.total)}
            detail={of(summary.httpOnly, "marked HttpOnly")}
          />
        }
      />
      <MetricBandItem
        label={
          <Term label="Sealed">
            Value encrypted with the operating system's key, so it cannot be
            read offline.
          </Term>
        }
        value={
          <ShareFigure
            value={percent(summary.sealed, summary.total)}
            detail={of(summary.sealed, "with a sealed value")}
          />
        }
      />
    </MetricBand>
  );
}

/**
 * Persistence: how long each saved cookie was set to live, from its own
 * creation-to-expiry span, as ranked bars on fixed buckets. A zero bucket
 * draws no bar. Cookies missing a creation or expiry bound are named as a
 * figure under the bars, never dropped.
 */
function LifespanCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const tokens = useChartTokens();
  const { buckets, dated } = useMemo(() => lifespanBuckets(rows), [rows]);
  const undated = rows.length - dated;
  return (
    <SectionPanel id="cookies-lifespan" title="Persistence">
      {dated === 0 ? (
        <ChartEmpty>
          No saved cookie carries both a creation and an expiry time.
        </ChartEmpty>
      ) : (
        <div className="px-4 pt-1 pb-3">
          <MeterList
            rows={buckets.map((bucket) => ({
              key: bucket.key,
              label: bucket.label,
              value: bucket.count,
              display: bucket.count.toLocaleString("en-US"),
            }))}
            tokens={tokens}
            labelWidth="5rem"
          />
        </div>
      )}
      {undated > 0 ? (
        <p
          className={cn(
            typeClass("caption"),
            "px-4 pb-4 text-muted-foreground",
          )}
        >
          {plural(undated, "saved cookie", "saved cookies")} with no dated span.
        </p>
      ) : null}
    </SectionPanel>
  );
}

/* ------------------------------ curated table ----------------------------- */

/** A worded Yes/No/absent for a recorded boolean scope flag. Never colour-only. */
function FlagCell({ field }: { readonly field: FieldState | undefined }) {
  const on = fieldBool(field);
  if (on === null) {
    return <FieldCell field={field} />;
  }
  return on ? <span className="text-foreground">Yes</span> : <span>No</span>;
}

/** The recorded SameSite policy as a word, its meaning in a tooltip. */
function SameSiteCell({ field }: { readonly field: FieldState | undefined }) {
  const key = fieldText(field);
  if (key === null) {
    return <FieldCell field={field} />;
  }
  const label = SAME_SITE_LABEL[key] ?? key;
  const hint = SAME_SITE_HINT[key];
  return hint === undefined ? (
    <span>{label}</span>
  ) : (
    <Tooltip content={hint}>
      <span className="cursor-help">{label}</span>
    </Tooltip>
  );
}

function LifespanCell({ row }: { readonly row: CookieRow }) {
  if (row.lifespanDays === null) {
    return (
      <FieldCell
        field={
          fieldUtc(row.finding.fields.creationTime) === null
            ? row.finding.fields.creationTime
            : row.finding.fields.expiresTime
        }
      />
    );
  }
  if (row.lifespanDays < 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <EvidenceDot state="warning" />
        expired
      </span>
    );
  }
  return <>{formatLifespan(row.lifespanDays)}</>;
}

function HostCell({
  row,
  avatar,
}: {
  readonly row: CookieRow;
  readonly avatar: boolean;
}): ReactNode {
  if (row.host === null) {
    return <FieldCell field={row.finding.fields.hostKey} />;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {avatar ? <SiteAvatar host={row.host} /> : null}
      <span className="truncate text-foreground" title={row.host}>
        {row.host}
      </span>
    </span>
  );
}

/** The cookie's name (a key, so mono) over its path when that isn't "/". */
function NameCell({ row }: { readonly row: CookieRow }) {
  if (row.name === null) {
    return <FieldCell field={row.finding.fields.name} />;
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-mono" title={row.name}>
        {row.name}
      </span>
      {row.path === null || row.path === "/" ? null : (
        <span
          className={cn(
            typeClass("caption"),
            "truncate font-mono text-muted-foreground",
          )}
          title={row.path}
        >
          {row.path}
        </span>
      )}
    </span>
  );
}

/**
 * The table's columns. The State column only shows in the Recovered tab —
 * every saved row would read "saved". Below `sm` a row stacks: host and
 * state on the first line, the cookie name, then value, lifespan and time.
 */
function cookieColumns(
  reveal: boolean,
  recovered: boolean,
): readonly RowColumn<CookieRow>[] {
  const columns: RowColumn<CookieRow>[] = [
    {
      key: "host",
      header: "Host",
      className: "max-w-[180px]",
      stack: "lead",
      cell: (row) => <HostCell row={row} avatar />,
      stackedCell: (row) => <HostCell row={row} avatar={false} />,
    },
    {
      key: "name",
      header: "Cookie",
      className: "max-w-[180px]",
      stack: "title",
      cell: (row) => <NameCell row={row} />,
    },
    {
      key: "value",
      header: "Value",
      cell: (row) => (
        <SecretValueCell
          field={row.finding.fields.value}
          reveal={reveal}
          className="max-w-[180px]"
        />
      ),
    },
    {
      key: "secure",
      header: "Secure",
      stack: "hidden",
      cell: (row) => <FlagCell field={row.finding.fields.isSecure} />,
    },
    {
      key: "httpOnly",
      header: "HttpOnly",
      stack: "hidden",
      cell: (row) => <FlagCell field={row.finding.fields.isHttpOnly} />,
    },
    {
      key: "sameSite",
      header: "SameSite",
      className: "whitespace-nowrap",
      stack: "hidden",
      cell: (row) => <SameSiteCell field={row.finding.fields.sameSite} />,
    },
    {
      key: "lifespan",
      header: "Lifespan",
      className: "whitespace-nowrap tabular-nums",
      cell: (row) => <LifespanCell row={row} />,
    },
    {
      key: "created",
      header: "Created",
      className: "whitespace-nowrap",
      cell: (row) => <TimeCell field={row.finding.fields.creationTime} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      stack: "aside",
      cell: (row) => <StateWord state={row.finding.commitState} />,
    });
  }
  return columns;
}

/**
 * One list (saved or recovered): its loading rows, its read error, its empty
 * state, the table, a load-more failure, and the footer. Each list keeps its
 * own pagination.
 */
function CookieList({
  list,
  rows,
  visible,
  noun,
  reveal,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly rows: readonly CookieRow[];
  readonly visible: readonly CookieRow[];
  readonly noun: "saved" | "recovered";
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  const columns = useMemo(
    () => cookieColumns(reveal, noun === "recovered"),
    [reveal, noun],
  );
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} cookie`, many: `${noun} cookies` }}
      shown={visible.length}
      filtered={visible.length !== rows.length}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved cookie rows in this Case."
              : "No cookie rows were recovered from WAL or journal sidecars."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={columns}
        rowKey={(row, index) => `${row.finding.commitState}-${String(index)}`}
        rowLabel={(row) =>
          `Open cookie ${row.name ?? "with no recorded name"} on ${row.host ?? "a host not recorded"}`
        }
        onSelect={(row) => {
          onSelect(row.finding);
        }}
        tableClassName={
          noun === "recovered" ? "min-w-[1040px]" : "min-w-[900px]"
        }
      />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip and Persistence. */
function CookiesSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading cookie figures"
    >
      <Skeleton className="h-[150px] w-full rounded-xl lg:h-[76px]" />
      <Skeleton className="h-[290px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CookiesPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(config.route, COOKIE_PARAMETERS);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);
  const [reveal, setReveal] = useState(false);

  const savedRows = useMemo(
    () => lists.saved.rows.map(toCookieRow),
    [lists.saved.rows],
  );
  const recoveredRows = useMemo(
    () => lists.recovered.rows.map(toCookieRow),
    [lists.recovered.rows],
  );
  const summary = useMemo(() => summarize(savedRows), [savedRows]);

  const profiles = useMemo(
    () =>
      [
        ...new Set(
          [...savedRows, ...recoveredRows].map((row) => row.finding.profile),
        ),
      ].sort(),
    [savedRows, recoveredRows],
  );

  const narrow = useCallback(
    (rows: readonly CookieRow[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return rows.filter((row) => {
        if (
          profileFilter.length > 0 &&
          !profileFilter.includes(row.finding.profile)
        ) {
          return false;
        }
        if (query === "") {
          return true;
        }
        // Never the value: a search must not reveal a hidden secret.
        const haystack = [row.host ?? "", row.name ?? "", row.sameSite ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, profileFilter],
  );
  const savedVisible = useMemo(() => narrow(savedRows), [narrow, savedRows]);
  const recoveredVisible = useMemo(
    () => narrow(recoveredRows),
    [narrow, recoveredRows],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const savedFirst = lists.saved.loading && savedRows.length === 0;
  const recoveredFirst = lists.recovered.loading && recoveredRows.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    savedRows.length === 0 &&
    recoveredRows.length === 0;
  // The figures read the saved rows only; with none (or a failed read) they
  // step aside and the Saved tab carries the reason.
  const showFigures =
    savedFirst || (lists.saved.error === null && savedRows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ARTIFACT_ICONS.cookies}
            title="No cookies"
            message="No Cookies rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap loading={savedFirst} skeleton={<CookiesSkeleton />}>
              <div className="flex flex-col gap-5">
                <PostureStrip
                  summary={summary}
                  more={lists.saved.cursor !== null}
                />
                <LifespanCard rows={savedRows} />
              </div>
            </RevealSwap>
          ) : null}

          <SectionPanel id="cookies-list" title="All cookies">
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered cookies"
              savedCount={
                savedFirst ||
                (lists.saved.error !== null && savedRows.length === 0)
                  ? null
                  : savedRows.length
              }
              recoveredCount={
                recoveredFirst ||
                (lists.recovered.error !== null && recoveredRows.length === 0)
                  ? null
                  : recoveredRows.length
              }
              savedMore={lists.saved.cursor !== null}
              recoveredMore={lists.recovered.cursor !== null}
              toolbar={
                <>
                  <Switch
                    label="Show values"
                    checked={reveal}
                    onToggle={() => {
                      setReveal((value) => !value);
                    }}
                    className="mr-2"
                  />
                  {profiles.length > 1 ? (
                    <FilterField label="Profiles" htmlFor="cookies-profiles">
                      <ProfilePicker
                        id="cookies-profiles"
                        profiles={profiles}
                        selected={profileFilter}
                        onChange={setProfileFilter}
                      />
                    </FilterField>
                  ) : null}
                  <FilterTextField
                    commit="change"
                    label="Search loaded cookies"
                    placeholder="Search host or name"
                    icon={SearchIcon}
                    value={search}
                    onCommit={setSearch}
                  />
                </>
              }
              saved={
                <CookieList
                  list={lists.saved}
                  rows={savedRows}
                  visible={savedVisible}
                  noun="saved"
                  reveal={reveal}
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
              recovered={
                <CookieList
                  list={lists.recovered}
                  rows={recoveredRows}
                  visible={recoveredVisible}
                  noun="recovered"
                  reveal={reveal}
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
            />
          </SectionPanel>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={fieldText(selected.row.fields.name) ?? "Cookie"}
          redactedFields={COOKIE_SECRET_FIELDS}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
